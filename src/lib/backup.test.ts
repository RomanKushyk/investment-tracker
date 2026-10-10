import { createHash, randomUUID } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { serializeSnapshotsCsv } from '@quirenote/core/backup/csv';
import { validateImport } from '@quirenote/core/backup/import';
import {
  assetRecordSchema,
  buildBackup,
  priceRowSchema,
  transactionRecordSchema,
} from '@quirenote/core/backup/json';
import { importParts, MAX_PART_ROWS } from '@quirenote/core/backup/parts';
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import type { Asset, Transaction } from '@quirenote/core/types';
import type { PriceRow } from '@quirenote/core/valuation';

import type { RelayAnswer, RelayCall } from '../auth/relay';
import { createSession, type Locks } from '../auth/session';
import { abortImport, commitImport, csvTablesOf, exportState, replaceDataset } from './backup';
import { createTransport, type Transport } from './transport';

// The driver is proved against a fake of the import routes and `GET /state` served by MSW. The
// fake reads every request a second time, with node:crypto and core's row doors, so a driver that
// digests the wrong bytes or sends a part out of order is refused as the API refuses it.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API = 'https://api.dev.quirenote.com';
const TOKENS: RelayAnswer = {
  kind: 'tokens',
  tokens: { idToken: 'h.e30.s', expiresIn: 3600 },
};
const noLocks = { request: (_: string, callback: () => unknown) => callback() } as unknown as Locks;

async function transport(): Promise<Transport> {
  const session = createSession({ relay: vi.fn<RelayCall>(async () => TOKENS), locks: noLocks });
  await session.restore();
  return createTransport({
    hostname: 'dev.quirenote.com',
    fetch: (input, init) => fetch(input, init),
    session,
    showAnswer: vi.fn(),
    derivationId: 'derivation-of-this-build',
  });
}

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
  createdAt: `2026-03-0${n}T09:00:00`,
  ...over,
});
const deposit = (n: number): Transaction => ({
  id: u(n),
  date: '2026-03-01',
  type: 'deposit',
  assetId: '',
  amount: 100_000,
});
const buy = (n: number, of: number, date = '2026-03-02'): Transaction => ({
  id: u(n),
  date,
  type: 'buy',
  assetId: u(of),
  amount: 1000,
  quantity: 10,
});
const price = (of: number, i: number): PriceRow => ({
  assetId: u(of),
  asOf: day(i),
  price: 10 + i / 100,
  observedAt: '2026-04-20T10:00:00',
});

interface Rows {
  assets: Asset[];
  transactions: Transaction[];
  prices: PriceRow[];
}

/** What the live dataset holds before an import. */
const OLD: Rows = {
  assets: [asset(9, { name: 'Old', createdAt: '2026-01-02T09:00:00' })],
  transactions: [{ ...deposit(90), date: '2026-01-01' }],
  prices: [{ assetId: u(9), asOf: '2026-01-20', price: 5 }],
};

/** 3 assets, 120 transactions and 3 000 prices: more rows than the 3 000 one DSQL transaction may mutate. */
const FILE = (): Rows => ({
  assets: [1, 2, 3].map((n) => asset(n)),
  transactions: [deposit(10), ...Array.from({ length: 119 }, (_, i) => buy(11 + i, 1 + (i % 3)))],
  prices: Array.from({ length: 3_000 }, (_, i) => price(1 + (i % 3), i)),
});

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

interface Seen {
  line: string;
  digest?: string | null;
  ifMatch?: string | null;
}

interface Fake {
  /** The live dataset. */
  rows: Rows;
  version: number;
  /** The import that is open, by its id, and the parts it holds by number. */
  open?: { id: string; manifest: Record<string, unknown>; parts: Map<number, Buffer> };
  /** The import whose commit landed, which a commit sent again answers with the current tag. */
  landed?: string;
  seen: Seen[];
  /** The tag a write is sent under. */
  tag: () => string;
}

interface Behaviour {
  /** Runs as the nth part has been staged. */
  afterPart?: (n: number, fake: Fake) => void;
  /** Runs as a commit arrives, before its precondition is read. */
  beforeCommit?: (fake: Fake) => void;
  /** The nth part is refused as the door refuses a row. */
  refusePart?: number;
  /** The nth part is staged and its answer lost, once. */
  loseAnswerOf?: number;
  /** The nth part is answered 429 before it is read, once. */
  throttleOnce?: number;
  /** The commit is refused for a reason that is not the tag. */
  refuseCommit?: boolean;
  /** The first commit is answered 500, before the pointer moves or after it has. */
  commitFailsOnce?: 'before' | 'after';
}

/** The import routes and `GET /state`, as `infra/src/imports.ts` and `infra/src/mutations.ts` answer them. */
function fakeApi(initial: Rows = OLD, behaviour: Behaviour = {}): Fake {
  const fake: Fake = {
    rows: structuredClone(initial),
    version: 0,
    seen: [],
    tag: () => `"${fake.version}"`,
  };
  const once = new Set<string>();
  const no = () => HttpResponse.json({ error: 'no_such_import' }, { status: 404 });

  server.use(
    http.get(`${API}/state`, () => {
      fake.seen.push({ line: 'GET /state' });
      return HttpResponse.json(fake.rows, { headers: { etag: fake.tag() } });
    }),
    http.post(`${API}/imports`, async ({ request }) => {
      fake.seen.push({ line: 'POST /imports' });
      const id = randomUUID();
      fake.open = {
        id,
        manifest: (await request.json()) as Record<string, unknown>,
        parts: new Map(),
      };
      return HttpResponse.json({ id }, { status: 201, headers: { location: `/imports/${id}` } });
    }),
    http.put(`${API}/imports/:id/parts/:n`, async ({ request, params }) => {
      const n = Number(params.n);
      const bytes = Buffer.from(await request.arrayBuffer());
      fake.seen.push({
        line: `PUT part ${n}`,
        digest: request.headers.get('content-digest'),
      });
      if (behaviour.throttleOnce === n && !once.has(`429:${n}`)) {
        once.add(`429:${n}`);
        return HttpResponse.json({ error: 'throttled' }, { status: 429 });
      }
      const open = fake.open;
      if (open === undefined || open.id !== params.id) return no();
      const digest = sha(bytes);
      if (request.headers.get('content-digest') !== `sha-256=:${digest}:`) {
        return HttpResponse.json({ error: 'digest_mismatch' }, { status: 400 });
      }
      if (bytes.length > MAX_BODY_BYTES) return HttpResponse.json({}, { status: 413 });
      const staged = open.parts.get(n);
      if (staged !== undefined) {
        return sha(staged) === digest
          ? HttpResponse.json({ part: n, digest })
          : HttpResponse.json({ error: 'part_conflict' }, { status: 409 });
      }
      const body = JSON.parse(bytes.toString('utf8')) as Partial<Rows>;
      const rows =
        (body.assets?.length ?? 0) + (body.transactions?.length ?? 0) + (body.prices?.length ?? 0);
      if (rows > MAX_PART_ROWS) {
        return HttpResponse.json({ error: 'too_many_part_rows' }, { status: 400 });
      }
      if (behaviour.refusePart === n) {
        return HttpResponse.json(
          { error: 'invalid_part', table: 'assets', index: 0, issues: [] },
          { status: 422 },
        );
      }
      const known = new Set(
        [...open.parts.values()]
          .flatMap((p) => (JSON.parse(p.toString('utf8')) as Partial<Rows>).assets ?? [])
          .map((a) => a.id),
      );
      for (const a of body.assets ?? []) {
        assetRecordSchema.parse(a);
        known.add(a.id);
      }
      for (const t of body.transactions ?? []) {
        transactionRecordSchema.parse(t);
        if (t.assetId !== '' && !known.has(t.assetId)) {
          return HttpResponse.json(
            { error: 'invalid_part', issues: [{ code: 'unknown-asset-id' }] },
            { status: 422 },
          );
        }
      }
      for (const p of body.prices ?? []) {
        priceRowSchema.parse(p);
        if (!known.has(p.assetId)) {
          return HttpResponse.json(
            { error: 'invalid_part', issues: [{ code: 'unknown-asset-id' }] },
            { status: 422 },
          );
        }
      }
      open.parts.set(n, bytes);
      behaviour.afterPart?.(n, fake);
      if (behaviour.loseAnswerOf === n && !once.has(`lost:${n}`)) {
        once.add(`lost:${n}`);
        return HttpResponse.error();
      }
      return HttpResponse.json({ part: n, digest });
    }),
    http.post(`${API}/imports/:id/commit`, ({ request, params }) => {
      fake.seen.push({ line: 'POST commit', ifMatch: request.headers.get('if-match') });
      if (fake.landed === params.id) {
        return HttpResponse.json({ etag: fake.tag() }, { headers: { etag: fake.tag() } });
      }
      const open = fake.open;
      if (open === undefined || open.id !== params.id) return no();
      behaviour.beforeCommit?.(fake);
      if (request.headers.get('if-match') !== fake.tag()) {
        return HttpResponse.json({ error: 'precondition_failed' }, { status: 412 });
      }
      const numbers = [...open.parts.keys()].sort((a, b) => a - b);
      const mismatch = (field: string) =>
        HttpResponse.json({ error: 'manifest_mismatch', field }, { status: 409 });
      if (behaviour.refuseCommit || numbers.some((n, i) => n !== i + 1)) return mismatch('part');
      const parts = numbers.map((n) => open.parts.get(n) as Buffer);
      const composite = sha(Buffer.concat(parts.map((p) => Buffer.from(sha(p), 'base64'))));
      if (composite !== open.manifest.digest) return mismatch('digest');
      const staged = parts.map((p) => JSON.parse(p.toString('utf8')) as Partial<Rows>);
      const next: Rows = {
        assets: staged.flatMap((p) => p.assets ?? []),
        transactions: staged.flatMap((p) => p.transactions ?? []),
        prices: staged.flatMap((p) => p.prices ?? []),
      };
      for (const table of ['assets', 'transactions', 'prices'] as const) {
        if (next[table].length !== open.manifest[table]) return mismatch(table);
      }
      if (behaviour.commitFailsOnce === 'before' && !once.has('commit')) {
        once.add('commit');
        return HttpResponse.json({ error: 'internal' }, { status: 500 });
      }
      fake.rows = next;
      fake.version += 1;
      fake.landed = open.id;
      fake.open = undefined;
      if (behaviour.commitFailsOnce === 'after' && !once.has('commit')) {
        once.add('commit');
        return HttpResponse.json({ error: 'internal' }, { status: 500 });
      }
      return HttpResponse.json({ etag: fake.tag() }, { headers: { etag: fake.tag() } });
    }),
    http.delete(`${API}/imports/:id`, ({ params }) => {
      fake.seen.push({ line: 'DELETE import' });
      if (fake.open?.id !== params.id) return no();
      fake.open = undefined;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return fake;
}

const planOf = async (rows: Rows) => {
  const plan = await importParts(rows);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan;
};
const lines = (fake: Fake) => fake.seen.map((s) => s.line);
const stateOf = async (call: Transport) => {
  const reply = await exportState(call);
  if (reply.kind !== 'exported') throw new Error(`GET /state answered ${reply.kind}`);
  return reply;
};
const rowsOf = ({ assets, transactions, prices }: Rows): Rows => ({ assets, transactions, prices });

describe('replacing the dataset in staged parts', () => {
  it('replaces a dataset larger than one transaction whole, and no reader sees a mix', async () => {
    const readers: Rows[] = [];
    const fake = fakeApi(OLD, { afterPart: (_, f) => readers.push(structuredClone(f.rows)) });
    const call = await transport();
    const file = FILE();
    const plan = await planOf(file);
    expect(plan.manifest.assets + plan.manifest.transactions + plan.manifest.prices).toBe(3_123);
    const { etag } = await stateOf(call);

    const reply = await replaceDataset(call, etag, plan);

    expect(reply).toEqual({ kind: 'imported', etag: '"1"' });
    expect(rowsOf(await stateOf(call))).toEqual(file);
    // Between the first part and the commit the live dataset was the old one, every time.
    expect(readers).toHaveLength(plan.parts.length);
    expect(readers.every((r) => JSON.stringify(r) === JSON.stringify(OLD))).toBe(true);
    expect(fake.open).toBeUndefined();
  });

  it('begins, puts the parts in order, each under the digest of its bytes, and commits under the tag', async () => {
    const fake = fakeApi();
    const call = await transport();
    const plan = await planOf(FILE());

    await replaceDataset(call, '"0"', plan);

    expect(lines(fake)).toEqual([
      'POST /imports',
      ...plan.parts.map((p) => `PUT part ${p.number}`),
      'POST commit',
    ]);
    expect(fake.seen.slice(1, -1).map((s) => s.digest)).toEqual(
      plan.parts.map((p) => `sha-256=:${sha(Buffer.from(p.body, 'utf8'))}:`),
    );
    expect(fake.seen.at(-1)?.ifMatch).toBe('"0"');
  });

  it('sends no part when the file has none, and the dataset becomes empty', async () => {
    const fake = fakeApi();
    const call = await transport();

    const reply = await replaceDataset(
      call,
      '"0"',
      await planOf({ assets: [], transactions: [], prices: [] }),
    );

    expect(reply).toMatchObject({ kind: 'imported' });
    expect(lines(fake)).toEqual(['POST /imports', 'POST commit']);
    expect(fake.rows).toEqual({ assets: [], transactions: [], prices: [] });
  });

  it('sends a part again, unchanged, when its answer was lost', async () => {
    const fake = fakeApi(OLD, { loseAnswerOf: 2 });
    const call = await transport();
    const file = FILE();

    const reply = await replaceDataset(call, '"0"', await planOf(file));

    expect(reply).toMatchObject({ kind: 'imported' });
    expect(lines(fake).filter((l) => l === 'PUT part 2')).toHaveLength(2);
    expect(fake.rows).toEqual(file);
  });

  it('waits out a 429 and goes on', async () => {
    const fake = fakeApi(OLD, { throttleOnce: 3 });
    const call = await transport();
    const file = FILE();

    expect(await replaceDataset(call, '"0"', await planOf(file))).toMatchObject({
      kind: 'imported',
    });
    expect(fake.rows).toEqual(file);
  });
});

describe('a commit under a stale tag', () => {
  // Another tab wrote between the tag being read and the commit.
  const interfering: Behaviour = {
    beforeCommit: (f) => {
      if (f.version === 0) f.version = 1;
    },
  };

  it('leaves the import open and says which, and a commit under the new tag then lands', async () => {
    const fake = fakeApi(OLD, interfering);
    const call = await transport();
    const file = FILE();

    const reply = await replaceDataset(call, '"0"', await planOf(file));

    expect(reply).toEqual({ kind: 'conflict', id: fake.open?.id });
    expect(fake.open).toBeDefined();
    expect(lines(fake)).not.toContain('DELETE import');
    expect(fake.rows).toEqual(OLD);

    const id = fake.open?.id as string;
    expect(await commitImport(call, id, '"1"')).toEqual({ kind: 'imported', etag: '"2"' });
    expect(fake.rows).toEqual(file);
  });

  it('is closed by an abort, and the dataset is as it was', async () => {
    const fake = fakeApi(OLD, interfering);
    const call = await transport();
    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));
    if (reply.kind !== 'conflict') throw new Error(`the commit answered ${reply.kind}`);

    expect(await abortImport(call, reply.id)).toEqual({ kind: 'aborted' });

    expect(fake.open).toBeUndefined();
    expect(fake.rows).toEqual(OLD);
    expect(await abortImport(call, reply.id)).toMatchObject({ kind: 'failed', status: 404 });
  });
});

describe('a refusal the driver cannot recover from', () => {
  it('aborts the import at a refused part, sends no later part and returns the refusal', async () => {
    const fake = fakeApi(OLD, { refusePart: 2 });
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toMatchObject({ kind: 'failed', status: 422, body: { error: 'invalid_part' } });
    expect(lines(fake)).toEqual(['POST /imports', 'PUT part 1', 'PUT part 2', 'DELETE import']);
    expect(fake.open).toBeUndefined();
    expect(fake.rows).toEqual(OLD);
  });

  it('aborts the import when the commit is refused for anything but the tag', async () => {
    const fake = fakeApi(OLD, { refuseCommit: true });
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toMatchObject({ kind: 'failed', status: 409 });
    expect(lines(fake).filter((l) => l === 'POST commit')).toHaveLength(1);
    expect(lines(fake).at(-1)).toBe('DELETE import');
    expect(fake.open).toBeUndefined();
    expect(fake.rows).toEqual(OLD);
  });

  it('takes a 412 from a part for the failure it is, and closes the import', async () => {
    const fake = fakeApi();
    server.use(
      http.put(`${API}/imports/:id/parts/:n`, () =>
        HttpResponse.json({ error: 'precondition_failed' }, { status: 412 }),
      ),
    );
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toEqual({ kind: 'failed', status: 412 });
    expect(lines(fake).at(-1)).toBe('DELETE import');
    expect(fake.open).toBeUndefined();
  });

  it('aborts the import when the commit is answered with a body that is no tag', async () => {
    const fake = fakeApi();
    server.use(http.post(`${API}/imports/:id/commit`, () => HttpResponse.json({})));
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toMatchObject({ kind: 'failed', status: 200 });
    expect(fake.open).toBeUndefined();
  });

  it('has nothing to abort when the import never began', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API}/imports`, () => {
        seen.push('begin');
        return HttpResponse.json({ error: 'pending' }, { status: 403 });
      }),
      http.delete(`${API}/imports/:id`, () => {
        seen.push('abort');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toEqual({ kind: 'answer', answer: 'pending' });
    expect(seen).toEqual(['begin']);
  });

  it('does not take an answer that is not the shape of a begun import for one', async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API}/imports`, () => HttpResponse.json({ nope: 1 }, { status: 201 })),
      http.delete(`${API}/imports/:id`, () => {
        seen.push('abort');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const call = await transport();

    expect(await replaceDataset(call, '"0"', await planOf(FILE()))).toMatchObject({
      kind: 'failed',
      status: 201,
    });
    expect(seen).toEqual([]);
  });
});

describe('a commit answered 500', () => {
  // The answer does not say whether the pointer moved, and the route answers a commit sent again
  // either way: 200 with the tag if it landed, the commit itself if it did not.
  it.each(['before', 'after'] as const)(
    'is sent again once, and the import lands, whether the pointer moved %s the 500',
    async (when) => {
      const fake = fakeApi(OLD, { commitFailsOnce: when });
      const call = await transport();
      const file = FILE();

      const reply = await replaceDataset(call, '"0"', await planOf(file));

      expect(reply).toEqual({ kind: 'imported', etag: '"1"' });
      expect(lines(fake).filter((l) => l === 'POST commit')).toHaveLength(2);
      expect(lines(fake)).not.toContain('DELETE import');
      expect(fake.rows).toEqual(file);
    },
  );

  it('aborts the import when the commit sent again is answered 500 too', async () => {
    const fake = fakeApi();
    server.use(
      http.post(`${API}/imports/:id/commit`, () => {
        fake.seen.push({ line: 'POST commit' });
        return HttpResponse.json({ error: 'internal' }, { status: 500 });
      }),
    );
    const call = await transport();

    const reply = await replaceDataset(call, '"0"', await planOf(FILE()));

    expect(reply).toMatchObject({ kind: 'failed', status: 500 });
    expect(lines(fake).filter((l) => l === 'POST commit')).toHaveLength(2);
    expect(lines(fake).at(-1)).toBe('DELETE import');
    expect(fake.open).toBeUndefined();
    expect(fake.rows).toEqual(OLD);
  });
});

describe('the export over GET /state', () => {
  it('reads the live dataset and the tag a write goes under', async () => {
    fakeApi(OLD);
    const call = await transport();

    expect(await exportState(call)).toEqual({ kind: 'exported', etag: '"0"', ...OLD });
  });

  it('passes on the answer that is not the dataset', async () => {
    server.use(
      http.get(`${API}/state`, () => HttpResponse.json({ error: 'pending' }, { status: 403 })),
    );
    const call = await transport();

    expect(await exportState(call)).toEqual({ kind: 'answer', answer: 'pending' });
  });

  it('is not taken for the dataset when a row is not one', async () => {
    server.use(
      http.get(`${API}/state`, () =>
        HttpResponse.json(
          { assets: [{ id: 'x' }], transactions: [], prices: [] },
          { headers: { etag: '"0"' } },
        ),
      ),
    );
    const call = await transport();

    expect(await exportState(call)).toMatchObject({ kind: 'failed', status: 200 });
  });

  it('is not taken for the dataset when it comes without its tag', async () => {
    server.use(http.get(`${API}/state`, () => HttpResponse.json(OLD)));
    const call = await transport();

    expect(await exportState(call)).toMatchObject({ kind: 'failed', status: 200 });
  });

  it('imports back to the same /state', async () => {
    const file = FILE();
    const fake = fakeApi(file);
    const call = await transport();
    const first = await stateOf(call);

    // The file a person would keep: built, written out and read back as the dialog reads it.
    const text = JSON.stringify(
      buildBackup(
        first.assets,
        first.prices,
        first.transactions,
        undefined,
        '2026-10-10T12:00:00',
        2,
      ),
    );
    const read = validateImport(text);
    if (!read.ok) throw new Error(JSON.stringify(read.rejection));
    const plan = await planOf(read.envelope);
    const reply = await replaceDataset(call, first.etag, plan);

    expect(reply).toMatchObject({ kind: 'imported' });
    expect(fake.version).toBe(1);
    const second = await stateOf(call);
    expect(rowsOf(second)).toEqual(rowsOf(first));
    expect(second.etag).not.toBe(first.etag);
  });
});

describe('the CSV export', () => {
  it('cuts its snapshots from the stored prices, a day for each day priced and none carried', async () => {
    const rows: Rows = {
      assets: [asset(1), asset(2)],
      transactions: [deposit(10), buy(11, 1, '2026-03-02'), buy(12, 2, '2026-03-02')],
      prices: [
        { assetId: u(1), asOf: '2026-03-02', price: 100 },
        { assetId: u(2), asOf: '2026-03-02', price: 200 },
        { assetId: u(1), asOf: '2026-03-10', price: 110 },
      ],
    };
    fakeApi(rows);
    const call = await transport();

    const tables = csvTablesOf(await stateOf(call));

    expect(tables.snapshots.map((s) => [s.date, s.quotes])).toEqual([
      ['2026-03-02', { [u(1)]: 1000, [u(2)]: 2000 }],
      // The second asset has no price on the 10th, and no quote is carried onto it.
      ['2026-03-10', { [u(1)]: 1100 }],
    ]);
    const csv = serializeSnapshotsCsv(tables.snapshots, tables.assets).split('\r\n');
    expect(csv.slice(1, 3)).toEqual(['2026-03-02,1000.00,2000.00', '2026-03-10,1100.00,']);
    expect(tables.assets).toEqual(rows.assets);
    expect(tables.transactions).toEqual(rows.transactions);
  });
});
