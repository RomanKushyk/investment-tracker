import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';

import type { Passkey, RelayAnswer, RelayCall } from './relay';

export interface PasskeyDeps {
  /** The relay, which holds the access token these calls take (*Auth model*). */
  relay: RelayCall;
  /** The account this tab shows, refreshed first when under a minute is left; undefined when signed
   *  out. The relay acts for it alone, whatever another tab has since signed in as. */
  account: () => Promise<string | undefined>;
  /** The OS dialog that makes a passkey: resolves with it as JSON, rejects however it did not. */
  register: (options: PublicKeyCredentialCreationOptionsJSON) => Promise<unknown>;
}

/** The account's passkeys as the relay lists them; `google` for a Google sign-in's token, which
 *  cannot read them; `failed` for every other answer, nobody signed in included. */
export type PasskeyList = { kind: 'passkeys'; passkeys: Passkey[] } | { kind: 'google' | 'failed' };

export async function listPasskeys(deps: PasskeyDeps): Promise<PasskeyList> {
  const sub = await deps.account();
  if (sub === undefined) return { kind: 'failed' };
  const answer = await deps.relay('passkey/list', { sub });
  if (answer.kind === 'passkeys') return answer;
  return answer.kind === 'refused' && answer.reason === 'googleSession'
    ? { kind: 'google' }
    : { kind: 'failed' };
}

/** Whether the relay lists a passkey for the signed-in account; undefined when it cannot say. */
export async function hasPasskey(deps: PasskeyDeps): Promise<boolean | undefined> {
  const list = await listPasskeys(deps);
  return list.kind === 'passkeys' ? list.passkeys.length > 0 : undefined;
}

export type Registration = 'created' | 'notCreated' | 'offline' | 'failed';

const refusedAs = (answer: RelayAnswer): 'offline' | 'failed' =>
  answer.kind === 'refused' && answer.reason === 'offline' ? 'offline' : 'failed';

/** Start, the OS dialog, complete. While the session is fresh, as after a sign-in, Start is the one
 *  fetch before the dialog: Safari before 17.4 opens it only after one fetch and no other wait. */
export async function addPasskey(
  deps: PasskeyDeps,
  /** `false` once the offer has been left, and no dialog opens. */
  stillHere: () => boolean,
): Promise<Registration> {
  const sub = await deps.account();
  if (sub === undefined) return 'failed';
  const start = await deps.relay('passkey/start', { sub });
  if (start.kind !== 'options') return refusedAs(start);
  if (!stillHere()) return 'notCreated';

  let credential: unknown;
  try {
    credential = await deps.register(
      start.options as unknown as PublicKeyCredentialCreationOptionsJSON,
    );
  } catch {
    // Cancelled, timed out, or nowhere to keep one: WebAuthn does not tell them apart.
    return 'notCreated';
  }
  const done = await deps.relay('passkey/complete', { sub, credential });
  return done.kind === 'registered' ? 'created' : refusedAs(done);
}
