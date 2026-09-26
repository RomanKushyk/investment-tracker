import { WebAuthnAbortService, startAuthentication } from '@simplewebauthn/browser';
import { useSyncExternalStore } from 'react';

import { environmentFor } from './environment';
import { createRelay } from './relay';
import { createSession } from './session';
import type { SignInDeps } from './sign-in';

const environment = environmentFor(location.hostname);
const relay = createRelay({ base: environment?.relay, fetch: (input, init) => fetch(input, init) });

// Only an insecure context lacks Web Locks, and no environment is keyed to one, so every call there
// is refused before it is sent: no cookie is written, and there is nothing for a lock to order.
const unlocked = { request: (_: string, call: () => unknown) => call() } as unknown as LockManager;

/** This tab's session, tokens in memory only; `/sign-in` restores it. */
export const session = createSession({ relay, locks: navigator.locks ?? unlocked });

export const signInDeps: SignInDeps = {
  relay,
  session,
  poolName: environment?.userPoolId.split('_')[1],
  authenticate: (optionsJSON) => startAuthentication({ optionsJSON }),
};

/** Closes a passkey sheet still open when its step is left. */
export const cancelPasskey = () => WebAuthnAbortService.cancelCeremony();

export function useSessionStatus() {
  return useSyncExternalStore(session.subscribe, session.status);
}
