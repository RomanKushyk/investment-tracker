import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { useCapitalCard } from '../hooks/useCapitalCard';
import { NAV_TRIGGER_ID } from './nav-ids';
import { useDataset } from '../state/settings';
import { useT } from '../i18n/useT';

/** The trigger's DRAWN box. It does not grow below the breakpoint: the pressable region
 *  is the button's own box, which carries no fill and no edge to redraw. */
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
 * The sidebar's stand-in, mounted whenever the sidebar is not on screen: always below
 * the breakpoint, above it only while the rail is collapsed. THIS SURFACE REFUSES THE
 * `sb-*` FAMILY, because the wall's ranks would make it read as a detached piece of the
 * drawer. SQUARE CORNERS, because the proportional rule reads off two DESIGNED
 * dimensions and this bar's long side runs edge to edge. *Shape system*
 */
export function AppHeader({
  desktop,
  open,
}: {
  /** Above the breakpoint the header carries the FIGURE and nothing else, because the
   *  control that expands the rail belongs to the rail. The trigger is RENDERED
   *  conditionally and never merely hidden: `getElementById` returns the FIRST match,
   *  so a hidden copy would take `NAV_TRIGGER_ID` from the rail's own. */
  desktop: boolean;
  /** Drawer state, for the trigger's label only. */
  open: boolean;
}) {
  const t = useT();
  const capital = useCapitalCard();
  const demo = useDataset() === 'demo';
  const empty = capital.net === undefined;
  // Radix publishes `aria-expanded` on the trigger, so the NAME has to agree with it,
  // or a screen reader reads out the contradiction in full.
  const triggerLabel = open ? t.nav.closeNav : t.nav.openNav;

  const trigger: ReactNode = desktop ? null : (
    // `asChild`, so the button IS the trigger and Radix returns focus to it. Its ARIA
    // is Radix's — setting `aria-expanded` here silently wins over the live one,
    // because Slot lets the child's props take precedence.
    <RadixDialog.Trigger asChild>
      <button type="button" id={NAV_TRIGGER_ID} aria-label={triggerLabel} className={TRIGGER_CLASS}>
        <MenuGlyph />
      </button>
    </RadixDialog.Trigger>
  );

  return (
    <header
      // The inset goes on the BAR rather than as a fixed offset, so the fill runs under
      // the notch and the CONTENT starts below it. It resolves at all only because
      // `viewport-fit=cover` is on the meta tag; the two are one change. The entry
      // animation is `md:`-only, because below the breakpoint this is always mounted.
      className="sticky top-0 z-30 animate-in border-b border-hairline bg-page pt-[env(safe-area-inset-top)] md:duration-220 md:fade-in md:slide-in-from-top-1"
    >
      <div className="flex h-14 items-center gap-2.5 px-2.5">
        {trigger}
        {/* `truncate` ON BOTH LINES: the row is over-subscribed at 360 once the badge
            takes its slot, and a `min-w-0` block with nothing to clip it overflows the
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
          // THE CAUTION FOLLOWS THE FIGURE: the badge is wider than the rail's column,
          // and a caution that disappears when a rail narrows is one nobody can rely
          // on. With the drawer open this one is `aria-hidden` behind the scrim.
          <span
            title={t.sidebar.demoTitle}
            className="ml-2.5 flex-none animate-in rounded-[5px] border border-warn bg-warn-tint px-1.5 py-[2px] font-body text-[9px] font-bold tracking-[.08em] text-warn-tint-text uppercase duration-200 zoom-in-95 fade-in"
          >
            {t.sidebar.demoBadge}
          </span>
        )}
        {/* The delta STACKS rather than running on one line as the sidebar card does:
            at 360 the row has little left after the trigger, the figure and the badge,
            and two lines fit the height the bar already has. */}
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
