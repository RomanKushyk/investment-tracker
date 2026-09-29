import type { Path } from 'react-router';

/** What a finished sign-out hands `/sign-in` as router state, so the page can say so. */
export const SIGNED_OUT = { signedOut: true } as const;

/** True only for the state a sign-out navigates with. */
export function arrivedSignedOut(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'signedOut' in state && state.signedOut === true
  );
}

/** THE FACT ACROSS COGNITO'S LOGOUT, which loads `/sign-in` afresh from another origin where router
 *  state cannot follow. This tab's session storage does; the page forgets it once it has read it. */
const RETURNING = 'quirenote-signed-out';
type Tab = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function carrySignedOut(tab: Tab | undefined): void {
  try {
    tab?.setItem(RETURNING, '1');
  } catch {
    // Storage refused (a private window, blocked site data): the page arrives without the line.
  }
}

export function returnedSignedOut(tab: Tab | undefined): boolean {
  try {
    return tab?.getItem(RETURNING) === '1';
  } catch {
    return false;
  }
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
 *  the site Cognito lands on, storage being the origin's. Nothing without a logout or a site. */
export function throughLogout(
  logout: string | undefined,
  site: string | undefined,
  origin: string,
  to: string,
): { url: string; carry: boolean } | undefined {
  if (logout === undefined || site === undefined) return undefined;
  return { url: logoutFor(logout, site, to), carry: to === '/sign-in' && origin === site };
}

/** The same entry carrying nothing. Router state lives in `history.state`, which the browser hands
 *  back on a reload and Back/Forward, so the page replaces its entry the moment it arrives. */
export function usedUp({
  pathname,
  search,
  hash,
}: Path): [Partial<Path>, { replace: true; state: null }] {
  return [
    { pathname, search, hash },
    { replace: true, state: null },
  ];
}
