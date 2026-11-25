import {
  Archive,
  ArrowDownUp,
  CalendarDays,
  CalendarRange,
  ChartLine,
  ChartPie,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  CircleUser,
  LayoutGrid,
  LogIn,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  Settings,
  Shield,
  Sun,
  Table,
  Tags,
  Users,
  Wallet,
} from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { Children, Fragment, isValidElement, type ReactNode, useEffect, useRef } from 'react';
import { Link, matchPath, NavLink, useLocation } from 'react-router';

import { useSessionAddress } from '../auth/app';
import { useRole } from '../hooks/queries';
import { useSignOut } from '../hooks/useSignOut';
import { useT } from '../i18n/useT';
import type { accountRows } from './account-rows';
import { LEGAL_LINKS } from './legal-links';
import { usePendingBadge, usersName } from './pending-count';
import { SIDEBAR_COLLAPSE_ID, SIDEBAR_ID } from './nav-ids';
import { THEME_ORDER, useSettings, type Theme } from '../state/settings';
import { useCapitalCard } from '../hooks/useCapitalCard';
import { Scroller } from '../components/ui/Scroller';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { TAP_44 } from '../components/ui/tap-target';
import { keepOpenForToasts } from '../components/ui/toaster-press';

// Route -> dictionary KEY: the key is language-independent, so the list stays a
// constant and the compiler checks it against the dictionary.
export const ANALYTICS = [
  { to: '/overview', key: 'overview', Icon: LayoutGrid },
  { to: '/balances', key: 'balances', Icon: Wallet },
  { to: '/payouts', key: 'payouts', Icon: CircleDollarSign },
  { to: '/yield', key: 'yield', Icon: ChartLine },
  { to: '/attributes', key: 'attributes', Icon: Tags },
  { to: '/seasonality', key: 'seasonality', Icon: CalendarRange },
  { to: '/portfolio', key: 'portfolio', Icon: Table },
  { to: '/allocation', key: 'allocation', Icon: ChartPie },
] as const;

// The plate's corner is round(side × 0.26) (*Shape system*) and the «q» is 22/40 of the side.
const PLATE = {
  40: { plate: 'size-[40px] rounded-[10px]', q: 'size-[22px]' },
  28: { plate: 'size-[28px] rounded-[7px]', q: 'size-[15px]' },
} as const;

// The logo: the «q» knocked into its plate, the counter showing the plate. `aria-hidden`
// because the wordmark beside it says the brand. KEEP THIS THE ONLY INLINE SVG IN THE FILE:
// mark.test.ts reads every path in this source as the logo's. *Brand*
export function Mark({ size }: { size: keyof typeof PLATE }) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center bg-logo-outline ${PLATE[size].plate}`}
    >
      <svg viewBox="0 0 120 120" className={PLATE[size].q}>
        <path
          className="fill-card"
          fillRule="evenodd"
          d="M47 21 H73 A15 15 0 0 1 88 36 V62 A15 15 0 0 1 73 77 H47 A15 15 0 0 1 32 62 V36 A15 15 0 0 1 47 21 Z M54 37 H64 A6 6 0 0 1 70 43 V55 A6 6 0 0 1 64 61 H54 A6 6 0 0 1 48 55 V43 A6 6 0 0 1 54 37 Z"
        />
        <path
          className="fill-card"
          d="M75 49 H83 A5 5 0 0 1 88 54 V94 A5 5 0 0 1 83 99 H75 A5 5 0 0 1 70 94 V54 A5 5 0 0 1 75 49 Z"
        />
      </svg>
    </span>
  );
}

// Radius is proportional to the short side, so it is the caller's to pass alongside
// the padding that sets the height. The drawn box does NOT change below the
// breakpoint — `TAP_44` grows the region around it, which is what holds the radii
// where they are. *Shape system*
function pillClass(padY: string, radius: string, type = 'text-body') {
  return ({ isActive }: { isActive: boolean }) =>
    `block w-full ${radius} ${TAP_44} px-3 ${padY} text-left ${type} transition-control select-none active:scale-[.97] ` +
    (isActive
      ? // SAID TWICE, WHICH IS THE WHOLE POINT: a tint AND an inset left edge, because
        // 1.4.1 does not accept a state carried by colour alone. An INSET SHADOW and not
        // a pseudo-element — `TAP_44` owns `::after` on every pill below the breakpoint,
        // and a real border would move the label and break the radii.
        'bg-accent-tint font-bold text-ink shadow-[inset_2px_0_0_var(--color-sb-indicator),var(--focus-halo)]'
      : // HOVER LIVES IN THIS ARM ONLY. In the shared prefix it outranks the active
        // arm — `hover:` is a class higher and Tailwind emits it later — so pointing
        // at the route you are already on repaints it and takes away both halves.
        'bg-transparent font-normal text-sb-item hover:bg-sb-item-hover-bg hover:text-sb-item-hover');
}

// The panel's row (shell.md § Signed, G1): 13 + the body's 18 + 13 is 44, at r12 = 0.26 × 44.
const ROW = pillClass('py-[13px]', 'rounded-[12px]');

// The glyph takes its colour ON ITSELF: the glyph rank names an idle and an active
// state and no third, so the pill's hover must reach the label alone. It eases on its
// own too — `transition-property` does not inherit onto an svg.
function NavItem({
  Icon,
  label,
  isActive,
  count,
}: {
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
  /** A number at the pill's right edge, `aria-hidden`: the link's name carries it. */
  count?: string;
}) {
  return (
    <span className="flex items-center gap-3">
      <Icon
        size={18}
        strokeWidth={2}
        aria-hidden
        className={`flex-none transition-control-colors ${isActive ? 'text-accent' : 'text-sb-icon'}`}
      />
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && (
        // `ink` on the tint: `sb-badge` on it is under 4,5 : 1 in light.
        <span
          aria-hidden
          className="grid h-[18px] min-w-5 flex-none animate-in place-items-center rounded-[5px] bg-sb-badge-bg px-[5px] text-label font-bold text-ink duration-300 fade-in"
        >
          {count}
        </span>
      )}
    </span>
  );
}

/**
 * A nav group and its collapse control. A boxed glyph acts on the shell, a bare one on
 * the content it labels; the sidebar leaves sideways, a group closes down. Three bands
 * — before the active row, the row, after — and only the outer two fold: copying the
 * active link gives two `aria-current="page"` links, and auto-expanding rewrites the
 * persisted set on every navigation into the group. Radius 9 is borrowed from the account
 * row, not derived — the row draws no box. *Shape system*
 */
function NavGroup({
  groupKey,
  label,
  children,
}: {
  groupKey: string;
  label: string;
  children: ReactNode;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const collapsed = useSettings((s) => s.collapsedNavGroups.includes(groupKey));
  const toggle = useSettings((s) => s.toggleNavGroup);

  const items = Children.toArray(children);
  // A REAL narrowing, not `isValidElement<{ to?: string }>`, which is a cast an object
  // `To` walks straight through — the pill then vanishes on collapse with no type
  // error. `matchPath` is what NavLink resolves with, so the two cannot drift apart.
  const isActive = (child: ReactNode) => {
    if (!isValidElement(child)) return false;
    const to = (child.props as { to?: unknown }).to;
    return typeof to === 'string' && matchPath({ path: to, end: to === '/' }, pathname) !== null;
  };
  const activeIndex = items.findIndex(isActive);
  const before = activeIndex === -1 ? items : items.slice(0, activeIndex);
  const after = activeIndex === -1 ? [] : items.slice(activeIndex + 1);

  const fold = (rows: ReactNode[], key: string) =>
    rows.length === 0 ? null : (
      <div
        key={key}
        // `[1fr]` → `[0fr]` animates a list of unknown height with no measurement, so
        // the reveal needs no ResizeObserver; an empty band renders NOTHING, because a
        // zero-height flex item still draws the gap. *Interaction rules*
        className={`grid transition-[grid-template-rows] ease-soft ${
          collapsed ? 'grid-rows-[0fr] duration-220' : 'grid-rows-[1fr] duration-300'
        }`}
      >
        {/* `inert` while collapsed, and NOT belt-and-braces: `[0fr]` with
            `overflow-hidden` clips PAINT, so every link stays in the tab order. */}
        <div
          inert={collapsed || undefined}
          className="flex min-h-0 flex-col gap-0.5 overflow-hidden"
        >
          {rows}
        </div>
      </div>
    );

  return (
    <>
      <button
        type="button"
        onClick={() => toggle(groupKey)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t.nav.expandGroup(label) : t.nav.collapseGroup(label)}
        // A REAL box, not an overlay: this row draws no fill in any state, so it
        // pushes the first pill down instead of overlapping it, which is what
        // tap-target.ts requires. `TAP_44_BOX` squares the box and this one has a
        // label to hold.
        className="group mx-3 mb-1.5 flex h-[18px] items-center rounded-[9px] text-label-caps text-muted uppercase transition-control select-none hover:text-sb-item-hover active:scale-[.97] max-md:h-11"
      >
        {label}
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden
          // STRONGER than the label beside it, and it follows the label on hover: a
          // caption must not out-read its control. `transition-[rotate,color]` and not
          // `transition-transform` — Tailwind compiles `-rotate-90` to `rotate`.
          className={`ml-auto text-sb-item transition-[rotate,color] duration-220 ease-soft group-hover:text-sb-item-hover ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {fold(before, 'before')}
      {/* The active pill survives the collapse: it was never inside what closes. */}
      {activeIndex !== -1 && items[activeIndex]}
      {fold(after, 'after')}
    </>
  );
}

/** A user's two groups. */
function PortfolioNav() {
  const t = useT();
  return (
    <>
      {/* THE RETIRED `"settings"` KEY can still sit in a returning user's
          `collapsedNavGroups`, inert, so do not reuse the name. */}
      <NavGroup groupKey="entry" label={t.nav.groupEntry}>
        <NavLink to="/" className={ROW}>
          {({ isActive }) => (
            <NavItem Icon={CalendarDays} label={t.nav.dailyQuotes} isActive={isActive} />
          )}
        </NavLink>
        <NavLink to="/transactions" className={ROW}>
          {({ isActive }) => (
            <NavItem Icon={ArrowDownUp} label={t.nav.transactions} isActive={isActive} />
          )}
        </NavLink>
      </NavGroup>

      {/* A caption says a group begins; this says the one above it ENDED, which a
          gap cannot. A border and never an SVG — see `Mark`. */}
      <div className="mx-3 my-2 border-t border-hairline" />

      <NavGroup groupKey="analytics" label={t.nav.groupAnalytics}>
        {ANALYTICS.map(({ to, key, Icon }) => (
          <NavLink key={to} to={to} className={ROW}>
            {({ isActive }) => <NavItem Icon={Icon} label={t.nav[key]} isActive={isActive} />}
          </NavLink>
        ))}
      </NavGroup>
    </>
  );
}

/** The super-admin's group, in the recipe of Settings and the eight Analytics routes:
 *  «Користувачі» with the applications waiting, then «Архів цін». */
function AdminNav() {
  const t = useT();
  const badge = usePendingBadge();
  return (
    <NavGroup groupKey="admin" label={t.nav.groupAdmin}>
      <NavLink to="/admin/users" aria-label={usersName(t, badge)} className={ROW}>
        {({ isActive }) => (
          <NavItem Icon={Users} label={t.nav.users} isActive={isActive} count={badge?.shown} />
        )}
      </NavLink>
      <NavLink to="/admin/archive" className={ROW}>
        {({ isActive }) => <NavItem Icon={Archive} label={t.nav.archive} isActive={isActive} />}
      </NavLink>
    </NavGroup>
  );
}

/** The theme track's three glyphs, keyed by the value each writes. These are CONTROLS —
 *  nothing here names a route, and `nav-glyphs.test.ts` holds that record. */
const THEME_GLYPH: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/**
 * THE SIDEBAR'S ONE COMPOSITION, laid out two ways: the drawer is this panel in another
 * box, and all `variant` decides is the two items belonging to a shell rather than to
 * the navigation — the collapse control, and the capital, which below the breakpoint IS
 * the header bar and would otherwise be two truths about one number. THREE ROWS AND
 * ONLY THE MIDDLE ONE SCROLLS, for the reason `Dialog` records: a scrolling box needs
 * a parent whose height is DEFINITE.
 */
function SidebarPanel({
  variant,
  onCollapse,
}: {
  variant: 'panel' | 'drawer';
  onCollapse?: () => void;
}) {
  const t = useT();
  // A GLANCE AND A PREFERENCE SIDE BY SIDE, the one place the foot's two tracks
  // differ: `setCurrency` writes the session value only, so reading one KPI in `$` is
  // gone on reload, while `setTheme` writes the field the Appearance card writes.
  const { currency, setCurrency, theme, setTheme } = useSettings();
  // NEITHER ROLE'S ITEMS UNTIL `GET /me` NAMES ONE, and none for any other role, so no role sees the
  // other's arrive or leave. The super-admin holds no portfolio: no capital, no currency.
  const role = useRole();
  const admin = role === 'super_admin';
  const panel = variant === 'panel';
  const band = useBandHeight(!panel);

  // THE COLUMN IS SPELLED OUT: an implicit `auto` column grows to the widest unbreakable line in
  // it, and an address is one — a long one widened the whole band.
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* ── band 1 — the lockup and the capital line, fixed ─────────────── */}
      {/* THE CAPITAL IS THE PANEL'S ALONE — below the breakpoint the header bar carries it, and
          both read the same hook so they cannot disagree. The super-admin has the role band in
          the drawer too, which covers the header bar that names it. */}
      <div className="mb-[14px] flex flex-col gap-3">
        <PanelHead
          line={!panel || admin ? 'none' : role === 'user' ? 'capital' : 'held'}
          onCollapse={onCollapse}
        />
        {admin && <RoleBand />}
      </div>

      {/* ── band 2 — the navigation, the only part that scrolls ─────────── */}
      {/* The rows are drawn 44 tall, so their hit regions are their boxes and the 2 gap
          keeps them apart at every width. */}
      <Scroller>
        {role !== 'user' && !admin ? null : (
          <div
            key={role}
            className="flex animate-in flex-col gap-0.5 duration-300 ease-soft fade-in"
          >
            {admin ? <AdminNav /> : <PortfolioNav />}
          </div>
        )}
      </Scroller>

      {/* ── band 3 — the foot, pinned ─────────────────────────────────── */}
      {/* ON THE PANEL'S OWN SURFACE, no band of its own: the panel is one glass card, and a
          hairline says where the account begins (rail-and-account-foot.md § Signed, A2). `px-1`
          is `Scroller`'s focus-ring allowance, so the foot's glyphs stand under the nav's. In the
          drawer it reaches through the drawer's bottom padding, so the height it publishes for
          the toast is measured to the screen's edge. */}
      <div
        ref={band}
        className={`mt-[14px] px-1 ${panel ? '' : 'mb-[calc(-1*max(16px,env(safe-area-inset-bottom)))] pb-[max(16px,env(safe-area-inset-bottom))]'}`}
      >
        {/* Every utility past `flex gap-2` is `TAP_44` arithmetic: below the breakpoint the
            22 px segments' overlays reach 11 past them, and Settings, drawn 44, has none, so
            the margin is 11; the row wraps 22 apart where a safe-area inset narrows the foot. */}
        {/* Held at a user's layout, unseen, while the role is unknown; the super-admin's theme
            track alone takes the row. */}
        <div
          className={`mb-2 flex gap-2 max-md:mb-[11px] max-md:flex-wrap max-md:gap-y-[22px] ${role !== 'user' && !admin ? 'invisible' : ''}`}
        >
          {/* The one segmented control at the sidebar's size (controls.md § Signed, D2). The
              glyph's word and the symbol's ISO code are `sr-only`, so each name CONTAINS
              the visible label (2.5.3). */}
          <SegmentedControl
            aria-label={t.settings.theme.ariaLabel}
            size="sm"
            className="flex-1"
            value={theme}
            onChange={(v) => setTheme(v)}
            options={THEME_ORDER.map((value) => {
              const Glyph = THEME_GLYPH[value];
              return {
                value,
                label: (
                  <>
                    <Glyph aria-hidden className="size-3.5" />
                    <span className="sr-only">{t.settings.theme[value]}</span>
                  </>
                ),
              };
            })}
          />
          {!admin && (
            <SegmentedControl
              aria-label={t.settings.currency.title}
              size="sm"
              className="flex-1"
              value={currency}
              onChange={(c) => setCurrency(c)}
              options={[
                {
                  value: 'UAH',
                  label: (
                    <>
                      ₴<span className="sr-only"> UAH</span>
                    </>
                  ),
                },
                {
                  value: 'USD',
                  label: (
                    <>
                      $<span className="sr-only"> USD</span>
                    </>
                  ),
                },
              ]}
            />
          )}
        </div>

        {/* Settings keeps the nav's row recipe: the eleventh route reads like ten. */}
        <NavLink to="/settings" className={ROW}>
          {({ isActive }) => <NavItem Icon={Settings} label={t.nav.settings} isActive={isActive} />}
        </NavLink>

        <AccountRows />

        {/* The privacy notice's and the terms' links (*Legal documents*), on a line of their own
            over the version's, which they would not fit beside. Below the breakpoint they carry
            `TAP_44`, whose overlay reaches 15 past the 14 px line, and «Вийти» or «Увійти» above
            is drawn 44 with none, so the gap is 15. `sb-label` is the caption rank in here, and
            its shortfall is recorded rather than repaired: a second grey is a re-mint the palette
            forbids. */}
        <div className="mt-2.5 flex h-[14px] items-center justify-center gap-2 max-md:mt-[15px]">
          {LEGAL_LINKS.map(([to, document], i) => (
            <Fragment key={to}>
              {i > 0 && (
                <span aria-hidden className="text-label text-sb-label">
                  ·
                </span>
              )}
              <NavLink
                to={to}
                className={`block text-label text-sb-item underline underline-offset-2 transition-control-colors hover:text-sb-item-hover ${TAP_44}`}
              >
                {t[document].link}
              </NavLink>
            </Fragment>
          ))}
        </div>
        <div className="mt-1 text-center text-label-caps text-sb-label uppercase">
          v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

/**
 * The account's place in a foot, in both shells. HELD, invisible and inert, until the
 * relay answers, and closed only where there is no auth environment; `accountRows` says why.
 * Keyed by that state, so what it holds fades in when it shows.
 */
export function AccountFold({
  rows,
  children,
}: {
  rows: ReturnType<typeof accountRows>;
  children: ReactNode;
}) {
  const shown = rows === 'shown' || rows === 'entry';
  return (
    // The column spelled out for the panel's reason: an implicit `auto` one grows to the address.
    <div
      className={`grid grid-cols-[minmax(0,1fr)] ${rows === 'closed' ? 'grid-rows-[0fr]' : 'grid-rows-[1fr]'}`}
    >
      {/* Clipped only while it holds or is closed: shown, a clip would cut a pill's focus ring
          and its `TAP_44` overlay. */}
      <div
        key={rows}
        inert={!shown || undefined}
        className={`min-h-0 ${shown ? 'animate-in duration-200 ease-soft fade-in' : 'invisible overflow-hidden'}`}
      >
        {children}
      </div>
    </div>
  );
}

// ONE GEOMETRY FOR BOTH ANSWERS: the held slot is the signed-in rows' height, so the signed-out
// rows take the same row and pill, or Settings moves when the relay answers.
const ACCOUNT_STEP = 'mt-0.5 max-md:mt-2';
const ACCOUNT_ROW = `${ACCOUNT_STEP} flex h-[36px] items-center px-3 text-small text-sb-item`;
const ACCOUNT_PILL = `${ACCOUNT_STEP} ${ROW({ isActive: false })}`;
// The address as the profile's link: the pill's states at the row's height and size, 9 + the 18
// glyph + 9 = 36.
const ACCOUNT_LINK = pillClass('py-[9px]', 'rounded-[9px]', 'text-small');

/**
 * THE ACCOUNT IS THE FOOT'S LAST ROW, above the links line: the address, the profile's link,
 * then «Вийти» in Settings' recipe. Signed out, the status and «Увійти», a plain `Link`:
 * `/sign-in/x` falls into the shell, where a `NavLink` would mark it current.
 */
function AccountRows() {
  const t = useT();
  const address = useSessionAddress();
  const { rows, leaving, leave } = useSignOut();

  return (
    <AccountFold rows={rows}>
      {/* In the fold, so it is held and closed with the rows it rules off. */}
      <div className="mx-3 my-2 border-t border-hairline" />
      {rows === 'entry' ? (
        <>
          <div className={ACCOUNT_ROW}>
            <div className="min-w-0 flex-1">
              <NavItem Icon={CircleUser} label={t.auth.notSignedIn} isActive={false} />
            </div>
          </div>
          <Link to="/sign-in" className={ACCOUNT_PILL}>
            <NavItem Icon={LogIn} label={t.auth.signInEntry} isActive={false} />
          </Link>
        </>
      ) : (
        <>
          {/* Named for where it goes, the whole address in its `title`, as the cut row showed it. */}
          <NavLink
            to="/profile"
            aria-label={address === undefined ? t.profile.title : t.auth.profileLink(address)}
            title={address}
            className={({ isActive }) => `${ACCOUNT_STEP} ${ACCOUNT_LINK({ isActive })}`}
          >
            {({ isActive }) => (
              <NavItem Icon={CircleUser} label={address ?? t.auth.signedIn} isActive={isActive} />
            )}
          </NavLink>
          {/* `aria-disabled` and never `disabled` while it runs: disabling drops the focus, and a
              sign-out that fails leaves this button as the retry. */}
          <button
            type="button"
            aria-disabled={leaving || undefined}
            onClick={() => void leave()}
            className={`${ACCOUNT_PILL} aria-disabled:opacity-70`}
          >
            <NavItem Icon={LogOut} label={t.auth.signOut} isActive={false} />
          </button>
        </>
      )}
    </AccountFold>
  );
}

/**
 * Publishes the drawer's foot's RENDERED height, to the screen's edge, as `--drawer-band-h` while
 * the drawer is open, so a toast stands on the foot instead of covering «Вийти» — `AppToaster` adds it to the
 * toaster's offset, as `DailyQuotes` does for its action bar and for the same reason.
 */
function useBandHeight(publish: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!publish || !el) return;
    const write = () => root.style.setProperty('--drawer-band-h', `${el.offsetHeight}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--drawer-band-h');
    };
  }, [publish]);
  return ref;
}

/**
 * The lockup, with the capital under the wordmark where the panel shows it (shell.md § Signed, G1).
 * While the role is unknown the line's slot is HELD at its height, so the wordmark does not move
 * when a user's figure lands.
 */
function PanelHead({
  line,
  onCollapse,
}: {
  line: 'capital' | 'held' | 'none';
  onCollapse?: () => void;
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-3">
      <Mark size={40} />
      <div className="min-w-0 flex-1">
        <div className="font-display text-h3 text-ink">quirenote</div>
        {line === 'capital' && <CapitalLine />}
        {line === 'held' && <div aria-hidden className="h-[14px]" />}
      </div>
      {onCollapse !== undefined && (
        // UNBOXED, AND THE INK IS THE OBJECT: a stroke here reads as a badge.
        <button
          type="button"
          id={SIDEBAR_COLLAPSE_ID}
          onClick={onCollapse}
          aria-label={t.nav.collapseNav}
          className="grid size-7 flex-none place-items-center rounded-[7px] text-sb-item transition-control hover:text-sb-item-hover active:scale-[.97]"
        >
          <ChevronLeft size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * The super-admin's band under the lockup: the role in words beside a shield, never colour alone
 * (WCAG 1.4.1), and never a gear, which is Settings.
 */
function RoleBand() {
  const t = useT();
  return (
    // `mx-1` is `Scroller`'s focus-ring allowance, so the band spans the rows under it.
    <div className="mx-1 flex h-11 items-center gap-3 rounded-[12px] bg-ink/5 px-3">
      <Shield size={18} strokeWidth={2} aria-hidden className="flex-none text-sb-icon-active" />
      <span className="min-w-0 flex-1 truncate font-display text-body font-semibold text-ink">
        {t.nav.superAdmin}
      </span>
    </div>
  );
}

/**
 * ITS OWN COMPONENT so the hook is gated with the markup: `useCapitalCard` mounts an
 * rAF tween, and called from the panel it ran in the DRAWER variant too, animating a
 * number that is not on screen. The name is `sr-only`: a bare figure under the wordmark is
 * unlabelled.
 */
function CapitalLine() {
  const t = useT();
  const capital = useCapitalCard();
  return (
    <div className="truncate text-label text-muted">
      <span className="sr-only">{t.sidebar.totalCapital}: </span>
      {capital.value}
      <span aria-hidden> · </span>
      {/* BY SIGN, because `AppHeader` colours the same figure by sign. */}
      <span
        className={
          capital.pct === undefined ? '' : (capital.net ?? 0) < 0 ? 'text-neg' : 'text-pos'
        }
      >
        {capital.pct ?? '—'}
      </span>
    </div>
  );
}

/**
 * The DESKTOP shell, in flow and at two widths. The rail arrives as `children` so this
 * file never imports it and it can import the route table from here without the two
 * forming a cycle; the shell stays mounted across the flip, so its one width, the inset
 * included, animates. THE RAIL'S RADIUS IS CHOSEN, NOT DERIVED: a full-height box has no
 * short side to scale from. *Shape system*
 */
export function Sidebar({
  collapsed,
  onCollapse,
  children,
}: {
  collapsed: boolean;
  onCollapse: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      id={SIDEBAR_ID}
      className={`sticky top-0 h-dvh flex-none overflow-hidden transition-[width] duration-[260ms] ease-soft ${
        collapsed
          ? 'w-[calc(56px+env(safe-area-inset-left))]'
          : 'w-[calc(max(16px,env(safe-area-inset-left))+260px)]'
      }`}
    >
      {collapsed ? (
        // THE RAIL WEARS THE WALL, said here rather than in the rail: the fill, the
        // edge and the corner belong to the SHELL, and the branch below carries the
        // identical four. The width is SPELLED OUT rather than `w-full`, which would
        // resolve against a box mid-animation and slide every centred item sideways.
        <div className="h-full w-[calc(56px+env(safe-area-inset-left))] rounded-r-[30px] border-r border-field-border bg-sb-bg pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-ink">
          {children}
        </div>
      ) : (
        // A FLOATING GLASS CARD (shell.md § Signed, G1): 16 from the top, the left and the bottom,
        // at the signed r26. The LEFT inset is paid here and not on the content
        // column, because this panel is that column's sibling, where `viewport-fit=cover` puts a
        // cutout. `glass` carries the opaque fallback.
        <div className="mt-4 ml-[max(16px,env(safe-area-inset-left))] h-[calc(100dvh-16px-max(16px,env(safe-area-inset-bottom)))] w-[260px] rounded-[26px] glass px-3.5 pt-4 pb-3 text-ink">
          <SidebarPanel variant="panel" onCollapse={onCollapse} />
        </div>
      )}
    </aside>
  );
}

/**
 * The MOBILE shell — the same panel, off-canvas. The box is a Radix `Dialog` by
 * deliberate reuse: it supplies the focus trap, Escape, focus return, the `aria-hidden`
 * background and the scroll lock, and writing those by hand is a second untested copy.
 * `drawer-edge` is an ALIAS, not a new colour: transparent in light, where the scrim
 * separates the two on its own, and the control-boundary rank in dark, where the wall
 * is darker than the page it veils and the scrim cannot.
 */
export function SidebarDrawer() {
  const t = useT();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-out data-[state=closed]:duration-220 data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:duration-220 data-[state=open]:fade-in" />
      {/* One step under the app's dialogs: a drawer is chrome, a dialog a question. */}
      <RadixDialog.Content
        aria-describedby={undefined}
        onInteractOutside={keepOpenForToasts}
        className="fixed top-0 left-0 z-40 h-dvh w-[280px] overflow-hidden rounded-r-[30px] border-r border-drawer-edge bg-sb-bg pt-[max(16px,env(safe-area-inset-top))] pr-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-ink data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
      >
        {/* The drawer draws the wordmark, so Radix's title is screen-reader only. */}
        <RadixDialog.Title className="sr-only">{t.nav.navigation}</RadixDialog.Title>
        <SidebarPanel variant="drawer" />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
