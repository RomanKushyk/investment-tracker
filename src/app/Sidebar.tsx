import { NavLink } from 'react-router';

import { useSnapshots, useTransactions } from '../hooks/queries';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import { headlineKpis } from '../core/derive';
import { fmtPct, fmtProse, fmtProseWhole, toUsd } from '../core/money';
import { useSettings } from '../state/settings';

const ANALYTICS = [
  { to: '/overview', label: 'Overview' },
  { to: '/balances', label: 'Balances' },
  { to: '/payouts', label: 'Payouts' },
  { to: '/yield', label: 'Yield' },
  { to: '/attributes', label: 'Attributes' },
  { to: '/seasonality', label: 'Seasonality' },
  { to: '/portfolio', label: 'Portfolio' },
  { to: '/allocation', label: 'Allocation' },
];

function pillClass(padY: string) {
  return ({ isActive }: { isActive: boolean }) =>
    `relative block w-full rounded-full px-3.5 ${padY} text-left text-[13.5px] transition select-none hover:opacity-85 active:scale-[.97] ` +
    (isActive
      ? 'bg-sidebar-text font-bold text-ink'
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
    ? { value: fmtProseWhole(tweened), sub: `${fmtPct(kpis.net.pct)} · ${fmtProse(usdTotal, 'USD')}` }
    : { value: fmtProse(tweened, 'USD'), sub: `${fmtPct(kpis.net.pct)} · ${fmtProse(total)}` };
}

export function Sidebar() {
  const { currency, setCurrency } = useSettings();
  const capital = useCapitalCard();
  return (
    // w-[232px] is the design's fixed desktop sidebar; below `sm` (640px) it
    // narrows to a compact rail (item 1, 360px shell fix) — every label below
    // already wraps instead of forcing horizontal scroll, so shrinking width
    // + padding + font-size is enough, no icon-only mode needed.
    <aside className="sticky top-0 flex h-screen w-[232px] max-sm:w-[136px] flex-none flex-col gap-[3px] overflow-x-hidden overflow-y-auto rounded-r-[32px] bg-sidebar px-4 max-sm:px-2.5 py-[26px] text-sidebar-text">
      {/* clipping layer keeps the overflowing circle out of the scrollable area,
          so the sidebar only scrolls when its actual content overflows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-r-[32px]">
        <div className="absolute -right-[70px] -bottom-[60px] size-[200px] rounded-full bg-sidebar-inset opacity-70" />
      </div>

      <div className="relative mx-1.5 mb-[22px] flex items-center gap-2.5 max-sm:gap-1.5">
        <div
          key={currency}
          className="animate-in zoom-in-50 fade-in grid size-9 max-sm:size-7 flex-none place-items-center rounded-full bg-sidebar-text font-display text-[17px] max-sm:text-[13px] font-bold text-ink duration-200"
        >
          {currency === 'UAH' ? '₴' : '$'}
        </div>
        <div className="font-display text-base max-sm:text-[13px] leading-[1.15] font-semibold">
          Kubushka
          <br />
          <span className="text-[9.5px] font-normal tracking-[.12em] text-sidebar-muted uppercase">
            Invest tracker
          </span>
        </div>
      </div>

      <GroupLabel>Daily entry</GroupLabel>
      <NavLink to="/" className={pillClass('py-[9px]')}>
        Daily quotes
      </NavLink>

      <GroupLabel className="mt-4">Analytics</GroupLabel>
      {ANALYTICS.map(({ to, label }) => (
        <NavLink key={to} to={to} className={pillClass('py-2')}>
          {label}
        </NavLink>
      ))}

      <div className="relative mt-auto mb-2.5 flex gap-1 rounded-full bg-sidebar-inset p-1">
        {/* sliding thumb (D7): shares the two buttons' geometry (p-1 + gap-1) so
            translateX(100% + gap) lands it exactly under the other segment */}
        <div
          aria-hidden
          className="absolute top-1 bottom-1 left-1 w-[calc(50%-6px)] rounded-full bg-sidebar-text transition-transform duration-300 ease-soft"
          style={{ transform: currency === 'UAH' ? 'translateX(0)' : 'translateX(calc(100% + 4px))' }}
        />
        <button
          type="button"
          aria-pressed={currency === 'UAH'}
          onClick={() => setCurrency('UAH')}
          className={`relative z-10 flex-1 cursor-pointer rounded-full py-1.5 text-xs font-bold transition active:scale-[.97] ${currency === 'UAH' ? 'text-ink' : 'text-sidebar-nav hover:opacity-85'}`}
        >
          ₴ UAH
        </button>
        <button
          type="button"
          aria-pressed={currency === 'USD'}
          onClick={() => setCurrency('USD')}
          className={`relative z-10 flex-1 cursor-pointer rounded-full py-1.5 text-xs font-bold transition active:scale-[.97] ${currency === 'USD' ? 'text-ink' : 'text-sidebar-nav hover:opacity-85'}`}
        >
          $ USD
        </button>
      </div>

      <div className="relative rounded-[20px] bg-sidebar-inset px-4 max-sm:px-3 py-3.5">
        <div className="text-[10px] tracking-[.12em] text-sidebar-muted uppercase">
          Total capital
        </div>
        <div className="font-display text-[21px] max-sm:text-base font-semibold text-white">
          {capital.value}
        </div>
        <div className="text-[11px] font-semibold text-pos-on-dark">{capital.sub}</div>
      </div>

      <div className="relative mt-2.5 text-center text-[9.5px] tracking-[.12em] text-sidebar-muted uppercase">
        v{__APP_VERSION__}
      </div>
    </aside>
  );
}
