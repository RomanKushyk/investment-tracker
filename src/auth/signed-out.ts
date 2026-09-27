import type { Path } from 'react-router';

/** What a finished sign-out hands `/sign-in` as router state, so the page can say so. */
export const SIGNED_OUT = { signedOut: true } as const;

/** True only for the state a sign-out navigates with. */
export function arrivedSignedOut(state: unknown): boolean {
  return (
    typeof state === 'object' && state !== null && 'signedOut' in state && state.signedOut === true
  );
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
