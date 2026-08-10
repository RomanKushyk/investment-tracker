// The daily capture. Fetches the Inzhur feed and stores the RAW payload — no
// observation rows, no derived values. Phase 1 exists to accumulate evidence,
// not to commit to a schema (docs/superpowers/specs/2026-08-04-data-model.md).
//
// Every run writes a row, including a failed one: `price_capture` — never the
// absence of a price row — is what answers "did the job run on day D".
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

import { kyivDateIso } from '../../src/core/dates';
import { parseAssetsFeed } from '../../src/core/inzhur/parse';

/** Bumped whenever the parse changes shape. Stored per row so that, if the
 *  parser was ever wrong, the affected rows are identifiable rather than
 *  archaeological. */
const PARSER_VERSION = '1';

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/**
 * Server-side there is no CORS, so D19's "send zero headers" rule does not
 * bind — but an explicit User-Agent is mandatory for the opposite reason:
 * Inzhur's CloudFront answers 403 to a request with no UA, and Node's http
 * client sends none by default. Browsers always send one, which is why this
 * never surfaced while the fetch lived in the SPA.
 */
const USER_AGENT = 'kubushka-price-capture/1.0 (+https://dev.d17m4jf400my6.amplifyapp.com)';

interface FetchOutcome {
  ok: boolean;
  httpStatus?: number;
  body?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry only what a retry can fix. A 403 or 404 means the endpoint's terms
 * changed, and hammering a public marketing endpoint we have no contract with
 * is the single most likely way to lose access to a resource that has no
 * substitute.
 */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

async function fetchFeed(url: string): Promise<FetchOutcome> {
  let last: FetchOutcome = { ok: false, error: 'no attempt made' };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        last = { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
        if (!isRetryable(response.status)) return last;
      } else {
        // .text(), not .json(): the raw body is what gets hashed and stored, and
        // a re-parse later must see exactly the bytes we saw.
        return { ok: true, httpStatus: response.status, body: await response.text() };
      }
    } catch (err) {
      last = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
    if (attempt < MAX_ATTEMPTS) await sleep(attempt === 1 ? 30_000 : 300_000);
  }
  return last;
}

/**
 * The as-of date: the calendar day these prices are FOR.
 *
 * The feed refreshes ~13:00 Europe/Kyiv, so the 01:00 run reads the price
 * settled the previous day. The subtraction MUST happen on the Kyiv date, not
 * the UTC one — at 01:00 Kyiv the UTC date is already the previous day, so
 * subtracting from the UTC date silently yields D-2.
 */
export function asOfFor(now: Date): string {
  const kyiv = kyivDateIso(now); // yyyy-MM-dd, Kyiv wall clock
  // Pinning the Kyiv date to UTC midnight makes the subtraction plain integer
  // day arithmetic — no local-time DST shift can move it, and month/year
  // rollover is handled by the Date implementation rather than by hand.
  const prev = new Date(`${kyiv}T00:00:00Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  return prev.toISOString().slice(0, 10);
}

async function connect(): Promise<Client> {
  const hostname = process.env.DSQL_ENDPOINT!;
  const region = process.env.AWS_REGION_NAME ?? process.env.AWS_REGION!;

  // IAM auth: the token is the password and is short-lived, so it is minted per
  // invocation and never stored. This is also why the browser can never talk to
  // DSQL directly — it cannot hold AWS credentials — and why every read and
  // write goes through Lambda by construction.
  const token = await new DsqlSigner({ hostname, region }).getDbConnectAdminAuthToken();

  const client = new Client({
    host: hostname,
    port: 5432,
    database: 'postgres', // DSQL provides exactly one database per cluster
    user: 'admin',
    password: token,
    ssl: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

/**
 * DSQL allows ONE DDL statement per transaction and forbids mixing DDL with
 * DML, so the table and its index are each their own statement and neither may
 * share a transaction with the insert below.
 */
async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS price_capture (
      id UUID NOT NULL, requested_at TIMESTAMPTZ NOT NULL, as_of DATE NOT NULL,
      ok BOOLEAN NOT NULL, http_status INT, error TEXT,
      entry_count INT, skipped_refs TEXT,
      payload_gzip BYTEA NOT NULL, payload_bytes INT NOT NULL,
      payload_sha256 TEXT NOT NULL, parser_version TEXT NOT NULL,
      PRIMARY KEY (id))`);
  // No DESC: DSQL rejects a sort direction in index keys outright ("specifying
  // sort order not supported for index keys"). Immaterial here — the planner
  // can walk an ascending index backwards, and at ~365 rows/year the direction
  // never decides a query plan anyway.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
       ON price_capture (as_of, requested_at)`,
  );
}

export async function handler(): Promise<{ ok: boolean; asOf: string; entries: number }> {
  const requestedAt = new Date();
  const asOf = asOfFor(requestedAt);
  const outcome = await fetchFeed(process.env.FEED_URL!);

  let entryCount: number | null = null;
  let skipped: string | null = null;
  let error = outcome.error ?? null;

  if (outcome.ok && outcome.body !== undefined) {
    try {
      // The SAME parser the app uses, imported from src/core rather than
      // reimplemented — otherwise client and server eventually disagree about
      // a price. Its result is recorded as metadata only; nothing derived from
      // it is stored in Phase 1.
      const feed = parseAssetsFeed(JSON.parse(outcome.body));
      entryCount = feed.entries.length;
      skipped = feed.skipped.join(',');
      // Zero readable entries means shape drift or an error page. Recorded as a
      // failure so the alarm fires — but the payload is still stored below,
      // because a payload we cannot parse today is exactly what a future parser
      // fix needs to read.
      if (entryCount === 0) error = 'feed parsed to zero entries';
    } catch (err) {
      error = `parse failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  const body = outcome.body ?? '';
  const client = await connect();
  try {
    await ensureSchema(client);
    await client.query(
      `INSERT INTO price_capture (id, requested_at, as_of, ok, http_status, error,
         entry_count, skipped_refs, payload_gzip, payload_bytes, payload_sha256, parser_version)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        requestedAt.toISOString(),
        asOf,
        outcome.ok && error === null,
        outcome.httpStatus ?? null,
        error,
        entryCount,
        skipped,
        gzipSync(Buffer.from(body, 'utf8')),
        Buffer.byteLength(body, 'utf8'),
        // Hash the DECODED text, never the wire bytes: the server may negotiate
        // a different Content-Encoding, which would make every hash unique and
        // silently disable change detection without any error.
        createHash('sha256').update(body, 'utf8').digest('hex'),
        PARSER_VERSION,
      ],
    );
  } finally {
    await client.end();
  }

  // Throwing is what drives the Errors alarm and the DLQ. The row is already
  // committed, so the failure is both recorded and surfaced.
  if (error !== null) throw new Error(`capture ${asOf}: ${error}`);
  return { ok: true, asOf, entries: entryCount ?? 0 };
}
