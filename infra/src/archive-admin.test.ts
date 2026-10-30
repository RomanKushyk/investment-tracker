// The archive's `diagnose` read on the user API: the gate first, then one synchronous invoke of
// the capture function, whose answer passes through unchanged.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION } from '@quirenote/core/terms';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  type CaptureClient,
  DIAGNOSIS_ROUTE,
  RESPONSES,
  diagnosis as diagnosisRoute,
} from './archive-admin';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

const { observed, record } = recorder(DIAGNOSIS_ROUTE);

const diagnosis = async (
  ...args: Parameters<typeof diagnosisRoute>
): ReturnType<typeof diagnosisRoute> => record(args[2], await diagnosisRoute(...args));

const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const CAPTURE = 'quirenote-backend-CaptureFunction-EXAMPLE';
const ADMIN = '9f1e2d3c-0000-4000-8000-00000000ad11';
const ADMIN_EMAIL = 'owner@quirenote.com';
const OUTSIDER = '9f1e2d3c-0000-4000-8000-00000000ab1e';
const OUTSIDER_EMAIL = 'outsider@quirenote.com';

/** The capture's answer as it leaves the function: its own key order and spacing, which a
 *  re-serialisation would change. */
const DIAGNOSED =
  '{"mode":"diagnose","size":{"rows":"3","payload_bytes":"120","total_bytes":"8192"},' +
  '"bySource":[{"source":"nbu","n":"2","bytes":"80"}],' +
  '"observations":[{"instrument_ref":"UA4000236475","basis":"fair","source":"nbu","n":"71",' +
  '"before_capture":"0","publishedDays":"71","gaps":0,"emptyDays":null,"emptyDates":null}],' +
  '"sample":[],"instruments":[],"plans":{"observeNbu":["Seq Scan"]}}';

const token = (sub = ADMIN, email = ADMIN_EMAIL): ApiEvent['requestContext'] => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

// `null` for no claims at all: a default parameter fires on `undefined`, so that would sign in.
const read = (context: ApiEvent['requestContext'] | null = token()): ApiEvent => ({
  routeKey: DIAGNOSIS_ROUTE,
  ...(context === null ? {} : { requestContext: context }),
});

type Invoked = Parameters<CaptureClient['invoke']>[0];

/** Records every invoke, and answers what the test hands it. */
const spy = (answer: () => ReturnType<CaptureClient['invoke']>) => {
  const invoked: Invoked[] = [];
  const capture: CaptureClient = {
    invoke: (input) => {
      invoked.push(input);
      return answer();
    },
  };
  return { capture, invoked };
};

const answering = (payload: string, functionError?: string) =>
  spy(async () => ({
    Payload: new TextEncoder().encode(payload),
    ...(functionError === undefined ? {} : { FunctionError: functionError }),
  }));

const insert = (userId: string, email: string, status: string, role = 'user') =>
  status === 'pending'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '2026-08-01T09:00:00Z');`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by,
                             terms_version, terms_accepted_at)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '2026-08-01T09:00:00Z', now(),
                 '${ADMIN}',
                 '${TERMS_VERSION}', now());`;

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  await db.exec(insert(ADMIN, ADMIN_EMAIL, 'active', 'super_admin'));
  vi.stubEnv('CAPTURE_FUNCTION_NAME', CAPTURE);
  vi.stubEnv('OPEN_REGISTRATION', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the super-admin reads what diagnose returns', () => {
  it('answers the capture function’s body byte for byte', async () => {
    const { capture } = answering(DIAGNOSED);
    const res = await diagnosis(db, capture, read());
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.body).toBe(DIAGNOSED);
    const [group] = (JSON.parse(res.body) as { observations: Record<string, unknown>[] })
      .observations;
    expect([group.before_capture, group.gaps]).toEqual(['0', 0]);
  });

  it('invokes the named function once, synchronously, with the diagnose event and nothing else', async () => {
    const { capture, invoked } = answering(DIAGNOSED);
    await diagnosis(db, capture, read());
    expect(invoked).toEqual([{ FunctionName: CAPTURE, Payload: '{"diagnose":true}' }]);
  });
});

describe('the gate refuses before the capture function is invoked', () => {
  const refused: [string, () => Promise<ApiEvent>, string][] = [
    [
      'an ordinary active caller',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'active'));
        return read(token(OUTSIDER, OUTSIDER_EMAIL));
      },
      '{"error":"forbidden"}',
    ],
    [
      'a caller whose own row is pending',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'pending'));
        return read(token(OUTSIDER, OUTSIDER_EMAIL));
      },
      '{"error":"pending"}',
    ],
    [
      'a caller whose own row was rejected',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'rejected'));
        return read(token(OUTSIDER, OUTSIDER_EMAIL));
      },
      '{"error":"rejected"}',
    ],
    [
      'a super-admin whose row holds no terms version',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'active', 'super_admin'));
        await db.query(
          `UPDATE app_user SET terms_version = NULL, terms_accepted_at = NULL WHERE user_id = $1`,
          [OUTSIDER],
        );
        return read(token(OUTSIDER, OUTSIDER_EMAIL));
      },
      '{"error":"terms"}',
    ],
    [
      'a caller with no application at all',
      async () => read(token(OUTSIDER, 'nobody@quirenote.com')),
      '{"error":"no_application"}',
    ],
    ['an unauthenticated request', async () => read(null), '{"error":"forbidden"}'],
  ];

  for (const [who, event, body] of refused) {
    it(`refuses ${who}`, async () => {
      const { capture, invoked } = answering(DIAGNOSED);
      const res = await diagnosis(db, capture, await event());
      expect([res.statusCode, res.body]).toEqual([403, body]);
      expect(invoked).toEqual([]);
    });
  }
});

describe('a failed invocation answers a declared error', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('answers 502 when the capture function threw', async () => {
    const { capture } = answering(
      '{"errorType":"Error","errorMessage":"relation does not exist"}',
      'Unhandled',
    );
    const res = await diagnosis(db, capture, read());
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"capture_failed"}']);
  });

  it('answers 502 when the capture answered no payload', async () => {
    const { capture } = spy(async () => ({}));
    const res = await diagnosis(db, capture, read());
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"capture_failed"}']);
  });

  it('answers 502 when the invoke itself fails', async () => {
    const { capture } = spy(async () => {
      throw Object.assign(new Error('not authorized'), { name: 'AccessDeniedException' });
    });
    const res = await diagnosis(db, capture, read());
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"capture_failed"}']);
  });

  it('answers 504 when the invoke outruns its request timeout', async () => {
    const { capture } = spy(async () => {
      throw Object.assign(new Error('a request has exceeded the configured requestTimeout'), {
        name: 'TimeoutError',
      });
    });
    const res = await diagnosis(db, capture, read());
    expect([res.statusCode, res.body]).toEqual([504, '{"error":"capture_timeout"}']);
  });

  it('answers 500 when the function was deployed without the capture’s name', async () => {
    vi.stubEnv('CAPTURE_FUNCTION_NAME', '');
    const { capture, invoked } = answering(DIAGNOSED);
    const res = await diagnosis(db, capture, read());
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    expect(invoked).toEqual([]);
  });

  it('answers 500 when the gate cannot read the cluster', async () => {
    const broken: SqlClient = {
      query: async () => {
        throw new Error('connection reset');
      },
    };
    const { capture, invoked } = answering(DIAGNOSED);
    const res = await diagnosis(broken, capture, read());
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    expect(invoked).toEqual([]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 12 });
