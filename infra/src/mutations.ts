// `POST /mutations` and `GET /state` (*Cloud target*, *User schema and deletes*).
//
// A write is ONE TRANSACTION of ordered ops under a strong `If-Match`, after a claim on its
// idempotency key committed on its own: the effect, the version bump and the stored response then
// commit together, so a retry replays rather than applies twice. The read is the raw export.
import { createHash, randomUUID } from 'node:crypto';

import { rowIssueCodes, type RowIssueCode } from '@quirenote/core/backup/import';
import { assetRecordSchema, transactionRecordSchema } from '@quirenote/core/backup/json';
import { COLOR_KEYS } from '@quirenote/core/colors';
import { ledgerUnits } from '@quirenote/core/derive';
import {
  MAX_BODY_BYTES,
  MAX_OPS,
  OP_NAMES,
  mergePatch,
  opIssues,
  opSchema,
  type Op,
} from '@quirenote/core/ops';
import { targetsAsset, type Asset, type Transaction } from '@quirenote/core/types';
import {
  movedPrices,
  pricesOfQuotes,
  snapshotsOfPrices,
  type UnitPrice,
} from '@quirenote/core/valuation';

import { deleteAsset, pruneAsset } from './asset-delete';
import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import { codeOf, connect } from './dsql';
import {
  INTERNAL,
  INVALID,
  PRECONDITION_FAILED,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  canonicalUuid,
  derived,
  headerValues,
  json,
  notModified,
  respond,
  strongMatch,
  weakMatch,
} from './http';
import { SCHEMA_TYPE, VERSION, dataTag, readLedger, readRows } from './ledger';
import type { SqlClient } from './migrate';
import { RETRY_DELAYS_MS, sleep } from './provision';

export const MUTATIONS_ROUTE = 'POST /mutations';
export const STATE_ROUTE = 'GET /state';

/** Under DSQL's per-transaction row ceiling, leaving the version bump and the key row room. */
export const MAX_ROWS = 2500;
/** The function's timeout and a margin: a claim older than that ran out of time. */
export const CLAIM_WINDOW_SECONDS = 20;
/** Stripe's horizon for a key, and Brandur's. */
const KEY_LIFETIME = '24 hours';
const SWEEP_LIMIT = 100;
/** A tag that names no caller, every user's first being "0": no browser may keep the answer. */
const NO_STORE = 'private, no-store';

const TOO_LARGE = json(413, '{"error":"payload_too_large","max":1048576}');
const TOO_MANY_OPS = json(400, '{"error":"too_many_ops","max":100}');
const BAD_KEY = json(400, '{"error":"invalid_idempotency_key"}');
const PRECONDITION_REQUIRED = json(428, '{"error":"precondition_required"}');
const KEY_REUSED = json(422, '{"error":"key_reused"}');
const IN_FLIGHT = json(409, '{"error":"request_in_flight"}');

const MUTATED = derived({
  statusCode: 200,
  name: 'mutated',
  headers: ['etag'],
  example: {
    etag: '"<data_version>"',
    results: [{}, { dropped: ['<asset id>'] }, { remaining: 0 }],
  },
});
const INVALID_OP = derived({
  statusCode: 422,
  name: 'invalid_op',
  headers: [],
  example: {
    error: 'invalid_op',
    index: 0,
    issues: [{ field: 'quantity', code: 'units-missing-on-position-row' }],
  },
});
const DUPLICATE_ID = derived({
  statusCode: 409,
  name: 'duplicate_id',
  headers: [],
  example: { error: 'duplicate_id', index: 0 },
});
const TOO_MANY_ROWS = derived({
  statusCode: 409,
  name: 'too_many_rows',
  headers: [],
  example: { error: 'too_many_rows', index: 0, count: MAX_ROWS + 1, max: MAX_ROWS },
});
const STATE = derived({
  statusCode: 200,
  name: 'state',
  headers: ['etag', 'cache-control'],
  example: { assets: ['<Asset>'], transactions: ['<Transaction>'], snapshots: ['<Snapshot>'] },
});
const STATE_UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });

/** What each route can answer, and the only list of it: `openapi.ts` builds the document from
 *  here, and `mutations.test.ts` proves it against what the routes really answer. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [MUTATIONS_ROUTE]: [
    MUTATED,
    INVALID,
    TOO_MANY_OPS,
    BAD_KEY,
    PRECONDITION_REQUIRED,
    PRECONDITION_FAILED,
    KEY_REUSED,
    INVALID_OP,
    IN_FLIGHT,
    DUPLICATE_ID,
    TOO_MANY_ROWS,
    TOO_LARGE,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    INTERNAL,
  ],
  [STATE_ROUTE]: [
    STATE,
    STATE_UNCHANGED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    PRECONDITION_FAILED,
    INTERNAL,
  ],
};

const header = (name: string, required: boolean) => ({
  name,
  in: 'header',
  required,
  schema: { type: 'string' },
});

/** The headers each route reads: a write needs both of its own. */
export const PARAMETERS: Record<string, ReturnType<typeof header>[]> = {
  [MUTATIONS_ROUTE]: [header('Idempotency-Key', true), header('If-Match', true)],
  [STATE_ROUTE]: [header('If-None-Match', false), header('If-Match', false)],
};

export const BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['ops'],
        additionalProperties: false,
        properties: {
          ops: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_OPS,
            items: {
              type: 'object',
              required: ['op'],
              properties: { op: { type: 'string', enum: OP_NAMES } },
            },
          },
        },
      },
    },
  },
} as const;

export interface MutationDeps {
  user: SqlClient;
  /** A fresh UUID: a claim's token, and a cleared dataset's id. */
  token: () => string;
  sleep: (ms: number) => Promise<void>;
  /** Lowered by a test to reach the bound with a few rows; never by a caller. */
  maxRows?: number;
}

/** RFC 8785's rules for what `JSON.parse` gives: members sorted by UTF-16 code units, no
 *  whitespace, numbers as ECMAScript writes them. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const members = value as Record<string, unknown>;
    const keys = Object.keys(members).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(members[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/** The method, the route and the decoded body; `If-Match` is left out, so a replay with a tag
 *  gone stale still replays. */
export const fingerprintOf = (body: unknown): string =>
  createHash('sha256')
    .update(canonical([MUTATIONS_ROUTE, body]), 'utf8')
    .digest('hex');

// --- The key ---------------------------------------------------------------------------------

const WINDOW = `${CLAIM_WINDOW_SECONDS} seconds`;
// The conflict target is the primary key, the shape `infra/docs/dsql-constraints.md` measured.
const CLAIM = `INSERT INTO mutation_key (user_id, key, fingerprint, token, claimed_at, in_progress_until,
                                         expires_at)
               VALUES ($1, $2, $3, $4, now(), now() + $5::interval, now() + $6::interval)
               ON CONFLICT (user_id, key) DO NOTHING`;
const READ_KEY = `SELECT k.fingerprint, k.token::text AS token, k.in_progress_until > now() AS live,
                         k.expires_at <= now() AS expired, k.response_status, k.response_body
                    FROM mutation_key k WHERE k.user_id = $1 AND k.key = $2`;
// A compare-and-set on the token the read saw: of two requests taking one claim over, one wins.
const TAKE_OVER = `UPDATE mutation_key SET fingerprint = $4, token = $5, claimed_at = now(),
                          in_progress_until = now() + $6::interval, expires_at = now() + $7::interval,
                          response_status = NULL, response_body = NULL
                    WHERE user_id = $1 AND key = $2 AND token = $3
                RETURNING key`;
const DONE = `UPDATE mutation_key SET response_status = 200, response_body = $4
               WHERE user_id = $1 AND key = $2 AND token = $3 AND response_status IS NULL
           RETURNING key`;
const RELEASE = `DELETE FROM mutation_key
                  WHERE user_id = $1 AND key = $2 AND token = $3 AND response_status IS NULL
              RETURNING key`;
const SWEEP = `DELETE FROM mutation_key WHERE (user_id, key) IN (
                 SELECT k.user_id, k.key FROM mutation_key k
                  WHERE k.user_id = $1 AND k.expires_at < now() LIMIT $2)
               RETURNING key`;

type KeyRow = {
  fingerprint: string;
  token: string;
  live: boolean;
  expired: boolean;
  response_status: number | null;
  response_body: string | null;
};

const RETRYABLE = new Set(['40001', 'XX000']);
const retryable = (err: unknown) => RETRYABLE.has(codeOf(err) ?? '');

const replay = (body: string) =>
  respond(MUTATED, { etag: (JSON.parse(body) as { etag: string }).etag }, body);

/** Claims the key under a fresh token, or answers: a replay, a reuse, a request still running. */
async function claim(
  deps: MutationDeps,
  userId: string,
  key: string,
  fingerprint: string,
): Promise<{ token: string } | { answer: ApiResult }> {
  const client = deps.user;
  const token = deps.token();
  const takeOver = async (row: KeyRow) => {
    const { rows } = await client.query(TAKE_OVER, [
      userId,
      key,
      row.token,
      fingerprint,
      token,
      WINDOW,
      KEY_LIFETIME,
    ]);
    return rows.length > 0 ? { token } : { answer: IN_FLIGHT };
  };
  for (let attempt = 0; ; attempt += 1) {
    try {
      await client.query('BEGIN');
      await client.query(CLAIM, [userId, key, fingerprint, token, WINDOW, KEY_LIFETIME]);
      const [row] = (await client.query<KeyRow>(READ_KEY, [userId, key])).rows;
      const out =
        row.token === token
          ? { token }
          : row.expired
            ? await takeOver(row)
            : row.fingerprint !== fingerprint
              ? { answer: KEY_REUSED }
              : row.response_body !== null
                ? { answer: replay(row.response_body) }
                : row.live
                  ? { answer: IN_FLIGHT }
                  : await takeOver(row);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!retryable(err)) throw err;
      // A next attempt finds a claim that landed under the error by its token; the last reads it.
      if (attempt < RETRY_DELAYS_MS.length) {
        await deps.sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      const { rows } = await client.query<KeyRow>(READ_KEY, [userId, key]).catch(async (e) => {
        console.error('mutations claim conflict before a failed read', err);
        await client.query(RELEASE, [userId, key, token]).catch(() => undefined);
        throw e;
      });
      if (rows[0]?.token === token) return { token };
      throw err;
    }
  }
}

// --- The ops ---------------------------------------------------------------------------------

/** An answer thrown out of the apply, so the transaction is rolled back and the key released. */
class Refusal extends Error {
  constructor(readonly answer: ApiResult) {
    super(`refused ${answer.statusCode}`);
  }
}

const invalidOp = (index: number, issues: RowIssueCode[]) =>
  new Refusal(respond(INVALID_OP, {}, JSON.stringify({ error: 'invalid_op', index, issues })));
const duplicate = (index: number) =>
  new Refusal(respond(DUPLICATE_ID, {}, JSON.stringify({ error: 'duplicate_id', index })));
const tooManyRows = (index: number | undefined, count: number | undefined, max: number) =>
  respond(TOO_MANY_ROWS, {}, JSON.stringify({ error: 'too_many_rows', index, count, max }));

const BUMP = `UPDATE app_user SET data_version = data_version + 1
               WHERE user_id = $1 AND data_version = $2::bigint
           RETURNING data_version::text AS data_version`;
const DATASET_INSERT = `INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())`;
const POINT = `UPDATE app_user SET dataset_id = $2 WHERE user_id = $1 RETURNING user_id`;

// Every statement over a data table joins the caller's LIVE pointer itself (*User schema and
// deletes*), and casts what it binds, so neither driver infers a type.
const ASSET_INSERT = `INSERT INTO asset (dataset_id, id, name, code, color_slot, yield_type,
                                         expected_pct, target_pct, payout_schedule, first_purchase,
                                         maturity, coupon_amount, coupon_rate_pct, next_coupon,
                                         provider_kind, provider_ref, created_at)
                      SELECT u.dataset_id, $2::uuid, $3::text, $4::text, $5::smallint, $6::text,
                             $7::numeric, $8::numeric, $9::text, $10::date, $11::date, $12::numeric,
                             $13::numeric, $14::date, $15::text, $16::text, $17::timestamptz
                        FROM app_user u WHERE u.user_id = $1
                   RETURNING id`;
const ASSET_UPDATE = `UPDATE asset SET name = $3::text, code = $4::text, color_slot = $5::smallint,
                             yield_type = $6::text, expected_pct = $7::numeric,
                             target_pct = $8::numeric, payout_schedule = $9::text,
                             first_purchase = $10::date, maturity = $11::date,
                             coupon_amount = $12::numeric, coupon_rate_pct = $13::numeric,
                             next_coupon = $14::date, provider_kind = $15::text,
                             provider_ref = $16::text, created_at = $17::timestamptz
                       WHERE (dataset_id, id) IN (
                         SELECT u.dataset_id, $2::uuid FROM app_user u WHERE u.user_id = $1)
                   RETURNING id`;
// The account is the user's one, which provisioning wrote (`provision.ts`).
const TX_INSERT = `INSERT INTO "transaction" (dataset_id, id, user_id, account_id, date, type, amount,
                                              asset_id, quantity, unit_price, tax_withheld, note,
                                              created_at)
                   SELECT u.dataset_id, $2::uuid, u.user_id, c.id, $3::date, $4::text, $5::numeric,
                          $6::uuid, $7::numeric, $8::numeric, $9::numeric, $10::text, now()
                     FROM app_user u JOIN account c ON c.user_id = u.user_id AND c.provider = 'inzhur'
                    WHERE u.user_id = $1
                RETURNING id`;
const TX_UPDATE = `UPDATE "transaction" SET date = $3::date, type = $4::text, amount = $5::numeric,
                          asset_id = $6::uuid, quantity = $7::numeric, unit_price = $8::numeric,
                          tax_withheld = $9::numeric, note = $10::text
                    WHERE (dataset_id, id) IN (
                      SELECT u.dataset_id, $2::uuid FROM app_user u WHERE u.user_id = $1)
                RETURNING id`;
const TX_DELETE = `DELETE FROM "transaction"
                    WHERE (dataset_id, id) IN (
                      SELECT u.dataset_id, $2::uuid FROM app_user u WHERE u.user_id = $1)
                RETURNING id`;
const PRICES_AT = `SELECT p.asset_id::text AS asset_id, p.price::text AS price,
                          to_char(p.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
                            AS observed_at
                     FROM user_price p JOIN app_user u ON u.dataset_id = p.dataset_id
                    WHERE u.user_id = $1 AND p.as_of = $2::date`;
const PRICES_DELETE_AT = `DELETE FROM user_price
                           WHERE (dataset_id, as_of) IN (
                             SELECT u.dataset_id, $2::date FROM app_user u WHERE u.user_id = $1)
                       RETURNING asset_id`;
// One statement for a day's prices; a witness time the op did not name is the request's own.
const PRICES_INSERT = `INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
                       SELECT u.dataset_id, q.asset_id, $2::date, q.price, COALESCE(q.observed_at, now())
                         FROM app_user u,
                              unnest($3::uuid[], $4::numeric[], $5::timestamptz[])
                                AS q(asset_id, price, observed_at)
                        WHERE u.user_id = $1
                    RETURNING asset_id`;

const text = (n: number | undefined) => (n === undefined ? null : String(n));
// The model's timestamps carry no zone; the cluster's clock is UTC.
const utc = (at: string) => `${at}Z`;

const assetColumns = (a: Asset) => [
  a.name,
  a.code,
  COLOR_KEYS.indexOf(a.colorKey),
  a.yieldType,
  String(a.expectedPct),
  String(a.targetPct),
  a.payoutSchedule,
  a.firstPurchase,
  a.maturity ?? null,
  text(a.couponAmount),
  text(a.couponRatePct),
  a.nextCoupon ?? null,
  a.inzhur?.kind ?? null,
  a.inzhur?.ref ?? null,
  utc(a.createdAt),
];
const transactionColumns = (t: Transaction) => [
  t.date,
  SCHEMA_TYPE[t.type],
  String(t.amount),
  t.assetId === '' ? null : t.assetId,
  text(t.quantity),
  text(t.unitPrice),
  text(t.taxWithheld),
  t.note ?? null,
];

type PriceAt = { asset_id: string; price: string; observed_at: string | null };
type Priced = UnitPrice & { observedAt: string | null };

/** One request's ops against the dataset as each op leaves it. */
class Run {
  used = 0;
  private assets = new Map<string, Asset>();
  private transactions: Transaction[] = [];

  constructor(
    private readonly client: SqlClient,
    private readonly userId: string,
    private readonly deps: MutationDeps,
    private readonly maxRows: number,
  ) {}

  async load() {
    const rows = await readRows(this.client, this.userId);
    this.assets = new Map(rows.assets.map((a) => [a.id, a]));
    this.transactions = rows.transactions;
  }

  private query<R = Record<string, unknown>>(sql: string, values: unknown[]) {
    return this.client.query<R>(sql, [this.userId, ...values]);
  }

  private idOf(index: number, raw: string, field = 'id'): string {
    const id = canonicalUuid(raw);
    if (id === undefined) throw invalidOp(index, [{ field, code: 'invalid', value: raw }]);
    return id;
  }

  private assetOf(index: number, raw: string): Asset {
    const id = this.idOf(index, raw);
    const found = this.assets.get(id);
    if (found === undefined) {
      throw invalidOp(index, [{ field: 'id', code: 'unknown-asset-id', value: id }]);
    }
    return found;
  }

  private transactionOf(index: number, raw: string): Transaction {
    const id = this.idOf(index, raw);
    const found = this.transactions.find((t) => t.id === id);
    if (found === undefined) throw invalidOp(index, [{ field: 'id', code: 'invalid', value: id }]);
    return found;
  }

  /** The row's asset as the store keeps it: none on a portfolio row, one the dataset holds on the
   *  rest. */
  private linked(index: number, t: Transaction): string {
    if (t.assetId === '') {
      if (targetsAsset(t.type)) {
        throw invalidOp(index, [{ field: 'assetId', code: 'asset-missing-on-asset-row' }]);
      }
      return '';
    }
    const id = this.idOf(index, t.assetId, 'assetId');
    if (!targetsAsset(t.type)) {
      throw invalidOp(index, [{ field: 'assetId', code: 'invalid', value: t.assetId }]);
    }
    if (!this.assets.has(id)) {
      throw invalidOp(index, [{ field: 'assetId', code: 'unknown-asset-id', value: id }]);
    }
    return id;
  }

  private patched<T extends { id: string }>(index: number, target: T, patch: unknown): unknown {
    const merged = mergePatch(target, patch) as { id?: unknown };
    if (merged.id !== target.id) throw invalidOp(index, [{ field: 'id', code: 'invalid' }]);
    return merged;
  }

  private async insertPrices(date: string, prices: Priced[]): Promise<number> {
    if (prices.length === 0) return 0;
    const { rows } = await this.query(PRICES_INSERT, [
      date,
      prices.map((p) => p.assetId),
      prices.map((p) => String(p.price)),
      prices.map((p) => p.observedAt),
    ]);
    return rows.length;
  }

  private units(date: string) {
    return ledgerUnits(this.transactions, date).units;
  }

  async apply(op: Op, index: number): Promise<Record<string, unknown>> {
    switch (op.op) {
      case 'asset.add': {
        const id = this.idOf(index, op.asset.id);
        const asset: Asset = { ...op.asset, id };
        this.used += (await this.query(ASSET_INSERT, [id, ...assetColumns(asset)])).rows.length;
        this.assets.set(id, asset);
        return {};
      }
      case 'asset.patch': {
        const target = this.assetOf(index, op.id);
        const parsed = assetRecordSchema.safeParse(this.patched(index, target, op.patch));
        if (!parsed.success) throw invalidOp(index, rowIssueCodes('assets', parsed.error.issues));
        const asset: Asset = parsed.data;
        this.used += (
          await this.query(ASSET_UPDATE, [asset.id, ...assetColumns(asset)])
        ).rows.length;
        this.assets.set(asset.id, asset);
        return {};
      }
      case 'asset.delete': {
        const { id } = this.assetOf(index, op.id);
        const done = await deleteAsset(this.client, this.userId, id, this.maxRows - this.used);
        if ('needs' in done) {
          throw new Refusal(tooManyRows(index, this.used + done.needs, this.maxRows));
        }
        this.used += done.deleted;
        this.assets.delete(id);
        this.transactions = this.transactions.filter((t) => t.assetId !== id);
        return {};
      }
      case 'asset.prune': {
        const { id } = this.assetOf(index, op.id);
        const done = await pruneAsset(this.client, this.userId, id, this.maxRows - this.used);
        this.used += done.deleted;
        await this.load();
        return { remaining: done.remaining };
      }
      case 'transaction.add': {
        const id = this.idOf(index, op.transaction.id);
        const tx: Transaction = { ...op.transaction, id };
        tx.assetId = this.linked(index, tx);
        const { rows } = await this.query(TX_INSERT, [id, ...transactionColumns(tx)]);
        // Provisioning writes every account holder's account; a user without one is a fault.
        if (rows.length === 0) throw new Error('the caller has no account to record against');
        this.used += rows.length;
        this.transactions.push(tx);
        return {};
      }
      case 'transaction.patch': {
        const target = this.transactionOf(index, op.id);
        const parsed = transactionRecordSchema.safeParse(this.patched(index, target, op.patch));
        if (!parsed.success) {
          throw invalidOp(index, rowIssueCodes('transactions', parsed.error.issues));
        }
        const tx: Transaction = { ...parsed.data };
        tx.assetId = this.linked(index, tx);
        this.used += (await this.query(TX_UPDATE, [tx.id, ...transactionColumns(tx)])).rows.length;
        this.transactions = this.transactions.map((t) => (t.id === tx.id ? tx : t));
        return {};
      }
      case 'transaction.delete': {
        const { id } = this.transactionOf(index, op.id);
        this.used += (await this.query(TX_DELETE, [id])).rows.length;
        this.transactions = this.transactions.filter((t) => t.id !== id);
        return {};
      }
      case 'snapshot.put': {
        const { date, quotes, savedAt } = op.snapshot;
        const held: Record<string, number> = {};
        for (const [key, value] of Object.entries(quotes)) {
          const id = canonicalUuid(key);
          const issue = { field: `quotes.${key}`, value: key };
          if (id === undefined || !this.assets.has(id)) {
            throw invalidOp(index, [{ ...issue, code: 'unknown-quote-asset' }]);
          }
          if (Object.hasOwn(held, id))
            throw invalidOp(index, [{ ...issue, code: 'duplicate-key' }]);
          held[id] = value;
        }
        const { prices, dropped } = pricesOfQuotes(held, this.units(date));
        const observedAt = savedAt === undefined ? null : utc(savedAt);
        this.used += (await this.query(PRICES_DELETE_AT, [date])).rows.length;
        this.used += await this.insertPrices(
          date,
          prices.map((p) => ({ ...p, observedAt })),
        );
        return { dropped };
      }
      case 'snapshot.delete': {
        const { rows } = await this.query(PRICES_DELETE_AT, [op.date]);
        if (rows.length === 0) {
          throw invalidOp(index, [{ field: 'date', code: 'invalid', value: op.date }]);
        }
        this.used += rows.length;
        return {};
      }
      case 'snapshot.move': {
        // Any stored day refuses, one valuing nothing included: the export shows it.
        if ((await this.query(PRICES_AT, [op.to])).rows.length > 0) {
          throw invalidOp(index, [{ field: 'to', code: 'duplicate-key', value: op.to }]);
        }
        const from = (await this.query<PriceAt>(PRICES_AT, [op.from])).rows;
        if (from.length === 0) {
          throw invalidOp(index, [{ field: 'from', code: 'invalid', value: op.from }]);
        }
        const witnessed = new Map(from.map((r) => [r.asset_id, r.observed_at]));
        const { prices, dropped } = movedPrices(
          from.map((r) => ({ assetId: r.asset_id, price: Number(r.price) })),
          this.units(op.from),
          this.units(op.to),
        );
        this.used += (await this.query(PRICES_DELETE_AT, [op.from])).rows.length;
        this.used += await this.insertPrices(
          op.to,
          prices.map((p) => {
            const at = witnessed.get(p.assetId) ?? null;
            return { ...p, observedAt: at === null ? null : utc(at) };
          }),
        );
        return { dropped };
      }
      case 'dataset.clear': {
        // A new, empty generation the pointer moves to: one row whatever the old one holds.
        const id = this.deps.token();
        await this.query(DATASET_INSERT, [id]);
        await this.query(POINT, [id]);
        this.assets = new Map();
        this.transactions = [];
        return {};
      }
    }
  }
}

/** Every op's shape before any runs, so a refusal names the first malformed one. */
function validated(ops: unknown[]): Op[] {
  return ops.map((raw, index) => {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) throw invalidOp(index, opIssues(parsed.error.issues, raw));
    return parsed.data;
  });
}

/** The ops in one transaction, retried on a serialization failure after re-reading the key. */
async function apply(
  deps: MutationDeps,
  userId: string,
  key: string,
  token: string,
  ifMatch: string[],
  ops: unknown[],
): Promise<ApiResult> {
  const client = deps.user;
  const maxRows = deps.maxRows ?? MAX_ROWS;
  const release = () =>
    client
      .query(RELEASE, [userId, key, token])
      .catch((err: unknown) => console.error('mutations release failed', err));
  for (let attempt = 0; ; attempt += 1) {
    let index: number | undefined;
    try {
      await client.query('BEGIN');
      const [{ data_version: current }] = (
        await client.query<{ data_version: string }>(VERSION, [userId])
      ).rows;
      // A stale tag is 412, never retried: the rowcount is what makes the write conditional.
      if (!strongMatch(ifMatch, dataTag(current))) throw new Refusal(PRECONDITION_FAILED);
      const valid = validated(ops);
      const bumped = await client.query<{ data_version: string }>(BUMP, [userId, current]);
      if (bumped.rows.length === 0) throw new Refusal(PRECONDITION_FAILED);
      const run = new Run(client, userId, deps, maxRows);
      await run.load();
      const results: Record<string, unknown>[] = [];
      for (index = 0; index < valid.length; index += 1) {
        results.push(await run.apply(valid[index], index));
        if (run.used > maxRows) throw new Refusal(tooManyRows(index, run.used, maxRows));
      }
      index = undefined;
      const etag = dataTag(bumped.rows[0].data_version);
      const body = JSON.stringify({ etag, results });
      // The effect and the stored response commit together (the Builders' Library's ACID rule).
      if ((await client.query(DONE, [userId, key, token, body])).rows.length === 0) {
        throw new Refusal(IN_FLIGHT);
      }
      await client.query('COMMIT');
      return respond(MUTATED, { etag }, body);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (err instanceof Refusal) {
        await release();
        return err.answer;
      }
      const code = codeOf(err);
      if (code === '54000') {
        await release();
        return tooManyRows(index, undefined, maxRows);
      }
      if (index !== undefined && code !== undefined && /^2[23]/.test(code)) {
        await release();
        if (code === '23505') return duplicate(index).answer;
        const constraint = (err as { constraint?: unknown }).constraint;
        const value = typeof constraint === 'string' ? { value: constraint } : {};
        return invalidOp(index, [{ code: 'invalid', ...value }]).answer;
      }
      if (retryable(err)) {
        // The commit may have landed under the error, the last attempt's too: the key row says.
        const { rows } = await client.query<KeyRow>(READ_KEY, [userId, key]).catch(async (e) => {
          console.error('mutations commit conflict before a failed read', err);
          await release();
          throw e;
        });
        const [row] = rows;
        if (row?.token === token && row.response_body !== null) return replay(row.response_body);
        if (row?.token !== token) return IN_FLIGHT;
        if (attempt < RETRY_DELAYS_MS.length) {
          await deps.sleep(RETRY_DELAYS_MS[attempt]);
          continue;
        }
      }
      await release();
      throw err;
    }
  }
}

/** One list of ops, refused whole by the byte and op bounds before anything else reads it. */
function readBody(event: ApiEvent): ApiResult | { ops: unknown[] } {
  const raw = event.body ?? '';
  const decoded = event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  if (Buffer.byteLength(decoded, 'utf8') > MAX_BODY_BYTES) return TOO_LARGE;
  // zod drops a `__proto__` key before any schema sees it, so it is refused here, anywhere.
  let forbidden = false;
  let body: unknown;
  try {
    body = JSON.parse(decoded, (key: string, value: unknown) => {
      if (key === '__proto__') forbidden = true;
      return value;
    });
  } catch {
    return INVALID;
  }
  if (
    forbidden ||
    typeof body !== 'object' ||
    body === null ||
    Object.keys(body).join() !== 'ops' ||
    !Array.isArray((body as { ops: unknown }).ops)
  ) {
    return INVALID;
  }
  const { ops } = body as { ops: unknown[] };
  if (ops.length === 0) return INVALID;
  return ops.length > MAX_OPS ? TOO_MANY_OPS : { ops };
}

/** Up to a hundred of the caller's expired keys, after a success; nothing sweeps on a schedule. */
async function sweep(client: SqlClient, userId: string) {
  await client
    .query(SWEEP, [userId, SWEEP_LIMIT])
    .catch((err: unknown) => console.error('mutations sweep failed', err));
}

export async function mutations(deps: MutationDeps, event: ApiEvent): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    // RFC 9110 §13.2.1: the request's own checks first, the precondition just before the content.
    const body = readBody(event);
    if (!('ops' in body)) return body;
    const key = canonicalUuid(event.headers?.['idempotency-key']);
    if (key === undefined) return BAD_KEY;
    const ifMatch = headerValues(event, 'if-match');
    // `*` matches whatever exists, so it is no precondition at all (RFC 6585 §3).
    if (ifMatch.length === 0 || ifMatch.includes('*')) return PRECONDITION_REQUIRED;
    const userId = gate.caller.userId;
    const claimed = await claim(deps, userId, key, fingerprintOf(body));
    if ('answer' in claimed) return claimed.answer;
    const answer = await apply(deps, userId, key, claimed.token, ifMatch, body.ops);
    if (answer.statusCode === 200) await sweep(deps.user, userId);
    return answer;
  } catch (err) {
    console.error('mutations failed', err);
    return INTERNAL;
  }
}

const byCreated = (a: Asset, b: Asset) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
const byDate = (a: Transaction, b: Transaction) =>
  a.date.localeCompare(b.date) || a.id.localeCompare(b.id);

/** The live dataset in the model's shape, for export: the snapshots rebuilt from stored prices. */
export async function state(
  deps: Pick<MutationDeps, 'user'>,
  event: ApiEvent,
): Promise<ApiResult | EmptyResult> {
  try {
    const gate = await authorize(deps.user, event);
    if ('refusal' in gate) return gate.refusal;
    const ledger = await readLedger(deps.user, gate.caller.userId);
    const etag = dataTag(ledger.dataVersion);
    const ifMatch = headerValues(event, 'if-match');
    if (ifMatch.length > 0 && !strongMatch(ifMatch, etag)) return PRECONDITION_FAILED;
    if (weakMatch(headerValues(event, 'if-none-match'), etag)) {
      return notModified(STATE_UNCHANGED, { etag, 'cache-control': NO_STORE });
    }
    const body = {
      assets: [...ledger.assets].sort(byCreated),
      transactions: [...ledger.transactions].sort(byDate),
      snapshots: snapshotsOfPrices(ledger.transactions, ledger.userPrices, ledger.savedAt),
    };
    return respond(STATE, { etag, 'cache-control': NO_STORE }, JSON.stringify(body));
  } catch (err) {
    console.error('state failed', err);
    return INTERNAL;
  }
}

export async function handler(event: ApiEvent): Promise<ApiResult | EmptyResult> {
  const user = await connect().catch((err: unknown) => {
    console.error('mutations connect failed', err);
    return undefined;
  });
  if (user === undefined) return INTERNAL;
  try {
    const deps: MutationDeps = {
      user,
      token: randomUUID,
      sleep,
    };
    if (event.routeKey === STATE_ROUTE) return await state(deps, event);
    if (event.routeKey === MUTATIONS_ROUTE) return await mutations(deps, event);
    return INTERNAL;
  } finally {
    await user.end().catch((err: unknown) => console.error('mutations disconnect failed', err));
  }
}
