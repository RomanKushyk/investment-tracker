import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import { netDeposits } from '../derive';
import type { Asset, Transaction } from '../types';
import {
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

  it('demo: +₴9,398.27 over net deposits 139 618,09 → +6.7314%', () => {
    // +₴5 839,99 / +4,08 % was this card while the ₴3 558,28 of withdrawn dividends
    // was invisible: the gain was short by exactly the money that left the perimeter.
    const kpi = totalReturnKpi(snaps, SEED_TRANSACTIONS);
    expect(kpi.uah).toBeCloseTo(9398.27, 2);
    expect(kpi.roi! * 100).toBeCloseTo(6.7314, 4);
  });

  it('roi is null when external capital is not positive (the basis guard) → UI sub renders "—"', () => {
    // Dropping the deposits drops the cash they created too, because free cash is
    // DERIVED: the basis goes negative rather than to zero, and the same guard holds.
    const noDeposits = SEED_TRANSACTIONS.filter((t) => t.type !== 'deposit');
    expect(netDeposits(noDeposits)).toBeCloseTo(-3558.28, 2);
    expect(totalReturnKpi(snaps, noDeposits).roi).toBeNull();
  });

  it('empty stores → 0 value, null roi (zero-value live empty state)', () => {
    const kpi = totalReturnKpi([], []);
    expect(kpi.uah).toBe(0);
    expect(kpi.roi).toBeNull();
  });
});

describe('nextPayoutRows', () => {
  // The reference date is the seed's last snapshot, so every assertion below is
  // what the screen showed before the roll existed: unchanged, not re-pinned.
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
    expect(reit).toMatchObject({
      kind: 'dividend',
      assetRef: 'REIT',
      approx: true,
      date: '2026-08-10',
    });
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

// A user-created fixed-coupon asset: these used to be skipped in silence. The
// seed's own bonds carry both attributes, which is why the gap was invisible.
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
  };

  it('projects an estimated coupon when the asset states no couponAmount', () => {
    const rows = nextPayoutRows([userBond({ nextCoupon: '2026-09-15' })], [buy], '2026-07-27');
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
    const rows = nextPayoutRows(
      [userBond({ couponAmount: 500, maturity: '2027-03-01' })],
      [buy],
      '2026-07-27',
    );
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

// The card is called "Next payouts" and it was offering dates in the past,
// because the seed's last accrual predates the day the app printed.
describe('nextPayoutRows — nothing offered is in the past', () => {
  const buy = (assetId: string): Transaction => ({
    id: `b-${assetId}`,
    date: '2026-02-03',
    type: 'buy',
    assetId,
    amount: 10000,
  });

  it('rolls a DIVIDEND forward by whole periods until it is on or after the date', () => {
    const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-08-19');
    expect(rows.find((r) => r.assetId === 'reit')?.date).toBe('2026-09-10');
    // Two periods behind rolls twice, not once.
    const far = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-10-01');
    expect(far.find((r) => r.assetId === 'reit')?.date).toBe('2026-10-10');
  });

  it('offers the projected date itself when it is exactly the reference date', () => {
    // The boundary: "on or after", so a payout due today is still next.
    const rows = nextPayoutRows(SEED_ASSETS, SEED_TRANSACTIONS, '2026-08-10');
    expect(rows.find((r) => r.assetId === 'reit')?.date).toBe('2026-08-10');
  });

  it('rolls a COUPON too — the pointer is as stale as the accrual was', () => {
    // `couponProjection` reads `nextCoupon` verbatim, and that field only ever moves
    // through the confirm — so an unrecorded coupon leaves it frozen in the past
    // exactly as the dividend was.
    const bond = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!;
    const rows = nextPayoutRows([bond], [buy('ovdp8976')], '2026-09-01');
    expect(rows[0].date).toBe('2027-02-25'); // 25.08 was missed; the next is half a year on
  });

  it('never rolls a coupon past maturity', () => {
    const bond = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!; // matures 2027-02-25
    const rows = nextPayoutRows([bond], [buy('ovdp8976')], '2028-01-01');
    // The final coupon lands ON maturity and the roll stops there, so a matured bond
    // drops off the card rather than projecting forever.
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

  it('reproduces the seed’s +14,87 % unwindowed, and moves under a window', () => {
    // THE WINDOW NOW READS LOWER, and the direction is not a law either way: the full
    // history collects five months of payouts returned to the investor early, where the
    // last three months hold only ₴586 of them. Before the payouts entered the ledger
    // the full history read +8,93 % and any window beat it; a window is a different
    // span over a different flow set, and the only invariant is that it MOVES.
    const unwindowed = portfolioXirrIn(snaps, SEED_TRANSACTIONS, full)! * 100;
    expect(unwindowed).toBeCloseTo(14.87, 1);
    const m3 = { from: '2026-04-27', to: '2026-07-27', clamped: false };
    expect(portfolioXirrIn(snaps, SEED_TRANSACTIONS, m3)! * 100).toBeCloseTo(13.93, 1);
  });

  it('a deposit entered since the last snapshot still counts (the A39 regression, not repeated)', () => {
    const later: Transaction = {
      id: 'late-dep',
      date: '2026-08-05',
      type: 'deposit',
      assetId: '',
      amount: 10_000,
    };
    const withDep = totalReturnKpiIn(snaps, [...SEED_TRANSACTIONS, later], full);
    const without = totalReturnKpiIn(snaps, SEED_TRANSACTIONS, full);
    // Capital did not move, so fresh deposits must reduce the net return by exactly
    // that much.
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
    // The point of the test: a card on the full history with a sub-line pointing at the window's left end.
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
    };
    const withSell = netResultIn(snaps, [...SEED_TRANSACTIONS, sell], m3);
    const without = netResultIn(snaps, SEED_TRANSACTIONS, m3);
    // Selling near market is close to return-neutral; a double count would add
    // the whole ~15 800 to the gain.
    expect(Math.abs(withSell.uah - without.uah)).toBeLessThan(1_000);
  });
});
