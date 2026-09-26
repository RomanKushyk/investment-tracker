import { WebAuthnAbortService, startAuthentication } from '@simplewebauthn/browser';
import { useSyncExternalStore } from 'react';

import type { Answer } from './access';
import { createApply } from './apply';
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

/** The application; the relay's host is the API's, so `/v1/applications` sits beside `/auth/*`. */
export const apply = createApply({
  base: environment?.relay,
  fetch: (input, init) => fetch(input, init),
});

/** One of the four refusals `answerOf` reads, and the address the caller signed in with. */
export interface HeldAnswer {
  answer: Answer;
  email?: string;
}

let held: HeldAnswer | undefined;
const hearing = new Set<() => void>();
const hear = (listener: () => void) => {
  hearing.add(listener);
  return () => void hearing.delete(listener);
};

/** Shows what the API told this caller in place of the route that asked. Memory only: the answer's
 *  own sign-out clears it and a reload forgets it, so what shows is an answer this page was given. */
export function showAnswer(next?: HeldAnswer) {
  held = next;
  for (const listener of hearing) listener();
}

export function useAnswer() {
  return useSyncExternalStore(hear, () => held);
}
