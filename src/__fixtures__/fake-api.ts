// A fake of the user API for the client's tests: the reads `GET /view` and its three siblings, the
// export, `POST /mutations` and the staged import, served as `fetch` answers over rows held in
// memory. It applies the ops with core's own schemas and merge patch, so a client that sends the
// wrong op, the wrong tag or the wrong bytes is refused as the API refuses it. The relay's refresh
// answers too, so a page can sign in through it.
import { createHash } from 'node:crypto';

import {
  assetRecordSchema,
  priceRowSchema,
  transactionRecordSchema,
} from '@quirenote/core/backup/json';
import { ledgerUnits } from '@quirenote/core/derive';
import { mergePatch, opIssues, opSchema, type Op } from '@quirenote/core/ops';
import { PERIOD_OPTIONS } from '@quirenote/core/period';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import type { Asset, Transaction } from '@quirenote/core/types';
import { movedPrices, pricesOfQuotes, type PriceRow } from '@quirenote/core/valuation';
import {
  balancesBody,
  dayBody,
  seriesBody,
  viewBody,
  type Fx,
  type ServedRows,
} from '@quirenote/core/view/serve';

export interface Rows {
  assets: Asset[];
  transactions: Transaction[];
  prices: PriceRow[];
}

export interface Sent {
  method: string;
  /** The route and its query, without the relay's prefix. */
  path: string;
  headers: Record<string, string>;
  body: string;
}

interface Staged {
  manifest: Record<string, unknown>;
  parts: Map<number, string>;
}

class Refused extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super();
  }
}
const invalid = (index: number, field: string, code: string, value?: string) =>
  new Refused(422, { error: 'invalid_op', index, issues: [{ field, code, value }] });

const sha = (text: string) => createHash('sha256').update(text).digest('base64');

export const DERIVATION_ID = 'derivation-of-this-build';

export interface FakeApi {
  fetch: typeof fetch;
  /** The dataset the API holds. */
  rows: Rows;
  /** The official rate `/view` answers with, under its day. None answers `fx: null`. */
  fx: Fx | undefined;
  /** Writes so far: the strong tag is `"<version>"`. */
  version: number;
  /** Every request to a data route, in order. */
  seen: Sent[];
  /** How many reads have been answered 304. */
  notModified: number;
  /** Whether the relay holds a refresh cookie: a refresh answers tokens, a sign-out takes it away
   *  and a respond gives it back. */
  signedIn: boolean;
  tag: () => string;
  /** Runs as the nth `POST /mutations` arrives, before its precondition is read: another tab writing. */
  interfere?: (n: number, api: FakeApi) => void;
  /** Runs as a commit arrives, before its precondition is read. */
  beforeCommit?: (api: FakeApi) => void;
}

export function fakeApi(
  initial: Partial<Rows> = {},
  { today, maxRows = 2500 }: { today: string; maxRows?: number },
): FakeApi {
  const api: FakeApi = {
    fetch: undefined as unknown as typeof fetch,
    rows: structuredClone({ assets: [], transactions: [], prices: [], ...initial }),
    fx: undefined,
    version: 0,
    seen: [],
    notModified: 0,
    signedIn: true,
    tag: () => `"${api.version}"`,
  };
  const staged = new Map<string, Staged>();
  let mutations = 0;
  let opened = 0;

  const served = (): ServedRows => ({
    assets: api.rows.assets,
    transactions: api.rows.transactions,
    userPrices: api.rows.prices,
    archiveRows: [],
    paymentDates: [],
    today,
  });
  /** The weak validator of a read: the dataset's version, the day, the rate and its day, and the
   *  route with its query. */
  const validator = (route: string) =>
    `W/"${api.version}:${today}:${api.fx?.rate ?? ''}@${api.fx?.date ?? ''}:${route}"`;
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });

  function apply(draft: Rows, op: Op, index: number, budget: number) {
    switch (op.op) {
      case 'asset.add':
        if (draft.assets.some((a) => a.id === op.asset.id)) {
          throw invalid(index, 'id', 'duplicate-key', op.asset.id);
        }
        draft.assets.push(op.asset);
        return { result: {}, rows: 1 };
      case 'asset.patch': {
        const target = draft.assets.find((a) => a.id === op.id);
        if (target === undefined) throw invalid(index, 'id', 'unknown-asset-id', op.id);
        const parsed = assetRecordSchema.safeParse(mergePatch(target, op.patch));
        if (!parsed.success) throw invalid(index, parsed.error.issues[0].path.join('.'), 'invalid');
        draft.assets = draft.assets.map((a) => (a.id === op.id ? parsed.data : a));
        return { result: {}, rows: 1 };
      }
      case 'asset.delete': {
        const children =
          draft.prices.filter((p) => p.assetId === op.id).length +
          draft.transactions.filter((t) => t.assetId === op.id).length;
        if (!draft.assets.some((a) => a.id === op.id)) {
          throw invalid(index, 'id', 'unknown-asset-id', op.id);
        }
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
        return {
          result: { remaining: prices.length + transactions.length - deleted },
          rows: deleted,
        };
      }
      case 'transaction.add':
        if (
          op.transaction.assetId !== '' &&
          !draft.assets.some((a) => a.id === op.transaction.assetId)
        ) {
          throw invalid(index, 'assetId', 'unknown-asset-id', op.transaction.assetId);
        }
        draft.transactions.push(op.transaction);
        return { result: {}, rows: 1 };
      case 'transaction.patch': {
        const target = draft.transactions.find((t) => t.id === op.id);
        if (target === undefined) throw invalid(index, 'id', 'invalid', op.id);
        const parsed = transactionRecordSchema.safeParse(mergePatch(target, op.patch));
        if (!parsed.success) throw invalid(index, parsed.error.issues[0].path.join('.'), 'invalid');
        draft.transactions = draft.transactions.map((t) => (t.id === op.id ? parsed.data : t));
        return { result: {}, rows: 1 };
      }
      case 'transaction.delete':
        if (!draft.transactions.some((t) => t.id === op.id)) {
          throw invalid(index, 'id', 'invalid', op.id);
        }
        draft.transactions = draft.transactions.filter((t) => t.id !== op.id);
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
        draft.prices.push(
          ...prices.map((p) => ({ ...p, asOf: op.date, observedAt: `${today}T08:00:00` })),
        );
        return { result: { dropped }, rows: 1 };
      }
      case 'snapshot.delete': {
        const before = draft.prices.length;
        draft.prices = draft.prices.filter((p) => p.asOf !== op.date);
        if (draft.prices.length === before) throw invalid(index, 'date', 'invalid', op.date);
        return { result: {}, rows: before - draft.prices.length };
      }
      case 'snapshot.move': {
        if (draft.prices.some((p) => p.asOf === op.to)) {
          throw invalid(index, 'to', 'duplicate-key', op.to);
        }
        const from = draft.prices.filter((p) => p.asOf === op.from);
        if (from.length === 0) throw invalid(index, 'from', 'invalid', op.from);
        const { prices, dropped } = movedPrices(
          from.map((p) => ({ assetId: p.assetId, price: p.price })),
          ledgerUnits(draft.transactions, op.from).units,
          ledgerUnits(draft.transactions, op.to).units,
        );
        draft.prices = draft.prices.filter((p) => p.asOf !== op.from);
        draft.prices.push(...prices.map((p) => ({ ...p, asOf: op.to })));
        return { result: { dropped }, rows: from.length };
      }
      case 'dataset.clear':
        draft.assets = [];
        draft.transactions = [];
        draft.prices = [];
        return { result: {}, rows: 1 };
    }
  }

  function mutate(request: Sent): Response {
    mutations += 1;
    api.interfere?.(mutations, api);
    const ifMatch = request.headers['if-match'];
    if (ifMatch === undefined || ifMatch === '*') return json({ error: 'precondition_required' }, 428);
    if (ifMatch !== api.tag()) return json({ error: 'precondition_failed' }, 412);
    const raw = (JSON.parse(request.body) as { ops: unknown[] }).ops;
    const draft = structuredClone(api.rows);
    const results: object[] = [];
    let used = 0;
    try {
      raw.forEach((op, index) => {
        const parsed = opSchema.safeParse(op);
        if (!parsed.success) {
          throw new Refused(422, { error: 'invalid_op', index, issues: opIssues(parsed.error.issues, op) });
        }
        const done = apply(draft, parsed.data, index, maxRows - used);
        used += done.rows;
        results.push(done.result);
      });
    } catch (err) {
      if (err instanceof Refused) return json(err.body, err.status);
      throw err;
    }
    api.rows = draft;
    api.version += 1;
    return json({ etag: api.tag(), results }, 200, { etag: api.tag() });
  }

  function importing(request: Sent, path: string): Response {
    if (request.method === 'POST' && path === '/imports') {
      opened += 1;
      const id = `00000000-0000-4000-8000-${String(opened).padStart(12, '0')}`;
      staged.set(id, { manifest: JSON.parse(request.body) as Record<string, unknown>, parts: new Map() });
      return json({ id }, 201, { location: `/imports/${id}` });
    }
    const [, , id, kind, n] = path.split('/');
    const open = staged.get(id);
    if (open === undefined) return json({ error: 'no_such_import' }, 404);
    if (request.method === 'DELETE') {
      staged.delete(id);
      return new Response(null, { status: 204 });
    }
    if (request.method === 'PUT' && kind === 'parts') {
      if (request.headers['content-digest'] !== `sha-256=:${sha(request.body)}:`) {
        return json({ error: 'digest_mismatch' }, 400);
      }
      const rows = JSON.parse(request.body) as Partial<Rows>;
      for (const a of rows.assets ?? []) {
        if (!assetRecordSchema.safeParse(a).success) return json({ error: 'invalid_part' }, 422);
      }
      for (const t of rows.transactions ?? []) {
        if (!transactionRecordSchema.safeParse(t).success) return json({ error: 'invalid_part' }, 422);
      }
      for (const p of rows.prices ?? []) {
        if (!priceRowSchema.safeParse(p).success) return json({ error: 'invalid_part' }, 422);
      }
      // A key twice among the parts staged, this one included, is refused and stages nothing.
      const held = [...open.parts]
        .filter(([k]) => k !== Number(n))
        .map(([, body]) => JSON.parse(body) as Partial<Rows>);
      const keys = [...held, rows].flatMap((p) => [
        ...(p.assets ?? []).map((a) => `asset:${a.id}`),
        ...(p.transactions ?? []).map((t) => `transaction:${t.id}`),
        ...(p.prices ?? []).map((r) => `price:${r.assetId}:${r.asOf}`),
      ]);
      if (new Set(keys).size !== keys.length) {
        return json({ error: 'invalid_part', issues: [{ code: 'duplicate-key' }] }, 422);
      }
      open.parts.set(Number(n), request.body);
      return json({ part: Number(n), digest: sha(request.body) });
    }
    if (request.method === 'POST' && kind === 'commit') {
      api.beforeCommit?.(api);
      if (request.headers['if-match'] !== api.tag()) {
        return json({ error: 'precondition_failed' }, 412);
      }
      const numbers = [...open.parts.keys()].sort((a, b) => a - b);
      const bodies = numbers.map((k) => open.parts.get(k) as string);
      const complete = numbers.every((k, i) => k === i + 1);
      const composite = createHash('sha256')
        .update(Buffer.concat(bodies.map((b) => Buffer.from(sha(b), 'base64'))))
        .digest('base64');
      if (!complete || composite !== open.manifest.digest) {
        return json({ error: 'manifest_mismatch' }, 409);
      }
      const parts = bodies.map((b) => JSON.parse(b) as Partial<Rows>);
      api.rows = {
        assets: parts.flatMap((p) => p.assets ?? []),
        transactions: parts.flatMap((p) => p.transactions ?? []),
        prices: parts.flatMap((p) => p.prices ?? []),
      };
      api.version += 1;
      staged.delete(id);
      return json({ etag: api.tag() }, 200, { etag: api.tag() });
    }
    return json({ error: 'not_found' }, 404);
  }

  function read(request: Sent, path: string, query: URLSearchParams): Response {
    const route = `${path}${query.size === 0 ? '' : `?${query.toString()}`}`;
    const tag = validator(route);
    const sent = request.headers['if-none-match'];
    const headers = {
      etag: tag,
      'cache-control': 'private, no-cache',
      'derivation-id': DERIVATION_ID,
    };
    if (sent === tag) {
      api.notModified += 1;
      return new Response(null, { status: 304, headers });
    }
    const rows = served();
    if (path === '/view') {
      return json(
        { ...viewBody({ ...rows, fx: api.fx }), settings: SETTINGS_DEFAULTS, etag: api.tag() },
        200,
        headers,
      );
    }
    if (path === '/view/series') {
      const period = PERIOD_OPTIONS.find((p) => p === query.get('period'));
      if (period === undefined) return json({ error: 'invalid_query' }, 400);
      return json(seriesBody(rows, period), 200, headers);
    }
    if (path === '/view/balances') {
      return json(balancesBody(rows, Number(query.get('page') ?? 0)), 200, headers);
    }
    return json(dayBody(rows, query.get('date') ?? ''), 200, headers);
  }

  api.fetch = async (input, init) => {
    const original =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), 'http://localhost'), init);
    const url = new URL(original.url, 'http://localhost');
    // The dev server's proxy prefixes the API with `/relay`.
    const path = url.pathname.replace(/^\/relay/, '');
    if (path === '/auth/refresh') {
      return api.signedIn ? json({ idToken: 'h.e30.s', expiresIn: 3600 }) : json({}, 401);
    }
    if (path === '/auth/respond') {
      api.signedIn = true;
      return json({ idToken: 'h.e30.s', expiresIn: 3600 });
    }
    if (path === '/auth/sign-out') {
      api.signedIn = false;
      return json({ status: 'signed_out' });
    }
    const request: Sent = {
      method: original.method,
      path: `${path}${url.search}`,
      headers: Object.fromEntries(original.headers),
      body: await original.text(),
    };
    api.seen.push(request);
    if (request.method === 'GET' && path === '/state') {
      return json(api.rows, 200, { etag: api.tag() });
    }
    if (request.method === 'GET' && /^\/view(\/series|\/balances|\/day)?$/.test(path)) {
      return read(request, path, url.searchParams);
    }
    if (request.method === 'POST' && path === '/mutations') return mutate(request);
    if (path.startsWith('/imports')) return importing(request, path);
    return json({ error: 'not_found' }, 404);
  };
  return api;
}
