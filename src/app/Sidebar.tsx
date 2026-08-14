import { NavLink } from 'react-router';

import { useSnapshots, useTransactions } from '../hooks/queries';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import { headlineKpis } from '../core/derive';
import { toUsd } from '../core/money';
import { useT } from '../i18n/useT';
import { useDataset, useSettings } from '../state/settings';
import { useFormat } from '../hooks/useFormat';

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
function pillClass(padY: string, radius: string) {
  return ({ isActive }: { isActive: boolean }) =>
    `relative block w-full ${radius} px-3.5 ${padY} text-left text-[13.5px] transition select-none hover:opacity-85 active:scale-[.97] ` +
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
      className={`relative mx-3.5 mb-1.5 text-[10px] tracking-[.12em] text-sidebar-muted uppercase ${className}`}
    >
      {children}
    </div>
  );
}

// Total capital card values per design renderVals (~line 586): UAH mode shows
// whole ₴ + "+3.08% · $3,324.03"; USD mode flips value and counter-currency.
// The headline number tweens (~300ms, D7) whenever it changes — on the
// currency toggle above all, but also as new data comes in.
function useCapitalCard() {
  const f = useFormat();
  const { currency, usdRate } = useSettings();
  const snapshots = useSnapshots().data;
  const transactions = useTransactions().data;
  // One pure selector (core/derive.headlineKpis) — the sidebar never
  // re-implements the Overview KPI math.
  const kpis = snapshots && transactions ? headlineKpis(snapshots, transactions) : undefined;
  const total = kpis?.total ?? 0;
  const usdTotal = toUsd(total, usdRate);
  const tweened = useTweenedNumber(currency === 'UAH' ? total : usdTotal);

  if (!kpis) return { value: '—', sub: '—' };
  return currency === 'UAH'
    ? { value: f.moneyWhole(tweened), sub: `${f.pct(kpis.net.pct)} · ${f.money(usdTotal, 'USD')}` }
    : { value: f.money(tweened, 'USD'), sub: `${f.pct(kpis.net.pct)} · ${f.money(total)}` };
}

// S5: persistent while dataset==='demo' (absent in live) — warn-tint family
// only, never pos/neg/asset hues. D7: fade + zoom-in on first paint, 200ms.

export function Sidebar() {
  const t = useT();
  const { currency, setCurrency } = useSettings();
  const demo = useDataset() === 'demo';
  const capital = useCapitalCard();
  return (
    // w-[244px] is the design's 232px rail plus 5%; below `sm` (640px) it
    // narrows to a compact rail (item 1, 360px shell fix) — every label below
    // already wraps instead of forcing horizontal scroll, so shrinking width
    // + padding + font-size is enough, no icon-only mode needed.
    // The shell is CONCENTRIC, not proportional: outer radius = inner radius +
    // the gap between them, so 14 + 16 = 30 (and 14 + 10 = 24 on the rail).
    // The proportional rule gave 63px here and cut across the header plate's
    // own corner — a full-height panel has no designed short side to scale.
    <aside data-dark-surface className="sticky top-0 flex h-screen w-[244px] max-sm:w-[136px] flex-none flex-col gap-[3px] overflow-x-hidden overflow-y-auto rounded-r-[30px] max-sm:rounded-r-[24px] bg-sidebar p-4 max-sm:px-2.5 text-sidebar-text">
      {/* clipping layer keeps the overflowing circle out of the scrollable area,
          so the sidebar only scrolls when its actual content overflows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-r-[30px] max-sm:rounded-r-[24px]">
        <div className="absolute -right-[70px] -bottom-[60px] size-[200px] rounded-full bg-sidebar-inset opacity-70" />
      </div>

      {/* The header is a lockup plate, not a bare row: bg-sidebar-inset because
          a plate the same colour as the sidebar is no plate at all. Radius 14
          is measured off the reference lockup, not re-derived here (the plate
          renders 57px, which the proportional rule would round to 15). It is
          the fixed inner value the shell's concentric 30 (14 + 16) is built on,
          so it must not drift with this block. The circle that used to
          carry ₴/$ now carries the mark; the currency is still shown, and only
          shown, by the toggle at the bottom. */}
      <div className="relative mb-[22px] flex items-center justify-start gap-2.5 max-sm:gap-1.5 rounded-[14px] bg-sidebar-inset px-[15px] max-sm:px-2.5 py-2.5">
        <div className="grid size-9 max-sm:size-7 flex-none place-items-center rounded-full bg-sidebar-text text-sidebar">
          <Mark className="size-[18px] max-sm:size-[14px]" />
        </div>
        <div className="font-display text-base max-sm:text-[13px] leading-[1.15] font-semibold">
          Quirenote
          <br />
          {/* at the 136px rail the DEMO badge REPLACES this microline slot,
              so the nav is never pushed down (S5) */}
          <span
            className={`text-[9.5px] font-normal tracking-[.12em] text-sidebar-muted uppercase ${demo ? 'max-sm:hidden' : ''}`}
          >
            {t.sidebar.brandTagline}
          </span>
          {demo && (
            <span
              title={t.sidebar.demoTitle}
              className="font-body animate-in fade-in zoom-in-95 bg-warn-tint text-warn-tint-text hidden rounded-[4px] px-1.5 py-px text-[8px] font-bold tracking-[.08em] uppercase duration-200 max-sm:inline-block"
            >
              {t.sidebar.demoBadge}
            </span>
          )}
        </div>
        {demo && (
          // Pinned to the plate's top-right corner, inset by the plate's own
          // padding (15 / 10) so it sits on the same margin as everything else.
          // Shrunk to 0.75 by transform rather than by dividing every metric:
          // scaling keeps the badge's proportions exact, including the
          // radius-to-height ratio D56 fixed. `origin-top-right` so it shrinks
          // INTO the corner it is pinned to instead of away from it. Absolute,
          // so it no longer takes a slot in the flow the wordmark is laid out in.
          <span
            title={t.sidebar.demoTitle}
            className="font-body animate-in fade-in zoom-in-95 bg-warn-tint text-warn-tint-text absolute top-2.5 right-[15px] origin-top-right scale-75 rounded-[5px] px-2 py-[3px] text-[10px] font-bold tracking-[.08em] uppercase duration-200 max-sm:hidden"
          >
            {t.sidebar.demoBadge}
          </span>
        )}
      </div>

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

      <div className="relative mt-auto mb-2.5 flex gap-1 rounded-[13px] bg-sidebar-inset p-1.5">
        {/* sliding thumb (D7): shares the two buttons' geometry (p-1.5 + gap-1)
            so translateX(100% + gap) lands it exactly under the other segment.
            The width encodes that geometry as 50% − (padding + half the gap),
            so it MUST be re-derived whenever the container padding moves:
            p-1.5 (6px) + gap-1 (4px) → 50% − 8px. */}
        <div
          aria-hidden
          data-owns-motion
          className="absolute top-1.5 bottom-1.5 left-1.5 w-[calc(50%-8px)] rounded-[7px] bg-sidebar-text transition-transform duration-300 ease-soft"
          style={{ transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
        />
        <button
          type="button"
          aria-pressed={currency === 'UAH'}
          onClick={() => setCurrency('UAH')}
          className={`relative z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${currency === 'UAH' ? 'text-sidebar' : 'text-sidebar-nav hover:opacity-85'}`}
        >
          ₴ UAH
        </button>
        <button
          type="button"
          aria-pressed={currency === 'USD'}
          onClick={() => setCurrency('USD')}
          className={`relative z-10 flex-1 cursor-pointer rounded-[7px] py-1.5 text-xs font-bold transition active:scale-[.97] ${currency === 'USD' ? 'text-sidebar' : 'text-sidebar-nav hover:opacity-85'}`}
        >
          $ USD
        </button>
      </div>

      {/* Matches the currency toggle above it rather than the concentric 14:
          the two sit together as one bottom cluster, and a shared radius reads
          as a pair. The cost is that this corner alone is not concentric with
          the shell's. */}
      <div className="relative rounded-[13px] bg-sidebar-inset px-4 max-sm:px-3 py-3.5">
        <div className="text-[10px] tracking-[.12em] text-sidebar-muted uppercase">
          {t.sidebar.totalCapital}
        </div>
        {/* Literal white SURVIVES the Phase 5 purge, on purpose: the sidebar is
            an inverted plane in both themes (#26262a light, #0f0f11 dark), so
            white is correct on it — 19.15:1 in dark. Swapping it for
            `sidebar-text` would change the LIGHT theme, #ffffff to #e9e8e6,
            which A9 must not do. Same reasoning as `KpiCard` dark. */}
        <div className="font-display text-[21px] max-sm:text-base font-semibold text-white">
          {capital.value}
        </div>
        <div className="text-[11px] font-semibold text-pos-on-dark">{capital.sub}</div>
      </div>

      {/* (no sidebar Backup pill — relocated to Settings→Data in P2, S7) */}

      <div className="relative mt-2.5 text-center text-[9.5px] tracking-[.12em] text-sidebar-muted uppercase">
        v{__APP_VERSION__}
      </div>
    </aside>
  );
}
