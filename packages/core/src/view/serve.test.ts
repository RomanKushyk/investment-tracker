import { describe, expect, it, vi } from 'vitest';

import { addDays } from '../dates';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../seed';
import type { Asset, Transaction } from '../types';
import { rebuildSnapshots, type PriceRow } from '../valuation';
import { buildView } from './build';
import { ARCHIVE_LOOKBACK_DAYS, archiveSpan, viewBody, type ArchiveRow } from './serve';
import { asPriceRows } from './test-ledgers';

// Watched, not replaced: no composer reads a bond's payment dates yet, so only the input shows them.
vi.mock('./build', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./build')>();
  return { ...actual, buildView: vi.fn(actual.buildView) };
});

const TODAY = '2026-07-28';
const FX = { rate: 41.4983, date: TODAY };

const fund = (id: string, ref: string, createdAt = '2026-09-01T10:00:00'): Asset => ({
  id,
  name: `Fund ${id}`,
  code: 'FU',
  colorKey: 'reit',
  yieldType: 'capitalization',
  expectedPct: 10,
  targetPct: 50,
  payoutSchedule: 'none',
  firstPurchase: '2026-09-10',
  createdAt,
  inzhur: { kind: 'fund', ref },
});
const deposit = (id: string, date: string, amount: number): Transaction => ({
  id,
  date,
  type: 'deposit',
  assetId: '',
  amount,
});
const buy = (id: string, assetId: string, date: string, amount: number, quantity: number) =>
  ({ id, date, type: 'buy', assetId, amount, quantity }) as const satisfies Transaction;
const observed = (ref: string, asOf: string, price: number): ArchiveRow => ({ ref, asOf, price });

// Written out rather than borrowed from `serve.ts`: the order the SPA's repository reads in.
const byDateThenId = (a: Transaction, b: Transaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

describe('archiveSpan — the archive rows a ledger needs', () => {
  it('reads nothing for a ledger that links no asset', () => {
    expect(archiveSpan(SEED_ASSETS, SEED_TRANSACTIONS, TODAY)).toBeUndefined();
  });

  it('names each linked ref once, folded, from a week before the first row up to today', () => {
    const assets = [fund('a', 'Inzhur-REIT'), fund('b', 'inzhur-reit'), fund('c', 'UA4000238976')];
    const txs = [deposit('d1', '2026-09-12', 100), deposit('d0', '2026-09-10', 100)];
    expect(archiveSpan(assets, txs, '2026-10-06')).toEqual({
      refs: ['inzhur-reit', 'ua4000238976'],
      from: '2026-09-03',
      to: '2026-10-06',
    });
  });

  // The archive's longest gap between two sell observations of one ref is a day; the lookback only
  // bounds the window, wider than any gap, so a held day still finds the price before it.
  it('looks back a week', () => {
    expect(ARCHIVE_LOOKBACK_DAYS).toBe(7);
  });

  // Rows ahead: nothing is held on or before today, and the archive read refuses a span that
  // ends before it starts.
  it('reads nothing while every row is dated after today', () => {
    expect(
      archiveSpan([fund('a', 'inzhur-reit')], [deposit('d1', '2026-10-07', 100)], '2026-10-06'),
    ).toBeUndefined();
  });

  it('starts from the first row on or before today, whatever is dated after', () => {
    const txs = [deposit('d2', '2026-10-09', 100), deposit('d1', '2026-10-01', 100)];
    expect(archiveSpan([fund('a', 'inzhur-reit')], txs, '2026-10-06')?.from).toBe(
      addDays('2026-10-01', -ARCHIVE_LOOKBACK_DAYS),
    );
  });
});

describe('viewBody — what GET /view answers, from rows', () => {
  const seedPrices = asPriceRows(buildSeedSnapshots(), SEED_TRANSACTIONS)!;

  it('is buildView over the rebuilt series, with the rate beside it', () => {
    const transactions = [...SEED_TRANSACTIONS].sort(byDateThenId);
    const user = [...seedPrices].sort(
      (a, b) =>
        SEED_ASSETS.findIndex((x) => x.id === a.assetId) -
          SEED_ASSETS.findIndex((x) => x.id === b.assetId) || a.asOf.localeCompare(b.asOf),
    );
    const snapshots = rebuildSnapshots(SEED_ASSETS, transactions, { user, archive: [] }, TODAY);
    expect(
      viewBody({
        assets: SEED_ASSETS,
        transactions,
        userPrices: user,
        paymentDates: [],
        archiveRows: [],
        today: TODAY,
        fx: FX,
      }),
    ).toEqual({
      view: buildView({ assets: SEED_ASSETS, transactions, snapshots, today: TODAY }),
      fx: FX,
    });
  });

  it('sends no rate as null, never as an absent key', () => {
    const body = viewBody({
      assets: [],
      transactions: [],
      userPrices: [],
      paymentDates: [],
      archiveRows: [],
      today: TODAY,
      fx: undefined,
    });
    expect(Object.keys(body)).toEqual(['view', 'fx']);
    expect(body.fx).toBeNull();
  });

  // The rows come back from the cluster in no promised order, and the composers break ties by
  // input order and sum floats in key order: one tag must name one body.
  it('answers the same body whatever order the rows arrive in', () => {
    const assets = [...SEED_ASSETS, fund('f', 'inzhur-reit', '2026-07-01T10:00:00')];
    const transactions = [
      ...SEED_TRANSACTIONS,
      deposit('d9', '2026-07-02', 1000),
      buy('b9', 'f', '2026-07-02', 1000, 100),
    ];
    const archiveRows = [
      observed('INZHUR-REIT', '2026-07-02', 10),
      observed('inzhur-reit', '2026-07-10', 10.5),
      observed('inzhur-reit', '2026-07-20', 10.25),
    ];
    const body = (order: <T>(rows: T[]) => T[]) =>
      JSON.stringify(
        viewBody({
          assets: order(assets),
          transactions: order(transactions),
          userPrices: order(seedPrices),
          paymentDates: [],
          archiveRows: order(archiveRows),
          today: TODAY,
          fx: FX,
        }),
      );
    const reversed = <T>(rows: T[]) => [...rows].reverse();
    const interleaved = <T>(rows: T[]) => [
      ...rows.filter((_, i) => i % 2 === 1),
      ...rows.filter((_, i) => i % 2 === 0),
    ];
    expect(body(reversed)).toBe(body((rows) => rows));
    expect(body(interleaved)).toBe(body((rows) => rows));
  });

  // The archive's rows likewise: the seed's own prices, every asset linked, read from the archive.
  it('answers the same body whatever order the archive rows arrive in', () => {
    const assets = SEED_ASSETS.map((a) => ({
      ...a,
      inzhur: { kind: 'fund' as const, ref: `ref-${a.id}` },
    }));
    const archiveRows = seedPrices.map((p) => observed(`ref-${p.assetId}`, p.asOf, p.price));
    const body = (rows: ArchiveRow[]) =>
      JSON.stringify(
        viewBody({
          assets,
          transactions: SEED_TRANSACTIONS,
          userPrices: [],
          paymentDates: [],
          archiveRows: rows,
          today: TODAY,
          fx: FX,
        }),
      );
    expect(body([...archiveRows].reverse())).toBe(body(archiveRows));
  });

  // The archive's key admits a ref under two spellings, and the read asks for both: the digest is
  // of the folded rows, so the body must not depend on which arrives first.
  it('answers one body for one ref stored twice on a day, whichever arrives first', () => {
    const assets = [fund('f', 'inzhur-reit')];
    const transactions = [
      deposit('d1', '2026-09-10', 1000),
      buy('b1', 'f', '2026-09-10', 1000, 100),
    ];
    const rows = [
      observed('inzhur-reit', '2026-09-20', 10.35),
      observed('INZHUR-REIT', '2026-09-20', 11.5),
    ];
    const body = (archiveRows: ArchiveRow[]) =>
      JSON.stringify(
        viewBody({
          assets,
          transactions,
          userPrices: [],
          paymentDates: [],
          archiveRows,
          today: '2026-09-30',
          fx: FX,
        }),
      );
    expect(body([...rows].reverse())).toBe(body(rows));
  });

  it('prices a linked asset from the archive, its ref matched in either case', () => {
    const assets = [fund('f', 'ua4000238976')];
    const transactions = [deposit('d1', '2026-09-10', 1000), buy('b1', 'f', '2026-09-10', 1000, 1)];
    const { view } = viewBody({
      assets,
      transactions,
      userPrices: [],
      paymentDates: [],
      archiveRows: [
        observed('UA4000238976', '2026-09-10', 1000),
        observed('UA4000238976', '2026-09-20', 1100),
      ],
      today: '2026-09-30',
      fx: FX,
    });
    expect(view.capital).toEqual(
      buildView({
        assets,
        transactions,
        snapshots: rebuildSnapshots(
          assets,
          transactions,
          {
            user: [],
            archive: [
              { assetId: 'f', asOf: '2026-09-10', price: 1000 },
              { assetId: 'f', asOf: '2026-09-20', price: 1100 },
            ],
          },
          '2026-09-30',
        ),
        today: '2026-09-30',
      }).capital,
    );
    expect(view.balances.chart.length).toBeGreaterThan(0);
  });

  // The span reaches back past the first row because a held day reads the latest observation at or
  // before it: a buy on a day the archive missed is valued from the day before.
  it('values a buy day from an archive row the day before it, which the span reaches', () => {
    const day = '2026-09-10';
    const assets = [fund('f', 'inzhur-reit')];
    const transactions = [deposit('d1', day, 1000), buy('b1', 'f', day, 1000, 100)];
    const before = observed('inzhur-reit', addDays(day, -1), 10);
    const span = archiveSpan(assets, transactions, '2026-09-30')!;
    expect(span.from <= before.asOf && before.asOf <= span.to).toBe(true);
    const { view } = viewBody({
      assets,
      transactions,
      userPrices: [],
      paymentDates: [],
      archiveRows: [before],
      today: '2026-09-30',
      fx: FX,
    });
    expect(view.balances.earliest).toBe(day);
  });

  // `user_price` rows for an asset sharing the archive's ref still win a same-day tie: the rebuild
  // decides precedence, and the body only resolves refs to assets.
  it('hands every asset sharing a ref the archive row, and leaves precedence to the rebuild', () => {
    const assets = [fund('a', 'inzhur-reit'), fund('b', 'INZHUR-REIT', '2026-09-02T10:00:00')];
    const transactions = [
      deposit('d1', '2026-09-10', 2000),
      buy('b1', 'a', '2026-09-10', 1000, 100),
      buy('b2', 'b', '2026-09-10', 1000, 100),
    ];
    const user: PriceRow[] = [{ assetId: 'a', asOf: '2026-09-20', price: 12 }];
    const archive = [
      observed('inzhur-reit', '2026-09-10', 10),
      observed('inzhur-reit', '2026-09-20', 11),
    ];
    const { view } = viewBody({
      assets,
      transactions,
      userPrices: user,
      paymentDates: [],
      archiveRows: archive,
      today: '2026-09-30',
      fx: FX,
    });
    const resolved = (id: string) =>
      archive.map((r) => ({ assetId: id, asOf: r.asOf, price: r.price }));
    expect(view).toEqual(
      buildView({
        assets,
        transactions,
        snapshots: rebuildSnapshots(
          assets,
          transactions,
          { user, archive: [...resolved('a'), ...resolved('b')] },
          '2026-09-30',
        ),
        today: '2026-09-30',
      }),
    );
  });

  it('hands the build a bond’s dates under each asset linked to it in any case, a fund none', () => {
    const bond = (id: string, ref: string, createdAt?: string): Asset => ({
      ...fund(id, ref, createdAt),
      yieldType: 'fixed_coupon',
      payoutSchedule: 'semiannual',
      inzhur: { kind: 'bond', ref },
    });
    const unlinked = SEED_ASSETS.find((a) => a.id === 'ovdp8976')!;
    expect(unlinked.inzhur).toBeUndefined();
    const dates = ['2026-09-23', '2027-03-24'];
    vi.mocked(buildView).mockClear();
    viewBody({
      assets: [
        bond('a', 'UA4000238976'),
        bond('b', 'ua4000238976', '2026-09-02T10:00:00'),
        fund('f', 'inzhur-reit'),
        unlinked,
      ],
      transactions: [],
      userPrices: [],
      paymentDates: [
        { ref: 'UA4000238976', dates },
        { ref: 'inzhur-reit', dates: ['2026-10-01'] },
        { ref: 'UA4000999999', dates: ['2026-10-01'] },
      ],
      archiveRows: [],
      today: TODAY,
      fx: FX,
    });
    expect(vi.mocked(buildView).mock.calls[0][0].paymentDates).toEqual(
      new Map([
        ['a', dates],
        ['b', dates],
      ]),
    );
  });
});
