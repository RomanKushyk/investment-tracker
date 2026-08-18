// The daily capture. Fetches the Inzhur feed and stores the RAW payload — no
// observation rows, no derived values. Phase 1 exists to accumulate evidence,
// not to commit to a schema (docs/superpowers/specs/2026-08-04-data-model.md).
//
// Every run writes a row, including a failed one: `price_capture` — never the
// absence of a price row — is what answers "did the job run on day D".
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { BackupClient, ListRecoveryPointsByBackupVaultCommand } from '@aws-sdk/client-backup';
import {
  ListChannelsCommand,
  ListNotificationConfigurationsCommand,
  NotificationsClient,
} from '@aws-sdk/client-notifications';
import { DsqlSigner } from '@aws-sdk/dsql-signer';
import { Client } from 'pg';

import { kyivDateIso } from '../../src/core/dates';
// Re-exported so the deploy's bundle smoke test can reach them (D71).
export { inzhurAsOf, nbuAsOf } from './dates';
import { inzhurAsOf, nbuAsOf } from './dates';
import { parseAssetsFeed } from '../../src/core/inzhur/parse';
import { parseNbuFairValue } from '../../src/core/nbu/fair-value';

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
const USER_AGENT = 'quirenote-price-capture/1.0 (+https://quirenote.com)';

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

/**
 * The refs the Inzhur feed must still carry, and the SAME idea as
 * `TRACKED_ISINS` one source over: a feed that stops listing something we hold
 * is the shape change worth being told about (A20).
 *
 * Refs, not ISINs, because Inzhur serves both kinds and D30 fixed the rule —
 * `isin` for bonds, `slug` for funds. The bonds repeat `TRACKED_ISINS` rather
 * than importing it: NBU's list is what a national file must contain, this one
 * is what one provider must list, and the day they diverge is the day sharing
 * them would be a bug.
 *
 * The same stopgap caveat applies as above: the real home is `listed_from` /
 * `retired_at` on `instrument`. Until then a delisting shows up here as an
 * alarm and is answered by editing this line, which is the honest cost of not
 * having the table yet.
 */
const TRACKED_INZHUR_REFS = ['UA4000238976', 'UA4000236475', 'inzhur-reit', 'inzhur-energy'];

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
    // 30s then 60s — NOT the 300s this used to wait. That value made the third
    // attempt unreachable: 10 + 30 + 10 + 300 = 350s of a 300s Lambda timeout,
    // so the function was killed while sleeping and the attempt it was waiting
    // for never ran. Both sources share one invocation, so the budget is per
    // run, not per source.
    //
    // Short backoff is also the right shape now: these attempts exist for a
    // blip — a 502 from a load balancer, a reset connection — while a provider
    // that is genuinely down is answered by the schedule firing again in two
    // hours (template.yaml), which is a wait no Lambda should be paid to sit
    // through.
    if (attempt < MAX_ATTEMPTS) await sleep(attempt === 1 ? 30_000 : 60_000);
  }
  return last;
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

  // Leads with `source`, which is what both operational queries actually filter
  // on — and neither could use the index above, because an index is only usable
  // from its leading column. Measured 2026-08-11 before adding it: both queries
  // did a full scan of 6,628 rows to return 3, at ~730 ms each
  // (`Rows Removed by Filter: 6625`).
  //
  // `requested_at` is the third key so the streak query's ORDER BY is served by
  // the same index. No DESC anywhere: DSQL rejects a sort direction in index
  // keys outright, and the planner can walk an ascending index backwards.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_capture_source_as_of
       ON price_capture (source, as_of, requested_at)`,
  );

  // Phase 2. Contracts pinned in migrations/002_price_observation.sql — read
  // that file before touching the key here. It is IMMUTABLE: changing it is a
  // DROP/CREATE of a live archive, not a migration.
  await client.query(`
    CREATE TABLE IF NOT EXISTS price_observation (
      as_of DATE NOT NULL, instrument_ref TEXT NOT NULL,
      basis TEXT NOT NULL, source TEXT NOT NULL,
      price NUMERIC NOT NULL, observed_at TIMESTAMPTZ NOT NULL,
      parser_version TEXT NOT NULL,
      ytm NUMERIC, clean_rate NUMERIC,
      return_rate_buy NUMERIC, return_rate_sell NUMERIC, status TEXT,
      PRIMARY KEY (as_of, instrument_ref, basis, source))`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS instrument (
      ref TEXT NOT NULL, kind TEXT NOT NULL, currency TEXT, cp_type TEXT,
      maturity DATE, listed_from DATE, last_seen_on DATE,
      PRIMARY KEY (ref))`);

  // The primary key leads with `as_of` because the read contract serves whole
  // years; "this instrument over time" needs its own leading column (A2/D48).
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_observation_ref_as_of
       ON price_observation (instrument_ref, as_of)`,
  );
}

interface CaptureResult {
  source: string;
  asOf: string;
  ok: boolean;
  entries: number;
  /** How many entries the parser could not read. Published, never alarmed (A20). */
  skipped: number;
  error: string | null;
}

/**
 * One source, one date, one row. ALWAYS writes — including a 404 weekend and a
 * hard failure — because the invariant this table exists to hold is that a
 * missing row means "we never looked", never "we looked and there was nothing".
 * That is what makes a gap in the archive diagnosable at all.
 */
/**
 * `expectTracked` — whether a file that omits TRACKED_ISINS is a problem.
 *
 * True for the daily capture: an instrument vanishing from today's file really
 * does mean it matured, was renamed, or the file changed shape, and that is the
 * signal worth having.
 *
 * False for a backfill, where absence is the calendar rather than a fault —
 * both bonds were issued in 2025-2026, so no file from 2020 can contain them.
 * Applying the check unconditionally marked EVERY historical date as an error
 * (D43), which is what made a working backfill look like a broken one.
 *
 * This is the stopgap. The real home for it is `listed_from` / `retired_at` on
 * `instrument`, which the data model specifies for exactly this distinction:
 * telling "missing" apart from "did not exist yet".
 *
 */
/**
 * Has this source already produced a usable answer for this date?
 *
 * Keyed on `ok = true`, NEVER on a row existing. That distinction is D43's
 * lesson paid for once already: the NBU backfill's completeness check asked
 * whether a row EXISTED, so ~1,200 dates filled by a defective run were skipped
 * forever by an ordinary re-run. A failed capture writes a row too — treating
 * that as "done" would turn the six firings into one firing with extra steps.
 *
 * `not_published` counts as settled on purpose. NBU publishes nothing on a
 * weekend, and that is the calendar rather than a failure (the scheduled path
 * already excludes it from the alarm). Without this, every Saturday would spend
 * six firings re-asking NBU for a file that will never exist.
 */
async function alreadySettled(client: Client, source: string, asOf: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM price_capture
      WHERE source = $1 AND as_of = $2 AND (ok = true OR error = $3)
      LIMIT 1`,
    [source, asOf, NOT_PUBLISHED],
  );
  return res.rows.length > 0;
}

async function captureOne(
  client: Client,
  source: string,
  asOf: string,
  { expectTracked = true }: { expectTracked?: boolean } = {},
): Promise<CaptureResult> {
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
        if (expectTracked && parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
        else if (parsed.rows === 0) error = 'file parsed to zero rows';
      } else {
        // The SAME parser the app uses, imported from src/core rather than
        // reimplemented — otherwise client and server eventually disagree about
        // a price. Its result is metadata only; nothing derived is stored.
        const feed = parseAssetsFeed(JSON.parse(outcome.body));
        entryCount = feed.entries.length;
        // `ref:reason` per entry, so the archive records WHY an asset dropped
        // out and not merely that it did — a renamed field is the likeliest
        // cause and the only one a bare ref list cannot distinguish.
        skipped = feed.skipped.map((s) => `${s.ref}:${s.reason}`).join(',');
        // Prices only. availableQuantity and the marketing fields are excluded
        // on purpose — they change constantly and would mask a frozen price.
        digest = digestOf(
          feed.entries.map(
            (e) => `${e.kind}:${e.ref.toLowerCase()}:${e.sellUAH}:${e.buyUAH ?? ''}:${e.navUAH ?? ''}`,
          ),
        );
        // SHAPE, NEVER VALUES (A20, owner ruling). What the capture asserts is
        // that the feed still LISTS what it should, never that a number moved:
        // a price may sit still for maintenance, a weekend, a holiday or a
        // holiday moved to the Monday after, and alarming on that manufactures
        // work where there is no fault.
        //
        // Measured before choosing this shape: `skipped_refs` has been empty on
        // every Inzhur capture, and `entry_count` has only ever GROWN (34 → 35
        // → 36), so a floor under the count would have been a threshold guessed
        // from one week — and the first delisting would have made it wrong.
        // Naming the refs needs no threshold at all and says what we actually
        // care about.
        const present = new Set(feed.entries.map((e) => e.ref.toLowerCase()));
        const absent = TRACKED_INZHUR_REFS.filter((r) => !present.has(r.toLowerCase()));
        // Zero readable entries means shape drift or an error page. Recorded as
        // a failure so the alarm fires — but the payload is still stored,
        // because a payload we cannot parse today is exactly what a future
        // parser fix needs to read.
        if (entryCount === 0) error = 'feed parsed to zero entries';
        else if (expectTracked && absent.length > 0)
          error = `tracked ref absent: ${absent.join(',')}`;
      }
    } catch (err) {
      error = `parse failed: ${err instanceof Error ? err.message : String(err)}`;
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
    skipped: skipped === null || skipped === '' ? 0 : skipped.split(',').length,
    error,
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
  /**
   * Re-capture dates that already have a row, instead of skipping them.
   *
   * The completeness check asks whether a row EXISTS, never whether it
   * succeeded — so a range filled by a defective run is skipped forever by an
   * ordinary re-run, and the defect becomes permanent (D43). This is the way
   * out, and it is deliberately opt-in: the default must stay "skip what is
   * done", or an accidental invocation re-fetches a decade of files.
   *
   * Append, never overwrite. The table's primary key is `id`, the archive is
   * meant to be append-only, and every consumer already takes the newest row
   * per date — so a corrected row simply lands beside the wrong one and wins,
   * while the original stays visible as the record of what was believed.
   */
  force?: boolean;
}

/**
 * Walk the NBU archive forward, skipping dates already captured. Bounded per
 * invocation and returns a cursor, so the caller loops rather than fighting the
 * Lambda timeout. Idempotent: re-running re-reads `done` and continues — unless
 * `force` is set, which re-captures regardless and appends a fresh row.
 */
async function backfillNbu(client: Client, req: BackfillRequest) {
  const from = req.from ?? NBU_ARCHIVE_START;
  const to = req.to ?? nbuAsOf(new Date());
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
    if (isWeekend(d) || (!req.force && done.has(d))) continue;
    const res = await captureOne(client, SOURCE.nbuFairValue, d, { expectTracked: false });
    captured += 1;
    if (res.ok) published += 1;
  }

  const nextFrom = addDays(cursor, 1);
  return {
    mode: 'backfill' as const,
    from,
    to,
    forced: req.force === true,
    captured,
    published,
    complete: nextFrom > to,
    nextFrom: nextFrom > to ? null : nextFrom,
  };
}

/**
 * Report how many delivery channels the alert configuration has.
 *
 * WHY THIS EXISTS. On 2026-08-11 the alerting was dead for hours and every
 * indicator said healthy: zero failed notifications (because nothing was even
 * attempted), "Successfully executed action" in the alarm history, and five
 * alarms sitting in OK. A silence alarm that cannot deliver is worse than no
 * alarm, because it turns an unmonitored system into one everyone believes is
 * monitored (D44).
 *
 * So the channel is checked the way every signal here is: the value is emitted
 * on EVERY run, healthy or not. A signal that appears only on failure cannot
 * tell "fine" from "the check stopped running".
 *
 * The alarm on this metric necessarily notifies through the very channel it is
 * measuring, which no amount of cleverness fixes. It is not meant to. The point
 * is that the NUMBER is visible without any delivery at all — in the log, on a
 * dashboard, and in the run journal the admin surface will read. The alarm is
 * the backup; the visible number is the primary.
 *
 * Never throws: a capture must not fail because a monitoring read did.
 */
async function reportAlertChannels(): Promise<void> {
  const name = process.env.ALERT_CONFIG_NAME;
  if (name === undefined || name === '') return;
  try {
    // us-east-1 is not a choice. The notifications API answers only there and
    // refuses the call in eu-north-1 by name, which is a confusing failure to
    // meet at 01:00.
    const client = new NotificationsClient({ region: 'us-east-1' });
    const list = await client.send(new ListNotificationConfigurationsCommand({}));
    // Matched by NAME rather than ARN: an ARN carries the account id and this
    // repository is public.
    const cfg = list.notificationConfigurations?.find((c) => c.name === name);
    if (cfg?.arn === undefined) {
      console.log(JSON.stringify({ metric: 'alertChannels', configuration: name, status: 'MISSING', value: 0 }));
      return;
    }
    const channels = await client.send(
      new ListChannelsCommand({ notificationConfigurationArn: cfg.arn }),
    );
    const value = cfg.status === 'ACTIVE' ? (channels.channels?.length ?? 0) : 0;
    console.log(
      JSON.stringify({ metric: 'alertChannels', configuration: name, status: cfg.status, value }),
    );
  } catch (err) {
    // Reported, not thrown, and not silent: a read that fails is not the same
    // as zero channels, so it must not masquerade as one.
    console.warn(
      `alert-channel check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The only `basis` NBU ever writes. The other three of the pinned vocabulary
 *  (`buy`, `sell`, `nav`) are legal from row one so that adding one later does
 *  not split the archive across two key shapes — see migrations/002. */
const BASIS_FAIR = 'fair';

export interface ObserveRequest {
  from?: string;
  to?: string;
  /**
   * Which instruments to write observations for. Defaults to the ISINs the
   * portfolio actually holds.
   *
   * SCOPE IS A PARAMETER, AND NARROW IS THE SAFE DIRECTION. A published file
   * carries ~185 instruments, so the full universe over the archive is roughly
   * 400,000 rows against the 2-3 that anything reads. Widening later is free —
   * more rows under the same immutable key, re-derived from payloads that are
   * already stored locally, with NBU additionally re-fetchable by URL. Starting
   * wide and narrowing means deleting rows 3,000 at a time. Cost is not the
   * constraint either way: the whole of August, including two ten-year
   * backfills, metered 5.86 DPU.
   */
  refs?: string[];
  /** Dates per invocation. The caller loops on `nextFrom` rather than fighting
   *  the Lambda timeout, exactly as the capture backfill does. */
  limit?: number;
}

/**
 * Turn stored raw captures into observations.
 *
 * Reads NOTHING from the network. This is the payoff of storing payloads: the
 * schema can be wrong once and still recover, because the source material never
 * left. A re-run is a no-op by construction — `ON CONFLICT DO NOTHING` on the
 * natural key — which is what makes it safe to run again after fixing a parser.
 *
 * One transaction per date: ~185 rows sits far under the 3,000-row and 10 MiB
 * per-transaction limits, and a date is the natural unit to retry.
 */
async function observeNbu(client: Client, req: ObserveRequest) {
  const from = req.from ?? NBU_ARCHIVE_START;
  const to = req.to ?? nbuAsOf(new Date());
  const refs = req.refs ?? TRACKED_ISINS;
  const limit = req.limit ?? 400;
  const wanted = new Set(refs);

  // The NEWEST successful capture per date. `price_capture` is append-only and
  // a repaired day lands beside the wrong one, so taking the latest
  // `requested_at` is what makes a correction win without deleting evidence.
  const { rows: captures } = await client.query<{
    as_of: string;
    requested_at: Date;
    payload_gzip: Buffer;
    parser_version: string;
  }>(
    `SELECT DISTINCT ON (as_of)
            to_char(as_of, 'YYYY-MM-DD') AS as_of, requested_at,
            payload_gzip, parser_version
       FROM price_capture
      WHERE source = $1 AND ok = true AND as_of BETWEEN $2 AND $3
      ORDER BY as_of, requested_at DESC`,
    [SOURCE.nbuFairValue, from, to],
  );

  let dates = 0;
  let seen = 0;
  let written = 0;
  let mismatched = 0;
  let cursor = from;
  for (const cap of captures) {
    if (dates >= limit) break;
    cursor = cap.as_of;
    dates += 1;

    const body = gunzipSync(cap.payload_gzip).toString('utf8');
    const parsed = parseNbuFairValue(body);
    const observedAt = cap.requested_at.toISOString();

    for (const row of parsed) {
      if (!wanted.has(row.isin)) continue;
      // Contract 2: the file's own claim must agree with the day we filed it
      // under. Counted and skipped, never coerced — a silent coercion here
      // would be indistinguishable from correct data forever after.
      if (row.calcDate !== cap.as_of) {
        mismatched += 1;
        continue;
      }
      // rowCount, not a counter of attempts. `ON CONFLICT DO NOTHING` makes the
      // two differ by exactly the amount that matters: a re-run that inserts
      // nothing must REPORT nothing, or "re-running is a no-op" is a belief
      // rather than an observation — the recurring defect of D43/D44/D49.
      const ins = await client.query(
        `INSERT INTO price_observation
           (as_of, instrument_ref, basis, source, price, observed_at,
            parser_version, ytm, clean_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (as_of, instrument_ref, basis, source) DO NOTHING`,
        [
          cap.as_of,
          row.isin,
          BASIS_FAIR,
          SOURCE.nbuFairValue,
          row.fairValue,
          observedAt,
          cap.parser_version,
          row.ytm ?? null,
          row.cleanRate ?? null,
        ],
      );
      written += ins.rowCount ?? 0;
      seen += 1;

      // `listed_from` / `last_seen_on` widen monotonically, so a backfill run
      // in any order converges on the same bounds. LEAST/GREATEST over the
      // existing value rather than a blind overwrite is what makes that true.
      await client.query(
        `INSERT INTO instrument
           (ref, kind, currency, cp_type, maturity, listed_from, last_seen_on)
         VALUES ($1, 'bond', $2, $3, $4, $5, $5)
         ON CONFLICT (ref) DO UPDATE SET
           currency     = coalesce(EXCLUDED.currency, instrument.currency),
           cp_type      = coalesce(EXCLUDED.cp_type, instrument.cp_type),
           maturity     = coalesce(EXCLUDED.maturity, instrument.maturity),
           listed_from  = least(instrument.listed_from, EXCLUDED.listed_from),
           last_seen_on = greatest(instrument.last_seen_on, EXCLUDED.last_seen_on)`,
        [row.isin, row.currency, row.cpType ?? null, row.maturity ?? null, cap.as_of],
      );
    }
  }

  const remaining = captures.length > dates;
  return {
    mode: 'observe' as const,
    from,
    to,
    refs,
    dates,
    /** Rows the payloads offered for these refs. */
    seen,
    /** Rows actually INSERTED. `seen` with `written: 0` is a clean no-op. */
    written,
    mismatched,
    complete: !remaining,
    nextFrom: remaining ? addDays(cursor, 1) : null,
  };
}

/** How far back the scheduled run re-derives observations. A week, so a missed
 *  night repairs itself rather than leaving a permanent hole. */
const OBSERVE_WINDOW_DAYS = 7;

/** Published as `observationsWritten` when the derivation threw. Negative
 *  because no successful run can report it, so "broken" and "nothing new
 *  today" can never be read as the same point on the graph. */
const OBSERVE_FAILED = -1;

/**
 * Derive observations for the trailing window and publish what happened.
 *
 * NO ALARM ON THIS METRIC, deliberately. `written: 0` is the normal, healthy
 * reading — on a weekend NBU publishes nothing, and on any ordinary day the
 * window has already been derived, so zero new rows is what success looks like.
 * An alarm on zero would page every Saturday, and an alarm that pages for
 * nothing is how alarms get muted (the D44 lesson, applied before making the
 * mistake rather than after).
 *
 * What the number is for is the graph: `written` should show a small spike on
 * each business day and a flat zero across weekends. A flat zero for a working
 * week means the derivation has stopped, and that is visible without querying
 * the table at all.
 *
 * Never throws: a capture must not fail because a derivation did. The payload
 * is already stored by this point, so anything missed here is recoverable on
 * the next run — which is exactly the property the trailing window buys.
 */
async function observeAndReport(client: Client, from: string, to: string): Promise<void> {
  try {
    const r = await observeNbu(client, { from, to });
    console.log(
      JSON.stringify({
        metric: 'observationsWritten',
        from,
        dates: r.dates,
        seen: r.seen,
        value: r.written,
        mismatched: r.mismatched,
      }),
    );
  } catch (err) {
    // EMIT THE METRIC ANYWAY, with a value no healthy run can produce.
    //
    // Logging only a warning would drop the datapoint entirely, so a
    // permanently failing derivation publishes an EMPTY series — not the flat
    // zero the alarm rationale tells the operator to watch for. Empty and
    // healthy-at-zero look identical on a graph, which is the exact defect of
    // D43/D44/D49 reappearing in the check written to prevent it.
    console.log(
      JSON.stringify({
        metric: 'observationsWritten',
        from,
        value: OBSERVE_FAILED,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** No usable recovery point. Deliberately large rather than 0 or -1: the metric
 *  is an AGE, so "nothing" has to sit on the bad side of any threshold. A zero
 *  would read as "backed up seconds ago", which is the exact inversion that
 *  makes a broken check look healthy. */
const NO_BACKUP_HOURS = 9999;

/**
 * Report how old the newest completed backup of the price cluster is, in hours.
 *
 * WHY THIS EXISTS. Three times on 2026-08-11 something was broken while every
 * indicator read healthy: the alert channel delivered nowhere (D44), a backfill
 * filled a range with `ok: false` nobody read (D43), and the archive turned out
 * to have no backup at all while deletion protection made it look protected
 * (D49). Each time the green came from nothing having been ATTEMPTED. A backup
 * plan has exactly that shape — it fails silently, and the moment it is wanted
 * is the worst possible moment to find out.
 *
 * An AGE rather than a healthy/unhealthy flag: a number can be watched drifting
 * toward the threshold, a boolean can only be watched flipping after it is too
 * late.
 *
 * Filtered by the cluster's OWN arn, which matters more than it looks. Recovery
 * points survive their source for the full 35-day retention, so a recreated
 * cluster with a broken selection would keep this metric comfortably fresh for
 * over a month while nothing at all was being backed up.
 *
 * Never throws: a capture must not fail because a monitoring read did.
 */
async function reportBackupFreshness(): Promise<void> {
  const vault = process.env.BACKUP_VAULT_NAME;
  const clusterArn = process.env.DSQL_CLUSTER_ARN;
  if (vault === undefined || vault === '' || clusterArn === undefined || clusterArn === '') return;
  try {
    const client = new BackupClient({});
    const page = await client.send(
      new ListRecoveryPointsByBackupVaultCommand({
        BackupVaultName: vault,
        ByResourceArn: clusterArn,
      }),
    );
    // Only COMPLETED counts. A job sitting in CREATING or PARTIAL is not
    // something anything can be restored from, and treating it as one would
    // reproduce the very failure this check exists to catch.
    const newest = (page.RecoveryPoints ?? [])
      .filter((p) => p.Status === 'COMPLETED' && p.CompletionDate !== undefined)
      .reduce<Date | undefined>(
        (best, p) => (best === undefined || p.CompletionDate! > best ? p.CompletionDate! : best),
        undefined,
      );
    const value =
      newest === undefined
        ? NO_BACKUP_HOURS
        : Math.round((Date.now() - newest.getTime()) / 3_600_000);
    console.log(
      JSON.stringify({
        metric: 'backupAgeHours',
        vault,
        completedAt: newest?.toISOString() ?? null,
        value,
      }),
    );
  } catch (err) {
    // Reported, not thrown, and not silent: a read that failed is not the same
    // as "no backup exists", so it must not be emitted as one.
    console.warn(
      `backup-freshness check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read-only diagnostics: table size, and the plans of the two queries that scan
 * `price_capture` in normal operation.
 *
 * It exists because A2 asks a question nothing else here can answer. DSQL bills
 * bytes SCANNED, and the data model rules that raw payloads live in a separate
 * table because primary keys are index-organized and carry every column — so a
 * wide row inflates every range scan. Whether that is actually costing anything
 * is a measurement, not an opinion, and the honest first step is to look before
 * rewriting a live archive.
 *
 * `EXPLAIN ANALYZE` runs the query for real. Both are SELECTs, so this reads and
 * writes nothing.
 */
async function diagnose(client: Client) {
  const size = await client.query<{ rows: string; payload_bytes: string; total_bytes: string }>(
    `SELECT count(*)::text AS rows,
            coalesce(sum(payload_bytes), 0)::text AS payload_bytes,
            coalesce(sum(octet_length(payload_gzip)), 0)::text AS total_bytes
       FROM price_capture`,
  );
  const bySource = await client.query<{ source: string; n: string; bytes: string }>(
    `SELECT source, count(*)::text AS n,
            coalesce(sum(octet_length(payload_gzip)), 0)::text AS bytes
       FROM price_capture GROUP BY source ORDER BY source`,
  );

  // The query that runs in normal operation, planned as it actually runs. The
  // streak query that used to be planned beside it is gone with the check (A20).
  const plans: Record<string, string[]> = {};
  const completeness = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN ANALYZE
     SELECT DISTINCT to_char(as_of, 'YYYY-MM-DD') AS as_of
       FROM price_capture WHERE source = $1 AND as_of BETWEEN $2 AND $3`,
    [SOURCE.nbuFairValue, NBU_ARCHIVE_START, nbuAsOf(new Date())],
  );
  plans.backfillCompleteness = completeness.rows.map((r) => r['QUERY PLAN']);

  // A4's reconciliation. Per ref: how many observations exist, over what span,
  // and how many DISTINCT dates they cover — the last one is what catches a
  // duplicate-per-date bug that a plain count would hide.
  const observations = await client.query(
    `SELECT instrument_ref, basis, source,
            count(*)::text AS n,
            count(DISTINCT as_of)::text AS dates,
            to_char(min(as_of), 'YYYY-MM-DD') AS first_as_of,
            to_char(max(as_of), 'YYYY-MM-DD') AS last_as_of
       FROM price_observation
      GROUP BY instrument_ref, basis, source
      ORDER BY instrument_ref, basis, source`,
  );

  // The denominator, computed per ref over ITS OWN span. One shared span would
  // measure the younger instrument against days that predate its issuance and
  // report a false gap — which is the same mistake as D43, one level up.
  const reconciled = [];
  for (const o of observations.rows) {
    const { rows } = await client.query<{ days: string }>(
      `SELECT count(DISTINCT as_of)::text AS days
         FROM price_capture
        WHERE source = 'nbu_fv' AND ok = true AND as_of BETWEEN $1 AND $2`,
      [o.first_as_of, o.last_as_of],
    );
    reconciled.push({ ...o, publishedDays: rows[0].days, gaps: Number(rows[0].days) - Number(o.dates) });
  }

  // Three real rows, prices included, so the archive can be checked against the
  // provider's own file by hand. A count that reconciles proves the plumbing;
  // only a value proves the parse.
  const sample = await client.query(
    `SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of, instrument_ref, basis,
            price::text, ytm::text, clean_rate::text
       FROM price_observation ORDER BY as_of DESC, instrument_ref LIMIT 3`,
  );

  const instruments = await client.query(
    `SELECT ref, kind, currency, cp_type,
            to_char(maturity, 'YYYY-MM-DD')     AS maturity,
            to_char(listed_from, 'YYYY-MM-DD')  AS listed_from,
            to_char(last_seen_on, 'YYYY-MM-DD') AS last_seen_on
       FROM instrument ORDER BY ref`,
  );

  return {
    mode: 'diagnose' as const,
    size: size.rows[0],
    bySource: bySource.rows,
    observations: reconciled,
    sample: sample.rows,
    instruments: instruments.rows,
    plans,
  };
}

export interface HandlerEvent {
  /** Absent for the scheduled run: capture today from every source. */
  backfill?: BackfillRequest;
  /** Manual re-capture of one date, e.g. to repair a bad day. */
  asOf?: string;
  /** Read-only: table size and the plans of the two operational queries. */
  diagnose?: boolean;
  /** Derive observations from payloads already stored. Network-free. */
  observe?: ObserveRequest;
}

export async function handler(event: HandlerEvent = {}) {
  const client = await connect();
  try {
    await ensureSchema(client);

    if (event.diagnose === true) return await diagnose(client);

    if (event.observe !== undefined) return await observeNbu(client, event.observe);

    if (event.backfill !== undefined) return await backfillNbu(client, event.backfill);

    // ONE automation, two sources — and TWO as-of dates, which is the whole of
    // D71. Both are captured in a single scheduled run rather than as two
    // schedules, but they no longer share a date: Inzhur's live endpoint serves
    // the price struck for the day the run happens on, while NBU's URL asks for
    // a named file that cannot exist for today yet. One rule had to be wrong for
    // one of them, and for eight days it was.
    const now = new Date();
    const runDate = kyivDateIso(now);
    const asOfOf = (source: string) =>
      event.asOf ?? (source === SOURCE.inzhur ? inzhurAsOf(now) : nbuAsOf(now));

    const results: CaptureResult[] = [];
    for (const source of [SOURCE.inzhur, SOURCE.nbuFairValue]) {
      const asOf = asOfOf(source);
      // The schedule fires six times a day, two hours apart, so that a provider
      // outage at 01:00 is not the end of the matter (see template.yaml). Every
      // firing after the first is a no-op for a source already settled, and the
      // guard runs BEFORE the fetch — so in the ordinary case the providers see
      // exactly one request a day, as they did when this was a single firing.
      if (await alreadySettled(client, source, asOf)) continue;
      results.push(await captureOne(client, source, asOf));
    }
    // Nothing left to do: every source was already settled by an earlier firing.
    // Reported under the RUN date, which is the one fact both sources share —
    // each row carries its own as_of, and a single top-level one would be the
    // conflation D71 exists to end.
    if (results.length === 0) return { runDate, results, skipped: 'already settled' };

    // Today's payload becomes today's observation, on the same run that
    // captured it.
    //
    // WHY A TRAILING WINDOW AND NOT JUST `asOf`. Deriving only the current date
    // means a night the job missed is a hole nobody fills — and holes in this
    // table are invisible, because the payload is still safely archived and
    // every indicator stays green. Re-deriving the last week costs almost
    // nothing (`ON CONFLICT DO NOTHING`, ~2 rows a day, no network at all) and
    // makes the run self-repairing: whatever was missed comes back on the next
    // successful night without anyone noticing it had gone.
    // Bounded at BOTH ends. `to` defaults to today inside `observeNbu`, so
    // omitting it made a manual `{ asOf: '2020-03-02' }` repair derive six
    // years forward — hundreds of dates the operator never asked for, reported
    // as one enormous spike in the metric that is supposed to read "a couple of
    // rows a night".
    // The observation table holds NBU rows only (its Inzhur half is W3/W4), so
    // the window is NBU's date. Passing Inzhur's would ask for a day the source
    // has not published.
    const nbuDate = asOfOf(SOURCE.nbuFairValue);
    await observeAndReport(client, addDays(nbuDate, -OBSERVE_WINDOW_DAYS), nbuDate);

    // THE SHAPE OF THE FEED, PUBLISHED AND NEVER ALARMED (A20). Both numbers
    // say something a graph can show and no threshold can judge: `entryCount`
    // has only ever grown, so a floor under it would be a guess that the first
    // delisting makes wrong, and `skippedRefs` is empty on every Inzhur capture
    // but non-empty on 6,133 of 6,636 NBU rows, where it is the backfill
    // correctly reporting bonds that did not exist yet (D43). A single rule
    // over both sources would therefore be wrong for one of them. What DOES
    // alarm is a named ref going missing — `tracked ISIN absent` for NBU,
    // `tracked ref absent` for Inzhur — because that needs no threshold and is
    // the thing actually worth waking up for.
    //
    // Emitted HERE rather than inside `captureOne`, which is what retires the
    // old `trackStreak` flag: a 2,600-date backfill would otherwise scatter
    // points across ten years of graph. The scheduled path is the only caller
    // that reaches this line, so the separation is structural instead of a
    // boolean someone can forget to pass.
    for (const r of results) {
      console.log(JSON.stringify({ metric: 'entryCount', source: r.source, asOf: r.asOf, value: r.entries }));
      console.log(JSON.stringify({ metric: 'skippedRefs', source: r.source, asOf: r.asOf, value: r.skipped }));
    }

    // Only on the scheduled path. A backfill has nothing to say about whether
    // today's alerting works, and it would emit the value hundreds of times.
    await reportAlertChannels();
    await reportBackupFreshness();

    // A weekend 404 from NBU is not a failure — it is the calendar. Only real
    // problems reach the alarm.
    const failed = results.filter((r) => !r.ok && r.error !== NOT_PUBLISHED);
    if (failed.length > 0) {
      throw new Error(
        `capture ${runDate}: ` +
          failed.map((f) => `${f.source} (as_of ${f.asOf}): ${f.error}`).join('; '),
      );
    }
    return { runDate, results };
  } finally {
    await client.end();
  }
}
