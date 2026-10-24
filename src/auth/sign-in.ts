import { canonicalAddress } from '@quirenote/core/address';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

import { addressRefusal } from './apply';
import type { Challenge, Refusal, RelayAnswer, RelayCall } from './relay';
import type { Session } from './session';
import { cognitoTimestamp, passwordClaim, srpStart } from './srp';

export interface SignInDeps {
  relay: RelayCall;
  session: Session;
  /** The pool id after its underscore; SRP signs with it. */
  poolName: string | undefined;
  /** The OS passkey sheet: resolves with the assertion as JSON, rejects however it did not finish. */
  authenticate: (options: PublicKeyCredentialRequestOptionsJSON) => Promise<unknown>;
  /** Whether Cognito lists a passkey for the account just signed in; undefined when it cannot say. */
  hasPasskey: () => Promise<boolean | undefined>;
}

export type SignInRefusal =
  | 'emailMissing'
  | 'emailInvalid'
  | 'passwordMissing'
  | 'wrong'
  | 'notFinished'
  | 'rule'
  | 'reused'
  | 'expired'
  | 'botCheck'
  | 'tooMany'
  | 'offline'
  | 'failed';

/** The first sign-in's challenge, answered as it stands: its session, under the name the proof
 *  signed in as, which the relay's hash is over. */
export interface HeldChallenge {
  session: string;
  userId: string;
}

export type SignInOutcome =
  | { kind: 'signedIn'; offerPasskey: boolean }
  | { kind: 'password'; email: string }
  | { kind: 'newPassword'; email: string; held: HeldChallenge }
  | { kind: 'refused'; reason: SignInRefusal };

const signedIn = (offerPasskey: boolean): SignInOutcome => ({ kind: 'signedIn', offerPasskey });
const refused = (reason: SignInRefusal): SignInOutcome => ({ kind: 'refused', reason });

// A 401 blames nobody in particular: the relay answers a wrong password and an unknown address
// alike. Cognito's lockout is a 429, which an unknown address meets too.
const STEP: Record<Refusal, SignInRefusal> = {
  notAuthorized: 'wrong',
  botCheck: 'botCheck',
  // A passkey call's answer, which no sign-in step receives.
  googleSession: 'failed',
  invalid: 'failed',
  invalidPassword: 'failed',
  reusedPassword: 'failed',
  throttled: 'tooMany',
  offline: 'offline',
  failed: 'failed',
};
/** The first sign-in's own three. A history of 1 is the current password alone, so a reused one can
 *  only be the temporary password; the password was proven, so a 401 is the session running out. */
const NEW_PASSWORD: Record<Refusal, SignInRefusal> = {
  ...STEP,
  notAuthorized: 'expired',
  invalidPassword: 'rule',
  reusedPassword: 'reused',
};

/** The address first, as the pool offers no passkey without it. Safari before 17.4 opens the sheet
 *  only after one fetch and no other wait: the token is in hand, and nothing runs after the answer. */
export async function signInWithAddress(
  typed: string,
  botCheck: string,
  deps: SignInDeps,
  /** Shows the passkey step; `false` means the user has left the address, and no sheet opens. */
  onPasskey: (email: string) => boolean | void,
): Promise<SignInOutcome> {
  const email = canonicalAddress(typed);
  if (!email) return refused(addressRefusal(typed) ?? 'emailInvalid');

  const answer = await deps.relay('start', {
    USERNAME: email,
    PREFERRED_CHALLENGE: 'WEB_AUTHN',
    botCheck,
  });
  // No password was asked for, so a 401 names no wrong one: Cognito refuses some addresses at the
  // start. The relay checks no address pattern, so a 400 is a fault.
  if (answer.kind === 'refused') {
    return refused(answer.reason === 'notAuthorized' ? 'failed' : STEP[answer.reason]);
  }
  if (answer.kind !== 'challenge') return refused('failed');
  if (answer.challenge.challenge !== 'WEB_AUTHN') return { kind: 'password', email };

  let options: PublicKeyCredentialRequestOptionsJSON;
  try {
    options = JSON.parse(answer.challenge.parameters.CREDENTIAL_REQUEST_OPTIONS ?? '');
  } catch {
    return refused('failed');
  }
  if (onPasskey(email) === false) return refused('notFinished');
  return passkey(email, answer.challenge, options, deps);
}

async function passkey(
  email: string,
  challenge: Challenge,
  options: PublicKeyCredentialRequestOptionsJSON,
  deps: SignInDeps,
) {
  let credential: unknown;
  try {
    credential = await deps.authenticate(options);
  } catch {
    // Cancelled, timed out, or no passkey on this device for this address: WebAuthn answers all
    // three with one error on purpose, and an address with no account can be sent here too.
    return refused('notFinished');
  }
  const answer = await deps.session.respond({
    challenge: 'WEB_AUTHN',
    session: challenge.session,
    // Cognito's own name for the user where it gives one, as Amplify answers; else the address.
    responses: {
      USERNAME: challenge.parameters.USERNAME ?? email,
      CREDENTIAL: JSON.stringify(credential),
    },
  });
  // It has just used a passkey, so there is none to offer.
  if (answer.kind === 'tokens') return signedIn(false);
  if (answer.kind === 'refused') {
    return refused(answer.reason === 'notAuthorized' ? 'notFinished' : STEP[answer.reason]);
  }
  return refused('failed');
}

/** The password over SRP, so it never leaves the page, from a fresh start: the address step's
 *  session lives three minutes, and an expired one is refused like a wrong password. */
async function verified(
  email: string,
  password: string,
  botCheck: string,
  deps: SignInDeps,
): Promise<{ answer: RelayAnswer; userId: string } | SignInRefusal> {
  if (!deps.poolName) return 'failed';

  const { a, srpA } = srpStart();
  const start = await deps.relay('start', {
    USERNAME: email,
    PREFERRED_CHALLENGE: 'PASSWORD_SRP',
    SRP_A: srpA,
    botCheck,
  });
  if (start.kind === 'refused') return STEP[start.reason];
  if (start.kind !== 'challenge' || start.challenge.challenge !== 'PASSWORD_VERIFIER') {
    return 'failed';
  }

  const p = start.challenge.parameters;
  const userId = p.USER_ID_FOR_SRP ?? '';
  const timestamp = cognitoTimestamp();
  let signature: string;
  try {
    signature = await passwordClaim({
      a,
      poolName: deps.poolName,
      userId,
      password,
      srpB: p.SRP_B ?? '',
      salt: p.SALT ?? '',
      secretBlock: p.SECRET_BLOCK ?? '',
      timestamp,
    });
  } catch {
    return 'failed';
  }

  const answer = await deps.session.respond({
    challenge: 'PASSWORD_VERIFIER',
    session: start.challenge.session,
    responses: {
      USERNAME: userId,
      PASSWORD_CLAIM_SIGNATURE: signature,
      PASSWORD_CLAIM_SECRET_BLOCK: p.SECRET_BLOCK ?? '',
      TIMESTAMP: timestamp,
    },
  });
  return { answer, userId };
}

export async function signInWithPassword(
  email: string,
  password: string,
  botCheck: string,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  if (!password) return refused('passwordMissing');
  const proof = await verified(email, password, botCheck, deps);
  if (typeof proof === 'string') return refused(proof);
  const { answer, userId } = proof;
  // The relay asks Cognito with the access token this answer sealed, so only once it has landed;
  // an answer it cannot give offers nothing, and the offer comes back on the next sign-in.
  if (answer.kind === 'tokens') return signedIn((await deps.hasPasskey()) === false);
  if (answer.kind === 'refused') return refused(STEP[answer.reason]);
  // A temporary password: the first sign-in, where the account sets its own.
  if (answer.kind === 'challenge' && answer.challenge.challenge === 'NEW_PASSWORD_REQUIRED') {
    return { kind: 'newPassword', email, held: { session: answer.challenge.session, userId } };
  }
  return refused('failed');
}

/** The first sign-in's own password, answering the challenge the password step holds: no start, no
 *  token. A refusal leaves the session usable for its three minutes; empty fails the rule unasked. */
export async function setNewPassword(
  held: HeldChallenge,
  next: string,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  if (!next) return refused('rule');
  const answer = await deps.session.respond({
    challenge: 'NEW_PASSWORD_REQUIRED',
    session: held.session,
    responses: { USERNAME: held.userId, NEW_PASSWORD: next },
  });
  // Approval minted this account and it has never held an access token, so it has no passkey.
  if (answer.kind === 'tokens') return signedIn(true);
  if (answer.kind === 'refused') return refused(NEW_PASSWORD[answer.reason]);
  return refused('failed');
}
