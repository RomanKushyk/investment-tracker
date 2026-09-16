import {
  ArrowDownUp,
  CalendarDays,
  CalendarRange,
  ChartLine,
  ChartPie,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  LayoutGrid,
  type LucideIcon,
  Monitor,
  Moon,
  Settings,
  Sun,
  Table,
  Tags,
  Wallet,
} from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { Children, isValidElement, type ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router';

import { useT } from '../i18n/useT';
import { SIDEBAR_COLLAPSE_ID } from './nav-ids';
import { THEME_ORDER, useDataset, useSettings, type Theme } from '../state/settings';
import { useCapitalCard } from '../hooks/useCapitalCard';
import { Scroller } from '../components/ui/Scroller';
import { TAP_44 } from '../components/ui/tap-target';

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

// The Quirenote mark. `aria-hidden` because the wordmark beside it says the brand.
// THE BOX IS THE SHEET'S OWN and deliberately not cropped to the ink: a box measured
// off the geometry clips the caps, so re-cropping is the one edit here to think twice
// about. KEEP THIS THE ONLY INLINE SVG IN THE FILE — mark.test.ts reads this source
// raw and collects the mark's attributes as whole-file ordered lists, so a second
// one fails the pin rather than the drawing. *Brand*
export function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden="true">
      <path
        className="stroke-logo-outline"
        d="M72 56 A16 16 0 0 1 56 72 H36 A16 16 0 0 1 20 56 V36 A16 16 0 0 1 36 20 H56 A16 16 0 0 1 72 36 V70 M72 62 A8 8 0 0 1 80 54 H88 A8 8 0 0 1 96 62 V70"
        fill="none"
        strokeWidth="11"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="stroke-logo-pill-a"
        d="M72 48 V70"
        fill="none"
        strokeWidth="15"
        strokeLinecap="round"
      />
      <path
        className="stroke-logo-pill-b"
        d="M96 70 V88"
        fill="none"
        strokeWidth="15"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Radius is proportional to the short side, so it is the caller's to pass alongside
// the padding that sets the height. The drawn box does NOT change below the
// breakpoint — `TAP_44` grows the region around it, which is what holds the radii
// where they are. *Shape system*
function pillClass(padY: string, radius: string) {
  return ({ isActive }: { isActive: boolean }) =>
    `block w-full ${radius} ${TAP_44} px-3.5 ${padY} text-left text-[13.5px] transition select-none active:scale-[.97] ` +
    (isActive
      ? // SAID TWICE, WHICH IS THE WHOLE POINT: a tint AND an inset left edge, because
        // 1.4.1 does not accept a state carried by colour alone. An INSET SHADOW and not
        // a pseudo-element — `TAP_44` owns `::after` on every pill below the breakpoint,
        // and a real border would move the label and break the radii.
        'bg-sb-item-active-bg font-bold text-sb-item-active shadow-[inset_2px_0_0_var(--color-sb-indicator)]'
      : // HOVER LIVES IN THIS ARM ONLY. In the shared prefix it outranks the active
        // arm — `hover:` is a class higher and Tailwind emits it later — so pointing
        // at the route you are already on repaints it and takes away both halves.
        'bg-transparent font-normal text-sb-item hover:bg-sb-item-hover-bg hover:text-sb-item-hover');
}

// The glyph takes its colour ON ITSELF: the glyph rank names an idle and an active
// state and no third, so the pill's hover must reach the label alone. It eases on its
// own too — `transition-property` does not inherit onto an svg.
function NavItem({
  Icon,
  label,
  isActive,
}: {
  Icon: LucideIcon;
  label: string;
  isActive: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden
        className={`flex-none transition-colors ${isActive ? 'text-sb-icon-active' : 'text-sb-icon'}`}
      />
      <span className="flex-1 truncate">{label}</span>
    </span>
  );
}

/**
 * A nav group and its collapse control. A boxed glyph acts on the shell, a bare one on
 * the content it labels; the sidebar leaves sideways, a group closes down. Three bands
 * — before the active row, the row, after — and only the outer two fold: copying the
 * active link gives two `aria-current="page"` links, and auto-expanding rewrites the
 * persisted set on every navigation into the group. Radius 9 is borrowed from the nav
 * pill, not derived — the row draws no box. *Shape system*
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
          className="flex min-h-0 flex-col gap-[3px] overflow-hidden max-md:gap-2"
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
        className="group mx-3.5 mb-1.5 flex h-[18px] cursor-pointer items-center rounded-[9px] text-[11px] font-semibold tracking-[.02em] text-sb-label transition select-none hover:text-sb-item-hover active:scale-[.97] max-md:h-11"
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
  // A GLANCE AND A PREFERENCE SIDE BY SIDE, the one place the footer band's two tracks
  // differ: `setCurrency` writes the session value only, so reading one KPI in `$` is
  // gone on reload, while `setTheme` writes the field the Appearance card writes.
  const { currency, setCurrency, theme, setTheme } = useSettings();
  const demo = useDataset() === 'demo';
  const panel = variant === 'panel';
  const index = THEME_ORDER.indexOf(theme);

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* ── band 1 — the lockup and the capital strip, fixed ────────────── */}
      <div>
        <div className="mb-[14px] flex items-center gap-2">
          <Mark className="size-[22px] flex-none" />
          <span className="font-body text-[15px] font-semibold tracking-[-0.03em] text-ink">
            quirenote
          </span>
          {/* BOTH SHELLS DRAW IT; with the drawer open the header's copy is behind the
              scrim and `aria-hidden`, so exactly one is announced. */}
          {demo && (
            // `warn-tint` and NOT the accent tint every other badge takes: a caution
            // speaks with `warn` and never with the brand. THE OUTLINE IS WHAT MAKES
            // IT A CHIP — on the wall the tint alone is not a visible box.
            <span
              title={t.sidebar.demoTitle}
              className="ml-auto animate-in rounded-[5px] border border-warn bg-warn-tint px-1.5 py-[2px] font-body text-[9px] font-bold tracking-[.08em] text-warn-tint-text uppercase duration-200 zoom-in-95 fade-in"
            >
              {t.sidebar.demoBadge}
            </span>
          )}
        </div>
        {/* THE CAPITAL IS THE PANEL'S ALONE — below the breakpoint the header bar
            carries it, and both read the same hook so they cannot disagree. */}
        {panel && <CapitalBand onCollapse={onCollapse} />}
      </div>

      {/* ── band 2 — the navigation, the only part that scrolls ─────────── */}
      {/* `gap-2` below the breakpoint is not decoration: 36 drawn + 8 gap = 44, so the
          hit regions tile — no overlap handing a tap to the wrong route and no dead
          strip. It is tap-target.ts's second case. */}
      <Scroller>
        <div className="flex flex-col gap-[3px] max-md:gap-2">
          {/* THE RETIRED `"settings"` KEY can still sit in a returning user's
              `collapsedNavGroups`, inert, so do not reuse the name. */}
          <NavGroup groupKey="entry" label={t.nav.groupEntry}>
            <NavLink to="/" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {({ isActive }) => (
                <NavItem Icon={CalendarDays} label={t.nav.dailyQuotes} isActive={isActive} />
              )}
            </NavLink>
            <NavLink to="/transactions" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {({ isActive }) => (
                <NavItem Icon={ArrowDownUp} label={t.nav.transactions} isActive={isActive} />
              )}
            </NavLink>
          </NavGroup>

          {/* A caption says a group begins; this says the one above it ENDED, which a
              gap cannot. A border and never an SVG — see `Mark`. */}
          <div className="mx-3.5 my-2 border-t border-sb-divider" />

          <NavGroup groupKey="analytics" label={t.nav.groupAnalytics}>
            {ANALYTICS.map(({ to, key, Icon }) => (
              <NavLink key={to} to={to} className={pillClass('py-2', 'rounded-[9px]')}>
                {({ isActive }) => <NavItem Icon={Icon} label={t.nav[key]} isActive={isActive} />}
              </NavLink>
            ))}
          </NavGroup>
        </div>
      </Scroller>

      {/* ── band 3 — the footer band, pinned ───────────────────────────── */}
      {/* A BAND, NOT A CLUSTER, AND THE DIFFERENCE IS THE EDGE: its fill barely steps
          off the wall, so the rule along its top is what identifies it. The fill
          bleeds to the shell's edges while the CONTENT keeps the left inset. */}
      <div className="mt-[14px] -mr-4 mb-[calc(-1*max(16px,env(safe-area-inset-bottom)))] ml-[calc(-1*max(16px,env(safe-area-inset-left)))] rounded-br-[29px] border-t border-sb-divider bg-sb-footer-bg py-2 pr-5 pl-[calc(max(16px,env(safe-area-inset-left))+4px)]">
        {/* NO `data-filled-track`: it puts the focus ring on `page` for a track painted
            in the plane's FOREGROUND, and these two are on the active route's tint. The
            thumb widths resolve against the PADDING box — re-derive them if it moves. */}
        {/* EVERY UTILITY ON THIS ROW PAST `flex gap-2` IS `TAP_44` ARITHMETIC. The gap
            doubles below the breakpoint because a segment's overlay and the Settings
            pill's both reach and the drawn gap does not clear the pair — measured, a
            tap on Settings flipped the currency. `min-w-11` goes on the segment because
            two overlays that both reach need `w + gap >= 44` across: the real box
            tap-target.ts names when the gap cannot be made, and it moves no radius.
            AND THE ROW WRAPS, because the five fit the drawer exactly. */}
        <div className="mb-2 flex gap-2 max-md:mb-4 max-md:flex-wrap max-md:gap-y-[22px]">
          {/* A RADIOGROUP and the currency track is not — three mutually exclusive
              values are radios, two states of one view a pressed pair. The idle glyph
              takes NO HOVER: it is the glyph rank, the symbol beside it the label. */}
          <div
            role="radiogroup"
            aria-label={t.settings.theme.ariaLabel}
            className="relative flex flex-1 gap-px rounded-[8px] bg-sb-item-active-bg p-0.5"
          >
            {/* `data-owns-motion` keeps the theme cross-fade from replacing this
                transition during the flip that moves it. */}
            <div
              aria-hidden
              data-owns-motion
              className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-6px)/3)] rounded-[6px] bg-accent transition-transform duration-300 ease-soft"
              style={{ transform: `translateX(calc(${index} * (100% + 1px)))` }}
            />
            {THEME_ORDER.map((value) => {
              const Glyph = THEME_GLYPH[value];
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={theme === value}
                  onClick={() => setTheme(value)}
                  className={`z-10 flex h-[22px] flex-1 cursor-pointer items-center justify-center rounded-[6px] transition active:scale-[.97] max-md:min-w-11 ${TAP_44} ${theme === value ? 'text-accent-fg' : 'text-sb-icon'}`}
                >
                  <Glyph aria-hidden className="size-3.5" />
                  <span className="sr-only">{t.settings.theme[value]}</span>
                </button>
              );
            })}
          </div>
          <div className="relative flex flex-1 gap-px rounded-[8px] bg-sb-item-active-bg p-0.5">
            <div
              aria-hidden
              data-owns-motion
              className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2.5px)] rounded-[6px] bg-accent transition-transform duration-300 ease-soft"
              style={{
                transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 1px))',
              }}
            />
            {/* The ISO code rides beside the symbol for a screen reader, `sr-only` and
                not `aria-label` so the name CONTAINS the visible label (2.5.3). */}
            <button
              type="button"
              aria-pressed={currency === 'UAH'}
              onClick={() => setCurrency('UAH')}
              className={`z-10 flex h-[22px] flex-1 cursor-pointer items-center justify-center rounded-[6px] text-[13px] font-semibold transition active:scale-[.97] max-md:min-w-11 ${TAP_44} ${currency === 'UAH' ? 'text-accent-fg' : 'text-sb-item hover:text-sb-item-hover'}`}
            >
              ₴<span className="sr-only"> UAH</span>
            </button>
            <button
              type="button"
              aria-pressed={currency === 'USD'}
              onClick={() => setCurrency('USD')}
              className={`z-10 flex h-[22px] flex-1 cursor-pointer items-center justify-center rounded-[6px] text-[13px] font-semibold transition active:scale-[.97] max-md:min-w-11 ${TAP_44} ${currency === 'USD' ? 'text-accent-fg' : 'text-sb-item hover:text-sb-item-hover'}`}
            >
              $<span className="sr-only"> USD</span>
            </button>
          </div>
        </div>

        {/* Settings keeps the nav's pill recipe: the eleventh route reads like ten. */}
        <NavLink to="/settings" className={pillClass('py-2', 'rounded-[9px]')}>
          {({ isActive }) => <NavItem Icon={Settings} label={t.nav.settings} isActive={isActive} />}
        </NavLink>

        {/* `sb-label` is the caption rank in here, and its shortfall is recorded rather
            than repaired: a second grey is a re-mint the palette forbids. */}
        <div className="mt-2.5 text-center text-[9.5px] tracking-[.12em] text-sb-label uppercase">
          v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

/**
 * ITS OWN COMPONENT so the hook is gated with the markup: `useCapitalCard` mounts an
 * rAF tween, and called from the panel it ran in the DRAWER variant too, animating a
 * number that is not on screen. A STRIP, NOT A CARD — it bleeds through the panel's
 * padding to the shell's edges, and a full-bleed bar takes square corners. *Shape system*
 */
function CapitalBand({ onCollapse }: { onCollapse?: () => void }) {
  const t = useT();
  const capital = useCapitalCard();
  return (
    <div className="-mr-4 mb-[14px] ml-[calc(-1*max(16px,env(safe-area-inset-left)))] flex h-14 items-center gap-2.5 bg-sb-field pl-[calc(max(16px,env(safe-area-inset-left))+18px)]">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <div className="text-[9.5px] tracking-[.12em] text-sb-label uppercase">
          {t.sidebar.totalCapital}
        </div>

        <div className="flex items-baseline gap-2.5">
          {/* `min-w-0 truncate` so the figure GIVES FIRST: it shares a baseline with the
              delta, and a big total would otherwise paint under the chevron. */}
          <div className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-.01em] text-ink">
            {capital.value}
          </div>
          {/* BY SIGN, because `AppHeader` colours the same figure by sign. */}
          <div
            className={`flex-none text-[11px] font-semibold ${
              capital.pct === undefined
                ? 'text-sb-item'
                : (capital.net ?? 0) < 0
                  ? 'text-neg'
                  : 'text-pos'
            }`}
          >
            {capital.pct ?? '—'}
          </div>
        </div>
      </div>
      {onCollapse !== undefined && (
        // UNBOXED, AND THE INK IS THE OBJECT: a stroke here reads as a second badge
        // beside the DEMO chip. The glyph fills its box to 2.5.8's floor, which is
        // what lets the box carry no paint.
        <button
          type="button"
          id={SIDEBAR_COLLAPSE_ID}
          onClick={onCollapse}
          aria-label={t.nav.collapseNav}
          className="-mr-px ml-auto grid size-[26px] flex-none cursor-pointer place-items-center text-sb-item transition hover:text-sb-item-hover active:scale-[.97]"
        >
          <ChevronLeft size={24} strokeWidth={2} aria-hidden />
        </button>
      )}
    </div>
  );
}

/**
 * The DESKTOP shell, in flow and at two widths. The rail arrives as `children` so this
 * file never imports it and it can import the route table from here without the two
 * forming a cycle; the shell stays mounted across the flip so the width animates. THE
 * SHELL'S RADIUS IS CHOSEN, NOT DERIVED — the footer band is concentric with it, and
 * the proportional rule is wrong here: a full-height panel has no short side to scale
 * from. *Shape system*
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
      id="app-sidebar"
      className={`sticky top-0 h-dvh flex-none overflow-hidden transition-[width] duration-[260ms] ease-soft ${
        collapsed ? 'w-[calc(56px+env(safe-area-inset-left))]' : 'w-[244px]'
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
        <>
          {/* The LEFT inset is paid here and not on the content column, because this
          panel is that column's SIBLING and sits flush to the page's left edge, where
          `viewport-fit=cover` puts a cutout over the lockup and the pills. `border-r`
          and not `border`: the other three sides are flush to the viewport, so those
          edges separate nothing and wear a frame against the chrome. */}
          <div className="h-full w-[244px] rounded-r-[30px] border-r border-field-border bg-sb-bg p-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-ink">
            <SidebarPanel variant="panel" onCollapse={onCollapse} />
          </div>
        </>
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
        className="fixed top-0 left-0 z-40 h-dvh w-[280px] overflow-hidden rounded-r-[30px] border-r border-drawer-edge bg-sb-bg pt-[max(16px,env(safe-area-inset-top))] pr-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-ink data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
      >
        {/* The drawer draws the wordmark, so Radix's title is screen-reader only. */}
        <RadixDialog.Title className="sr-only">{t.nav.navigation}</RadixDialog.Title>
        <SidebarPanel variant="drawer" />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
