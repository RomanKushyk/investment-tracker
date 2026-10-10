// The staged import, S3's multipart upload in shape: a dataset too large for one transaction lands
// in parts that one pointer move commits (*Cloud target*, *User schema and deletes*).
import { createHash } from 'node:crypto';

import { rowIssueCodes, type RowIssueCode } from '@quirenote/core/backup/import';
import {
  assetRecordSchema,
  priceRowSchema,
  transactionRecordSchema,
} from '@quirenote/core/backup/json';
import { targetsAsset, type Asset, type Transaction } from '@quirenote/core/types';
import type { PriceRow } from '@quirenote/core/valuation';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import { IDLE_LIMIT, collect, once } from './collect';
import { codeOf } from './dsql';
import {
  INTERNAL,
  INVALID,
  PRECONDITION_FAILED,
  PRECONDITION_REQUIRED,
  TOO_LARGE,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  canonicalUuid,
  derived,
  headerValues,
  json,
  bodyBytes,
  noContent,
  parseJson,
  readJson,
  respond,
  strongMatch,
} from './http';
import { assetColumns, dataTag, transactionColumns, utc } from './ledger';
import type { SqlClient } from './migrate';
import { RETRY_DELAYS_MS, retryable } from './provision';

export const BEGIN_ROUTE = 'POST /imports';
export const PART_ROUTE = 'PUT /imports/{id}/parts/{part}';
export const COMMIT_ROUTE = 'POST /imports/{id}/commit';
export const ABORT_ROUTE = 'DELETE /imports/{id}';

/** AWS's DSQL loading guidance: "Aim for transactions of a few hundred rows rather than
 *  thousands." */
export const MAX_PART_ROWS = 500;
/** S3 UploadPart's range. */
const MAX_PART = 10_000;
/** An `integer` column's ceiling, which a manifest's count is stored in. */
const MAX_COUNT = 2 ** 31 - 1;
/** A commit collects while more than this is left of the function's time, so it answers inside
 *  AIP-151's rule of thumb. */
const COLLECT_RESERVE_MS = 10_000;
/** SHA-256 in canonical base64, as `Content-Digest` (RFC 9530) carries it and the schema holds
 *  it. */
const DIGEST = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;

const NO_SUCH_IMPORT = json(404, '{"error":"no_such_import"}');
const PART_CONFLICT = json(409, '{"error":"part_conflict"}');
const INVALID_DIGEST = json(400, '{"error":"invalid_digest"}');
const DIGEST_MISMATCH = json(400, '{"error":"digest_mismatch"}');

const BEGUN = derived({
  statusCode: 201,
  name: 'begun',
  headers: ['location'],
  example: { id: '<import id>' },
});
const STAGED = derived({
  statusCode: 200,
  name: 'staged',
  headers: [],
  example: { part: 1, digest: '<SHA-256 of the body, base64>' },
});
const COMMITTED = derived({
  statusCode: 200,
  name: 'committed',
  headers: ['etag'],
  example: { etag: '"<data_version>"' },
});
const ABORTED = bodiless({ statusCode: 204, name: 'aborted', headers: [] });
const TOO_MANY_PART_ROWS = derived({
  statusCode: 400,
  name: 'too_many_part_rows',
  headers: [],
  example: { error: 'too_many_part_rows', max: MAX_PART_ROWS },
});
const INVALID_PART = derived({
  statusCode: 422,
  name: 'invalid_part',
  headers: [],
  example: {
    error: 'invalid_part',
    table: 'transactions',
    index: 0,
    issues: [{ field: 'quantity', code: 'units-missing-on-position-row' }],
  },
});
const MANIFEST_MISMATCH = derived({
  statusCode: 409,
  name: 'manifest_mismatch',
  headers: [],
  example: { error: 'manifest_mismatch', field: 'part', expected: 2, actual: 3 },
});

const GATE = [PENDING, REJECTED, NO_APPLICATION, FORBIDDEN];

/** What each route can answer, and the only list of it, as `mutations.ts`'s is. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [BEGIN_ROUTE]: [BEGUN, INVALID, TOO_LARGE, ...GATE, INTERNAL],
  [PART_ROUTE]: [
    STAGED,
    INVALID,
    INVALID_DIGEST,
    DIGEST_MISMATCH,
    TOO_MANY_PART_ROWS,
    NO_SUCH_IMPORT,
    PART_CONFLICT,
    TOO_LARGE,
    INVALID_PART,
    ...GATE,
    INTERNAL,
  ],
  [COMMIT_ROUTE]: [
    COMMITTED,
    NO_SUCH_IMPORT,
    MANIFEST_MISMATCH,
    PRECONDITION_FAILED,
    PRECONDITION_REQUIRED,
    ...GATE,
    INTERNAL,
  ],
  [ABORT_ROUTE]: [ABORTED, NO_SUCH_IMPORT, ...GATE, INTERNAL],
};

const header = (name: string, required: boolean) => ({
  name,
  in: 'header',
  required,
  schema: { type: 'string' },
});

/** The headers each route reads: a part its digest, a commit its precondition. */
export const PARAMETERS: Record<string, ReturnType<typeof header>[]> = {
  [PART_ROUTE]: [header('Content-Digest', true)],
  [COMMIT_ROUTE]: [header('If-Match', true)],
};

const count = { type: 'integer', minimum: 0, maximum: MAX_COUNT };
export const BEGIN_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['assets', 'transactions', 'prices', 'digest'],
        additionalProperties: false,
        properties: {
          assets: count,
          transactions: count,
          prices: count,
          digest: { type: 'string', pattern: DIGEST.source },
        },
      },
    },
  },
};
const rows = { type: 'array', minItems: 1, items: { type: 'object' } };
export const PART_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: { assets: rows, transactions: rows, prices: rows },
      },
    },
  },
};

export interface ImportDeps {
  user: SqlClient;
  /** A fresh UUID: a begun import's generation. */
  token: () => string;
  sleep: (ms: number) => Promise<void>;
  /** Lowered by a test to reach the bound with a few rows; never by a caller. */
  maxPartRows?: number;
  /** Rows in one collection batch, lowered by a test; `collect.ts`'s own bound otherwise. */
  batchRows?: number;
  /** Lambda's `getRemainingTimeInMillis`. Absent, a commit collects nothing itself. */
  remainingMs?: () => number;
}

// --- SQL: every statement over a data table goes through the STAGING pointer `import_dataset_id`.

const DATASET_INSERT = `INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())
                        ON CONFLICT (user_id, id) DO NOTHING`;
const OPEN = `UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1 RETURNING user_id`;
const MANIFEST_INSERT = `INSERT INTO import_manifest (dataset_id, digest, assets, transactions,
                                                      prices, staged_at)
                         SELECT u.import_dataset_id, $3::text, $4::integer, $5::integer,
                                $6::integer, now()
                           FROM app_user u WHERE u.user_id = $1 AND u.import_dataset_id = $2::uuid
                         ON CONFLICT (dataset_id) DO NOTHING`;
// THE ROW EVERY PART, THE COMMIT AND THE COLLECTOR WRITE, so DSQL, which adjudicates writes alone,
// refuses one of two that overlap. An import idle past the limit is gone.
const TOUCH = `UPDATE import_manifest SET staged_at = now()
                WHERE dataset_id IN (
                  SELECT u.import_dataset_id FROM app_user u
                   WHERE u.user_id = $1 AND u.import_dataset_id = $2::uuid)
                  AND staged_at > now() - $3::interval
            RETURNING digest, assets, transactions, prices`;
const PART_DIGEST = `SELECT x.digest FROM import_part x
                       JOIN app_user u ON u.import_dataset_id = x.dataset_id
                      WHERE u.user_id = $1 AND x.part = $2::integer`;
const PART_INSERT = `INSERT INTO import_part (dataset_id, part, digest)
                     SELECT u.import_dataset_id, $2::integer, $3::text
                       FROM app_user u WHERE u.user_id = $1
                  RETURNING part`;
const ASSETS_STAGE = `INSERT INTO asset (dataset_id, id, name, code, color_slot, yield_type,
                                         expected_pct, target_pct, payout_schedule, first_purchase,
                                         maturity, coupon_amount, coupon_rate_pct, next_coupon,
                                         provider_kind, provider_ref, created_at)
                      SELECT u.import_dataset_id, a.id, a.name, a.code, a.color_slot, a.yield_type,
                             a.expected_pct, a.target_pct, a.payout_schedule, a.first_purchase,
                             a.maturity, a.coupon_amount, a.coupon_rate_pct, a.next_coupon,
                             a.provider_kind, a.provider_ref, a.created_at
                        FROM app_user u,
                             unnest($2::uuid[], $3::text[], $4::text[], $5::smallint[], $6::text[],
                                    $7::numeric[], $8::numeric[], $9::text[], $10::date[],
                                    $11::date[], $12::numeric[], $13::numeric[], $14::date[],
                                    $15::text[], $16::text[], $17::timestamptz[])
                               AS a(id, name, code, color_slot, yield_type, expected_pct,
                                    target_pct, payout_schedule, first_purchase, maturity,
                                    coupon_amount, coupon_rate_pct, next_coupon, provider_kind,
                                    provider_ref, created_at)
                       WHERE u.user_id = $1
                   RETURNING id`;
// The account is the user's one, which provisioning wrote (`provision.ts`).
const TRANSACTIONS_STAGE = `INSERT INTO "transaction" (dataset_id, id, user_id, account_id, date,
                                                       type, amount, asset_id, quantity,
                                                       unit_price, tax_withheld, note, created_at)
                            SELECT u.import_dataset_id, t.id, u.user_id, c.id, t.date, t.type,
                                   t.amount, t.asset_id, t.quantity, t.unit_price, t.tax_withheld,
                                   t.note, now()
                              FROM app_user u
                              JOIN account c ON c.user_id = u.user_id AND c.provider = 'inzhur'
                             CROSS JOIN unnest($2::uuid[], $3::date[], $4::text[], $5::numeric[],
                                               $6::uuid[], $7::numeric[], $8::numeric[],
                                               $9::numeric[], $10::text[])
                                    AS t(id, date, type, amount, asset_id, quantity, unit_price,
                                         tax_withheld, note)
                             WHERE u.user_id = $1
                         RETURNING id`;
// A witness time the file does not carry stays NULL, so a second export leaves it out again.
const PRICES_STAGE = `INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
                      SELECT u.import_dataset_id, p.asset_id, p.as_of, p.price, p.observed_at
                        FROM app_user u,
                             unnest($2::uuid[], $3::date[], $4::numeric[], $5::timestamptz[])
                               AS p(asset_id, as_of, price, observed_at)
                       WHERE u.user_id = $1
                   RETURNING asset_id`;

const POINTERS = `SELECT u.data_version::text AS data_version, u.dataset_id::text AS live,
                         u.import_dataset_id::text AS staged
                    FROM app_user u WHERE u.user_id = $1`;
const PARTS = `SELECT x.part, x.digest FROM import_part x
                 JOIN app_user u ON u.import_dataset_id = x.dataset_id
                WHERE u.user_id = $1
                ORDER BY x.part`;
// Reads, which the row ceiling does not count; one each, as the guard reads no scalar sub-select.
const COUNTS = {
  assets: `SELECT count(*)::int AS n FROM asset a
             JOIN app_user u ON u.import_dataset_id = a.dataset_id WHERE u.user_id = $1`,
  transactions: `SELECT count(*)::int AS n FROM "transaction" t
                   JOIN app_user u ON u.import_dataset_id = t.dataset_id WHERE u.user_id = $1`,
  prices: `SELECT count(*)::int AS n FROM user_price p
             JOIN app_user u ON u.import_dataset_id = p.dataset_id WHERE u.user_id = $1`,
} as const;
// ONE ROW UPDATE: the live pointer moves, the staging closes and the version bumps together, under
// the version the commit read, so it serializes against every other write on the row.
const MOVE = `UPDATE app_user
                 SET dataset_id = import_dataset_id, import_dataset_id = NULL,
                     data_version = data_version + 1
               WHERE user_id = $1 AND data_version = $2::bigint AND import_dataset_id = $3::uuid
           RETURNING data_version::text AS data_version`;
const CLOSE = `UPDATE app_user SET import_dataset_id = NULL
                WHERE user_id = $1 AND import_dataset_id = $2::uuid
            RETURNING user_id`;

// --- The request ---------------------------------------------------------------------------------

/** An answer thrown out of a transaction, which rolls it back. */
class Refusal extends Error {
  constructor(readonly answer: ApiResult) {
    super(`refused ${answer.statusCode}`);
  }
}

/** A database refusal of the rows of one table, kept with the table it names. */
class Staging extends Error {
  constructor(
    readonly table: Table,
    readonly cause: unknown,
  ) {
    super(`staging ${table} failed`);
  }
}

type Table = 'assets' | 'transactions' | 'prices';
type Part = { assets: Asset[]; transactions: Transaction[]; prices: PriceRow[] };
type Manifest = { assets: number; transactions: number; prices: number; digest: string };

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

/** `work` in one transaction, sent again after a serialization failure; `attempt` past 0 tells
 *  `work` the last may have landed, which DSQL can answer with that failure. */
async function transact<T>(
  deps: ImportDeps,
  work: (client: SqlClient, attempt: number) => Promise<T>,
): Promise<T> {
  const client = deps.user;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.query('BEGIN');
      const out = await work(client, attempt);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (retryable(err) && attempt < RETRY_DELAYS_MS.length) {
        await deps.sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const manifestOf = (value: unknown): Manifest | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort().join();
  if (keys !== 'assets,digest,prices,transactions') return undefined;
  const counted = (n: unknown) =>
    Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= MAX_COUNT;
  const { assets, transactions, prices, digest } = value;
  if (![assets, transactions, prices].every(counted)) return undefined;
  if (typeof digest !== 'string' || !DIGEST.test(digest)) return undefined;
  return { assets, transactions, prices, digest } as Manifest;
};

/** Digits with no sign or leading zero, within S3's range. */
const partNumber = (raw: string | undefined): number | undefined =>
  raw !== undefined && /^[1-9]\d{0,4}$/.test(raw) && Number(raw) <= MAX_PART
    ? Number(raw)
    : undefined;

/** The `sha-256` member of `Content-Digest`, a structured-field dictionary of byte sequences. */
const sentDigest = (event: ApiEvent): string | undefined => {
  for (const member of headerValues(event, 'content-digest')) {
    const m = /^([a-z0-9-]+)=:([^:]*):$/.exec(member);
    if (m?.[1] === 'sha-256') return DIGEST.test(m[2]) ? m[2] : undefined;
  }
  return undefined;
};

const invalidPart = (table: Table, issues: RowIssueCode[], index?: number) =>
  new Refusal(
    respond(
      INVALID_PART,
      {},
      JSON.stringify({
        error: 'invalid_part',
        table,
        ...(index === undefined ? {} : { index }),
        issues,
      }),
    ),
  );

/** A uuid, folded, or the row refused naming the field. */
const idAt = (table: Table, index: number, field: string, raw: string): string => {
  const id = canonicalUuid(raw);
  if (id === undefined) throw invalidPart(table, [{ field, code: 'invalid', value: raw }], index);
  return id;
};

/** Every row through its door, as `POST /mutations` checks one; the first fault refuses the
 *  part. */
function checked(body: Record<string, unknown[]>): Part {
  const assets = (body.assets ?? []).map((raw, i) => {
    const row = assetRecordSchema.safeParse(raw);
    if (!row.success) throw invalidPart('assets', rowIssueCodes('assets', row.error.issues), i);
    return { ...row.data, id: idAt('assets', i, 'id', row.data.id) };
  });
  const transactions = (body.transactions ?? []).map((raw, i) => {
    const row = transactionRecordSchema.safeParse(raw);
    if (!row.success) {
      throw invalidPart('transactions', rowIssueCodes('transactions', row.error.issues), i);
    }
    const t: Transaction = { ...row.data, id: idAt('transactions', i, 'id', row.data.id) };
    if (t.assetId === '') {
      if (targetsAsset(t.type)) {
        throw invalidPart(
          'transactions',
          [{ field: 'assetId', code: 'asset-missing-on-asset-row' }],
          i,
        );
      }
    } else {
      if (!targetsAsset(t.type)) {
        throw invalidPart(
          'transactions',
          [{ field: 'assetId', code: 'invalid', value: t.assetId }],
          i,
        );
      }
      t.assetId = idAt('transactions', i, 'assetId', t.assetId);
    }
    return t;
  });
  const prices = (body.prices ?? []).map((raw, i) => {
    const row = priceRowSchema.safeParse(raw);
    if (!row.success) throw invalidPart('prices', rowIssueCodes('prices', row.error.issues), i);
    return { ...row.data, assetId: idAt('prices', i, 'assetId', row.data.assetId) };
  });
  return { assets, transactions, prices };
}

/** A part's tables, each a list holding a row, and nothing else. */
const tablesOf = (value: unknown): Record<string, unknown[]> | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value);
  const known = ['assets', 'transactions', 'prices'];
  if (keys.length === 0 || keys.some((k) => !known.includes(k))) return undefined;
  if (keys.some((k) => !Array.isArray(value[k]) || (value[k] as unknown[]).length === 0)) {
    return undefined;
  }
  return value as Record<string, unknown[]>;
};

/** The schema's own words for a whole-dataset rule, in core's codes. */
const RULES: Record<string, RowIssueCode['code']> = {
  asset_dataset_id_id_pk: 'duplicate-key',
  transaction_dataset_id_id_pk: 'duplicate-key',
  user_price_dataset_id_asset_id_as_of_pk: 'duplicate-price',
  transaction_asset_fk: 'unknown-asset-id',
  user_price_asset_fk: 'unknown-asset-id',
};

/** One table's rows in one statement, every one of them written or the statement refused. */
async function stage(
  client: SqlClient,
  table: Table,
  sql: string,
  userId: string,
  columns: unknown[][],
  sent: number,
) {
  if (sent === 0) return;
  let staged: number;
  try {
    staged = (await client.query(sql, [userId, ...columns])).rows.length;
  } catch (err) {
    // A refused value or key is the part's; a serialization failure is the transaction's to retry.
    throw /^2[23]/.test(codeOf(err) ?? '') ? new Staging(table, err) : err;
  }
  // Provisioning writes every account holder's account; a user without one is a fault.
  if (staged !== sent) throw new Error(`${table}: ${staged} of ${sent} rows staged`);
}

/** A key or a CHECK refusing a staged row, as core's code for the rule it holds. */
function refusalOf(err: Staging): Refusal | undefined {
  const code = codeOf(err.cause);
  const constraint = (err.cause as { constraint?: unknown }).constraint;
  const rule = typeof constraint === 'string' ? RULES[constraint] : undefined;
  if (rule !== undefined) return invalidPart(err.table, [{ code: rule }]);
  // A CHECK the row doors do not hold, or a value the column cannot take, such as a NUL in text.
  if (code === '23514' || code?.startsWith('22')) {
    const value = typeof constraint === 'string' ? { value: constraint } : {};
    return invalidPart(err.table, [{ code: 'invalid', ...value }]);
  }
  return undefined;
}

const columnsOf = (part: Part) => ({
  assets: transpose(
    part.assets.map((a) => [a.id, ...assetColumns(a)]),
    16,
  ),
  transactions: transpose(
    part.transactions.map((t) => [t.id, ...transactionColumns(t)]),
    9,
  ),
  prices: transpose(
    part.prices.map((p) => [
      p.assetId,
      p.asOf,
      String(p.price),
      p.observedAt === undefined ? null : utc(p.observedAt),
    ]),
    4,
  ),
});
/** Rows to the column arrays `unnest` takes. */
const transpose = (rows: unknown[][], width: number): unknown[][] =>
  Array.from({ length: width }, (_, c) => rows.map((r) => r[c]));

async function begin(deps: ImportDeps, userId: string, event: ApiEvent): Promise<ApiResult> {
  const read = readJson(event);
  if ('statusCode' in read) return read;
  const manifest = manifestOf(read.value);
  if (manifest === undefined) return INVALID;
  const id = deps.token();
  // A begin sent again after its commit landed finds its own rows: the inserts do nothing then.
  await transact(deps, async (client) => {
    await client.query(DATASET_INSERT, [userId, id]);
    await client.query(OPEN, [userId, id]);
    const { assets, transactions, prices, digest } = manifest;
    await client.query(MANIFEST_INSERT, [userId, id, digest, assets, transactions, prices]);
  });
  return respond(BEGUN, { location: `/imports/${id}` }, JSON.stringify({ id }));
}

async function part(deps: ImportDeps, userId: string, event: ApiEvent): Promise<ApiResult> {
  const n = partNumber(event.pathParameters?.part);
  if (n === undefined) return INVALID;
  const id = canonicalUuid(event.pathParameters?.id);
  if (id === undefined) return NO_SUCH_IMPORT;
  // The digest is of the bytes as sent, so it is checked before they are read as JSON.
  const bytes = bodyBytes(event);
  if (!Buffer.isBuffer(bytes)) return bytes;
  const sent = sentDigest(event);
  if (sent === undefined) return INVALID_DIGEST;
  const digest = sha256(bytes);
  if (sent !== digest) return DIGEST_MISMATCH;
  const read = parseJson(bytes);
  if ('statusCode' in read) return read;
  const tables = tablesOf(read.value);
  if (tables === undefined) return INVALID;
  const max = deps.maxPartRows ?? MAX_PART_ROWS;
  const rows = Object.values(tables).reduce((sum, list) => sum + list.length, 0);
  if (rows > max) {
    return respond(TOO_MANY_PART_ROWS, {}, JSON.stringify({ error: 'too_many_part_rows', max }));
  }
  const checkedPart = checked(tables);
  const columns = columnsOf(checkedPart);

  await transact(deps, async (client) => {
    const touched = await client.query(TOUCH, [userId, id, IDLE_LIMIT]);
    if (touched.rows.length === 0) throw new Refusal(NO_SUCH_IMPORT);
    // The same number with the same body is the part sent again; another body is a conflict. Two
    // sends meet only here: each wrote the manifest row first, so the later one's retry reads this.
    const [staged] = (await client.query<{ digest: string }>(PART_DIGEST, [userId, n])).rows;
    if (staged !== undefined) {
      if (staged.digest !== digest) throw new Refusal(PART_CONFLICT);
      return;
    }
    await client.query(PART_INSERT, [userId, n, digest]);
    // Parents first, as the keys require.
    await stage(client, 'assets', ASSETS_STAGE, userId, columns.assets, checkedPart.assets.length);
    await stage(
      client,
      'transactions',
      TRANSACTIONS_STAGE,
      userId,
      columns.transactions,
      checkedPart.transactions.length,
    );
    await stage(client, 'prices', PRICES_STAGE, userId, columns.prices, checkedPart.prices.length);
  });
  return respond(STAGED, {}, JSON.stringify({ part: n, digest }));
}

async function commit(deps: ImportDeps, userId: string, event: ApiEvent): Promise<ApiResult> {
  const ifMatch = headerValues(event, 'if-match');
  // `*` matches whatever exists, so it is no precondition at all (RFC 6585 §3).
  if (ifMatch.length === 0 || ifMatch.includes('*')) return PRECONDITION_REQUIRED;
  const id = canonicalUuid(event.pathParameters?.id);
  if (id === undefined) return NO_SUCH_IMPORT;

  const etag = await transact(deps, async (client) => {
    const [p] = (
      await client.query<{ data_version: string; live: string | null; staged: string | null }>(
        POINTERS,
        [userId],
      )
    ).rows;
    // The commit landed already, under an error or with its answer lost: AIP-155 answers it again.
    if (p.live === id) return dataTag(p.data_version);
    if (p.staged !== id) throw new Refusal(NO_SUCH_IMPORT);
    if (!strongMatch(ifMatch, dataTag(p.data_version))) throw new Refusal(PRECONDITION_FAILED);
    const [manifest] = (await client.query<Manifest>(TOUCH, [userId, id, IDLE_LIMIT])).rows;
    if (manifest === undefined) throw new Refusal(NO_SUCH_IMPORT);
    const mismatch = (field: string, expected: unknown, actual: unknown) =>
      new Refusal(
        respond(
          MANIFEST_MISMATCH,
          {},
          JSON.stringify({ error: 'manifest_mismatch', field, expected, actual }),
        ),
      );
    // S3's composite checksum: the parts run from 1 with no gap, and the manifest's digest is the
    // SHA-256 of their own digests' bytes, in order.
    const parts = (await client.query<{ part: number; digest: string }>(PARTS, [userId])).rows;
    parts.forEach((x, i) => {
      if (x.part !== i + 1) throw mismatch('part', i + 1, x.part);
    });
    const composite = sha256(Buffer.concat(parts.map((x) => Buffer.from(x.digest, 'base64'))));
    if (composite !== manifest.digest) throw mismatch('digest', manifest.digest, composite);
    for (const table of ['assets', 'transactions', 'prices'] as const) {
      const [{ n }] = (await client.query<{ n: number }>(COUNTS[table], [userId])).rows;
      if (n !== manifest[table]) throw mismatch(table, manifest[table], n);
    }
    const moved = await client.query<{ data_version: string }>(MOVE, [userId, p.data_version, id]);
    if (moved.rows.length === 0) throw new Refusal(PRECONDITION_FAILED);
    return dataTag(moved.rows[0].data_version);
  });
  return respond(COMMITTED, { etag }, JSON.stringify({ etag }));
}

async function abort(
  deps: ImportDeps,
  userId: string,
  event: ApiEvent,
): Promise<EmptyResult | ApiResult> {
  const id = canonicalUuid(event.pathParameters?.id);
  if (id === undefined) return NO_SUCH_IMPORT;
  await transact(deps, async (client, attempt) => {
    if ((await client.query(CLOSE, [userId, id])).rows.length > 0) return;
    // After an attempt that may have landed the import is closed either way, unless a commit won.
    const [p] = (await client.query<{ live: string | null }>(POINTERS, [userId])).rows;
    if (attempt === 0 || p.live === id) throw new Refusal(NO_SUCH_IMPORT);
  });
  return noContent(ABORTED, {});
}

const ROUTES: Record<
  string,
  (deps: ImportDeps, userId: string, event: ApiEvent) => Promise<ApiResult | EmptyResult>
> = {
  [BEGIN_ROUTE]: begin,
  [PART_ROUTE]: part,
  [COMMIT_ROUTE]: commit,
  [ABORT_ROUTE]: abort,
};

export const IMPORT_ROUTES = Object.keys(ROUTES);

/** The four routes behind the gate. A success collects: a commit while its time allows, the rest
 *  one batch each. */
export async function imports(deps: ImportDeps, event: ApiEvent): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    const userId = gate.caller.userId;
    const route = ROUTES[event.routeKey ?? ''];
    if (route === undefined) return INTERNAL;
    let answer: ApiResult | EmptyResult;
    try {
      answer = await route(deps, userId, event);
    } catch (err) {
      if (err instanceof Refusal) return err.answer;
      const refused = err instanceof Staging ? refusalOf(err) : undefined;
      if (refused !== undefined) return refused.answer;
      throw err instanceof Staging ? err.cause : err;
    }
    if (answer.statusCode < 200 || answer.statusCode > 299) return answer;
    const more =
      event.routeKey === COMMIT_ROUTE
        ? () => (deps.remainingMs?.() ?? 0) > COLLECT_RESERVE_MS
        : once();
    await collect(deps.user, userId, more, deps.batchRows);
    return answer;
  } catch (err) {
    console.error('import failed', err);
    return INTERNAL;
  }
}
