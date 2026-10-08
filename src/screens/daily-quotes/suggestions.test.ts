// Fixtures: the demo seed and the trimmed live Inzhur capture. The figure the
// first case asserts is the design reference's own row.
import { describe, expect, it } from 'vitest';

import { parseAssetsFeed, type ParsedFeed } from '@quirenote/core/inzhur/parse';
import { investedByAsset } from '@quirenote/core/derive';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import fixture from '@quirenote/core/inzhur/__fixtures__/assets-sample.json';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import { accrualSuggestion, couponPrefill } from './suggestions';

const snapshots = buildSeedSnapshots();
const invested = investedByAsset(SEED_TRANSACTIONS);
const feed = parseAssetsFeed(fixture);

function seedAsset(id: string): Asset {
  return SEED_ASSETS.find((a) => a.id === id)!;
}

describe('accrualSuggestion', () => {
  it('carries a seed bond forward to the selected date', () => {
    expect(
      accrualSuggestion(
        seedAsset('ovdp6475'),
        snapshots,
        invested.ovdp6475,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(4376.49);
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(15859.89);
  });

  it('subtracts a coupon the gap crossed', () => {
    // …8976's coupon grid hits 25.08, so quoting 26.08 from the 25.07 quote crosses one payment.
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-08-26',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(14823.72);
    // Same accrual, coupon grid shifted a month later → nothing to subtract.
    expect(
      accrualSuggestion(
        { ...seedAsset('ovdp8976'), nextCoupon: '2026-09-25' },
        snapshots,
        invested.ovdp8976,
        '2026-08-26',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(16063.72);
  });

  it('subtracts the coupon the confirm recorded before rolling onto the maturity', () => {
    // The confirm paid 25.08 and folded the pointer onto 25.02.2027: the same gap, the same coupon.
    const paid: Transaction = {
      id: 'c825',
      date: '2026-08-25',
      type: 'interest_payout',
      assetId: 'ovdp8976',
      amount: 1240,
    };
    expect(
      accrualSuggestion(
        { ...seedAsset('ovdp8976'), nextCoupon: '2027-02-25' },
        snapshots,
        invested.ovdp8976,
        '2026-08-26',
        undefined,
        undefined,
        () => undefined,
        [...SEED_TRANSACTIONS, paid],
      ),
    ).toBe(14823.72);
  });

  it('subtracts one coupon for a stored date inside the dedupe window before the maturity', () => {
    // A hand edit five days short of 25.02.2027, no feed: the stored date and the maturity are one
    // payment, so the carry to the maturity drops 1 240,00 once, not twice.
    const quoted: Snapshot[] = [{ date: '2027-02-10', quotes: { ovdp8976: 15000 } }];
    expect(
      accrualSuggestion(
        { ...seedAsset('ovdp8976'), nextCoupon: '2027-02-20' },
        quoted,
        invested.ovdp8976,
        '2027-03-01',
        undefined,
        15,
        () => 15,
        SEED_TRANSACTIONS,
      ),
    ).toBe(13861.92);
  });

  it('subtracts only the coupons up to the maturity for a monthly bond drafted after it', () => {
    // No feed: the gap stops at 10.03.2027 and counts 25.01, 25.02 and 10.03, as the accrual
    // stops there, so the carry drops 3 × 1 240,00, not one more for every month drafted past.
    const quoted: Snapshot[] = [{ date: '2027-01-10', quotes: { ovdp8976: 15000 } }];
    expect(
      accrualSuggestion(
        {
          ...seedAsset('ovdp8976'),
          payoutSchedule: 'monthly',
          nextCoupon: '2027-01-25',
          maturity: '2027-03-10',
        },
        quoted,
        invested.ovdp8976,
        '2027-04-30',
        undefined,
        15,
        () => 15,
        SEED_TRANSACTIONS,
      ),
    ).toBe(13685.26);
  });

  it('subtracts the one coupon on a stored date past the maturity, however far past it is drafted', () => {
    // No feed: the walk offers 15.03.2027 alone, so the gap drops one 1 240,00, not one for every
    // grid month from it to the drafted date; the accrual stops on the maturity, 10.03.
    const quoted: Snapshot[] = [{ date: '2027-03-01', quotes: { ovdp8976: 15000 } }];
    expect(
      accrualSuggestion(
        {
          ...seedAsset('ovdp8976'),
          payoutSchedule: 'monthly',
          nextCoupon: '2027-03-15',
          maturity: '2027-03-10',
        },
        quoted,
        invested.ovdp8976,
        '2027-06-30',
        undefined,
        15,
        () => 15,
        SEED_TRANSACTIONS,
      ),
    ).toBe(14126.9);
  });

  it('subtracts the same coupons before and after the confirm rolls a monthly bond onto its maturity', () => {
    // No feed, payouts recorded on 25.01 and 25.02.2027, maturity 02.03.2027. Before, nextCoupon sits
    // on the grid date; after, the confirm rolled it onto the maturity. Drafted on 27.02 off the 28.01
    // quote, the 25.02 payment is the final coupon, counted on the maturity, so the carry drops nothing.
    const quoted: Snapshot[] = [{ date: '2027-01-28', quotes: { ovdp8976: 15000 } }];
    const paid = (id: string, date: string): Transaction => ({
      id,
      date,
      type: 'interest_payout',
      assetId: 'ovdp8976',
      amount: 1240,
    });
    const ledger = [...SEED_TRANSACTIONS, paid('p1', '2027-01-25'), paid('p2', '2027-02-25')];
    const suggest = (nextCoupon: string) =>
      accrualSuggestion(
        { ...seedAsset('ovdp8976'), payoutSchedule: 'monthly', nextCoupon, maturity: '2027-03-02' },
        quoted,
        invested.ovdp8976,
        '2027-02-27',
        undefined,
        15,
        () => 15,
        ledger,
      );
    expect(suggest('2027-02-25')).toBe(16223.01);
    expect(suggest('2027-03-02')).toBe(16223.01);
  });

  it('subtracts the coupon the walk bridges to before the first date served', () => {
    // The provider drops a bond's older payments: UA4000238976 served without its 25.03.2026 row,
    // the stored date a period before it, and a gap spanning the coupon owed between.
    const trimmed = structuredClone(fixture);
    const entry = trimmed.find((e) => e.assetDetails?.isin === 'UA4000238976')!;
    entry.assetDetails!.paymentSchedule = entry.assetDetails!.paymentSchedule!.filter(
      (p) => p.id !== 113,
    );
    const linked: Asset = {
      ...seedAsset('ovdp8976'),
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
      nextCoupon: '2025-09-24',
    };
    const quoted: Snapshot[] = [{ date: '2026-03-20', quotes: { ovdp8976: 15000 } }];
    const suggest = (feed: ParsedFeed | undefined) =>
      accrualSuggestion(linked, quoted, invested.ovdp8976, '2026-03-30', feed, 15, () => 15, [
        ...SEED_TRANSACTIONS,
      ]);
    // Neither feed brackets the gap, so the daily rate is the same; the gap owes 25.03 both ways.
    expect(suggest(parseAssetsFeed(trimmed))).toBe(suggest(undefined));
    expect(suggest(undefined)).toBeLessThan(15000);
  });

  it('suggests nothing for a non-bond, an unquoted asset or an already-quoted date', () => {
    expect(
      accrualSuggestion(
        seedAsset('reit'),
        snapshots,
        invested.reit,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBeNull();
    const fresh: Asset = { ...seedAsset('ovdp6475'), id: 'new' };
    expect(
      accrualSuggestion(
        fresh,
        snapshots,
        0,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBeNull();
    // The first seed snapshot — nothing before it to carry forward.
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-02-05',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBeNull();
  });

  it('SIZES A GAP COUPON ON ITS OWN DATE, through the resolver it is handed', () => {
    // THE CALL-SITE WIRING, which had no coverage: every other case here passes
    // `() => undefined`, so swapping `couponPerPayment(asset, unitsAt(d))` back for
    // the drafted-date figure left the whole suite green. `accrual.test.ts` covers
    // `couponsInGap`; this covers that `accrualSuggestion` reaches it with a PER-DATE
    // answer rather than one constant.
    const bond: Asset = { ...seedAsset('ovdp8976'), couponRatePct: 15.68 };
    const held = (couponDate: string) => (couponDate === '2026-08-25' ? 10 : 20);
    const perDate = accrualSuggestion(
      bond,
      snapshots,
      invested.ovdp8976,
      '2026-08-27',
      undefined,
      20,
      held,
      SEED_TRANSACTIONS,
    );
    const flat = accrualSuggestion(
      bond,
      snapshots,
      invested.ovdp8976,
      '2026-08-27',
      undefined,
      20,
      () => 20,
      SEED_TRANSACTIONS,
    );
    // The gap subtracts the smaller holding's coupon, so the per-date answer is higher by the difference.
    expect(perDate).not.toBeNull();
    expect(flat).not.toBeNull();
    expect((perDate ?? 0) - (flat ?? 0)).toBeCloseTo(784, 2);
  });

  it('suggests nothing for a CLOSED position, and does not fall back to the estimate', () => {
    // The trap this closes: `couponPerPayment(asset, 0)` is `undefined`, which
    // `dailyAccrual` reads as "no stated coupon" and answers with the estimate.
    // `invested` is never reduced by a `sell`, so the ghost kept climbing on a
    // holding that no longer exists.
    const sold = { ...seedAsset('ovdp8976'), couponRatePct: 15.68 };
    expect(
      accrualSuggestion(
        sold,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        0,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBeNull();
    // The estimate is what it would otherwise have returned, so this is the number
    // the assertion above is refusing — not merely a different one.
    const bare: Asset = { ...sold, couponAmount: undefined, couponRatePct: undefined };
    expect(
      accrualSuggestion(
        bare,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(15860.13);
    // UNKNOWN IS NOT ZERO: a bond with no quantities still accrues.
    expect(
      accrualSuggestion(
        sold,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).not.toBeNull();
  });

  it('uses the expectedPct fallback for a bond with no stated coupon', () => {
    const bare: Asset = { ...seedAsset('ovdp8976'), couponAmount: undefined };
    expect(
      accrualSuggestion(
        bare,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
        SEED_TRANSACTIONS,
      ),
    ).toBe(15860.13);
  });
});

describe('couponPrefill', () => {
  const due = { assetId: 'ovdp8976', date: '2026-09-23', overdueDays: 0, amount: 1240 };

  it('prefers the linked feed forecast (₴78,40 per bond × 15 units)', () => {
    const linked: Asset = {
      ...seedAsset('ovdp8976'),
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
    };
    expect(couponPrefill(linked, due, feed, undefined)).toBe(1176);
  });

  it('falls back to the stated coupon without a link or without a feed', () => {
    expect(couponPrefill(seedAsset('ovdp8976'), due, feed, undefined)).toBe(1240);
    const linked: Asset = {
      ...seedAsset('ovdp8976'),
      inzhur: { kind: 'bond', ref: 'UA4000238976', units: 15 },
    };
    expect(couponPrefill(linked, due, undefined, undefined)).toBe(1240);
  });

  it('falls back to the stated coupon when the feed does not carry the ref', () => {
    const linked: Asset = {
      ...seedAsset('ovdp8976'),
      inzhur: { kind: 'bond', ref: 'UA0000000000', units: 15 },
    };
    expect(couponPrefill(linked, due, feed, undefined)).toBe(1240);
  });

  it('has nothing to prefill when the asset states no coupon (an estimate is never offered)', () => {
    expect(
      couponPrefill(seedAsset('ovdp8976'), { ...due, amount: undefined }, feed, undefined),
    ).toBeUndefined();
  });
});
