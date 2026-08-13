import type { ReactNode } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { YIELD_LABEL_LONG } from '../components/ui/yield-labels';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { ordinal } from '../components/ui/date-labels';
import { COUPON_FREQUENCY, SCHEDULE_LABEL } from '../components/ui/schedule-labels';
import { daysBetween, latestSnapshotDate } from '../core/dates';
import { investedByAsset, latestQuotes, PORTFOLIO_START } from '../core/derive';
import { fmtDate, fmtPct, fmtProseWhole } from '../core/money';
import type { Asset, Transaction } from '../core/types';
import { actualAnnualizedPct, payoutScheduleFact } from './attributes/attributes';

// "Monthly · ~10th" — words assembled here from the pure module's
// {schedule, day} tokens (structured-returns rule, G1).
function payoutScheduleLabel(asset: Asset, transactions: Transaction[]): string {
  const fact = payoutScheduleFact(asset, transactions);
  const base = SCHEDULE_LABEL[fact.schedule];
  return fact.day ? `${base} · ~${ordinal(fact.day)}` : base;
}

// A <div>-wrapped dt/dd pair is valid dl content (HTML5 content model allows
// grouping dt+dd in a <div> child of <dl>) — keeps each fact as one grid cell
// (README §6.6's "2-col <dl>") while giving dt/dd their proper semantics.
// `m-0` neutralizes the default UA margin-inline-start on <dd> (Tailwind's
// preflight already zeroes it, but this keeps the layout explicit/robust).
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted text-[10.5px] tracking-[.08em] uppercase">{label}</dt>
      <dd className="m-0 text-[12.5px] font-bold">{children}</dd>
    </div>
  );
}

export function Attributes() {
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const now = latestSnapshotDate(snapshots);
  const daysHeld = now ? daysBetween(PORTFOLIO_START, now) : 0;

  function actualAnnualized(a: Asset) {
    const pct = actualAnnualizedPct(values[a.id], invested[a.id] ?? 0, daysHeld);
    if (pct === undefined) return <span className="text-muted">—</span>;
    return <span className={pct < 0 ? 'text-neg' : 'text-pos'}>{fmtPct(pct, 1)}</span>;
  }

  return (
    <div>
      <ScreenHeader
        title="Attributes"
        subtitle="Reference data per asset — created with a transaction, edited in Settings → Portfolio"
      />
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {assets.map((a, i) => {
          const isBond = a.yieldType === 'fixed_coupon';
          return (
            <Card
              key={a.id}
              radius={24}
              className="animate-in fade-in p-[22px] duration-300"
              style={{ animationDelay: `${(i % 4) * 60}ms` }}
            >
              <div className="mb-3.5 flex items-center gap-3">
                <AssetAvatar code={a.code} colorKey={a.colorKey} />
                <h3 className="m-0 text-[17px]">{a.name}</h3>
                <span className="ml-auto">
                  <Tag colorKey={a.colorKey}>{YIELD_LABEL_LONG[a.yieldType]}</Tag>
                </span>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2.5">
                {isBond ? (
                  <>
                    <Fact label="YTM at purchase">{a.expectedPct.toFixed(1)}% / yr</Fact>
                    <Fact label="Coupon">
                      {a.couponAmount !== undefined
                        ? `${fmtProseWhole(a.couponAmount)} ${COUPON_FREQUENCY[a.payoutSchedule]}`
                        : '—'}
                    </Fact>
                    <Fact label="Maturity">{a.maturity ? fmtDate(a.maturity) : '—'}</Fact>
                    <Fact label="Target share">{a.targetPct}%</Fact>
                    <Fact label="First purchase">{fmtDate(a.firstPurchase)}</Fact>
                    <Fact label="Next coupon">{a.nextCoupon ? fmtDate(a.nextCoupon) : '—'}</Fact>
                  </>
                ) : (
                  <>
                    <Fact label="Expected return">{a.expectedPct.toFixed(1)}% / yr</Fact>
                    <Fact label="Actual (ann.)">{actualAnnualized(a)}</Fact>
                    <Fact label="Payout schedule">{payoutScheduleLabel(a, transactions)}</Fact>
                    <Fact label="Target share">{a.targetPct}%</Fact>
                    <Fact label="First purchase">{fmtDate(a.firstPurchase)}</Fact>
                    <Fact label="Reinvest policy">{a.reinvestPolicy ?? '—'}</Fact>
                  </>
                )}
              </dl>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
