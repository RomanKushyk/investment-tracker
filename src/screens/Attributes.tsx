import { useMemo } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useAssets, useSnapshots, useTransactions } from '../hooks/queries';
import { daysBetween, latestSnapshotDate } from '../core/dates';
import { couponPerPayment } from '../core/accrual';
import {
  basisIsShort,
  investedByAsset,
  latestQuotes,
  portfolioStart,
  startDateByAsset,
  unitsByAsset,
} from '../core/derive';
import type { Asset, Transaction } from '../core/types';
import { actualAnnualizedPct, derivedYtmPct, payoutScheduleFact } from './attributes/attributes';
import { useInzhurAssets } from '../hooks/useInzhurAssets';
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

// One frozen instance, so "no ledger yet" keeps a STABLE identity — a fresh `[]`
// per render would change the units memo's dependency every time and make the
// memo do nothing at all. Same idiom, same reason, as `DailyQuotes`.
const NO_TRANSACTIONS: Transaction[] = [];
const NO_ASSETS: Asset[] = [];

export function Attributes() {
  const f = useFormat();
  const t = useT();
  const assets = useAssets().data ?? NO_ASSETS;
  const snapshots = useSnapshots().data ?? [];
  const transactions = useTransactions().data ?? NO_TRANSACTIONS;
  // `useMemo`, for the reason `DailyQuotes` already writes out: `unitsByAsset`
  // walks the whole ledger, and an unmemoized call re-walks it on every render
  // of a screen that renders one card per asset.
  const assetUnits = useMemo(() => unitsByAsset(transactions), [transactions]);
  // WHATEVER THE APP ALREADY HAS — `data` when a fetch has run this session,
  // otherwise the last-good cache. This screen deliberately does NOT trigger a
  // fetch: it is a reference table, and a page that quietly hits the provider on
  // open is the behaviour the picker's own "first open, never on mount" rule
  // exists to prevent.
  const { data, lastGood } = useInzhurAssets();
  const feed = (data ?? lastGood)?.feed;
  // MEMOIZED because it is the expensive one: per bond it rebuilds the feed's
  // ref Map and runs `impliedYield`'s bisection over the whole payment schedule.
  // Leaving it bare while memoizing the O(N) ledger walk two lines up had it
  // exactly backwards — any language toggle or query refetch redid all of it.
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
  // Still ONE span for every asset — D5#5's basis, unchanged by A24 and kept by
  // D85, which closed O23. The rest of the argument is on the mark below.
  const daysHeld = now && start ? daysBetween(start, now) : 0;

  // THE SAME FIGURE MUST CARRY THE SAME MARK ON BOTH SCREENS (D80). This is
  // `annualizedPct` over the same global basis as `/yield`'s `Річна`, so greying
  // it there and painting it green here would assert one number as trustworthy
  // and untrustworthy at once, one tab apart.
  //
  // ON THE SEED IT MARKS NOTHING, and that is worth stating rather than
  // discovering: the fact lives in the NON-coupon branch below, so the two
  // bonds never render it, and …6475 — today's only marked row — is a bond.
  // REIT and Energy both start at the portfolio's own start. The first market
  // asset bought mid-basis is where the two screens would have disagreed.
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
                    {/* DERIVED when it can be (D120): the price this holder paid,
                        solved against the bond's own schedule on the day they
                        bought. The stored `expectedPct` shows when any of the
                        three inputs is missing — an unlinked bond, or a purchase
                        recorded before #31 gave transactions a unit price.
                        DISCLOSED when the two DIFFER, because the rest of the app
                        still measures against the stored figure: `/yield`'s «проти
                        очікуваної», `dailyAccrual`'s fallback and
                        `couponProjection`'s estimate all read `expectedPct`, so
                        one bond can legitimately show two numbers a tab apart.
                        The note names both rather than leaving that unexplained.
                        VISIBLE TEXT, not a `title` — the first cut disclosed the
                        swap with a muted tint plus a tooltip, and neither reaches
                        the shell this screen is mostly read in: `title` never
                        opens on touch, and below `md` (D66) the app IS the phone
                        shell. Colour alone does not carry meaning either (WCAG
                        1.4.1). So a reader on a phone saw one number silently
                        replaced by a different one with nothing to say so. */}
                    {(() => {
                      const solved = ytmByAsset[a.id];
                      // COMPARED AT THE PRECISION IT IS RENDERED AT. A 0.05 pp
                      // threshold is exactly the rounding boundary of `pctPlain`'s
                      // one decimal, so 16.449 against 16.399 passed the gate and
                      // then printed «16,4» twice — a disclosure naming no
                      // difference, which reads as a bug rather than as a fact.
                      // Comparing the strings makes the two questions the same
                      // question, and it cannot drift if the formatter changes.
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
                    {/* The coupon this POSITION pays, derived from the rate and
                        the ledger's units (D119) — it moves when the holding
                        does, which the stored figure it replaced never did. */}
                    {(() => {
                      // ONE binding, one answer — the same rule `couponsInGap`'s
                      // `perCouponAt` parameter enforces about WHICH coupon. Calling it twice forced a
                      // `!` on the second to re-narrow what the first proved.
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
