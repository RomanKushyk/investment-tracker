import { ChevronLeft } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import { NavLink } from 'react-router';

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

// Mark 04: four days, height is value and opacity is age. EVEN bar centres and
// an even stroke, because a bar spans [x-2, x+2] and only an even x halves to
// whole device pixels at 16px — the same geometry as public/favicon.svg, which
// carries the full reasoning. `aria-hidden` because the wordmark beside it says
// "Quirenote" already; labelling the mark too makes a screen reader say the
// brand twice on every route.
//
// KEEP THIS THE ONLY INLINE SVG IN THE FILE — src/app/mark.test.ts pins the mark
// by reading this source and collecting every path, opacity and stroke width in
// it, so a second one here would fail the pin rather than the drawing. Icons
// that arrive as a component (lucide) never appear in this source and are safe.
function Mark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
        <path d="M6 24v-4" opacity=".45" />
        <path d="M12 24v-10" opacity=".65" />
        <path d="M18 24v-6" opacity=".8" />
        <path d="M24 24v-16" />
      </g>
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
        // themes, so the label has to stay DARK in both; `ink` inverts to
        // #eceae7 and paints #eceae7 on #eceae7 — an empty white lozenge with
        // the route name gone. `sidebar` is #26262a in light, identical to
        // `ink`, so this is a no-op there, and #0f0f11 in dark = 19.15:1.
        'bg-sidebar-text font-bold text-sidebar'
      : 'bg-transparent font-normal text-sidebar-nav');
}

function GroupLabel({ className = '', children }: { className?: string; children: string }) {
  return (
    <div
      className={`mx-3.5 mb-1.5 text-[10px] tracking-[.12em] text-sidebar-muted uppercase ${className}`}
    >
      {children}
    </div>
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
          and the badge — measured, not estimated. */}
      <div className="relative mb-[22px]">
        <div className="flex items-center justify-start gap-2.5 rounded-[14px] bg-sidebar-inset px-[15px] py-2.5">
          <div className="grid size-9 flex-none place-items-center rounded-full bg-sidebar-text text-sidebar">
            <Mark className="size-[18px]" />
          </div>
          <div className="min-w-0 font-display text-base leading-[1.15] font-semibold">
            Quirenote
            <br />
            <span className="text-[9.5px] font-normal tracking-[.12em] text-sidebar-muted uppercase">
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
            className={`font-body animate-in fade-in zoom-in-95 bg-warn-tint text-warn-tint-text absolute top-2.5 origin-top-right scale-75 rounded-[5px] px-2 py-[3px] text-[10px] font-bold tracking-[.08em] uppercase duration-200 ${
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
          <GroupLabel>{t.nav.groupDailyEntry}</GroupLabel>
          <NavLink to="/" className={pillClass('py-[9px]', 'rounded-[10px]')}>
            {t.nav.dailyQuotes}
          </NavLink>

          <GroupLabel className="mt-4">{t.nav.groupAnalytics}</GroupLabel>
          {ANALYTICS.map(({ to, key }) => (
            <NavLink key={to} to={to} className={pillClass('py-2', 'rounded-[9px]')}>
              {t.nav[key]}
            </NavLink>
          ))}

          {/* Third nav group (P2 S1): exact clone of the existing group-label +
              pill anatomy — same motion, same active treatment. */}
          <GroupLabel className="mt-4">{t.nav.groupSettings}</GroupLabel>
          <NavLink to="/settings" className={pillClass('py-2', 'rounded-[9px]')}>
            {t.nav.settings}
          </NavLink>
        </div>
      </Scroller>

      {/* ── band 3 — the cluster, pinned ────────────────────────────────── */}
      <div className="pt-2.5">
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
          inverted plane in both themes (#26262a light, #0f0f11 dark), so white is
          correct on it — 19.15:1 in dark. Swapping it for `sidebar-text` would
          change the LIGHT theme, #ffffff to #e9e8e6, which A9 must not do. Same
          reasoning as `KpiCard` dark. */}
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
export function Sidebar({
  collapsed,
  onCollapse,
}: {
  collapsed: boolean;
  onCollapse: () => void;
}) {
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
      <div
        data-dark-surface
        className="border-surface-edge relative h-full w-[244px] rounded-r-[30px] border bg-sidebar p-4 pl-[max(16px,env(safe-area-inset-left))] text-sidebar-text"
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
 * In LIGHT it draws no edge: the scrim gives 5.23:1 against the drawer's fill,
 * and an outline there is decoration. In DARK the scrim cannot separate them at
 * all — 1.02:1, see `--color-scrim` — so `--color-drawer-edge` turns on. That is
 * an ALIAS and not a new colour: transparent in light, `sidebar-muted` in dark.
 */
export function SidebarDrawer() {
  const t = useT();
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-220 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220 fixed inset-0 z-40" />
      {/* z-40, one step under the app's dialogs at z-50: a drawer is chrome and a
          dialog is a question, so if the two ever coexist the question is on top. */}
      <RadixDialog.Content
        data-dark-surface
        aria-describedby={undefined}
        className="border-drawer-edge data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out fixed top-0 left-0 z-40 h-dvh w-[280px] overflow-hidden rounded-r-[30px] border-r bg-sidebar pt-[max(16px,env(safe-area-inset-top))] pr-4 pb-[max(16px,env(safe-area-inset-bottom))] pl-[max(16px,env(safe-area-inset-left))] text-sidebar-text"
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
