import { ChevronDown, ChevronLeft } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { Children, isValidElement, type ReactNode } from 'react';
import { matchPath, NavLink, useLocation } from 'react-router';

import { useT } from '../i18n/useT';
import { SIDEBAR_COLLAPSE_ID } from './AppHeader';
import { useDataset, useSettings } from '../state/settings';
import { useCapitalCard } from '../hooks/useCapitalCard';
import { Scroller } from '../components/ui/Scroller';
import { TAP_44 } from '../components/ui/tap-target';

// Route -> dictionary KEY, not route -> label: the label is language-dependent
// and the key is not, so the list stays a constant and the text is looked up at
// render. The keys are checked against the dictionary by the compiler.
const ANALYTICS = [
  { to: '/overview', key: 'overview' },
  { to: '/balances', key: 'balances' },
  { to: '/payouts', key: 'payouts' },
  { to: '/yield', key: 'yield' },
  { to: '/attributes', key: 'attributes' },
  { to: '/seasonality', key: 'seasonality' },
  { to: '/portfolio', key: 'portfolio' },
  { to: '/allocation', key: 'allocation' },
] as const;

// The Quirenote mark (D131): an open Q — an r32 arc gapped at the top-right —
// whose tail is a sand arrow. `aria-hidden` because the wordmark beside it says
// "Quirenote" already; labelling the mark too makes a screen reader say the
// brand twice on every route.
//
// The viewBox is CROPPED TO THE INK, and that is the whole geometric argument
// now that there are no bars to align to a pixel grid. The arc's ink spans
// [9.5, 86.5] on both axes (centre 48,48 · r32 · stroke 13) and the arrowhead
// reaches x 87.5 and y 8.5 (tip 86,10 with a 3-wide round join), so the union is
// exactly 78 × 78 at (9.5, 8.5). Filling that box means a 36px mark is 36px of
// drawing — the diameter the retired disc had — and in public/favicon.svg it is
// what puts 2.67px of stroke on a 16px tab instead of 2.17px.
//
// Colour is split: the arc takes `currentColor` so it follows the plane it is
// on, the arrow takes the one brand token. No hex belongs in here — mark.test.ts
// asserts there is none.
//
// KEEP THIS THE ONLY INLINE SVG IN THE FILE — src/app/mark.test.ts pins the mark
// by reading this source and collecting every path and stroke width in it, so a
// second one here would fail the pin rather than the drawing. Icons that arrive
// as a component (lucide) never appear in this source and are safe.
function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="9.5 8.5 78 78" className={className} aria-hidden="true">
      <path
        d="M53 16.39A32 32 0 1 0 79.61 42.99"
        fill="none"
        stroke="currentColor"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        className="stroke-brand-sand"
        d="M52 44 74 22"
        fill="none"
        strokeWidth="13"
        strokeLinecap="round"
      />
      <path
        className="fill-brand-sand stroke-brand-sand"
        d="M79.78 31.78 64.22 16.22 86 10Z"
        strokeWidth="3"
        strokeLinejoin="round"
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
    `block w-full ${radius} ${TAP_44} px-3.5 ${padY} text-left text-[13.5px] transition select-none hover:opacity-85 active:scale-[.97] ` +
    (isActive
      ? // `text-sidebar`, NOT `text-ink` — this is a LIGHT CHIP ON A DARK RAIL,
        // a third double-duty family beside the two the Phase 5 reference
        // enumerated (FINDING 3). The fill `sidebar-text` stays light in both
        // themes, so the label has to stay DARK in both; `ink` inverts in dark
        // and paints the fill onto itself — an empty lozenge with the route
        // name gone. Since #91 `sidebar` is the dark wall in BOTH themes, so
        // this is no longer the near-no-op in light it used to be: the two
        // tokens are now genuinely different values and the distinction is
        // load-bearing in either theme.
        'bg-sidebar-text font-bold text-sidebar'
      : 'bg-transparent font-normal text-sidebar-nav');
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
 * border in any state (its hover is the pill's own `opacity-85`), so the
 * proportional rule has no box to read, and deriving it would give two values
 * for one row (5 at ≥ md, 11 at 44). Do not "fix" it.
 */
function NavGroup({
  groupKey,
  label,
  className = '',
  children,
}: {
  groupKey: string;
  label: string;
  className?: string;
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
            announcing `aria-expanded="false"`. The shell collapse two hundred
            lines below already had this exact fix; the group did not. */}
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
        className={`mx-3.5 mb-1.5 flex h-[18px] cursor-pointer items-center rounded-[9px] text-[10px] tracking-[.12em] text-sidebar-muted uppercase transition select-none hover:opacity-85 active:scale-[.97] max-md:h-11 ${className}`}
      >
        {label}
        <ChevronDown
          size={14}
          strokeWidth={2}
          aria-hidden
          // `text-sidebar-nav`, BRIGHTER than the label it sits beside, and the
          // extension argues why: the label is a caption, the chevron is a
          // control, and the brief asks it to read at the same weight as the
          // D66 glyph "and no lighter" — brighter than the label, on the rail.
          //
          // `transition-[rotate]`, not `transition-transform`: Tailwind v4 compiles
          // `-rotate-90` to the standalone `rotate` property, which `transform`
          // does not cover — the first draft rotated instantly while claiming
          // 220 ms.
          className={`ml-auto text-sidebar-nav transition-[rotate] duration-220 ease-soft ${collapsed ? '-rotate-90' : ''}`}
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

// S5: persistent while dataset==='demo' (absent in live) — warn-tint family
// only, never pos/neg/asset hues. D7: fade + zoom-in on first paint, 200ms.

/**
 * The decorative blob, and the layer that keeps it inside the shell's corner.
 * Shared by both shells rather than duplicated: it belongs to the SURFACE, so it
 * has to sit outside the padded panel and inside the rounded edge — a position
 * only the wrapper can give it.
 */
function SidebarDecor() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-r-[30px]">
      <div className="absolute -right-[70px] -bottom-[60px] size-[200px] rounded-full bg-sidebar-inset opacity-70" />
    </div>
  );
}

/**
 * THE SIDEBAR'S ONE COMPOSITION, laid out two ways (owner decision 2, S1). The
 * drawer is not a second navigation with its own geometry — it is this, in a
 * different box. All `variant` decides is the two items that belong to a shell
 * rather than to the navigation: the desktop collapse control, and the Total
 * capital card, which below the breakpoint IS the header bar (S2) and would
 * otherwise be two truths about one number.
 *
 * THREE BANDS, AND ONLY THE MIDDLE ONE SCROLLS — the same shape as `Dialog`, and
 * for a measured reason: the sidebar's content is 851 px tall in a 740 px
 * viewport, so the old `mt-auto` cluster sat below the fold on a phone and on
 * any short desktop window. Pinning it puts the currency toggle and the capital
 * figure within reach without scrolling at 740 px of viewport height and at 640,
 * while the nav — the part that can grow — takes the give.
 *
 * A grid and not a flex column, for the reason `Dialog` records in full: a
 * scrolling box needs a parent whose height is DEFINITE, and `flex-1` under a
 * clamped container is not definite enough for `h-full` to resolve against.
 *
 * `relative` on the root is what lifts the whole panel over `SidebarDecor`.
 * The blob is absolutely positioned, so it paints above the background of every
 * in-flow box behind it; one positioned ancestor here settles that for all of
 * them at once, instead of each block that has a fill remembering to opt out.
 */
function SidebarPanel({
  variant,
  onCollapse,
}: {
  variant: 'rail' | 'drawer';
  onCollapse?: () => void;
}) {
  const t = useT();
  // A GLANCE, NOT A PREFERENCE (A21). `setCurrency` writes the session value
  // only — it is deliberately outside `partialize`, so flipping to `$` to read
  // one KPI is gone on the next reload. Settings' own control writes the
  // preference this falls back to.
  const { currency, setCurrency } = useSettings();
  const demo = useDataset() === 'demo';
  const rail = variant === 'rail';

  return (
    <div className="relative grid h-full grid-rows-[auto_minmax(0,1fr)_auto]">
      {/* ── band 1 — the lockup, fixed ─────────────────────────────────── */}
      {/* THE PLATE KEEPS ITS FULL WIDTH AND BOTH ORNAMENTS FLOAT OVER IT, which
          is what the 768 sketch draws and what the arithmetic forces. The brief's
          "outside the lockup plate" is about the plate's BOX — its 14px radius is
          the fixed inner term of the concentric chain (14 + 16 padding = the
          shell's 30, F2) — and both of these are siblings of it, so that box is
          untouched.
          A row of [plate][button] was tried first and measured: taking 34px out
          of the plate leaves line 1 with 68.4px, and `Quirenote` is 73.5px at
          16px IBM Plex Sans, so the wordmark ran under the DEMO badge by 5.1px.
          At 244 the plate cannot hold a fifth element in flow. Floating both
          leaves 134.8px for the wordmark and 5.9px of clearance between the brand
          and the badge — measured, not estimated.

          THOSE TWO FIGURES ARE D66'S AND THE FONT HAS MOVED SINCE (D131). The
          reasoning stands — floating both ornaments is still what buys the
          runway — but the runway is now 78.6px wide, and BOTH its edges are
          pinned: the left by the 15px padding + 36px mark + 10px gap (text
          starts at x 78), the right by the DEMO badge itself, 32.4px wide after
          `scale-75` and floated at `right-[38px]`, so its left edge lands at
          x 156.6. 156.6 − 78 = 78.6. Naming only the left three terms leaves
          149px of plate and does not reproduce the figure. It is spent
          differently now, too: JetBrains
          Mono ExtraBold is a 0.6em monospace, so `Quirenote` inks 9 × 0.58 ×
          font-size and at 16px measured 83.53px — 4.93px UNDER the badge. Hence
          the 14px below, which inks 73.09px and leaves 5.5px. Do not "restore"
          it to 16px without re-measuring that clearance; and note the plate's
          height changes hands with it, because at 16px the text block was the
          taller item (36.78px) and at 14px the 36px mark is. */}
      <div className="relative mb-[22px]">
        <div className="flex items-center justify-start gap-2.5 rounded-[14px] bg-sidebar-inset px-[15px] py-2.5">
          <Mark className="size-9 flex-none text-sidebar-text" />
          <div className="min-w-0 font-body text-[14px] leading-[1.15] font-extrabold tracking-[-0.02em]">
            Quirenote
            <br />
            <span className="font-display text-[9.5px] font-normal tracking-[.12em] text-sidebar-muted uppercase">
              {t.sidebar.brandTagline}
            </span>
          </div>
        </div>
        {demo && (
          // Pinned to the plate's top-right corner, inset by the plate's own
          // padding (15) so it sits on the same margin as everything else — and
          // stepped left to 38 when the collapse control shares that corner
          // (6 inset + 26 button + 6 gap). Shrunk to 0.75 by transform rather
          // than by dividing every metric: scaling keeps the badge's proportions
          // exact, including the radius-to-height ratio D56 fixed.
          // `origin-top-right` so it shrinks INTO the corner it is pinned to
          // instead of away from it.
          <span
            title={t.sidebar.demoTitle}
            className={`absolute top-2.5 origin-top-right scale-75 animate-in rounded-[5px] bg-warn-tint px-2 py-[3px] font-body text-[10px] font-bold tracking-[.08em] text-warn-tint-text uppercase duration-200 zoom-in-95 fade-in ${
              rail && onCollapse !== undefined ? 'right-[38px]' : 'right-[15px]'
            }`}
          >
            {t.sidebar.demoBadge}
          </span>
        )}
        {rail && onCollapse !== undefined && (
          // 26px box, radius 7 — D56 on a control that IS standalone and DOES
          // have a designed short side: round(26 × 0.26) = 7. It exists only at
          // and above the breakpoint, where a pointer is the input, so it is one
          // of the few controls `TAP_44` has no business on.
          // Inset 6 from the plate's edge rather than flush with it: a 26px
          // square dropped on a 14px corner puts its own corner ~4px outside the
          // arc, and a control poking out of the plate it sits on reads as a
          // mistake. Vertically centred, because the badge already owns the top.
          <button
            type="button"
            id={SIDEBAR_COLLAPSE_ID}
            onClick={onCollapse}
            aria-label={t.nav.collapseNav}
            className="absolute top-1/2 right-[6px] grid size-[26px] -translate-y-1/2 cursor-pointer place-items-center rounded-[7px] border border-sidebar-muted text-sidebar-nav transition hover:opacity-85 active:scale-[.97]"
          >
            <ChevronLeft size={14} strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>

      {/* ── band 2 — the navigation, the only part that scrolls ─────────── */}
      {/* `gap-2` below the breakpoint is not decoration: it is what makes the
          44px hit regions tile. 36 drawn + 8 gap = 44, so each region abuts its
          neighbours exactly — no overlap handing a tap to the wrong route, and
          no dead strip between them either. */}
      <Scroller>
        <div className="flex flex-col gap-[3px] max-md:gap-2">
          <NavGroup groupKey="entry" label={t.nav.groupEntry}>
            <NavLink to="/" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {t.nav.dailyQuotes}
            </NavLink>
            {/* A32 — the group's second item. `end` is not needed:
                `/transactions` is not a prefix of any other route. */}
            <NavLink to="/transactions" className={pillClass('py-[9px]', 'rounded-[10px]')}>
              {t.nav.transactions}
            </NavLink>
          </NavGroup>

          <NavGroup groupKey="analytics" label={t.nav.groupAnalytics} className="mt-4">
            {ANALYTICS.map(({ to, key }) => (
              <NavLink key={to} to={to} className={pillClass('py-2', 'rounded-[9px]')}>
                {t.nav[key]}
              </NavLink>
            ))}
          </NavGroup>

          {/* Third nav group (P2 S1): exact clone of the existing group-label +
              pill anatomy — same motion, same active treatment. */}
          <NavGroup groupKey="settings" label={t.nav.groupSettings} className="mt-4">
            <NavLink to="/settings" className={pillClass('py-2', 'rounded-[9px]')}>
              {t.nav.settings}
            </NavLink>
          </NavGroup>
        </div>
      </Scroller>

      {/* ── band 3 — the cluster, pinned ────────────────────────────────── */}
      <div className="pt-2.5">
        {/* THE ONE CONTROL THAT KEEPS THE OLD ORIENTATION, and it is a ruling
            rather than an oversight (owner, 2026-09-01). Everywhere else D114
            fills the track — `ink` — and slides a `card` chip. Here the rail's
            NAV language wins instead: `pillClass` paints the ACTIVE route
            `bg-sidebar-text` with `text-sidebar`, so a filled track made the
            UNSELECTED currency read exactly like a selected route, twenty pixels
            under a list of them, while the selected one took the rail's own fill
            — an inactive pill's treatment. Light means SELECTED in this plane,
            and one control cannot say otherwise.

            No `data-filled-track` with it: on a dark track the ring wants to
            stay light, which is what `[data-dark-surface] :focus-visible`
            already gives it. */}
        <div className="relative mb-2.5 flex gap-1 rounded-[13px] bg-sidebar-inset p-1.5">
          {/* sliding thumb (D7): shares the two buttons' geometry (p-1.5 + gap-1)
              so translateX(100% + gap) lands it exactly under the other segment.
              The width encodes that geometry as 50% − (padding + half the gap),
              so it MUST be re-derived whenever the container padding moves:
              p-1.5 (6px) + gap-1 (4px) → 50% − 8px. */}
          <div
            aria-hidden
            data-owns-motion
            className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-8px)] rounded-[7px] bg-sidebar-text transition-transform duration-300 ease-soft"
            style={{
              transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
            }}
          />
          <button
            type="button"
            aria-pressed={currency === 'UAH'}
            onClick={() => setCurrency('UAH')}
            className={`z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${currency === 'UAH' ? 'text-sidebar' : 'text-sidebar-nav hover:opacity-85'}`}
          >
            ₴ UAH
          </button>
          <button
            type="button"
            aria-pressed={currency === 'USD'}
            onClick={() => setCurrency('USD')}
            className={`z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${currency === 'USD' ? 'text-sidebar' : 'text-sidebar-nav hover:opacity-85'}`}
          >
            $ USD
          </button>
        </div>

        {/* THE CAPITAL CARD IS THE RAIL'S ALONE. Below the breakpoint the header
            bar carries this number (S2), and drawing it in both places would be
            two truths about one figure — which is also why both read the same
            `useCapitalCard`. */}
        {rail && <CapitalCard />}

        {/* (no sidebar Backup pill — relocated to Settings→Data in P2, S7) */}

        <div className="mt-2.5 text-center text-[9.5px] tracking-[.12em] text-sidebar-muted uppercase">
          v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}

/**
 * ITS OWN COMPONENT so the hook is gated with the markup. `useCapitalCard` runs
 * `headlineKpis` and mounts a `useTweenedNumber` rAF tween; called from the panel
 * itself it did both in the DRAWER variant too, where the card is not rendered —
 * recomputing and animating a number that is not on screen while `AppHeader`
 * tweens the same figure behind the scrim.
 */
function CapitalCard() {
  const t = useT();
  const capital = useCapitalCard();
  return (
    // Matches the currency toggle above it rather than the concentric 14: the
    // two sit together as one bottom cluster, and a shared radius reads as a
    // pair. The cost is that this corner alone is not concentric with the
    // shell's.
    <div className="rounded-[13px] bg-sidebar-inset px-4 py-3.5">
      <div className="text-[10px] tracking-[.12em] text-sidebar-muted uppercase">
        {t.sidebar.totalCapital}
      </div>
      {/* Literal white SURVIVES the Phase 5 purge, on purpose: the sidebar is an
          inverted plane in both themes, so white is correct on it. Swapping it
          for `sidebar-text` would take the figure OFF white in both, which A9
          must not do. Same reasoning as `KpiCard` dark. */}
      <div className="font-display text-[21px] font-semibold text-white">{capital.value}</div>
      <div className="text-[11px] font-semibold text-pos-on-dark">
        {capital.pct === undefined
          ? '—'
          : `${capital.pct}${capital.counter === undefined ? '' : ` · ${capital.counter}`}`}
      </div>
    </div>
  );
}

/**
 * The DESKTOP shell — in flow, 244 px, exactly as before, plus a collapse
 * control. It stays mounted while collapsed so the width can animate (260 ms,
 * S1's motion table); `inert` is what stops a 0-width box from still holding
 * eleven focusable links a keyboard could walk into.
 *
 * The shell is CONCENTRIC, not proportional: outer radius = inner radius + the
 * gap between them, so 14 + 16 = 30. The proportional rule gave 63 px here and
 * cut across the header plate's own corner — a full-height panel has no designed
 * short side to scale.
 */
export function Sidebar({ collapsed, onCollapse }: { collapsed: boolean; onCollapse: () => void }) {
  return (
    <aside
      id="app-sidebar"
      inert={collapsed || undefined}
      className={`sticky top-0 h-dvh flex-none overflow-hidden transition-[width] duration-[260ms] ease-soft ${
        collapsed ? 'w-0' : 'w-[244px]'
      }`}
    >
      {/* The inner box keeps its full 244 while the outer one narrows, so the
          rail slides out under a mask instead of having its contents squeezed
          through the last few pixels. */}
      {/* The LEFT inset is paid here and not on the content column, because
          this rail is that column's SIBLING and sits flush against the page's
          left edge. `viewport-fit=cover` extends the page under the cutout, so
          in landscape on a notched device `env(safe-area-inset-left)` is ~59px
          while `p-4` gives 16 — the lockup, the nav pills and the currency
          toggle would sit under the notch and the rounded corner. It resolves to
          16 everywhere else, so nothing moves on a desktop. */}
      {/* `border-r`, not `border`: the rail is flush to the viewport on the
          other three sides, so those edges would separate nothing and the wall
          would wear a frame against the browser chrome. Only the right edge is
          an adjacency — the wall against `page` — and it is the one #98 costed.
          `SidebarDrawer` below draws its own edge the same way. */}
      <div
        data-dark-surface
        className="relative h-full w-[244px] rounded-r-[30px] border-r border-field-border bg-sidebar p-4 pl-[max(16px,env(safe-area-inset-left))] text-sidebar-text"
      >
        <SidebarDecor />
        <SidebarPanel variant="rail" onCollapse={onCollapse} />
      </div>
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
 * an ALIAS and not a new colour: transparent in light, `sidebar-muted` in dark.
 */
export function SidebarDrawer() {
  const t = useT();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-scrim data-[state=closed]:animate-out data-[state=closed]:duration-220 data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:duration-220 data-[state=open]:fade-in" />
      {/* z-40, one step under the app's dialogs at z-50: a drawer is chrome and a
          dialog is a question, so if the two ever coexist the question is on top. */}
      <RadixDialog.Content
        data-dark-surface
        aria-describedby={undefined}
        className="fixed top-0 left-0 z-40 h-dvh w-[280px] overflow-hidden rounded-r-[30px] border-r border-drawer-edge bg-sidebar pt-[max(16px,env(safe-area-inset-top))] pr-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-sidebar-text data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in"
      >
        {/* Radix needs a title for the dialog's accessible name; the drawer shows
            the wordmark instead, so the name is given to screen readers only
            rather than drawn a second time. */}
        <RadixDialog.Title className="sr-only">{t.nav.navigation}</RadixDialog.Title>
        <SidebarDecor />
        <SidebarPanel variant="drawer" />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
