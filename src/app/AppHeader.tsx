import { Shield } from 'lucide-react';

import { RateLine } from '../components/RateLine';
import { Amount } from '../components/ui/Amount';
import { useRole } from '../hooks/queries';
import { useCapitalCard } from '../hooks/useCapitalCard';
import { useT } from '../i18n/useT';

/**
 * The sidebar's stand-in, mounted whenever the sidebar is not on screen: always below
 * the breakpoint, above it only while the rail is collapsed. THIS SURFACE REFUSES THE
 * `sb-*` FAMILY, because the wall's ranks would make it read as a detached piece of the
 * sidebar. SQUARE CORNERS, because the proportional rule reads off two DESIGNED
 * dimensions and this bar's long side runs edge to edge. *Shape system*
 * At md and up it is dissolved into the page, padded 0 36 (J2, rail-and-account-foot.md § Wave 29);
 * below md the 360 bar keeps the page's plane; its own drawing is mobile-bar-and-sheet.md's.
 */
export function AppHeader({
  desktop,
}: {
  /** Which bar: above the breakpoint the figure runs on into the dated rate line. Neither bar holds
   *  a navigation control: the rail's is the rail's, and below md the dock's «Ще» opens the sheet. */
  desktop: boolean;
}) {
  const t = useT();
  // The capital is a user's; the super-admin's bar names the role in its place, and while the
  // role is unknown the bar holds its height with neither.
  const role = useRole();

  return (
    <header
      // Below md the inset pads the BAR, so its fill runs under the notch (`viewport-fit=cover`).
      // At md it offsets the row as the card's does, which puts its centre line on the plate's.
      className="sticky top-0 z-30 animate-in border-b border-hairline bg-page pt-[env(safe-area-inset-top)] md:static md:mt-[max(8px,env(safe-area-inset-top))] md:border-b-0 md:bg-transparent md:pt-0 md:duration-220 md:ease-soft md:fade-in md:slide-in-from-top-1"
    >
      {/* Below md on the page's 12 gutter: the dock holds the navigation (mobile-bar-and-sheet.md § Signed). */}
      <div className="flex h-14 items-center gap-2.5 px-3 md:px-9">
        {role === 'user' && <HeaderCapital desktop={desktop} />}
        {role === 'super_admin' && (
          // The band's content on the page plane: the bar refuses the `sb-*` family.
          <div className="flex min-w-0 animate-in items-center gap-2.5 duration-300 ease-soft fade-in">
            <Shield size={18} strokeWidth={2} aria-hidden className="flex-none text-accent" />
            <span className="truncate font-display text-sub text-ink">{t.nav.superAdmin}</span>
          </div>
        )}
      </div>
    </header>
  );
}

/** ITS OWN COMPONENT so `useCapitalCard` and the view it reads mount with a user's figure alone. */
function HeaderCapital({ desktop }: { desktop: boolean }) {
  const t = useT();
  const capital = useCapitalCard();
  const empty = capital.net === undefined;
  return (
    <>
      {/* `truncate` ON BOTH LINES: a `min-w-0` block with nothing to clip it overflows
            the viewport instead of ellipsising. No route may scroll sideways. */}
      <div className="min-w-0">
        <div className="truncate text-label-caps text-muted uppercase">
          {t.sidebar.totalCapital}
        </div>
        <div className={`truncate font-display text-display-header ${empty ? 'text-faint' : ''}`}>
          <Amount parts={capital.parts} />
        </div>
      </div>
      {/* The delta STACKS rather than running on one line as the sidebar card does:
            at 360 the row has little left after the figure,
            and two lines fit the height the bar already has. */}
      <div className="ml-auto pr-1 text-right text-label">
        {empty ? (
          <span className="text-faint">—</span>
        ) : desktop ? (
          // Under the change, the hero's dated line, «НБУ» its link
          // (open-values-shell-controls.md § Signed).
          <>
            <div className={`font-semibold ${(capital.net ?? 0) < 0 ? 'text-neg' : 'text-pos'}`}>
              {capital.pct}
            </div>
            <div className="whitespace-nowrap text-muted">
              {capital.counter} · <RateLine inline />
            </div>
          </>
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
    </>
  );
}
