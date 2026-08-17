import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
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
  soldAmount,
  yieldSinceStart,
} from '../core/derive';
import { daysBetween, latestSnapshotDate } from '../core/dates';
import type { Asset } from '../core/types';
import { bondAbbrev } from './daily-quotes/quotes';
import { bestPerformer, incomeEngine, laggard } from './portfolio/portfolio';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';

// Highlight-card asset label (design lines 478/483/488): bonds abbreviate to
// "OVDP …6475"; other assets show their full name ("Inzhur Energy").
function highlightLabel(asset: Asset): string {
  return asset.yieldType === 'fixed_coupon' ? bondAbbrev(asset) : asset.name;
}

export function Portfolio() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const reinvested = reinvestedByAsset(transactions);
  const total = headlineTotal(snapshots);
  const cash = latestCash(snapshots);
  const net = netResult(values, invested, soldAmount(transactions));
  const investedTotal = Object.values(invested).reduce((a, b) => a + b, 0);

  const best = bestPerformer(assets, values, invested);
  const worst = laggard(assets, values, invested);
  const engine = incomeEngine(assets, transactions);

  const now = latestSnapshotDate(snapshots);
  const bestWeeks = best && now ? Math.round(daysBetween(best.asset.firstPurchase, now) / 7) : undefined;

  return (
    <div>
      <ScreenHeader title={t.screen.portfolio.title} subtitle={t.screen.portfolio.subtitle} />

      <Card radius={24} className="animate-in fade-in mb-3.5 px-[22px] py-2.5 duration-300">
        {/* The table keeps its min-width; the Scroller is what clips and draws
            the rail. Card no longer sets overflow — a rounded card clipping its
            own content is where the square platform track came from. */}
        <Scroller orientation="horizontal">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-muted text-left">
                <th className="py-2 font-normal">{t.analytics.asset}</th>
                <th className="py-2 font-normal">{t.analytics.yieldType}</th>
                <th className="py-2 text-right font-normal">{t.analytics.invested}</th>
                <th className="py-2 text-right font-normal">{t.analytics.ofItReinvested}</th>
                <th className="py-2 text-right font-normal">{t.analytics.valueNow}</th>
                {/* S9c relabel (D13): capital-gain family, disambiguated from
                    the Yield screen's Total return — values unchanged. */}
                <th className="py-2 text-right font-normal">{t.analytics.capitalGainUah}</th>
                <th className="py-2 text-right font-normal">{t.analytics.capitalGainPct}</th>
                <th className="py-2 text-right font-normal">{t.analytics.share}</th>
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
                      <Tag colorKey={a.colorKey}>{t.asset.yieldShort[a.yieldType]}</Tag>
                    </td>
                    <td className="py-2 text-right">{f.num(inv)}</td>
                    <td className="py-2 text-right">{reinv > 0 ? f.num(reinv) : '—'}</td>
                    <td className="py-2 text-right">{f.num(value)}</td>
                    <td
                      className={`py-2 text-right font-bold ${pnl < 0 ? 'text-neg' : 'text-pos'}`}
                    >
                      {f.signedNum(pnl)}
                    </td>
                    <td
                      className={`py-2 text-right font-bold ${pnlPct < 0 ? 'text-neg' : 'text-pos'}`}
                    >
                      {f.pct(pnlPct)}
                    </td>
                    <td className="py-2 text-right">{f.pctPlain(sharePct(value, total))}</td>
                  </tr>
                );
              })}
              <tr className="border-panel-border border-t-2">
                <td className="py-2 font-bold">{t.analytics.prose.totalPlusCash(f.money(cash))}</td>
                <td className="py-2"></td>
                <td className="py-2 text-right font-bold">{f.num(investedTotal)}</td>
                <td className="py-2 text-right font-bold">{f.num(reinvestedTotal(transactions))}</td>
                <td className="py-2 text-right font-bold">{f.num(total)}</td>
                <td className={`py-2 text-right font-bold ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}>
                  {f.signedNum(net.uah)}
                </td>
                <td className={`py-2 text-right font-bold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}>
                  {f.pct(net.pct)}
                </td>
                <td className="py-2 text-right font-bold">{f.pctPlain(100, 0)}</td>
              </tr>
            </tbody>
          </table>
        </Scroller>
        <div className="text-muted mt-2.5 text-[11.5px]">
          {t.analytics.prose.capitalGainNote}
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-3.5 max-md:grid-cols-1">
        {best ? (
          <KpiCard
            className="animate-in fade-in duration-300"
            valueSize="sm"
            label={t.analytics.portfolio.bestPerformer}
            value={highlightLabel(best.asset)}
            sub={
              bestWeeks !== undefined ? (
                <span className="text-pos font-bold">
                  {t.analytics.prose.inWeeks(f.pct(best.yield), bestWeeks)}
                </span>
              ) : undefined
            }
          />
        ) : (
          <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
            <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">{t.analytics.portfolio.bestPerformer}</div>
            <EmptyState message={t.analytics.portfolio.noQuotes} height={40} />
          </Card>
        )}
        {worst ? (
          <KpiCard
            className="animate-in fade-in delay-75 duration-300"
            valueSize="sm"
            label={t.analytics.portfolio.laggard}
            value={highlightLabel(worst.asset)}
            sub={t.analytics.prose.watchVsExpected(f.pct(worst.yield), f.pctPlain(worst.asset.expectedPct))}
          />
        ) : (
          <Card radius={24} className="animate-in fade-in px-[22px] py-5 duration-300">
            <div className="text-muted mb-1 text-[10px] tracking-[.12em] uppercase">{t.analytics.portfolio.laggard}</div>
            <EmptyState message={t.analytics.portfolio.noQuotes} height={40} />
          </Card>
        )}
        <KpiCard
          tone="tint"
          className="animate-in fade-in delay-150 duration-300"
          valueSize="sm"
          label={t.analytics.portfolio.incomeEngine}
          value={engine ? highlightLabel(engine.asset) : '—'}
          sub={
            engine
              ? (() => {
                  const isDividends = engine.dividends >= engine.coupons;
                  const amount = isDividends ? engine.dividends : engine.coupons;
                  const kind = isDividends
                    ? t.analytics.portfolio.dividendsWord
                    : t.analytics.portfolio.couponsWord;
                  const reinvestedNote =
                    (reinvested[engine.asset.id] ?? 0) > 0 ? t.analytics.portfolio.autoReinvested : '';
                  return `${f.moneyWhole(amount)} ${kind}${reinvestedNote}`;
                })()
              : undefined
          }
          subClassName="text-pos-tint-text"
        />
      </div>
    </div>
  );
}
