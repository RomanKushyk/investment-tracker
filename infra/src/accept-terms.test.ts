// `POST /me/terms` on PGlite with every migration, so `app_user_terms_ck` refuses a half-written
// pair here as the cluster would. Each row is read back: the answer alone would pass a route that
// answered 204 and wrote nothing.
import type { PGlite } from '@electric-sql/pglite';
import { MAX_BODY_BYTES } from '@quirenote/core/ops';
import { TERMS_VERSION } from '@quirenote/core/terms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser } from './__fixtures__/user-ledger';
import {
  REQUEST_BODY,
  RESPONSES,
  TERMS_ROUTE,
  acceptTerms,
  type AcceptTermsDeps,
} from './accept-terms';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import type { SqlClient } from './migrate';
import { handler as rawHandler } from './mutations';
import { proveRouteContract, recorder } from './route-contract';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(TERMS_ROUTE);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000f6';
const EMAIL = 'unaccepted@quirenote.com';
const HELD = '2026-01-15';

let db: PGlite;
let slept: number[];

const deps = (over: Partial<AcceptTermsDeps> = {}): AcceptTermsDeps => ({
  user: db as unknown as SqlClient,
  sleep: async (ms) => {
    slept.push(ms);
  },
  ...over,
});

const event = (body: unknown, raw?: string): ApiEvent => ({
  routeKey: TERMS_ROUTE,
  headers: { 'content-type': 'application/json' },
  body: raw ?? JSON.stringify(body),
  requestContext: {
    authorizer: {
      jwt: { claims: { token_use: 'id', sub: SUB, email: EMAIL, email_verified: 'true' } },
    },
  },
});

const post = async (body: unknown, o: { raw?: string; d?: AcceptTermsDeps } = {}) => {
  const e = event(body, o.raw);
  return record(e, await acceptTerms(o.d ?? deps(), e));
};

const answer = (res: ApiResult | EmptyResult) =>
  [res.statusCode, 'body' in res ? JSON.parse(res.body) : undefined] as const;

const terms = async () =>
  (
    await db.query<{ version: string | null; accepted: boolean }>(
      `SELECT terms_version::text AS version, terms_accepted_at IS NOT NULL AS accepted
         FROM app_user WHERE user_id = $1`,
      [SUB],
    )
  ).rows[0];

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, SUB, EMAIL, 'active', 'user', { terms: false });
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
  slept = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('the acceptance is recorded', () => {
  it('stores the version and the time on a row that holds none, and answers 204', async () => {
    expect(answer(await post({ termsVersion: TERMS_VERSION }))).toEqual([204, undefined]);
    expect(await terms()).toEqual({ version: TERMS_VERSION, accepted: true });
  });

  it('stamps the time of the request', async () => {
    const before = Date.now();
    await post({ termsVersion: TERMS_VERSION });
    const { rows } = await db.query<{ at: Date }>(
      'SELECT terms_accepted_at AS at FROM app_user WHERE user_id = $1',
      [SUB],
    );
    expect(rows[0].at.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(rows[0].at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  // The first acceptance stands, as an application made again leaves its own (*Legal documents*).
  it('leaves a version already held, and its time, unchanged', async () => {
    await db.query(
      `UPDATE app_user SET terms_version = $2::date,
                           terms_accepted_at = '2026-01-15T10:00:00Z' WHERE user_id = $1`,
      [SUB, HELD],
    );
    expect(answer(await post({ termsVersion: TERMS_VERSION }))).toEqual([204, undefined]);
    const { rows } = await db.query<{ version: string; at: number }>(
      `SELECT terms_version::text AS version, extract(epoch FROM terms_accepted_at)::float8 AS at
         FROM app_user WHERE user_id = $1`,
      [SUB],
    );
    expect(rows[0]).toEqual({ version: HELD, at: Date.parse('2026-01-15T10:00:00Z') / 1000 });
  });

  it('answers a second press as it answered the first', async () => {
    await post({ termsVersion: TERMS_VERSION });
    expect(answer(await post({ termsVersion: TERMS_VERSION }))).toEqual([204, undefined]);
    expect(await terms()).toEqual({ version: TERMS_VERSION, accepted: true });
  });
});

describe('a body that names other terms, or none, records nothing', () => {
  for (const [what, body] of [
    ['another version', { termsVersion: '2026-01-01' }],
    ['no version', {}],
    ['a version that is not text', { termsVersion: 20261029 }],
  ] as const) {
    it(`answers ${what} with terms_outdated`, async () => {
      expect(answer(await post(body))).toEqual([400, { error: 'terms_outdated' }]);
      expect(await terms()).toEqual({ version: null, accepted: false });
    });
  }

  for (const [what, body, raw] of [
    ['a key the route does not read', { termsVersion: TERMS_VERSION, extra: 1 }, undefined],
    ['an array', [TERMS_VERSION], undefined],
    ['null', null, undefined],
    ['text that is no JSON', undefined, '{"termsVersion":'],
  ] as const) {
    it(`answers ${what} with invalid_request`, async () => {
      expect(answer(await post(body, { raw }))).toEqual([400, { error: 'invalid_request' }]);
      expect(await terms()).toEqual({ version: null, accepted: false });
    });
  }

  it('answers a body past the bound with 413', async () => {
    const res = await post(undefined, { raw: `"${'x'.repeat(MAX_BODY_BYTES)}"` });
    expect(res.statusCode).toBe(413);
    expect(await terms()).toEqual({ version: null, accepted: false });
  });
});

describe('the gate', () => {
  // The step is the one route a caller with no version may reach; every status still answers first.
  it('lets a caller whose row holds no version through', async () => {
    expect((await post({ termsVersion: TERMS_VERSION })).statusCode).toBe(204);
  });

  for (const [status, error] of [
    ['pending', 'pending'],
    ['rejected', 'rejected'],
  ] as const) {
    it(`answers a ${status} row with ${error} and records nothing`, async () => {
      await db.query('DELETE FROM app_user WHERE user_id = $1', [SUB]);
      await insertUser(db, SUB, EMAIL, status, 'user', { terms: false });
      expect(answer(await post({ termsVersion: TERMS_VERSION }))).toEqual([403, { error }]);
      expect(await terms()).toEqual({ version: null, accepted: false });
    });
  }

  it('answers no row with no_application', async () => {
    await db.query('DELETE FROM app_user WHERE user_id = $1', [SUB]);
    expect(answer(await post({ termsVersion: TERMS_VERSION }))).toEqual([
      403,
      { error: 'no_application' },
    ]);
  });

  it('answers a token it cannot read with forbidden', async () => {
    const e = { ...event({ termsVersion: TERMS_VERSION }), requestContext: {} };
    const res = record(e, await acceptTerms(deps(), e));
    expect(answer(res)).toEqual([403, { error: 'forbidden' }]);
  });

  it('asks the gate before it reads the body', async () => {
    const e = { ...event(undefined, 'not json'), requestContext: {} };
    expect(answer(record(e, await acceptTerms(deps(), e)))).toEqual([403, { error: 'forbidden' }]);
  });
});

describe('a failure answers rather than throws', () => {
  const failing = (code?: string): SqlClient => ({
    query: async <R>(text: string, values?: unknown[]) => {
      if (text.startsWith('UPDATE'))
        throw Object.assign(new Error('the cluster said no'), { code });
      return db.query<R>(text, values) as Promise<{ rows: R[] }>;
    },
  });

  it('answers a failing write with its own 500, and does not retry it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post({ termsVersion: TERMS_VERSION }, { d: deps({ user: failing() }) });
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
    expect(slept).toEqual([]);
  });

  // A serialization failure may have committed; the write is conditional, so running it again
  // finds it done or does it.
  it('runs a write that lost a conflict again, and answers 204 once it lands', async () => {
    let failed = 0;
    const once: SqlClient = {
      query: async <R>(text: string, values?: unknown[]) => {
        if (text.startsWith('UPDATE') && failed++ === 0) {
          throw Object.assign(new Error('change conflicts'), { code: '40001' });
        }
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    expect(
      answer(await post({ termsVersion: TERMS_VERSION }, { d: deps({ user: once }) })),
    ).toEqual([204, undefined]);
    expect(slept).toHaveLength(1);
    expect(await terms()).toEqual({ version: TERMS_VERSION, accepted: true });
  });

  it('answers 500 when every attempt lost its conflict', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(
      { termsVersion: TERMS_VERSION },
      { d: deps({ user: failing('40001') }) },
    );
    expect(answer(res)).toEqual([500, { error: 'internal' }]);
  });
});

describe('the function that serves it', () => {
  it('serves the write at /me/terms', () => {
    expect(TERMS_ROUTE).toBe('POST /me/terms');
  });

  it('publishes the one version it accepts', () => {
    const { schema } = REQUEST_BODY.content['application/json'];
    expect(schema.required).toEqual(['termsVersion']);
    expect(schema.properties.termsVersion.enum).toEqual([TERMS_VERSION]);
  });

  it('routes the write to the route and closes its connection', async () => {
    let ended = 0;
    vi.mocked(connect).mockResolvedValue({
      query: (text: string, values?: unknown[]) => db.query(text, values),
      end: async () => {
        ended += 1;
      },
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const e = event({ termsVersion: TERMS_VERSION });
    const res = record(e, await rawHandler(e));
    expect(res.statusCode).toBe(204);
    expect(await terms()).toEqual({ version: TERMS_VERSION, accepted: true });
    expect(ended).toBe(1);
  });

  it('answers a connection failure with its own 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const e = event({ termsVersion: TERMS_VERSION });
    expect(answer(record(e, await rawHandler(e)))).toEqual([500, { error: 'internal' }]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 20 });
