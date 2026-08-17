import { Link } from 'react-router';

import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { ReminderStrip } from '../components/ui/ReminderStrip';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { ShareBar } from '../components/ui/ShareBar';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import {
  depositedTotal,
  headlineTotal,
  incomeReceived,
  incomeReceivedNet,
  investedByAsset,
  latestCash,
  latestQuotes,
  netResult,
  PORTFOLIO_START,
  reinvestedTotal,
  sharePct,
  soldAmount,
  yieldSinceStart,
} from '../core/derive';
import { todayIso } from '../core/dates';
import { toUsd } from '../core/money';
import { useSettings } from '../state/settings';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import {
  ledgerDriftChip,
  mostUnderweightAsset,
  nextPayoutRows,
  totalReturnKpi,
} from './overview/overview';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';

const STAGGER = ['', 'delay-75', 'delay-150', 'delay-200', 'delay-300'];

export function Overview() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];
  const { currency, usdRate } = useSettings();
  const usd = currency === 'USD';

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const total = headlineTotal(snapshots);
  const cash = latestCash(snapshots);
  const net = netResult(values, invested, soldAmount(transactions));
  const deposited = depositedTotal(transactions);
  const reinvested = reinvestedTotal(transactions);
  const income = incomeReceived(transactions);
  const incomeNet = incomeReceivedNet(transactions);
  const totalReturn = totalReturnKpi(snapshots, transactions);
  const drift = ledgerDriftChip(snapshots, transactions);

  // Currency-aware KPI grid (renderVals ovCap/ovCapSub/ovNet/ovDep/ovDepSub/ovCash) —
  // only these headline cards convert; tables and every other card stay ₴.
  // Each main figure tweens numerically (~300ms, D7) whenever it changes —
  // on the currency toggle above all, but also on new data.
  const capitalUsd = toUsd(total, usdRate);
  const tweenedCapital = useTweenedNumber(usd ? capitalUsd : total);
  const capital = usd
    ? {
        value: f.money(tweenedCapital, 'USD'),
        // f.units on the rate: it is a figure like any other, and 44.83 beside
        // a Ukrainian 149 016 ₴ reads as a different notation for the same page.
        sub: t.analytics.prose.withRate(f.money(total), f.units(usdRate)),
      }
    : {
        value: f.money(tweenedCapital),
        sub: t.analytics.prose.withRate(f.money(capitalUsd, 'USD'), f.units(usdRate)),
      };

  const tweenedNet = useTweenedNumber(usd ? toUsd(net.uah, usdRate) : net.uah);
  const netValue = usd ? f.signedMoney(tweenedNet, 'USD') : f.signedMoney(tweenedNet);

  // Total return (net) — S9a's new total-return-family KPI, currency-aware
  // like its siblings; the globalRoi sub stays a % (no conversion), "—" when null.
  const tweenedTotalReturn = useTweenedNumber(
    usd ? toUsd(totalReturn.uah, usdRate) : totalReturn.uah,
  );
  const totalReturnValue = usd
    ? f.signedMoney(tweenedTotalReturn, 'USD')
    : f.signedMoney(tweenedTotalReturn);

  const depositedUsd = toUsd(deposited, usdRate);
  const reinvestedUsd = toUsd(reinvested, usdRate);
  const tweenedDeposited = useTweenedNumber(usd ? depositedUsd : deposited);
  const deposit = usd
    ? {
        value: f.money(tweenedDeposited, 'USD'),
        sub: t.analytics.prose.plusReinvested(f.money(reinvestedUsd, 'USD')),
      }
    : {
        value: f.moneyWhole(tweenedDeposited),
        sub: t.analytics.prose.plusReinvested(f.money(reinvested)),
      };

  const tweenedCash = useTweenedNumber(usd ? toUsd(cash, usdRate) : cash);
  const cashValue = usd ? f.money(tweenedCash, 'USD') : f.money(tweenedCash);
  const cashSharePct = total === 0 ? 0 : (cash / total) * 100;

  const shareSegments = assets.map((a) => ({
    colorKey: a.colorKey,
    pct: sharePct(values[a.id] ?? 0, total),
  }));

  const underweight = mostUnderweightAsset(assets, values, total);
  const payoutRows = nextPayoutRows(assets, transactions);

  return (
    <div>
      {/* S6 — the strip sits ABOVE the ScreenHeader; it renders nothing when no
          reminder fires, so the screen keeps its exact pre-P3 layout. */}
      <ReminderStrip place="overview" />
      <ScreenHeader
        title={t.screen.overview.title}
        subtitle={t.screen.overview.subtitle(f.date(todayIso()), f.units(usdRate))}
      />

      {/* min(200px,100%) caps auto-fit's track floor to the container width —
          plain minmax(200px,1fr) forces a 200px-wide overflow once the
          container itself drops below 200px (360px shell fix, item 1) */}
      <div className="mb-[26px] grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
        <KpiCard
          tone="dark"
          className="animate-in fade-in slide-in-from-bottom-1 duration-300"
          label={t.analytics.overview.totalCapital}
          value={capital.value}
          sub={capital.sub}
          subClassName="text-pos-on-dark"
        />
        {/* S9a relabel (D13): capital-gain family — value/sub D5-pinned, label only. */}
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-75 duration-300"
          label={t.analytics.overview.capitalGain}
          value={netValue}
          valueClassName={`whitespace-nowrap ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={t.analytics.prose.sinceDate(f.pct(net.pct), f.dateShort(PORTFOLIO_START))}
          subClassName={`font-semibold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}
        />
        {/* S9a new 5th KPI: total-return family (globalRoi over net deposits). */}
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-150 duration-300"
          label={t.analytics.overview.totalReturnNet}
          value={totalReturnValue}
          valueClassName={`whitespace-nowrap ${totalReturn.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={
            totalReturn.roi === null
              ? '—'
              : t.analytics.prose.onNetDeposits(f.pct(totalReturn.roi))
          }
          subClassName={
            totalReturn.roi === null
              ? 'text-muted'
              : `font-semibold ${totalReturn.roi < 0 ? 'text-neg' : 'text-pos'}`
          }
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-200 duration-300"
          label={t.analytics.overview.depositedReinvested}
          value={deposit.value}
          sub={deposit.sub}
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-300 duration-300"
          label={t.analytics.overview.freeCash}
          value={cashValue}
          sub={
            <>
              {t.analytics.prose.ofAccount(f.pctPlain(cashSharePct, 2))}
              {/* S9d ledger-drift chip: warn tokens only (a reconciliation
                  nudge, not an error); hidden while |drift| ≤ ₴0.01 — demo
                  drift is 0 by construction. Re-keyed by value so a change
                  re-runs the entry animation (D7). */}
              {drift !== null && (
                <div className="mt-2">
                  <span
                    key={drift}
                    title={t.analytics.overview.ledgerDrift}
                    className="animate-in fade-in zoom-in-95 bg-warn-tint text-warn-tint-text inline-block rounded-[6px] px-3 py-1 text-xs font-semibold duration-200"
                  >
                    {t.analytics.overview.ledgerDriftLabel(f.signedMoney(drift))}
                  </span>
                </div>
              )}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in fade-in p-[22px] duration-300">
          <div className="text-muted mb-3.5 text-[10px] tracking-[.12em] uppercase">{t.analytics.overview.assets}</div>
          {/* Only the ROWS scroll. They carry `min-w-fit` with fixed value
              columns, so they are the one thing in this card that can outgrow
              it — the divider, the totals and the ShareBar below must stay
              put, which is why the Scroller wraps the list and not the Card. */}
          <Scroller orientation="horizontal">
            <div className="flex flex-col gap-3">
              {assets.map((a, i) => {
                const value = values[a.id] ?? 0;
                const yield_ = yieldSinceStart(value, invested[a.id] ?? 0);
                return (
                  // A4 — THE FIXED VALUE COLUMNS DROP BELOW THE BREAKPOINT, and
                  // the row folds to two lines instead of losing a field. The
                  // 110 and 60 exist to align five rows' figures into a column;
                  // that is worth 170px of a 1.5fr card and not worth 170px of a
                  // 336px phone, where they make the row `min-w-fit` and push a
                  // horizontal rail under a list that would otherwise fit.
                  // Measured at 292px of usable card width: name, type·share,
                  // value and yield are 311px on one line and 285px on two. So
                  // the identity keeps line 1 and the three figures take line 2
                  // — nothing is hidden, which is owner decision 1 (full parity,
                  // not a phone subset). Above the breakpoint nothing moves.
                  <div
                    key={a.id}
                    className={`animate-in fade-in slide-in-from-bottom-1 flex min-w-fit items-center gap-3.5 duration-300 max-md:min-w-0 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1 ${STAGGER[i % STAGGER.length]}`}
                  >
                    <ColorDot colorKey={a.colorKey} />
                    {/* `basis-[calc(100%-18px)]` is the dot (10) plus the row's
                        gap (8): it fills line 1 exactly, which is what makes the
                        three figures wrap together rather than one at a time. */}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold max-md:basis-[calc(100%-18px)]">
                      {a.name}
                    </span>
                    <span className="text-muted text-xs whitespace-nowrap">
                      {t.asset.yieldShort[a.yieldType]} · {f.pctPlain(sharePct(value, total))}
                    </span>
                    <strong className="w-[110px] text-right text-[13.5px] whitespace-nowrap max-md:ml-auto max-md:w-auto">
                      {f.money(value)}
                    </strong>
                    <span
                      className={`w-[60px] text-right text-xs font-bold whitespace-nowrap max-md:w-auto ${yield_ < 0 ? 'text-neg' : 'text-pos'}`}
                    >
                      {f.pct(yield_)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Scroller>
          <div className="bg-hairline my-4 h-px" />
          <ShareBar segments={shareSegments} />
        </Card>

        <div className="flex flex-col gap-3.5">
          <div className="animate-in fade-in bg-pos-tint rounded-3xl px-[22px] py-5 duration-300">
            <div className="text-pos-tint-text mb-1.5 text-[10px] tracking-[.12em] uppercase">
              {t.analytics.overview.nextPayouts}
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
              {payoutRows.length === 0 && <span>{t.analytics.noUpcoming}</span>}
              {payoutRows.map((r) => (
                <div key={r.assetId} className="flex justify-between gap-2">
                  <span>
                    {r.kind === 'coupon'
                      ? t.analytics.prose.couponOf(r.assetRef)
                      : t.analytics.prose.dividendOf(r.assetRef)}
                  </span>
                  <strong className="whitespace-nowrap">
                    {r.approx ? '~' : ''}
                    {f.moneyWhole(r.amount)} · {f.dateShort(r.date)}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <Card radius={24} className="animate-in fade-in p-5 duration-300">
            <div className="text-muted mb-1.5 text-[10px] tracking-[.12em] uppercase">
              {t.analytics.overview.rebalanceHint}
            </div>
            {total === 0 ? (
              <EmptyState message={t.analytics.empty.rebalance} height={44} />
            ) : underweight ? (
              <p className="text-[13px] leading-[1.5]">
                {underweight.asset.yieldType === 'fixed_coupon'
                  ? bondAbbrev(underweight.asset)
                  : shortLabel(underweight.asset)}{' '}
                {t.analytics.prose.rebalanceIs}{' '}
                <strong className="text-neg">{f.pp(underweight.deltaPp, '%')}</strong>{' '}
                {t.analytics.prose.underTarget(f.pctPlain(underweight.asset.targetPct, 0))}{' '}
                <strong>{f.money(underweight.topUp)}</strong>.
              </p>
            ) : (
              <p className="text-[13px]">{t.analytics.overview.onTarget}</p>
            )}
            <Link to="/allocation" className={buttonVariants({ variant: 'ghost', inset: 'flushLeft' })}>
              {t.analytics.overview.openAllocation}
            </Link>
          </Card>

          <KpiCard
            className="animate-in fade-in duration-300"
            label={t.analytics.overview.incomeReceived}
            value={f.money(income.total)}
            valueSize="md"
            sub={
              <>
                {t.analytics.prose.dividendsCouponsSplit(
                  f.money(income.dividends),
                  f.money(income.coupons),
                )}
                {/* S9a net-of-tax line (incomeReceivedNet.total) — equals the
                    gross value while no tax rows exist (demo: taxes 0). */}
                <div>{t.analytics.prose.netOfTax(f.money(incomeNet.total))}</div>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
