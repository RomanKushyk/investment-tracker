/** The pages a signed-out visitor is on: a sign-in never returns to one. */
const SIGNED_OUT_PAGES = ['/sign-in', '/apply', '/auth/callback'];

/** Where a sign-in returns: `value` if it parses as an app path on `origin`, else `/`; never
 *  prefix-matched, since the URL parser reads `//host` and `/\host` as another host (OWASP). */
export function returnTarget(value: unknown, origin: string): string {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/';
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return '/';
  }
  if (url.origin !== origin) return '/';
  // Compared as the router matches it: decoded and in any case.
  let page: string;
  try {
    page = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, '') || '/';
  } catch {
    return '/';
  }
  if (SIGNED_OUT_PAGES.includes(page)) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The router state a shell route sends `/sign-in`: the place, and whether the tab's session ended. */
export function sentToSignIn(from: string, ended: boolean) {
  return ended ? { from, ended: true } : { from };
}

/** The place that state carries, unchecked: `returnTarget` reads it. */
export function carriedFrom(state: unknown): string | undefined {
  return typeof state === 'object' &&
    state !== null &&
    'from' in state &&
    typeof state.from === 'string'
    ? state.from
    : undefined;
}

/** True only for the state a shell route sends when the session this tab held ended. */
export function arrivedEnded(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'ended' in state && state.ended === true;
}

/** THE PLACE ACROSS GOOGLE'S ROUND TRIP, which router state cannot follow; this tab's storage does. */
export const RETURN_TO = 'quirenote-return-to';
type Tab = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Keeps `target` for the return; `/`, where the return lands anyway, forgets an older one. */
export function carryReturn(tab: Tab | undefined, target: string): void {
  try {
    if (target === '/') tab?.removeItem(RETURN_TO);
    else tab?.setItem(RETURN_TO, target);
  } catch {
    // Storage refused: the return lands on `/`.
  }
}

/** The place the tab carries, checked as router state is, or `/`. */
export function returnedTarget(tab: Tab | undefined, origin: string): string {
  try {
    return returnTarget(tab?.getItem(RETURN_TO), origin);
  } catch {
    return '/';
  }
}

export function forgetReturn(tab: Tab | undefined): void {
  try {
    tab?.removeItem(RETURN_TO);
  } catch {
    // Nothing was kept where nothing can be.
  }
}
