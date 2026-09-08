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

// Route -> dictionary KEY, not route -> label: the label is language-dependent
// and the key is not, so the list stays a constant and the text is looked up at
// render. The keys are checked against the dictionary by the compiler.
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

// The Quirenote mark: the 5h mark, transcribed from the sheet — a rounded loop
// with a small second bay, and two pills falling away from its right edge. All
// stroke and no fill. `aria-hidden` because the wordmark beside it says
// "Quirenote" already; labelling the mark too makes a screen reader say the
// brand twice on every route.
//
// THE BOX IS THE SHEET'S OWN and is deliberately not cropped to the ink: the
// sheet renders the lockup on that box at the size below, so taking the box is
// taking the drawing as drawn. Re-cropping it is the one edit to think twice
// about — mark.test.ts asserts the box still contains every painted stroke,
// because a box measured off the geometry clips the caps.
//
// EVERY PART IS A TOKEN, so the mark inverts with the app. Nothing here takes
// `currentColor` any more: that existed to let one brand sand serve a plane that
// was dark in both themes, and the wall follows the theme now. No hex belongs in
// here — mark.test.ts asserts there is none.
//
// KEEP THIS THE ONLY INLINE SVG IN THE FILE — src/app/mark.test.ts pins the mark
// by reading this source and collecting every path and stroke width in it, so a
// second one here would fail the pin rather than the drawing. Icons that arrive
// as a component (lucide) never appear in this source and are safe.
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

// Radius is proportional, so it is a parameter alongside the padding that sets
// the height: 0.26 of 38px is 10, of 36px is 9. Both are passed by the caller
// rather than derived, because only the caller knows the padding it chose.
//
// The drawn box does NOT change below the breakpoint — `TAP_44` grows the
// pressable region around it instead (G-2), which is exactly what keeps these
// two radii at 10 and 9 rather than both becoming 11.
function pillClass(padY: string, radius: string) {
  return ({ isActive }: { isActive: boolean }) =>
    `block w-full ${radius} ${TAP_44} px-3.5 ${padY} text-left text-[13.5px] transition select-none active:scale-[.97] ` +
    (isActive
      ? // SAID TWICE, WHICH IS THE WHOLE POINT: a tint AND a 2px inset left
        // edge. WCAG 1.4.1 does not accept a state carried by colour alone, and
        // the light lozenge this replaces carried it that way in both themes.
        //
        // `shadow-[inset …]` rather than a pseudo-element, and not for taste:
        // `TAP_44` already owns `::after` on every pill below `md`. An inset
        // shadow also costs no layout, where a real left border would move the
        // label 2px and break the radii D56 derived.
        //
        // The label reads UNDER 4.5 in light on its own tint — 3.88, the sheet's
        // own figure — and that is why the indicator is not decoration. It is
        // the half that survives a colour-blind reading, and 1.4.11 binds it at
        // 3 : 1, which both themes clear on the wall.
        'bg-sb-item-active-bg font-bold text-sb-item-active shadow-[inset_2px_0_0_var(--color-sb-indicator)]'
      : // HOVER LIVES IN THIS ARM ONLY, and putting it in the shared prefix was
        // a defect rather than a tidiness. `hover:` is one specificity class
        // higher than the plain utilities beside it and Tailwind emits it later,
        // so on the shared string it beat the active arm: pointing at the route
        // you are already on repainted it `sb-item-hover-bg` + `sb-item-hover`
        // and took away both halves of the state. The old `opacity-85` composed
        // with whatever was underneath and never collided this way.
        'bg-transparent font-normal text-sb-item hover:bg-sb-item-hover-bg hover:text-sb-item-hover');
}

// The glyph takes its colour ON ITSELF, not from the pill: the record names
// `sb-icon` and `sb-icon-active` and no third, so the pill's hover must reach
// the label alone (`parchment-5h.dc.html:272-282`). It eases on its own too —
// `transition-property` does not inherit onto an svg, and without it the colour
// snaps while the tint beside it fades. One site draws all eleven, so the
// anatomy cannot drift per item; `aria-hidden` because the label already names
// the link.
//
// The label fills and ellipsises as drawn (`parchment-5h.dc.html:66`,
// `parchment-sidebar.dc.html:67`). One consequence is measured and deliberate:
// `nowrap` makes the label's min-content its whole string, and the Scroller
// wraps this column in a `display: table` box that sizes to min-content, so on
// the one route whose group is unfolded the pills grow ~5 off the drawn 203 and
// that route's own label stays readable; folded, they sit at 203 and the one
// long label ellipsises. Clamping instead holds 203 everywhere but breaks the
// label at a word — «Щоденні…» — which reads worse. What this COSTS is #117's.
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
 * A nav group and its collapse control (A33, extension § S5).
 *
 * TWO CONTROLS ON ONE PANEL, AND THEY MUST NOT BE CONFUSED. The D66 control up
 * in band 1 is BOXED (26 × 26, r7, a chevron pointing left) and acts on the
 * SHELL — it takes the whole sidebar away sideways. This one is a BARE glyph in
 * band 2 with no box of its own, and it acts on the CONTENT IT LABELS, closing
 * downwards. Boxed = the shell, bare = what it labels; and the axis needs no
 * learning, because the sidebar leaves sideways and a group closes down.
 *
 * THE ACTIVE PILL STAYS VISIBLE UNDER A CLOSED LABEL — the group does NOT
 * auto-expand. Auto-expanding makes the control refuse the press, and because
 * the collapsed set is persisted it would rewrite the stored preference on
 * every navigation into the group, so the arrangement would decay on its own.
 * A collapsed group is therefore zero rows or one, never a surprise: navigate
 * away and it closes completely.
 *
 * SO THE ACTIVE ROW IS NOT COLLAPSED — it is not COPIED either, and the
 * difference is the whole of this component's shape. The first draft left the
 * list whole and rendered a SECOND copy of the active link beneath it. Measured
 * on `/overview` (the first row of eight): eleven milliseconds after the press
 * there were two identical pills at full opacity, one at y 248 and one at y
 * 562, and the second flew 314 px up the rail over the next 200 ms as the list
 * closed above it. Two `aria-current="page"` links went with it.
 *
 * What renders instead is THREE bands — the rows before the active one, the
 * active one, the rows after — and only the outer two fold. Nothing is
 * duplicated, so the accessibility tree cannot disagree with itself; and the
 * pill does not jump or fly, it is carried by the band above it closing, which
 * is the motion the collapse already had. Expanded, the three bands lay out
 * exactly as one list did: the gaps between them are the parent column's, the
 * same 3 px the rows inside them use.
 *
 * RADIUS 9, BORROWED FROM THE NAV PILL rather than derived — the extension's
 * one deliberate D56 exception, argued there. The row draws no fill and no
 * border in any state (its hover is a text lift, like the pill's), so the
 * proportional rule has no box to read, and deriving it would give two values
 * for one row (5 at ≥ md, 11 at 44). Do not "fix" it.
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
  // A REAL narrowing and the ROUTER'S OWN MATCHER, both for the same reason
  // (A33 review): the first draft asserted `isValidElement<{ to?: string }>`,
  // which is a cast and not a check, then re-implemented path matching by hand.
  // An object `To` (`{ pathname }`), or a NavLink wrapped in anything, walked
  // straight through it and built `"[object Object]/"` — the pill silently
  // vanished on collapse with no type error. `typeof` is the check; `matchPath`
  // is what NavLink itself resolves with, so the two cannot drift apart.
  // `end` only for `/`, which is otherwise a prefix of every route.
  const isActive = (child: ReactNode) => {
    if (!isValidElement(child)) return false;
    const to = (child.props as { to?: unknown }).to;
    return typeof to === 'string' && matchPath({ path: to, end: to === '/' }, pathname) !== null;
  };
  const activeIndex = items.findIndex(isActive);
  const before = activeIndex === -1 ? items : items.slice(0, activeIndex);
  const after = activeIndex === -1 ? [] : items.slice(activeIndex + 1);

  // A band folds; the active row never does. Empty bands render NOTHING rather
  // than a zero-height flex item, which would still draw the column's 3 px gap.
  const fold = (rows: ReactNode[], key: string) =>
    rows.length === 0 ? null : (
      <div
        key={key}
        // `grid-rows-[1fr]` → `[0fr]` animates a list of unknown height with no
        // measurement, which is what lets the reveal keep D7's asymmetry (300
        // in, 220 out) without a ResizeObserver.
        className={`grid transition-[grid-template-rows] ease-soft ${
          collapsed ? 'grid-rows-[0fr] duration-220' : 'grid-rows-[1fr] duration-300'
        }`}
      >
        {/* `inert` while collapsed, and it is NOT belt-and-braces (A33 review):
            `grid-rows-[0fr]` + `overflow-hidden` clips PAINT and nothing else,
            so every link stayed in the tab order and in the accessibility tree
            — the focus ring walked off-screen for eight stops under a button
            announcing `aria-expanded="false"`.
            THE SHELL NO LONGER NEEDS THE SAME FIX and this one still does: #108
            made collapsing the shell a rail that is on screen and meant to be
            reached, so there is nothing hidden there to make inert. A folded
            GROUP is still clipped paint over live links. */}
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
        // `h-[18px]` and the chevron on `ml-auto` at the row's far right are
        // the drawing's, not a choice — S5 pins `height:18px; margin:0 14px 6px`
        // with `margin-left:auto` on the glyph (A33 review). `max-md:h-11` is
        // the G-8 hit area the extension names outright: this row draws no fill
        // in any state, so it takes a REAL box and pushes the first pill down
        // rather than overlapping it, which is what tap-target.ts requires of a
        // box-less control. `TAP_44_BOX` itself is wrong here — it squares the
        // box, and this one has a label to hold.
        className="group mx-3.5 mb-1.5 flex h-[18px] cursor-pointer items-center rounded-[9px] text-[11px] font-semibold tracking-[.02em] text-sb-label transition select-none hover:text-sb-item-hover active:scale-[.97] max-md:h-11"
      >
        {label}
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden
          // `text-sb-item`, STRONGER than the label it sits beside, and the
          // extension argues why: the label is a caption, the chevron is a
          // control, and the brief asks it to read at the same weight as the
          // D66 glyph "and no lighter".
          //
          // IT FOLLOWS THE LABEL ON HOVER, via the `group` on the button, and it
          // has to: the old `opacity-85` faded the whole row so the two moved
          // together, and lifting only the label inverted the very relationship
          // the paragraph above states — the caption would out-read its control.
          //
          // `transition-[rotate,color]`, not `transition-transform`: Tailwind v4 compiles
          // `-rotate-90` to the standalone `rotate` property, which `transform`
          // does not cover — the first draft rotated instantly while claiming
          // 220 ms.
          className={`ml-auto text-sb-item transition-[rotate,color] duration-220 ease-soft group-hover:text-sb-item-hover ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>

      {fold(before, 'before')}
      {/* Zero rows or one: the active pill survives the collapse because it was
          never inside the thing that closes. */}
      {activeIndex !== -1 && items[activeIndex]}
      {fold(after, 'after')}
    </>
  );
}

/**
 * The theme track's three glyphs, keyed by the value each writes. The names are
 * the drawing's and the record of which glyph belongs to which control is
 * `nav-glyphs.test.ts`, where these three are CONTROLS rather than route icons —
 * nothing here names a route.
 */
const THEME_GLYPH: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

// S5: persistent while dataset==='demo' (absent in live) — warn-tint family
// only, never pos/neg/asset hues. D7: fade + zoom-in on first paint, 200ms.

/**
 * THE SIDEBAR'S ONE COMPOSITION, laid out two ways (owner decision 2, S1). The
 * drawer is not a second navigation with its own geometry — it is this, in a
 * different box. All `variant` decides is the two items that belong to a shell
 * rather than to the navigation: the desktop collapse control, and the Total
 * capital card, which below the breakpoint IS the header bar (S2) and would
 * otherwise be two truths about one number.
 *
 * THREE ROWS, AND ONLY THE MIDDLE ONE SCROLLS — the same shape as `Dialog`, and
 * for a measured reason: the old `mt-auto` cluster sat below the fold on a phone
 * and on any short desktop window. Pinning the foot keeps the currency track,
 * Settings and the version within reach without scrolling at 740 px of viewport
 * height and at 640, while the nav — the part that can grow — takes the give.
 * Moving Settings out of the nav and rebuilding the head bought enough of it that
 * the panel begins to scroll LATER than the one it replaces, not sooner.
 *
 * FOUR BANDS IN THREE ROWS, which is not a contradiction: the head row carries
 * the lockup AND the capital strip, so the grid template does not change.
 *
 * A grid and not a flex column, for the reason `Dialog` records in full: a
 * scrolling box needs a parent whose height is DEFINITE, and `flex-1` under a
 * clamped container is not definite enough for `h-full` to resolve against.
 *
 * NOTHING IS POSITIONED AGAINST THE ROOT ANY MORE. `relative` was here so the
 * decorative blob, `absolute inset-0`, would resolve against the panel rather
 * than the page; #107 deleted the blob and the class goes with it. The currency
 * thumb resolves against its own track, which carries its own `relative`.
 */
function SidebarPanel({
  variant,
  onCollapse,
}: {
  variant: 'panel' | 'drawer';
  onCollapse?: () => void;
}) {
  const t = useT();
  // A GLANCE, NOT A PREFERENCE (A21). `setCurrency` writes the session value
  // only — it is deliberately outside `partialize`, so flipping to `$` to read
  // one KPI is gone on the next reload. Settings' own control writes the
  // preference this falls back to.
  // AND A PREFERENCE BESIDE IT, which is the one place the footer band's two
  // tracks differ: `setTheme` writes the same stored field the Appearance card
  // writes, so a flip here is still there after a reload. `useTheme` turns it
  // into `data-theme`; nothing in this file resolves `system` or stamps it.
  const { currency, setCurrency, theme, setTheme } = useSettings();
  const demo = useDataset() === 'demo';
  const panel = variant === 'panel';
  const index = THEME_ORDER.indexOf(theme);

  return (
    <div className="grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* ── band 1 — the lockup and the capital strip, fixed ────────────── */}
      {/* ONE ROW, NO PLATE, AND NOTHING FLOATING IN IT. The lockup used to be a
          filled 14px card with two ornaments over it, and everything that made
          that necessary is gone: the plate was the inner term of a concentric
          chain, the wordmark ran two lines because a tagline sat under it, and
          the badge had to float because at 244 the plate could not hold a fifth
          element in flow. The sheet draws a flex row — mark, wordmark — so the
          badge is simply its third child.
          The collapse control was the last thing floating here, and it made the
          row reserve 38px for a control 26 wide while a bordered chip sat beside
          the DEMO chip reading as a second badge. It moves into the strip below,
          where the drawing puts it, so this row is three members and no more. */}
      <div>
        <div className="mb-[14px] flex items-center gap-2">
          {/* No `text-ink`: no part of the mark inherits `currentColor` since
              the three logo tokens replaced the one brand sand. */}
          <Mark className="size-[22px] flex-none" />
          <span className="font-body text-[15px] font-semibold tracking-[-0.03em] text-ink">
            quirenote
          </span>
          {/* BOTH SHELLS DRAW IT — the drawer is this panel in another box, and
              a lockup row that loses its caution below the breakpoint is a row
              that differs for no drawn reason. The header carries one too
              wherever it is mounted; with the drawer open the header is behind
              the scrim and `aria-hidden`, so exactly one is announced. */}
          {demo && (
            // `warn-tint`, NOT the accent tint the sheet gives every other badge:
            // its own rule says a caution speaks with `warn` and never with the
            // brand, and a dataset that is not the user's data is a caution.
            // `ml-auto` so it sits at the row's end whatever the wordmark does;
            // no `scale-75` any more, which existed only to shrink an ornament
            // pinned to a corner rather than laid out in a row.
            //
            // THE OUTLINE IS WHAT MAKES IT A CHIP HERE. On the old dark plate the
            // tint alone was a visible box; on the wall it is 1.01 : 1 and the
            // badge would render as bare floating text. `warn` gives it an edge
            // at 4.55 light and 8.79 dark without leaving the family the caution
            // rule names.
            <span
              title={t.sidebar.demoTitle}
              className="ml-auto animate-in rounded-[5px] border border-warn bg-warn-tint px-1.5 py-[2px] font-body text-[9px] font-bold tracking-[.08em] text-warn-tint-text uppercase duration-200 zoom-in-95 fade-in"
            >
              {t.sidebar.demoBadge}
            </span>
          )}
        </div>
        {/* THE CAPITAL IS THE RAIL'S ALONE. Below the breakpoint the header bar
            carries this number (S2), and drawing it in both places would be two
            truths about one figure — which is also why both read the same
            `useCapitalCard`. `Layout.tsx:154` already arranges the handoff, so
            nothing there moves. */}
        {panel && <CapitalBand onCollapse={onCollapse} />}
      </div>

      {/* ── band 2 — the navigation, the only part that scrolls ─────────── */}
      {/* `gap-2` below the breakpoint is not decoration: it is what makes the
          44px hit regions tile. 36 drawn + 8 gap = 44, so each region abuts its
          neighbours exactly — no overlap handing a tap to the wrong route, and
          no dead strip between them either. */}
      <Scroller>
        <div className="flex flex-col gap-[3px] max-md:gap-2">
          {/* Two groups since the footer band took Settings. The retired
              `"settings"` key can still sit in a returning user's
              `collapsedNavGroups`; it is inert — nothing reads that array but a
              live group's own `includes` — so do not reuse the name. */}
          <NavGroup groupKey="entry" label={t.nav.groupEntry}>
            <NavLink to="/" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {({ isActive }) => (
                <NavItem Icon={CalendarDays} label={t.nav.dailyQuotes} isActive={isActive} />
              )}
            </NavLink>
            {/* A32 — the group's second item. `end` is not needed:
                `/transactions` is not a prefix of any other route. */}
            <NavLink to="/transactions" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {({ isActive }) => (
                <NavItem Icon={ArrowDownUp} label={t.nav.transactions} isActive={isActive} />
              )}
            </NavLink>
          </NavGroup>

          {/* ONE RULE, AND IT REPLACES THE 16px THAT USED TO SEPARATE THE
              GROUPS. A caption already says a group begins; the rule is what
              says the one above it ENDED, which a gap cannot. It identifies
              nothing on its own — 1.14 : 1 light and 1.12 dark against the wall
              — and *Design pipeline* puts a rule between two regions outside
              1.4.11 for exactly that reason. Drawn as a border and never as an
              SVG: `mark.test.ts` collects this file's `d=` and `stroke` and
              `fill` attributes as whole-file ordered lists, so a second inline
              SVG here fails the mark's pin rather than this rule's. */}
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
      {/* A BAND, NOT A CLUSTER, AND THE DIFFERENCE IS THAT IT HAS AN EDGE. Its
          fill barely steps off the wall, so the `sb-divider` rule along its top
          is what identifies it — `sidebar-structure.test.ts` asserts the two
          together. The fill bleeds to the shell's edges while the CONTENT keeps
          the shell's own left inset, or on a notched phone the band would read
          under the cutout.
          20 OF PADDING, WHICH IS THE POINT OF THE NUMBER: the band is outside the
          `Scroller` and never pays the 4px its viewport holds back for a focus
          ring, so 16 would land its glyph a column left of every other one. */}
      <div className="mt-[14px] -mr-4 mb-[calc(-1*max(16px,env(safe-area-inset-bottom)))] ml-[calc(-1*max(16px,env(safe-area-inset-left)))] rounded-br-[29px] border-t border-sb-divider bg-sb-footer-bg py-2 pr-5 pl-[calc(max(16px,env(safe-area-inset-left))+4px)]">
        {/* THE TRACK IS NOT A RECESS ANY MORE. It ran a `sb-field` track with a
            solid accent thumb, and the argument for the recess was that the wall
            was its ground. On the band it is not: the drawing gives the track
            the ACTIVE ROUTE'S OWN TINT, which takes its fill step against the
            band from 1.02 to 1.24 in dark and lets it drop its edge entirely.
            The thumb stays `accent` with `accent-fg` on it — one pair from one
            family — and it reads 3.62 light and 7.75 dark on the tinted ground,
            both clear of the 3 : 1 a non-text indicator is held to.
            Still no `data-filled-track`: that attribute puts the focus ring on
            `page` for a track painted in the plane's FOREGROUND, and a 12% tint
            is not that. The base accent ring serves it on the new ground.
            THE RING'S REACH SHRANK WITH THE TRACK and #114 still owns it. The
            ring sits 2→4px out from a segment; the track's padding is 2 and its
            gap 1, so on the inner side the band lands on the accent thumb and on
            the outer side past the padding onto the band. It was already 1.00 : 1
            on the inner side at the old 6 and 4, which is why #114 exists; the
            new geometry does not repair it and closing it is still geometry
            rather than a value.
            TWO TRACKS AT `flex-1`, WHICH IS ONE OBJECT AT TWO WIDTHS: the
            drawing puts them side by side on this row, so each takes half —
            at and above the breakpoint. Below it the 44 the segments claim is
            wider than half a row gives three of them, so the halves become the
            two content minima and the theme track is the larger. Everything
            else here is true of both. */}
        {/* THE THUMB'S GEOMETRY IS THE TRACK'S OWN: percentages on an
            absolutely-positioned box resolve against the padding box, so with
            `p-0.5` and `gap-px` a segment is `(100% - 6px) / 3` on the theme
            track and `50% - 2.5px` on the two-segment one, and one step of
            travel is that width plus the gap. Re-derive both if the padding
            moves.
            THE IDLE SYMBOL PAYS FOR THE GROUND. On the old `sb-field` recess
            `sb-item` read 5.99; on the tint it reads 4.30 in light, 0.20 under
            1.4.3, and the only rank above it is the hover state itself. It is the
            drawing's own reading and its fourth recorded shortfall — held at its
            value in `palette-mirror.test.ts` rather than repaired.
            AT AND ABOVE THE BREAKPOINT THE SEGMENT IS ITS DRAWN 22, which is
            under 2.5.8's 24 and passes on that criterion's spacing exception
            rather than on its own size — `TAP_44` is `max-md:` and does not
            reach here. Below it the regions tile instead, on width and on
            height both — see the row. */}
        {/* THE ROW, AND EVERY UTILITY ON IT PAST `flex gap-2` IS `TAP_44` ARITHMETIC.
            16 BELOW THE BREAKPOINT, NOT 8: a 22px segment's overlay reaches 11px
            past its box and the Settings pill's reaches 3.85, so the two need
            14.85 of clearance and the drawn 8 (plus the track's 2 of padding)
            gives 10 — measured, the segment's region crossed 1px into the pill's
            DRAWN box, which is a tap on Settings flipping the currency.
            44 OF WIDTH, on the segment rather than here: across, two overlays
            that both reach need `w + gap >= 44`, and at half a row three theme
            segments are too narrow for it and hand each other taps. `min-w-11`
            is the real box `tap-target.ts` names when the gap cannot be made,
            and it moves no radius — the short side is still the drawn 22, which
            is what `round(min(w, h) x 0.26)` keys the 6 off.
            AND THE ROW WRAPS, because the five of them fit the drawer EXACTLY —
            `sidebar-structure.test.ts` has the arithmetic. A left safe-area
            inset takes that width down, which is reachable in landscape below
            the breakpoint and cannot be emulated or drawn, and a row that
            overflowed would be CLIPPED by the drawer's `overflow-hidden`.
            Wrapped, each track takes the full width and the row gap is what two
            stacked tracks need between them. */}
        <div className="mb-2 flex gap-2 max-md:mb-4 max-md:flex-wrap max-md:gap-y-[22px]">
          {/* THE THEME TRACK IS A RADIOGROUP and the currency one is not, which
              is the semantics following the meaning rather than the drawing: three
              mutually exclusive values are radios, two states of one view are a
              pressed pair. The glyph is the whole visible label, so the
              dictionary's word is the accessible name — `sr-only` and not
              `aria-label`, the same idiom the symbols beside it use.
              The idle glyph is `sb-icon` AND TAKES NO HOVER: that is the glyph
              rank, whose record names an idle and an active state and no third,
              where the currency symbol beside it is a character on `sb-item` and
              keeps the label rank's hover. One row, both ranks, because the row
              holds both kinds of thing. */}
          <div
            role="radiogroup"
            aria-label={t.settings.theme.ariaLabel}
            className="relative flex flex-1 gap-px rounded-[8px] bg-sb-item-active-bg p-0.5"
          >
            {/* The sliding thumb (D7), geometry above. `data-owns-motion` keeps
                the theme cross-fade from replacing this transition during the
                very flip that moves it. */}
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
            {/* The sliding thumb (D7), geometry above. */}
            <div
              aria-hidden
              data-owns-motion
              className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc(50%-2.5px)] rounded-[6px] bg-accent transition-transform duration-300 ease-soft"
              style={{
                transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 1px))',
              }}
            />
            {/* The SYMBOL is the label the drawing gives these, at 13px, and the
                ISO code rides beside it for a screen reader — "₴" alone says
                nothing about which currency it is. `sr-only` rather than
                `aria-label` so the accessible name CONTAINS the visible one, which
                is what 2.5.3 asks and what a speech-input user needs. */}
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

        {/* SETTINGS IS THE BAND'S, NOT THE NAV'S, and it keeps the nav's own
            pill recipe so the eleventh route reads like the other ten. Its
            caption went with it: one item needs no group header, which is most
            of what makes the panel scroll later than the one it replaces. The active label reads 3.62
            here rather than 3.88 on the wall — the same recorded shortfall one
            plane down, on exactly one row of eleven, and `sidebar-plane.test.ts`
            holds both values. */}
        <NavLink to="/settings" className={pillClass('py-2', 'rounded-[9px]')}>
          {({ isActive }) => <NavItem Icon={Settings} label={t.nav.settings} isActive={isActive} />}
        </NavLink>

        {/* (no sidebar Backup pill — relocated to Settings→Data in P2, S7) */}

        {/* The worst text reading in the panel at 2.87 : 1, against 3.09 on the
            wall, and it is recorded rather than repaired: `sb-label` is the
            caption rank everywhere in here, and a second grey for one badge is
            the re-mint the palette forbids. */}
        <div className="mt-2.5 text-center text-[9.5px] tracking-[.12em] text-sb-label uppercase">
          v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

/**
 * ITS OWN COMPONENT so the hook is gated with the markup. `useCapitalCard` runs
 * `headlineKpis` and mounts a `useTweenedNumber` rAF tween; called from the panel
 * itself it did both in the DRAWER variant too, where the figure is not rendered —
 * recomputing and animating a number that is not on screen while `AppHeader`
 * tweens the same figure behind the scrim.
 *
 * A STRIP, NOT A CARD. It was a `rounded-[13px]` box whose radius matched the
 * currency toggle beside it so the two read as one cluster; the cluster is gone,
 * and the drawing bleeds this through the panel's padding to the shell's own
 * edges instead. A full-bleed bar takes square corners (*Shape system*), so it
 * takes no radius, and it takes no edge either: the `field-border` stroke is
 * recorded as available and refused on the instruction that this is a strip. Its
 * fill step is 1.12 : 1 in light and 1.07 in dark, which identifies nothing —
 * the strip is a position in the head, not a box to be found.
 *
 * The caption drops to `sb-label`, the caption rank every other caption in this
 * panel uses, and reads 3.48 / 4.05 on the recess. That is under 1.4.3 and it is
 * recorded rather than repaired: a second grey for one caption is the re-mint the
 * palette forbids. The currency counter goes — the figure and its delta are what
 * the strip carries.
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
        {/* `ink` and `pos`, where this was a literal white and `pos-on-dark`. Both
            existed because the card sat on a plane that was dark in EITHER theme
            and so could not invert with one; the wall follows the theme now, so
            the figure and its gain read the app's own ranks like every other
            number in it. */}
        <div className="flex items-baseline gap-2.5">
          {/* The card stacked these; the strip puts them on one baseline, so they
              compete for ~176px and a large enough total would paint through the
              gap and under the chevron. The figure gives first. */}
          <div className="min-w-0 truncate font-display text-[18px] font-semibold tracking-[-.01em] text-ink">
            {capital.value}
          </div>
          {/* BY SIGN, because `AppHeader` colours the same figure by sign and the
              two must not disagree about one number. `useCapitalCard` exposes
              `net` for exactly this. */}
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
        // UNBOXED, AND THE INK IS THE OBJECT. The chip it replaces carried a
        // `field-border` stroke doing two jobs — identifying the control and being
        // the target — and beside the DEMO chip it read as a second badge. Bare,
        // the glyph is both, and `sidebar-plane.test.ts` holds the reading that
        // lets it drop the stroke.
        // 24 of GLYPH in a 26 BOX, because 24 is exactly 2.5.8's AA floor and the
        // box carries no paint. It ends flush with the shell rather than past it:
        // the `aside` clips, and a box that needed the clip to look legal would be
        // 24 again. The arrow sits in the strip the nav column leaves free, which
        // is a margin rather than one of the panel's columns.
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
 * The DESKTOP shell — in flow, and two widths. Expanded it is the 244 panel;
 * collapsed it is the 56 px rail, which arrives as `children` so this file never
 * imports `SidebarRail` and `SidebarRail` can import the route table from here
 * without the two forming a cycle. The shell stays mounted across the flip so
 * the width can animate (260 ms, S1's motion table).
 *
 * NO `inert` ANY MORE. It existed because collapsing left a 0-width box still
 * holding eleven focusable links a keyboard could walk into; a rail is on screen
 * and is meant to be reached, and the panel it replaces is not rendered at all.
 * The content swaps instantly while the width eases — which is what the mask did
 * in reverse, and cross-fading would need both mounted and one of them inert,
 * reintroducing exactly what this removes.
 *
 * The shell's 30 is CHOSEN, not derived, and the sentence that used to derive it
 * was stale: `outer = inner + gap` needs an inner term, and the 14px lockup plate
 * that supplied it went with #92. The nearest surviving box gives 26. The 30
 * stays because the master reference draws it and #107 moves no shell width; the
 * footer band is what is concentric with it now, at 30 − 1 = 29 on the one corner
 * it meets. The proportional rule is still the wrong tool here — it gave 63 px,
 * because a full-height panel has no designed short side to scale.
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
        // THE RAIL WEARS THE WALL, and it has to be said here rather than in the
        // rail: the fill, the right edge and the corner belong to the SHELL, and
        // the expanded branch below carries the identical four. Rendered bare,
        // the rail drew on `page` with no edge and a foot band still concentric
        // with a 30 nothing painted.
        // The width is FIXED here, spelled out rather than inherited: `w-full`
        // resolves against a box easing from 244 to 56, so every centred item
        // would slide 94px leftwards for the whole 260ms instead of the rail
        // arriving whole under the mask.
        // The inset is ADDED to the width rather than eaten out of it: 56 has no
        // room to give, and a notched phone in landscape is wide enough to be
        // this shell.
        <div className="h-full w-[calc(56px+env(safe-area-inset-left))] rounded-r-[30px] border-r border-field-border bg-sb-bg pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-ink">
          {children}
        </div>
      ) : (
        <>
          {/* The LEFT inset is paid here and not on the content column, because
          this panel is that column's SIBLING and sits flush against the page's
          left edge. `viewport-fit=cover` extends the page under the cutout, so
          in landscape on a notched device `env(safe-area-inset-left)` is ~59px
          while `p-4` gives 16 — the lockup, the nav pills and the currency
          toggle would sit under the notch and the rounded corner. It resolves to
          16 everywhere else, so nothing moves on a desktop. */}
          {/* `border-r`, not `border`: the panel is flush to the viewport on the
          other three sides, so those edges would separate nothing and the wall
          would wear a frame against the browser chrome. Only the right edge is
          an adjacency — the wall against `page` — and it is the one #98 costed.
          `SidebarDrawer` below draws its own edge the same way. */}
          <div className="h-full w-[244px] rounded-r-[30px] border-r border-field-border bg-sb-bg p-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-ink">
            <SidebarPanel variant="panel" onCollapse={onCollapse} />
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * The MOBILE shell — the same panel, off-canvas, over `--color-scrim`.
 *
 * The box is a Radix `Dialog`, and that is a deliberate reuse rather than a new
 * primitive: it already supplies every BEHAVIOURAL acceptance item S1 lists —
 * focus trapped while open, `Escape` closing it, focus returned to the trigger
 * on close, the background hidden from assistive tech, body scroll locked and
 * the scroll POSITION restored on close. Writing those by hand would be a
 * second, untested copy of a dependency the app already ships.
 *
 * In LIGHT it draws no edge: the scrim clears 1.4.11 against the drawer's fill
 * on its own, and an outline there is decoration. In DARK the scrim cannot
 * separate them at all — the wall is darker than the page it veils, which
 * `--color-scrim` argues in full — so `--color-drawer-edge` turns on. That is
 * an ALIAS and not a new colour: transparent in light, and the
 * control-boundary rank's own value in dark.
 */
export function SidebarDrawer() {
  const t = useT();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-out data-[state=closed]:duration-220 data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:duration-220 data-[state=open]:fade-in" />
      {/* z-40, one step under the app's dialogs at z-50: a drawer is chrome and a
          dialog is a question, so if the two ever coexist the question is on top. */}
      <RadixDialog.Content
        aria-describedby={undefined}
        className="fixed top-0 left-0 z-40 h-dvh w-[280px] overflow-hidden rounded-r-[30px] border-r border-drawer-edge bg-sb-bg pt-[max(16px,env(safe-area-inset-top))] pr-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-ink data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
      >
        {/* Radix needs a title for the dialog's accessible name; the drawer shows
            the wordmark instead, so the name is given to screen readers only
            rather than drawn a second time. */}
        <RadixDialog.Title className="sr-only">{t.nav.navigation}</RadixDialog.Title>
        <SidebarPanel variant="drawer" />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
