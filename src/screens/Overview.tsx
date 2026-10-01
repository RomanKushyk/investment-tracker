import { useMemo } from 'react';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { Link } from 'react-router';

import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { ReminderStrip } from '../components/ui/ReminderStrip';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { usePeriodWindow } from '../hooks/usePeriodWindow';
import { ShareBar } from '../components/ui/ShareBar';
import { Share } from '../components/ui/Share';
import { CashShortChip } from '../components/ui/CashShortChip';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { useToday } from '../hooks/useToday';
import { useTweenedNumber } from '../hooks/useTweenedNumber';
import { toUsd } from '@quirenote/core/money';
import { useSettings } from '../state/settings';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import { overviewView } from '@quirenote/core/view/overview';
import { useFormat } from '../hooks/useFormat';
import { useT } from '../i18n/useT';
import { Scroller } from '../components/ui/Scroller';

const STAGGER = ['', 'delay-75', 'delay-150', 'delay-200', 'delay-300'];

// Stable empties, so `?? []` does not hand `useMemo` a new array every render.
const NO_ASSETS: Asset[] = [];
const NO_SNAPSHOTS: Snapshot[] = [];
const NO_TRANSACTIONS: Transaction[] = [];

export function Overview() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const snapshots = useSnapshots().data ?? NO_SNAPSHOTS;
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;
  // NARROWED: `useSettings()` with no selector re-renders this screen on ANY store
  // change — the currency toggle and every unrelated field.
  const currency = useSettings((s) => s.currency);
  const usdRate = useSettings((s) => s.usdRate);
  const usd = currency === 'USD';

  const { period, control } = usePeriodWindow(assets, snapshots, transactions);
  // Memoized: five tweens re-render this every frame. `today` is state, so the next payouts and
  // the subtitle move on at midnight: a payout dated before today is not next.
  const today = useToday();
  const view = useMemo(
    () => overviewView({ assets, snapshots, transactions, period, today }),
    [assets, snapshots, transactions, period, today],
  );
  const { total, cash, cashShort, deposited, reinvested, net, totalReturn, income, incomeNet } =
    view;
  const win = view.window;
  // Only these headline cards convert; tables and every other card stay ₴.
  const capitalUsd = toUsd(total, usdRate);
  const tweenedCapital = useTweenedNumber(usd ? capitalUsd : total);
  const capital = usd
    ? {
        value: f.money(tweenedCapital, 'USD'),
        // `f.units` on the rate: it is a figure like any other, and a bare 44.83 beside a
        // grouped ₴ total reads as a different notation for the same page.
        sub: t.analytics.prose.withRate(f.money(total), f.units(usdRate)),
      }
    : {
        value: f.money(tweenedCapital),
        sub: t.analytics.prose.withRate(f.money(capitalUsd, 'USD'), f.units(usdRate)),
      };

  const tweenedNet = useTweenedNumber(usd ? toUsd(net.uah, usdRate) : net.uah);
  const netValue = usd ? f.signedMoney(tweenedNet, 'USD') : f.signedMoney(tweenedNet);

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

  const shareSegments = view.rows.map((r) => ({
    colorKey: r.asset.colorKey,
    // A bar has no «—»: an absent share draws no segment.
    pct: r.share ?? 0,
  }));

  const { underweight, nextPayouts: payoutRows } = view;

  return (
    <div>
      {/* The strip renders nothing when no reminder fires, so the screen keeps its layout. */}
      <ReminderStrip place="overview" />
      <ScreenHeader
        title={t.screen.overview.title}
        subtitle={t.screen.overview.subtitle(f.date(today), f.units(usdRate))}
        actions={control}
      />

      {/* min(200px,100%) caps auto-fit's track floor to the container width — plain
          minmax(200px,1fr) forces an overflow once the container drops below it. */}
      <div className="mb-[26px] grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
        <KpiCard
          tone="wall"
          className="animate-in duration-300 fade-in slide-in-from-bottom-1"
          label={t.analytics.overview.totalCapital}
          value={capital.value}
          sub={capital.sub}
          subClassName="text-pos"
        />
        <KpiCard
          className="animate-in delay-75 duration-300 fade-in slide-in-from-bottom-1"
          label={t.analytics.overview.capitalGain}
          value={netValue}
          valueClassName={`whitespace-nowrap ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}
          // A card measured ACROSS the window points at its LEFT end, which is the end that
          // moves on every press. `sinceDate` already names that end exactly, so it is fed
          // `win.from` and no copy is invented.
          sub={win ? t.analytics.prose.sinceDate(f.pct(net.pct), f.dateShort(win.from)) : undefined}
          subClassName={`font-semibold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}
        />
        <KpiCard
          className="animate-in delay-150 duration-300 fade-in slide-in-from-bottom-1"
          label={t.analytics.overview.totalReturnNet}
          value={totalReturnValue}
          valueClassName={`whitespace-nowrap ${totalReturn.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={
            <>
              {totalReturn.roi === null
                ? '—'
                : t.analytics.prose.onNetDeposits(f.pct(totalReturn.roi))}
              {/* The cards that MOVE point at the window's left end. This one carries its
                  denominator name already, so the date joins it rather than replacing it. */}
              {totalReturn.roi !== null && win !== undefined && ` · ${f.dateShort(win.from)}`}
              {/* THE PORTFOLIO XIRR LANDS HERE, and the argument is about BOUNDARIES: this
                  card is the one figure already measured at the portfolio's edge, and
                  `portfolioXirr` is defined entirely there too. Every column on `/yield` is
                  measured at the ASSET boundary, so this number has no honest cell in that
                  table — under the XIRR column it reads as the assets' total, and in a Total
                  row of dashes it reads as a table that broke. */}
              {view.portfolioXirr !== null && (
                <div className="mt-1 text-xs font-normal text-muted">
                  {view.xirrExtrapolated
                    ? t.period.portfolioXirrAnn(f.pct(view.portfolioXirr))
                    : t.period.portfolioXirr(f.pct(view.portfolioXirr))}
                </div>
              )}
            </>
          }
          subClassName={
            totalReturn.roi === null
              ? 'text-muted'
              : `font-semibold ${totalReturn.roi < 0 ? 'text-neg' : 'text-pos'}`
          }
        />
        <KpiCard
          className="animate-in delay-200 duration-300 fade-in slide-in-from-bottom-1"
          label={t.analytics.overview.depositedReinvested}
          value={deposit.value}
          sub={deposit.sub}
        />
        <KpiCard
          className="animate-in delay-300 duration-300 fade-in slide-in-from-bottom-1"
          label={t.analytics.overview.freeCash}
          value={cashValue}
          sub={
            <>
              {view.cashShare === null ? (
                <Share pct={null} />
              ) : (
                t.analytics.prose.ofAccount(f.pctPlain(view.cashShare, 2))
              )}
              {cashShort && (
                <div className="mt-2">
                  <CashShortChip />
                </div>
              )}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in p-[22px] duration-300 fade-in">
          <div className="mb-3.5 text-[10px] tracking-[.12em] text-muted uppercase">
            {t.analytics.overview.assets}
          </div>
          {/* Only the ROWS scroll: they carry `min-w-fit` with fixed value columns, so
              they are the one thing that can outgrow the card, and the divider, the totals
              and the ShareBar must stay put. */}
          <Scroller orientation="horizontal">
            <div className="flex flex-col gap-3">
              {view.rows.map(({ asset: a, value, share, yield: yield_ }, i) => {
                return (
                  // THE FIXED VALUE COLUMNS DROP BELOW THE BREAKPOINT, and the row folds to two
                  // lines instead of losing a field. Those widths exist to align five rows'
                  // figures into a column, which is worth part of a wide card and not of a phone,
                  // where they make the row `min-w-fit` and push a horizontal rail under a list
                  // that would otherwise fit. Nothing is hidden — full parity, not a phone subset.
                  <div
                    key={a.id}
                    className={`flex min-w-fit animate-in items-center gap-3.5 duration-300 fade-in slide-in-from-bottom-1 max-md:min-w-0 max-md:flex-wrap max-md:gap-x-2 max-md:gap-y-1 ${STAGGER[i % STAGGER.length]}`}
                  >
                    <ColorDot colorKey={a.colorKey} />
                    {/* `basis-[calc(100%-18px)]` is the dot plus the row's gap: it fills line 1
                        exactly, which is what makes the three figures wrap together. */}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold max-md:basis-[calc(100%-18px)]">
                      {a.name}
                    </span>
                    <span className="text-xs whitespace-nowrap text-muted">
                      {t.asset.yieldShort[a.yieldType]} · <Share pct={share} />
                    </span>
                    <strong className="w-[110px] text-right text-[13.5px] whitespace-nowrap max-md:ml-auto max-md:w-auto">
                      {f.money(value)}
                    </strong>
                    <span
                      className={`w-[60px] text-right text-xs font-bold whitespace-nowrap max-md:w-auto ${yield_ === undefined ? 'text-muted' : yield_ < 0 ? 'text-neg' : 'text-pos'}`}
                    >
                      {yield_ === undefined ? '—' : f.pct(yield_)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Scroller>
          <div className="my-4 h-px bg-hairline" />
          <ShareBar segments={shareSegments} />
        </Card>

        <div className="flex flex-col gap-3.5">
          <div className="animate-in rounded-3xl bg-pos-tint px-[22px] py-5 duration-300 fade-in">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-pos-tint-text uppercase">
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

          <Card radius={24} className="animate-in p-5 duration-300 fade-in">
            <div className="mb-1.5 text-[10px] tracking-[.12em] text-muted uppercase">
              {t.analytics.overview.rebalanceHint}
            </div>
            {/* A short ledger proposes nothing and says why; no total at all is the empty state. */}
            {!view.usable ? (
              cashShort ? (
                <CashShortChip />
              ) : (
                total === 0 && <EmptyState message={t.analytics.empty.rebalance} height={44} />
              )
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
            <Link
              to="/allocation"
              className={buttonVariants({ variant: 'ghost', inset: 'flushLeft' })}
            >
              {t.analytics.overview.openAllocation}
            </Link>
          </Card>

          <KpiCard
            className="animate-in duration-300 fade-in"
            label={t.analytics.overview.incomeReceived}
            value={f.money(income.total)}
            valueSize="md"
            sub={
              <>
                {t.analytics.prose.dividendsCouponsSplit(
                  f.money(income.dividends),
                  f.money(income.coupons),
                )}
                {/* The two categories printed above come from the GROSS figure while only the
                    NET total is read here, so the split and the total are deliberately on
                    different bases. */}
                <div>{t.analytics.prose.netOfTax(f.money(incomeNet.total))}</div>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
