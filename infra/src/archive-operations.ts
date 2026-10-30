// `/admin/archive/operations`: the capture's `observe` and `importFundHistory`, started for the
// super-admin as operations a Step Functions workflow runs, and read back one at a time or as a
// list. A start is recorded before it is handed on, and a body the capture would refuse or misread
// never lands. Production's alone: where no state machine exists a start answers 405. [*Cloud target*]
import { randomUUID } from 'node:crypto';

import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { z } from 'zod';

import { FUND_REFS, SOURCE } from '@quirenote/core/archive';
import { DEFAULT_LIMIT, LIMIT, MAX_LIMIT, STAMPED, instant } from './admin-users';
import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED,
  TERMS,
  authorize,
  superAdminOnly,
} from './authorize';
import type { HandlerEvent } from './capture';
import { connect } from './dsql';
import {
  INTERNAL,
  INVALID,
  TOO_LARGE,
  type ApiEvent,
  type ApiResult,
  type Declared,
  canonicalUuid,
  derived,
  json,
  readJson,
  respond,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';

export const START_ROUTE = 'POST /admin/archive/operations';
export const OPERATIONS_ROUTE = 'GET /admin/archive/operations';
export const OPERATION_ROUTE = 'GET /admin/archive/operations/{id}';

/** The state machine's own timeout, which `template-user.yaml` sets and a test holds to this. */
export const RUN_TIMEOUT_SECONDS = 1200;
/** A minute past the run's timeout, so a recorder finishes no run past it: a run still going past
 *  it reads `failed`, reason `deadline_exceeded`, as a Kubernetes Job past `activeDeadlineSeconds`
 *  does. */
export const DEADLINE_SECONDS = RUN_TIMEOUT_SECONDS + 60;

/** THE ONE SCHEMA, built from the capture's own tables: the sources it writes and the funds it
 *  imports, so the API takes no source or ref the capture would refuse, and no key it would read.
 *  A calendar day where the capture checks only the shape, which would roll 2026-02-30 into March,
 *  and never year 0000, which Postgres does not have. */
const DAY = z.iso.date().regex(/^(?!0000)/);
const START = z.discriminatedUnion('mode', [
  z
    .strictObject({
      mode: z.literal('observe'),
      source: z.enum(SOURCE),
      from: DAY,
      to: DAY,
    })
    // The capture reads a reversed range as an empty window and reports it complete.
    .refine((b) => b.from <= b.to, {
      path: ['to'],
      message: 'to before from',
      // Only over two real days: a bound already refused needs no second reason.
      when: (payload) => payload.issues.length === 0,
    }),
  z.strictObject({
    mode: z.literal('importFundHistory'),
    // Each fund once: the capture would fetch a repeat again only to write nothing.
    refs: z
      .array(z.enum(FUND_REFS))
      .min(1)
      .refine((refs) => new Set(refs).size === refs.length, 'each fund once')
      .meta({ uniqueItems: true }),
  }),
]);
type Start = z.infer<typeof START>;

/** The capture's event for a start, typed as the capture reads it; `scheduled` is never set, so a
 *  run here counts toward no scheduled-run alarm. */
const eventOf = (start: Start): { event: HandlerEvent; parameters: object } => {
  if (start.mode === 'observe') {
    const parameters = { source: start.source, from: start.from, to: start.to };
    return { event: { observe: parameters }, parameters };
  }
  const parameters = { refs: start.refs };
  return { event: { importFundHistory: parameters }, parameters };
};

/** The body the document publishes, made from the schema the route checks. */
export const START_BODY = {
  required: true,
  content: {
    'application/json': { schema: z.toJSONSchema(START, { target: 'openapi-3.0' }) },
  },
};

/** The start as Step Functions takes it, narrowed to what this route sends. */
export type ExecutionClient = {
  start(input: { stateMachineArn: string; name: string; input: string }): Promise<unknown>;
};

const OPERATION = {
  id: '<operation id>',
  mode: 'observe',
  parameters: { source: 'nbu_fv', from: '2026-01-01', to: '2026-01-31' },
  state: 'succeeded',
  startedBy: '<super-admin user id>',
  startedAt: '2026-10-21T09:00:00.000000Z',
  deadlineAt: '2026-10-21T09:21:00.000000Z',
  finishedAt: '2026-10-21T09:00:04.000000Z',
  result: { mode: 'observe', written: 0, complete: true, nextFrom: null },
  error: null,
};

/** RFC 9110 §15.3.3: accepted, with the operation as its status monitor and a Location to it. */
const ACCEPTED = derived({
  statusCode: 202,
  name: 'accepted',
  headers: ['location'],
  example: { ...OPERATION, state: 'running', finishedAt: null, result: null },
});
/** RFC 9110 §10.2.1: a method "disabled by configuration" answers 405 with what the resource still
 *  allows; dev deploys no state machine, and its list and read still answer. */
const PROD_ONLY = derived({
  statusCode: 405,
  name: 'operations_prod_only',
  headers: ['allow'],
  example: { error: 'operations_prod_only' },
});
/** A body the route reads and the capture would refuse, each field named. */
const INVALID_OPERATION = derived({
  statusCode: 422,
  name: 'invalid_operation',
  headers: [],
  example: { error: 'invalid_operation', issues: [{ field: 'refs.0', code: 'invalid_value' }] },
});
/** RFC 9110 §15.6.3: the start was refused; the run is recorded failed when that record lands. */
const START_FAILED = json(502, '{"error":"start_failed"}');
const LISTED = derived({
  statusCode: 200,
  name: 'operations',
  headers: [],
  example: { operations: [OPERATION], next: '<opaque cursor, present only when more follow>' },
});
const READ = derived({ statusCode: 200, name: 'operation', headers: [], example: OPERATION });
const NOT_FOUND = json(404, '{"error":"not_found"}');

const GATE = [PENDING, REJECTED, NO_APPLICATION, FORBIDDEN, TERMS];

/** What the routes can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `archive-operations.test.ts` proves it against what the routes really answer. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [START_ROUTE]: [
    ACCEPTED,
    ...GATE,
    PROD_ONLY,
    INVALID,
    TOO_LARGE,
    INVALID_OPERATION,
    START_FAILED,
    INTERNAL,
  ],
  [OPERATIONS_ROUTE]: [LISTED, ...GATE, INVALID, INTERNAL],
  [OPERATION_ROUTE]: [READ, ...GATE, INVALID, NOT_FOUND, INTERNAL],
};

/** What the list may carry, for the document. None is required. */
export const PARAMETERS = {
  [OPERATIONS_ROUTE]: [
    {
      name: 'limit',
      in: 'query' as const,
      required: false,
      description: `Operations per page, digits with no sign or leading zero; none is ${DEFAULT_LIMIT}.`,
      schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
    {
      name: 'cursor',
      in: 'query' as const,
      required: false,
      description: 'The previous page’s `next`; none starts at the newest.',
      schema: { type: 'string' },
    },
  ],
};

/** Every stamp is the cluster's `now()`, the clock 017's order rules compare. The stamps come back
 *  here, so the 202 is built from the record and nothing is read once the run is handed on. */
const INSERT = `INSERT INTO archive_operation
                  (id, started_by, started_at, deadline_at, mode, parameters, state)
                VALUES ($1, $2, now(), now() + interval '${DEADLINE_SECONDS} seconds', $3, $4,
                        'running')
                RETURNING to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                            AS started_at,
                          to_char(deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                            AS deadline_at`;

/** A REFUSAL IS CERTAIN ONLY TWO WAYS: Step Functions answered below 500 (a client fault), or the
 *  credentials let nothing be sent. Any other failure may have begun the run — a timeout, a fault
 *  of the service's own, a dropped connection, an answer that could not be read. */
const refused = (err: unknown): boolean => {
  const e = err as { name?: unknown; $fault?: unknown };
  return e.$fault === 'client' || e.name === 'CredentialsProviderError';
};

const START_REFUSED = `UPDATE archive_operation
                          SET state = 'failed', error_reason = 'start_failed',
                              error_message = $2, finished_at = now()
                        WHERE id = $1 AND state = 'running'`;

/** ONE READ FOR ONE OPERATION AND FOR A PAGE, so the deadline is applied in one place: a run still
 *  going past its deadline reads failed. Stamps as microsecond text, which the cursor carries; the
 *  sort keys name the table, or `started_at` resolves to the text alias (`order-by-alias.test.ts`). */
const READ_OPERATIONS = `SELECT id, mode, parameters, started_by,
                                to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                  AS started_at,
                                to_char(deadline_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                  AS deadline_at,
                                to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                                  AS finished_at,
                                CASE WHEN state = 'running' AND now() > deadline_at THEN 'failed'
                                     ELSE state END AS state,
                                result,
                                CASE WHEN state = 'running' AND now() > deadline_at
                                     THEN 'deadline_exceeded' ELSE error_reason END AS error_reason,
                                error_message
                           FROM archive_operation
                          WHERE ($1::uuid IS NULL OR archive_operation.id = $1::uuid)
                            AND ($2::timestamptz IS NULL
                                 OR archive_operation.started_at < $2::timestamptz
                                 OR (archive_operation.started_at = $2::timestamptz
                                     AND archive_operation.id < $3::uuid))
                          ORDER BY archive_operation.started_at DESC, archive_operation.id DESC
                          LIMIT $4`;

type Row = {
  id: string;
  mode: string;
  parameters: string;
  started_by: string;
  started_at: string;
  deadline_at: string;
  finished_at: string | null;
  state: string;
  result: string | null;
  error_reason: string | null;
  error_message: string | null;
};

const operationOf = (r: Row) => ({
  id: r.id,
  mode: r.mode,
  parameters: JSON.parse(r.parameters) as unknown,
  state: r.state,
  startedBy: r.started_by,
  startedAt: r.started_at,
  deadlineAt: r.deadline_at,
  finishedAt: r.finished_at,
  result: r.result === null ? null : (JSON.parse(r.result) as unknown),
  error: r.error_reason === null ? null : { reason: r.error_reason, message: r.error_message },
});

const read = (client: SqlClient, values: [string | null, string | null, string | null, number]) =>
  client.query<Row>(READ_OPERATIONS, values);

/** Each issue by the field it names; a key the schema does not take names itself. */
const issuesOf = (error: z.ZodError) =>
  error.issues.flatMap((issue): { field: string; code: string }[] =>
    issue.code === 'unrecognized_keys'
      ? issue.keys.map((key) => ({
          field: [...issue.path, key].map(String).join('.'),
          code: issue.code,
        }))
      : [{ field: issue.path.map(String).join('.'), code: issue.code }],
  );

async function start(
  client: SqlClient,
  sfn: ExecutionClient,
  event: ApiEvent,
  actor: string,
): Promise<ApiResult> {
  const stateMachineArn = process.env.STATE_MACHINE_ARN;
  if (!stateMachineArn)
    return respond(PROD_ONLY, { allow: 'GET' }, '{"error":"operations_prod_only"}');

  const body = readJson(event);
  if (!('value' in body)) return body;
  const parsed = START.safeParse(body.value);
  if (!parsed.success) {
    const issues = issuesOf(parsed.error);
    return respond(INVALID_OPERATION, {}, JSON.stringify({ error: 'invalid_operation', issues }));
  }

  const { event: capture, parameters } = eventOf(parsed.data);
  const id = randomUUID();
  const recorded = await client.query<{ started_at: string; deadline_at: string }>(INSERT, [
    id,
    actor,
    parsed.data.mode,
    JSON.stringify(parameters),
  ]);
  try {
    // Named by the operation, so the execution and its record are found by one id.
    await sfn.start({
      stateMachineArn,
      name: id,
      input: JSON.stringify({ operationId: id, event: capture }),
    });
  } catch (err) {
    const name = String((err as { name?: unknown }).name ?? 'Error');
    // A START NOT CERTAINLY REFUSED MAY HAVE BEGUN, so it is a 202 like any other, its record left
    // to the recorder or the deadline (RFC 9110 §15.3.3).
    if (refused(err)) {
      console.error(`archive-operations: the start was refused (${name})`);
      // Still the declared answer when the record fails: the run reads failed at its deadline.
      await client
        .query(START_REFUSED, [id, name])
        .catch((e: unknown) =>
          console.error('archive-operations: the refused start was not recorded', loggable(e)),
        );
      return START_FAILED;
    }
    console.error(`archive-operations: the start's answer was lost (${name})`);
  }
  const [stamps] = recorded.rows;
  const operation = operationOf({
    id,
    mode: parsed.data.mode,
    parameters: JSON.stringify(parameters),
    started_by: actor,
    started_at: stamps.started_at,
    deadline_at: stamps.deadline_at,
    finished_at: null,
    state: 'running',
    result: null,
    error_reason: null,
    error_message: null,
  });
  return respond(
    ACCEPTED,
    { location: `/admin/archive/operations/${id}` },
    JSON.stringify(operation),
  );
}

type After = { startedAt: string; id: string };

const encode = ({ startedAt, id }: After): string =>
  Buffer.from(`${startedAt}|${id}`).toString('base64url');

/** Refused unless it is exactly what `encode` writes, as the users list refuses one. */
const decode = (cursor: string): After | undefined => {
  const [startedAt, id, extra] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const uuid = canonicalUuid(id);
  if (extra !== undefined || !uuid || !STAMPED.test(startedAt) || !instant(startedAt))
    return undefined;
  const after = { startedAt, id: uuid };
  return encode(after) === cursor ? after : undefined;
};

async function list(client: SqlClient, event: ApiEvent): Promise<ApiResult> {
  const { limit, cursor } = event.queryStringParameters ?? {};
  if (limit !== undefined && !(LIMIT.test(limit) && Number(limit) <= MAX_LIMIT)) return INVALID;
  const after = cursor === undefined ? null : decode(cursor);
  if (after === undefined) return INVALID;
  const size = limit === undefined ? DEFAULT_LIMIT : +limit;
  const { rows } = await read(client, [
    null,
    after?.startedAt ?? null,
    after?.id ?? null,
    size + 1,
  ]);
  const page = rows.slice(0, size);
  const last = page[size - 1];
  const next =
    rows.length > size ? { next: encode({ startedAt: last.started_at, id: last.id }) } : {};
  return respond(LISTED, {}, JSON.stringify({ operations: page.map(operationOf), ...next }));
}

async function readOne(client: SqlClient, event: ApiEvent): Promise<ApiResult> {
  // Folded first: a `uuid` column compares canonically, and the answer carries the id as stored.
  const id = canonicalUuid(event.pathParameters?.id);
  if (id === undefined) return INVALID;
  const { rows } = await read(client, [id, null, null, 1]);
  return rows[0] === undefined
    ? NOT_FOUND
    : respond(READ, {}, JSON.stringify(operationOf(rows[0])));
}

export async function operations(
  client: SqlClient,
  sfn: ExecutionClient,
  event: ApiEvent,
): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as approve's is: `authorize` reads the
  // cluster, and a throw past `handler` reaches the caller as API Gateway's own 502.
  try {
    // THE GATE FIRST: nothing is read, recorded or started for a caller the row does not admit.
    const gate = superAdminOnly(await authorize(client, event));
    if ('refusal' in gate) return gate.refusal;

    if (event.routeKey === START_ROUTE) return await start(client, sfn, event, gate.caller.userId);
    if (event.routeKey === OPERATIONS_ROUTE) return await list(client, event);
    if (event.routeKey === OPERATION_ROUTE) return await readOne(client, event);
    return INVALID;
  } catch (err) {
    console.error('archive-operations failed', loggable(err));
    return INTERNAL;
  }
}

// ONE ATTEMPT: a retry of a start whose answer was lost could meet the run it began, as
// `ExecutionAlreadyExists`, and read as a refusal. The handler only warns at `requestTimeout`
// unless told to throw.
const stepFunctions = new SFNClient({
  maxAttempts: 1,
  requestHandler: { requestTimeout: 5_000, throwOnRequestTimeout: true },
});
const sdk: ExecutionClient = {
  start: (input) => stepFunctions.send(new StartExecutionCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  const client = await connect().catch((err: unknown) => {
    console.error('archive-operations connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await operations(client, sdk, event);
  } finally {
    await client
      .end()
      .catch((err: unknown) => console.error('archive-operations disconnect failed', err));
  }
}
