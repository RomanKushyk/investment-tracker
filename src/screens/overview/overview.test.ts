import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Transaction } from '../../core/types';
import {
  LEDGER_DRIFT_EPSILON,
  ledgerDriftChip,
  mostUnderweightAsset,
  nextPayoutRows,
  totalReturnKpi,
} from './overview';

const TOTAL = 149016.36;
const VALUES = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };

describe('mostUnderweightAsset', () => {
  it('picks OVDP …8976 (-6.4pp, the most negative allocation delta) on seed data', () => {
    const r = mostUnderweightAsset(SEED_ASSETS, VALUES, TOTAL);
    expect(r?.asset.id).toBe('ovdp8976');
    expect(r?.deltaPp).toBeCloseTo(-6.365, 2);
    expect(r?.topUp).toBeCloseTo(11429.49, 0); // D5#4
  });

  it('returns undefined when there are no assets', () => {
    expect(mostUnderweightAsset([], {}, 0)).toBeUndefined();
  });

  it('returns undefined when total is 0 (empty DB), even with assets present — avoids a nonsense "top up ₴0.00" hint', () => {
    expect(mostUnderweightAsset(SEED_ASSETS, {}, 0)).toBeUndefined();
  });
});

describe('totalReturnKpi (S9a — audit §5 family, additive to the pinned Capital gain)', () => {
  const snaps = buildSeedSnapshots();

  it('demo: +₴5,839.99 over net deposits 143 176,37 → globalRoi +4.0789% (audit fixture)', () => {
    const kpi = totalReturnKpi(snaps, SEED_TRANSACTIONS);
    expect(kpi.uah).toBeCloseTo(5839.99, 2);
    expect(kpi.roi! * 100).toBeCloseTo(4.0789, 4);
  });

  it('roi is null with no external deposits (netDeposits ≤ 0 guard) → UI sub renders "—"', () => {
    const noDeposits = SEED_TRANSACTIONS.filter((t) => t.type !== 'deposit');
    const kpi = totalReturnKpi(snaps, noDeposits);
    expect(kpi.roi).toBeNull();
    expect(kpi.uah).toBeCloseTo(149016.36, 2); // total − 0
  });

  it('empty stores → 0 value, null roi (zero-value live empty state)', () => {
    const kpi = totalReturnKpi([], []);
    expect(kpi.uah).toBe(0);
    expect(kpi.roi).toBeNull();
  });
});

describe('ledgerDriftChip (S9d — stored cash vs freeCashFromLedger)', () => {
  const snaps = buildSeedSnapshots();

  it('demo drift is 0 by construction → chip hidden (null)', () => {
    expect(ledgerDriftChip(snaps, SEED_TRANSACTIONS)).toBeNull();
  });

  it('an unmatched withdrawal surfaces the signed drift (stored − derived = +amount)', () => {
    const withWithdrawal: Transaction[] = [
      ...SEED_TRANSACTIONS,
      { id: 'w1', date: '2026-07-27', type: 'withdrawal', assetId: '', amount: 100, source: 'own' },
    ];
    expect(ledgerDriftChip(snaps, withWithdrawal)).toBeCloseTo(100, 10);
  });

  it('an unmatched deposit drifts negative (ledger expects more cash than stored)', () => {
    const withDeposit: Transaction[] = [
      ...SEED_TRANSACTIONS,
      { id: 'd9', date: '2026-07-27', type: 'deposit', assetId: '', amount: 123.45, source: 'own' },
    ];
    expect(ledgerDriftChip(snaps, withDeposit)).toBeCloseTo(-123.45, 10);
  });

  it('|drift| ≤ ε (₴0.01) stays hidden; just above it shows', () => {
    expect(LEDGER_DRIFT_EPSILON).toBe(0.01);
    // Seed cash is 7.75 and the seed ledger derives exactly 7.75; shift the
    // ledger by ε via a withdrawal of that size → drift = +0.01 → still null.
    const atEps: Transaction[] = [
      ...SEED_TRANSACTIONS,
      { id: 'w2', date: '2026-07-27', type: 'withdrawal', assetId: '', amount: 0.01, source: 'own' },
    ];
    expect(ledgerDriftChip(snaps, atEps)).toBeNull();
    const aboveEps: Transaction[] = [
      ...SEED_TRANSACTIONS,
      { id: 'w3', date: '2026-07-27', type: 'withdrawal', assetId: '', amount: 0.02, source: 'own' },
    ];
    expect(ledgerDriftChip(snaps, aboveEps)).toBeCloseTo(0.02, 10);
  });

  it('no snapshots → null even when the ledger is non-empty (nothing observed to reconcile)', () => {
    expect(ledgerDriftChip([], SEED_TRANSACTIONS)).toBeNull();
  });
});

describe('nextPayoutRows', () => {
  const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS);

  it('excludes assets with payoutSchedule "none" (Energy)', () => {
    expect(rows.some((r) => r.assetId === 'energy')).toBe(false);
  });

  it('bond rows use couponAmount + nextCoupon (UI renders "₴1,240 · 25 Aug")', () => {
    const bond = rows.find((r) => r.assetId === 'ovdp8976');
    expect(bond).toMatchObject({
      kind: 'coupon',
      assetRef: '…8976',
      amount: 1240,
      approx: false,
      date: '2026-08-25',
    });
  });

  it('dividend-bearing assets estimate the latest dividend amount (approx), next date = latest + 1 month', () => {
    const reit = rows.find((r) => r.assetId === 'reit');
    // latest REIT dividend is 700.36 on 10.07 -> next 10.08 (D5#7: the UI's
    // whole-₴ rendering shows "~₴700", not the reference's ~₴715)
    expect(reit).toMatchObject({ kind: 'dividend', assetRef: 'REIT', approx: true, date: '2026-08-10' });
    expect(reit?.amount).toBeCloseTo(700.36, 2);
  });

  it('is sorted soonest-first', () => {
    const dates = rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('a new dividend asset with no accrual yet is skipped (nothing to estimate from)', () => {
    const newAsset: Asset = {
      id: 'new1',
      name: 'New Fund',
      code: 'NF',
      colorKey: 'reit',
      yieldType: 'dividends',
      expectedPct: 10,
      targetPct: 5,
      payoutSchedule: 'monthly',
      firstPurchase: '2026-07-27',
      createdAt: '2026-07-27T10:00:00',
    };
    const withNew = nextPayoutRows([...SEED_ASSETS, newAsset], SEED_TRANSACTIONS);
    expect(withNew.some((r) => r.assetId === 'new1')).toBe(false);
  });

  it('a bond missing couponAmount/nextCoupon is skipped', () => {
    const bareBond: Asset = {
      id: 'bond2',
      name: 'OVDP UA0000000000',
      code: 'GB',
      colorKey: 'energy',
      yieldType: 'fixed_coupon',
      expectedPct: 15,
      targetPct: 5,
      payoutSchedule: 'semiannual',
      firstPurchase: '2026-07-27',
      createdAt: '2026-07-27T10:00:00',
    };
    const txs: Transaction[] = [];
    expect(nextPayoutRows([bareBond], txs)).toEqual([]);
  });
});
