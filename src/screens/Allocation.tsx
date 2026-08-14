import { AllocationDonut } from '../components/charts/AllocationDonut';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots } from '../hooks/queries';
import { headlineTotal, latestQuotes, sharePct } from '../core/derive';
import type { Asset, ColorKey } from '../core/types';
import { allocationRows, rebalancePlan } from './allocation/allocation';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';

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
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];

  const values = latestQuotes(snapshots);
  const total = headlineTotal(snapshots);

  const slices = assets.map((a) => ({ asset: a, value: values[a.id] ?? 0 }));
  const rows = allocationRows(assets, values, total);
  const { actions, withinRange } = rebalancePlan(assets, values, total);

  return (
    <div>
      <ScreenHeader title={t.screen.allocation.title} subtitle={t.screen.allocation.subtitle} />

      <div className="grid grid-cols-[340px_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in fade-in flex flex-col items-center p-[22px] duration-300">
          {total === 0 ? (
            <EmptyState message={t.analytics.empty.allocation} height={220} />
          ) : (
            <AllocationDonut
              slices={slices}
              centerTop={t.analytics.allocation.centerTotal(Math.round(total / 1000))}
              centerSub={t.analytics.allocation.assetsPlusCash(assets.length)}
            />
          )}
          <div className="mt-2.5 flex w-full flex-col gap-1.5 text-xs">
            {assets.map((a) => (
              <div key={a.id} className="flex items-center gap-2">
                <ColorDot colorKey={a.colorKey} />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="font-bold">{f.pctPlain(sharePct(values[a.id] ?? 0, total))}</span>
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-3.5">
          <Card radius={24} className="animate-in fade-in p-[22px] duration-300">
            <div className="text-muted mb-3.5 text-[10px] tracking-[.12em] uppercase">
              {t.analytics.allocation.currentVsTarget}
            </div>
            <div className="flex flex-col gap-3.5">
              {rows.map((r) => (
                <div key={r.asset.id}>
                  <div className="mb-1.5 flex justify-between text-[12.5px]">
                    <span className="font-semibold">{r.asset.name}</span>
                    <span>
                      {f.pctPlain(r.share)} / {f.pctPlain(r.target, 0)}{' '}
                      <strong className={r.severity === 'off' ? 'text-neg' : 'text-pos'}>
                        {f.pp(r.deltaPp)}
                      </strong>
                    </span>
                  </div>
                  <div className="bg-hairline relative h-2.5 rounded-[3px]">
                    <div
                      className={`h-full rounded-[3px] transition-[width] duration-500 ease-soft ${BAR_BG[r.asset.colorKey]}`}
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
            <div className="text-label mb-2 text-[10px] tracking-[.12em] uppercase">{t.analytics.allocation.rebalancePlan}</div>
            <div className="flex flex-col gap-2 text-[13px]">
              {actions.map((a, i) => (
                <div key={a.asset.id} className="flex justify-between gap-2.5">
                  <span>
                    {i + 1} · {a.kind === 'buy' ? t.analytics.allocation.buy : t.analytics.allocation.trim}{' '}
                    {planLabel(a.asset)}
                    {a.kind === 'sell' && a.asset.reinvestPolicy
                      ? t.analytics.allocation.orPauseReinvest
                      : ''}
                  </span>
                  <strong className="whitespace-nowrap">
                    {a.kind === 'buy' ? '+' : '−'}
                    {f.moneyWhole(a.amount)}
                  </strong>
                </div>
              ))}
              {withinRange.length > 0 && (
                <div className="text-muted flex justify-between gap-2.5">
                  <span>{withinRange.map((a) => shortLabel(a)).join(' & ')}</span>
                  <span>{t.analytics.allocation.withinRange}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
