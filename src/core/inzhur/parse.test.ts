// Fixture-driven: every figure below comes from the trimmed live capture
// (__fixtures__/assets-sample.json, 2026-07-28) or the user's real dashboard —
// see docs/plans/NEXT-PHASE-PLAN.md Phase 3 Verify.
import { describe, expect, it } from 'vitest';

import {
  couponForecast,
  kopecksToUah,
  matchAssets,
  nextPaymentOnOrAfter,
  parseAssetsFeed,
  positionValue,
  type InzhurPayment,
  type InzhurQuote,
} from './parse';
import fixture from './__fixtures__/assets-sample.json';
import type { Asset } from '../types';

const feed = parseAssetsFeed(fixture);

function entry(ref: string): InzhurQuote {
  const found = feed.entries.find((e) => e.ref === ref);
  if (found === undefined) throw new Error(`fixture has no entry '${ref}'`);
  return found;
}

function asset(id: string, inzhur?: Asset['inzhur']): Asset {
  return {
    id,
    name: id,
    code: 'XX',
    colorKey: 'reit',
    yieldType: 'capitalization',
    expectedPct: 0,
    targetPct: 0,
    payoutSchedule: 'none',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T00:00:00',
    ...(inzhur === undefined ? {} : { inzhur }),
  };
}

describe('parseAssetsFeed on the live fixture', () => {
  it('reads every entry, keyed by fund slug / bond ISIN, nothing skipped', () => {
    expect(feed.skipped).toEqual([]);
    expect(feed.entries.map((e) => `${e.kind}:${e.ref}`)).toEqual([
      'bond:UA4000238976',
      'bond:UA4000236475',
      'fund:inzhur-reit',
      'fund:inzhur-energy',
    ]);
  });

  it('picks the UAH prices (REIT sell 11.1389)', () => {
    expect(entry('inzhur-reit')).toMatchObject({
      sellUAH: 11.1389,
      buyUAH: 11.1499,
      navUAH: 11.0395,
    });
    expect(entry('UA4000238976').sellUAH).toBe(1057.67);
  });

  it('picks the display title, whitespace-collapsed (S7 picker rows)', () => {
    expect(entry('inzhur-reit').title).toBe('Inzhur REIT');
    expect(entry('inzhur-energy').title).toBe('Inzhur Energy');
    // The bonds' own title carries a hard line break — collapsed, not split.
    expect(entry('UA4000238976').title).toBe('Державні облігації України');
  });

  it('leaves the title absent when the feed omits or blanks it', () => {
    const payload = [
      { slug: 'inzhur-reit', title: '   \n ', assetDetails: { prices: { sellUAH: 11.1389 } } },
      { slug: 'inzhur-energy', assetDetails: { prices: { sellUAH: 1 } } },
    ];
    expect(parseAssetsFeed(payload).entries.map((e) => e.title)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('gives funds no maturity and an empty schedule', () => {
    expect(entry('inzhur-energy').maturity).toBeUndefined();
    expect(entry('inzhur-energy').paymentSchedule).toEqual([]);
  });

  it('reads bond maturities', () => {
    expect(entry('UA4000238976').maturity).toBe('2027-03-24');
    expect(entry('UA4000236475').maturity).toBe('2028-09-27');
  });

  it('converts the schedule to ₴ on Kyiv dates (7840 → ₴78.40, 100000 → ₴1,000)', () => {
    // The feed stamps midnight-Kyiv instants ('2027-03-23T22:00:00.000Z'), so
    // the last coupon + principal land on the maturity date itself.
    expect(entry('UA4000238976').paymentSchedule).toEqual<InzhurPayment[]>([
      { date: '2026-03-25', amount: 78.4 },
      { date: '2026-09-23', amount: 78.4 },
      { date: '2027-03-24', amount: 78.4 },
      { date: '2027-03-24', amount: 1000 },
    ]);
    expect(entry('UA4000236475').paymentSchedule.at(-1)).toEqual({
      date: '2028-09-27',
      amount: 1000,
    });
  });

  it('picks the published yield on bonds, and none on funds', () => {
    expect(entry('UA4000238976').returnRates).toEqual({ buy: 15.55, sell: 15.55 });
    expect(entry('UA4000236475').returnRates).toEqual({ buy: 16.3, sell: 16.3 });
    expect(entry('inzhur-reit').returnRates).toBeUndefined();
    expect(entry('inzhur-energy').returnRates).toBeUndefined();
  });

  it('picks the lifecycle status verbatim, without filtering on it (D19)', () => {
    // Every fixture entry is active; the point is that the value survives the
    // parse. A 'completed' bond must still appear as an entry, because the user
    // may hold one — matching never consults this field.
    expect(feed.entries.map((e) => e.status)).toEqual([
      'active',
      'active',
      'active',
      'active',
    ]);
  });

  it('keeps the entry when the yield is unreadable, absent or blank', () => {
    const priced = { prices: { sellUAH: 1000 } };
    const payload = [
      { slug: 'a', assetDetails: { ...priced, returnRates: 'nonsense' } },
      { slug: 'b', assetDetails: { ...priced, returnRates: { buy: 'x', sell: 'y' } } },
      { slug: 'c', assetDetails: { ...priced, returnRates: {} } },
      { slug: 'd', assetDetails: priced },
    ];
    const parsed = parseAssetsFeed(payload);
    // Tolerance is the contract: a drifted yield costs the yield, never the price.
    expect(parsed.skipped).toEqual([]);
    expect(parsed.entries.map((e) => e.sellUAH)).toEqual([1000, 1000, 1000, 1000]);
    expect(parsed.entries.map((e) => e.returnRates)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('keeps a half-published yield, dropping only the missing side', () => {
    const payload = [
      { slug: 'a', assetDetails: { prices: { sellUAH: 1000 }, returnRates: { sell: 16.3 } } },
    ];
    expect(parseAssetsFeed(payload).entries[0]?.returnRates).toEqual({ sell: 16.3 });
  });

  it('leaves the status absent when the feed omits or blanks it', () => {
    const payload = [
      { slug: 'a', status: '  ', assetDetails: { prices: { sellUAH: 1 } } },
      { slug: 'b', assetDetails: { prices: { sellUAH: 1 } } },
    ];
    expect(parseAssetsFeed(payload).entries.map((e) => e.status)).toEqual([
      undefined,
      undefined,
    ]);
  });
});

describe('kopecksToUah — the one conversion place', () => {
  it('converts integer kopecks to ₴', () => {
    expect(kopecksToUah(7840)).toBe(78.4);
    expect(kopecksToUah(100000)).toBe(1000);
    expect(kopecksToUah(8885)).toBe(88.85);
    expect(kopecksToUah(0)).toBe(0);
  });
});

describe('positionValue', () => {
  it('is units × sell price, rounded to kopecks', () => {
    expect(positionValue(6164, 11.1389)).toBe(68660.18); // real dashboard figure
    expect(positionValue(9, 6675.8848)).toBe(60082.96);
    expect(positionValue(15, 1057.67)).toBe(15865.05);
  });

  it('handles a zero position', () => {
    expect(positionValue(0, 11.1389)).toBe(0);
  });
});

describe('coupon forecast', () => {
  const schedule = entry('UA4000236475').paymentSchedule;

  it('forecasts the next coupon per unit and for the position (4 × 88.85 = 355.40)', () => {
    expect(couponForecast(schedule, '2026-08-04', 4)).toEqual({
      date: '2026-09-30',
      perUnit: 88.85,
      amount: 355.4,
    });
  });

  it('prefers the coupon over the principal on a maturity date', () => {
    const maturing = entry('UA4000238976').paymentSchedule;
    expect(nextPaymentOnOrAfter(maturing, '2027-01-01')).toEqual({
      date: '2027-03-24',
      amount: 78.4,
    });
  });

  it('includes a payment falling exactly on the from-date', () => {
    expect(nextPaymentOnOrAfter(schedule, '2026-09-30')?.date).toBe('2026-09-30');
  });

  it('does not depend on array order', () => {
    const shuffled = [...schedule].reverse();
    expect(nextPaymentOnOrAfter(shuffled, '2026-08-04')).toEqual({
      date: '2026-09-30',
      amount: 88.85,
    });
  });

  it('returns undefined past the last payment', () => {
    expect(nextPaymentOnOrAfter(schedule, '2030-01-01')).toBeUndefined();
    expect(couponForecast(schedule, '2030-01-01', 4)).toBeUndefined();
  });
});

describe('tolerance — a bad entry never kills the parse', () => {
  it('ignores unknown fields (the payload carries many we never read)', () => {
    const drifted = [
      {
        id: 21,
        slug: 'inzhur-reit',
        type: 'fund',
        description: 'new field',
        gallery: [{ url: 'x' }],
        assetDetails: {
          parameters: { whatever: true },
          indicators: [1, 2, 3],
          prices: { sellUAH: 11.1389, sell: 11.1389, sellUSD: 0.248588 },
        },
      },
    ];
    expect(parseAssetsFeed(drifted).entries).toEqual([
      { kind: 'fund', ref: 'inzhur-reit', sellUAH: 11.1389, paymentSchedule: [] },
    ]);
  });

  it('skips a garbage ISIN entry and still returns the good ones', () => {
    const payload = [
      // Unreadable: an ISIN but no prices at all.
      { slug: 'ovdp', assetDetails: { isin: 'UA0000000000' } },
      ...fixture,
      42,
      null,
      'nonsense',
      { assetDetails: { prices: { sellUAH: 1 } } }, // neither slug nor ISIN
    ];
    const parsed = parseAssetsFeed(payload);
    expect(parsed.entries.map((e) => e.ref)).toEqual(feed.entries.map((e) => e.ref));
    expect(parsed.skipped).toEqual(['UA0000000000', '#5', '#6', '#7', '#8']);
  });

  it('drops only the malformed payments of a bond, keeping the rest', () => {
    const payload = [
      {
        slug: 'ovdp',
        assetDetails: {
          isin: 'UA4000238976',
          maturityDate: '2027-03-24',
          prices: { sellUAH: 1057.67 },
          paymentSchedule: [
            { id: 1, date: '2026-09-22T21:00:00.000Z', amount: '7840' },
            { id: 2, date: 'not-a-date', amount: '7840' },
            { id: 3, amount: '7840' },
            { id: 4, date: '2027-03-23T22:00:00.000Z', amount: 'many' },
            null,
          ],
        },
      },
    ];
    const parsed = parseAssetsFeed(payload);
    expect(parsed.skipped).toEqual([]);
    expect(parsed.entries[0].paymentSchedule).toEqual([{ date: '2026-09-23', amount: 78.4 }]);
  });

  it('reports a payload that is not an array', () => {
    expect(parseAssetsFeed({ assets: [] })).toEqual({ entries: [], skipped: ['(root)'] });
    expect(parseAssetsFeed(undefined)).toEqual({ entries: [], skipped: ['(root)'] });
  });
});

describe('matchAssets', () => {
  const reit = asset('reit', { kind: 'fund', ref: 'inzhur-reit', units: 6164 });
  const ovdp = asset('ovdp8976', { kind: 'bond', ref: '  ua4000238976 ', units: 15 });
  const manual = asset('manual');

  it('links by slug / ISIN (case-insensitive, trimmed) and values the position', () => {
    const { linked, unmatched } = matchAssets([reit, ovdp], feed);
    expect(unmatched).toEqual([]);
    expect(linked.map((m) => [m.asset.id, m.quote.ref, m.value])).toEqual([
      ['reit', 'inzhur-reit', 68660.18],
      ['ovdp8976', 'UA4000238976', 15865.05],
    ]);
  });

  it('reports a linked asset the feed does not carry', () => {
    const gone = asset('gone', { kind: 'bond', ref: 'UA9999999999', units: 1 });
    const { linked, unmatched } = matchAssets([gone], feed);
    expect(linked).toEqual([]);
    expect(unmatched.map((a) => a.id)).toEqual(['gone']);
  });

  it('does not cross kinds', () => {
    const wrongKind = asset('x', { kind: 'bond', ref: 'inzhur-reit', units: 1 });
    expect(matchAssets([wrongKind], feed).unmatched.map((a) => a.id)).toEqual(['x']);
  });

  it('leaves unlinked assets out of both lists', () => {
    expect(matchAssets([manual], feed)).toEqual({ linked: [], unmatched: [] });
  });
});
