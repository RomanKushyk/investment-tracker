import {
  Archive,
  ArrowDownUp,
  CalendarDays,
  CircleUser,
  LogIn,
  LogOut,
  type LucideIcon,
  Settings,
  Shield,
  Users,
} from 'lucide-react';
import { Link, NavLink } from 'react-router';

import { useSessionAddress } from '../auth/app';
import { useRole } from '../hooks/queries';
import { useSignOut } from '../hooks/useSignOut';
import { AccountFold, ANALYTICS, Mark } from './Sidebar';
import { NAV_TRIGGER_ID } from './nav-ids';
import { CornerBadge } from './CornerBadge';
import { usePendingBadge, usersName } from './pending-count';
import { Scroller } from '../components/ui/Scroller';
import { Tooltip, TooltipProvider } from '../components/ui/Tooltip';
import { useSettings } from '../state/settings';
import { useT } from '../i18n/useT';

/**
 * THE THIRD GEOMETRY, and *Two shells, one breakpoint* rejected one — for the
 * mobile job. This rail's job is desktop density: navigation one press away
 * while 188 px go back to the content, which is a job the drawer never had.
 *
 * It imports the route table rather than restating it, and `Sidebar.tsx` does
 * NOT import this file back — the shell takes it as `children`, which is what
 * keeps the two out of an import cycle.
 */

/** The two the panel writes inline above its groups; Settings is in the foot,
 *  and the other eight come from `ANALYTICS`. */
const ENTRY = [
  { to: '/', key: 'dailyQuotes', Icon: CalendarDays },
  { to: '/transactions', key: 'transactions', Icon: ArrowDownUp },
] as const;

/**
 * One item, and the drawn box is 44 × 44 at radius 12, the hit areas touching (O3,
 * rail-and-account-foot.md § Signed).
 *
 * THE RADIUS IS SPENT TWICE, on the link and on the box inside it. The link is
 * the focusable element, so it is the link the focus outline follows; without
 * the radius there the ring is a square around a rounded item.
 *
 * The label is the accessible NAME and also the tooltip's text. Radix names
 * nothing — it describes — so without the `aria-label` an item announces as a
 * bare "link".
 *
 * The state comes from `NavLink`'s own `isActive`, not from a second
 * `matchPath` beside it: the router already computes that predicate for the
 * `aria-current` it emits, and a hand-written copy agrees only until a nested
 * route or a router upgrade moves one of them.
 *
 * IT ARRIVES THROUGH THE CHILDREN FUNCTION AND NEVER THROUGH `className`.
 * `Tooltip` wraps this in a Radix `Trigger asChild`, whose `Slot` merges props
 * onto the child by JOINING className strings — handed a function it stringifies
 * it, and the attribute becomes the source text of the callback, silently, with
 * the markup still reading correctly. A plain string on the link and the state
 * on an inner box is what survives the merge.
 */
function RailItem({
  to,
  label,
  tooltip = label,
  Icon,
  badge,
}: {
  to: string;
  label: string;
  /** The tooltip's words, where they are not the name. */
  tooltip?: string;
  Icon: LucideIcon;
  /** A number at the box's corner, where no label shows; the name carries it. */
  badge?: string;
}) {
  return (
    <Tooltip label={tooltip}>
      {/* As wide as the box, so its ring and its hit area are the item's. */}
      <NavLink to={to} aria-label={label} className="mx-auto block w-11 rounded-[12px]">
        {({ isActive }) => <RailBox Icon={Icon} isActive={isActive} badge={badge} />}
      </NavLink>
    </Tooltip>
  );
}

/** The drawn box and its glyph, shared by the links and the sign-out so the two cannot drift.
 *  Active as the panel's row: the tint, the inset indicator and an `accent` glyph. */
function RailBox({
  Icon,
  isActive = false,
  badge,
}: {
  Icon: LucideIcon;
  isActive?: boolean;
  badge?: string;
}) {
  return (
    <span
      className={`relative grid size-11 place-items-center rounded-[12px] transition-control ${
        isActive
          ? 'bg-accent-tint shadow-[inset_2px_0_0_var(--color-sb-indicator)]'
          : 'hover:bg-sb-item-hover-bg'
      }`}
    >
      <Icon
        size={20}
        strokeWidth={2}
        aria-hidden
        className={`flex-none transition-control-colors ${isActive ? 'text-accent' : 'text-sb-icon'}`}
      />
      {/* Inside the box, since the rail clips past its wall. */}
      {badge !== undefined && <CornerBadge shown={badge} top="top-[2px]" />}
    </span>
  );
}

/** The super-admin's group folded: «Користувачі», its count at the corner, then «Архів цін». */
function AdminRail() {
  const t = useT();
  const badge = usePendingBadge();
  return (
    <>
      <RailItem
        to="/admin/users"
        label={usersName(t, badge) ?? t.nav.users}
        tooltip={t.nav.users}
        Icon={Users}
        badge={badge?.shown}
      />
      <RailItem to="/admin/archive" label={t.nav.archive} Icon={Archive} />
    </>
  );
}

/**
 * The foot band's LAST item, the panel's «Вийти» in the rail's recipe: an action and never a
 * route, so it takes no tint and no indicator. Held as the panel's rows are. The button carries
 * the radius for the same reason the link does: the focus ring follows it. Signed out, «Увійти»,
 * a plain `Link` for the panel's reason, with hover only, as its neighbours.
 */
function RailAccount({ rows, leaving, leave }: SignOut) {
  const t = useT();
  return (
    <AccountFold rows={rows}>
      {rows === 'entry' ? (
        <Tooltip label={t.auth.signInEntry}>
          <Link
            to="/sign-in"
            aria-label={t.auth.signInEntry}
            className="mx-auto block w-11 rounded-[12px]"
          >
            <RailBox Icon={LogIn} />
          </Link>
        </Tooltip>
      ) : (
        <Tooltip label={t.auth.signOut}>
          <button
            type="button"
            aria-label={t.auth.signOut}
            aria-disabled={leaving || undefined}
            onClick={() => void leave()}
            className="mx-auto block w-11 rounded-[12px] transition-control aria-disabled:opacity-70"
          >
            <RailBox Icon={LogOut} />
          </button>
        </Tooltip>
      )}
    </AccountFold>
  );
}

/**
 * The profile, after Settings, in a fold of its own on the account's rows: held, empty and inert,
 * at the signed-in height until the relay answers. Signed out it is not drawn, and «Увійти» alone
 * stands in the foot (O3, rail-and-account-foot.md § Signed). Named as the panel's link, with the
 * address alone in its tooltip.
 */
function RailProfile({ rows }: Pick<SignOut, 'rows'>) {
  const t = useT();
  const address = useSessionAddress();
  return rows === 'entry' ? null : (
    <AccountFold rows={rows}>
      <div data-rail-profile>
        <RailItem
          to="/profile"
          label={address === undefined ? t.profile.title : t.auth.profileLink(address)}
          tooltip={address ?? t.profile.title}
          Icon={CircleUser}
        />
      </div>
    </AccountFold>
  );
}

type SignOut = ReturnType<typeof useSignOut>;

/**
 * The super-admin's band, folded: a 40 tall strip under the menu across the card's inner width, on
 * `accent-tint`, the shield 18 in `accent` (O3 and § Wave 29, rail-and-account-foot.md). The card
 * pays the safe area outside itself, so the strip has none to bleed under. The rail has no room for the word,
 * so a screen reader reads it as the strip's text and a resting pointer shows it as the items'
 * tooltips show theirs; the strip is no control, so it takes no focus.
 */
function RailRoleBand() {
  const t = useT();
  return (
    <Tooltip label={t.nav.superAdmin}>
      <div className="grid h-10 w-full flex-none place-items-center self-start bg-accent-tint">
        <Shield size={18} strokeWidth={2} aria-hidden className="text-accent" />
        <span className="sr-only">{t.nav.superAdmin}</span>
      </div>
    </Tooltip>
  );
}

export function SidebarRail({ onExpand }: { onExpand: () => void }) {
  const t = useT();
  const currency = useSettings((s) => s.currency);
  // Neither role's items until `GET /me` names one, and none for any other role; meanwhile the foot
  // is held as a user's, so a user's rail never moves.
  const role = useRole();
  const admin = role === 'super_admin';
  // ONE SIGN-OUT FOR THE FOOT: its latch is the hook's, so the profile reads the rows the pressed
  // «Вийти» does and stays the signed-in link while the page leaves.
  const signOut = useSignOut();

  return (
    <TooltipProvider>
      {/* Padded 8 / 0 and no gaps (O3, rail-and-account-foot.md § Signed): the plate, the menu,
          the items and the foot stack edge to edge, so their hit areas touch without overlapping. */}
      <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto] py-2">
        {/* THE MENU IS THE RAIL'S, and the header at this width has none: a
            control that expands the rail belongs to the rail. `NAV_TRIGGER_ID`
            moves here so the focus handoff still finds it by id; the two never
            share a screen, so the id stays unique.
            NO `aria-expanded` / `aria-controls`, unlike the header's copy: this
            control is INSIDE `#app-sidebar` and the region is on screen around
            it, so announcing it collapsed would be false and pointing
            `aria-controls` at an ancestor is not a relationship to act on. The
            rail is a state of the shell, not a disclosure.
            A 44 item like its neighbours, with their hover, under the 40 plate (the owner's
            ruling on #720). The bars are 14 × 12, not the header's 18 × 12: three solid bars at
            18 read as the heaviest thing in a rail of outline glyphs. */}
        <div className="flex flex-col items-center">
          <Mark size={40} />
          <button
            type="button"
            id={NAV_TRIGGER_ID}
            onClick={onExpand}
            aria-label={t.nav.expandNav}
            className="grid size-11 place-items-center rounded-[12px] text-sb-item transition-control hover:bg-sb-item-hover-bg hover:text-sb-item-hover"
          >
            <span aria-hidden className="flex h-3 w-[14px] flex-col justify-between">
              <span className="h-[2px] rounded-[1px] bg-current" />
              <span className="h-[2px] rounded-[1px] bg-current" />
              <span className="h-[2px] rounded-[1px] bg-current" />
            </span>
          </button>
          {admin && <RailRoleBand />}
        </div>

        {/* `overlay` BECAUSE THE RAIL'S COLUMN CANNOT SPARE THE RESERVE. Every other
            Scroller reserves the bar's strip so no row is read through it; a rail
            item's ink is one centred glyph, the floating bar clears it, and reserving
            here would take the gutter out of the item itself. The prop carries the whole of
            it, the ring allowance included — this band adds nothing back.
            `min-w-0` beside `min-h-0` per *Scrolling*: a grid item's automatic
            minimum is its content, so without it the column cannot shrink. `px-1` pays the
            overlay's `-mx-1` back inside the unpadded rail, so the bar floats within its 64. */}
        <div className="min-h-0 min-w-0 px-1">
          <Scroller overlay>
            {role !== 'user' && !admin ? null : (
              <div key={role} className="flex animate-in flex-col duration-300 ease-soft fade-in">
                {admin ? (
                  <AdminRail />
                ) : (
                  <>
                    {ENTRY.map(({ to, key, Icon }) => (
                      <RailItem key={to} to={to} label={t.nav[key]} Icon={Icon} />
                    ))}
                    <div className="mx-auto my-[2px] w-7 border-t border-hairline" />
                    {ANALYTICS.map(({ to, key, Icon }) => (
                      <RailItem key={to} to={to} label={t.nav[key]} Icon={Icon} />
                    ))}
                  </>
                )}
              </div>
            )}
          </Scroller>
        </div>

        {/* THE PANEL'S ORDER: the currency above Settings, as its track sits above
            Settings in the panel, then the profile and the account last
            (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md`
            § Signed). On the rail's own surface, with no band of its own. */}
        <div>
          {/* `sr-only` and not `aria-label`: a bare div is `role=generic`, which
              ARIA-in-HTML forbids naming, so the label was dropped and the box
              announced as a bare glyph. The same idiom the expanded track uses,
              and for the same reason.
              The super-admin has no currency. */}
          {!admin && (
            <div
              className={`mx-auto grid h-8 w-10 place-items-center rounded-[9px] border border-field-border text-body font-semibold text-ink ${role !== 'user' ? 'invisible' : ''}`}
            >
              {currency === 'UAH' ? '₴' : '$'}
              <span className="sr-only">{t.nav.currencyShown(currency)}</span>
            </div>
          )}
          <RailItem to="/settings" label={t.nav.settings} Icon={Settings} />
          <RailProfile rows={signOut.rows} />
          <RailAccount {...signOut} />
        </div>
      </div>
    </TooltipProvider>
  );
}
