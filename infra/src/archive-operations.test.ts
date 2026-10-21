// The archive's operations on the user API: a start recorded and handed to the state machine, then
// read back, one or the whole list. The gate first; a body the capture would refuse never lands.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  DEADLINE_SECONDS,
  type ExecutionClient,
  OPERATIONS_ROUTE,
  OPERATION_ROUTE,
  RESPONSES,
  START_ROUTE,
  operations as operationsRoute,
} from './archive-operations';
import { record as recordOutcome } from './archive-recorder';
import type { ApiEvent, ApiResult } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

const { observed, record } = recorder(START_ROUTE);

const operations = async (
  ...args: Parameters<typeof operationsRoute>
): ReturnType<typeof operationsRoute> => record(args[2], await operationsRoute(...args));

const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const MACHINE =
  'arn:aws:states:eu-north-1:123456789012:stateMachine:quirenote-backend-user-prod-archive-operations';
const ADMIN = '9f1e2d3c-0000-4000-8000-00000000ad11';
const ADMIN_EMAIL = 'owner@quirenote.com';
const OUTSIDER = '9f1e2d3c-0000-4000-8000-00000000ab1e';
const OUTSIDER_EMAIL = 'outsider@quirenote.com';

const OBSERVE = { mode: 'observe', source: 'nbu_fv', from: '2026-01-01', to: '2026-01-31' };
const IMPORT = { mode: 'importFundHistory', refs: ['inzhur-reit', 'inzhur-energy'] };

const token = (sub = ADMIN, email = ADMIN_EMAIL): ApiEvent['requestContext'] => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});
type Context = ApiEvent['requestContext'] | null;
// `null` for no claims at all: a default parameter fires on `undefined`, so that would sign in.
const as = (context: Context) => (context === null ? {} : { requestContext: context });

const start = (body: unknown, context: Context = token()): ApiEvent => ({
  routeKey: START_ROUTE,
  body: typeof body === 'string' ? body : JSON.stringify(body),
  ...as(context),
});
const list = (query?: Record<string, string>, context: Context = token()): ApiEvent => ({
  routeKey: OPERATIONS_ROUTE,
  ...(query === undefined ? {} : { queryStringParameters: query }),
  ...as(context),
});
const readOne = (id: string, context: Context = token()): ApiEvent => ({
  routeKey: OPERATION_ROUTE,
  pathParameters: { id },
  ...as(context),
});

type Started = Parameters<ExecutionClient['start']>[0];

/** Records every start, and answers what the test hands it. */
const spy = (answer: () => Promise<unknown> = async () => ({})) => {
  const started: Started[] = [];
  const sfn: ExecutionClient = {
    start: (input) => {
      started.push(input);
      return answer();
    },
  };
  return { sfn, started };
};

const insert = (userId: string, email: string, status: string, role = 'user') =>
  status === 'pending'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '2026-08-01T09:00:00Z');`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '2026-08-01T09:00:00Z', now(),
                 '${ADMIN}');`;

const rows = async () =>
  (
    await db.query<{ id: string; state: string }>(
      `SELECT id, state FROM archive_operation ORDER BY started_at`,
    )
  ).rows;

const bodyOf = (res: ApiResult) => JSON.parse(res.body) as Record<string, unknown>;

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  await db.exec(insert(ADMIN, ADMIN_EMAIL, 'active', 'super_admin'));
  vi.stubEnv('STATE_MACHINE_ARN', MACHINE);
  vi.stubEnv('OPEN_REGISTRATION', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('a start is recorded, handed to the state machine and answered 202', () => {
  it('answers observe with a Location to the operation, which carries the start', async () => {
    const { sfn } = spy();
    const res = await operations(db, sfn, start(OBSERVE));
    expect(res.statusCode).toBe(202);
    const body = bodyOf(res);
    expect(res.headers.location).toBe(`/admin/archive/operations/${String(body.id)}`);
    expect(body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      mode: 'observe',
      parameters: { source: 'nbu_fv', from: '2026-01-01', to: '2026-01-31' },
      state: 'running',
      startedBy: ADMIN,
      startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      deadlineAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
      finishedAt: null,
      result: null,
      error: null,
    });
  });

  it('starts one execution named by the operation, carrying the capture’s own event and nothing else', async () => {
    const { sfn, started } = spy();
    const observe = bodyOf(await operations(db, sfn, start(OBSERVE)));
    const imported = bodyOf(await operations(db, sfn, start(IMPORT)));
    expect(started).toEqual([
      {
        stateMachineArn: MACHINE,
        name: observe.id,
        input: JSON.stringify({
          operationId: observe.id,
          event: { observe: { source: 'nbu_fv', from: '2026-01-01', to: '2026-01-31' } },
        }),
      },
      {
        stateMachineArn: MACHINE,
        name: imported.id,
        input: JSON.stringify({
          operationId: imported.id,
          event: { importFundHistory: { refs: ['inzhur-reit', 'inzhur-energy'] } },
        }),
      },
    ]);
  });

  it('records the actor, the parameters and a deadline its run cannot outlast, on the cluster’s clock', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(IMPORT)));
    const { rows: stored } = await db.query<Record<string, unknown>>(
      `SELECT started_by, mode, parameters, state,
              extract(epoch FROM deadline_at - started_at)::int AS window
         FROM archive_operation WHERE id = $1`,
      [id],
    );
    expect(stored).toEqual([
      {
        started_by: ADMIN,
        mode: 'importFundHistory',
        parameters: '{"refs":["inzhur-reit","inzhur-energy"]}',
        state: 'running',
        window: DEADLINE_SECONDS,
      },
    ]);
  });

  it('records a second identical start as a run of its own, with its own execution', async () => {
    const { sfn, started } = spy();
    const first = bodyOf(await operations(db, sfn, start(OBSERVE)));
    const second = bodyOf(await operations(db, sfn, start(OBSERVE)));
    expect(first.id).not.toBe(second.id);
    expect((await rows()).map((r) => r.id).sort()).toEqual([first.id, second.id].sort());
    expect(started.map((s) => s.name)).toEqual([first.id, second.id]);
  });
});

describe('the client reads the operation until it reports the mode’s own result', () => {
  it('reads running, then observe’s own result once the recorder has written it', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(OBSERVE)));
    const before = await operations(db, sfn, readOne(String(id)));
    expect([before.statusCode, bodyOf(before).state]).toEqual([200, 'running']);

    const result = { mode: 'observe', written: 0, complete: false, nextFrom: '2026-01-21' };
    await recordOutcome(db, { operationId: String(id), result });
    const after = bodyOf(await operations(db, sfn, readOne(String(id))));
    expect(after).toMatchObject({ state: 'succeeded', result, error: null });
    expect(after.finishedAt).toEqual(expect.stringMatching(/Z$/));
  });

  it('reads importFundHistory’s per-fund result', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(IMPORT)));
    const result = {
      mode: 'importFundHistory',
      funds: [{ ref: 'inzhur-reit', rows: 40, written: 0, from: '2026-05-01', to: '2026-10-20' }],
    };
    await recordOutcome(db, { operationId: String(id), result });
    expect(bodyOf(await operations(db, sfn, readOne(String(id))))).toMatchObject({
      state: 'succeeded',
      result,
    });
  });
});

describe('a run that failed reads as failed with the reason, and stays in the list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('reads a capture failure with the capture’s own message', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(IMPORT)));
    await recordOutcome(db, {
      operationId: String(id),
      error: {
        Error: 'Error',
        Cause: JSON.stringify({ errorType: 'Error', errorMessage: 'unknown fund ref: x' }),
      },
    });
    const one = bodyOf(await operations(db, sfn, readOne(String(id))));
    expect(one).toMatchObject({
      state: 'failed',
      result: null,
      error: { reason: 'capture_failed', message: 'unknown fund ref: x' },
    });
    const { operations: listed } = bodyOf(await operations(db, sfn, list())) as {
      operations: Record<string, unknown>[];
    };
    expect(listed).toEqual([one]);
  });

  it('reads a run still going past its deadline as failed, in the read and in the list', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(OBSERVE)));
    await db.query(
      `UPDATE archive_operation
          SET started_at = now() - interval '30 minutes', deadline_at = now() - interval '1 second'
        WHERE id = $1`,
      [id],
    );
    const one = bodyOf(await operations(db, sfn, readOne(String(id))));
    expect(one).toMatchObject({
      state: 'failed',
      finishedAt: null,
      error: { reason: 'deadline_exceeded', message: null },
    });
    const { operations: listed } = bodyOf(await operations(db, sfn, list())) as {
      operations: Record<string, unknown>[];
    };
    expect(listed).toEqual([one]);
  });

  /** What the SDK throws when Step Functions answered and refused: a client fault. */
  const refusedStart = () =>
    Object.assign(new Error('not authorized'), { name: 'AccessDeniedException', $fault: 'client' });

  it('answers 502 when Step Functions refuses the start, and records the run failed', async () => {
    const { sfn } = spy(async () => {
      throw refusedStart();
    });
    const res = await operations(db, sfn, start(OBSERVE));
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"start_failed"}']);
    const { operations: listed } = bodyOf(await operations(db, sfn, list())) as {
      operations: Record<string, unknown>[];
    };
    expect(listed).toMatchObject([
      { state: 'failed', error: { reason: 'start_failed', message: 'AccessDeniedException' } },
    ]);
  });

  it('still answers 502 when the refused start cannot be recorded, the run left to its deadline', async () => {
    const { sfn } = spy(async () => {
      throw refusedStart();
    });
    const failing = {
      query: (text: string, values?: unknown[]) =>
        text.includes("'start_failed'")
          ? Promise.reject(new Error('connection reset'))
          : db.query(text, values),
    } as SqlClient;
    const res = await operations(failing, sfn, start(OBSERVE));
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"start_failed"}']);
    expect((await rows()).map((r) => r.state)).toEqual(['running']);
  });

  // RFC 9110 §15.3.3: a 202 is accepted for processing that "might or might not eventually be acted
  // upon". A start whose answer never came may have begun, so the record is left to the run.
  it.each([
    [
      'a timeout',
      { name: 'TimeoutError', message: 'a request has exceeded the configured requestTimeout' },
    ],
    ['a server fault', { name: 'InternalFailure', $fault: 'server' }],
    ['a dropped connection', { name: 'Error', code: 'ECONNRESET' }],
    ['an answer that could not be read', { name: 'SyntaxError' }],
  ])(
    'answers 202 when the start’s answer is lost to %s, and leaves the run to its recorder or its deadline',
    async (_, error) => {
      const { sfn } = spy(async () => {
        throw Object.assign(new Error('lost'), error);
      });
      const res = await operations(db, sfn, start(OBSERVE));
      expect(res.statusCode).toBe(202);
      expect(bodyOf(res)).toMatchObject({ state: 'running', error: null });
      expect((await rows()).map((r) => r.state)).toEqual(['running']);
    },
  );

  // Raised before anything was sent: no run can have begun.
  it('answers 502 when the start fails before it is sent, and records the run failed', async () => {
    const { sfn } = spy(async () => {
      throw Object.assign(new Error('Could not load credentials'), {
        name: 'CredentialsProviderError',
      });
    });
    const res = await operations(db, sfn, start(OBSERVE));
    expect([res.statusCode, res.body]).toEqual([502, '{"error":"start_failed"}']);
    expect((await rows()).map((r) => r.state)).toEqual(['failed']);
  });

  // Nothing is read once the run is handed on, so a failing read cannot hide a run that began.
  it('answers 202 from what it recorded, reading nothing after the start', async () => {
    const { sfn, started } = spy();
    const reads: string[] = [];
    const watched = {
      query: (text: string, values?: unknown[]) => {
        if (started.length > 0) reads.push(text);
        return db.query(text, values);
      },
    } as SqlClient;
    const res = await operations(watched, sfn, start(OBSERVE));
    expect(res.statusCode).toBe(202);
    expect(reads).toEqual([]);
    const one = bodyOf(await operations(db, sfn, readOne(String(bodyOf(res).id))));
    expect(bodyOf(res)).toEqual(one);
  });
});

describe('the list is newest first and paged by a cursor', () => {
  const startedAt = async (id: unknown, at: string) =>
    db.query(`UPDATE archive_operation SET started_at = $2 WHERE id = $1`, [id, at]);

  it('answers every start, newest first, a page at a time', async () => {
    const { sfn } = spy();
    const ids: unknown[] = [];
    for (const at of ['2026-10-01T08:00:00Z', '2026-10-03T08:00:00Z', '2026-10-02T08:00:00Z']) {
      const { id } = bodyOf(await operations(db, sfn, start(OBSERVE)));
      await startedAt(id, at);
      ids.push(id);
    }
    const first = bodyOf(await operations(db, sfn, list({ limit: '2' })));
    const page1 = first.operations as { id: unknown }[];
    expect(page1.map((o) => o.id)).toEqual([ids[1], ids[2]]);
    expect(first.next).toEqual(expect.any(String));
    const second = bodyOf(
      await operations(db, sfn, list({ limit: '2', cursor: String(first.next) })),
    );
    expect((second.operations as { id: unknown }[]).map((o) => o.id)).toEqual([ids[0]]);
    expect(second).not.toHaveProperty('next');
  });

  it('answers an empty list when nothing was started', async () => {
    const { sfn } = spy();
    const res = await operations(db, sfn, list());
    expect([res.statusCode, res.body]).toEqual([200, '{"operations":[]}']);
  });

  it.each([
    ['a limit of 0', { limit: '0' }],
    ['a limit past 100', { limit: '101' }],
    ['a limit with a sign', { limit: '+5' }],
    ['a cursor that is not one', { cursor: 'not-a-cursor' }],
  ])('refuses %s', async (_, query) => {
    const { sfn } = spy();
    const res = await operations(db, sfn, list(query));
    expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
  });
});

describe('one operation reads by its id', () => {
  it('answers 404 for an id no start was given', async () => {
    const { sfn } = spy();
    const res = await operations(db, sfn, readOne('00000000-0000-4000-8000-000000000001'));
    expect([res.statusCode, res.body]).toEqual([404, '{"error":"not_found"}']);
  });

  it('answers 400 for an id that is not a uuid', async () => {
    const { sfn } = spy();
    const res = await operations(db, sfn, readOne('42'));
    expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
  });

  it('reads an id typed in capitals as the same operation', async () => {
    const { sfn } = spy();
    const { id } = bodyOf(await operations(db, sfn, start(OBSERVE)));
    const res = await operations(db, sfn, readOne(String(id).toUpperCase()));
    expect([res.statusCode, bodyOf(res).id]).toEqual([200, id]);
  });
});

describe('a body the capture would refuse or misread is refused before anything is recorded', () => {
  const refused: [string, unknown, { field: string; code: string }[]][] = [
    [
      'an unknown mode',
      { ...OBSERVE, mode: 'backfill' },
      [{ field: 'mode', code: 'invalid_union' }],
    ],
    [
      'an unknown source',
      { ...OBSERVE, source: 'nbu' },
      [{ field: 'source', code: 'invalid_value' }],
    ],
    [
      'an unknown fund ref',
      { ...IMPORT, refs: ['inzhur-reit', 'inzhur-retail'] },
      [{ field: 'refs.1', code: 'invalid_value' }],
    ],
    [
      'a ref Object.prototype holds',
      { ...IMPORT, refs: ['constructor'] },
      [{ field: 'refs.0', code: 'invalid_value' }],
    ],
    ['an empty ref list', { ...IMPORT, refs: [] }, [{ field: 'refs', code: 'too_small' }]],
    [
      'a fund named twice',
      { ...IMPORT, refs: ['inzhur-reit', 'inzhur-reit'] },
      [{ field: 'refs', code: 'custom' }],
    ],
    [
      'a from that is no calendar day',
      { ...OBSERVE, from: '2026-02-30' },
      [{ field: 'from', code: 'invalid_format' }],
    ],
    [
      'a to that is no calendar day',
      { ...OBSERVE, to: '2025-02-29' },
      [{ field: 'to', code: 'invalid_format' }],
    ],
    // Postgres has no year 0, and refuses the date the capture would bind.
    [
      'a year Postgres does not have',
      { ...OBSERVE, from: '0000-01-01' },
      [{ field: 'from', code: 'invalid_format' }],
    ],
    // The capture reads an empty window and reports it complete, as if already derived.
    [
      'a range that ends before it starts',
      { ...OBSERVE, from: '2026-03-01', to: '2026-01-01' },
      [{ field: 'to', code: 'custom' }],
    ],
    [
      'a missing bound',
      { mode: 'observe', source: 'inzhur', from: '2026-09-01' },
      [{ field: 'to', code: 'invalid_type' }],
    ],
    [
      'a key the capture would read',
      { ...OBSERVE, limit: 5 },
      [{ field: 'limit', code: 'unrecognized_keys' }],
    ],
    ['a body that is not an object', ['observe'], [{ field: '', code: 'invalid_type' }]],
  ];

  for (const [what, body, issues] of refused) {
    it(`refuses ${what} with the reason, recording and starting nothing`, async () => {
      const { sfn, started } = spy();
      const res = await operations(db, sfn, start(body));
      expect([res.statusCode, bodyOf(res)]).toEqual([422, { error: 'invalid_operation', issues }]);
      expect(await rows()).toEqual([]);
      expect(started).toEqual([]);
    });
  }

  it.each([
    ['a body that is not JSON', '{"mode":'],
    ['a __proto__ key, which a schema never sees', '{"mode":"observe","__proto__":{}}'],
  ])('refuses %s as a malformed request', async (_, body) => {
    const { sfn, started } = spy();
    const res = await operations(db, sfn, start(body));
    expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
    expect(await rows()).toEqual([]);
    expect(started).toEqual([]);
  });

  it('refuses a body past the bound before reading it', async () => {
    const { sfn, started } = spy();
    const res = await operations(db, sfn, start(`"${'x'.repeat(1024 * 1024)}"`));
    expect(res.statusCode).toBe(413);
    expect(started).toEqual([]);
  });
});

describe('the gate refuses before anything is recorded or started', () => {
  const callers: [string, () => Promise<Context>, string][] = [
    [
      'an ordinary active caller',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'active'));
        return token(OUTSIDER, OUTSIDER_EMAIL);
      },
      '{"error":"forbidden"}',
    ],
    [
      'a caller whose own row is pending',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'pending'));
        return token(OUTSIDER, OUTSIDER_EMAIL);
      },
      '{"error":"pending"}',
    ],
    [
      'a caller whose own row was rejected',
      async () => {
        await db.exec(insert(OUTSIDER, OUTSIDER_EMAIL, 'rejected'));
        return token(OUTSIDER, OUTSIDER_EMAIL);
      },
      '{"error":"rejected"}',
    ],
    [
      'a caller with no application at all',
      async () => token(OUTSIDER, 'nobody@quirenote.com'),
      '{"error":"no_application"}',
    ],
    ['an unauthenticated request', async () => null, '{"error":"forbidden"}'],
  ];
  const routes: [string, (context: Context) => ApiEvent][] = [
    ['a start', (context) => start(OBSERVE, context)],
    ['the list', (context) => list(undefined, context)],
    ['a read', (context) => readOne('00000000-0000-4000-8000-000000000001', context)],
  ];

  for (const [route, event] of routes)
    for (const [who, context, body] of callers) {
      it(`refuses ${route} to ${who}`, async () => {
        const { sfn, started } = spy();
        const res = await operations(db, sfn, event(await context()));
        expect([res.statusCode, res.body]).toEqual([403, body]);
        expect(await rows()).toEqual([]);
        expect(started).toEqual([]);
      });
    }

  for (const [route, event] of routes)
    it(`answers 500 on ${route} when the gate cannot read the cluster`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const broken: SqlClient = {
        query: async () => {
          throw new Error('connection reset');
        },
      };
      const { sfn, started } = spy();
      const res = await operations(broken, sfn, event(token()));
      expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
      expect(started).toEqual([]);
    });
});

describe('in an environment with no state machine, a start is refused and the reads still answer', () => {
  beforeEach(() => {
    vi.stubEnv('STATE_MACHINE_ARN', '');
  });

  it('answers 405 naming GET as what the collection allows, recording and starting nothing', async () => {
    const { sfn, started } = spy();
    const res = await operations(db, sfn, start(OBSERVE));
    expect([res.statusCode, res.headers.allow, res.body]).toEqual([
      405,
      'GET',
      '{"error":"operations_prod_only"}',
    ]);
    expect(await rows()).toEqual([]);
    expect(started).toEqual([]);
  });

  it('still lists, and still reads one', async () => {
    const { sfn } = spy();
    expect((await operations(db, sfn, list())).statusCode).toBe(200);
    const res = await operations(db, sfn, readOne('00000000-0000-4000-8000-000000000001'));
    expect(res.statusCode).toBe(404);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 40 });
