import type { SessionStatus } from '../auth/session';

/**
 * What the footer band draws for the account. HELD until the relay answers — while the session is
 * unknown, and after a load it never answered: the band is anchored to the bottom and grows upward,
 * so rows that appeared on a later answer would move every target above them (*Interaction
 * rules*). A sign-out keeps the signed-in rows while the page leaves, or they would change under
 * the pointer that pressed. Closed only where there is no auth environment, so never held there.
 */
export function accountRows(
  status: SessionStatus,
  leaving: boolean,
  unanswered: boolean,
  environment: boolean,
): 'held' | 'shown' | 'entry' | 'closed' {
  if (status === 'signedIn' || leaving) return 'shown';
  if (!environment) return 'closed';
  return status === 'unknown' || unanswered ? 'held' : 'entry';
}
