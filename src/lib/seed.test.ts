import { describe, expect, it } from 'vitest';

import { buildBackup, parseBackup } from '../core/backup/json';
import {
  depositedTotal,
  freeCashFromLedger,
  globalRoi,
  headlineTotal,
  incomeReceived,
  incomeReceivedNet,
  investedByAsset,
  latestCash,
  latestQuotes,
  ledgerCashDrift,
  netDeposits,
  netResult,
  portfolioStart,
  portfolioXirr,
  reinvestedByAsset,
  reinvestedTotal,
  totalCapital,
} from '../core/derive';
import { daysBetween } from '../core/dates';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from './seed';

const snaps = buildSeedSnapshots();

describe('seed assets (design Attributes cards, lines 340–409)', () => {
  it('four assets in display order with exact attributes', () => {
    expect(SEED_ASSETS.map((a) => a.id)).toEqual(['reit', 'energy', 'ovdp8976', 'ovdp6475']);
    expect(SEED_ASSETS.map((a) => a.targetPct)).toEqual([40, 40, 17, 3]);
    const energy = SEED_ASSETS[1];
    expect(energy.payoutSchedule).toBe('none'); // "None (price only)"
    expect(energy.yieldType).toBe('capitalization');
    const b8976 = SEED_ASSETS[2];
    expect(b8976.couponAmount).toBe(1240);
    expect(b8976.nextCoupon).toBe('2026-08-25');
    expect(b8976.maturity).toBe('2027-02-25');
    const b6475 = SEED_ASSETS[3];
    expect(b6475.firstPurchase).toBe('2026-06-02');
    expect(b6475.couponAmount).toBe(216);
  });
});

describe('seed snapshots (design Balances table, D5#2)', () => {
  it('exactly 174 snapshots: daily 03.02→25.07 complete (no 26.07) + partial 27.07', () => {
    expect(snaps).toHaveLength(174);
    expect(snaps[0].date).toBe('2026-02-03');
    expect(snaps.find((s) => s.date === '2026-07-26')).toBeUndefined();
    const last = snaps[snaps.length - 1];
    expect(last.date).toBe('2026-07-27');
    expect(last.quotes).toEqual({ reit: 68702.1 }); // partial — others "pending"
    expect(last.savedAt).toBeUndefined(); // "Last saved 25.07, 21:14" stays true
  });

  it('pins the verbatim table rows', () => {
    const r2507 = snaps.find((s) => s.date === '2026-07-25')!;
    expect(r2507.quotes).toEqual({
      reit: 68629.36,
      energy: 60086.09,
      ovdp8976: 15846.3,
      ovdp6475: 4374.12,
    });
    expect(r2507.savedAt).toBe('2026-07-25T21:14:00');
    expect(totalCapital(r2507)).toBeCloseTo(148943.62, 2);
    const r2107 = snaps.find((s) => s.date === '2026-07-21')!;
    expect(r2107.quotes).toEqual({
      reit: 68450.12,
      energy: 59980.44,
      ovdp8976: 15830.1,
      ovdp6475: 4368.9,
    });
  });

  it('no asset is quoted before its first purchase; cash is 7,75 throughout', () => {
    expect(snaps.find((s) => s.date === '2026-06-01')!.quotes.ovdp6475).toBeUndefined();
    expect(snaps.find((s) => s.date === '2026-06-02')!.quotes.ovdp6475).toBeDefined();
    expect(snaps.find((s) => s.date === '2026-02-04')!.quotes.ovdp8976).toBeUndefined();
    expect(snaps.every((s) => s.cash === 7.75)).toBe(true);
  });

  it('quote paths start at the buy value and never break continuity at pin boundaries', () => {
    const first = snaps[0];
    expect(first.quotes.reit).toBeCloseTo(64628.62, 2);
    expect(first.quotes.energy).toBeCloseTo(59208, 2);
    const r2007 = snaps.find((s) => s.date === '2026-07-20')!;
    const r2107 = snaps.find((s) => s.date === '2026-07-21')!;
    for (const id of ['reit', 'energy', 'ovdp8976', 'ovdp6475'] as const) {
      const jump = Math.abs(r2107.quotes[id] - r2007.quotes[id]) / r2107.quotes[id];
      expect(jump).toBeLessThan(0.01); // generated path meets the pinned rows smoothly
    }
  });
});

describe('seed aggregates reproduce renderVals (D5)', () => {
  it('headline total ₴149,016.36', () => {
    expect(headlineTotal(snaps)).toBeCloseTo(149016.36, 2);
  });

  it('invested per asset (buys + reinvests)', () => {
    const inv = investedByAsset(SEED_TRANSACTIONS);
    expect(inv.reit).toBeCloseTo(65800, 2);
    expect(inv.energy).toBeCloseTo(59208, 2);
    expect(inv.ovdp8976).toBeCloseTo(15390, 2);
    expect(inv.ovdp6475).toBeCloseTo(4158, 2);
  });

  it('net result +₴4,452.61 = +3.08%', () => {
    const values = latestQuotes(snaps);
    const { reit, energy, ovdp8976, ovdp6475 } = investedByAsset(SEED_TRANSACTIONS);
    const r = netResult(values, { reit, energy, ovdp8976, ovdp6475 });
    expect(r.uah).toBeCloseTo(4452.61, 2);
    expect(r.pct).toBeCloseTo(0.0308, 4);
  });

  // `p7` CARRIES THE ONE SEEDED WITHHOLDING, and `p5` clears the same three
  // constraints. `p7` is chosen because `p5` already carries the 12.05/648,13 →
  // 10.05/472,13 deviation and one row should not hold two annotations, and
  // because `p7` has a paired reinvest, so it exercises net-against-reinvest.
  it('p7 is the one seeded payout carrying a withholding', () => {
    const taxed = SEED_TRANSACTIONS.filter((t) => t.taxWithheld !== undefined);
    expect(taxed).toHaveLength(1);
    expect(taxed[0].id).toBe('p7');
    expect(taxed[0].type).toBe('dividend_accrual');
    expect(taxed[0].taxWithheld).toBeCloseTo(95.28, 2);
    // Strictly below its own amount — `transaction_tax_bound_ck`'s rule, which the seed may not violate.
    expect(taxed[0].taxWithheld!).toBeLessThan(taxed[0].amount);
    const r2 = SEED_TRANSACTIONS.find((t) => t.id === 'r2')!;
    expect(r2.amount).toBeLessThanOrEqual(taxed[0].amount - taxed[0].taxWithheld!);
  });

  // A FIGURE LIVES IN A TEST OR NOT AT ALL: this total lived only in
  // `navigation-map.md` before. Gross is asserted separately and does not move —
  // the two are different bases.
  it('income net of tax ₴4,945.66 — gross less the one withholding', () => {
    const net = incomeReceivedNet(SEED_TRANSACTIONS);
    expect(net.taxes).toBeCloseTo(95.28, 2);
    expect(net.total).toBeCloseTo(4945.66, 2);
    expect(incomeReceived(SEED_TRANSACTIONS).total - net.total).toBeCloseTo(95.28, 2);
    expect(net.dividends).toBeCloseTo(3546.16, 2);
    expect(net.coupons).toBeCloseTo(1399.5, 2);
  });

  it('income ₴5,040.94 = ₴3,641.44 dividends + ₴1,399.50 coupons', () => {
    const inc = incomeReceived(SEED_TRANSACTIONS);
    expect(inc.dividends).toBeCloseTo(3641.44, 2);
    expect(inc.coupons).toBeCloseTo(1399.5, 2);
    expect(inc.total).toBeCloseTo(5040.94, 2);
  });

  it('reinvested ₴1,387.38 = REIT 1 171,38 + …6475 216,00', () => {
    expect(reinvestedTotal(SEED_TRANSACTIONS)).toBeCloseTo(1387.38, 2);
    const by = reinvestedByAsset(SEED_TRANSACTIONS);
    expect(by.reit).toBeCloseTo(1171.38, 2);
    expect(by.ovdp6475).toBeCloseTo(216, 2);
  });

  it('deposited ₴143,176.37 (KPI ₴143,176)', () => {
    expect(depositedTotal(SEED_TRANSACTIONS)).toBeCloseTo(143176.37, 2);
  });
});

// The WEALTH-MANAGEMENT reconciliation fixtures pinned on the seed (`docs/reference/FORMULA-AUDIT.md`).
describe('ledger reconciliation on the seed (formula audit §1/§5)', () => {
  it('freeCashFromLedger(seed) = ₴7,75 — the stored cash, exactly', () => {
    // Payout and reinvest rows are external to broker cash: the doc-verbatim formula
    // gives 3 661,31 and breaks against every seeded snapshot.
    expect(freeCashFromLedger(SEED_TRANSACTIONS)).toBe(7.75);
  });

  it('stored cash reconciles with the ledger: drift 0', () => {
    expect(ledgerCashDrift(latestCash(snaps), SEED_TRANSACTIONS)).toBe(0);
  });

  it('netDeposits(seed) = ₴143,176.37 (no withdrawals seeded)', () => {
    expect(netDeposits(SEED_TRANSACTIONS)).toBe(143176.37);
  });

  it('globalRoi(seed) ≈ +4.0789% — NetFinancialResult +₴5,839.99 over NetDeposits', () => {
    const roi = globalRoi(headlineTotal(snaps), netDeposits(SEED_TRANSACTIONS));
    expect(roi).not.toBeNull();
    expect(roi! * 100).toBeCloseTo(4.0789, 4);
  });
});

// Here rather than beside core/backup/json.ts because core tests may not import src/lib.
describe('backup envelope round-trip on the seed (D12)', () => {
  it('buildBackup(seed) → stringify → parseBackup returns deep-equal tables (4/174/18)', () => {
    const env = buildBackup(
      SEED_ASSETS,
      snaps,
      SEED_TRANSACTIONS,
      { currency: 'UAH', usdRate: 44.83 },
      'demo',
      '2026-07-28T12:00:00',
      2,
    );
    const result = parseBackup(JSON.stringify(env));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.assets).toHaveLength(4);
    expect(result.data.snapshots).toHaveLength(174);
    expect(result.data.transactions).toHaveLength(18); // *Review, gates, tests*: "19" was a miscount
    expect(result.data.assets).toEqual(SEED_ASSETS);
    expect(result.data.snapshots).toEqual(snaps);
    expect(result.data.transactions).toEqual(SEED_TRANSACTIONS);
  });
});

describe('seed transaction invariants (D5#3)', () => {
  it('every dividend falls on day 10 — Seasonality has no stray bars', () => {
    const divs = SEED_TRANSACTIONS.filter((t) => t.type === 'dividend_accrual');
    expect(divs).toHaveLength(6);
    expect(divs.every((t) => t.date.endsWith('-10'))).toBe(true);
  });

  it('every reinvest has a same-date same-asset payout (Destination column derives)', () => {
    const payouts = SEED_TRANSACTIONS.filter(
      (t) => t.type === 'dividend_accrual' || t.type === 'interest_payout',
    );
    for (const r of SEED_TRANSACTIONS.filter((t) => t.type === 'reinvest')) {
      expect(
        payouts.some((p) => p.date === r.date && p.assetId === r.assetId),
        `reinvest ${r.id} on ${r.date}`,
      ).toBe(true);
    }
  });
});

// The portfolio start is a DERIVATION now, not a constant, and every annualized
// figure divides by the span it measures.
describe('the derived portfolio start (A24)', () => {
  it('the seed derives 2026-02-03, so no D5-pinned figure moves', () => {
    expect(portfolioStart(SEED_ASSETS, buildSeedSnapshots(), SEED_TRANSACTIONS)).toBe('2026-02-03');
  });

  it('all three of the seed signals agree on that date', () => {
    // Why the choice of source could not have broken the seed: its earliest
    // transaction, snapshot and firstPurchase are the same day. A change of rule
    // shows up here rather than as a drifting percentage three screens away.
    const earliestTx = [...SEED_TRANSACTIONS].sort((a, b) => a.date.localeCompare(b.date))[0].date;
    const earliestSnap = buildSeedSnapshots()[0].date;
    const earliestPurchase = [...SEED_ASSETS]
      .map((a) => a.firstPurchase)
      .sort((a, b) => a.localeCompare(b))[0];
    expect([earliestTx, earliestSnap, earliestPurchase]).toEqual([
      '2026-02-03',
      '2026-02-03',
      '2026-02-03',
    ]);
  });
});

describe('portfolioXirr on the seed (A25)', () => {
  const snaps = buildSeedSnapshots();
  const terminalDate = snaps.reduce((max, s) => (s.date > max ? s.date : max), snaps[0].date);
  const rate = portfolioXirr(SEED_TRANSACTIONS, headlineTotal(snaps), terminalDate)!;

  it('is +8.93% money-weighted', () => {
    expect(rate).toBeCloseTo(0.0893, 4);
  });

  it('sits just above the naive annualization of globalRoi, which is the check that it means anything', () => {
    const roi = globalRoi(headlineTotal(snaps), netDeposits(SEED_TRANSACTIONS))!;
    const start = portfolioStart(SEED_ASSETS, snaps, SEED_TRANSACTIONS)!;
    const days = daysBetween(start, terminalDate);
    const naive = (roi * 365) / days;

    expect(roi).toBeCloseTo(0.0408, 4);
    expect(days).toBe(174);
    expect(naive).toBeCloseTo(0.0856, 4);

    // ABOVE the naive figure, and the DIRECTION is the point: XIRR compounds where
    // the stretch is linear, and it weights the February money above the June
    // deposit. A portfolio XIRR below the linear stretch on a purely-growing seed
    // would mean the flows are signed or dated wrong.
    expect(rate).toBeGreaterThan(naive);
    expect(rate - naive).toBeLessThan(0.01);
  });

  it("ignores the seed's internal flows entirely", () => {
    // Fifteen seeded rows are neither deposit nor withdrawal. Dropping them changes
    // nothing, which is what "the boundary is external capital" means on real data.
    const externalOnly = SEED_TRANSACTIONS.filter(
      (t) => t.type === 'deposit' || t.type === 'withdrawal',
    );
    expect(externalOnly).toHaveLength(3);
    expect(portfolioXirr(externalOnly, headlineTotal(snaps), terminalDate)).toBe(rate);
  });
});
