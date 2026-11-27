import { Archive, Ellipsis, type LucideIcon, Users } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { matchPath, NavLink, useLocation } from 'react-router';

import { useSessionStatus, useSessionUnanswered } from '../auth/app';
import { useRole } from '../hooks/queries';
import { useT } from '../i18n/useT';
import { CornerBadge } from './CornerBadge';
import { NAV_TRIGGER_ID } from './nav-ids';
import { usePendingBadge, usersName } from './pending-count';
import { ANALYTICS, DOCKED } from './Sidebar';

type Tab = {
  to: string;
  key: (typeof ANALYTICS)[number]['key'] | 'archive' | 'users';
  Icon: LucideIcon;
};

// A user's four in the dock's order, from the route table, so a glyph is never picked twice.
const USER_TABS: Tab[] = DOCKED.map((to) => ANALYTICS.find((a) => a.to === to)!);
// The super-admin's two, in the rail's recipe of importing its own glyphs.
const ADMIN_TABS: Tab[] = [
  { to: '/admin/archive', key: 'archive', Icon: Archive },
  { to: '/admin/users', key: 'users', Icon: Users },
];

/** The routes the «Ще» sheet links to for each role, the dock's «Ще» current on any of them. */
function sheetRoutes(role: 'user' | 'admin' | 'none'): string[] {
  const account = role === 'none' ? [] : ['/profile'];
  const screens =
    role === 'user'
      ? [
          '/',
          '/transactions',
          ...ANALYTICS.filter((a) => !(DOCKED as readonly string[]).includes(a.to)).map(
            (a) => a.to,
          ),
        ]
      : [];
  return [...screens, '/settings', ...account];
}

/** Who the dock draws for. While `/me` is out it stands at a user's layout (E1); signed out, or a
 *  role with no screens, it is «Ще» alone. */
function useDockRole(): 'user' | 'admin' | 'none' | 'pending' {
  const role = useRole();
  const status = useSessionStatus();
  const unanswered = useSessionUnanswered();
  if (role === 'user') return 'user';
  if (role === 'super_admin') return 'admin';
  if (role !== undefined || (status === 'signedOut' && !unanswered)) return 'none';
  return 'pending';
}

// A tab: 48 tall at r12, so the dock's r18 is r12 + its 6 padding (*Shape system*). Every tab is at
// least a user tab's 63, and the grid's equal tracks give a short dock the widest label's width.
const TAB =
  'relative flex h-12 min-w-[63px] flex-col items-center justify-center gap-[3px] rounded-[12px] text-label whitespace-nowrap transition-control select-none active:scale-[.97]';
// The sidebar's active row turned on its side: the tint and a 2 px top edge, never colour alone
// (WCAG 1.4.1). Hover lives in the idle arm only, for the reason `pillClass` gives.
const ACTIVE =
  'bg-accent-tint font-bold text-ink shadow-[inset_0_2px_0_var(--color-sb-indicator),var(--focus-halo)]';
const IDLE = 'font-semibold text-sb-item hover:bg-sb-item-hover-bg hover:text-sb-item-hover';

function TabFace({
  Icon,
  label,
  isActive,
}: {
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
}) {
  return (
    <>
      <Icon
        size={20}
        strokeWidth={2}
        aria-hidden
        className={`flex-none transition-control-colors ${isActive ? 'text-accent' : 'text-sb-icon'}`}
      />
      <span>{label}</span>
    </>
  );
}

/** A tab's place while the role is unknown: a 20 block and a 36 × 8 bar in `ink` 7 %. */
function Placeholder() {
  return (
    <span data-placeholder aria-hidden className={`${TAB} pointer-events-none`}>
      <span className="size-5 rounded-[5px] bg-ink/7" />
      <span className="h-2 w-9 rounded-[2px] bg-ink/7" />
    </span>
  );
}

/**
 * The MOBILE shell's navigation (mobile-bar-and-sheet.md § Signed; open-values-shell-controls.md
 * § Signed, E1): the role's screens, then «Ще», the trigger of Layout's one dialog, the sheet. A
 * user's dock spans the width; a shorter one fits its tabs and is centred, easing between the two
 * where the browser can interpolate to `fit-content`. It rises at the first paint on the sheet's
 * motion; the reduced-motion kill-switch makes that instant.
 */
export function Dock() {
  const t = useT();
  const role = useDockRole();
  const { pathname } = useLocation();
  const badge = usePendingBadge();
  const tabs = role === 'user' ? USER_TABS : role === 'admin' ? ADMIN_TABS : [];
  const wide = role === 'user' || role === 'pending';
  // «Ще» is current on a route its sheet holds; on one nothing holds, not found, nothing is.
  const holds = sheetRoutes(role === 'pending' ? 'none' : role).some(
    (to) => matchPath({ path: to, end: to === '/' }, pathname) !== null,
  );

  return (
    <div className="pointer-events-none fixed right-[max(12px,env(safe-area-inset-right))] bottom-(--sheet-bottom) left-[max(12px,env(safe-area-inset-left))] z-30 flex animate-sheet-in justify-center [--sheet-bottom:calc(12px+env(safe-area-inset-bottom))]">
      <nav
        data-dock
        aria-label={t.nav.navigation}
        className={`pointer-events-auto grid auto-cols-fr grid-flow-col gap-0.5 rounded-[18px] glass p-1.5 text-ink transition-[width] duration-[260ms] ease-soft [interpolate-size:allow-keywords] ${wide ? 'w-full' : 'w-fit'}`}
      >
        {role === 'pending'
          ? [0, 1, 2, 3].map((i) => <Placeholder key={i} />)
          : tabs.map(({ to, key, Icon }) => {
              const users = to === '/admin/users';
              return (
                <NavLink
                  key={to}
                  to={to}
                  aria-label={users ? usersName(t, badge) : undefined}
                  className={({ isActive }) =>
                    `${TAB} animate-in duration-300 ease-soft fade-in ${isActive ? ACTIVE : IDLE}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <TabFace Icon={Icon} label={t.nav[key]} isActive={isActive} />
                      {users && badge !== undefined && (
                        <CornerBadge shown={badge.shown} top="top-1" />
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
        {/* `asChild`, so the button IS the trigger and Radix returns focus to it. Not
            `aria-current`: the page's own link in the sheet carries that, one current per set
            (WAI-ARIA 1.2), so the name says it, as Primer's overflow anchor does. */}
        <RadixDialog.Trigger asChild>
          <button
            type="button"
            id={NAV_TRIGGER_ID}
            data-current={holds || undefined}
            aria-label={holds ? t.nav.moreCurrent : undefined}
            className={`${TAB} ${holds ? ACTIVE : IDLE}`}
          >
            <TabFace Icon={Ellipsis} label={t.nav.more} isActive={holds} />
          </button>
        </RadixDialog.Trigger>
      </nav>
    </div>
  );
}
