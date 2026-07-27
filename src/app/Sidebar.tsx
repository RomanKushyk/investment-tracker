import { NavLink } from 'react-router';

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
    `relative block w-full rounded-full px-3.5 ${padY} text-left text-[13.5px] hover:opacity-85 ` +
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

export function Sidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-[232px] flex-none flex-col gap-[3px] overflow-x-hidden overflow-y-auto rounded-r-[32px] bg-sidebar px-4 py-[26px] text-sidebar-text">
      {/* clipping layer keeps the overflowing circle out of the scrollable area,
          so the sidebar only scrolls when its actual content overflows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-r-[32px]">
        <div className="absolute -right-[70px] -bottom-[60px] size-[200px] rounded-full bg-sidebar-inset opacity-70" />
      </div>

      <div className="relative mx-1.5 mb-[22px] flex items-center gap-2.5">
        <div className="grid size-9 flex-none place-items-center rounded-full bg-sidebar-text font-display text-[17px] font-bold text-ink">
          ₴
        </div>
        <div className="font-display text-base leading-[1.15] font-semibold">
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
        <button
          type="button"
          className="flex-1 cursor-pointer rounded-full bg-sidebar-text py-1.5 text-xs font-bold text-ink"
        >
          ₴ UAH
        </button>
        <button
          type="button"
          className="flex-1 cursor-pointer rounded-full bg-transparent py-1.5 text-xs font-bold text-sidebar-nav"
        >
          $ USD
        </button>
      </div>

      <div className="relative rounded-[20px] bg-sidebar-inset px-4 py-3.5">
        <div className="text-[10px] tracking-[.12em] text-sidebar-muted uppercase">
          Total capital
        </div>
        <div className="font-display text-[21px] font-semibold text-white">—</div>
        <div className="text-[11px] font-semibold text-pos-on-dark">—</div>
      </div>
    </aside>
  );
}
