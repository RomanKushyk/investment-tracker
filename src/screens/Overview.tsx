import { Link } from 'react-router';

import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { EmptyState } from '../components/ui/EmptyState';
import { KpiCard } from '../components/ui/KpiCard';
import { ReminderStrip } from '../components/ui/ReminderStrip';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { ShareBar } from '../components/ui/ShareBar';
import { YIELD_LABEL_SHORT } from '../components/ui/yield-labels';
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
import { fmtPayoutDate } from '../components/ui/date-labels';
import { todayIso } from '../core/dates';
import {
  fmtDate,
  fmtDateShort,
  fmtPct,
  fmtProse,
  fmtProseWhole,
  signedPp,
  signedProse,
  toUsd,
} from '../core/money';
import { useSettings } from '../state/settings';
import { bondAbbrev, shortLabel } from './daily-quotes/quotes';
import {
  ledgerDriftChip,
  mostUnderweightAsset,
  nextPayoutRows,
  totalReturnKpi,
} from './overview/overview';

const STAGGER = ['', 'delay-75', 'delay-150', 'delay-200', 'delay-300'];

export function Overview() {
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
    ? { value: fmtProse(tweenedCapital, 'USD'), sub: `${fmtProse(total)} · rate ${usdRate}` }
    : { value: fmtProse(tweenedCapital), sub: `${fmtProse(capitalUsd, 'USD')} · rate ${usdRate}` };

  const tweenedNet = useTweenedNumber(usd ? toUsd(net.uah, usdRate) : net.uah);
  const netValue = usd ? signedProse(tweenedNet, 'USD') : signedProse(tweenedNet);

  // Total return (net) — S9a's new total-return-family KPI, currency-aware
  // like its siblings; the globalRoi sub stays a % (no conversion), "—" when null.
  const tweenedTotalReturn = useTweenedNumber(
    usd ? toUsd(totalReturn.uah, usdRate) : totalReturn.uah,
  );
  const totalReturnValue = usd
    ? signedProse(tweenedTotalReturn, 'USD')
    : signedProse(tweenedTotalReturn);

  const depositedUsd = toUsd(deposited, usdRate);
  const reinvestedUsd = toUsd(reinvested, usdRate);
  const tweenedDeposited = useTweenedNumber(usd ? depositedUsd : deposited);
  const deposit = usd
    ? { value: fmtProse(tweenedDeposited, 'USD'), sub: `+ ${fmtProse(reinvestedUsd, 'USD')} reinvested` }
    : { value: fmtProseWhole(tweenedDeposited), sub: `+ ${fmtProse(reinvested)} reinvested` };

  const tweenedCash = useTweenedNumber(usd ? toUsd(cash, usdRate) : cash);
  const cashValue = usd ? fmtProse(tweenedCash, 'USD') : fmtProse(tweenedCash);
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
        title="Overview"
        subtitle={`Portfolio at a glance · ${fmtDate(todayIso())} · rate ${usdRate} ₴/$`}
      />

      {/* min(200px,100%) caps auto-fit's track floor to the container width —
          plain minmax(200px,1fr) forces a 200px-wide overflow once the
          container itself drops below 200px (360px shell fix, item 1) */}
      <div className="mb-[26px] grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-3.5">
        <KpiCard
          tone="dark"
          className="animate-in fade-in slide-in-from-bottom-1 duration-300"
          label="Total capital"
          value={capital.value}
          sub={capital.sub}
          subClassName="text-pos-on-dark"
        />
        {/* S9a relabel (D13): capital-gain family — value/sub D5-pinned, label only. */}
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-75 duration-300"
          label="Capital gain"
          value={netValue}
          valueClassName={`whitespace-nowrap ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={`${fmtPct(net.pct)} since ${fmtDateShort(PORTFOLIO_START)}`}
          subClassName={`font-semibold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}
        />
        {/* S9a new 5th KPI: total-return family (globalRoi over net deposits). */}
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-150 duration-300"
          label="Total return (net)"
          value={totalReturnValue}
          valueClassName={`whitespace-nowrap ${totalReturn.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={totalReturn.roi === null ? '—' : `${fmtPct(totalReturn.roi)} on net deposits`}
          subClassName={
            totalReturn.roi === null
              ? 'text-muted'
              : `font-semibold ${totalReturn.roi < 0 ? 'text-neg' : 'text-pos'}`
          }
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-200 duration-300"
          label="Deposited / Reinvested"
          value={deposit.value}
          sub={deposit.sub}
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-300 duration-300"
          label="Free cash"
          value={cashValue}
          sub={
            <>
              {cashSharePct.toFixed(2)}% of account
              {/* S9d ledger-drift chip: warn tokens only (a reconciliation
                  nudge, not an error); hidden while |drift| ≤ ₴0.01 — demo
                  drift is 0 by construction. Re-keyed by value so a change
                  re-runs the entry animation (D7). */}
              {drift !== null && (
                <div className="mt-2">
                  <span
                    key={drift}
                    title="Stored cash differs from the transaction ledger. Record a missing deposit or withdrawal, or correct the snapshot's cash."
                    className="animate-in fade-in zoom-in-95 bg-warn-tint text-warn-tint-text inline-block rounded-[6px] px-3 py-1 text-xs font-semibold duration-200"
                  >
                    Ledger drift {signedProse(drift)}
                  </span>
                </div>
              )}
            </>
          }
        />
      </div>

      <div className="grid grid-cols-[1.5fr_1fr] items-start gap-3.5 max-lg:grid-cols-1">
        <Card radius={24} className="animate-in fade-in overflow-x-auto p-[22px] duration-300">
          <div className="text-muted mb-3.5 text-[10px] tracking-[.12em] uppercase">Assets</div>
          <div className="flex flex-col gap-3">
            {assets.map((a, i) => {
              const value = values[a.id] ?? 0;
              const yield_ = yieldSinceStart(value, invested[a.id] ?? 0);
              return (
                <div
                  key={a.id}
                  className={`animate-in fade-in slide-in-from-bottom-1 flex min-w-fit items-center gap-3.5 duration-300 ${STAGGER[i % STAGGER.length]}`}
                >
                  <ColorDot colorKey={a.colorKey} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{a.name}</span>
                  <span className="text-muted text-xs whitespace-nowrap">
                    {YIELD_LABEL_SHORT[a.yieldType]} · {sharePct(value, total).toFixed(1)}%
                  </span>
                  <strong className="w-[110px] text-right text-[13.5px]">{fmtProse(value)}</strong>
                  <span
                    className={`w-[60px] text-right text-xs font-bold ${yield_ < 0 ? 'text-neg' : 'text-pos'}`}
                  >
                    {fmtPct(yield_)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="bg-hairline my-4 h-px" />
          <ShareBar segments={shareSegments} />
        </Card>

        <div className="flex flex-col gap-3.5">
          <div className="animate-in fade-in bg-pos-tint rounded-3xl px-[22px] py-5 duration-300">
            <div className="text-pos-tint-text mb-1.5 text-[10px] tracking-[.12em] uppercase">
              Next payouts
            </div>
            <div className="flex flex-col gap-2 text-[13px]">
              {payoutRows.length === 0 && <span>No upcoming payouts.</span>}
              {payoutRows.map((r) => (
                <div key={r.assetId} className="flex justify-between gap-2">
                  <span>{r.kind === 'coupon' ? `Coupon ${r.assetRef}` : `${r.assetRef} dividend`}</span>
                  <strong className="whitespace-nowrap">
                    {r.approx ? '~' : ''}
                    {fmtProseWhole(r.amount)} · {fmtPayoutDate(r.date)}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <Card radius={24} className="animate-in fade-in p-5 duration-300">
            <div className="text-muted mb-1.5 text-[10px] tracking-[.12em] uppercase">
              Rebalance hint
            </div>
            {total === 0 ? (
              <EmptyState message="No snapshots yet — save your first daily quote to see the rebalance hint." height={44} />
            ) : underweight ? (
              <p className="text-[13px] leading-[1.5]">
                {underweight.asset.yieldType === 'fixed_coupon'
                  ? bondAbbrev(underweight.asset)
                  : shortLabel(underweight.asset)}{' '}
                is <strong className="text-neg">{signedPp(underweight.deltaPp, '%')}</strong>{' '}
                under its {underweight.asset.targetPct}% target — top up{' '}
                <strong>{fmtProse(underweight.topUp)}</strong>.
              </p>
            ) : (
              <p className="text-[13px]">Allocation is on target.</p>
            )}
            <Link to="/allocation" className={buttonVariants({ variant: 'ghost', inset: 'flushLeft' })}>
              Open Allocation →
            </Link>
          </Card>

          <KpiCard
            className="animate-in fade-in duration-300"
            label="Income received"
            value={fmtProse(income.total)}
            valueSize="md"
            sub={
              <>
                dividends {fmtProse(income.dividends)} · coupons {fmtProse(income.coupons)}
                {/* S9a net-of-tax line (incomeReceivedNet.total) — equals the
                    gross value while no tax rows exist (demo: taxes 0). */}
                <div>net of tax {fmtProse(incomeNet.total)}</div>
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
