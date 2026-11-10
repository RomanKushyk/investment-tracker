import type { Path } from 'react-router';

import { isDay } from './relay';
import { carriedFrom } from './return-to';

/** What a finished sign-out hands `/sign-in` as router state, so the page can say so. */
export const SIGNED_OUT = { signedOut: true } as const;

/** Why the page is signed out: a sign-out, or the account deleted now or held until `date`'s end,
 *  whose landing says so in its place. */
export type SignedOutCause =
  { kind: 'signedOut' } | { kind: 'deleted' } | { kind: 'scheduled'; date: string };

/** The state a deletion's sign-out navigates with. */
export function signedOutBy(cause: SignedOutCause) {
  return cause.kind === 'scheduled'
    ? { ...SIGNED_OUT, cause: cause.kind, date: cause.date }
    : { ...SIGNED_OUT, cause: cause.kind };
}

/** True only for the state a sign-out navigates with. */
export function arrivedSignedOut(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'signedOut' in state && state.signedOut === true
  );
}

/** The cause that state names; any it cannot read in full is a plain sign-out's. */
export function causeOf(state: unknown): SignedOutCause {
  if (typeof state !== 'object' || state === null || !('cause' in state)) {
    return { kind: 'signedOut' };
  }
  if (state.cause === 'deleted') return { kind: 'deleted' };
  const date = 'date' in state ? state.date : undefined;
  return state.cause === 'scheduled' && isDay(date)
    ? { kind: 'scheduled', date }
    : { kind: 'signedOut' };
}

/** THE FACT ACROSS COGNITO'S LOGOUT, which loads `/sign-in` afresh from another origin where router
 *  state cannot follow. This tab's session storage does; the page forgets it once it has read it. */
export const RETURNING = 'quirenote-signed-out';
type Tab = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// The value names the cause: `1` a sign-out's, `deleted`, or `scheduled:<yyyy-MM-dd>`.
const valueOf = (cause: SignedOutCause) =>
  cause.kind === 'signedOut'
    ? '1'
    : cause.kind === 'deleted'
      ? 'deleted'
      : `scheduled:${cause.date}`;

function causeIn(value: string | null | undefined): SignedOutCause | undefined {
  if (value === '1') return { kind: 'signedOut' };
  if (value === 'deleted') return { kind: 'deleted' };
  const date = value?.startsWith('scheduled:') ? value.slice('scheduled:'.length) : undefined;
  return isDay(date) ? { kind: 'scheduled', date } : undefined;
}

export function carrySignedOut(
  tab: Tab | undefined,
  cause: SignedOutCause = { kind: 'signedOut' },
): void {
  try {
    tab?.setItem(RETURNING, valueOf(cause));
  } catch {
    // Storage refused (a private window, blocked site data): the page arrives without the line.
  }
}

/** The cause the tab carries, or none. */
export function returnedCause(tab: Tab | undefined): SignedOutCause | undefined {
  try {
    return causeIn(tab?.getItem(RETURNING));
  } catch {
    return undefined;
  }
}

export function returnedSignedOut(tab: Tab | undefined): boolean {
  return returnedCause(tab) !== undefined;
}

export function forgetSignedOut(tab: Tab | undefined): void {
  try {
    tab?.removeItem(RETURNING);
  } catch {
    // Nothing was kept where nothing can be.
  }
}

/** Cognito's logout, sent on to `to` on the listed site: it redirects only to "an authorized
 *  sign-out URL for the app client". */
export function logoutFor(logout: string, site: string, to: string): string {
  const url = new URL(logout);
  url.searchParams.set('logout_uri', `${site}${to}`);
  return url.href;
}

/** Where a sign-out leaves for through that logout, and whether this tab carries the fact: only on
 *  the site Cognito lands on, storage being the origin's. Nothing without a logout or a site, and
 *  nothing through a logout that is no URL: the sign-out goes its own way to `to` instead. */
export function throughLogout(
  logout: string | undefined,
  site: string | undefined,
  origin: string,
  to: string,
): { url: string; carry: boolean } | undefined {
  if (logout === undefined || site === undefined) return undefined;
  // A throw, not `URL.canParse`, which the Safari 16 the build targets lacks.
  let url: string;
  try {
    url = logoutFor(logout, site, to);
  } catch {
    return undefined;
  }
  return { url, carry: to === '/sign-in' && origin === site };
}

/** The same entry carrying only the place a sign-in returns to: the browser hands `history.state`
 *  back on a reload and Back/Forward, so the page replaces its entry the moment it arrives. */
export function usedUp({
  pathname,
  search,
  hash,
  state,
}: Path & { state?: unknown }): [Partial<Path>, { replace: true; state: null | { from: string } }] {
  const from = carriedFrom(state);
  return [
    { pathname, search, hash },
    { replace: true, state: from === undefined ? null : { from } },
  ];
}
