import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { YIELD_LABEL_SHORT } from '../components/ui/yield-labels';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import {
  headlineTotal,
  investedByAsset,
  latestCash,
  latestQuotes,
  netResult,
  reinvestedByAsset,
  reinvestedTotal,
  sharePct,
  yieldSinceStart,
} from '../lib/derive';
import { fmtPct, fmtProse, fmtProseWhole, fmtTable } from '../lib/format';
import type { Asset } from '../lib/types';
import { bondAbbrev } from './daily-quotes/quotes';
import { bestPerformer, incomeEngine, laggard } from './portfolio/portfolio';
import { daysBetween, latestSnapshotDate } from './shared/dates';

// Signed table amount — "+2 902,10" / "−120,00" (P&L ₴ column; fmtTable has no sign).
// U+2212 minus (not ASCII '-'), matching the shared signedPp convention.
function signedTable(n: number): string {
  return (n < 0 ? '−' : '+') + fmtTable(Math.abs(n));
}

// Highlight-card asset label (design lines 478/483/488): bonds abbreviate to
// "OVDP …6475"; other assets show their full name ("Inzhur Energy").
function highlightLabel(asset: Asset): string {
  return asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : asset.name;
}

export function Portfolio() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const reinvested = reinvestedByAsset(transactions);
  const total = headlineTotal(snapshots);
  const cash = latestCash(snapshots);
  const net = netResult(values, invested);
  const investedTotal = Object.values(invested).reduce((a, b) => a + b, 0);

  const best = bestPerformer(assets, values, invested);
  const worst = laggard(assets, values, invested);
  const engine = incomeEngine(assets, transactions);

  const now = latestSnapshotDate(snapshots);
  const bestWeeks = best && now ? Math.round(daysBetween(best.asset.firstPurchase, now) / 7) : undefined;

  return (
    <div>
      <ScreenHeader title="Portfolio" subtitle="Positions, cost basis and result per asset" />

      <Card radius={24} className="animate-in fade-in mb-3.5 overflow-x-auto px-[22px] py-2.5 duration-300">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="text-muted text-left">
              <th className="py-2 font-normal">Asset</th>
              <th className="py-2 font-normal">Yield type</th>
              <th className="py-2 text-right font-normal">Invested, ₴</th>
              <th className="py-2 text-right font-normal">of it reinvested</th>
              <th className="py-2 text-right font-normal">Value now, ₴</th>
              <th className="py-2 text-right font-normal">P&amp;L, ₴</th>
              <th className="py-2 text-right font-normal">P&amp;L, %</th>
              <th className="py-2 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((a) => {
              const value = values[a.id] ?? 0;
              const inv = invested[a.id] ?? 0;
              const reinv = reinvested[a.id] ?? 0;
              const pnl = value - inv;
              const pnlPct = yieldSinceStart(value, inv);
              return (
                <tr
                  key={a.id}
                  className="border-hairline hover:bg-page/60 border-t transition-colors"
                >
                  <td className="py-2 font-semibold">{a.name}</td>
                  <td className="py-2">
                    <Tag colorKey={a.colorKey}>{YIELD_LABEL_SHORT[a.yieldType]}</Tag>
                  </td>
                  <td className="py-2 text-right">{fmtTable(inv)}</td>
                  <td className="py-2 text-right">{reinv > 0 ? fmtTable(reinv) : '—'}</td>
                  <td className="py-2 text-right">{fmtTable(value)}</td>
                  <td
                    className={`py-2 text-right font-bold ${pnl < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {signedTable(pnl)}
                  </td>
                  <td
                    className={`py-2 text-right font-bold ${pnlPct < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {fmtPct(pnlPct)}
                  </td>
                  <td className="py-2 text-right">{sharePct(value, total).toFixed(1)}%</td>
                </tr>
              );
            })}
            <tr className="border-panel-border border-t-2">
              <td className="py-2 font-bold">Total + cash {fmtProse(cash)}</td>
              <td className="py-2"></td>
              <td className="py-2 text-right font-bold">{fmtTable(investedTotal)}</td>
              <td className="py-2 text-right font-bold">{fmtTable(reinvestedTotal(transactions))}</td>
              <td className="py-2 text-right font-bold">{fmtTable(total)}</td>
              <td className={`py-2 text-right font-bold ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}>
                {signedTable(net.uah)}
              </td>
              <td className={`py-2 text-right font-bold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}>
                {fmtPct(net.pct)}
              </td>
              <td className="py-2 text-right font-bold">100%</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        {best ? (
          <KpiCard
            className="animate-in fade-in duration-300"
            valueSize="sm"
            label="Best performer"
            value={highlightLabel(best.asset)}
            sub={
              bestWeeks !== undefined ? (
                <span className="text-pos font-bold">
                  {fmtPct(best.yield)} in {bestWeeks} weeks
                </span>
              ) : undefined
            }
          />
        ) : (
          <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
            <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">Best performer</div>
            <EmptyState message="No quotes yet." height={40} />
          </Card>
        )}
        {worst ? (
          <KpiCard
            className="animate-in fade-in delay-75 duration-300"
            valueSize="sm"
            label="Laggard"
            value={highlightLabel(worst.asset)}
            sub={`${fmtPct(worst.yield)} · watch vs ${worst.asset.expectedPct}% expected`}
          />
        ) : (
          <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
            <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">Laggard</div>
            <EmptyState message="No quotes yet." height={40} />
          </Card>
        )}
        <KpiCard
          tone="tint"
          className="animate-in fade-in delay-150 duration-300"
          valueSize="sm"
          label="Income engine"
          value={engine ? highlightLabel(engine.asset) : '—'}
          sub={
            engine
              ? (() => {
                  const isDividends = engine.dividends >= engine.coupons;
                  const amount = isDividends ? engine.dividends : engine.coupons;
                  const kind = isDividends ? 'dividends' : 'coupons';
                  const reinvestedNote =
                    (reinvested[engine.asset.id] ?? 0) > 0 ? ' · auto-reinvested' : '';
                  return `${fmtProseWhole(amount)} ${kind}${reinvestedNote}`;
                })()
              : undefined
          }
          subClassName="text-pos-tint-text"
        />
      </div>
    </div>
  );
}
