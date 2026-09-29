import {
  WebAuthnAbortService,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { useSyncExternalStore } from 'react';

import type { Answer } from './access';
import { createApply } from './apply';
import { environmentFor } from './environment';
import { beginGoogle } from './google';
import { type PasskeyDeps, createCognito, hasPasskey } from './passkey';
import { createRelay } from './relay';
import { createSession } from './session';
import type { SignInDeps } from './sign-in';
import { carrySignedOut, throughLogout } from './signed-out';

const environment = environmentFor(location.hostname);
const relay = createRelay({ base: environment?.relay, fetch: (input, init) => fetch(input, init) });

// Only an insecure context lacks Web Locks, and no environment is keyed to one, so every call there
// is refused before it is sent: no cookie is written, and there is nothing for a lock to order.
const unlocked = { request: (_: string, call: () => unknown) => call() } as unknown as LockManager;

/** This tab's session, tokens in memory only; the portfolio shell and `/sign-in` restore it. */
export const session = createSession({ relay, locks: navigator.locks ?? unlocked });

/** The account's own passkeys, through Cognito's endpoint in the pool's region, the id's prefix. */
export const passkeyDeps: PasskeyDeps = {
  cognito: createCognito({
    region: environment?.userPoolId.split('_')[0],
    fetch: (input, init) => fetch(input, init),
  }),
  getAccessToken: () => session.getAccessToken(),
  register: (optionsJSON) => startRegistration({ optionsJSON }),
};

export const signInDeps: SignInDeps = {
  relay,
  session,
  poolName: environment?.userPoolId.split('_')[1],
  authenticate: (optionsJSON) => startAuthentication({ optionsJSON }),
  hasPasskey: () => hasPasskey(passkeyDeps),
};

/** Closes a passkey sheet or dialog still open when its step is left. */
export const cancelPasskey = () => WebAuthnAbortService.cancelCeremony();

export function useSessionStatus() {
  return useSyncExternalStore(session.subscribe, session.status);
}

export function useSessionAddress() {
  return useSyncExternalStore(session.subscribe, session.address);
}

export function useSessionUnanswered() {
  return useSyncExternalStore(session.subscribe, session.unanswered);
}

/** Whether Google is on, once a refresh has said; until then the card shows the form alone. */
export function useGoogle() {
  return useSyncExternalStore(session.subscribe, session.google);
}

/** The authorize URL for this browser, from the relay, which keeps the flow's pair. */
export const startGoogle = () => beginGoogle(relay);

/** This tab's session storage, or none where the browser refuses it. */
export function tabStorage(): Storage | undefined {
  try {
    return sessionStorage;
  } catch {
    return undefined;
  }
}

/** A SIGN-OUT WHILE GOOGLE IS ON LEAVES THROUGH COGNITO'S LOGOUT, the only way its session cookie
 *  is cleared, to land on `to` on the listed site. False where there is no logout or no site. */
export function leaveThroughLogout(logout: string | undefined, to: '/sign-in' | '/apply'): boolean {
  const leaving = throughLogout(logout, environment?.site, location.origin, to);
  if (leaving === undefined) return false;
  if (leaving.carry) carrySignedOut(tabStorage());
  location.assign(leaving.url);
  return true;
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
