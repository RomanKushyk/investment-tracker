import { Link } from 'react-router';

import { buttonVariants } from '../components/ui/button-variants';
import { Card } from '../components/ui/Card';
import { ColorDot } from '../components/ui/ColorDot';
import { KpiCard } from '../components/ui/KpiCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { ShareBar } from '../components/ui/ShareBar';
import { YIELD_LABEL_SHORT } from '../components/ui/yield-labels';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import {
  depositedTotal,
  headlineTotal,
  incomeReceived,
  investedByAsset,
  latestCash,
  latestQuotes,
  netResult,
  PORTFOLIO_START,
  reinvestedTotal,
  sharePct,
  yieldSinceStart,
} from '../lib/derive';
import { fmtDate, fmtDateShort, fmtPct, fmtProse, fmtProseWhole, toUsd } from '../lib/format';
import { useSettings } from '../state/settings';
import { shortLabel } from './daily-quotes/quotes';
import { mostUnderweightAsset, nextPayoutRows } from './overview/overview';

const STAGGER = ['', 'delay-75', 'delay-150', 'delay-200', 'delay-300'];

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Signed prose amount — "+₴4,452.61" / "-₴120.00" (netResult/rebalance figures).
function signedProse(n: number, currency: 'UAH' | 'USD' = 'UAH'): string {
  return (n < 0 ? '-' : '+') + fmtProse(Math.abs(n), currency);
}

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
  const net = netResult(values, invested);
  const deposited = depositedTotal(transactions);
  const reinvested = reinvestedTotal(transactions);
  const income = incomeReceived(transactions);

  // Currency-aware KPI grid (renderVals ovCap/ovCapSub/ovNet/ovDep/ovDepSub/ovCash) —
  // only these headline cards convert; tables and every other card stay ₴.
  const capitalUsd = toUsd(total, usdRate);
  const capital = usd
    ? { value: fmtProse(capitalUsd, 'USD'), sub: `${fmtProse(total)} · rate ${usdRate}` }
    : { value: fmtProse(total), sub: `${fmtProse(capitalUsd, 'USD')} · rate ${usdRate}` };

  const netValue = usd ? signedProse(toUsd(net.uah, usdRate), 'USD') : signedProse(net.uah);

  const depositedUsd = toUsd(deposited, usdRate);
  const reinvestedUsd = toUsd(reinvested, usdRate);
  const deposit = usd
    ? { value: fmtProse(depositedUsd, 'USD'), sub: `+ ${fmtProse(reinvestedUsd, 'USD')} reinvested` }
    : { value: fmtProseWhole(deposited), sub: `+ ${fmtProse(reinvested)} reinvested` };

  const cashValue = usd ? fmtProse(toUsd(cash, usdRate), 'USD') : fmtProse(cash);
  const cashSharePct = total === 0 ? 0 : (cash / total) * 100;

  const shareSegments = assets.map((a) => ({
    colorKey: a.colorKey,
    pct: sharePct(values[a.id] ?? 0, total),
  }));

  const underweight = mostUnderweightAsset(assets, values, total);
  const payoutRows = nextPayoutRows(assets, transactions);

  return (
    <div>
      <ScreenHeader
        title="Overview"
        subtitle={`Portfolio at a glance · ${fmtDate(todayIso())} · rate ${usdRate} ₴/$`}
      />

      <div className="mb-[26px] grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3.5">
        <KpiCard
          tone="dark"
          className="animate-in fade-in slide-in-from-bottom-1 duration-300"
          label="Total capital"
          value={capital.value}
          sub={capital.sub}
          subClassName="text-pos-on-dark"
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-75 duration-300"
          label="Net result"
          value={netValue}
          valueClassName={`whitespace-nowrap ${net.uah < 0 ? 'text-neg' : 'text-pos'}`}
          sub={`${fmtPct(net.pct)} since ${fmtDateShort(PORTFOLIO_START)}`}
          subClassName={`font-semibold ${net.pct < 0 ? 'text-neg' : 'text-pos'}`}
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-150 duration-300"
          label="Deposited / Reinvested"
          value={deposit.value}
          sub={deposit.sub}
        />
        <KpiCard
          className="animate-in fade-in slide-in-from-bottom-1 delay-200 duration-300"
          label="Free cash"
          value={cashValue}
          sub={`${cashSharePct.toFixed(2)}% of account`}
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
                  <span>{r.label}</span>
                  <strong className="whitespace-nowrap">
                    {r.amountLabel} · {r.dateLabel}
                  </strong>
                </div>
              ))}
            </div>
          </div>

          <Card radius={24} className="animate-in fade-in p-5 duration-300">
            <div className="text-muted mb-1.5 text-[10px] tracking-[.12em] uppercase">
              Rebalance hint
            </div>
            {underweight ? (
              <p className="text-[13px] leading-[1.5]">
                {underweight.asset.yieldType === 'fixed_coupon'
                  ? `${underweight.asset.name.split(' ')[0]} ${shortLabel(underweight.asset)}`
                  : shortLabel(underweight.asset)}{' '}
                is <strong className="text-neg">{fmtPct(underweight.deltaPp / 100, 1)}</strong>{' '}
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
            sub={`dividends ${fmtProse(income.dividends)} · coupons ${fmtProse(income.coupons)}`}
          />
        </div>
      </div>
    </div>
  );
}
