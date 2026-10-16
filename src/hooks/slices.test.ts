import { describe, expect, it, vi } from 'vitest';

import { PERIOD_OPTIONS } from '@quirenote/core/period';
import { unitsByAsset } from '@quirenote/core/derive';
import { computeReminders } from '@quirenote/core/reminders';
import type { Snapshot, Transaction } from '@quirenote/core/types';
import { allocationView } from '@quirenote/core/view/allocation';
import { attributesView, derivedYtmPct } from '@quirenote/core/view/attributes';
import { balancesView, buildBalanceRow, paginateSnapshots } from '@quirenote/core/view/balances';
import { ledgerAsOf } from '@quirenote/core/view/build';
import { capitalView } from '@quirenote/core/view/capital';
import { overviewView } from '@quirenote/core/view/overview';
import { payoutsView } from '@quirenote/core/view/payouts';
import { portfolioView } from '@quirenote/core/view/portfolio';
import { seasonalityView } from '@quirenote/core/view/seasonality';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { windowView } from '@quirenote/core/view/window';
import { cumulativeYieldSeriesIn, yieldView } from '@quirenote/core/view/yield';
import { balancesOf, dayOf, seriesOf, viewOf } from '../__fixtures__/stored-view';
import * as slices from './slices';
import { remindersOf } from './useReminders';

// The reminders sit beside the hooks that read the view; nothing here reads the API.
vi.mock('../lib/api', () => ({ repo: {} }));

// BEFORE AND AFTER. Before: the composers each screen called, over the rows the device stored, cut
// to today as `useLedgerAsOfToday` cut them. After: the slice that screen reads of the view the
// device derives from the same rows. No figure moves, on any ledger, the seed's among them: the
// device composes over the snapshots it stores, as they are stored.

const TOL = 1e-12;

/** The paths where two outputs differ by more than `tolerance`, relative: 0 is exact. */
function differences(a: unknown, b: unknown, tolerance: number, path = '$'): string[] {
  if (typeof a === 'number' && typeof b === 'number') {
    const limit = tolerance * Math.max(Math.abs(a), Math.abs(b));
    return Object.is(a, b) || Math.abs(a - b) <= limit ? [] : [path];
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Object.is(a, b) ? [] : [path];
  }
  const at = (o: object, k: string) => (o as Record<string, unknown>)[k];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => differences(at(a, k), at(b, k), tolerance, `${path}.${k}`));
}
const same = (got: unknown, legacy: unknown, tolerance = TOL) =>
  expect(differences(got, legacy, tolerance)).toEqual([]);

// Every ledger the golden master runs over, those that quote a position held none of included.
const LEDGERS = TEST_LEDGERS;

/** The rows as the repository lists them: assets by creation, the rest by day. */
function stored(input: (typeof TEST_LEDGERS)[number]['input']) {
  const by = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    assets: [...input.assets].sort((a, b) => by(a.createdAt, b.createdAt) || by(a.id, b.id)),
    snapshots: [...input.snapshots].sort((a, b) => by(a.date, b.date)),
    transactions: [...input.transactions].sort((a, b) => by(a.date, b.date) || by(a.id, b.id)),
  };
}

interface Day {
  date: string;
  quotes: Record<string, number>;
  previous: Record<string, { value: number; date: string }>;
  savedAt: string | null;
}

/** The reads of one day over stored snapshots, written without core: the form's prefill less a
 *  position held none of that day, each held position's baseline — the day's units at its last
 *  per-unit price before it, a quote of a position held none of having no such price — and the
 *  latest save time. */
function storedDay(
  snapshots: Snapshot[],
  transactions: Transaction[],
  assetIds: string[],
  date: string,
): Day {
  const heldOn = (day: string) => unitsByAsset(transactions, day);
  const units = heldOn(date);
  const previous: Day['previous'] = {};
  for (const id of assetIds) {
    let best: Snapshot | undefined;
    for (const s of snapshots) {
      if (s.date >= date || !(s.quotes[id] > 0) || !((heldOn(s.date)[id] ?? 0) > 0)) continue;
      if (!best || s.date > best.date) best = s;
    }
    const held = units[id];
    if (best && held !== undefined && held > 0) {
      const price = best.quotes[id] / heldOn(best.date)[id];
      previous[id] = { value: Math.round(held * price * 100) / 100, date: best.date };
    }
  }
  let savedAt: string | null = null;
  for (const s of snapshots) {
    if (s.savedAt && (savedAt === null || s.savedAt > savedAt)) savedAt = s.savedAt;
  }
  const quotes = Object.fromEntries(
    Object.entries(snapshots.find((s) => s.date === date)?.quotes ?? {}).filter(
      ([id]) => (units[id] ?? 0) > 0,
    ),
  );
  return { date, quotes, previous, savedAt };
}

/** Plain objects and arrays all the way down: what TanStack's structural sharing can see through.
 *  A `Map`, a `Set` or a class instance is replaced whole, and its slice would re-render on every
 *  read (query-core's `replaceEqualDeep`). */
function nonPlainPaths(value: unknown, path = '$'): string[] {
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonPlainPaths(v, `${path}.${i}`));
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return [path];
  return Object.entries(value).flatMap(([k, v]) => nonPlainPaths(v, `${path}.${k}`));
}

describe.each(LEDGERS.map((l) => [l.name, l.input] as const))('%s', (_, input) => {
  const tables = stored(input);
  const body = viewOf(tables, input.today);
  const cut = ledgerAsOf({ ...tables, today: input.today });

  it('is plain data, so a slice that did not change keeps its identity', () => {
    expect(nonPlainPaths(body)).toEqual([]);
  });

  it('hands a form every row in the order the repository listed them', () => {
    const form = slices.selectLedgerForm(body);
    expect(form.assets).toEqual(tables.assets);
    expect(form.transactions).toEqual(tables.transactions);
  });

  it.each(PERIOD_OPTIONS)('Overview at %s', (period) => {
    same(slices.overviewOf[period](body), {
      overview: overviewView({ ...cut, period }),
      today: input.today,
    });
  });

  it.each(PERIOD_OPTIONS)('Yield at %s', (period) => {
    same(slices.yieldOf[period](body), {
      yield: yieldView({ ...cut, period }),
      assets: tables.assets,
    });
  });

  it.each(PERIOD_OPTIONS)('Seasonality at %s', (period) => {
    same(slices.seasonalityOf[period](body), {
      seasonality: seasonalityView({ ...cut, period }),
      assets: tables.assets,
    });
  });

  it('the period control spans the whole history', () => {
    same(slices.selectSpan(body), { window: windowView({ ...cut, period: 'all' }) });
  });

  it('Payouts', () => {
    same(slices.selectPayouts(body), {
      payouts: payoutsView({ ...cut, today: input.today }),
      assets: tables.assets,
    });
  });

  it('Portfolio', () => {
    same(slices.selectPortfolio(body), { portfolio: portfolioView(cut), assets: tables.assets });
  });

  it('Allocation', () => {
    same(slices.selectAllocation(body), { allocation: allocationView(cut), assets: tables.assets });
  });

  it('the capital card', () => {
    same(slices.selectCapital(body), capitalView(cut));
  });

  it('the Balances chart, which ends on the last complete snapshot', () => {
    const legacy = balancesView(cut);
    const got = slices.selectBalances(body);
    expect(got.earliest).toBe(legacy.earliest);
    same(got.chart, legacy.chart);
  });

  it.each(PERIOD_OPTIONS)('the Yield curve at %s', (period) => {
    const w = windowView({ ...cut, period });
    const legacy = cumulativeYieldSeriesIn(cut.snapshots, cut.transactions, cut.assets, w);
    same(seriesOf(tables, period, input.today).series, legacy);
  });

  it('the Balances table, page by page, each stored snapshot as it was stored', () => {
    for (let page = 0; ; page++) {
      const cutPage = paginateSnapshots(cut.snapshots, page);
      const got = balancesOf(tables, page, input.today);
      expect(got.assets).toEqual(cut.assets.map((a) => a.id));
      expect({ page: got.page, total: got.total, next: got.next }).toEqual({
        page: cutPage.page,
        total: cutPage.total,
        next: cutPage.next,
      });
      same(
        got.rows,
        cutPage.rows.map((s) => buildBalanceRow(s, cut.assets, cut.transactions)),
      );
      if (cutPage.next === null) break;
    }
  });

  it('Attributes, but for the YTM the feed solves, over the ledger cut to today', () => {
    const got = slices.selectAttributes(body);
    same(got.cards, attributesView({ ...cut, feed: undefined }).cards);
    expect(got.transactions).toEqual(cut.transactions);
  });

  it("the quotes screen's form and its yield card", () => {
    const got = slices.selectQuotesForm(body);
    expect(got.assets).toEqual(tables.assets);
    expect(got.transactions).toEqual(tables.transactions);
    same(got.yields, yieldView({ ...cut, period: 'all' }).rows);
  });

  it("the delete dialog's counts", () => {
    for (const a of tables.assets) {
      expect(slices.selectDeleteCounts(body)[a.id]).toEqual({
        transactions: tables.transactions.filter((t) => t.assetId === a.id).length,
        quoteDays: tables.snapshots.filter((s) => a.id in s.quotes).length,
      });
    }
  });

  describe('a day', () => {
    // Before the first, on it, in the middle, around the seed's last stored day, and well past.
    const DATES = [
      '2026-01-01',
      '2026-02-02',
      '2026-02-03',
      '2026-02-04',
      '2026-04-15',
      '2026-07-24',
      '2026-07-25',
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-09-01',
    ];
    const ids = tables.assets.map((a) => a.id);

    it.each(DATES)('%s: what the form prefills, its baselines and the save time', (date) => {
      same(dayOf(tables, date), storedDay(tables.snapshots, tables.transactions, ids, date), 1e-9);
    });

    it.each(DATES)('%s: is the same whatever order the snapshots arrive in', (date) => {
      const reversed = { ...tables, snapshots: [...tables.snapshots].reverse() };
      expect(dayOf(reversed, date)).toEqual(dayOf(tables, date));
    });

    it("is the view's own for the caller's day", () => {
      same(body.today, storedDay(tables.snapshots, tables.transactions, ids, input.today), 1e-9);
    });
  });

  describe('the reminders', () => {
    it.each(['2026-02-10', '2026-04-15', '2026-07-27', '2026-07-28', '2026-08-01'])(
      'on %s are the ones the stored ledger gave',
      (today) => {
        const day = viewOf(tables, today);
        for (const opts of [{}, { leadDays: 3 }]) {
          expect(remindersOf(slices.selectReminders(day), opts)).toEqual(
            computeReminders(tables.assets, tables.snapshots, tables.transactions, today, opts),
          );
        }
      },
    );
  });
});

describe('the sold-out ledger, which quotes a position after the ledger holds none of it', () => {
  const input = TEST_LEDGERS.find((l) => l.name === 'sold-out')!.input;
  const tables = stored(input);

  it('marks that quote in the table, where the screen reads it and the footnote counts it', () => {
    const { rows, assets } = balancesOf(tables, 0, input.today);
    const marked = rows.flatMap((row) =>
      row.cells.flatMap((cell, i) =>
        cell.status === 'value' && cell.notHeld ? [`${row.date} ${assets[i]}`] : [],
      ),
    );
    expect(marked.length).toBeGreaterThan(0);
    expect(new Set(marked.map((m) => m.split(' ')[1]))).toEqual(new Set(['ovdp8976']));
  });
});

describe('the seed, as navigation-map.md reads it', () => {
  const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
  const tables = stored(seed);

  it('ends the chart on the last complete snapshot, and the newest row still awaits three quotes', () => {
    const chart = slices.selectBalances(viewOf(tables, seed.today)).chart;
    expect(chart.at(-1)?.date).toBe('2026-07-25');
    const [newest] = balancesOf(tables, 0, seed.today).rows;
    expect(newest.date).toBe('2026-07-27');
    expect(newest.cells.filter((c) => c.status === 'pending')).toHaveLength(3);
    expect(newest.total).toBeNull();
  });

  // …8976 is first bought on 05.02, so a quote saved for it on 04.02 is one its position is not
  // held for: stored and removed with the asset, never prefilled, as a day quotes no position it
  // holds none of.
  describe('a quote saved for a day its position is not held', () => {
    const DAY = '2026-02-04';
    const withQuote = {
      ...tables,
      snapshots: tables.snapshots.map((s) =>
        s.date === DAY ? { ...s, quotes: { ...s.quotes, ovdp8976: 15390 } } : s,
      ),
    };

    it('is the premise: nothing of …8976 is bought on or before the day', () => {
      expect(withQuote.snapshots.find((s) => s.date === DAY)?.quotes.ovdp8976).toBe(15390);
      expect(tables.transactions.filter((t) => t.assetId === 'ovdp8976' && t.date <= DAY)).toEqual(
        [],
      );
    });

    it('is no prefill when the day is opened again', () => {
      expect(dayOf(withQuote, DAY).quotes).not.toHaveProperty('ovdp8976');
      expect(viewOf(withQuote, DAY).today.quotes).not.toHaveProperty('ovdp8976');
    });

    it("counts in the delete dialog, as the delete removes the asset's key from the day", () => {
      const without = viewOf(tables, seed.today).deleteCounts.ovdp8976.quoteDays;
      expect(viewOf(withQuote, seed.today).deleteCounts.ovdp8976.quoteDays).toBe(without + 1);
    });
  });
});

describe('the YTM the feed solves', () => {
  const linked = TEST_LEDGERS.find((l) => l.name === 'linked')!.input;
  // The buy is dated 12.08.2026: on the 20th it is held.
  const today = '2026-08-20';
  const tables = stored(linked);
  const cut = ledgerAsOf({ ...tables, today });
  const body = viewOf(tables, today);

  it("is derived from the slice's transactions as the composer derived it", () => {
    const legacy = attributesView({ ...cut, feed: linked.feed }).cards;
    const { cards, transactions } = slices.selectAttributes(body);
    const bonds = cards.flatMap((c) => (c.kind === 'bond' ? [c] : []));
    expect(bonds.length).toBeGreaterThan(0);
    for (const card of bonds) {
      const was = legacy.find((c) => c.asset.id === card.asset.id);
      const ytm = was?.kind === 'bond' ? was.ytm : undefined;
      expect(ytm).toBeDefined();
      expect(derivedYtmPct(card.asset, transactions, linked.feed)).toBe(ytm);
    }
  });
});
