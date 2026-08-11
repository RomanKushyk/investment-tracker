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

/**
 * Which feed a row came from. Not a lookup table — six values will never
 * justify one.
 *
 * `inzhur` is the provider's own dealer quote (contractually "Базова ціна",
 * cl. 1.4 of their services agreement: the price INZHUR offers to buy/sell at).
 * `nbu_fv` will be the National Bank's official daily fair value for ОВДП.
 *
 * They are NOT substitutes: measured on the same day for the same ISIN they
 * differ by ~0.9%, because one is a dealer quote and the other a model
 * valuation. Storing them without distinguishing the source would silently
 * present one as the other.
 */
export const SOURCE = {
  inzhur: 'inzhur',
  nbuFairValue: 'nbu_fv',
} as const;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/**
 * Server-side there is no CORS, so D19's "send zero headers" rule does not
 * bind — but an explicit User-Agent is mandatory for the opposite reason:
 * Inzhur's CloudFront answers 403 to a request with no UA, and Node's http
 * client sends none by default. Browsers always send one, which is why this
 * never surfaced while the fetch lived in the SPA.
 */
const USER_AGENT = 'quirenote-price-capture/1.0 (+https://dev.d17m4jf400my6.amplifyapp.com)';

interface FetchOutcome {
  ok: boolean;
  httpStatus?: number;
  body?: string;
  error?: string;
}

/**
 * The NBU's official daily fair value for Ukrainian government bonds, published
 * under Постанова Правління НБУ № 732 (26.10.2015). One file per BUSINESS day on
 * a fully predictable path, archived back to 2016-01-04 (2015-01-05 → 404).
 *
 * This is why the two ОВДП are not perishable the way the two Inzhur funds are:
 * a missed day here is downloadable later, so only the fund NAVs are genuinely
 * the-only-copy-that-will-ever-exist.
 *
 * Note it is a MODEL valuation, not a quote, and not a substitute for the
 * provider's dealer price — they measured ~0.9% apart on the same ISIN the same
 * day. Both are stored, distinguished by `source`.
 */
function nbuFairValueUrl(asOf: string): string {
  const d = asOf.replaceAll('-', ''); // yyyy-MM-dd -> yyyyMMdd
  return `https://bank.gov.ua/files/Fair_value/${d.slice(0, 6)}/${d}_fv.txt`;
}

/** A weekend or public holiday. The file simply does not exist, which is a fact
 *  about the calendar rather than a failure — recorded, never alarmed on. */
const NOT_PUBLISHED = 'not_published';

async function fetchNbu(asOf: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(nbuFairValueUrl(asOf), {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    if (response.status === 404) {
      return { ok: false, httpStatus: 404, error: NOT_PUBLISHED, body: '' };
    }
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
    }
    // cp1251, NOT utf-8: the file carries Cyrillic instrument types (ОВДП /
    // ОВМП) and a utf-8 read turns them into mojibake without erroring.
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      httpStatus: response.status,
      body: new TextDecoder('windows-1251').decode(bytes),
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** ISINs the portfolio actually holds. Their absence from a published file is
 *  the signal worth alarming on — a bond matured, was renamed, or the file
 *  changed shape. */
const TRACKED_ISINS = ['UA4000238976', 'UA4000236475'];

interface ParsedNbu {
  rows: number;
  missing: string[];
  quotesDigest: string;
}

/**
 * A hash over the PRICE-BEARING FIELDS ONLY — never the whole payload.
 *
 * Measured: two Inzhur captures seconds apart differed by 6 bytes because
 * `availableQuantity` ticks with live sales. So `payload_sha256` is unique on
 * every fetch and cannot detect "the prices did not move". This digest can.
 *
 * Sorted before hashing so that a reordered feed is not mistaken for a changed
 * one — the feed makes no ordering guarantee.
 */
function digestOf(parts: string[]): string {
  return createHash('sha256').update(parts.sort().join('\n'), 'utf8').digest('hex');
}

/**
 * Parse by FIXED INDEX, never by zipping the header against the row.
 *
 * The header is malformed: its 18th semicolon-separated field is literally
 * `g_spread,z_spread,cptype` — three comma-separated names — while the data
 * rows carry only `cptype` there. Zipping header to row therefore mislabels the
 * tail and silently invents two columns that do not exist in the data.
 *
 * Index map, verified against the live file: 0 calc_date · 1 cpcode (ISIN) ·
 * 2 ccy · 3 fair_value · 4 ytm · 5 clean_rate · 7 maturity · 17 cptype.
 */
function parseNbu(body: string): ParsedNbu {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() !== '');
  const data = lines.slice(1); // drop the header row
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const line of data) {
    const f = line.split(';');
    const isin = f[1]?.trim();
    if (isin === undefined || isin === '') continue;
    seen.add(isin);
    // fair_value + ytm: the two numbers that must move if the file is live.
    parts.push(`${isin}:${f[3] ?? ''}:${f[4] ?? ''}`);
  }
  return {
    rows: data.length,
    missing: TRACKED_ISINS.filter((i) => !seen.has(i)),
    quotesDigest: digestOf(parts),
  };
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
      source TEXT, ok BOOLEAN NOT NULL, http_status INT, error TEXT,
      entry_count INT, skipped_refs TEXT,
      payload_gzip BYTEA NOT NULL, payload_bytes INT NOT NULL,
      payload_sha256 TEXT NOT NULL, parser_version TEXT NOT NULL,
      PRIMARY KEY (id))`);

  // Migration for the cluster that already holds rows. Its own statement: DSQL
  // permits one DDL per transaction and forbids mixing DDL with DML.
  await client.query('ALTER TABLE price_capture ADD COLUMN IF NOT EXISTS source TEXT');

  // Backfill the pre-source rows. Every row written before this column existed
  // came from the Inzhur feed, because it was the only source. Idempotent, and
  // a no-op once done.
  await client.query(`UPDATE price_capture SET source = $1 WHERE source IS NULL`, [SOURCE.inzhur]);

  // A hash over the price fields alone — see digestOf. Deliberately separate
  // from payload_sha256, which is unique on every fetch and therefore useless
  // for detecting a frozen upstream. Not backfillable for rows written before
  // it existed, which is precisely why it goes in now.
  await client.query('ALTER TABLE price_capture ADD COLUMN IF NOT EXISTS quotes_sha256 TEXT');
  // No DESC: DSQL rejects a sort direction in index keys outright ("specifying
  // sort order not supported for index keys"). Immaterial here — the planner
  // can walk an ascending index backwards, and at ~365 rows/year the direction
  // never decides a query plan anyway.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
       ON price_capture (as_of, requested_at)`,
  );
}

interface CaptureResult {
  source: string;
  asOf: string;
  ok: boolean;
  entries: number;
  error: string | null;
  /** Consecutive BUSINESS days ending today whose price digest is unchanged. */
  unchangedDays?: number;
}

/**
 * How many consecutive business days, ending with this capture, carry an
 * identical price digest.
 *
 * Business days only. Counting calendar days would report a streak of 3 every
 * Monday, because a Saturday and Sunday capture legitimately repeat Friday's
 * price — the alarm would fire weekly and be muted within a month.
 *
 * Derived from stored hashes rather than kept as a counter column: a
 * denormalised streak drifts the moment a row is backfilled or re-captured out
 * of order, and this is cheap at 15 rows.
 */
async function unchangedStreak(
  client: Client,
  source: string,
  digest: string,
  asOf: string,
): Promise<number> {
  const { rows } = await client.query<{ quotes_sha256: string | null; as_of: string }>(
    `SELECT quotes_sha256, to_char(as_of, 'YYYY-MM-DD') AS as_of
       FROM price_capture
      WHERE source = $1 AND ok = true AND quotes_sha256 IS NOT NULL
      ORDER BY as_of DESC, requested_at DESC
      LIMIT 60`,
    [source],
  );

  // ONE row per date. A date can hold several captures — a manual re-invoke, a
  // repaired day, a scheduler retry — and counting rows instead of dates turned
  // two captures of the same afternoon into a two-day streak. Caught by
  // invoking twice in a row; the ordering above makes the first row seen for a
  // date the newest one, which is the one that counts.
  const latestPerDate = new Map<string, string | null>();
  for (const r of rows) {
    if (!latestPerDate.has(r.as_of)) latestPerDate.set(r.as_of, r.quotes_sha256);
  }

  let streak = 1; // the capture being written now
  for (const [date, hash] of latestPerDate) {
    // The date being captured is already counted as that 1. Re-capturing a day
    // must not make its own streak grow.
    if (date === asOf || isWeekend(date)) continue;
    if (hash !== digest) break;
    streak += 1;
  }
  return streak;
}

/**
 * Business days of identical prices before it is worth saying so.
 *
 * Deliberately loose and env-tunable rather than fixed at the 2–3 the research
 * suggested: the right value is an empirical question about how often OVDP
 * quotes genuinely sit flat, and nobody has 30 days of data yet. A threshold
 * that cries wolf gets muted, and a muted alarm is worse than none.
 */
const STALE_AFTER_DAYS = Number(process.env.STALE_AFTER_DAYS ?? '5');

/**
 * One source, one date, one row. ALWAYS writes — including a 404 weekend and a
 * hard failure — because the invariant this table exists to hold is that a
 * missing row means "we never looked", never "we looked and there was nothing".
 * That is what makes a gap in the archive diagnosable at all.
 */
async function captureOne(client: Client, source: string, asOf: string): Promise<CaptureResult> {
  const requestedAt = new Date();
  const outcome =
    source === SOURCE.nbuFairValue ? await fetchNbu(asOf) : await fetchFeed(process.env.FEED_URL!);

  let entryCount: number | null = null;
  let skipped: string | null = null;
  let error = outcome.error ?? null;
  let digest: string | null = null;

  if (outcome.ok && outcome.body !== undefined && outcome.body !== '') {
    try {
      if (source === SOURCE.nbuFairValue) {
        const parsed = parseNbu(outcome.body);
        entryCount = parsed.rows;
        skipped = parsed.missing.join(',');
        digest = parsed.quotesDigest;
        // A published file that omits a bond we hold is the signal worth having:
        // it matured, was renamed, or the file changed shape.
        if (parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
        else if (parsed.rows === 0) error = 'file parsed to zero rows';
      } else {
        // The SAME parser the app uses, imported from src/core rather than
        // reimplemented — otherwise client and server eventually disagree about
        // a price. Its result is metadata only; nothing derived is stored.
        const feed = parseAssetsFeed(JSON.parse(outcome.body));
        entryCount = feed.entries.length;
        skipped = feed.skipped.join(',');
        // Prices only. availableQuantity and the marketing fields are excluded
        // on purpose — they change constantly and would mask a frozen price.
        digest = digestOf(
          feed.entries.map(
            (e) => `${e.kind}:${e.ref.toLowerCase()}:${e.sellUAH}:${e.buyUAH ?? ''}:${e.navUAH ?? ''}`,
          ),
        );
        // Zero readable entries means shape drift or an error page. Recorded as
        // a failure so the alarm fires — but the payload is still stored,
        // because a payload we cannot parse today is exactly what a future
        // parser fix needs to read.
        if (entryCount === 0) error = 'feed parsed to zero entries';
      }
    } catch (err) {
      error = `parse failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // Only meaningful for a capture that actually parsed, and only when the date
  // is a business day — a weekend capture repeating Friday is not a symptom.
  let unchangedDays: number | undefined;
  if (digest !== null && error === null && !isWeekend(asOf)) {
    unchangedDays = await unchangedStreak(client, source, digest, asOf);

    // Emitted on EVERY business-day capture, not only when stale. A metric that
    // exists only on failure cannot distinguish "healthy" from "the check
    // stopped running" — both look like no data. Publishing the value always
    // makes the mechanism's own liveness observable, which is the difference
    // between a check you trust and one you have to remember to verify.
    //
    // JSON so the metric filter can extract the numeric value and the source
    // dimension by JSON path rather than by column position.
    console.log(
      JSON.stringify({ metric: 'unchangedDays', source, asOf, value: unchangedDays }),
    );

    if (unchangedDays >= STALE_AFTER_DAYS) {
      // A distinct, greppable line rather than a thrown error. A frozen
      // upstream is not a transient fault: throwing would make EventBridge
      // retry three times and write three more rows for the same day, none of
      // which would help. A metric filter turns this into an alarm instead.
      console.warn(
        `STALE_PRICES source=${source} asOf=${asOf} unchangedBusinessDays=${unchangedDays}`,
      );
    }
  }

  const body = outcome.body ?? '';
  await client.query(
    `INSERT INTO price_capture (id, requested_at, as_of, source, ok, http_status, error,
       entry_count, skipped_refs, payload_gzip, payload_bytes, payload_sha256, quotes_sha256,
       parser_version)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      requestedAt.toISOString(),
      asOf,
      source,
      outcome.ok && error === null,
      outcome.httpStatus ?? null,
      error,
      entryCount,
      skipped,
      gzipSync(Buffer.from(body, 'utf8')),
      Buffer.byteLength(body, 'utf8'),
      // Hash the DECODED text, never the wire bytes: the server may negotiate a
      // different Content-Encoding, which would make every hash unique and
      // silently disable change detection without any error.
      createHash('sha256').update(body, 'utf8').digest('hex'),
      digest,
      PARSER_VERSION,
    ],
  );

  return {
    source,
    asOf,
    ok: error === null,
    entries: entryCount ?? 0,
    error,
    ...(unchangedDays === undefined ? {} : { unchangedDays }),
  };
}

/** Business day in the Gregorian sense only — Ukrainian public holidays are not
 *  encoded here deliberately. NBU simply publishes no file on them, which the
 *  404 path already records correctly, and a hardcoded holiday calendar would
 *  be one more thing to maintain and get wrong. */
function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Earliest NBU fair-value file that exists. Verified: 2016-01-04 → 200,
 *  2015-01-05 → 404. */
export const NBU_ARCHIVE_START = '2016-01-04';

interface BackfillRequest {
  from?: string;
  to?: string;
  limit?: number;
}

/**
 * Walk the NBU archive forward, skipping dates already captured. Bounded per
 * invocation and returns a cursor, so the caller loops rather than fighting the
 * Lambda timeout. Idempotent: re-running re-reads `done` and continues.
 */
async function backfillNbu(client: Client, req: BackfillRequest) {
  const from = req.from ?? NBU_ARCHIVE_START;
  const to = req.to ?? asOfFor(new Date());
  const limit = req.limit ?? 200;

  const { rows } = await client.query<{ as_of: string }>(
    `SELECT DISTINCT to_char(as_of, 'YYYY-MM-DD') AS as_of
       FROM price_capture WHERE source = $1 AND as_of BETWEEN $2 AND $3`,
    [SOURCE.nbuFairValue, from, to],
  );
  const done = new Set(rows.map((r) => r.as_of));

  let captured = 0;
  let published = 0;
  let cursor = from;
  for (let d = from; d <= to && captured < limit; d = addDays(d, 1)) {
    cursor = d;
    if (isWeekend(d) || done.has(d)) continue;
    const res = await captureOne(client, SOURCE.nbuFairValue, d);
    captured += 1;
    if (res.ok) published += 1;
  }

  const nextFrom = addDays(cursor, 1);
  return {
    mode: 'backfill' as const,
    from,
    to,
    captured,
    published,
    complete: nextFrom > to,
    nextFrom: nextFrom > to ? null : nextFrom,
  };
}

export interface HandlerEvent {
  /** Absent for the scheduled run: capture today from every source. */
  backfill?: BackfillRequest;
  /** Manual re-capture of one date, e.g. to repair a bad day. */
  asOf?: string;
}

export async function handler(event: HandlerEvent = {}) {
  const client = await connect();
  try {
    await ensureSchema(client);

    if (event.backfill !== undefined) return await backfillNbu(client, event.backfill);

    // ONE automation, two sources: both are captured in a single scheduled run
    // rather than as two schedules. Same as_of rule serves both — Inzhur's
    // prices settle at ~13:00 the previous day, and NBU publishes day D's file
    // at ~09:30 on day D, so a 01:00 run on D+1 finds both.
    const asOf = event.asOf ?? asOfFor(new Date());
    const results: CaptureResult[] = [];
    for (const source of [SOURCE.inzhur, SOURCE.nbuFairValue]) {
      results.push(await captureOne(client, source, asOf));
    }

    // A weekend 404 from NBU is not a failure — it is the calendar. Only real
    // problems reach the alarm.
    const failed = results.filter((r) => !r.ok && r.error !== NOT_PUBLISHED);
    if (failed.length > 0) {
      throw new Error(
        `capture ${asOf}: ` + failed.map((f) => `${f.source}: ${f.error}`).join('; '),
      );
    }
    return { asOf, results };
  } finally {
    await client.end();
  }
}
