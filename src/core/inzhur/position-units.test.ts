// Issue #31 — "Отримані котирування суттєво не співпадають з тими які б мали бути."
//
// This file began as the REPRODUCTION and is kept as the regression, with the
// reporter's scenario and its arithmetic unchanged, so the numbers that were
// once the bug now pin the fix.
//
// WHAT WAS WRONG. `Asset.inzhur.units` was one hand-typed number written only by
// the asset form; `Transaction` carried no units at all; and a stored
// `Snapshot.quotes[id]` is a POSITION VALUE, not a per-unit price. So
// `matchAssets`'s `positionValue(link.units, sellUAH)` — the app's only
// units-times-price arithmetic — ran on a total no purchase updated, and every
// buy or reinvestment made after the link was created went missing from it.
//
// WHAT CHANGED. `Transaction.quantity` and `unitPrice` (W7's own columns),
// `derive.ts`'s `unitsByAsset` for `units(a, D) = Σ quantity deltas`, and a third
// argument on `matchAssets` that carries it. The stale total remains as a
// fallback for rows recorded before any of this existed — those record ₴ and
// nothing else, and `w7-migration-translations.md` §4 says their counts are
// unrecoverable — so `unitsFrom` reports which of the two answered.
import { describe, expect, it } from 'vitest';

import { matchAssets, parseAssetsFeed, positionValue } from './parse';
import fixture from './__fixtures__/assets-sample.json';
import { dayBefore } from '../dates';
import { ledgerUnits, unitsByAsset } from '../derive';
import type { Asset, Transaction } from '../types';

const feed = parseAssetsFeed(fixture);

// The fixture's live sell price for Inzhur REIT. Chosen as the arithmetic base
// below so the scenario needs no price history — the one thing the store could
// not give it.
const SELL_UAH = 11.1389;

function reitLinkedWith(units: number): Asset {
  return {
    id: 'reit',
    name: 'Inzhur REIT',
    code: 'RE',
    colorKey: 'reit',
    yieldType: 'div_cap',
    expectedPct: 14,
    targetPct: 40,
    payoutSchedule: 'monthly',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:00',
    inzhur: { kind: 'fund', ref: 'inzhur-reit', units },
  };
}

/** What the Fetch-quotes button puts in the row, for this portfolio. */
function fetched(asset: Asset, txs: Transaction[]) {
  const [match] = matchAssets([asset], feed, unitsByAsset(txs)).linked;
  if (match === undefined) throw new Error('fixture no longer carries inzhur-reit');
  return match;
}

describe('issue #31 — the fetch values a position from its whole ledger', () => {
  // The reporter's scenario, with the reinvestment priced at the feed's OWN sell
  // price so every figure is exact and no snapshot history is involved:
  //
  //   first purchase   5 000 units          → 5 000 × 11.1389 = 55 694.50 ₴
  //   reinvestment     11 138.90 ₴ of units → exactly 1 000 more units
  //   true holding     6 000 units          → 6 000 × 11.1389 = 66 833.40 ₴
  //
  // Before the fix the fetch offered 55 694.50 — the whole reinvestment, 16.7% of
  // the position, missing. That is the "суттєво" in the report.
  const FIRST_PURCHASE_UNITS = 5_000;
  const REINVESTED_UAH = 11_138.9;
  const BOUGHT_UNITS = REINVESTED_UAH / SELL_UAH; // 1 000, exactly

  const firstPurchase: Transaction = {
    id: 'b1',
    date: '2026-02-03',
    type: 'buy',
    assetId: 'reit',
    amount: 55_694.5,
    source: 'own',
    quantity: FIRST_PURCHASE_UNITS,
    unitPrice: SELL_UAH,
  };

  // REIT's dividends reinvest automatically — `seed.ts` records r2/r3 this way.
  const reinvest: Transaction = {
    id: 'r4',
    date: '2026-08-10',
    type: 'reinvest',
    assetId: 'reit',
    amount: REINVESTED_UAH,
    source: 'reinvest_reit',
    quantity: BOUGHT_UNITS,
    unitPrice: SELL_UAH,
  };

  it('values the position from every purchase, not only the one that set the link', () => {
    // The assertion that was red. The link still says 5 000 — deliberately, to
    // prove the ledger is what answers, not a conveniently updated total.
    const match = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [firstPurchase, reinvest]);
    expect(match.value).toBe(positionValue(FIRST_PURCHASE_UNITS + BOUGHT_UNITS, SELL_UAH));
    expect(match.value).toBe(66_833.4);
    expect(match.unitsFrom).toBe('ledger');
  });

  it('two portfolios that differ by a purchase no longer fetch the same value', () => {
    // The same defect stated without an expected figure: the ONLY thing
    // separating these is the reinvestment, and the gap is exactly its ₴.
    const before = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [firstPurchase]);
    const after = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [firstPurchase, reinvest]);
    expect(after.value).toBeDefined();
    expect(before.value).toBeDefined();
    expect(after.value! - before.value!).toBeCloseTo(REINVESTED_UAH, 2);
  });

  it('falls back to the link total when the ledger records no quantities at all', () => {
    // Every row recorded before #31 is this shape — an amount and nothing else.
    // The fallback is not a leftover: §4 of the migration notes says these counts
    // are unrecoverable, so the hand-typed total is genuinely the best number
    // available, and `unitsFrom` is how the UI can say the row is only as current
    // as the last edit of the asset.
    const legacy: Transaction = {
      id: 'b0',
      date: '2026-02-03',
      type: 'buy',
      assetId: 'reit',
      amount: 55_694.5,
      source: 'own',
    };
    const match = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [legacy]);
    expect(match.units).toBe(FIRST_PURCHASE_UNITS);
    expect(match.unitsFrom).toBe('link');
  });

  it('a fully sold position is worth nothing, not its stale link total', () => {
    // The `??` trap, pinned. A sold-out holding sums to 0, which is falsy, so a
    // truthiness check would fall back to the link's 5 000 and value a closed
    // position at ₴55 694.50 — a bigger version of the bug this file is about.
    const sold: Transaction = {
      id: 's1',
      date: '2026-08-11',
      type: 'sell',
      assetId: 'reit',
      amount: 55_694.5,
      source: 'own',
      quantity: FIRST_PURCHASE_UNITS,
      unitPrice: SELL_UAH,
    };
    const match = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [firstPurchase, sold]);
    // AND IT OFFERS NOTHING, rather than offering zero. A ₴0.00 fill was written
    // into the draft and then rejected by `quoteInputSchema` for being
    // non-positive — so the row displayed a fetched number, the progress pill
    // did not count it, and Save silently omitted the asset, with no error
    // anywhere. Silence is the honest output for a position that is gone.
    expect(match.value).toBeUndefined();
    expect(match.units).toBeUndefined();
  });

  it('will not answer from a HALF-BACKFILLED ledger — the loudest failure of all', () => {
    // The backfill route is BY HAND (D112), so every linked asset spends days
    // with some rows counted and some not. Keying presence on "any row has a
    // quantity" would take the partial sum and stamp it `ledger`: a 6 164-unit
    // REIT with one re-recorded 1 000-unit purchase would fetch ₴11 138.90 for a
    // ₴68 668 position — an 84% understatement, five times the 16.7% this file
    // was opened for. The ledger answers only when it can answer completely.
    const legacyBuy: Transaction = {
      id: 'b0',
      date: '2026-02-03',
      type: 'buy',
      assetId: 'reit',
      amount: 55_694.5,
      source: 'own',
    };
    const match = fetched(reitLinkedWith(FIRST_PURCHASE_UNITS), [legacyBuy, reinvest]);
    expect(match.units).toBe(FIRST_PURCHASE_UNITS);
    expect(match.unitsFrom).toBe('link');
  });

  it('counts only what the asked-for date had — units are a running total', () => {
    // `unitsByAsset(txs, asOf)`. A quote drafted for a past date must value the
    // position that existed THEN; using today's count would restate history
    // every time a new purchase landed.
    expect(unitsByAsset([firstPurchase, reinvest], '2026-08-09').reit).toBe(FIRST_PURCHASE_UNITS);
    expect(unitsByAsset([firstPurchase, reinvest], '2026-08-10').reit).toBeCloseTo(
      FIRST_PURCHASE_UNITS + BOUGHT_UNITS,
      6,
    );
  });

  it('a LATER uncounted row does not un-know an earlier date', () => {
    // Completeness is bounded by the date asked about, the same as the sum.
    // The owner backfills BY HAND (D112), so a ledger counted up to some point
    // and blank after it is the normal state, not an edge case — and every date
    // inside the counted stretch is answerable exactly.
    const uncountedLater = { ...reinvest, id: 'later', date: '2026-08-20', quantity: undefined };
    const txs = [firstPurchase, uncountedLater];

    const past = ledgerUnits(txs, '2026-08-09');
    expect(past.units.reit).toBe(FIRST_PURCHASE_UNITS);
    expect(past.incomplete).toEqual([]);

    // On and after the gap it stops answering, which is the rule unchanged.
    const after = ledgerUnits(txs, '2026-08-20');
    expect(after.units.reit).toBeUndefined();
    expect(after.incomplete).toEqual(['reit']);
    expect(ledgerUnits(txs).incomplete).toEqual(['reit']);
  });

  it('an asset id off Object.prototype is not a unit count', () => {
    // `assetRowSchema` is `z.string().min(1)`, so `toString` is a legal id.
    // `derive.ts` builds its map with `Object.create(null)`; `matchAssets`
    // indexes whatever it is HANDED, and a plain `{}` answers that key with a
    // Function — `positionValue(fn, price)` is NaN, filled into the draft as a
    // fetched number.
    const asset = { ...reitLinkedWith(5_000), id: 'toString' };
    const [match] = matchAssets([asset], feed, {} as Record<string, number>).linked;
    expect(match?.units).toBe(5_000);
    expect(match?.unitsFrom).toBe('link');
    expect(Number.isNaN(match?.value ?? 0)).toBe(false);
  });

  it("a bond's LAST coupon survives the redemption on the same date", () => {
    // The tie is real for OVDP: the feed pays the final coupon AND the
    // principal on the maturity date. An inclusive bound summed the payout day
    // and the disposal together and got zero, so the one coupon whose amount is
    // known exactly opened with an empty field. `DailyQuotes` asks for
    // `dayBefore(couponDate)`; this pins what that answers.
    const bought = { ...firstPurchase, date: '2026-02-03', quantity: 15 };
    const redeemed = {
      ...firstPurchase,
      id: 'red',
      date: '2026-08-25',
      type: 'redemption' as const,
      quantity: 15,
    };
    const txs = [bought, redeemed];
    expect(unitsByAsset(txs, dayBefore('2026-08-25')).reit).toBe(15);
    // The valuation bound is unchanged and still wants the day's close.
    expect(unitsByAsset(txs, '2026-08-25').reit).toBe(0);
  });

  it('still keys an asset whose rows all start after the date, at zero', () => {
    // `moving` stays whole-ledger for exactly this: dropping the key sent
    // `matchAssets` to the link's stale total and reported a position as held
    // before it was bought. Zero is the true answer and reads as no offer.
    const later = ledgerUnits([firstPurchase], '2026-01-01');
    expect(later.units.reit).toBe(0);
    expect(later.incomplete).toEqual([]);
  });
});

describe('what a count of zero or less MEANS, at every consumer', () => {
  const reit = (units: number): Asset => ({
    id: 'reit',
    name: 'Inzhur REIT',
    code: 'RE',
    colorKey: 'reit',
    yieldType: 'div_cap',
    expectedPct: 14,
    targetPct: 40,
    payoutSchedule: 'monthly',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T10:00:00',
    inzhur: { kind: 'fund', ref: 'inzhur-reit', units },
  });

  it('EXACTLY zero is an ordinary empty day — silent, nothing to fix', () => {
    // A sold-out holding and a date before the first purchase both land here,
    // and neither is a defect the owner can act on.
    const [match] = matchAssets([reit(5_000)], feed, { reit: 0 }).linked;
    expect(match.value).toBeUndefined();
    expect(match.noValue).toBe('no-position');
  });

  it('BELOW zero is a data error, and is named as one', () => {
    // No holding can be negative: it means recorded sales exceed recorded
    // purchases. Folding it into `no-position` made a real defect
    // indistinguishable from an ordinary empty day.
    const [match] = matchAssets([reit(5_000)], feed, { reit: -3 }).linked;
    expect(match.value).toBeUndefined();
    expect(match.noValue).toBe('negative');
  });

  it('a positive count is still valued from the ledger, not the link', () => {
    const [match] = matchAssets([reit(5_000)], feed, { reit: 6_000 }).linked;
    expect(match.value).toBe(positionValue(6_000, SELL_UAH));
    expect(match.noValue).toBeUndefined();
  });
});
