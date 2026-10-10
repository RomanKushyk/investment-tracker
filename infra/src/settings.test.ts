// `PATCH /settings` over PGlite: the caller's row and the gate in one database, reached through the
// module the route uses (*Persistence today*, *Cloud target*).
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import { SETTING_NAMES, SETTINGS_DEFAULTS, type AccountSettings } from '@quirenote/core/settings';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { ApiEvent, ApiResult } from './http';
import type { SqlClient } from './migrate';
import {
  handler as rawHandler,
  mutations as mutationsRoute,
  settings as exported,
} from './mutations';
import { proveRouteContract, recorder } from './route-contract';
import {
  MERGE_PATCH,
  RESPONSES,
  SETTINGS_ROUTE,
  settings as settingsRoute,
  type SettingsDeps,
} from './settings';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(SETTINGS_ROUTE);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'owner@quirenote.com';
const TWIN = '9f1e2d3c-0000-4000-8000-0000000000e5';
const TWIN_EMAIL = 'twin@quirenote.com';

const DEFAULTS: AccountSettings = SETTINGS_DEFAULTS;

let db: PGlite;
let slept: number[];

const deps = (over: Partial<SettingsDeps> = {}): SettingsDeps => ({
  user: db as unknown as SqlClient,
  sleep: async (ms) => {
    slept.push(ms);
  },
  ...over,
});

const caller = (sub = SUB, email = EMAIL) => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

type Send = {
  /** The media type; `null` sends none. */
  type?: string | null;
  d?: SettingsDeps;
  sub?: string;
  email?: string;
};

const event = (body: unknown, o: Send = {}): ApiEvent => ({
  routeKey: SETTINGS_ROUTE,
  headers: o.type === null ? {} : { 'content-type': o.type ?? MERGE_PATCH },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: false,
  requestContext: caller(o.sub, o.email),
});

const patch = async (body: unknown, o: Send = {}) => {
  const e = event(body, o);
  return record(e, (await settingsRoute(o.d ?? deps(), e)) as ApiResult);
};

const answer = (res: ApiResult): [number, unknown] => [res.statusCode, JSON.parse(res.body)];

const stored = async (id = SUB) =>
  (
    await db.query<{ settings: string | null }>(
      'SELECT settings FROM app_user WHERE user_id = $1',
      [id],
    )
  ).rows[0].settings;
const store = (text: string | null, id = SUB) =>
  db.query('UPDATE app_user SET settings = $2 WHERE user_id = $1', [id, text]);
const version = async () =>
  (
    await db.query<{ v: string }>(
      'SELECT data_version::text AS v FROM app_user WHERE user_id = $1',
      [SUB],
    )
  ).rows[0].v;

/** Every statement sent, for a client that wraps the database. */
const watching = () => {
  const sent: string[] = [];
  const client: SqlClient = {
    query: (text, values) => {
      sent.push(text);
      return db.query(text, values) as never;
    },
  };
  return { client, sent };
};
const writes = (sent: string[]) => sent.filter((s) => /^\s*UPDATE app_user SET settings/.test(s));

const conflict = (code: string) =>
  Object.assign(new Error('change conflicts with another transaction (OC000)'), { code });

/** A client that lets `before` happen ahead of a write to the column, and `fails` it; both are told
 *  which attempt it is, counting from 1. `landsFirst` lets a failed write take effect first. */
const interfering = (o: {
  before?: (attempt: number) => Promise<unknown> | undefined;
  fails?: (attempt: number) => Error | undefined;
  landsFirst?: boolean;
}) => {
  const sent: string[] = [];
  let attempt = 0;
  const client: SqlClient = {
    query: async (text, values) => {
      sent.push(text);
      if (writes([text]).length === 0) return db.query(text, values) as never;
      attempt += 1;
      await o.before?.(attempt);
      const failure = o.fails?.(attempt);
      if (failure !== undefined && o.landsFirst) await db.query(text, values);
      if (failure !== undefined) throw failure;
      return db.query(text, values) as never;
    },
  };
  return { client, sent };
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL);
  await writeLedger(db, SUB, { assets: [], transactions: [], userPrices: [] });
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
  slept = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('a patch changes the fields it names', () => {
  it('sets a field on a row that stores none, and answers every setting', async () => {
    expect(answer(await patch({ period: '3m' }))).toEqual([200, { ...DEFAULTS, period: '3m' }]);
    expect(await stored()).toBe('{"period":"3m"}');
  });

  it('leaves every field it does not name as stored', async () => {
    await store('{"language":"en","sidebarCollapsed":true,"period":"1m"}');
    expect(answer(await patch({ period: '3m', couponSuggest: false }))).toEqual([
      200,
      { ...DEFAULTS, language: 'en', sidebarCollapsed: true, period: '3m', couponSuggest: false },
    ]);
    expect(await stored()).toBe(
      '{"language":"en","couponSuggest":false,"sidebarCollapsed":true,"period":"3m"}',
    );
  });

  it('resets a field to its default with null and leaves the others', async () => {
    await store('{"language":"en","period":"1m"}');
    expect(answer(await patch({ period: null }))).toEqual([200, { ...DEFAULTS, language: 'en' }]);
    expect(await stored()).toBe('{"language":"en"}');
  });

  it('stores NULL again once every field is reset', async () => {
    await store('{"language":"en","period":"1m"}');
    const everything = Object.fromEntries(SETTING_NAMES.map((name) => [name, null]));
    expect(answer(await patch(everything))).toEqual([200, DEFAULTS]);
    expect(await stored()).toBeNull();
  });

  it('answers the defaults to an empty patch on a row that stores none, and writes nothing', async () => {
    const { client, sent } = watching();
    expect(answer(await patch({}, { d: deps({ user: client }) }))).toEqual([200, DEFAULTS]);
    expect(await stored()).toBeNull();
    expect(writes(sent)).toEqual([]);
  });

  it('stores a list as given', async () => {
    const ids = ['quote-missing:2026-10-10', 'maturity:00000000-0000-4000-8000-000000000001'];
    await patch({ dismissedReminders: ids, collapsedNavGroups: ['analytics'] });
    expect(JSON.parse((await stored())!)).toEqual({
      dismissedReminders: ids,
      collapsedNavGroups: ['analytics'],
    });
  });

  it('writes the caller’s row alone', async () => {
    await insertUser(db, TWIN, TWIN_EMAIL);
    await store('{"language":"en"}', TWIN);
    await patch({ period: '3m' });
    expect([await stored(), await stored(TWIN)]).toEqual(['{"period":"3m"}', '{"language":"en"}']);
  });

  it('leaves a stored member no setting is for, and a stored value its rule refuses, as stored', async () => {
    await store('{"later":{"on":true},"period":"1y","language":"en"}');
    expect(answer(await patch({ couponSuggest: false }))).toEqual([
      200,
      { ...DEFAULTS, language: 'en', couponSuggest: false },
    ]);
    expect(await stored()).toBe(
      '{"language":"en","couponSuggest":false,"period":"1y","later":{"on":true}}',
    );
  });

  it('writes nothing for an empty patch of a row that stores a value its rule refuses', async () => {
    await store('{"language":"pl","period":"1y"}');
    const { client, sent } = watching();
    expect(answer(await patch({}, { d: deps({ user: client }) }))).toEqual([200, DEFAULTS]);
    expect(await stored()).toBe('{"language":"pl","period":"1y"}');
    expect(writes(sent)).toEqual([]);
  });

  it('reads a media type in any case and with parameters', async () => {
    const type = 'Application/Merge-Patch+JSON; charset=utf-8';
    expect(answer(await patch({ period: '6m' }, { type }))[0]).toBe(200);
  });
});

describe('a field the sanitiser refuses is refused 422 naming it', () => {
  const refused = (issues: unknown[]) => [422, { error: 'invalid_settings', issues }];

  it('names a value its field does not accept, and writes nothing', async () => {
    await store('{"language":"en"}');
    expect(answer(await patch({ period: '1y' }))).toEqual(
      refused([{ field: 'period', code: 'invalid' }]),
    );
    expect(await stored()).toBe('{"language":"en"}');
  });

  it.each(['theme', 'usdRate', 'dataset', 'currency', 'accent', 'constructor'])(
    'refuses %s, which no account setting is, set or reset',
    async (field) => {
      expect(answer(await patch({ [field]: 'x' }))).toEqual(
        refused([{ field, code: 'unknown-key' }]),
      );
      expect(answer(await patch({ [field]: null }))).toEqual(
        refused([{ field, code: 'unknown-key' }]),
      );
      expect(await stored()).toBeNull();
    },
  );

  it('applies none of a patch that names one it refuses', async () => {
    expect(answer(await patch({ language: 'en', theme: 'dark', period: '1y' }))).toEqual(
      refused([
        { field: 'theme', code: 'unknown-key' },
        { field: 'period', code: 'invalid' },
      ]),
    );
    expect(await stored()).toBeNull();
  });

  it('refuses a list holding anything but strings', async () => {
    expect(answer(await patch({ dismissedReminders: ['a', 1] }))).toEqual(
      refused([{ field: 'dismissedReminders', code: 'invalid' }]),
    );
  });
});

describe('a settings write moves no data_version', () => {
  const tx = {
    id: '00000000-0000-4000-8000-000000000001',
    date: '2026-03-01',
    type: 'deposit',
    assetId: '',
    amount: 100,
  };
  const write = (ifMatch: string): ApiEvent => ({
    routeKey: 'POST /mutations',
    headers: { 'idempotency-key': randomUUID(), 'if-match': ifMatch },
    body: JSON.stringify({ ops: [{ op: 'transaction.add', transaction: tx }] }),
    requestContext: caller(),
  });
  const mutate = (e: ApiEvent) =>
    mutationsRoute(
      { user: db as unknown as SqlClient, token: randomUUID, sleep: async () => {} },
      e,
    );

  it('leaves the version as it was', async () => {
    await patch({ period: '3m' });
    await patch({ period: null });
    expect(await version()).toBe('0');
  });

  it('leaves a write under the tag read before it applying', async () => {
    const before = `"${await version()}"`;
    await patch({ period: '3m', language: 'en' });
    const res = await mutate(write(before));
    expect([res.statusCode, res.headers.etag]).toEqual([200, '"1"']);
  });

  it('is left as it was by a write', async () => {
    await patch({ period: '3m' });
    await mutate(write('"0"'));
    expect(await stored()).toBe('{"period":"3m"}');
  });

  it('claims no idempotency key, since it asks for none', async () => {
    await patch({ period: '3m' });
    const { rows } = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM mutation_key');
    expect(rows[0].n).toBe(0);
  });
});

describe('the same patch twice', () => {
  it('leaves one state, and the second writes nothing', async () => {
    await store('{"language":"en"}');
    const body = { period: '6m', dismissedReminders: ['a'], language: null };
    const first = await patch(body);
    const text = await stored();
    const { client, sent } = watching();
    const second = await patch(body, { d: deps({ user: client }) });
    expect(answer(second)).toEqual(answer(first));
    expect(await stored()).toBe(text);
    expect(writes(sent)).toEqual([]);
  });
});

describe('a request the route cannot read', () => {
  it('answers 415 and names the type it takes, for any other media type or none', async () => {
    for (const type of ['application/json', 'text/plain', 'application/merge-patch+yaml', null]) {
      const res = await patch({ period: '3m' }, { type });
      expect([answer(res), res.headers['accept-patch']]).toEqual([
        [415, { error: 'unsupported_media_type' }],
        MERGE_PATCH,
      ]);
    }
    expect(await stored()).toBeNull();
  });

  it.each([
    ['text that is not JSON', 'period=3m'],
    ['an empty body', ''],
    ['a list', '[{"period":"3m"}]'],
    ['a string', '"period"'],
    ['a number', '7'],
    ['null', 'null'],
    ['a __proto__ member', '{"__proto__":{"period":"3m"}}'],
    ['a __proto__ member below a field', '{"period":{"__proto__":1}}'],
  ])('answers 400 to %s', async (_what, body) => {
    expect(answer(await patch(body))).toEqual([400, { error: 'invalid_request' }]);
    expect(await stored()).toBeNull();
  });

  it('answers 413 to a body past the byte bound, however it is encoded', async () => {
    const big = `{"dismissedReminders":["${'x'.repeat(MAX_BODY_BYTES)}"]}`;
    expect(answer(await patch(big))).toEqual([
      413,
      { error: 'payload_too_large', max: MAX_BODY_BYTES },
    ]);
    const e = { ...event(big), body: Buffer.from(big).toString('base64'), isBase64Encoded: true };
    expect(answer(record(e, (await settingsRoute(deps(), e)) as ApiResult))[0]).toBe(413);
    expect(await stored()).toBeNull();
  });

  it('answers 413 to a patch that would grow what is stored past the bound, and writes nothing', async () => {
    const near = `{"dismissedReminders":["${'x'.repeat(MAX_BODY_BYTES - 100)}"]}`;
    await store(near);
    expect(answer(await patch({ collapsedNavGroups: ['y'.repeat(500)] }))).toEqual([
      413,
      { error: 'payload_too_large', max: MAX_BODY_BYTES },
    ]);
    expect(await stored()).toBe(near);
  });

  it('counts the bound in bytes, not characters', async () => {
    // One ASCII character and two-byte ones for the rest: the text is exactly the bound in bytes,
    // and half of it in characters.
    const room = MAX_BODY_BYTES - '{"dismissedReminders":["x"]}'.length;
    const fits = `{"dismissedReminders":["x${'я'.repeat(room / 2)}"]}`;
    expect(Buffer.byteLength(fits)).toBe(MAX_BODY_BYTES);
    await store(fits);
    expect(answer(await patch({ period: '3m' }))[0]).toBe(413);
  });

  it('is told the type before the body is read', async () => {
    expect(answer(await patch('not json', { type: 'application/json' }))[0]).toBe(415);
  });
});

describe('the gate', () => {
  const refuses = async (expected: string, o: Send = {}) => {
    const res = await patch({ period: '3m' }, o);
    expect(answer(res)).toEqual([403, { error: expected }]);
    expect(await stored()).toBeNull();
  };

  it('tells a pending applicant to wait', async () => {
    await db.query("UPDATE app_user SET status = 'pending', decided_at = NULL, decided_by = NULL");
    await refuses('pending');
  });

  it('tells a rejected applicant to stop', async () => {
    await db.query("UPDATE app_user SET status = 'rejected'");
    await refuses('rejected');
  });

  it('tells a caller with no row there is no application', async () => {
    await refuses('no_application', { sub: TWIN, email: TWIN_EMAIL });
  });

  it('refuses the demo as a non-caller', async () => {
    await insertUser(db, DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo');
    await refuses('forbidden', { sub: TWIN, email: DEMO_USER_EMAIL });
  });

  it('is asked before the media type and the body', async () => {
    await db.query("UPDATE app_user SET status = 'rejected'");
    const res = await patch('not json', { type: 'text/plain' });
    expect(answer(res)).toEqual([403, { error: 'rejected' }]);
  });
});

describe('two writers at once', () => {
  it('merges onto what another writer stored between the read and the write', async () => {
    const { client, sent } = interfering({
      before: (attempt) => (attempt === 1 ? store('{"language":"en"}') : undefined),
    });
    const res = await patch({ period: '3m' }, { d: deps({ user: client }) });
    expect(answer(res)).toEqual([200, { ...DEFAULTS, language: 'en', period: '3m' }]);
    expect(await stored()).toBe('{"language":"en","period":"3m"}');
    expect(writes(sent)).toHaveLength(2);
    expect(slept).toEqual([20]);
  });

  it('retries a serialization failure and applies the patch once', async () => {
    const { client, sent } = interfering({
      fails: (attempt) => (attempt === 1 ? conflict('40001') : undefined),
    });
    expect(answer(await patch({ period: '3m' }, { d: deps({ user: client }) }))[0]).toBe(200);
    expect(await stored()).toBe('{"period":"3m"}');
    expect(writes(sent)).toHaveLength(2);
    expect(slept).toEqual([20]);
  });

  it('answers a write that landed under the error from the state it left, applying nothing again', async () => {
    const { client, sent } = interfering({
      fails: (attempt) => (attempt === 1 ? conflict('40001') : undefined),
      landsFirst: true,
    });
    const res = await patch({ period: '3m' }, { d: deps({ user: client }) });
    expect(answer(res)).toEqual([200, { ...DEFAULTS, period: '3m' }]);
    expect(await stored()).toBe('{"period":"3m"}');
    expect(writes(sent)).toHaveLength(1);
  });

  it('gives up after the last delay, answering 500 and leaving the row as it was', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = interfering({ fails: () => conflict('40001') });
    expect(answer(await patch({ period: '3m' }, { d: deps({ user: client }) }))).toEqual([
      500,
      { error: 'internal' },
    ]);
    expect(slept).toEqual([20, 80, 200]);
    expect(await stored()).toBeNull();
  });

  it('gives up when another writer is first every time', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = interfering({
      before: (attempt) => store(`{"sidebarCollapsed":${attempt % 2 === 1}}`),
    });
    expect(answer(await patch({ period: '3m' }, { d: deps({ user: client }) }))[0]).toBe(500);
    expect(slept).toEqual([20, 80, 200]);
  });

  it('does not retry a failure that is no conflict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = interfering({ fails: () => new Error('the cluster said no') });
    expect(answer(await patch({ period: '3m' }, { d: deps({ user: client }) }))[0]).toBe(500);
    expect(slept).toEqual([]);
  });
});

describe('the function that serves it', () => {
  // The deploy smoke test calls the route from the bundle, whose entry is this module.
  it('exports the route from its entry module', () => {
    expect(exported).toBe(settingsRoute);
  });

  it('routes the patch to the route and closes its connection', async () => {
    let ended = 0;
    vi.mocked(connect).mockResolvedValue({
      query: (text: string, values?: unknown[]) => db.query(text, values),
      end: async () => {
        ended += 1;
      },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const e = event({ period: '3m' });
    const res = (await rawHandler(e)) as ApiResult;
    expect(answer(res)).toEqual([200, { ...DEFAULTS, period: '3m' }]);
    expect(ended).toBe(1);
  });
});

describe('a failure answers rather than throws', () => {
  const broken: SqlClient = { query: () => Promise.reject(new Error('the cluster went away')) };

  it('answers a failing database with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(answer(await patch({ period: '3m' }, { d: deps({ user: broken }) }))).toEqual([
      500,
      { error: 'internal' },
    ]);
  });

  it('answers a connection failure with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = event({ period: '3m' });
    const res = record(e, (await rawHandler(e)) as ApiResult);
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 40 });
