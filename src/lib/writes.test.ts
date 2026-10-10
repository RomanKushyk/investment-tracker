import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { assetPatchFromForm, buildNewAsset } from '@quirenote/core/asset-builder';
import { assetRecordSchema } from '@quirenote/core/backup/json';
import { ledgerUnits } from '@quirenote/core/derive';
import { mergePatch, opIssues, opSchema, type Op } from '@quirenote/core/ops';
import type { AssetFormValues } from '@quirenote/core/schemas';
import type { Asset, Transaction } from '@quirenote/core/types';
import { pricesOfQuotes, type PriceRow } from '@quirenote/core/valuation';
import { dayQuotes, type DayQuotes } from '@quirenote/core/view/serve';

import type { RelayAnswer, RelayCall } from '../auth/relay';
import { createSession, type Locks } from '../auth/session';
import { createTransport, type Transport } from './transport';
import {
  addAssetOps,
  clearOps,
  deleteAsset,
  deleteSnapshotOps,
  deleteTransactionOps,
  moveSnapshotOps,
  recordTransactionOps,
  saveSnapshotOps,
  saveTargetsOps,
  send,
  updateAssetOps,
  updateTransactionOps,
} from './writes';

// The builders are pure. What they send is proved against a fake of the user API served by MSW,
// which applies the ops with core's own schemas and merge patch, so a cleared quote that goes out
// as anything but `null` stays in the day it is read back from.
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
const DAY = '2026-09-01';

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
const buy = (n: number, of: number, quantity = 10): Transaction => ({
  id: u(n),
  date: '2026-03-02',
  type: 'buy',
  assetId: u(of),
  amount: 1000 * quantity,
  quantity,
});

// ---------------------------------------------------------------------------------------------
// The user API, as far as the writes reach it.
// ---------------------------------------------------------------------------------------------

interface Store {
  assets: Asset[];
  transactions: Transaction[];
  prices: PriceRow[];
  version: number;
}

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super();
  }
}
const invalid = (index: number, field: string, code: string) =>
  new Refused(422, { error: 'invalid_op', index, issues: [{ field, code }] });

interface Sent {
  ifMatch: string | null;
  key: string | null;
  text: string;
  ops: Op[];
}

/** `POST /mutations`, `GET /state` and `GET /view/day`. A request lands whole or not at all, and a
 *  row bound past which `asset.delete` answers 409 `too_many_rows` is the caller's to set.
 *  `interfere` runs as request n arrives, standing in for a write of another tab. */
function fakeApi(
  initial: Partial<Omit<Store, 'version'>> = {},
  {
    maxRows = 2500,
    interfere,
  }: { maxRows?: number; interfere?: (n: number, s: Store) => void } = {},
) {
  const store: Store = { assets: [], transactions: [], prices: [], version: 0, ...initial };
  const sent: Sent[] = [];
  const tag = () => `"${store.version}"`;

  function apply(draft: Store, op: Op, index: number, budget: number) {
    switch (op.op) {
      case 'asset.add':
        draft.assets.push(op.asset);
        return { result: {}, rows: 1 };
      case 'asset.patch': {
        const target = draft.assets.find((a) => a.id === op.id);
        if (target === undefined) throw invalid(index, 'id', 'unknown-asset-id');
        const parsed = assetRecordSchema.safeParse(mergePatch(target, op.patch));
        if (!parsed.success) throw invalid(index, parsed.error.issues[0].path.join('.'), 'invalid');
        draft.assets = draft.assets.map((a) => (a.id === op.id ? parsed.data : a));
        return { result: {}, rows: 1 };
      }
      case 'asset.delete': {
        const children =
          draft.prices.filter((p) => p.assetId === op.id).length +
          draft.transactions.filter((t) => t.assetId === op.id).length;
        if (children + 1 > budget) {
          throw new Refused(409, {
            error: 'too_many_rows',
            index,
            count: children + 1,
            max: maxRows,
          });
        }
        draft.prices = draft.prices.filter((p) => p.assetId !== op.id);
        draft.transactions = draft.transactions.filter((t) => t.assetId !== op.id);
        draft.assets = draft.assets.filter((a) => a.id !== op.id);
        return { result: {}, rows: children + 1 };
      }
      case 'asset.prune': {
        const prices = draft.prices.filter((p) => p.assetId === op.id);
        const transactions = draft.transactions.filter((t) => t.assetId === op.id);
        const takenPrices = prices.slice(0, budget);
        const takenTransactions = transactions.slice(0, budget - takenPrices.length);
        draft.prices = draft.prices.filter((p) => !takenPrices.includes(p));
        draft.transactions = draft.transactions.filter((t) => !takenTransactions.includes(t));
        const deleted = takenPrices.length + takenTransactions.length;
        const remaining = prices.length + transactions.length - deleted;
        return { result: { remaining }, rows: deleted };
      }
      case 'transaction.add':
        if (
          op.transaction.assetId !== '' &&
          !draft.assets.some((a) => a.id === op.transaction.assetId)
        ) {
          throw invalid(index, 'assetId', 'unknown-asset-id');
        }
        draft.transactions.push(op.transaction);
        return { result: {}, rows: 1 };
      case 'snapshot.patch': {
        const { quotes } = op.patch;
        const set = Object.fromEntries(
          Object.entries(quotes).flatMap(([id, value]) => (value === null ? [] : [[id, value]])),
        );
        const { prices, dropped } = pricesOfQuotes(
          set,
          ledgerUnits(draft.transactions, op.date).units,
        );
        const rewritten = Object.keys(quotes).filter((id) => !dropped.includes(id));
        draft.prices = draft.prices.filter(
          (p) => !(p.asOf === op.date && rewritten.includes(p.assetId)),
        );
        draft.prices.push(...prices.map((p) => ({ ...p, asOf: op.date })));
        return { result: { dropped }, rows: 1 };
      }
      default:
        throw new Error(`the fake does not apply ${op.op}`);
    }
  }

  const handlers = [
    http.post(`${API}/mutations`, async ({ request }) => {
      const text = await request.text();
      const raw = (JSON.parse(text) as { ops: unknown[] }).ops;
      interfere?.(sent.length + 1, store);
      sent.push({
        ifMatch: request.headers.get('if-match'),
        key: request.headers.get('idempotency-key'),
        text,
        ops: raw as Op[],
      });
      if (request.headers.get('if-match') !== tag()) {
        return HttpResponse.json({ error: 'precondition_failed' }, { status: 412 });
      }
      const draft = structuredClone(store);
      const results: object[] = [];
      let used = 0;
      try {
        raw.forEach((op, index) => {
          const parsed = opSchema.safeParse(op);
          if (!parsed.success) {
            throw new Refused(422, {
              error: 'invalid_op',
              index,
              issues: opIssues(parsed.error.issues, op),
            });
          }
          const done = apply(draft, parsed.data, index, maxRows - used);
          used += done.rows;
          results.push(done.result);
        });
      } catch (err) {
        if (err instanceof Refused) return HttpResponse.json(err.body, { status: err.status });
        throw err;
      }
      Object.assign(store, draft, { version: store.version + 1 });
      return HttpResponse.json({ etag: tag(), results }, { headers: { etag: tag() } });
    }),
    http.get(`${API}/state`, () =>
      HttpResponse.json(
        { assets: store.assets, transactions: store.transactions, prices: store.prices },
        { headers: { etag: tag() } },
      ),
    ),
    http.get(`${API}/view/day`, ({ request }) =>
      HttpResponse.json(
        dayQuotes(
          store.transactions,
          store.prices,
          new URL(request.url).searchParams.get('date') ?? '',
        ),
      ),
    ),
  ];
  server.use(...handlers);
  return { store, sent, tag };
}

async function readDay(call: Transport, date: string): Promise<DayQuotes> {
  const reply = await call({ method: 'GET', path: `/view/day?date=${date}` });
  if (reply.kind !== 'ok') throw new Error(`GET /view/day answered ${reply.kind}`);
  return reply.body as DayQuotes;
}

/** The export and the tag a write is sent under. */
async function readState(call: Transport) {
  const reply = await call({ method: 'GET', path: '/state' });
  if (reply.kind !== 'ok' || reply.etag === undefined) {
    throw new Error(`GET /state answered ${reply.kind}`);
  }
  const body = reply.body as { assets: Asset[]; transactions: Transaction[]; prices: PriceRow[] };
  return { ...body, tag: reply.etag };
}

// ---------------------------------------------------------------------------------------------

describe('every repository write builds a list core accepts', () => {
  const existing = asset(1, { inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 12 } });
  const tx = { ...buy(10, 1), note: 'first' };
  const lists: [string, Op[]][] = [
    ['saveSnapshot', saveSnapshotOps(DAY, { [u(1)]: 1000 }, { [u(1)]: 900, [u(2)]: 500 })],
    ['recordTransaction', recordTransactionOps(tx)],
    ['recordTransaction with a new asset', recordTransactionOps(tx, existing)],
    ['addAsset', addAssetOps(existing)],
    ['updateAsset', updateAssetOps(u(1), { name: 'Fund', nextCoupon: undefined })],
    ['updateTransaction', updateTransactionOps(u(10), { note: undefined, amount: 500 })],
    ['deleteTransaction', deleteTransactionOps(u(10))],
    ['deleteSnapshot', deleteSnapshotOps(DAY)],
    ['moveSnapshotDate', moveSnapshotOps(DAY, '2026-09-02')],
    ['clearAll', clearOps()],
    ['a multi-asset target save', saveTargetsOps([{ id: u(1), targetPct: 40 }])],
  ];

  it.each(lists)('%s', (_, ops) => {
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      const parsed = opSchema.safeParse(op);
      if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues));
    }
  });
});

describe('saving a day', () => {
  it('sends a null for each stored quote the drafts no longer hold, and no witness time', () => {
    expect(
      saveSnapshotOps(DAY, { [u(1)]: 1100, [u(3)]: 50 }, { [u(1)]: 1000, [u(2)]: 2000 }),
    ).toEqual([
      {
        op: 'snapshot.patch',
        date: DAY,
        patch: { quotes: { [u(1)]: 1100, [u(3)]: 50, [u(2)]: null } },
      },
    ]);
  });

  it('removes the quote the drafts cleared and leaves the others, read back from the day', async () => {
    const api = fakeApi({
      assets: [asset(1), asset(2), asset(3)],
      transactions: [deposit(20), buy(21, 1), buy(22, 2), buy(23, 3)],
      prices: [
        { assetId: u(1), asOf: DAY, price: 100 },
        { assetId: u(2), asOf: DAY, price: 200 },
        { assetId: u(3), asOf: DAY, price: 300 },
      ],
    });
    const call = await transport();
    const stored = await readDay(call, DAY);
    expect(stored.quotes).toEqual({ [u(1)]: 1000, [u(2)]: 2000, [u(3)]: 3000 });

    const { tag } = await readState(call);
    const reply = await send(
      call,
      tag,
      // The first quote changed, the second was cleared and the third was not touched.
      saveSnapshotOps(DAY, { [u(1)]: 1100, [u(3)]: 3000 }, stored.quotes),
    );

    expect(reply).toMatchObject({ kind: 'written' });
    expect((await readDay(call, DAY)).quotes).toEqual({ [u(1)]: 1100, [u(3)]: 3000 });
    expect(api.sent).toHaveLength(1);
  });

  it('returns the quotes the server dropped, those of a position held none of', async () => {
    fakeApi({
      assets: [asset(1), asset(2)],
      transactions: [deposit(20), buy(21, 1)],
    });
    const call = await transport();
    const { tag } = await readState(call);

    const reply = await send(call, tag, saveSnapshotOps(DAY, { [u(1)]: 1000, [u(2)]: 500 }, {}));

    expect(reply).toMatchObject({ kind: 'written', results: [{ dropped: [u(2)] }] });
    expect((await readDay(call, DAY)).quotes).toEqual({ [u(1)]: 1000 });
  });

  it('returns what a move of the day dropped as the server named it', async () => {
    server.use(
      http.post(`${API}/mutations`, () =>
        HttpResponse.json(
          { etag: '"4"', results: [{ dropped: [u(2)] }] },
          { headers: { etag: '"4"' } },
        ),
      ),
    );
    const call = await transport();

    expect(await send(call, '"3"', moveSnapshotOps(DAY, '2026-09-02'))).toEqual({
      kind: 'written',
      etag: '"4"',
      results: [{ dropped: [u(2)] }],
    });
  });
});

describe('editing an asset', () => {
  const form: AssetFormValues = {
    name: 'OVDP UA4000238976',
    code: 'GB',
    yieldType: 'fixed_coupon',
    expectedPct: 16.5,
    targetPct: 10,
    payoutSchedule: 'semiannual',
    firstPurchase: '2026-08-01',
    maturity: '2027-02-25',
    couponRatePct: 15.68,
    nextCoupon: '2026-08-25',
    inzhur: { kind: 'bond', ref: 'UA4000238976' },
  };
  const stored = asset(1, {
    name: form.name,
    code: form.code,
    colorKey: 'ovdp8976',
    yieldType: form.yieldType,
    expectedPct: form.expectedPct,
    targetPct: form.targetPct,
    payoutSchedule: form.payoutSchedule,
    firstPurchase: form.firstPurchase,
    maturity: form.maturity,
    couponRatePct: form.couponRatePct,
    nextCoupon: form.nextCoupon,
    inzhur: form.inzhur,
  });
  // The copy the form edited still carries the count of the old dataset, which `assetPatchFromForm`
  // carries across; the server's row has no column for it.
  const legacy = { ...stored, inzhur: { kind: 'bond' as const, ref: 'UA4000238976', units: 12 } };

  it('removes an optional field the form emptied, and sends no unit count', async () => {
    const api = fakeApi({ assets: [stored] });
    const call = await transport();
    const { tag } = await readState(call);
    const patch = assetPatchFromForm(
      { ...form, nextCoupon: undefined, couponRatePct: undefined },
      legacy,
    );
    expect(patch.inzhur).toEqual({ kind: 'bond', ref: 'UA4000238976', units: 12 });

    const reply = await send(call, tag, updateAssetOps(u(1), patch));

    expect(reply).toMatchObject({ kind: 'written' });
    expect(api.sent[0].text).not.toContain('units');
    const { assets } = await readState(call);
    const expected: Partial<Asset> = { ...stored };
    delete expected.nextCoupon;
    delete expected.couponRatePct;
    expect(assets).toStrictEqual([expected]);
  });

  it('removes the provider link when the form unlinked it', async () => {
    fakeApi({ assets: [stored] });
    const call = await transport();
    const { tag } = await readState(call);

    await send(
      call,
      tag,
      updateAssetOps(u(1), assetPatchFromForm({ ...form, inzhur: undefined }, legacy)),
    );

    const expected: Partial<Asset> = { ...stored };
    delete expected.inzhur;
    expect((await readState(call)).assets).toStrictEqual([expected]);
  });

  it('is refused, as the control, when a unit count goes out', async () => {
    fakeApi({ assets: [stored] });
    const call = await transport();
    const { tag } = await readState(call);

    const reply = await send(call, tag, [
      {
        op: 'asset.patch',
        id: u(1),
        patch: { inzhur: { kind: 'bond', ref: 'UA4000238976', units: 12 } },
      },
    ]);

    expect(reply).toMatchObject({ kind: 'invalidOp', index: 0 });
  });
});

describe('a transaction with a new asset', () => {
  it('lands in one request, the asset before the transaction that names it', async () => {
    const api = fakeApi({ transactions: [deposit(20)] });
    const call = await transport();
    const { tag } = await readState(call);
    const created = buildNewAsset(
      {
        name: 'Fund',
        yieldType: 'dividends',
        expectedPct: 10,
        targetPct: 25,
        payoutSchedule: 'monthly',
      },
      '2026-03-02',
      0,
    );

    const reply = await send(call, tag, recordTransactionOps(buy(21, 1), { ...created, id: u(1) }));

    expect(reply).toMatchObject({ kind: 'written' });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0].ops.map((op) => op.op)).toEqual(['asset.add', 'transaction.add']);
    const state = await readState(call);
    expect(state.assets.map((a) => a.id)).toEqual([u(1)]);
    expect(state.transactions.map((t) => t.id)).toEqual([u(20), u(21)]);
  });

  it('lands neither when the second op fails', async () => {
    const api = fakeApi({ transactions: [deposit(20)] });
    const call = await transport();
    const { tag } = await readState(call);

    // The transaction names an asset the request does not add.
    const reply = await send(call, tag, recordTransactionOps(buy(21, 9), asset(1)));

    expect(reply).toMatchObject({ kind: 'invalidOp', index: 1 });
    expect(api.sent).toHaveLength(1);
    const state = await readState(call);
    expect(state.assets).toEqual([]);
    expect(state.transactions.map((t) => t.id)).toEqual([u(20)]);
  });

  it('leaves out of the asset the unit count and the time zone a stored row has none of', () => {
    const [add] = recordTransactionOps(buy(21, 1), {
      ...asset(1, { inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 12 } }),
      createdAt: '2026-10-10T20:15:30.123Z',
    });
    expect(add).toMatchObject({
      op: 'asset.add',
      asset: { createdAt: '2026-10-10T20:15:30', inzhur: { kind: 'fund', ref: 'inzhur-reit' } },
    });
    expect(add.op === 'asset.add' && Object.hasOwn(add.asset.inzhur ?? {}, 'units')).toBe(false);
  });
});

describe('deleting an asset', () => {
  // Three transactions and five priced days: nine rows with the asset against a bound of five.
  const heavy = () => ({
    assets: [asset(1), asset(2)],
    transactions: [deposit(20), buy(21, 1), buy(22, 1), buy(23, 1), buy(24, 2), buy(25, 2)],
    prices: [1, 2, 3, 4, 5].map((d) => ({ assetId: u(1), asOf: `2026-04-0${d}`, price: 100 })),
  });

  it('is one request while the asset fits the bound', async () => {
    const api = fakeApi({ ...heavy(), prices: [] }, { maxRows: 5 });
    const call = await transport();
    const { tag } = await readState(call);

    // The asset, three transactions and no price: four rows.
    expect(await deleteAsset(call, tag, u(1))).toMatchObject({ kind: 'written' });
    expect(api.sent.map((s) => s.ops.map((o) => o.op))).toEqual([['asset.delete']]);
  });

  it('prunes past the bound until nothing remains, then deletes, each step under the tag the last gave', async () => {
    const api = fakeApi(heavy(), { maxRows: 5 });
    const call = await transport();
    const { tag } = await readState(call);

    const reply = await deleteAsset(call, tag, u(1));

    expect(reply).toMatchObject({ kind: 'written', etag: '"3"' });
    expect(api.sent.map((s) => s.ops.map((o) => o.op))).toEqual([
      ['asset.delete'],
      ['asset.prune'],
      ['asset.prune'],
      ['asset.delete'],
    ]);
    // The refusal changed nothing, so the first prune goes under the tag the delete did.
    expect(api.sent.map((s) => s.ifMatch)).toEqual(['"0"', '"0"', '"1"', '"2"']);
    const state = await readState(call);
    expect(state.assets.map((a) => a.id)).toEqual([u(2)]);
    expect(state.transactions.map((t) => t.id)).toEqual([u(20), u(24), u(25)]);
    expect(state.prices).toEqual([]);
    for (const { ops } of api.sent)
      for (const op of ops) expect(opSchema.safeParse(op).success).toBe(true);
  });

  it('stops at a step another tab made stale, and returns that conflict', async () => {
    const api = fakeApi(heavy(), {
      maxRows: 5,
      // The second prune, the third request, finds the dataset written to meanwhile.
      interfere: (n, store) => {
        if (n === 3) store.version += 1;
      },
    });
    const call = await transport();
    const { tag } = await readState(call);

    expect(await deleteAsset(call, tag, u(1))).toEqual({ kind: 'conflict' });
    expect(api.sent).toHaveLength(3);
    expect(api.store.assets.map((a) => a.id)).toEqual([u(1), u(2)]);
  });

  it('returns a 409 that is not the row bound as it came, and prunes nothing', async () => {
    let requests = 0;
    server.use(
      http.post(`${API}/mutations`, () => {
        requests += 1;
        return HttpResponse.json({ error: 'duplicate_id', index: 0 }, { status: 409 });
      }),
    );
    const call = await transport();

    expect(await deleteAsset(call, '"0"', u(1))).toEqual({
      kind: 'failed',
      status: 409,
      body: { error: 'duplicate_id', index: 0 },
    });
    expect(requests).toBe(1);
  });

  it.each([
    ['a count that does not fall', [{ remaining: 3 }, { remaining: 3 }], 3],
    ['no count', [{}], 2],
  ])('stops, rather than ask again, at %s', async (_, results, requests) => {
    let n = 0;
    server.use(
      http.post(`${API}/mutations`, () => {
        n += 1;
        // A driver that never stops is cut off here, so that it fails the count and not the run.
        if (n > 10) return HttpResponse.json({}, { status: 500 });
        return n === 1
          ? HttpResponse.json(
              { error: 'too_many_rows', index: 0, count: 9, max: 5 },
              { status: 409 },
            )
          : HttpResponse.json(
              { etag: `"${n}"`, results: [results[Math.min(n - 2, results.length - 1)]] },
              { headers: { etag: `"${n}"` } },
            );
      }),
    );
    const call = await transport();

    expect(await deleteAsset(call, '"0"', u(1))).toMatchObject({ kind: 'failed' });
    expect(n).toBe(requests);
  });
});

describe('saving the targets of several assets', () => {
  const four = () => [1, 2, 3, 4].map((n) => asset(n));

  it('is one request, and every target lands', async () => {
    const api = fakeApi({ assets: four() });
    const call = await transport();
    const { tag } = await readState(call);

    const reply = await send(
      call,
      tag,
      saveTargetsOps([
        { id: u(1), targetPct: 40 },
        { id: u(2), targetPct: 30 },
        { id: u(3), targetPct: 20 },
        { id: u(4), targetPct: 10 },
      ]),
    );

    expect(reply).toMatchObject({ kind: 'written' });
    expect(api.sent).toHaveLength(1);
    expect(api.sent[0].ops).toHaveLength(4);
    expect((await readState(call)).assets.map((a) => a.targetPct)).toEqual([40, 30, 20, 10]);
  });

  it('lands whole or not at all', async () => {
    const api = fakeApi({ assets: four() });
    const call = await transport();
    const { tag } = await readState(call);

    const reply = await send(
      call,
      tag,
      saveTargetsOps([
        { id: u(1), targetPct: 40 },
        { id: u(2), targetPct: 30 },
        { id: u(3), targetPct: 120 },
      ]),
    );

    expect(reply).toMatchObject({ kind: 'invalidOp', index: 2 });
    expect((await readState(call)).assets.map((a) => a.targetPct)).toEqual([25, 25, 25, 25]);
    expect(api.sent).toHaveLength(1);
  });
});

describe('a write', () => {
  it('goes under the tag it is given and a key of its own, as the list of ops', async () => {
    const api = fakeApi({ assets: [asset(1)], transactions: [deposit(20), buy(21, 1)] });
    const call = await transport();
    const { tag } = await readState(call);

    await send(call, tag, saveTargetsOps([{ id: u(1), targetPct: 5 }]));

    expect(api.sent[0].ifMatch).toBe(tag);
    expect(api.sent[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(api.sent[0].text)).toEqual({
      ops: [{ op: 'asset.patch', id: u(1), patch: { targetPct: 5 } }],
    });
  });

  it('comes back as the conflict a stale tag is, with nothing applied', async () => {
    const api = fakeApi({ assets: [asset(1)] });
    const call = await transport();

    expect(await send(call, '"7"', saveTargetsOps([{ id: u(1), targetPct: 5 }]))).toEqual({
      kind: 'conflict',
    });
    expect(api.store.assets[0].targetPct).toBe(25);
  });

  it('is not taken for a write when the answer is not the shape of one', async () => {
    server.use(http.post(`${API}/mutations`, () => HttpResponse.json({ saved: true })));
    const call = await transport();

    expect(await send(call, '"0"', clearOps())).toEqual({
      kind: 'failed',
      status: 200,
      body: { saved: true },
    });
  });
});
