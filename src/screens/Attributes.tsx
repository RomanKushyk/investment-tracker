import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { daysBetween, latestSnapshotDate } from '../core/dates';
import { investedByAsset, latestQuotes, portfolioStart } from '../core/derive';
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

export function Attributes() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? [];
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? [];

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const now = latestSnapshotDate(snapshots);
  const start = portfolioStart(assets, snapshots, transactions);
  // Still ONE span for every asset — D5#5's global basis, unchanged by A24.
  // Deriving the date does not make it per-asset; that is O23.
  const daysHeld = now && start ? daysBetween(start, now) : 0;

  function actualAnnualized(a: Asset) {
    const pct = actualAnnualizedPct(values[a.id], invested[a.id] ?? 0, daysHeld);
    if (pct === undefined) return <span className="text-muted">—</span>;
    return <span className={pct < 0 ? 'text-neg' : 'text-pos'}>{f.pct(pct, 1)}</span>;
  }

  return (
    <div>
      <ScreenHeader title={t.screen.attributes.title} subtitle={t.screen.attributes.subtitle} />
      {/* The card that the other four screens now borrow lives in
          `components/ui/RecordCard` — this screen is where its anatomy was
          designed, so it reads from there rather than keeping a second copy. */}
      <div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
        {assets.map((a, i) => {
          const isBond = a.yieldType === 'fixed_coupon';
          return (
            <RecordCard
              key={a.id}
              index={i}
              avatar={<AssetAvatar code={a.code} colorKey={a.colorKey} />}
              title={a.name}
              tag={<Tag colorKey={a.colorKey}>{t.asset.yieldLong[a.yieldType]}</Tag>}
            >
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
            </RecordCard>
          );
        })}
      </div>
    </div>
  );
}
