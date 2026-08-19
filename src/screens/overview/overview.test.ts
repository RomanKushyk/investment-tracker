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
  // A28 gave this function a reference date. `2026-07-27` is the seed's last
  // snapshot, so every assertion below is what the screen showed before the
  // roll existed — the pinned figures are unchanged, not re-pinned.
  const ON = '2026-07-27';
  const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, ON);

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
    const withNew = nextPayoutRows([...SEED_ASSETS, newAsset], SEED_TRANSACTIONS, ON);
    expect(withNew.some((r) => r.assetId === 'new1')).toBe(false);
  });

  it('a bond with neither a coupon date nor a maturity date is skipped (no date is invented)', () => {
    const txs: Transaction[] = [];
    expect(nextPayoutRows([userBond()], txs, ON)).toEqual([]);
  });
});

// A user-created fixed-coupon asset: the P3 fix (feat/fixed-yield) is that these
// stop being skipped in silence. The seed's own bonds carry both attributes,
// which is exactly why the gap was invisible — and why no D5 figure moves.
function userBond(over: Partial<Asset> = {}): Asset {
  return {
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
    ...over,
  };
}

describe('nextPayoutRows — user-created fixed-coupon assets (P3 fix)', () => {
  const buy: Transaction = {
    id: 'b9',
    date: '2026-07-27',
    type: 'buy',
    assetId: 'bond2',
    amount: 10000,
    source: 'own',
  };

  it('projects an estimated coupon when the asset states no couponAmount', () => {
    const rows = nextPayoutRows([userBond({ nextCoupon: '2026-09-15' })], [buy], '2026-07-27');
    // 15 % of ₴10 000,00 a year, half-yearly = ₴750,00, flagged approx ('~').
    expect(rows).toEqual([
      {
        assetId: 'bond2',
        kind: 'coupon',
        assetRef: '…0000',
        amount: 750,
        approx: true,
        date: '2026-09-15',
      },
    ]);
  });

  it('dates a stated coupon at maturity when no next coupon is recorded', () => {
    const rows = nextPayoutRows([userBond({ couponAmount: 500, maturity: '2027-03-01' })], [buy], '2026-07-27');
    expect(rows).toEqual([
      {
        assetId: 'bond2',
        kind: 'coupon',
        assetRef: '…0000',
        amount: 500,
        approx: false,
        date: '2027-03-01',
      },
    ]);
  });

  it('leaves every seed row byte-identical (additive-only, D5)', () => {
    const withUser = nextPayoutRows(
      [...SEED_ASSETS, userBond({ nextCoupon: '2026-09-15' })],
      [...SEED_TRANSACTIONS, buy],
      '2026-07-27',
    );
    expect(withUser.filter((r) => r.assetId !== 'bond2')).toEqual(
      nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-07-27'),
    );
  });
});

// A28 — the card is called "Next payouts" and it was offering dates in the past.
// Found by the 2026-08-19 walk of navigation-map.md: the seed's last REIT
// accrual is 10.07, so the card said 10.08 on a day the app printed as 19.08.
describe('nextPayoutRows — nothing offered is in the past', () => {
  const buy = (assetId: string): Transaction => ({
    id: `b-${assetId}`,
    date: '2026-02-03',
    type: 'buy',
    assetId,
    amount: 10000,
    source: 'own',
  });

  it('rolls a DIVIDEND forward by whole periods until it is on or after the date', () => {
    // The reported defect, at the date it was reported on.
    const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-08-19');
    expect(rows.find((r) => r.assetId === 'reit')?.date).toBe('2026-09-10');
    // Two periods behind rolls twice, not once — the bug would have been just
    // as present with a single +1 month applied to a stale projection.
    const far = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-10-01');
    expect(far.find((r) => r.assetId === 'reit')?.date).toBe('2026-10-10');
  });

  it('offers the projected date itself when it is exactly the reference date', () => {
    // The boundary: "on or after", so a payout due today is still next.
    const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-08-10');
    expect(rows.find((r) => r.assetId === 'reit')?.date).toBe('2026-08-10');
  });

  it('rolls a COUPON too — the pointer is as stale as the accrual was', () => {
    // `couponProjection` reads `nextCoupon` verbatim, and that field only ever
    // moves through the S5 confirm — so an unrecorded coupon leaves it frozen
    // in the past exactly as the dividend was. Fixing one half and not the
    // other was the first draft of this fix.
    const bond = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!;
    const rows = nextPayoutRows([bond], [buy('ovdp8976')], '2026-09-01');
    expect(rows[0].date).toBe('2027-02-25'); // 25.08 was missed; the next is half a year on
  });

  it('never rolls a coupon past maturity', () => {
    const bond = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!; // matures 2027-02-25
    const rows = nextPayoutRows([bond], [buy('ovdp8976')], '2028-01-01');
    // The final coupon lands ON maturity and the roll stops there (accrual.ts),
    // so a matured bond drops off the card rather than projecting forever.
    expect(rows).toEqual([]);
  });

  it('every row is on or after the reference date, on the seed and past it', () => {
    for (const on of ['2026-07-27', '2026-08-19', '2026-12-31', '2027-01-15']) {
      for (const row of nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, on)) {
        expect(row.date >= on).toBe(true);
      }
    }
  });
});
