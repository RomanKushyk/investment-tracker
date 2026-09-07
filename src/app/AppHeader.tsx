import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { useCapitalCard } from '../hooks/useCapitalCard';
import { NAV_TRIGGER_ID } from './nav-ids';
import { useDataset } from '../state/settings';
import { useT } from '../i18n/useT';

/**
 * The trigger's DRAWN box: 18 × 12, three 2 px bars at radius 1. It does not
 * grow below the breakpoint — the 44 × 44 pressable region around it is the
 * button's own box, which carries no fill and no edge, so there is nothing there
 * to redraw (G-2). `bg-current` so the glyph follows the button's text colour
 * and the header stays a single-token surface.
 */
function MenuGlyph() {
  return (
    <span aria-hidden className="flex h-3 w-[18px] flex-col justify-between">
      <span className="h-[2px] rounded-[1px] bg-current" />
      <span className="h-[2px] rounded-[1px] bg-current" />
      <span className="h-[2px] rounded-[1px] bg-current" />
    </span>
  );
}

const TRIGGER_CLASS =
  'grid size-11 flex-none cursor-pointer place-items-center rounded-[11px] text-ink transition hover:opacity-85 active:scale-[.97]';

/**
 * S2 — the sidebar's stand-in.
 *
 * It exists whenever the sidebar is not on screen, and it carries the number the
 * app is opened for. Below the breakpoint that is always; at and above it, only
 * while the rail is collapsed — this is not a second permanent bar.
 *
 * A LIGHT SURFACE, deliberately — its fills and text are `page` / `ink` /
 * `muted` / `pos` / `neg` / `hairline`, and never the wall's own `sb-*` family,
 * which would make it read as a detached piece of the drawer. The focus ring is
 * outside that list because it belongs to no surface: it is the app's one base
 * ring, `focus`, and the sidebar used to override it on its own plane and no
 * longer does. Only a filled track repaints it.
 *
 * SQUARE CORNERS. The proportional rule reads `round(min(w, h) × 0.26)` off two
 * DESIGNED dimensions; this bar's short side is its height and its long side
 * runs edge to edge, so 0.26 × 56 = 15 would be a radius taken from a layout
 * dimension — the objection README §4 already raises against applying the rule
 * to a full-height panel, in the other axis. A full-bleed bar has square corners
 * and its boundary is a `hairline`, not a curve.
 *
 * The figure comes from `useCapitalCard`, the same hook the sidebar's Total
 * capital card reads, so `core/derive.headlineKpis` is computed once and there
 * is never a second derivation of the headline.
 */
export function AppHeader({
  desktop,
  open,
}: {
  /**
   * At and above the breakpoint the header carries the FIGURE and nothing else:
   * the rail owns the control that expands it, because a control that expands
   * the rail belongs to the rail. Below it there is no rail, so the header keeps
   * the burger that opens the drawer.
   *
   * The trigger is RENDERED conditionally and never merely hidden. `Layout`
   * finds it by id and `getElementById` returns the first match, so a hidden
   * copy here would take `NAV_TRIGGER_ID` from the rail's own.
   */
  desktop: boolean;
  /** Drawer state, for the trigger's label only. */
  open: boolean;
}) {
  const t = useT();
  const capital = useCapitalCard();
  const demo = useDataset() === 'demo';
  const empty = capital.net === undefined;
  // Radix publishes `aria-expanded` on the trigger, so the NAME has to agree
  // with it: a control announced as expanded while still called "Open
  // navigation" is a contradiction a screen reader reads out in full.
  const triggerLabel = open ? t.nav.closeNav : t.nav.openNav;

  const trigger: ReactNode = desktop ? null : (
    // `asChild`, so the button IS the trigger: Radix then returns focus to it
    // when the drawer closes by Escape, by the scrim, or by a route change.
    // Its ARIA is Radix's — setting `aria-expanded` here would silently win
    // over the live one, because Slot lets the child's props take precedence.
    <RadixDialog.Trigger asChild>
      <button type="button" id={NAV_TRIGGER_ID} aria-label={triggerLabel} className={TRIGGER_CLASS}>
        <MenuGlyph />
      </button>
    </RadixDialog.Trigger>
  );

  return (
    <header
      // `pt-[env(...)]` on the bar rather than a fixed offset: the fill then runs
      // under the notch and the CONTENT starts below it, which is the only
      // arrangement where a translucent status bar does not sit on the figure.
      // It resolves to 0 everywhere else, and only resolves at all because
      // `viewport-fit=cover` is on the meta tag (G-3) — the two are one change.
      //
      // The entry animation is `md:`-only on purpose. Below the breakpoint the
      // header is always mounted, so an entry there would replay on nothing; at
      // and above it, it mounts when the rail collapses, which is the moment
      // S2's motion table describes — and once on load, for someone who left
      // the rail collapsed. Suppressing that would need a first-paint flag; one
      // fade on a cold load is not what the rule is about.
      className="sticky top-0 z-30 animate-in border-b border-hairline bg-page pt-[env(safe-area-inset-top)] md:duration-220 md:fade-in md:slide-in-from-top-1"
    >
      <div className="flex h-14 items-center gap-2.5 px-2.5">
        {trigger}
        {/* `truncate` ON BOTH LINES, the pair `CapitalBand` carries for the same
            reason: the row is over-subscribed at 360 once the badge takes its
            slot, and a `min-w-0` block with nothing to clip it overflows the
            viewport instead of ellipsising. No route may scroll sideways. */}
        <div className="min-w-0">
          <div className="truncate text-[9.5px] tracking-[.12em] text-muted uppercase">
            {t.sidebar.totalCapital}
          </div>
          <div
            className={`truncate font-display text-[18px] leading-[1.15] font-bold ${empty ? 'text-faint' : ''}`}
          >
            {capital.value}
          </div>
        </div>
        {demo && (
          // THE CAUTION FOLLOWS THE FIGURE. The badge is wider than a 56px
          // rail's column, so it comes here — which is exactly where the header
          // exists: while the rail is collapsed, and below the breakpoint. A
          // caution that disappears when a rail narrows is one nobody can rely
          // on. The sidebar keeps its own in both its shells; with the drawer
          // open this one is behind the scrim and `aria-hidden`, so one is
          // announced and the other is dimmed furniture, like the figure above
          // it.
          //
          // `warn` on `page` rather than on the wall, which is a plane the
          // sheet's own table does not read; `palette-mirror.test.ts` records it.
          // It is outside the `sb-*` family this surface refuses, which is the
          // rule that matters here.
          <span
            title={t.sidebar.demoTitle}
            className="ml-2.5 flex-none animate-in rounded-[5px] border border-warn bg-warn-tint px-1.5 py-[2px] font-body text-[9px] font-bold tracking-[.08em] text-warn-tint-text uppercase duration-200 zoom-in-95 fade-in"
          >
            {t.sidebar.demoBadge}
          </span>
        )}
        {/* The delta STACKS rather than running on one line as the sidebar card
            does: at 360 the row has little left after the trigger, the figure
            and the badge, and `+3,08 % · 3 324,03 $` does not fit that on one
            line. Two lines fit the height the bar already has. */}
        <div className="ml-auto pr-1 text-right text-[11px] leading-[1.35]">
          {empty ? (
            <span className="text-faint">—</span>
          ) : (
            <>
              <span className={`font-semibold ${(capital.net ?? 0) < 0 ? 'text-neg' : 'text-pos'}`}>
                {capital.pct}
              </span>
              <br />
              <span className="text-muted">{capital.counter}</span>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
