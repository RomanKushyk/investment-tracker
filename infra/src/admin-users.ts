// `GET /admin/users`: every application but the demo, oldest first, with the id approve and reject
// take. Keyset-paged from the start (AIP-158), since a flood of applications is when it is read.
import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED } from './authorize';
import { codeOf } from './dsql';
import {
  INTERNAL,
  INVALID,
  type ApiEvent,
  type ApiResult,
  type Declared,
  canonicalUuid,
  derived,
  respond,
} from './http';
import type { SqlClient } from './migrate';

export const LIST_ROUTE = 'GET /admin/users';

const STATUSES = ['pending', 'active', 'rejected'] as const;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 100;

/** Five fields, named: `decided_by` is an audit note, and the rest of the row is the account's. */
const LISTED = derived({
  statusCode: 200,
  name: 'users',
  headers: [],
  example: {
    users: [
      {
        id: '<the id approve and reject take>',
        email: 'applicant@example.com',
        status: 'pending',
        appliedAt: '2026-10-06T08:15:00.000000Z',
        decidedAt: null,
      },
    ],
    next: '<opaque cursor, present only when more rows follow>',
  },
});

/** What the route can answer, and the only list of it — `openapi.ts` builds the document from
 *  here, and `admin-users.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [LIST_ROUTE]: [LISTED, PENDING, REJECTED, NO_APPLICATION, FORBIDDEN, INVALID, INTERNAL],
};

type Parameter = {
  name: string;
  in: 'query';
  required: boolean;
  description?: string;
  schema: { type: string; enum?: readonly string[]; minimum?: number; maximum?: number };
};
/** What the request may carry, for the document. None is required. */
export const PARAMETERS: Record<string, Parameter[]> = {
  [LIST_ROUTE]: [
    {
      name: 'status',
      in: 'query',
      required: false,
      description: 'Only the rows in this status; none lists every status.',
      schema: { type: 'string', enum: STATUSES },
    },
    {
      name: 'limit',
      in: 'query',
      required: false,
      description: `Rows per page, digits with no sign or leading zero; none is ${DEFAULT_LIMIT}.`,
      schema: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
    {
      name: 'cursor',
      in: 'query',
      required: false,
      description:
        'The previous page’s `next`, sent with the same `status`; none starts at the oldest.',
      schema: { type: 'string' },
    },
  ],
};

/** Stamps as microsecond text, since pg's Date keeps milliseconds and would misplace the cursor;
 *  both sort keys name the table, or `applied_at` resolves to the text alias (`order-by-alias.test.ts`). */
const LIST = `SELECT user_id, email, status,
                     to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                       AS applied_at,
                     to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
                       AS decided_at
                FROM app_user
               WHERE role <> 'demo'
                 AND ($1::text IS NULL OR status = $1::text)
                 AND ($2::timestamptz IS NULL
                      OR applied_at > $2::timestamptz
                      OR (applied_at = $2::timestamptz AND user_id > $3::uuid))
               ORDER BY app_user.applied_at, app_user.user_id
               LIMIT $4`;

type Row = {
  user_id: string;
  email: string;
  status: string;
  applied_at: string;
  decided_at: string | null;
};

/** The shape `LIST` writes. Year 0000 is refused here: the calendar check below takes it and the
 *  cluster does not. */
export const STAMPED = /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
/** One spelling per page size — digits, no sign, no leading zero — so one page has one URL. */
export const LIMIT = /^[1-9][0-9]*$/;

/** A real instant: a Date rolls `02-30` into March and `24:00` into the next day, so it is compared
 *  back to what was sent, to the millisecond it can hold. */
export const instant = (stamp: string): boolean => {
  const date = new Date(`${stamp.slice(0, 23)}Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString() === `${stamp.slice(0, 23)}Z`;
};

/** The cursor names the filter it was made under, and that filter ('' for none) is its third part. */
type After = { appliedAt: string; id: string; status: string };

const encode = ({ appliedAt, id, status }: After): string =>
  Buffer.from(`${appliedAt}|${id}|${status}`).toString('base64url');

/** Refused unless it is exactly what `encode` writes: base64url decodes leniently, so a padded or
 *  garbled spelling would otherwise name the same page twice. */
const decode = (cursor: string): After | undefined => {
  const [appliedAt, id, status] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const uuid = canonicalUuid(id);
  if (status === undefined || !uuid) return undefined;
  if (!STAMPED.test(appliedAt) || !instant(appliedAt)) return undefined;
  const after = { appliedAt, id: uuid, status };
  return encode(after) === cursor ? after : undefined;
};

type Query = { status: string | null; after: After | null; limit: number };

const queryOf = (event: ApiEvent): Query | ApiResult => {
  const { status, limit, cursor } = event.queryStringParameters ?? {};
  if (status !== undefined && !STATUSES.some((s) => s === status)) return INVALID;
  if (limit !== undefined && !(LIMIT.test(limit) && Number(limit) <= MAX_LIMIT)) return INVALID;
  const after = cursor === undefined ? null : decode(cursor);
  // AIP-158: a page token sent with another filter is refused, not read under it.
  if (after === undefined || (after !== null && after.status !== (status ?? ''))) return INVALID;
  return { status: status ?? null, after, limit: limit === undefined ? DEFAULT_LIMIT : +limit };
};

/** The list, for a caller the gate has already admitted as super-admin. Approve rekeys `user_id`, the
 *  tie-break, so a row approved mid-walk can repeat or drop: re-read from the start after a ruling. */
export async function listUsers(client: SqlClient, event: ApiEvent): Promise<ApiResult> {
  const query = queryOf(event);
  if ('statusCode' in query) return query;
  const { status, after, limit } = query;
  try {
    const { rows } = await client.query<Row>(LIST, [
      status,
      after?.appliedAt ?? null,
      after?.id ?? null,
      limit + 1,
    ]);
    const page = rows.slice(0, limit);
    const users = page.map((r) => ({
      id: r.user_id,
      email: r.email,
      status: r.status,
      appliedAt: r.applied_at,
      decidedAt: r.decided_at,
    }));
    const last = page[limit - 1];
    const next =
      rows.length > limit
        ? { next: encode({ appliedAt: last.applied_at, id: last.user_id, status: status ?? '' }) }
        : {};
    return respond(LISTED, {}, JSON.stringify({ users, ...next }));
  } catch (err) {
    // By its code alone: a cluster's message and `detail` can carry an address.
    console.error(`admin-users: the list failed (${codeOf(err) ?? 'no code'})`);
    return INTERNAL;
  }
}
