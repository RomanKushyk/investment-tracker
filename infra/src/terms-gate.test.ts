// Every route behind the authorizer answers `terms` to an active caller whose row holds no terms
// version, except the one that records the acceptance and the account's deletion, which waits on no
// acceptance (*Legal documents*). WRITTEN OUT, and held
// equal to the template: a route added there fails here until it is placed in one list or the other.
// Driven through each function's bundled handler, so a handler that skips the gate fails too.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from 'yaml';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser } from './__fixtures__/user-ledger';
import { handler as approve } from './approve';
import { handler as archiveAdmin } from './archive-admin';
import { handler as archiveOperations } from './archive-operations';
import { handler as deletion } from './deletion';
import { connect } from './dsql';
import type { ApiEvent, ApiResult, EmptyResult } from './http';
import { handler as mutations } from './mutations';
import { handler as view } from './view';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const REFUSED = [
  'GET /admin/users',
  'POST /admin/users/{id}/approve',
  'POST /admin/users/{id}/reject',
  'GET /admin/archive/diagnosis',
  'POST /admin/archive/operations',
  'GET /admin/archive/operations',
  'GET /admin/archive/operations/{id}',
  'GET /view',
  'GET /view/series',
  'GET /view/balances',
  'GET /view/day',
  'POST /mutations',
  'GET /state',
  'POST /imports',
  'PUT /imports/{id}/parts/{part}',
  'POST /imports/{id}/commit',
  'DELETE /imports/{id}',
  'PATCH /me/settings',
  'GET /me',
];
const EXEMPT = ['POST /me/terms', 'POST /me/deletion'];

type Event = {
  Type?: string;
  Properties?: { Method?: string; Path?: string; Auth?: { Authorizer?: string } };
};
type Resource = { Type: string; Properties?: { Handler?: string; Events?: Record<string, Event> } };

const template = parseDocument(
  readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8'),
).toJS() as { Resources: Record<string, Resource> };

/** Every route behind the JWT authorizer, with the module its function's handler lives in. */
const gated = Object.values(template.Resources)
  .filter((r) => r.Type === 'AWS::Serverless::Function')
  .flatMap((r) =>
    Object.values(r.Properties?.Events ?? {})
      .filter((e) => e.Type === 'HttpApi' && e.Properties?.Auth?.Authorizer === 'CognitoJwt')
      .map((e) => ({
        key: `${e.Properties?.Method} ${e.Properties?.Path}`,
        module: r.Properties!.Handler!.replace(/\.handler$/, ''),
      })),
  );

const SUB = '9f1e2d3c-0000-4000-8000-0000000000c7';
const EMAIL = 'unaccepted@quirenote.com';

/** A request the route would take, as far as anything ahead of the gate reads it. */
const request = (key: string): ApiEvent => ({
  routeKey: key,
  pathParameters: { id: '9f1e2d3c-0000-4000-8000-0000000000d8', part: '1' },
  headers: { 'content-type': 'application/json' },
  body: '{}',
  requestContext: {
    authorizer: {
      jwt: { claims: { token_use: 'id', sub: SUB, email: EMAIL, email_verified: 'true' } },
    },
  },
});

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  vi.mocked(connect).mockResolvedValue({
    query: (text: string, values?: unknown[]) => db.query(text, values),
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
});

afterEach(() => {
  vi.mocked(connect).mockReset();
});

/** Each function's entry, by the module its template `Handler` names. */
const HANDLERS: Record<string, (event: ApiEvent) => Promise<ApiResult | EmptyResult>> = {
  approve,
  'archive-admin': archiveAdmin,
  'archive-operations': archiveOperations,
  deletion,
  mutations,
  view,
};

const call = async ({ key, module }: { key: string; module: string }) =>
  (await HANDLERS[module](request(key))) as ApiResult;

describe('the terms gate, route by route', () => {
  it('lists every route the template puts behind the authorizer, once', () => {
    expect(gated.map((r) => r.key).sort()).toEqual([...REFUSED, ...EXEMPT].sort());
  });

  it('reaches every function those routes name', () => {
    expect([...new Set(gated.map((r) => r.module))].sort()).toEqual(Object.keys(HANDLERS).sort());
  });

  for (const role of ['user', 'super_admin']) {
    describe(`an active ${role} whose row holds no version`, () => {
      beforeEach(async () => {
        await insertUser(db, SUB, EMAIL, 'active', role, { terms: false });
      });

      for (const key of REFUSED) {
        it(`is answered terms on ${key}`, async () => {
          const res = await call(gated.find((r) => r.key === key)!);
          expect([res.statusCode, res.body]).toEqual([403, '{"error":"terms"}']);
        });
      }

      for (const key of EXEMPT) {
        it(`is not answered terms on ${key}`, async () => {
          const res = await call(gated.find((r) => r.key === key)!);
          expect(res.body).not.toBe('{"error":"terms"}');
        });
      }
    });
  }
});
