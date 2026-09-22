import { useMemo } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { daysBetween, latestSnapshotDate } from '@quirenote/core/dates';
import { couponPerPayment } from '@quirenote/core/accrual';
import {
  basisIsShort,
  investedByAsset,
  latestQuotes,
  portfolioStart,
  startDateByAsset,
  unitsByAsset,
} from '@quirenote/core/derive';
import type { Asset, Transaction } from '@quirenote/core/types';
import {
  actualAnnualizedPct,
  derivedYtmPct,
  payoutScheduleFact,
} from '@quirenote/core/view/attributes';
import { useInzhurAssets } from '../hooks/useInzhurAssets';
import { useFormat } from '../hooks/useFormat';
import type { Dict } from '../i18n/messages';
import { useT } from '../i18n/useT';

function payoutScheduleLabel(asset: Asset, transactions: Transaction[], t: Dict): string {
  const fact = payoutScheduleFact(asset, transactions);
  const base = t.asset.schedule[fact.schedule];
  return fact.day ? `${base} · ~${t.dates.dayOfMonth(fact.day)}` : base;
}

// One frozen instance, so a fresh `[]` per render does not defeat the units memo.
const NO_TRANSACTIONS: Transaction[] = [];
const NO_ASSETS: Asset[] = [];

export function Attributes() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;
  // `useMemo`: `unitsByAsset` walks the whole ledger, and this screen renders one
  // card per asset.
  const assetUnits = useMemo(() => unitsByAsset(transactions), [transactions]);
  // WHATEVER THE APP ALREADY HAS — `data` when a fetch has run this session,
  // otherwise the last-good cache. This screen deliberately does NOT trigger a
  // fetch: a reference table that quietly hits the provider on open is what the
  // picker's "first open, never on mount" rule exists to prevent.
  const { data, lastGood } = useInzhurAssets();
  const feed = (data ?? lastGood)?.feed;
  // MEMOIZED because it is the expensive one: per bond it rebuilds the feed's ref
  // Map and runs `impliedYield`'s bisection over the whole payment schedule.
  const ytmByAsset = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of assets) {
      const solved = derivedYtmPct(a, transactions, feed);
      if (solved !== undefined) out[a.id] = solved;
    }
    return out;
  }, [assets, transactions, feed]);

  const values = latestQuotes(snapshots);
  const invested = investedByAsset(transactions);
  const now = latestSnapshotDate(snapshots);
  const start = portfolioStart(assets, snapshots, transactions);
  const daysHeld = now && start ? daysBetween(start, now) : 0;

  // THE SAME FIGURE MUST CARRY THE SAME MARK ON BOTH SCREENS. This is
  // `annualizedPct` over the same global basis as `/yield`'s, so greying it there
  // and painting it green here would assert one number as trustworthy and
  // untrustworthy at once, one tab apart.
  // ON THE SEED IT MARKS NOTHING, which is worth stating rather than discovering.
  // The figure lives in the NON-coupon branch below, so the two bonds never reach
  // it at all, and the two that do — REIT and Energy — both start at the
  // portfolio's own start, so neither basis is short. The first market asset bought
  // mid-basis is where the two screens would have disagreed.
  const startByAsset = startDateByAsset(assets, transactions);
  function actualAnnualized(a: Asset) {
    const pct = actualAnnualizedPct(values[a.id], invested[a.id] ?? 0, daysHeld);
    if (pct === undefined) return <span className="text-muted">—</span>;
    const from = startByAsset[a.id];
    const short =
      start !== undefined &&
      from !== undefined &&
      basisIsShort(daysBetween(from > start ? from : start, now ?? start), daysHeld);
    return (
      <span
        className={short ? 'text-muted' : pct < 0 ? 'text-neg' : 'text-pos'}
        title={short ? t.analytics.prose.shortBasisNote : undefined}
      >
        {f.pct(pct, 1)}
      </span>
    );
  }

  return (
    <div>
      <ScreenHeader title={t.screen.attributes.title} subtitle={t.screen.attributes.subtitle} />
      {/* The card the other four screens borrow lives in `components/ui/RecordCard`;
          this screen is where its anatomy was designed. */}
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
                    {/* DERIVED when it can be: the price this holder paid, solved against the bond's
                        own schedule on the day they bought. The stored `expectedPct` shows when any
                        of the three inputs is missing.
                        DISCLOSED when the two DIFFER, because the rest of the app still measures
                        against the stored figure — `/yield`'s comparison, `dailyAccrual`'s fallback
                        and `couponProjection`'s estimate all read `expectedPct` — so one bond can
                        legitimately show two numbers a tab apart.
                        VISIBLE TEXT, not a `title`: `title` never opens on touch, below the
                        breakpoint the app IS the phone shell, and colour alone does not carry
                        meaning (WCAG 1.4.1). */}
                    {(() => {
                      const solved = ytmByAsset[a.id];
                      // COMPARED AT THE PRECISION IT IS RENDERED AT. A 0.05 pp threshold is exactly
                      // the rounding boundary of one decimal, so two values could pass the gate and
                      // then print identically — a disclosure naming no difference. Comparing the
                      // strings makes the two questions one question, and it cannot drift if the
                      // formatter changes.
                      const shown = f.pctPlain(solved ?? a.expectedPct);
                      const differs = solved !== undefined && shown !== f.pctPlain(a.expectedPct);
                      return (
                        <>
                          <span>
                            {shown} {t.analytics.perYear}
                          </span>
                          {differs && (
                            <span className="mt-1 block text-[10.5px] leading-[1.4] font-normal text-muted">
                              {t.analytics.prose.ytmDerived(f.pctPlain(a.expectedPct))}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </Fact>
                  <Fact label={t.analytics.attributes.coupon}>
                    {/* The coupon this POSITION pays, derived from the rate and the ledger's units —
                        it moves when the holding does, which the stored figure never did. */}
                    {(() => {
                      // ONE binding, one answer: calling it twice forced a `!` on the second to
                      // re-narrow what the first proved.
                      const coupon = couponPerPayment(a, assetUnits[a.id]);
                      return coupon === undefined
                        ? '—'
                        : `${f.moneyWhole(coupon)} ${t.asset.couponFrequency[a.payoutSchedule]}`;
                    })()}
                  </Fact>
                  <Fact label={t.analytics.attributes.maturity}>
                    {a.maturity ? f.date(a.maturity) : '—'}
                  </Fact>
                  <Fact label={t.analytics.attributes.targetShare}>
                    {f.pctPlain(a.targetPct, Number.isInteger(a.targetPct) ? 0 : 1)}
                  </Fact>
                  <Fact label={t.analytics.attributes.firstPurchase}>
                    {f.date(a.firstPurchase)}
                  </Fact>
                  <Fact label={t.analytics.attributes.nextCoupon}>
                    {a.nextCoupon ? f.date(a.nextCoupon) : '—'}
                  </Fact>
                </>
              ) : (
                <>
                  <Fact label={t.analytics.attributes.expectedReturn}>
                    {f.pctPlain(a.expectedPct)} {t.analytics.perYear}
                  </Fact>
                  <Fact label={t.analytics.attributes.actualAnn}>{actualAnnualized(a)}</Fact>
                  <Fact label={t.analytics.attributes.payoutSchedule}>
                    {payoutScheduleLabel(a, transactions, t)}
                  </Fact>
                  <Fact label={t.analytics.attributes.targetShare}>
                    {f.pctPlain(a.targetPct, Number.isInteger(a.targetPct) ? 0 : 1)}
                  </Fact>
                  <Fact label={t.analytics.attributes.firstPurchase}>
                    {f.date(a.firstPurchase)}
                  </Fact>
                </>
              )}
            </RecordCard>
          );
        })}
      </div>
    </div>
  );
}
