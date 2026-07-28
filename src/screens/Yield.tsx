import { YieldLines } from '../components/charts/YieldLines';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { fmtPct, fmtTable } from '../lib/format';
import { cumulativeYieldSeries, yieldTableRows } from './yield/yield';

// Signed "pp" gap — "-4.7 pp" / "+0.3 pp" (vs expected column; fmtPct's % suffix doesn't fit here).
function signedPp(n: number): string {
  return (n < 0 ? '-' : '+') + Math.abs(n).toFixed(1) + ' pp';
}

export function Yield() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const series = cumulativeYieldSeries(snapshots, transactions, assets);
  const rows = yieldTableRows(assets, snapshots, transactions);

  return (
    <div>
      <ScreenHeader title="Yield" subtitle="Cumulative return per asset since first purchase, %" />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        <div className="text-muted mb-2 flex flex-wrap gap-4 text-[11.5px]">
          {assets.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <ColorDot colorKey={a.colorKey} />
              {a.name}
            </span>
          ))}
        </div>
        <YieldLines data={series} assets={assets} />
      </Card>

      <Card radius={24} className="animate-in fade-in overflow-x-auto px-[22px] py-2.5 duration-300">
        <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-muted text-left">
              <th className="py-2 font-normal">Asset</th>
              <th className="py-2 text-right font-normal">Invested, ₴</th>
              <th className="py-2 text-right font-normal">Value now, ₴</th>
              <th className="py-2 text-right font-normal">Δ total</th>
              <th className="py-2 text-right font-normal">Annualized</th>
              <th className="py-2 text-right font-normal">vs expected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.asset.id} className="border-hairline hover:bg-page/60 border-t transition-colors">
                <td className="py-2 font-semibold">{r.asset.name}</td>
                <td className="py-2 text-right">{fmtTable(r.invested)}</td>
                <td className="py-2 text-right">{fmtTable(r.value)}</td>
                <td className={`py-2 text-right font-bold ${r.deltaTotal < 0 ? 'text-neg' : 'text-pos'}`}>
                  {fmtPct(r.deltaTotal)}
                </td>
                <td className="py-2 text-right">{fmtPct(r.annualized, 1)}</td>
                <td className={`py-2 text-right ${r.vsExpectedPp < 0 ? 'text-neg' : 'text-pos'}`}>
                  {signedPp(r.vsExpectedPp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-muted mt-2.5 text-[11.5px]">
          Annualized = total Δ scaled to 365 days from first purchase (03.02.2026). Coupons count toward Δ
          on accrual.
        </div>
      </Card>
    </div>
  );
}
