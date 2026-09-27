import type { SessionStatus } from '../auth/session';

/**
 * What the footer band draws for the account. HELD until the relay answers — while the session is
 * unknown, and after a load it never answered: the band is anchored to the bottom and grows upward,
 * so rows that appeared on a later answer would move every target above them (*Interaction
 * rules*). A sign-out that succeeded keeps them until the route changes, or they would close under
 * the pointer that pressed.
 */
export function accountRows(
  status: SessionStatus,
  leaving: boolean,
  unanswered: boolean,
): 'held' | 'shown' | 'closed' {
  if (status === 'signedIn' || leaving) return 'shown';
  return status === 'unknown' || unanswered ? 'held' : 'closed';
}
