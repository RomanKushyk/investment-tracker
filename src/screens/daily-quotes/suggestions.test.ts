// Fixtures: the demo seed (lib/seed.ts — …8976 last quoted 15 846,30 on 25.07,
// …6475 4 374,12) and the trimmed live Inzhur capture (7840 kopecks = ₴78,40
// per bond). The 4 376,49 figure below is the design reference's own S4 row.
import { describe, expect, it } from 'vitest';

import { parseAssetsFeed } from '../../core/inzhur/parse';
import { investedByAsset } from '../../core/derive';
import type { Asset } from '../../core/types';
import fixture from '../../core/inzhur/__fixtures__/assets-sample.json';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import { accrualSuggestion, couponPrefill } from './suggestions';

const snapshots = buildSeedSnapshots();
const invested = investedByAsset(SEED_TRANSACTIONS);
const feed = parseAssetsFeed(fixture);

function seedAsset(id: string): Asset {
  return SEED_ASSETS.find((a) => a.id === id)!;
}

describe('accrualSuggestion', () => {
  it('carries a seed bond forward to the selected date', () => {
    // …6475: 4 374,12 (25.07) + 2 days × 216,00 × 2/365 = 4 376,49.
    expect(
      accrualSuggestion(
        seedAsset('ovdp6475'),
        snapshots,
        invested.ovdp6475,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
      ),
    ).toBe(4376.49);
    // …8976: 15 846,30 + 2 days × 1 240,00 × 2/365.
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
      ),
    ).toBe(15859.89);
  });

  it('subtracts a coupon the gap crossed', () => {
    // …8976's coupon grid hits 25.08, so quoting 26.08 from the 25.07 quote
    // crosses one payment: 15 846,30 + 32 days × 6,7945 − 1 240,00.
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-08-26',
        undefined,
        undefined,
        () => undefined,
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
      ),
    ).toBe(16063.72);
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
      ),
    ).toBeNull();
    const fresh: Asset = { ...seedAsset('ovdp6475'), id: 'new' };
    expect(
      accrualSuggestion(fresh, snapshots, 0, '2026-07-27', undefined, undefined, () => undefined),
    ).toBeNull();
    // 03.02 is the first seed snapshot — nothing before it to carry forward.
    expect(
      accrualSuggestion(
        seedAsset('ovdp8976'),
        snapshots,
        invested.ovdp8976,
        '2026-02-05',
        undefined,
        undefined,
        () => undefined,
      ),
    ).toBeNull();
  });

  it('SIZES A GAP COUPON ON ITS OWN DATE, through the resolver it is handed', () => {
    // THE CALL-SITE WIRING, which had no coverage: every other case here passes
    // `() => undefined`, so swapping `couponPerPayment(asset, unitsAt(d))` back
    // for the drafted-date figure left the whole suite green. `accrual.test.ts`
    // covers `couponsInGap`; this covers that `accrualSuggestion` reaches it
    // with a PER-DATE answer rather than one constant.
    //
    // …8976 last quoted 15 846,30 on 25.07 and pays on 25.08. Draft 27.08 with a
    // rate, holding 20 units on the drafted date and 10 on the coupon's.
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
    );
    const flat = accrualSuggestion(
      bond,
      snapshots,
      invested.ovdp8976,
      '2026-08-27',
      undefined,
      20,
      () => 20,
    );
    // 10 units pay ₴784 that coupon, 20 pay ₴1 568 — the gap subtracts the
    // smaller, so the per-date answer is HIGHER by exactly the difference.
    expect(perDate).not.toBeNull();
    expect(flat).not.toBeNull();
    expect((perDate ?? 0) - (flat ?? 0)).toBeCloseTo(784, 2);
  });

  it('suggests nothing for a CLOSED position, and does not fall back to the estimate', () => {
    // The trap this closes: `couponPerPayment(asset, 0)` is `undefined`, which
    // `dailyAccrual` reads as "no stated coupon" and answers with the
    // `expectedPct × invested / 365` estimate. `invested` is never reduced by a
    // `sell`, so the ghost kept climbing on a holding that no longer exists —
    // the same defect `couponProjection` is guarded against one file over.
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
      ),
    ).toBeNull();
    // The estimate is what it would otherwise have returned, so this is the
    // number the assertion above is refusing — not merely a different one.
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
      ),
    ).toBe(15860.13);
    // UNKNOWN IS NOT ZERO: a pre-#31 bond with no quantities still accrues.
    expect(
      accrualSuggestion(
        sold,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
      ),
    ).not.toBeNull();
  });

  it('uses the expectedPct fallback for a bond with no stated coupon', () => {
    const bare: Asset = { ...seedAsset('ovdp8976'), couponAmount: undefined };
    // 16.4 % of the invested 15 390,00 a year, over 2 days from 15 846,30.
    expect(
      accrualSuggestion(
        bare,
        snapshots,
        invested.ovdp8976,
        '2026-07-27',
        undefined,
        undefined,
        () => undefined,
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
