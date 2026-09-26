import { canonicalAddress } from '@quirenote/core/address';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

import type { Challenge, Refusal, RelayCall } from './relay';
import type { Session } from './session';
import { cognitoTimestamp, passwordClaim, srpStart } from './srp';

export interface SignInDeps {
  relay: RelayCall;
  session: Session;
  /** The pool id after its underscore; SRP signs with it. */
  poolName: string | undefined;
  /** The OS passkey sheet: resolves with the assertion as JSON, rejects however it did not finish. */
  authenticate: (options: PublicKeyCredentialRequestOptionsJSON) => Promise<unknown>;
}

export type SignInRefusal =
  | 'emailMissing'
  | 'emailInvalid'
  | 'passwordMissing'
  | 'wrong'
  | 'notFinished'
  | 'tooMany'
  | 'offline'
  | 'failed';

export type SignInOutcome =
  | { kind: 'signedIn' }
  | { kind: 'password'; email: string }
  | { kind: 'refused'; reason: SignInRefusal };

const SIGNED_IN: SignInOutcome = { kind: 'signedIn' };
const refused = (reason: SignInRefusal): SignInOutcome => ({ kind: 'refused', reason });

// A 401 blames nobody in particular: the relay answers a wrong password and an unknown address
// alike. Cognito's lockout is a 429, which an unknown address meets too.
const STEP: Record<Refusal, SignInRefusal> = {
  notAuthorized: 'wrong',
  invalid: 'failed',
  throttled: 'tooMany',
  offline: 'offline',
  failed: 'failed',
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
  // No password was asked for, and the relay checks no address pattern: a 401 or a 400 is a fault.
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
  if (answer.kind === 'tokens') return SIGNED_IN;
  if (answer.kind === 'refused') {
    return refused(answer.reason === 'notAuthorized' ? 'notFinished' : STEP[answer.reason]);
  }
  return refused('failed');
}

/** The password over SRP, so it never leaves the page, from a fresh start: the address step's
 *  session lives three minutes, and an expired one is refused like a wrong password. */
export async function signInWithPassword(
  email: string,
  password: string,
  deps: SignInDeps,
): Promise<SignInOutcome> {
  if (!password) return refused('passwordMissing');
  if (!deps.poolName) return refused('failed');

  const { a, srpA } = srpStart();
  const start = await deps.relay('start', {
    USERNAME: email,
    PREFERRED_CHALLENGE: 'PASSWORD_SRP',
    SRP_A: srpA,
  });
  if (start.kind === 'refused') return refused(STEP[start.reason]);
  if (start.kind !== 'challenge' || start.challenge.challenge !== 'PASSWORD_VERIFIER') {
    return refused('failed');
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
    return refused('failed');
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
  if (answer.kind === 'tokens') return SIGNED_IN;
  if (answer.kind === 'refused') return refused(STEP[answer.reason]);
  // NEW_PASSWORD_REQUIRED, the first sign-in, is #272's to answer.
  return refused('failed');
}
