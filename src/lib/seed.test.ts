import { describe, expect, it } from 'vitest';

import { buildBackup, parseBackup } from '../core/backup/json';
import {
  depositedTotal,
  freeCashFromLedger,
  globalRoi,
  headlineTotal,
  incomeReceived,
  investedByAsset,
  latestCash,
  latestQuotes,
  ledgerCashDrift,
  netDeposits,
  netResult,
  reinvestedByAsset,
  reinvestedTotal,
  totalCapital,
} from '../core/derive';
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

describe('seed aggregates reproduce README §7 / renderVals (D5)', () => {
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

// The WEALTH-MANAGEMENT reconciliation fixtures pinned on the seed
// (docs/FORMULA-AUDIT.md §1/§5). These live here rather than next to
// core/derive.ts because core tests must not import src/lib (G1 lint zone).
describe('ledger reconciliation on the seed (formula audit §1/§5)', () => {
  it('freeCashFromLedger(seed) = ₴7,75 — the stored cash, exactly', () => {
    // deposits 143 176,37 − own-funded buys 143 168,62; payout/reinvest rows
    // are external to broker cash (the doc-verbatim formula would give
    // 3 661,31 and break against every seeded snapshot).
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

// Backup envelope round-trip on the seed builders (NEXT-PHASE-PLAN P1) —
// lives here rather than next to core/backup/json.ts because core tests must
// not import src/lib (G1 lint zone); lib importing core is the allowed way.
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
    expect(result.data.transactions).toHaveLength(18); // D10: "19" was a miscount
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
