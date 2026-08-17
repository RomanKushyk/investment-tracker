import { YieldLines } from '../components/charts/YieldLines';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { cumulativeYieldSeries, xirrIsExtrapolated, yieldTableRows } from './yield/yield';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { PORTFOLIO_START } from '../core/derive';
import { Scroller } from '../components/ui/Scroller';

export function Yield() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const series = cumulativeYieldSeries(snapshots, transactions, assets);
  const rows = yieldTableRows(assets, snapshots, transactions);
  // "(ann.)" clarity suffix while history < 365 days (S9b) — plain "XIRR" after.
  const xirrHeader = xirrIsExtrapolated(snapshots)
    ? t.analytics.yield.xirrAnn
    : t.analytics.yield.xirr;

  return (
    <div>
      <ScreenHeader title={t.screen.yield.title} subtitle={t.screen.yield.subtitle} />

      <Card radius={24} className="animate-in fade-in mb-3.5 p-[22px] duration-300">
        <div className="text-muted mb-2 flex flex-wrap gap-4 text-[11.5px]">
          {assets.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5">
              <ColorDot colorKey={a.colorKey} />
              {a.name}
            </span>
          ))}
        </div>
        {series.length === 0 ? (
          <EmptyState message={t.analytics.empty.chart} height={280} />
        ) : (
          <YieldLines data={series} assets={assets} />
        )}
      </Card>

      <Card radius={24} className="animate-in fade-in px-[22px] py-2.5 duration-300">
        {/* The table keeps its min-width; the Scroller is what clips and draws
            the rail. Card no longer sets overflow — a rounded card clipping its
            own content is where the square platform track came from. */}
        <Scroller orientation="horizontal">
          <table className="w-full min-w-[780px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-muted text-left">
                <th className="py-2 font-normal">{t.analytics.asset}</th>
                <th className="py-2 text-right font-normal">{t.analytics.invested}</th>
                <th className="py-2 text-right font-normal">{t.analytics.valueNow}</th>
                <th className="py-2 text-right font-normal">{t.analytics.deltaTotal}</th>
                <th className="py-2 text-right font-normal">{t.analytics.annualized}</th>
                <th className="py-2 text-right font-normal">{t.analytics.totalReturn}</th>
                <th className="py-2 text-right font-normal">{xirrHeader}</th>
                <th className="py-2 text-right font-normal">{t.analytics.vsExpected}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset.id} className="border-hairline hover:bg-page/60 border-t transition-colors">
                  <td className="py-2 font-semibold">{r.asset.name}</td>
                  <td className="py-2 text-right">{f.num(r.invested)}</td>
                  <td className="py-2 text-right">{r.value === undefined ? '—' : f.num(r.value)}</td>
                  <td
                    className={`py-2 text-right font-bold ${r.deltaTotal === undefined ? 'text-muted' : r.deltaTotal < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {r.deltaTotal === undefined ? '—' : f.pct(r.deltaTotal)}
                  </td>
                  <td className="py-2 text-right">{r.annualized === undefined ? '—' : f.pct(r.annualized, 1)}</td>
                  <td
                    className={`py-2 text-right font-bold ${r.totalReturn == null ? 'text-muted' : r.totalReturn < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {r.totalReturn == null ? '—' : f.pct(r.totalReturn)}
                  </td>
                  <td className={`py-2 text-right ${r.xirr == null ? 'text-muted' : ''}`}>
                    {r.xirr == null ? '—' : f.pct(r.xirr, 1)}
                  </td>
                  <td
                    className={`py-2 text-right ${r.vsExpectedPp === undefined ? 'text-muted' : r.vsExpectedPp < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {r.vsExpectedPp === undefined ? '—' : f.pp(r.vsExpectedPp, t.analytics.ppSuffix)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
        <div className="text-muted mt-2.5 text-[11.5px]">
          {t.analytics.prose.yieldNote(f.date(PORTFOLIO_START))}
        </div>
      </Card>
    </div>
  );
}
