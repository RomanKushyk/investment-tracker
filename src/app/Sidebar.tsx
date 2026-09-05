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
function Mark({ className = '' }: { className?: string }) {
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
        className={`group mx-3.5 mb-1.5 flex h-[18px] cursor-pointer items-center rounded-[9px] text-[10px] tracking-[.12em] text-sb-label uppercase transition select-none hover:text-sb-item-hover active:scale-[.97] max-md:h-11 ${className}`}
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
      <div className="absolute -right-[70px] -bottom-[60px] size-[200px] rounded-full bg-sb-field opacity-70" />
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
      {/* ONE ROW, NO PLATE, AND THE BADGE IS IN IT. The lockup used to be a
          filled 14px card with two ornaments floating over it, and everything
          that made that necessary is gone: the plate was the inner term of a
          concentric chain, the wordmark ran two lines because a tagline sat
          under it, and the badge had to float because at 244 the plate could not
          hold a fifth element in flow. The sheet draws a flex row — mark,
          wordmark — so the badge is simply its third child and the arithmetic
          that placed it goes with the box it was measured against.
          The collapse control still floats, so the row reserves its corner
          rather than laying it out: it is positioned against this container and
          would otherwise sit on top of the badge. 38 is that control's own
          arithmetic — 6 inset + 26 button + 6 gap — the figure the badge used
          while it was pinned to the corner too. Measured at 32 first, which put
          the badge's right edge on the button's left edge exactly. */}
      <div className="relative mb-[22px]">
        <div
          className={`flex items-center gap-2 ${
            rail && onCollapse !== undefined ? 'pr-[38px]' : ''
          }`}
        >
          {/* No `text-ink`: no part of the mark inherits `currentColor` since
              the three logo tokens replaced the one brand sand. */}
          <Mark className="size-[22px] flex-none" />
          <span className="font-body text-[15px] font-semibold tracking-[-0.03em] text-ink">
            quirenote
          </span>
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
            className="absolute top-1/2 right-[6px] grid size-[26px] -translate-y-1/2 cursor-pointer place-items-center rounded-[7px] border border-field-border text-sb-item transition hover:text-sb-item-hover active:scale-[.97]"
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
        {/* THE EXCEPTION IS SPENT, AND WHAT REPLACED IT IS NOT THE GENERAL RULE
            EITHER. D114 fills a track with the plane's foreground and slides a
            background chip; the rail was exempted because `pillClass` painted the
            active route a light lozenge, so a filled track made the UNSELECTED
            currency read exactly like a selected route. That premise went with
            the lozenge — the active route is a tint and an indicator now.
            What the rail runs instead is its own field rank: a recessed
            `sb-field` track with a SOLID accent thumb. A solid fill no longer
            means a route anywhere in this plane, so it can mean the selected
            segment without collision, and it keeps the sliding chip that a tint
            would have flattened into the nav's own language.

            The thumb is `accent` and its label `accent-fg` — ONE PAIR, from one
            family. `sb-item-active` holds the same value in both themes and was
            the first choice, but it is the nav label's FOREGROUND rank: pairing
            it with `accent-fg` takes the two halves of a fill from two families,
            and re-valuing the active label — which ships at 3.88 in light and
            may not stay there — would silently repaint this thumb. `sb-bg` for
            the label was the other first choice and reads 4.489 on the fill, a
            hundredth under 1.4.3 on 12px bold text.

            No `data-filled-track`: that attribute puts the focus ring on `page`
            for a track painted in the plane's foreground, and this track is a
            recess. The base `ink` ring reads on it in either theme. */}
        <div className="relative mb-2.5 flex gap-1 rounded-[13px] bg-sb-field p-1.5">
          {/* sliding thumb (D7): shares the two buttons' geometry (p-1.5 + gap-1)
              so translateX(100% + gap) lands it exactly under the other segment.
              The width encodes that geometry as 50% − (padding + half the gap),
              so it MUST be re-derived whenever the container padding moves:
              p-1.5 (6px) + gap-1 (4px) → 50% − 8px. */}
          <div
            aria-hidden
            data-owns-motion
            className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-8px)] rounded-[7px] bg-accent transition-transform duration-300 ease-soft"
            style={{
              transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))',
            }}
          />
          <button
            type="button"
            aria-pressed={currency === 'UAH'}
            onClick={() => setCurrency('UAH')}
            className={`z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${currency === 'UAH' ? 'text-accent-fg' : 'text-sb-item hover:text-sb-item-hover'}`}
          >
            ₴ UAH
          </button>
          <button
            type="button"
            aria-pressed={currency === 'USD'}
            onClick={() => setCurrency('USD')}
            className={`z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${TAP_44} ${currency === 'USD' ? 'text-accent-fg' : 'text-sb-item hover:text-sb-item-hover'}`}
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
    <div className="rounded-[13px] bg-sb-field px-4 py-3.5">
      <div className="text-[10px] tracking-[.12em] text-sb-item uppercase">
        {t.sidebar.totalCapital}
      </div>
      {/* `ink` and `pos`, where this was a literal white and `pos-on-dark`. Both
          existed because the card sat on a plane that was dark in EITHER theme
          and so could not invert with one; the wall follows the theme now, so
          the figure and its gain read the app's own ranks like every other
          number in it. */}
      <div className="font-display text-[21px] font-semibold text-ink">{capital.value}</div>
      <div className="text-[11px] font-semibold text-pos">
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
      <div className="relative h-full w-[244px] rounded-r-[30px] border-r border-field-border bg-sb-bg p-4 pl-[max(16px,env(safe-area-inset-left))] text-ink">
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
        <SidebarDecor />
        <SidebarPanel variant="drawer" />
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
