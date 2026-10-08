import { useMemo } from 'react';

import { AssetAvatar } from '../components/ui/AssetAvatar';
import { Fact, RecordCard } from '../components/ui/RecordCard';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Tag } from '../components/ui/Tag';
import { useLedgerAsOfToday } from '../hooks/useLedgerAsOfToday';
import { attributesView, type PayoutScheduleFact } from '@quirenote/core/view/attributes';
import { useInzhurAssets } from '../hooks/useInzhurAssets';
import { useFormat } from '../hooks/useFormat';
import type { Dict } from '../i18n/messages';
import { useT } from '../i18n/useT';

function payoutScheduleLabel(fact: PayoutScheduleFact, t: Dict): string {
  const base = t.asset.schedule[fact.schedule];
  return fact.day ? `${base} · ~${t.dates.dayOfMonth(fact.day)}` : base;
}

export function Attributes() {
  const f = useFormat();
  const t = useT();
  const { assets, snapshots, transactions } = useLedgerAsOfToday();
  // WHATEVER THE APP ALREADY HAS — `data` when a fetch has run this session,
  // otherwise the last-good cache. This screen deliberately does NOT trigger a
  // fetch: a reference table that quietly hits the provider on open is what the
  // picker's "first open, never on mount" rule exists to prevent.
  const { data, lastGood } = useInzhurAssets();
  const feed = (data ?? lastGood)?.feed;
  // MEMOIZED because the YTM is the expensive one: per bond it rebuilds the feed's ref
  // Map and runs `impliedYield`'s bisection over the whole payment schedule.
  const view = useMemo(
    () => attributesView({ assets, snapshots, transactions, feed }),
    [assets, snapshots, transactions, feed],
  );

  // The mark is `/yield`'s (`shortBasisIn`): one figure greyed there and painted green here
  // would be called trustworthy and untrustworthy at once, one tab apart.
  function actualAnnualized(pct: number | undefined, short: boolean) {
    if (pct === undefined) return <span className="text-muted">—</span>;
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
        {view.cards.map((card, i) => {
          const a = card.asset;
          return (
            <RecordCard
              key={a.id}
              index={i}
              avatar={<AssetAvatar code={a.code} colorKey={a.colorKey} />}
              title={a.name}
              tag={<Tag colorKey={a.colorKey}>{t.asset.yieldLong[a.yieldType]}</Tag>}
            >
              {card.kind === 'bond' ? (
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
                      const solved = card.ytm;
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
                    {card.coupon === undefined
                      ? '—'
                      : `${f.moneyWhole(card.coupon)} ${t.asset.couponFrequency[a.payoutSchedule]}`}
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
                    {/* The walk, not `a.nextCoupon`: the transaction form never moves the pointer,
                        so a payout recorded there leaves it settled. No `dismissed`: a Skip pays nothing. */}
                    {card.nextCoupon ? f.date(card.nextCoupon) : '—'}
                  </Fact>
                </>
              ) : (
                <>
                  <Fact label={t.analytics.attributes.expectedReturn}>
                    {f.pctPlain(a.expectedPct)} {t.analytics.perYear}
                  </Fact>
                  <Fact label={t.analytics.attributes.actualAnn}>
                    {actualAnnualized(card.actualAnnualized, card.shortBasis)}
                  </Fact>
                  <Fact label={t.analytics.attributes.payoutSchedule}>
                    {payoutScheduleLabel(card.payoutSchedule, t)}
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
