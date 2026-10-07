import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Transaction } from '../types';
import { parseAssetsFeed } from '../inzhur/parse';
import fixture from '../inzhur/__fixtures__/assets-sample.json';
import {
  attributesView,
  derivedYtmPct,
  dividendDayOfMonth,
  payoutScheduleFact,
} from './attributes';
import { OFF_LIST_INPUT, PUBLISHED_INPUT, TEST_LEDGERS } from './test-ledgers';
import { yieldView } from './yield';

describe('dividendDayOfMonth', () => {
  it("finds the LATEST dividend_accrual's day-of-month for the asset (REIT -> 10th)", () => {
    expect(dividendDayOfMonth(SEED_TRANSACTIONS, 'reit')).toBe(10);
  });

  it('returns undefined when the asset has no dividend_accrual history', () => {
    expect(dividendDayOfMonth(SEED_TRANSACTIONS, 'ovdp8976')).toBeUndefined();
    expect(dividendDayOfMonth([], 'reit')).toBeUndefined();
  });

  it('picks the max-dated row, not array order', () => {
    const txs: Transaction[] = [
      {
        id: 't2',
        date: '2026-06-10',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 1,
      },
      {
        id: 't1',
        date: '2026-02-15',
        type: 'dividend_accrual',
        assetId: 'reit',
        amount: 1,
      },
    ];
    expect(dividendDayOfMonth(txs, 'reit')).toBe(10);
  });
});

describe('payoutScheduleFact', () => {
  it('REIT (monthly, dividends on the 10th) -> {monthly, day 10} (UI renders "Monthly · ~10th")', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleFact(reit, SEED_TRANSACTIONS)).toEqual({ schedule: 'monthly', day: 10 });
  });

  it('Energy (schedule "none") -> no day token (UI renders "None (price only)")', () => {
    const energy = SEED_ASSETS.find((a) => a.id === 'energy')!;
    expect(payoutScheduleFact(energy, SEED_TRANSACTIONS)).toEqual({ schedule: 'none' });
  });

  it('omits the day token when there is no accrual history yet (UI renders the bare label)', () => {
    const reit = SEED_ASSETS.find((a) => a.id === 'reit')!;
    expect(payoutScheduleFact(reit, [])).toEqual({ schedule: 'monthly', day: undefined });
  });
});

describe('derivedYtmPct — YTM at purchase, solved rather than typed (D120)', () => {
  const feed = parseAssetsFeed(fixture);
  const bond = (over: Partial<Asset> = {}): Asset => ({
    id: 'ovdp8976',
    name: 'OVDP UA4000238976',
    code: 'GB',
    colorKey: 'ovdp8976',
    yieldType: 'fixed_coupon',
    expectedPct: 16.4,
    targetPct: 17,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-08-12',
    createdAt: '2026-02-05T10:00:00',
    inzhur: { kind: 'bond', ref: 'UA4000238976' },
    ...over,
  });
  const buy = (over: Partial<Transaction> = {}): Transaction => ({
    id: 'b1',
    date: '2026-08-12',
    type: 'buy',
    assetId: 'ovdp8976',
    amount: 10_576.7,
    quantity: 10,
    unitPrice: 1057.67,
    ...over,
  });

  it('solves the yield the paid price implies, against the published schedule', () => {
    // Feeding the fixture's own price straight back must return a yield that reprices
    // it — the inverse of `derivePrice`.
    const ytm = derivedYtmPct(bond(), [buy()], feed);
    expect(ytm).toBeDefined();
    expect(ytm!).toBeGreaterThan(0);
    expect(ytm!).toBeLessThan(100);
  });

  it('a HIGHER price paid implies a LOWER yield — the relationship that makes it real', () => {
    // The whole reason this cannot be folded into the coupon rate: the coupon is one
    // number for life, this one depends on what the holder paid.
    const cheap = derivedYtmPct(bond(), [buy({ unitPrice: 1000 })], feed);
    const dear = derivedYtmPct(bond(), [buy({ unitPrice: 1100 })], feed);
    expect(cheap).toBeDefined();
    expect(dear).toBeDefined();
    expect(dear!).toBeLessThan(cheap!);
  });

  // The provider quotes a bond with one payment date left in simple interest; YTM
  // stays compound, the NBU's basis too, so the figure differs from the one it prints.
  it('stays compound for a purchase made with one payment date left', () => {
    const ytm = derivedYtmPct(bond(), [buy({ date: '2026-09-23', unitPrice: 1003.82 })], feed);
    const compound = (Math.pow(1078.4 / 1003.82, 365 / 182) - 1) * 100;
    expect(ytm).toBeCloseTo(compound, 6);
    expect(ytm).not.toBeCloseTo(14.9, 1);
  });

  it('takes the EARLIEST purchase, not the latest or an average', () => {
    const ladder = [buy({ id: 'b2', date: '2026-08-20', unitPrice: 1100 }), buy()];
    expect(derivedYtmPct(bond(), ladder, feed)).toBe(derivedYtmPct(bond(), [buy()], feed));
  });

  it('is undefined without a price — every purchase made before #31', () => {
    const legacy: Transaction = { ...buy(), quantity: undefined, unitPrice: undefined };
    expect(derivedYtmPct(bond(), [legacy], feed)).toBeUndefined();
  });

  it('is undefined without a schedule — unlinked, or absent from the feed', () => {
    expect(derivedYtmPct(bond({ inzhur: undefined }), [buy()], feed)).toBeUndefined();
    expect(derivedYtmPct(bond(), [buy()], undefined)).toBeUndefined();
  });

  it('is undefined for anything that is not a fixed-coupon asset', () => {
    expect(derivedYtmPct(bond({ yieldType: 'div_cap' }), [buy()], feed)).toBeUndefined();
  });
});

describe('attributesView — the Next coupon fact', () => {
  // The transaction form records a coupon without moving `asset.nextCoupon`, so the
  // stored pointer stays on a settled date; the card carries the ledger's walk instead.
  it('is the first occurrence the ledger has not settled, not the stored pointer', () => {
    const paid: Transaction = {
      id: 'p9',
      date: '2026-08-25',
      type: 'interest_payout',
      assetId: 'ovdp8976',
      amount: 1240,
    };
    const card = attributesView({
      assets: SEED_ASSETS,
      snapshots: [],
      transactions: [...SEED_TRANSACTIONS, paid],
    }).cards.find((c) => c.asset.id === 'ovdp8976')!;
    expect(card.kind === 'bond' && card.nextCoupon).toBe('2027-02-25');
    expect(card.asset.nextCoupon).toBe('2026-08-25');
  });

  it('passes an occurrence the ledger held none of the day before it', () => {
    const sale: Transaction = {
      id: 's2',
      date: '2026-07-01',
      type: 'sell',
      assetId: 'ovdp8976',
      amount: 15800,
      quantity: 15,
    };
    const back: Transaction = {
      id: 'b9',
      date: '2026-09-01',
      type: 'buy',
      assetId: 'ovdp8976',
      amount: 5300,
      quantity: 5,
    };
    const nextCoupon = (rows: Transaction[]) => {
      const card = attributesView({
        assets: SEED_ASSETS,
        snapshots: [],
        transactions: [...SEED_TRANSACTIONS, ...rows],
      }).cards.find((c) => c.asset.id === 'ovdp8976')!;
      return card.kind === 'bond' ? card.nextCoupon : 'not a bond';
    };
    expect(nextCoupon([sale])).toBeUndefined();
    expect(nextCoupon([sale, back])).toBe('2027-02-25');
  });

  it('steps through the published dates the build carries', () => {
    const nextCoupon = (input: typeof PUBLISHED_INPUT) => {
      const [card] = attributesView(input).cards;
      return card?.kind === 'bond' ? card.nextCoupon : 'not a bond';
    };
    expect(nextCoupon(PUBLISHED_INPUT)).toBe('2026-09-30');
    expect(nextCoupon({ ...PUBLISHED_INPUT, paymentDates: undefined })).toBe('2026-10-01');
  });

  it('starts on the published date a stored date a day past it stands for', () => {
    const nextCoupon = (input: typeof OFF_LIST_INPUT) => {
      const [card] = attributesView(input).cards;
      return card?.kind === 'bond' ? card.nextCoupon : 'not a bond';
    };
    expect(nextCoupon(OFF_LIST_INPUT)).toBe('2027-12-01');
    expect(nextCoupon({ ...OFF_LIST_INPUT, paymentDates: undefined })).toBe('2027-12-02');
  });
});

describe("attributesView — Actual is /yield's annualized return at the full history", () => {
  // The ledger sells part of energy's holding and holds an asset no snapshot quotes.
  const input = TEST_LEDGERS.find((l) => l.name === 'sold-and-unquoted')!.input;

  it("every market card is /yield's figure and mark, the sale proceeds included", () => {
    const cards = attributesView(input).cards.flatMap((c) => (c.kind === 'market' ? [c] : []));
    const rows = yieldView({ ...input, period: 'all' }).rows;
    expect(cards.map((c) => [c.asset.id, c.actualAnnualized, c.shortBasis])).toStrictEqual(
      rows
        .filter((r) => r.asset.yieldType !== 'fixed_coupon')
        .map((r) => [r.asset.id, r.annualized, r.shortBasis]),
    );
  });

  it('an asset no snapshot quotes has no figure', () => {
    const fresh = attributesView(input).cards.find((c) => c.asset.id === 'fresh')!;
    expect(fresh.kind === 'market' && fresh.actualAnnualized).toBeUndefined();
  });

  it('an asset bought back since the last valuation day has no figure, never a loss', () => {
    // Energy is sold out after its last quote, so that quote values none of these units.
    const soldOut = TEST_LEDGERS.find((l) => l.name === 'sold-out')!.input;
    const back: Transaction = {
      id: 'back',
      date: '2026-07-30',
      type: 'buy',
      assetId: 'energy',
      amount: 1000,
      quantity: 100,
    };
    const energy = attributesView({
      ...soldOut,
      transactions: [...soldOut.transactions, back],
    }).cards.find((c) => c.asset.id === 'energy')!;
    expect(energy.kind === 'market' && energy.actualAnnualized).toBeUndefined();
  });

  it('marks a market asset bought partway through the history, as /yield does', () => {
    // No market asset in the ledger above is short; …6475, bought partway through the seed, is.
    const assets = SEED_ASSETS.map((a) =>
      a.id === 'ovdp6475' ? { ...a, yieldType: 'capitalization' as const } : a,
    );
    const at = { assets, snapshots: buildSeedSnapshots(), transactions: SEED_TRANSACTIONS };
    const card = attributesView(at).cards.find((c) => c.asset.id === 'ovdp6475')!;
    expect(card.kind === 'market' && card.shortBasis).toBe(true);
  });

  it('has no figure over a one-day history, where /yield has none either', () => {
    // A zero-length span would annualize to a fabricated 0.
    const day = '2026-07-01';
    const asset = { ...SEED_ASSETS.find((a) => a.id === 'energy')!, firstPurchase: day };
    const at = {
      assets: [asset],
      snapshots: [{ date: day, quotes: { energy: 10_100 } }],
      transactions: [
        { id: 'b1', date: day, type: 'buy' as const, assetId: 'energy', amount: 10_000 },
      ],
    };
    const card = attributesView(at).cards[0]!;
    expect(card.kind === 'market' && card.actualAnnualized).toBeUndefined();
  });
});
