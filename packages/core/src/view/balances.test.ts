import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Snapshot, Transaction } from '../types';
import {
  balanceChartData,
  buildBalanceRow,
  completeSnapshots,
  isCompleteSnapshot,
  pageHasNotHeldQuote,
  paginateSnapshots,
} from './balances';
import { TEST_LEDGERS } from './test-ledgers';

const snaps = buildSeedSnapshots();

describe('completeSnapshots', () => {
  it('excludes the partial 27.07 row, keeps all 173 daily rows', () => {
    const complete = completeSnapshots(snaps, SEED_ASSETS, SEED_TRANSACTIONS);
    expect(complete).toHaveLength(173);
    expect(complete.some((s) => s.date === '2026-07-27')).toBe(false);
    expect(complete[complete.length - 1].date).toBe('2026-07-25');
    expect(complete[0].date).toBe('2026-02-03');
  });

  it('does not require a quote for an asset not yet purchased', () => {
    const feb = snaps.find((s) => s.date === '2026-02-10')!; // before ovdp6475 exists
    expect(completeSnapshots([feb], SEED_ASSETS, SEED_TRANSACTIONS)).toEqual([feb]);
  });
});

describe('balanceChartData', () => {
  it('maps complete snapshots to {date, total}, ascending', () => {
    const data = balanceChartData(snaps, SEED_ASSETS, SEED_TRANSACTIONS);
    expect(data).toHaveLength(173);
    expect(data[0].date).toBe('2026-02-03');
    const last = data[data.length - 1];
    expect(last.date).toBe('2026-07-25');
    expect(last.total).toBeCloseTo(148943.62, 2);
  });
});

describe('buildBalanceRow', () => {
  it('27.07: REIT value, 3 pending cells, total null (design "—")', () => {
    const row = buildBalanceRow(snaps[snaps.length - 1], SEED_ASSETS, SEED_TRANSACTIONS);
    expect(row.cells[0]).toEqual({ status: 'value', amount: 68702.1 });
    expect(row.cells[1]).toEqual({ status: 'pending' });
    expect(row.cells[2]).toEqual({ status: 'pending' });
    expect(row.cells[3]).toEqual({ status: 'pending' });
    expect(row.total).toBeNull();
  });

  it('25.07: all values present, total 148 943,62', () => {
    const row = buildBalanceRow(
      snaps.find((s) => s.date === '2026-07-25')!,
      SEED_ASSETS,
      SEED_TRANSACTIONS,
    );
    expect(row.cells.every((c) => c.status === 'value')).toBe(true);
    expect(row.total).toBeCloseTo(148943.62, 2);
  });

  it('an asset not yet purchased renders "none", not "pending"', () => {
    const row = buildBalanceRow(
      snaps.find((s) => s.date === '2026-02-10')!,
      SEED_ASSETS,
      SEED_TRANSACTIONS,
    );
    expect(row.cells[3]).toEqual({ status: 'none' }); // ovdp6475 doesn't exist until 02.06
  });
});

describe('paginateSnapshots', () => {
  it('page 0 = newest 6 rows: 27.07 down to 21.07, newest first', () => {
    const { rows, total, next } = paginateSnapshots(snaps, 0);
    expect(rows.map((s) => s.date)).toEqual([
      '2026-07-27',
      '2026-07-25',
      '2026-07-24',
      '2026-07-23',
      '2026-07-22',
      '2026-07-21',
    ]);
    expect(total).toBe(174);
    expect(next).toBe(1);
  });

  it('last page has the remaining rows ending at the oldest = 03.02, and names no next', () => {
    const { rows, next } = paginateSnapshots(snaps, 28); // ceil(174/6) pages, 0-based
    expect(rows[rows.length - 1].date).toBe('2026-02-03');
    expect(next).toBeNull();
  });

  // AIP-158: an offset past the end is an empty page, never the last one under another number.
  it('answers a page past the last with no rows and no next', () => {
    for (const page of [29, 999]) {
      expect(paginateSnapshots(snaps, page)).toEqual({ rows: [], page, total: 174, next: null });
    }
  });

  // A negative offset slices from the end: -2 would be the sixth to twelfth oldest.
  it('answers a negative page with no rows', () => {
    for (const page of [-1, -2]) expect(paginateSnapshots(snaps, page).rows).toEqual([]);
  });

  // A full last page is where inferring the end from a short page fails.
  it('names no next on a full last page, so the end is never inferred from a short one', () => {
    const twelve = snaps.slice(0, 12);
    expect(paginateSnapshots(twelve, 0).next).toBe(1);
    const last = paginateSnapshots(twelve, 1);
    expect([last.rows.length, last.next]).toEqual([6, null]);
  });

  // No producer stores two snapshots on one date, but a page must not depend on arrival order
  // whatever it holds: equal dates fall back to what the row shows, the quotes.
  it('keeps two rows of one date on the same pages whatever order they arrive in', () => {
    const dated = snaps.slice(0, 7);
    // The sixth and seventh newest share a date, so they straddle the page boundary.
    const twin: Snapshot = { ...dated[1], quotes: { ...dated[1].quotes, reit: 1 } };
    const all = [...dated, twin];
    const pages = (input: Snapshot[]) =>
      JSON.stringify([paginateSnapshots(input, 0).rows, paginateSnapshots(input, 1).rows]);
    const expected = pages(all);
    expect(pages([...all].reverse())).toBe(expected);
    expect(pages([twin, ...dated])).toBe(expected);
    expect(
      pages([...all.filter((_, i) => i % 2 === 1), ...all.filter((_, i) => i % 2 === 0)]),
    ).toBe(expected);
  });
});

describe('a stored quote for a day the ledger holds no units of', () => {
  // Shown, marked and not counted: a position's value counts at a date only while the ledger
  // holds units of it. The date picker accepts any day, so an early quote is reachable.
  const early = () => {
    const base = snaps.find((s) => s.date === '2026-02-04')!;
    return { ...base, quotes: { ...base.quotes, ovdp8976: 15390 } };
  };
  // The ledger's later snapshots still quote the position it sold out of.
  const soldOut = TEST_LEDGERS.find((l) => l.name === 'sold-out')!.input;
  const soldOutRow = (date: string) =>
    buildBalanceRow(
      soldOut.snapshots.find((s) => s.date === date)!,
      soldOut.assets,
      soldOut.transactions,
    );

  it('a day before the first buy: shown marked, and the row totals without it', () => {
    const row = buildBalanceRow(early(), SEED_ASSETS, SEED_TRANSACTIONS);
    expect(row.cells.map((c) => (c.status === 'value' ? c.amount : c.status))).toEqual([
      expect.closeTo(64648.47, 2),
      expect.closeTo(59214.04, 2),
      15390,
      'none',
    ]);
    expect(row.cells[2]).toEqual({ status: 'value', amount: 15390, notHeld: true });
    expect(row.cash).toBeCloseTo(7.75, 2);
    expect(row.total).toBeCloseTo(123870.26, 2);
  });

  it('after a sell-out: shown marked, and the row and the chart count the proceeds alone', () => {
    const row = soldOutRow('2026-07-25');
    expect(row.cells[2]).toEqual({
      status: 'value',
      amount: expect.closeTo(15846.3, 2),
      notHeld: true,
    });
    expect(row.total).toBeCloseTo(148897.32, 2);
    const point = balanceChartData(soldOut.snapshots, soldOut.assets, soldOut.transactions).find(
      (p) => p.date === '2026-07-25',
    )!;
    expect(point.total).toBeCloseTo(148897.32, 2);
  });

  it('after a sell-out, a snapshot that leaves the position out is complete', () => {
    const sale: Transaction = {
      id: 's2',
      date: '2026-07-01',
      type: 'sell',
      assetId: 'ovdp8976',
      amount: 15800,
      quantity: 15,
    };
    const txs = [...SEED_TRANSACTIONS, sale];
    const later: Snapshot = {
      date: '2026-07-28',
      quotes: { reit: 68702.1, energy: 60086.09, ovdp6475: 4374.12 },
    };
    expect(isCompleteSnapshot(later, SEED_ASSETS, txs)).toBe(true);
    const row = buildBalanceRow(later, SEED_ASSETS, txs);
    expect(row.cells[2]).toEqual({ status: 'none' });
    expect(row.cash).toBeCloseTo(15807.75, 2);
    expect(row.total).toBeCloseTo(148970.06, 2);
    expect(balanceChartData([...snaps, later], SEED_ASSETS, txs).at(-1)).toEqual({
      date: '2026-07-28',
      total: expect.closeTo(148970.06, 2),
    });
  });

  // Holds while every quote key belongs to a listed asset. A quote left behind by
  // a deleted one is counted by `totalCapital` with no cell to show it.
  it('adds up: the unmarked cells plus its cash equal the total it prints', () => {
    for (const row of [
      buildBalanceRow(early(), SEED_ASSETS, SEED_TRANSACTIONS),
      soldOutRow('2026-07-25'),
    ]) {
      const counted = row.cells.reduce(
        (sum, c) => sum + (c.status === 'value' && !c.notHeld ? c.amount : 0),
        0,
      );
      expect(row.total).not.toBeNull();
      expect(counted + row.cash).toBeCloseTo(row.total!, 2);
    }
  });

  it('is what the page footnote keys off, and only that', () => {
    const marked = buildBalanceRow(early(), SEED_ASSETS, SEED_TRANSACTIONS);
    const plain = buildBalanceRow(
      snaps.find((s) => s.date === '2026-07-25')!,
      SEED_ASSETS,
      SEED_TRANSACTIONS,
    );
    expect(pageHasNotHeldQuote([plain, marked])).toBe(true);
    expect(pageHasNotHeldQuote([plain, soldOutRow('2026-07-25')])).toBe(true);
    expect(pageHasNotHeldQuote([plain])).toBe(false);
    // A 'none' cell is not a mark: the date predates both bonds and holds no quote.
    expect(pageHasNotHeldQuote([buildBalanceRow(snaps[0], SEED_ASSETS, SEED_TRANSACTIONS)])).toBe(
      false,
    );
    expect(pageHasNotHeldQuote([])).toBe(false);
  });
});

describe('an asset whose units the ledger cannot count keeps the first-purchase rule', () => {
  // Its quote counts, as total capital counts it, and is never marked: the mark means only
  // that the total leaves a value out.
  it('a quote no transaction stands behind is counted, unmarked, even before its first purchase', () => {
    const quoted: Asset = { ...SEED_ASSETS[2], id: 'quoted', firstPurchase: '2026-02-05' };
    const assets = [...SEED_ASSETS, quoted];
    const on = (date: string) => snaps.find((s) => s.date === date)!;
    const feb4 = { ...on('2026-02-04'), quotes: { ...on('2026-02-04').quotes, quoted: 15390 } };

    const row = buildBalanceRow(feb4, assets, SEED_TRANSACTIONS);
    expect(row.cells[4]).toEqual({ status: 'value', amount: 15390 });
    expect(row.total).toBeCloseTo(139260.26, 2);
    expect(buildBalanceRow(on('2026-02-03'), assets, SEED_TRANSACTIONS).cells[4]).toEqual({
      status: 'none',
    });
    const feb10 = buildBalanceRow(on('2026-02-10'), assets, SEED_TRANSACTIONS);
    expect(feb10.cells[4]).toEqual({ status: 'pending' });
    expect(feb10.total).toBeNull();
  });

  it('a buy stored without its units keeps a quote dated after the position was sold', () => {
    const txs: Transaction[] = [
      ...SEED_TRANSACTIONS.map((t) => (t.id === 'b3' ? { ...t, quantity: undefined } : t)),
      {
        id: 's2',
        date: '2026-07-01',
        type: 'sell',
        assetId: 'ovdp8976',
        amount: 15800,
        quantity: 15,
      },
    ];
    const row = buildBalanceRow(
      snaps.find((s) => s.date === '2026-07-25')!,
      SEED_ASSETS,
      txs,
    );
    expect(row.cells[2]).toEqual({ status: 'value', amount: expect.closeTo(15846.3, 2) });
    expect(row.total).toBeCloseTo(164743.62, 2);
  });
});
