import { COUNT_PAGE, usePendingCount, useRole } from '../hooks/queries';
import type { Dict } from '../i18n/messages';

/** The applications waiting, as the nav draws them: none while the count's first read is out or
 *  failed or none wait, «99+» from a full page. */
export interface PendingBadge {
  /** The number drawn, `aria-hidden`: the link's or the trigger's name carries it. */
  shown: string;
  n: number;
  over: boolean;
}

export function usePendingBadge(): PendingBadge | undefined {
  const admin = useRole() === 'super_admin';
  const n = usePendingCount(admin);
  if (!admin || n === undefined || n === 0) return undefined;
  const over = n >= COUNT_PAGE;
  return { shown: over ? '99+' : String(n), n, over };
}

/** «Користувачі»'s name while applications wait, as Primer's CounterLabel reads the count through
 *  the link; none while none wait, the label naming the link. */
export const usersName = (t: Dict, badge: PendingBadge | undefined): string | undefined =>
  badge === undefined ? undefined : badge.over ? t.nav.usersCountOver : t.nav.usersCount(badge.n);

/** The trigger's name below md while the drawer is shut, the count in it. */
export const openNavName = (t: Dict, badge: PendingBadge | undefined): string =>
  badge === undefined
    ? t.nav.openNav
    : t.nav.openWithCount(badge.over ? t.nav.countOver : String(badge.n));
