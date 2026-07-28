import { AllocationDonut } from '../components/charts/AllocationDonut';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots } from '../hooks/queries';
import { headlineTotal, latestQuotes, sharePct } from '../lib/derive';
import { fmtProseWhole } from '../lib/format';
import type { Asset, ColorKey } from '../lib/types';
import { allocationRows, rebalancePlan } from './allocation/allocation';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import { signedPp } from './shared/format';

const BAR_BG: Record<ColorKey, string> = {
  reit: 'bg-reit',
  energy: 'bg-energy',
  ovdp8976: 'bg-ovdp8976',
  ovdp6475: 'bg-ovdp6475',
};

// Rebalance plan bond label: "OVDP …8976" (abbreviated); other assets keep
// their full name — matches Portfolio's highlight-card convention.
function planLabel(asset: Asset): string {
  return asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : asset.name;
}

export function Allocation() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];

  const values = latestQuotes(snapshots);
  const total = headlineTotal(snapshots);

  const slices = assets.map((a) => ({ asset: a, value: values[a.id] ?? 0 }));
  const rows = allocationRows(assets, values, total);
  const { actions, withinRange } = rebalancePlan(assets, values, total);

  return (
    <div>
      <ScreenHeader title="Allocation" subtitle="Current mix vs targets set in asset attributes" />

      <div className="grid grid-cols-[340px_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in fade-in flex flex-col items-center p-[22px] duration-300">
          {total === 0 ? (
            <EmptyState message="No snapshots yet — save your first daily quote to see the allocation mix." height={220} />
          ) : (
            <AllocationDonut
              slices={slices}
              centerTop={`₴${Math.round(total / 1000)}k`}
              centerSub={`${assets.length} ${assets.length === 1 ? 'asset' : 'assets'} + cash`}
            />
          )}
          <div className="mt-2.5 flex w-full flex-col gap-1.5 text-xs">
            {assets.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <ColorDot colorKey={a.colorKey} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="font-bold">{sharePct(values[a.id] ?? 0, total).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card radius={24} className="animate-in fade-in p-[22px] duration-300">
            <div className="text-muted mb-3.5 text-[10px] tracking-[.12em] uppercase">
              Current vs target
            </div>
            <div className="flex flex-col gap-3.5">
              {rows.map((r) => (
                <div key={r.asset.id}>
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span className="font-semibold">{r.asset.name}</span>
                    <span>
                      {r.share.toFixed(1)}% / {r.target}%{' '}
                      <strong className={r.severity === 'off' ? 'text-neg' : 'text-pos'}>
                        {signedPp(r.deltaPp)}
                      </strong>
                    </span>
                  </div>
                  <div className="bg-hairline relative h-2.5 rounded-full">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ease-soft ${BAR_BG[r.asset.colorKey]}`}
                      style={{ width: `${r.share}%` }}
                    />
                    <div
                      className="bg-ink absolute -top-[3px] h-4 w-0.5"
                      style={{ left: `${r.target}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="animate-in fade-in bg-panel border-panel-border rounded-3xl border px-[22px] py-5 duration-300">
            <div className="text-label mb-2 text-[10px] tracking-[.12em] uppercase">Rebalance plan</div>
            <div className="flex flex-col gap-2 text-[13px]">
              {actions.map((a, i) => (
                <div key={a.asset.id} className="flex justify-between gap-2.5">
                  <span>
                    {i + 1} · {a.kind === 'buy' ? 'Buy' : 'Trim'} {planLabel(a.asset)}
                    {a.kind === 'sell' && a.asset.reinvestPolicy ? ' (or pause reinvest)' : ''}
                  </span>
                  <strong className="whitespace-nowrap">
                    {a.kind === 'buy' ? '+' : '−'}
                    {fmtProseWhole(a.amount)}
                  </strong>
                </div>
              ))}
              {withinRange.length > 0 && (
                <div className="text-muted flex justify-between gap-2.5">
                  <span>{withinRange.map((a) => shortLabel(a)).join(' & ')}</span>
                  <span>within ±0.5% — no action</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
