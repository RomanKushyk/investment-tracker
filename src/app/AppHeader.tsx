import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { useCapitalCard } from '../hooks/useCapitalCard';
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

/**
 * Collapsing the rail makes the control that did it `inert`, and expanding it
 * unmounts the one that did THAT — so in both directions the activated element
 * disappears and focus falls to `<body>`. `Layout` moves it to whichever trigger
 * replaced it, and these two ids are how it finds them.
 */
export const NAV_TRIGGER_ID = 'app-nav-trigger';
export const SIDEBAR_COLLAPSE_ID = 'app-sidebar-collapse';

const TRIGGER_CLASS =
  'grid size-11 flex-none cursor-pointer place-items-center rounded-[11px] text-ink transition hover:opacity-85 active:scale-[.97]';

/**
 * S2 — the sidebar's stand-in.
 *
 * It exists whenever the sidebar is not on screen, and it carries the number the
 * app is opened for. Below the breakpoint that is always; at and above it, only
 * while the rail is collapsed — this is not a second permanent bar.
 *
 * A LIGHT SURFACE, deliberately: `page` / `ink` / `muted` / `pos` / `neg` /
 * `hairline`, and never the `sidebar-*` family, which would make it read as a
 * detached piece of the drawer. The same reasoning is why `[data-dark-surface]`
 * is absent here — the focus ring on this trigger must be the ink one, and that
 * is correct rather than an oversight (register D6).
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
  mode,
  open,
  onExpand,
}: {
  /**
   * `drawer` — below the breakpoint; the trigger opens the off-canvas sidebar
   * and Radix supplies its own `aria-expanded` / `aria-controls` / `aria-haspopup`.
   * `expand` — at and above it; the trigger puts the collapsed rail back in flow.
   */
  mode: 'drawer' | 'expand';
  /** Drawer state, for the trigger's label only — always false in `expand`. */
  open: boolean;
  onExpand: () => void;
}) {
  const t = useT();
  const capital = useCapitalCard();
  const empty = capital.net === undefined;
  // Radix publishes `aria-expanded` on the trigger, so the NAME has to agree
  // with it: a control announced as expanded while still called "Open
  // navigation" is a contradiction a screen reader reads out in full.
  const triggerLabel = open ? t.nav.closeNav : t.nav.openNav;

  const trigger: ReactNode =
    mode === 'drawer' ? (
      // `asChild`, so the button IS the trigger: Radix then returns focus to it
      // when the drawer closes by Escape, by the scrim, or by a route change.
      // Its ARIA is Radix's — setting `aria-expanded` here would silently win
      // over the live one, because Slot lets the child's props take precedence.
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          id={NAV_TRIGGER_ID}
          aria-label={triggerLabel}
          className={TRIGGER_CLASS}
        >
          <MenuGlyph />
        </button>
      </RadixDialog.Trigger>
    ) : (
      <button
        type="button"
        id={NAV_TRIGGER_ID}
        onClick={onExpand}
        aria-label={triggerLabel}
        aria-expanded={false}
        aria-controls="app-sidebar"
        className={TRIGGER_CLASS}
      >
        <MenuGlyph />
      </button>
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
      // and above it, the header mounts exactly when the rail collapses, which
      // is the moment S2's motion table describes.
      className="sticky top-0 z-30 animate-in border-b border-hairline bg-page pt-[env(safe-area-inset-top)] md:duration-220 md:fade-in md:slide-in-from-top-1"
    >
      <div className="flex h-14 items-center gap-2.5 px-2.5">
        {trigger}
        <div className="min-w-0">
          <div className="text-[9.5px] tracking-[.12em] text-muted uppercase">
            {t.sidebar.totalCapital}
          </div>
          <div
            className={`font-display text-[18px] leading-[1.15] font-bold ${empty ? 'text-faint' : ''}`}
          >
            {capital.value}
          </div>
        </div>
        {/* The delta stacks rather than running on one line as the sidebar card
            does: at 360 the bar has ~150 px left after the trigger and the
            figure, and `+3,08 % · 3 324,03 $` is 20 characters — 144 px at the
            0.6 em advance, before the gap. Two lines fit the 56 px it already
            has. */}
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
