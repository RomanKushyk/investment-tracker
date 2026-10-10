// The staged import's parts: what a caller sends once each row has passed the doors the routes
// apply (*Cloud target*, #403). The digests are read a second time here with node:crypto,
// independent of the module's.
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { MAX_BODY_BYTES } from '../ops';
import type { Asset, Transaction } from '../types';
import type { PriceRow } from '../valuation';
import { importParts, MAX_PART_ROWS } from './parts';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A distinct day for each i, from 2019-01-01. */
const day = (i: number) => new Date(Date.UTC(2019, 0, 1 + i)).toISOString().slice(0, 10);

const asset = (n: number, over: Partial<Asset> = {}): Asset => ({
  id: u(n),
  name: 'REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'dividends',
  expectedPct: 10,
  targetPct: 25,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-03-02',
  createdAt: '2026-03-02T09:00:00',
  ...over,
});
const deposit = (n: number): Transaction => ({
  id: u(n),
  date: '2026-03-01',
  type: 'deposit',
  assetId: '',
  amount: 100_000,
});
const buy = (n: number, of: number): Transaction => ({
  id: u(n),
  date: '2026-03-02',
  type: 'buy',
  assetId: u(of),
  amount: 1000,
  quantity: 10,
});
const price = (of: number, i: number, observedAt?: string): PriceRow => ({
  assetId: u(of),
  asOf: day(i),
  price: 10 + i / 100,
  ...(observedAt === undefined ? {} : { observedAt }),
});

type Tables = { assets: Asset[]; transactions: Transaction[]; prices: PriceRow[] };
type Part = { assets?: Asset[]; transactions?: Transaction[]; prices?: PriceRow[] };

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');
const bytesOf = (text: string) => Buffer.from(text, 'utf8');

/** 3 assets and rows past the bound of one part. */
const BIG = (): Tables => ({
  assets: [1, 2, 3].map((n) => asset(n, { createdAt: `2026-03-0${n}T09:00:00` })),
  transactions: [deposit(10), ...Array.from({ length: 119 }, (_, i) => buy(11 + i, 1 + (i % 3)))],
  prices: Array.from({ length: 2_500 }, (_, i) => price(1 + (i % 3), i, '2026-04-20T10:00:00')),
});

const planned = async (tables: Tables) => {
  const plan = await importParts(tables);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan;
};
const partsOf = (plan: Awaited<ReturnType<typeof planned>>) =>
  plan.parts.map((p) => JSON.parse(p.body) as Part);

describe('the parts of an import', () => {
  it('bound a part at 500 rows, AWS’s loading guidance', () => {
    expect(MAX_PART_ROWS).toBe(500);
  });

  it('are numbered from 1 with no gap, each of at most 500 rows', async () => {
    const plan = await planned(BIG());
    expect(plan.parts.map((p) => p.number)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const part of partsOf(plan)) {
      const rows = (part.assets?.length ?? 0) + (part.transactions?.length ?? 0);
      expect(rows + (part.prices?.length ?? 0)).toBeLessThanOrEqual(500);
    }
  });

  it('hold every row once, in the order of the file, assets first', async () => {
    const tables = BIG();
    const parts = partsOf(await planned(tables));
    expect({
      assets: parts.flatMap((p) => p.assets ?? []),
      transactions: parts.flatMap((p) => p.transactions ?? []),
      prices: parts.flatMap((p) => p.prices ?? []),
    }).toEqual(tables);
    // A table never starts before the one it names is done.
    const seen = parts.flatMap((p) => [
      ...(p.assets ?? []).map(() => 0),
      ...(p.transactions ?? []).map(() => 1),
      ...(p.prices ?? []).map(() => 2),
    ]);
    expect(seen).toEqual([...seen].sort());
  });

  it('carry an asset before, or with, every row that names it', async () => {
    // 700 assets, so the assets alone fill more than one part.
    const tables: Tables = {
      assets: Array.from({ length: 700 }, (_, i) => asset(1 + i, { name: `A${i}` })),
      transactions: [deposit(2000), ...[1, 350, 700].map((of, i) => buy(2001 + i, of))],
      prices: [1, 350, 700].map((of, i) => price(of, i)),
    };
    const known = new Set<string>();
    for (const part of partsOf(await planned(tables))) {
      for (const a of part.assets ?? []) known.add(a.id);
      for (const t of part.transactions ?? []) {
        if (t.assetId !== '') expect(known.has(t.assetId)).toBe(true);
      }
      for (const p of part.prices ?? []) expect(known.has(p.assetId)).toBe(true);
    }
    expect(known.size).toBe(700);
  });

  it('are split by their bytes, not their characters, to fit 1 MiB', async () => {
    // Cyrillic is two bytes a character: 40 names of 20 000 letters are 800 000 characters and
    // 1.6 MB, in one chunk of 40 rows.
    const name = 'Ї'.repeat(20_000);
    const tables: Tables = {
      assets: Array.from({ length: 40 }, (_, i) => asset(1 + i, { name })),
      transactions: [],
      prices: [],
    };
    const plan = await planned(tables);
    expect(plan.parts.length).toBeGreaterThan(1);
    for (const part of plan.parts) {
      expect(bytesOf(part.body).length).toBeLessThanOrEqual(MAX_BODY_BYTES);
    }
    expect(partsOf(plan).flatMap((p) => p.assets ?? [])).toEqual(tables.assets);
    expect(plan.parts.map((p) => p.number)).toEqual(plan.parts.map((_, i) => i + 1));
  });

  it('send a row of exactly the bound alone, which the route takes', async () => {
    const bare = bytesOf(JSON.stringify({ assets: [asset(1, { name: '' })] })).length;
    const lone = asset(1, { name: 'x'.repeat(MAX_BODY_BYTES - bare) });
    const plan = await planned({ assets: [lone, asset(2)], transactions: [], prices: [] });
    expect(bytesOf(plan.parts[0].body).length).toBe(MAX_BODY_BYTES);
    expect(partsOf(plan).map((p) => p.assets?.length)).toEqual([1, 1]);
  });

  it('carry the SHA-256 of their bytes as Content-Digest wants it, base64', async () => {
    const plan = await planned({
      ...BIG(),
      assets: [asset(1, { name: 'Інжур REIT' }), asset(2), asset(3)],
    });
    for (const part of plan.parts) expect(part.digest).toBe(sha(bytesOf(part.body)));
  });

  it('give the manifest each table’s count and the SHA-256 of the parts’ raw digests in order', async () => {
    const tables = BIG();
    const plan = await planned(tables);
    const raw = plan.parts.map((p) => Buffer.from(sha(bytesOf(p.body)), 'base64'));
    expect(plan.manifest).toEqual({
      assets: 3,
      transactions: 120,
      prices: 2_500,
      digest: sha(Buffer.concat(raw)),
    });
  });

  it('are none for a file with no row, under the digest of nothing', async () => {
    const plan = await planned({ assets: [], transactions: [], prices: [] });
    expect(plan.parts).toEqual([]);
    expect(plan.manifest).toEqual({
      assets: 0,
      transactions: 0,
      prices: 0,
      digest: sha(Buffer.alloc(0)),
    });
  });

  it('leave out a table a part holds no row of', async () => {
    const plan = await planned({
      assets: [asset(1)],
      transactions: [],
      prices: [price(1, 0)],
    });
    expect(plan.parts.map((p) => Object.keys(JSON.parse(p.body) as object))).toEqual([
      ['assets', 'prices'],
    ]);
  });

  it('send an asset without the legacy unit count, which the store has no column for', async () => {
    const linked = asset(1, { inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 12 } });
    const [part] = partsOf(await planned({ assets: [linked], transactions: [], prices: [] }));
    expect(part.assets).toEqual([{ ...linked, inzhur: { kind: 'fund', ref: 'inzhur-reit' } }]);
  });

  it('accept an upper-case uuid, which the route folds', async () => {
    const shouted = asset(1, { id: u(1).replace('0000', 'ABCD') });
    expect((await importParts({ assets: [shouted], transactions: [], prices: [] })).ok).toBe(true);
  });
});

describe('a file the routes would refuse', () => {
  const refused = async (tables: Tables) => {
    const plan = await importParts(tables);
    if (plan.ok) throw new Error('importParts took the file');
    return plan.issues;
  };
  const none = { assets: [], transactions: [], prices: [] };

  it('is refused for an id that is no uuid, with no part built', async () => {
    expect(
      await refused({
        assets: [asset(1), asset(2, { id: 'reit' })],
        transactions: [
          { ...deposit(10), id: 'd1' },
          buy(11, 1),
          { ...buy(12, 1), assetId: 'reit' },
        ],
        prices: [{ ...price(1, 0), assetId: 'energy' }],
      }),
    ).toEqual([
      { table: 'assets', at: '1', field: 'id', code: 'invalid', value: 'reit' },
      { table: 'transactions', at: '0', field: 'id', code: 'invalid', value: 'd1' },
      { table: 'transactions', at: u(12), field: 'assetId', code: 'invalid', value: 'reit' },
      { table: 'prices', at: '0', field: 'assetId', code: 'invalid', value: 'energy' },
    ]);
  });

  it('is refused for a row the store would not keep, in the import’s codes', async () => {
    const noCount: Record<string, unknown> = { ...buy(11, 1) };
    delete noCount.quantity;
    expect(
      await refused({
        assets: [asset(1, { code: 'R' }), asset(2, { targetPct: 101 })],
        transactions: [noCount as unknown as Transaction],
        prices: [],
      }),
    ).toEqual([
      { table: 'assets', at: '0', field: 'code', code: 'invalid' },
      { table: 'assets', at: '1', field: 'targetPct', code: 'invalid' },
      {
        table: 'transactions',
        at: u(11),
        field: 'quantity',
        code: 'units-missing-on-position-row',
      },
    ]);
  });

  it('is refused for a row alone past the bound of a body, which the route would refuse 413', async () => {
    const bare = bytesOf(JSON.stringify({ assets: [asset(2, { name: '' })] })).length;
    expect(
      await refused({
        assets: [asset(1), asset(2, { name: 'x'.repeat(MAX_BODY_BYTES - bare + 1) })],
        transactions: [],
        prices: [],
      }),
    ).toEqual([{ table: 'assets', at: '1', code: 'invalid' }]);
  });

  // The route's own answers to these two rows are pinned in `infra/src/imports.test.ts`.
  it('is refused for an asset row naming no asset, and a portfolio row naming one', async () => {
    expect(
      await refused({
        assets: [asset(1)],
        transactions: [
          { ...buy(11, 1), assetId: '' },
          { ...deposit(12), assetId: u(1) },
          { ...deposit(13), assetId: 'reit' },
        ],
        prices: [],
      }),
    ).toEqual([
      { table: 'transactions', at: u(11), field: 'assetId', code: 'asset-missing-on-asset-row' },
      { table: 'transactions', at: u(12), field: 'assetId', code: 'invalid', value: u(1) },
      { table: 'transactions', at: u(13), field: 'assetId', code: 'invalid', value: 'reit' },
    ]);
  });

  it('is refused for a price that is not above zero', async () => {
    expect(await refused({ ...none, prices: [{ ...price(1, 0), price: 0 }] })).toEqual([
      { table: 'prices', at: '0', field: 'price', code: 'expected-positive-amount' },
    ]);
  });
});
