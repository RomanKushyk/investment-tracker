// The list a ruling starts from. Served by the admin function behind the same gate approve and
// reject stand behind, so every call here goes through `approve()` rather than the module alone:
// the gate's four refusals are part of what the route answers.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { LIST_ROUTE, RESPONSES } from './admin-users';
import { APPROVE_ROUTE, type IdentityClient, approve as approveRoute } from './approve';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

const { observed, record } = recorder(LIST_ROUTE);

const approve = async (...args: Parameters<typeof approveRoute>): ReturnType<typeof approveRoute> =>
  record(args[2], await approveRoute(...args));

const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const POOL = 'eu-north-1_EXAMPLE';
const ADMIN = '9f1e2d3c-0000-4000-8000-00000000ad11';
const ADMIN_EMAIL = 'owner@quirenote.com';
const ADMIN_APPLIED = '2026-08-01T09:00:00Z';
const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const OUTSIDER = '9f1e2d3c-0000-4000-8000-00000000ab1e';

/** Four applicants: three share one `applied_at`, which is what the cursor's tie-break is for. */
const A = '00000000-0000-4000-8000-000000000a01';
const B = '00000000-0000-4000-8000-000000000a02';
const C = '00000000-0000-4000-8000-000000000a03';
const D = '00000000-0000-4000-8000-000000000a04';
const SAME_DAY = '2026-09-01T10:00:00Z';
const LATER = '2026-09-02T10:00:00Z';

const token = (sub = ADMIN, email = ADMIN_EMAIL): ApiEvent['requestContext'] => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

const list = (query?: Record<string, string>, context = token()): ApiEvent => ({
  routeKey: LIST_ROUTE,
  ...(query === undefined ? {} : { queryStringParameters: query }),
  requestContext: context,
});

/** The pool is never reached by a list; approve's one call below is handed a sub. */
const idp: IdentityClient = {
  adminCreateUser: async () => ({ User: { Attributes: [{ Name: 'sub', Value: SUB }] } }),
  adminGetUser: async () => ({}),
  adminDisableUser: async () => ({}),
  adminEnableUser: async () => ({}),
};

let db: PGlite;

/** The real cluster, except that one statement fails. */
const failingOn = (needle: string, err: Error): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes(needle)) throw err;
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

const insert = (userId: string, email: string, status: string, appliedAt: string, role = 'user') =>
  status === 'pending' || role === 'demo'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '${appliedAt}');`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '${appliedAt}', now(),
                 '${ADMIN}');`;

type Listed = {
  id: string;
  email: string;
  status: string;
  appliedAt: string;
  decidedAt: string | null;
};
type Page = { users: Listed[]; next?: string };

const page = (body: string): Page => JSON.parse(body) as Page;

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  await db.exec(insert(ADMIN, ADMIN_EMAIL, 'active', ADMIN_APPLIED, 'super_admin'));
  await db.exec(insert(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', SAME_DAY, 'demo'));
  vi.stubEnv('USER_POOL_ID', POOL);
  vi.stubEnv('OPEN_REGISTRATION', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the list: every application but the demo, oldest first, five fields each', () => {
  it('lists every non-demo row oldest application first, carrying exactly the five fields', async () => {
    await db.exec(insert(A, 'a@quirenote.com', 'pending', LATER));
    await db.exec(insert(B, 'b@quirenote.com', 'rejected', SAME_DAY));
    const res = await approve(db, idp, list());
    expect(res.statusCode).toBe(200);
    const { users, next } = page(res.body);
    expect(next).toBeUndefined();
    expect(users.map((u) => u.id)).toEqual([ADMIN, B, A]);
    for (const u of users) {
      expect(Object.keys(u)).toEqual(['id', 'email', 'status', 'appliedAt', 'decidedAt']);
    }
    expect(users[2]).toEqual({
      id: A,
      email: 'a@quirenote.com',
      status: 'pending',
      appliedAt: '2026-09-02T10:00:00.000000Z',
      decidedAt: null,
    });
    expect(users[1].status).toBe('rejected');
    expect(users[1].decidedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  // APPROVE REKEYS THE ROW, and its `applied_at` must survive whole: a stamp cut to milliseconds
  // moves the row in the list's order, and the cursor can step past it.
  it('lists an approved row under the applied_at it applied with, to the microsecond', async () => {
    await db.exec(insert(A, 'a@quirenote.com', 'pending', '2026-09-01T10:00:00.123456Z'));
    const ruled = await approveRoute(db, idp, {
      routeKey: APPROVE_ROUTE,
      pathParameters: { id: A },
      requestContext: token(),
    });
    expect(ruled.statusCode).toBe(200);
    const { users } = page((await approve(db, idp, list({ status: 'active' }))).body);
    expect(users.find((u) => u.id === SUB)?.appliedAt).toBe('2026-09-01T10:00:00.123456Z');
  });

  it('filters by status, and the id it lists is the one approve takes', async () => {
    await db.exec(insert(A, 'a@quirenote.com', 'pending', LATER));
    await db.exec(insert(B, 'b@quirenote.com', 'rejected', SAME_DAY));
    const res = await approve(db, idp, list({ status: 'pending' }));
    expect(res.statusCode).toBe(200);
    const { users } = page(res.body);
    expect(users.map((u) => [u.id, u.status])).toEqual([[A, 'pending']]);

    const ruled = await approveRoute(db, idp, {
      routeKey: APPROVE_ROUTE,
      pathParameters: { id: users[0].id },
      requestContext: token(),
    });
    expect([ruled.statusCode, ruled.body]).toEqual([200, '{"status":"approved"}']);
    const after = page((await approve(db, idp, list({ status: 'active' }))).body);
    expect(after.users.map((u) => u.id)).toEqual([ADMIN, SUB]);
  });

  it('never lists the demo row, filtered or not', async () => {
    for (const query of [undefined, { status: 'active' }, { status: 'pending' }]) {
      const { users } = page((await approve(db, idp, list(query))).body);
      expect([query, users.some((u) => u.id === DEMO_USER_ID)]).toEqual([query, false]);
      expect([query, users.some((u) => u.email === DEMO_USER_EMAIL)]).toEqual([query, false]);
    }
  });
});

describe('the cursor: a page holds limit rows, and following next visits every row once', () => {
  beforeEach(async () => {
    await db.exec(insert(A, 'a@quirenote.com', 'pending', SAME_DAY));
    await db.exec(insert(B, 'b@quirenote.com', 'pending', SAME_DAY));
    await db.exec(insert(C, 'c@quirenote.com', 'pending', SAME_DAY));
    await db.exec(insert(D, 'd@quirenote.com', 'pending', LATER));
  });

  it('walks five rows in pages of two, three rows sharing an applied_at, with no duplicate', async () => {
    const visited: string[] = [];
    const pages: Page[] = [];
    let cursor: string | undefined;
    do {
      const res = await approve(db, idp, list({ limit: '2', ...(cursor ? { cursor } : {}) }));
      expect(res.statusCode).toBe(200);
      const p = page(res.body);
      pages.push(p);
      visited.push(...p.users.map((u) => u.id));
      cursor = p.next;
    } while (cursor !== undefined);

    expect(pages.map((p) => p.users.length)).toEqual([2, 2, 1]);
    expect(pages.map((p) => p.next !== undefined)).toEqual([true, true, false]);
    expect(visited).toEqual([ADMIN, A, B, C, D]);
    expect(new Set(visited).size).toBe(5);
  });

  it('pages a filtered list the same way', async () => {
    const first = page((await approve(db, idp, list({ status: 'pending', limit: '3' }))).body);
    expect(first.users.map((u) => u.id)).toEqual([A, B, C]);
    expect(first.next).toBeDefined();
    const second = page(
      (await approve(db, idp, list({ status: 'pending', limit: '3', cursor: first.next! }))).body,
    );
    expect(second.users.map((u) => u.id)).toEqual([D]);
    expect(second.next).toBeUndefined();
  });

  it('holds limit to 1–100 and refuses what it cannot read', async () => {
    const cursor = (text: string) => Buffer.from(text).toString('base64url');
    const refused: Record<string, string>[] = [
      { limit: '0' },
      { limit: '101' },
      { limit: 'ten' },
      { limit: '' },
      { status: 'approved' },
      { status: '' },
      { cursor: '!!!' },
      { cursor: cursor('not a cursor') },
      // Three parts each, so every one reaches the guard it names.
      { cursor: cursor(`${SAME_DAY}|not-a-uuid|`) },
      // Stamps the cluster would read but this route never wrote: no fraction, and milliseconds.
      { cursor: cursor(`${SAME_DAY}|${A}|`) },
      { cursor: cursor(`2026-09-01T10:00:00.000Z|${A}|`) },
      { cursor: cursor(`2026-09-01T10:00:00.000000Z|${A}||more`) },
    ];
    for (const query of refused) {
      const res = await approve(db, idp, list(query));
      expect([query, res.statusCode, res.body]).toEqual([
        query,
        400,
        '{"error":"invalid_request"}',
      ]);
    }
  });

  /** A real `next`, decoded, its stamp replaced, encoded again: it differs from one this route
   *  wrote only in the part under test. */
  const forged = async (stamp: string) => {
    const { next } = page((await approve(db, idp, list({ limit: '1' }))).body);
    const [, ...rest] = Buffer.from(next!, 'base64url').toString('utf8').split('|');
    return Buffer.from([stamp, ...rest].join('|')).toString('base64url');
  };

  it('refuses a cursor whose stamp is shaped right and names no instant', async () => {
    for (const stamp of [
      '2026-02-30T10:00:00.000000Z',
      '2026-13-01T10:00:00.000000Z',
      '2026-09-01T24:00:00.000000Z',
      '0000-09-01T10:00:00.000000Z',
    ]) {
      const res = await approve(db, idp, list({ limit: '1', cursor: await forged(stamp) }));
      expect([stamp, res.statusCode, res.body]).toEqual([
        stamp,
        400,
        '{"error":"invalid_request"}',
      ]);
    }
  });

  it('takes a forged cursor whose stamp is a real instant, so the refusal above is the date', async () => {
    const res = await approve(
      db,
      idp,
      list({ limit: '1', cursor: await forged('2026-09-01T10:00:00.000000Z') }),
    );
    expect(res.statusCode).toBe(200);
  });

  // AIP-158: a page token is refused when the request's other parameters changed.
  it('refuses a cursor carried to another status filter', async () => {
    const { next } = page((await approve(db, idp, list({ status: 'pending', limit: '1' }))).body);
    const res = await approve(db, idp, list({ status: 'active', cursor: next! }));
    expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
    const unfiltered = await approve(db, idp, list({ cursor: next! }));
    expect([unfiltered.statusCode, unfiltered.body]).toEqual([400, '{"error":"invalid_request"}']);
    const { next: whole } = page((await approve(db, idp, list({ limit: '1' }))).body);
    const narrowed = await approve(db, idp, list({ status: 'pending', cursor: whole! }));
    expect([narrowed.statusCode, narrowed.body]).toEqual([400, '{"error":"invalid_request"}']);
  });

  it('takes one spelling of a cursor', async () => {
    const { next } = page((await approve(db, idp, list({ limit: '1' }))).body);
    for (const variant of [`${next}==`, `${next!.slice(0, 4)}!${next!.slice(4)}`]) {
      const res = await approve(db, idp, list({ limit: '1', cursor: variant }));
      expect([variant, res.statusCode]).toEqual([variant, 400]);
    }
  });

  it('takes 100 rows at the ceiling', async () => {
    const res = await approve(db, idp, list({ limit: '100' }));
    expect(res.statusCode).toBe(200);
    expect(page(res.body).users).toHaveLength(5);
  });
});

describe('the gate: the same four refusals approve and reject give', () => {
  it('refuses an ordinary active caller', async () => {
    await db.exec(insert(OUTSIDER, 'outsider@quirenote.com', 'active', SAME_DAY));
    const res = await approve(db, idp, list(undefined, token(OUTSIDER, 'outsider@quirenote.com')));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"forbidden"}']);
  });

  it('refuses a caller whose own row is pending', async () => {
    await db.exec(insert(A, 'a@quirenote.com', 'pending', SAME_DAY));
    const res = await approve(db, idp, list(undefined, token(OUTSIDER, 'a@quirenote.com')));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"pending"}']);
  });

  it('refuses a caller whose own row was rejected', async () => {
    await db.exec(insert(OUTSIDER, 'outsider@quirenote.com', 'rejected', SAME_DAY));
    const res = await approve(db, idp, list(undefined, token(OUTSIDER, 'outsider@quirenote.com')));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"rejected"}']);
  });

  it('refuses a caller with no application at all', async () => {
    const res = await approve(db, idp, list(undefined, token(OUTSIDER, 'nobody@quirenote.com')));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"no_application"}']);
  });
});

describe('a failing list answers 500 and logs no address', () => {
  it('logs the failure by its code, never the message or detail the cluster wrote', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const leak = Object.assign(
      new Error('duplicate key value violates unique constraint: Key (email)=(leak@quirenote.com)'),
      { code: '23505', detail: 'Key (email)=(leak@quirenote.com) already exists.' },
    );
    const res = await approve(failingOn('ORDER BY', leak), idp, list());
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);

    const written = [...error.mock.calls, ...warn.mock.calls, ...log.mock.calls].map((args) =>
      args
        .map((a) => (a instanceof Error ? `${a.message} ${JSON.stringify(a)}` : String(a)))
        .join(' '),
    );
    expect(written.length).toBeGreaterThan(0);
    expect(written.filter((line) => line.includes('@'))).toEqual([]);
    expect(written.some((line) => line.includes('23505'))).toBe(true);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 20 });
