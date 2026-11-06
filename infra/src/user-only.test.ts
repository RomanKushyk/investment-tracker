// The super-admin holds no portfolio (*Auth model*): read from the template, so a new route on either
// function is refused it here until the allow-list names it, and driven through each bundled handler.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { userDb } from './__fixtures__/pglite';
import { insertUser } from './__fixtures__/user-ledger';
import { TERMS_ROUTE } from './accept-terms';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import { ACCOUNT_ROUTE, ME_ROUTE } from './me';
import { handler as mutations } from './mutations';
import { SETTINGS_ROUTE } from './settings';
import { handler as view } from './view';

// The view's rate reader binds `fetch` as its module loads, and a user's read past the gate asks NBU.
vi.hoisted(() => {
  vi.stubGlobal('fetch', async () => {
    throw new Error('no network in a unit test');
  });
});

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

/** The routes a super-admin still reaches on these functions, each for the account, not a portfolio. */
const ACCOUNT: Record<string, string> = {
  [SETTINGS_ROUTE]: 'the language and the nav groups the shell keeps',
  [ME_ROUTE]: 'the role every load reads to pick the shell',
  [ACCOUNT_ROUTE]: 'the profile, the counts of its dataset included',
  [TERMS_ROUTE]: 'the terms the gate asks every role to accept',
};

/** Each function's entry, by the module its template `Handler` names. */
const HANDLERS: Record<string, (event: ApiEvent) => Promise<ApiResult | EmptyResult>> = {
  mutations,
  view,
};

type Event = {
  Type?: string;
  Properties?: { Method?: string; Path?: string; Auth?: { Authorizer?: string } };
};
type Resource = { Type: string; Properties?: { Handler?: string; Events?: Record<string, Event> } };

const template = parseDocument(
  readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8'),
).toJS() as { Resources: Record<string, Resource> };

/** Every route behind the authorizer on the functions above, with the module that serves it. */
const served = Object.values(template.Resources)
  .filter((r) => r.Type === 'AWS::Serverless::Function')
  .map((r) => ({ r, module: r.Properties?.Handler?.replace(/\.handler$/, '') ?? '' }))
  .filter(({ module }) => module in HANDLERS)
  .flatMap(({ r, module }) =>
    Object.values(r.Properties?.Events ?? {})
      .filter((e) => e.Type === 'HttpApi' && e.Properties?.Auth?.Authorizer === 'CognitoJwt')
      .map((e) => ({ key: `${e.Properties?.Method} ${e.Properties?.Path}`, module })),
  );
const portfolio = served.filter((r) => !(r.key in ACCOUNT));

const ADMIN = '9f1e2d3c-0000-4000-8000-0000000000a1';
const ADMIN_EMAIL = 'admin@quirenote.com';
const USER = '9f1e2d3c-0000-4000-8000-0000000000b2';
const USER_EMAIL = 'user@quirenote.com';

/** A request the route would take, as far as anything ahead of the gate reads it. */
const request = (key: string, sub: string, email: string): ApiEvent => ({
  routeKey: key,
  pathParameters: { id: '9f1e2d3c-0000-4000-8000-0000000000d8', part: '1' },
  headers: { 'content-type': 'application/json' },
  body: '{}',
  requestContext: { authorizer: { jwt: { claims: { token_use: 'id', sub, email } } } },
});

const call = async ({ key, module }: { key: string; module: string }, sub: string, email: string) =>
  (await HANDLERS[module](request(key, sub, email))) as ApiResult;

let db: PGlite;

beforeEach(async () => {
  db = await userDb();
  await insertUser(db, ADMIN, ADMIN_EMAIL, 'active', 'super_admin');
  await insertUser(db, USER, USER_EMAIL);
  vi.mocked(connect).mockResolvedValue({
    query: (text: string, values?: unknown[]) => db.query(text, values),
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  // A route past the gate may log what it could not do with a request built only to reach it.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.mocked(connect).mockReset();
  vi.restoreAllMocks();
});

describe('the portfolio routes refuse the super-admin, route by route', () => {
  it('names in the allow-list only routes these functions serve', () => {
    const keys = served.map((r) => r.key);
    expect(Object.keys(ACCOUNT).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it('finds portfolio routes on both functions', () => {
    expect([...new Set(portfolio.map((r) => r.module))].sort()).toEqual(
      Object.keys(HANDLERS).sort(),
    );
  });

  for (const route of portfolio) {
    describe(route.key, () => {
      it('answers an active super-admin forbidden', async () => {
        const res = await call(route, ADMIN, ADMIN_EMAIL);
        expect([res.statusCode, res.body]).toEqual([403, '{"error":"forbidden"}']);
      });

      it('lets the same request from an active user past the gate', async () => {
        const res = await call(route, USER, USER_EMAIL);
        expect('body' in res ? res.body : undefined).not.toBe('{"error":"forbidden"}');
      });
    });
  }

  for (const key of Object.keys(ACCOUNT)) {
    it(`lets an active super-admin past the gate on ${key}`, async () => {
      const route = served.find((r) => r.key === key)!;
      const res = await call(route, ADMIN, ADMIN_EMAIL);
      expect('body' in res ? res.body : undefined).not.toBe('{"error":"forbidden"}');
    });
  }
});
