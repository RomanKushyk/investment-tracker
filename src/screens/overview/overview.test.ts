import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Asset, Transaction } from '../../core/types';
import {
  LEDGER_DRIFT_EPSILON,
  ledgerDriftChip,
  mostUnderweightAsset,
  nextPayoutRows,
  totalReturnKpi,
  totalReturnKpiIn,
  portfolioXirrIn,
  netResultIn,
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

describe('the windowed KPI (A40) — and the XIRR beside it (D-8)', () => {
  const snaps = buildSeedSnapshots();
  const full = { from: '2026-02-03', to: '2026-07-27', clamped: false };

  it('reduces exactly at the full history — the property the design hangs on', () => {
    expect(totalReturnKpiIn(snaps, SEED_TRANSACTIONS, full)).toEqual(
      totalReturnKpi(snaps, SEED_TRANSACTIONS),
    );
    expect(portfolioXirrIn(snaps, SEED_TRANSACTIONS, full)).toBeCloseTo(
      portfolioXirrIn(snaps, SEED_TRANSACTIONS, undefined)!,
      10,
    );
  });

  it('reproduces A25’s +8,93 % unwindowed, and moves under a window', () => {
    // The seed figure the brief and the extension both quote. A shorter window
    // measures the same portfolio over less time, so the money-weighted rate
    // rises — the same shape F-2 records for `Річна`, on a different figure.
    expect(portfolioXirrIn(snaps, SEED_TRANSACTIONS, full)! * 100).toBeCloseTo(8.93, 1);
    const m3 = { from: '2026-04-27', to: '2026-07-27', clamped: false };
    expect(portfolioXirrIn(snaps, SEED_TRANSACTIONS, m3)! * 100).toBeGreaterThan(8.93);
  });

  it('a deposit entered since the last snapshot still counts (the A39 regression, not repeated)', () => {
    const later: Transaction = {
      id: 'late-dep',
      date: '2026-08-05',
      type: 'deposit',
      assetId: '',
      amount: 10_000,
      source: 'own',
    };
    const withDep = totalReturnKpiIn(snaps, [...SEED_TRANSACTIONS, later], full);
    const without = totalReturnKpiIn(snaps, SEED_TRANSACTIONS, full);
    // Capital did not move (no new snapshot), so 10 000 of fresh deposits must
    // reduce the net return by exactly that much.
    expect(without.uah - withDep.uah).toBeCloseTo(10_000, 6);
  });
});

describe('the windowed KPIs move — the half a reduction test cannot see', () => {
  const snaps = buildSeedSnapshots();
  const full = { from: '2026-02-03', to: '2026-07-27', clamped: false };
  const m3 = { from: '2026-04-27', to: '2026-07-27', clamped: false };

  it('netResultIn reduces, and then actually changes under a window', () => {
    expect(netResultIn(snaps, SEED_TRANSACTIONS, full).uah).toBeCloseTo(4452.61, 2);
    expect(netResultIn(snaps, SEED_TRANSACTIONS, full).pct * 100).toBeCloseTo(3.08, 2);
    // The point of the test: a first cut left this card on the full history
    // while its sub-line pointed at the window's left end.
    expect(netResultIn(snaps, SEED_TRANSACTIONS, m3).uah).not.toBeCloseTo(4452.61, 2);
  });

  it('the windowed ROI is a RATIO, not globalRoi fed the wrong shape', () => {
    // `globalRoi(total, deposits)` is `(total − deposits) / deposits`. Handing
    // it the windowed gain and the windowed basis subtracted the basis twice
    // and rendered −94,43 % on a portfolio that was up. Only a window shows it:
    // at the full history `open` is 0 and the two expressions agree.
    const k = totalReturnKpiIn(snaps, SEED_TRANSACTIONS, m3);
    expect(k.uah).toBeGreaterThan(0);
    expect(k.roi).toBeGreaterThan(0);
    expect(k.roi).toBeLessThan(0.2);
  });
});

describe('the windowed edge cases the seed cannot show (A40 review)', () => {
  const snaps = buildSeedSnapshots();
  const m3 = { from: '2026-04-27', to: '2026-07-27', clamped: false };

  it('a window opening before the first VALUATION has no baseline, and says so', () => {
    // Held since February, first valued in June. Measuring from 0 would report
    // the entire portfolio as three months' return, at several hundred percent.
    const lateSnaps = snaps.filter((s) => s.date >= '2026-06-01');
    expect(totalReturnKpiIn(lateSnaps, SEED_TRANSACTIONS, m3).roi).toBeNull();
    expect(portfolioXirrIn(lateSnaps, SEED_TRANSACTIONS, m3)).toBeNull();
    // …but the FULL history opens against nothing HELD, which is not the same
    // thing: 0 is the right opening value there, and the figures must survive.
    expect(totalReturnKpiIn(snaps, SEED_TRANSACTIONS, undefined).roi).not.toBeNull();
  });

  it('a basis withdrawn down to dust renders "—", not a division by it', () => {
    // The window opens at 140 940,62 and takes 3 942 of deposits, so a
    // withdrawal past 144 882 leaves under a hryvnia of capital to measure
    // against. `basis <= 0` alone would not catch it — the sign is fine and the
    // magnitude is the problem.
    const out: Transaction = {
      id: 'big-withdrawal',
      date: '2026-05-01',
      type: 'withdrawal',
      assetId: '',
      amount: 144_882,
      source: 'own',
    };
    expect(totalReturnKpiIn(snaps, [...SEED_TRANSACTIONS, out], m3).roi).toBeNull();

    // A withdrawal that leaves REAL capital behind is not the same case and
    // must still report: a large percentage on a small remaining basis is a
    // fact about the portfolio, not an artefact of the formula.
    const smaller: Transaction = { ...out, id: 'w2', amount: 50_000 };
    expect(totalReturnKpiIn(snaps, [...SEED_TRANSACTIONS, smaller], m3).roi).not.toBeNull();
  });

  it('a SELL does not count twice, though the sold asset keeps its last quote', () => {
    // `quotesAsOf` merges snapshots, so an asset absent after its sale keeps
    // its final value forever. Counting that AND the proceeds invents a gain.
    const sell: Transaction = {
      id: 'sell-8976',
      date: '2026-06-01',
      type: 'sell',
      assetId: 'ovdp8976',
      amount: 15_800,
      source: 'own',
    };
    const withSell = netResultIn(snaps, [...SEED_TRANSACTIONS, sell], m3);
    const without = netResultIn(snaps, SEED_TRANSACTIONS, m3);
    // Selling near market is close to return-neutral; a double count would add
    // the whole ~15 800 to the gain.
    expect(Math.abs(withSell.uah - without.uah)).toBeLessThan(1_000);
  });
});
