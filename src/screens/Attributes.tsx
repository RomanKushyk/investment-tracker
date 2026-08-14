import type { ReactNode } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Card } from '../components/ui/Card';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { daysBetween, latestSnapshotDate } from '../core/dates';
import { investedByAsset, latestQuotes, PORTFOLIO_START } from '../core/derive';
import type { Asset, Transaction } from '../core/types';
import { actualAnnualizedPct, payoutScheduleFact } from './attributes/attributes';
import { useFormat } from '../hooks/useFormat';
import type { Dict } from '../i18n/messages';
import { useT } from '../i18n/useT';

// "Monthly · ~10th" — words assembled here from the pure module's
// {schedule, day} tokens (structured-returns rule, G1).
function payoutScheduleLabel(asset: Asset, transactions: Transaction[], t: Dict): string {
  const fact = payoutScheduleFact(asset, transactions);
  const base = t.asset.schedule[fact.schedule];
  return fact.day ? `${base} · ~${t.dates.dayOfMonth(fact.day)}` : base;
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
  const f = useFormat();
  const t = useT();
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
    return <span className={pct < 0 ? 'text-neg' : 'text-pos'}>{f.pct(pct, 1)}</span>;
  }

  return (
    <div>
      <ScreenHeader title={t.screen.attributes.title} subtitle={t.screen.attributes.subtitle} />
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
                  <Tag colorKey={a.colorKey}>{t.asset.yieldLong[a.yieldType]}</Tag>
                </span>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-4.5 gap-y-2.5">
                {isBond ? (
                  <>
                    <Fact label={t.analytics.attributes.ytmAtPurchase}>
                      {f.pctPlain(a.expectedPct)} {t.analytics.perYear}
                    </Fact>
                    <Fact label={t.analytics.attributes.coupon}>
                      {a.couponAmount !== undefined
                        ? `${f.moneyWhole(a.couponAmount)} ${t.asset.couponFrequency[a.payoutSchedule]}`
                        : '—'}
                    </Fact>
                    <Fact label={t.analytics.attributes.maturity}>{a.maturity ? f.date(a.maturity) : '—'}</Fact>
                    <Fact label={t.analytics.attributes.targetShare}>
                      {f.pctPlain(a.targetPct, Number.isInteger(a.targetPct) ? 0 : 1)}
                    </Fact>
                    <Fact label={t.analytics.attributes.firstPurchase}>{f.date(a.firstPurchase)}</Fact>
                    <Fact label={t.analytics.attributes.nextCoupon}>{a.nextCoupon ? f.date(a.nextCoupon) : '—'}</Fact>
                  </>
                ) : (
                  <>
                    <Fact label={t.analytics.attributes.expectedReturn}>
                      {f.pctPlain(a.expectedPct)} {t.analytics.perYear}
                    </Fact>
                    <Fact label={t.analytics.attributes.actualAnn}>{actualAnnualized(a)}</Fact>
                    <Fact label={t.analytics.attributes.payoutSchedule}>{payoutScheduleLabel(a, transactions, t)}</Fact>
                    <Fact label={t.analytics.attributes.targetShare}>
                      {f.pctPlain(a.targetPct, Number.isInteger(a.targetPct) ? 0 : 1)}
                    </Fact>
                    <Fact label={t.analytics.attributes.firstPurchase}>{f.date(a.firstPurchase)}</Fact>
                    <Fact label={t.analytics.attributes.reinvestPolicy}>{a.reinvestPolicy ?? '—'}</Fact>
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
