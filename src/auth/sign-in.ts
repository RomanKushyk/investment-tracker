import { canonicalAddress } from '@quirenote/core/address';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

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
  | 'tooMany'
  | 'offline'
  | 'failed';

export type SignInOutcome =
  | { kind: 'signedIn'; offerPasskey: boolean }
  | { kind: 'password'; email: string }
  | { kind: 'newPassword'; email: string }
  | { kind: 'refused'; reason: SignInRefusal };

const signedIn = (offerPasskey: boolean): SignInOutcome => ({ kind: 'signedIn', offerPasskey });
const refused = (reason: SignInRefusal): SignInOutcome => ({ kind: 'refused', reason });

// A 401 blames nobody in particular: the relay answers a wrong password and an unknown address
// alike. Cognito's lockout is a 429, which an unknown address meets too.
const STEP: Record<Refusal, SignInRefusal> = {
  notAuthorized: 'wrong',
  invalid: 'failed',
  invalidPassword: 'failed',
  reusedPassword: 'failed',
  throttled: 'tooMany',
  offline: 'offline',
  failed: 'failed',
};
/** The first sign-in's own two. A history of 1 is the current password alone, so a reused one can
 *  only be the temporary password. */
const NEW_PASSWORD: Record<Refusal, SignInRefusal> = {
  ...STEP,
  invalidPassword: 'rule',
  reusedPassword: 'reused',
};

/** The address first, as the pool offers no passkey without it. Safari before 17.4 opens the sheet
 *  only after one fetch and no other wait, so nothing runs between the answer and `authenticate`. */
export async function signInWithAddress(
  typed: string,
  deps: SignInDeps,
  /** Shows the passkey step; `false` means the user has left the address, and no sheet opens. */
  onPasskey: (email: string) => boolean | void,
): Promise<SignInOutcome> {
  if (!typed.trim()) return refused('emailMissing');
  const email = canonicalAddress(typed);
  if (!email) return refused('emailInvalid');

  const answer = await deps.relay('start', { USERNAME: email, PREFERRED_CHALLENGE: 'WEB_AUTHN' });
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
  deps: SignInDeps,
): Promise<{ answer: RelayAnswer; userId: string } | SignInRefusal> {
  if (!deps.poolName) return 'failed';

  const { a, srpA } = srpStart();
  const start = await deps.relay('start', {
    USERNAME: email,
    PREFERRED_CHALLENGE: 'PASSWORD_SRP',
    SRP_A: srpA,
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
  deps: SignInDeps,
): Promise<SignInOutcome> {
  if (!password) return refused('passwordMissing');
  const proof = await verified(email, password, deps);
  if (typeof proof === 'string') return refused(proof);
  const { answer } = proof;
  // The relay asks Cognito with the access token this answer sealed, so only once it has landed;
  // an answer it cannot give offers nothing, and the offer comes back on the next sign-in.
  if (answer.kind === 'tokens') return signedIn((await deps.hasPasskey()) === false);
  if (answer.kind === 'refused') return refused(STEP[answer.reason]);
  // A temporary password: the first sign-in, where the account sets its own.
  if (answer.kind === 'challenge' && answer.challenge.challenge === 'NEW_PASSWORD_REQUIRED') {
    return { kind: 'newPassword', email };
  }
  return refused('failed');
}

/** The first sign-in's own password, answering a fresh proof of the temporary one, whose challenge
 *  lives three minutes too. Empty fails the pool's rule before anything is asked. */
export async function setNewPassword(
  email: string,
  temporary: string,
  next: string,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  if (!next) return refused('rule');
  const proof = await verified(email, temporary, deps);
  if (typeof proof === 'string') return refused(proof);
  const { answer: first, userId } = proof;
  if (first.kind === 'refused') return refused(STEP[first.reason]);
  if (first.kind !== 'challenge' || first.challenge.challenge !== 'NEW_PASSWORD_REQUIRED') {
    return refused('failed');
  }

  const answer = await deps.session.respond({
    challenge: 'NEW_PASSWORD_REQUIRED',
    session: first.challenge.session,
    // The name the proof signed in as, which the relay's hash is over.
    responses: { USERNAME: userId, NEW_PASSWORD: next },
  });
  // Approval minted this account and it has never held an access token, so it has no passkey.
  if (answer.kind === 'tokens') return signedIn(true);
  if (answer.kind === 'refused') return refused(NEW_PASSWORD[answer.reason]);
  return refused('failed');
}
