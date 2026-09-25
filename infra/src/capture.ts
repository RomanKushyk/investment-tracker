// The daily capture: fetch, store the RAW payload, derive nothing
// (docs/superpowers/specs/2026-08-04-data-model.md). EVERY RUN WRITES A ROW, a failed one
// included: `price_capture` — never the absence of a price row — answers "did the job run on D".
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

import { BackupClient, ListRecoveryPointsByBackupVaultCommand } from '@aws-sdk/client-backup';
import {
  ListChannelsCommand,
  ListNotificationConfigurationsCommand,
  NotificationsClient,
} from '@aws-sdk/client-notifications';
import type { Client } from 'pg';

import { addDays, kyivDateIso } from '@quirenote/core/dates';
import { backupAgeHours } from './backup-age';
import { reconcileObservations } from './diagnose-reconciliation';
import { connect } from './dsql';
import type { SqlClient } from './migrate';
// Re-exported so the deploy's bundle smoke test can reach them.
export { inzhurAsOf, nbuAsOf } from './dates';
import { inzhurAsOf, nbuAsOf } from './dates';
import { parseAssetsFeed, type ParsedFeed } from '@quirenote/core/inzhur/parse';
import { parseOfferPage } from '@quirenote/core/inzhur/offer-page';
import { bondTermsRow } from './bond-terms';
import {
  documentListUrl,
  FUND_HISTORY_CATEGORIES,
  FUND_HISTORY_PARSER_VERSION,
  fundHistoryRows,
  priceFileLink,
} from './fund-history';
import { BASIS_NAV, inzhurObservationRows } from './observation-rows';
import { observeProgress, observeWindowEnd } from './observe-window';
import { readXlsx } from './xlsx';
import { tallyQuotes, type QuoteTally } from './quotes';
import { forgetRobots, REFUSED, RobotsRefusal, robotsFetch } from './robots';
import { parseNbuFairValue } from '@quirenote/core/nbu/fair-value';

/** Stored per row, so a parser that was wrong leaves identifiable rows. */
const PARSER_VERSION = '1';

/** Inzhur rows read from the offer page, where `PARSER_VERSION` marks the refused feed's JSON:
 *  the stored payload is a different document, so a re-derivation must know which. */
const OFFER_PAGE_PARSER_VERSION = '2';

/** Each stored Inzhur payload by the parser that wrote it; an unknown version is thrown rather
 *  than read as either document. */
function parseInzhurPayload(body: string, parserVersion: string): ParsedFeed {
  if (parserVersion === OFFER_PAGE_PARSER_VERSION) return parseOfferPage(body);
  if (parserVersion === PARSER_VERSION) return parseAssetsFeed(JSON.parse(body));
  throw new Error(`unknown inzhur parser_version: ${parserVersion}`);
}

/** `inzhur` is the provider's own DEALER QUOTE; `nbu_fv` is the National Bank's MODEL valuation.
 *  They are NOT substitutes and are never merged, so storing them without distinguishing the
 *  source would silently present one as the other. */
export const SOURCE = {
  inzhur: 'inzhur',
  nbuFairValue: 'nbu_fv',
} as const;

const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

interface FetchOutcome {
  ok: boolean;
  httpStatus?: number;
  body?: string;
  error?: string;
}

/** A refusal keeps the status of the redirect that led to it, so the journal shows where the
 *  source pointed. */
function failedOutcome(err: unknown): FetchOutcome {
  const httpStatus = err instanceof RobotsRefusal ? err.httpStatus : undefined;
  return { ok: false, httpStatus, error: err instanceof Error ? err.message : String(err) };
}

/** One file per BUSINESS day on a fully predictable path, archived back to `NBU_ARCHIVE_START`.
 *  A missed day here is downloadable later, which is why the ОВДП are not perishable the way the
 *  fund NAVs are. */
function nbuFairValueUrl(asOf: string): string {
  const d = asOf.replaceAll('-', ''); // yyyy-MM-dd -> yyyyMMdd
  return `https://bank.gov.ua/files/Fair_value/${d.slice(0, 6)}/${d}_fv.txt`;
}

/** A weekend or holiday: the file does not exist, which is the calendar and not a failure. */
const NOT_PUBLISHED = 'not_published';

async function fetchNbu(asOf: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await robotsFetch(nbuFairValueUrl(asOf), controller.signal);
    if (response.status === 404) {
      return { ok: false, httpStatus: 404, error: NOT_PUBLISHED, body: '' };
    }
    if (!response.ok) {
      return { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
    }
    // cp1251, NOT utf-8: the file carries Cyrillic instrument types, and a utf-8 read turns them
    // into mojibake without erroring.
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      httpStatus: response.status,
      body: new TextDecoder('windows-1251').decode(bytes),
    };
  } catch (err) {
    return failedOutcome(err);
  } finally {
    clearTimeout(timer);
  }
}

/** ISINs the portfolio holds. Their absence from a published file is the signal worth alarming
 *  on — a bond matured, was renamed, or the file changed shape. */
const TRACKED_ISINS = ['UA4000238976', 'UA4000236475'];

/** `TRACKED_ISINS` one source over. Refs, not ISINs, because Inzhur serves both kinds. The bonds
 *  repeat `TRACKED_ISINS` rather than importing it: NBU's list is what a national file must
 *  contain, this is what one provider must list, and the day they diverge sharing is a bug. */
const TRACKED_INZHUR_REFS = ['UA4000238976', 'UA4000236475', 'inzhur-reit', 'inzhur-energy'];

interface ParsedNbu {
  rows: number;
  missing: string[];
  quotesDigest: string;
}

/** PRICE-BEARING FIELDS ONLY, never the whole payload: `availableQuantity` ticks with live sales,
 *  so `payload_sha256` is unique on every fetch and cannot detect "the prices did not move".
 *  Sorted before hashing, because the feed makes no ordering guarantee. */
function digestOf(parts: string[]): string {
  return createHash('sha256').update(parts.sort().join('\n'), 'utf8').digest('hex');
}

/** PARSE BY FIXED INDEX, never by zipping the header against the row: the header is malformed,
 *  its 18th semicolon-separated field being three comma-separated names where the data rows carry
 *  one, so zipping mislabels the tail and invents two columns. The map: 0 calc_date · 1 cpcode
 *  (ISIN) · 2 ccy · 3 fair_value · 4 ytm · 5 clean_rate · 7 maturity · 17 cptype. */
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

/** Retry only what a retry can fix: hammering a public endpoint we have no contract with is the
 *  likeliest way to lose access to a resource that has no substitute. */
function isRetryable(status: number): boolean {
  return status >= 500 || status === 408 || status === 429;
}

export async function fetchFeed(url: string): Promise<FetchOutcome> {
  let last: FetchOutcome = { ok: false, error: 'no attempt made' };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await robotsFetch(url, controller.signal);
      if (!response.ok) {
        last = { ok: false, httpStatus: response.status, error: `HTTP ${response.status}` };
        if (!isRetryable(response.status)) return last;
      } else {
        // .text(), not .json(): the raw body is what gets hashed and stored, and a re-parse
        // must see exactly these bytes.
        return { ok: true, httpStatus: response.status, body: await response.text() };
      }
    } catch (err) {
      last = failedOutcome(err);
      if (err instanceof RobotsRefusal) return last;
    } finally {
      clearTimeout(timer);
    }
    // SHORT, because the backoff has to fit inside the Lambda timeout and both sources share one
    // invocation, so the budget is per run rather than per source. These attempts exist for a
    // blip; a provider genuinely down is answered by the schedule firing again in two hours.
    if (attempt < MAX_ATTEMPTS) await sleep(attempt === 1 ? 30_000 : 60_000);
  }
  return last;
}

/** DSQL allows ONE DDL per transaction and forbids mixing DDL with DML, so every statement here
 *  stands alone and none may share a transaction with an insert. */
async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS price_capture (
      id UUID NOT NULL, requested_at TIMESTAMPTZ NOT NULL, as_of DATE NOT NULL,
      source TEXT, ok BOOLEAN NOT NULL, http_status INT, error TEXT,
      entry_count INT, skipped_refs TEXT,
      payload_gzip BYTEA NOT NULL, payload_bytes INT NOT NULL,
      payload_sha256 TEXT NOT NULL, parser_version TEXT NOT NULL,
      PRIMARY KEY (id))`);

  await client.query('ALTER TABLE price_capture ADD COLUMN IF NOT EXISTS source TEXT');

  // Every row written before this column existed came from the Inzhur feed, the only source then.
  await client.query(`UPDATE price_capture SET source = $1 WHERE source IS NULL`, [SOURCE.inzhur]);

  await client.query('ALTER TABLE price_capture ADD COLUMN IF NOT EXISTS quotes_sha256 TEXT');
  // NO DESC ANYWHERE: DSQL rejects a sort direction in index keys outright. Immaterial, because
  // the planner can walk an ascending index backwards.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_capture_as_of
       ON price_capture (as_of, requested_at)`,
  );

  // Leads with `source`, which both operational queries filter on — and neither could use the
  // index above, an index being usable only from its leading column.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_capture_source_as_of
       ON price_capture (source, as_of, requested_at)`,
  );

  // THE KEY IS IMMUTABLE: changing it is a DROP/CREATE of a live archive, not a migration.
  // Contracts pinned in migrations/002_price_observation.sql.
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

  // The ONLY surviving copy of a bond's schedule once the provider stops listing it — see
  // `bond-terms.ts`. Same key shape as `price_observation`, and for the same reason.
  await client.query(`
    CREATE TABLE IF NOT EXISTS bond_terms (
      as_of DATE NOT NULL, ref TEXT NOT NULL,
      terms_sha256 TEXT NOT NULL,
      maturity DATE, payment_schedule TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL, parser_version TEXT NOT NULL,
      PRIMARY KEY (as_of, ref))`);

  // The primary key leads with `as_of` because the read contract serves whole years, so "this
  // instrument over time" needs its own leading column.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS price_observation_ref_as_of
       ON price_observation (instrument_ref, as_of)`,
  );

  // "The schedule of THIS bond, latest first" is the read W10/W12 will make on a delisted
  // instrument, and the key cannot serve it. ASYNC and no `USING btree`: DSQL rejects both.
  await client.query(
    `CREATE INDEX ASYNC IF NOT EXISTS bond_terms_ref_as_of
       ON bond_terms (ref, as_of)`,
  );
}

interface CaptureResult {
  source: string;
  asOf: string;
  ok: boolean;
  entries: number;
  skipped: number;
  /** DCF verdicts over the live bonds, Inzhur only. Published, never stored. */
  quotes?: QuoteTally;
  error: string | null;
}

/** KEYED ON `ok = true`, NEVER ON A ROW EXISTING: a failed capture writes a row too, so a range
 *  filled by a defective run would be skipped forever by an ordinary re-run. `not_published`
 *  counts as settled, or every weekend spends every firing asking for a file that cannot exist. So
 *  does a refusal: re-asking every firing costs more than a same-morning site change is worth. */
export async function alreadySettled(
  client: SqlClient,
  source: string,
  asOf: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM price_capture
      WHERE source = $1 AND as_of = $2 AND (ok = true OR error = $3 OR error LIKE $4)
      LIMIT 1`,
    [source, asOf, NOT_PUBLISHED, `${REFUSED} %`],
  );
  return res.rows.length > 0;
}

/** `expectTracked` false for a BACKFILL, where a tracked ISIN's absence is the calendar and not a
 *  fault: applied unconditionally it marked every historical date an error. */
async function captureOne(
  client: Client,
  source: string,
  asOf: string,
  { expectTracked = true }: { expectTracked?: boolean } = {},
): Promise<CaptureResult> {
  const requestedAt = new Date();
  const outcome =
    source === SOURCE.nbuFairValue ? await fetchNbu(asOf) : await fetchFeed(process.env.FEED_URL!);
  const parserVersion = source === SOURCE.inzhur ? OFFER_PAGE_PARSER_VERSION : PARSER_VERSION;

  let entryCount: number | null = null;
  let skipped: string | null = null;
  let quotes: QuoteTally | undefined;
  let error = outcome.error ?? null;
  let digest: string | null = null;

  if (outcome.ok && outcome.body !== undefined && outcome.body !== '') {
    try {
      if (source === SOURCE.nbuFairValue) {
        const parsed = parseNbu(outcome.body);
        entryCount = parsed.rows;
        skipped = parsed.missing.join(',');
        digest = parsed.quotesDigest;
        if (expectTracked && parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
        else if (parsed.rows === 0) error = 'file parsed to zero rows';
      } else {
        // The SAME parser the app uses, or client and server eventually disagree about a price:
        // the page is reshaped into the feed's entries before `parseAssetsFeed` reads them.
        const feed = parseInzhurPayload(outcome.body, parserVersion);
        entryCount = feed.entries.length;
        // `ref:reason` per entry, so the archive records WHY an asset dropped out — a renamed
        // field is the likeliest cause and the one a bare ref list cannot distinguish.
        skipped = feed.skipped.map((s) => `${s.ref}:${s.reason}`).join(',');
        digest = digestOf(
          feed.entries.map(
            (e) =>
              `${e.kind}:${e.ref.toLowerCase()}:${e.sellUAH}:${e.buyUAH ?? ''}:${e.navUAH ?? ''}`,
          ),
        );
        // SHAPE, NEVER VALUES: a price may sit still for a weekend or a holiday, so alarming on
        // one manufactures work. Naming the refs needs no threshold, where a floor under the
        // entry count is a guess the first delisting makes wrong.
        const present = new Set(feed.entries.map((e) => e.ref.toLowerCase()));
        const absent = TRACKED_INZHUR_REFS.filter((r) => !present.has(r.toLowerCase()));
        // Prices and schedules are two elements of the page, so either can vanish alone: the error
        // keeps the day open to the next firing, and `observe` still reads its prices.
        const unscheduled = feed.entries
          .filter((e) => e.kind === 'bond' && e.paymentSchedule.length === 0)
          .map((e) => e.ref);
        // Zero readable entries is shape drift, recorded as a failure — but the payload is still
        // stored, being what a future parser fix needs to read.
        if (entryCount === 0) error = 'feed parsed to zero entries';
        else if (expectTracked && absent.length > 0)
          error = `tracked ref absent: ${absent.join(',')}`;
        else if (unscheduled.length > 0) error = `schedule absent: ${unscheduled.join(',')}`;
        // Diagnostic only: a stale provider quote is a fact to record, not a failed capture.
        quotes = tallyQuotes(feed, asOf);
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
      // Hash the DECODED text, never the wire bytes: a different negotiated Content-Encoding
      // would make every hash unique and silently disable change detection.
      createHash('sha256').update(body, 'utf8').digest('hex'),
      digest,
      parserVersion,
    ],
  );

  return {
    source,
    asOf,
    ok: error === null,
    entries: entryCount ?? 0,
    skipped: skipped === null || skipped === '' ? 0 : skipped.split(',').length,
    ...(quotes === undefined ? {} : { quotes }),
    error,
  };
}

/** No retry: the only caller is a manual mode, and a hashed file name does not change. */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await robotsFetch(url, controller.signal);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/** Gregorian only: Ukrainian public holidays are deliberately not encoded, because NBU publishes
 *  no file on them and the 404 path already records that correctly. */
function isWeekend(iso: string): boolean {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** The earliest NBU fair-value file that exists; an earlier date answers 404. */
export const NBU_ARCHIVE_START = '2016-01-04';

interface BackfillRequest {
  from?: string;
  to?: string;
  limit?: number;
  /** The way out of a range filled by a defective run, and deliberately OPT-IN, or an accidental
   *  invocation re-fetches a decade of files. APPEND, NEVER OVERWRITE: the corrected row lands
   *  beside the wrong one and wins, while the original stays as the record of what was believed. */
  force?: boolean;
}

/** Bounded per invocation and returns a cursor, so the caller loops rather than fighting the
 *  Lambda timeout. */
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

/** A SILENCE ALARM THAT CANNOT DELIVER is worse than no alarm: it turns an unmonitored system
 *  into one everyone believes is monitored. The alarm here necessarily notifies through the
 *  channel it measures, which is not the point — the NUMBER is visible without any delivery, on
 *  EVERY run, or it cannot tell "fine" from "the check stopped running". */
async function reportAlertChannels(): Promise<void> {
  const name = process.env.ALERT_CONFIG_NAME;
  if (name === undefined || name === '') return;
  try {
    // us-east-1 is not a choice: the notifications API answers only there.
    const client = new NotificationsClient({ region: 'us-east-1' });
    const list = await client.send(new ListNotificationConfigurationsCommand({}));
    // Matched by NAME rather than ARN: an ARN carries the account id, and this repo is public.
    const cfg = list.notificationConfigurations?.find((c) => c.name === name);
    if (cfg?.arn === undefined) {
      console.log(
        JSON.stringify({
          metric: 'alertChannels',
          configuration: name,
          status: 'MISSING',
          value: 0,
        }),
      );
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
    // Reported, not thrown, and not silent: a failed read is not zero channels.
    console.warn(`alert-channel check failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The only `basis` NBU writes. All four have been legal from row one, so adding one later does
 *  not split the archive across two key shapes. */
const BASIS_FAIR = 'fair';

export interface ObserveRequest {
  from?: string;
  to?: string;
  /** SCOPE IS A PARAMETER, AND NARROW IS THE SAFE DIRECTION: widening later is free, more rows
   *  under the same immutable key re-derived from payloads already stored, while starting wide
   *  and narrowing means deleting rows 3 000 at a time. */
  refs?: string[];
  /** Dates per invocation, and the other bound is the window: one invocation reads at most
   *  `OBSERVE_CAP_DAYS` past `from`, and `nextFrom` continues from whichever bound bit. */
  limit?: number;
  /** Omitted means `nbu_fv`, which is what `{observe:{}}` has always meant — see the handler. */
  source?: string;
}

/** The errors a derivation reads past, the prices having been read whole: a delisted tracked ref,
 *  and bonds whose schedules did not come through. */
const READ_PAST_LIKE = ['tracked ref absent:%', 'schedule absent:%'];

/**
 * The newest USABLE capture per date. ONE string for both observers and for `diagnose`'s two
 * `EXPLAIN`s: a plan is only "as it actually runs" if it is the same query.
 *
 * BOTH sort clauses name the table, or the SELECT list's `to_char(…) AS as_of` shadows the sort
 * key — and `DISTINCT ON` must match the leading `ORDER BY`, so qualifying one alone is a syntax
 * error. *Cloud target*, `order-by-alias.test.ts`. `$3` is `observeWindowEnd`, never further than
 * `OBSERVE_CAP_DAYS` past `$2`; `observe-window.ts` says why a SQL `LIMIT` cannot bound the read.
 *
 * $1 source · $2 from · $3 window end · $4 the error patterns to read past, or NULL.
 *
 * NOT `ok = true` ALONE. A missing tracked ref sets `error`, so keyed on `ok` this derives nothing
 * for EVERY instrument from the day the feed stops listing one — unrecoverably, since
 * `price_capture` is append-only and the endpoint is LIVE. The instrument whose delisting triggers
 * it is one of the two whose schedule `bond_terms` exists to outlive. So `$4` lets through the
 * defects that leave every price read.
 */
const NEWEST_CAPTURE_PER_DATE = `
  SELECT DISTINCT ON (price_capture.as_of)
         to_char(price_capture.as_of, 'YYYY-MM-DD') AS as_of, requested_at,
         payload_gzip, parser_version
    FROM price_capture
   WHERE source = $1 AND as_of BETWEEN $2 AND $3
     AND (ok = true OR ($4::text[] IS NOT NULL AND error LIKE ANY ($4::text[])))
   ORDER BY price_capture.as_of, requested_at DESC`;

/** Reads NOTHING from the network, which is the payoff of storing payloads: the schema can be
 *  wrong once and still recover. A re-run is a no-op by construction — `ON CONFLICT DO NOTHING`
 *  on the natural key — so it is safe to run again after fixing a parser. */
async function observeNbu(client: Client, req: ObserveRequest) {
  const from = req.from ?? NBU_ARCHIVE_START;
  const to = req.to ?? nbuAsOf(new Date());
  const refs = req.refs ?? TRACKED_ISINS;
  const limit = req.limit ?? 400;
  // Two bounds: the window bounds what the statement READS, the limit what the loop consumes.
  const windowEnd = observeWindowEnd(from, to);
  const wanted = new Set(refs);

  // `price_capture` is append-only and a repaired day lands beside the wrong one, so taking the
  // latest `requested_at` is what makes a correction win without deleting evidence.
  const { rows: captures } = await client.query<{
    as_of: string;
    requested_at: Date;
    payload_gzip: Buffer;
    parser_version: string;
  }>(NEWEST_CAPTURE_PER_DATE, [SOURCE.nbuFairValue, from, windowEnd, null]);

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
      // Counted and skipped, never coerced: a silent coercion is indistinguishable from correct
      // data forever after.
      if (row.calcDate !== cap.as_of) {
        mismatched += 1;
        continue;
      }
      // rowCount, not attempts, so a re-run inserting nothing REPORTS nothing.
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

      // `listed_from`/`last_seen_on` widen monotonically, so a backfill in any order converges.
      // LEAST/GREATEST over the existing value rather than a blind overwrite is what does it.
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

  const { complete, nextFrom } = observeProgress({
    to,
    windowEnd,
    fetched: captures.length,
    dates,
    cursor,
  });
  return {
    mode: 'observe' as const,
    from,
    to,
    /** A `nextFrom` far past few `dates` is this bound moving, not a sparse archive. */
    windowEnd,
    refs,
    dates,
    seen,
    written,
    mismatched,
    complete,
    nextFrom,
  };
}

/** `kind` comes from the caller, because Inzhur serves both classes where a fair-value file
 *  cannot contain a fund. A caller with no claim on `last_seen_on` passes null: `greatest` ignores
 *  it, and a fresh row says "unknown" rather than naming a day the caller never saw. */
async function upsertInstrument(
  client: Client,
  ref: string,
  i: { kind: string; maturity: string | null; first: string; last: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO instrument
       (ref, kind, currency, cp_type, maturity, listed_from, last_seen_on)
     VALUES ($1, $2, 'UAH', NULL, $3, $4, $5)
     ON CONFLICT (ref) DO UPDATE SET
       kind         = EXCLUDED.kind,
       currency     = coalesce(EXCLUDED.currency, instrument.currency),
       maturity     = coalesce(EXCLUDED.maturity, instrument.maturity),
       listed_from  = least(instrument.listed_from, EXCLUDED.listed_from),
       last_seen_on = greatest(instrument.last_seen_on, EXCLUDED.last_seen_on)`,
    [ref, i.kind, i.maturity, i.first, i.last],
  );
}

/** The first Inzhur capture in THIS cluster; a stack move restarted the series. */
export const INZHUR_ARCHIVE_START = '2026-08-11';

/**
 * MIRRORS `observeNbu` ON PURPOSE, because two observers that drift are two contracts. Four things
 * differ: `as_of` IS THE RUN DATE, not run − 1, the endpoint being live, so do not "align" them;
 * NO `calc_date` AGREEMENT CHECK EXISTS, the payload carrying no date of its own, and the DCF
 * inversion is no substitute since its verdict is a conclusion; SCOPE IS WIDE where NBU's is
 * narrow, the point here being the dealer quote for EVERY instrument over a set two orders
 * smaller than the national file; and ONE ENTRY YIELDS UP TO THREE ROWS, by `basis`.
 */
async function observeInzhur(client: Client, req: ObserveRequest) {
  const from = req.from ?? INZHUR_ARCHIVE_START;
  const to = req.to ?? inzhurAsOf(new Date());
  const limit = req.limit ?? 400;
  const windowEnd = observeWindowEnd(from, to);
  // `undefined` means every instrument the payload served. LOWERCASED ON BOTH SIDES, as every
  // other ref comparison in this file is: a repair typed as the slug an operator reads in a doc
  // would otherwise match nothing and report exactly what "already derived" looks like.
  const wanted = req.refs ? new Set(req.refs.map((r) => r.toLowerCase())) : null;

  const { rows: captures } = await client.query<{
    as_of: string;
    requested_at: Date;
    payload_gzip: Buffer;
    parser_version: string;
  }>(NEWEST_CAPTURE_PER_DATE, [SOURCE.inzhur, from, windowEnd, READ_PAST_LIKE]);

  let dates = 0;
  let seen = 0;
  let written = 0;
  let skipped = 0;
  let termsWritten = 0;
  let termsRefused = 0;
  const instrumentSeen = new Map<
    string,
    { kind: string; maturity: string | null; first: string; last: string }
  >();
  let cursor = from;
  for (const cap of captures) {
    if (dates >= limit) break;
    cursor = cap.as_of;
    dates += 1;

    const body = gunzipSync(cap.payload_gzip).toString('utf8');
    const feed = parseInzhurPayload(body, cap.parser_version);
    const observedAt = cap.requested_at.toISOString();
    // The parser's own refusals over the WHOLE feed, before `refs` narrows, so a single-ref
    // repair reports refusals for instruments the caller did not ask about. Deliberate: hiding a
    // parse failure behind a filter makes a targeted run look healthier than the capture it read.
    skipped += feed.skipped.length;

    for (const quote of feed.entries) {
      if (wanted && !wanted.has(quote.ref.toLowerCase())) continue;

      for (const row of inzhurObservationRows(quote)) {
        const ins = await client.query(
          `INSERT INTO price_observation
             (as_of, instrument_ref, basis, source, price, observed_at,
              parser_version, return_rate_buy, return_rate_sell, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (as_of, instrument_ref, basis, source) DO NOTHING`,
          [
            cap.as_of,
            row.ref,
            row.basis,
            SOURCE.inzhur,
            row.price,
            observedAt,
            cap.parser_version,
            row.returnRateBuy,
            row.returnRateSell,
            row.status,
          ],
        );
        written += ins.rowCount ?? 0;
        seen += 1;
      }

      // Written beside the observation because the schedule is what makes the price re-derivable.
      // NOT in one transaction — nothing here opens one, so a failure mid-date leaves the split,
      // and what repairs it is the trailing window re-deriving the date tomorrow.
      const terms = bondTermsRow(quote);
      // A BOND WITH NO ARCHIVABLE TERMS IS COUNTED, or the instrument this table exists to
      // preserve goes unarchived with no output changing. It does NOT catch a PARTIALLY parsed
      // schedule in a feed-era payload, which arrives with a fresh digest as a genuine revision.
      if (quote.kind === 'bond' && !terms) termsRefused += 1;
      if (terms) {
        const termsIns = await client.query(
          `INSERT INTO bond_terms
             (as_of, ref, terms_sha256, maturity, payment_schedule,
              observed_at, parser_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (as_of, ref) DO NOTHING`,
          [
            cap.as_of,
            terms.ref,
            terms.termsSha256,
            terms.maturity,
            terms.paymentSchedule,
            observedAt,
            cap.parser_version,
          ],
        );
        // rowCount, not attempts: a repaired capture for an already-derived date is picked up
        // and `DO NOTHING` keeps the OLD schedule, where an attempt counter reports a write.
        termsWritten += termsIns.rowCount ?? 0;
      }

      // ONCE PER REF PER INVOCATION, not per ref per date: `least`/`greatest` are
      // order-independent, so the bounds converge either way, and the per-date form wrote a row
      // version per ref per date on a service that bills writes.
      const prev = instrumentSeen.get(quote.ref);
      instrumentSeen.set(quote.ref, {
        kind: quote.kind,
        maturity: quote.maturity ?? prev?.maturity ?? null,
        // BOTH bounds: collapsing to the last date sets `listed_from` to it, which a `least`
        // against an existing row hides on a re-run and exposes on the FIRST run over a range.
        first: prev && prev.first < cap.as_of ? prev.first : cap.as_of,
        last: prev && prev.last > cap.as_of ? prev.last : cap.as_of,
      });
    }
  }

  for (const [ref, i] of instrumentSeen) await upsertInstrument(client, ref, i);

  const { complete, nextFrom } = observeProgress({
    to,
    windowEnd,
    fetched: captures.length,
    dates,
    cursor,
  });
  return {
    mode: 'observe' as const,
    source: SOURCE.inzhur,
    from,
    to,
    windowEnd,
    dates,
    /** BASIS ROWS here, where `observeNbu` counts matched refs, so the two are not comparable
     *  across sources — which is why the metric line carries `source`. */
    seen,
    /** `seen` with `written: 0` is a clean no-op. */
    written,
    /** Feed entries the PARSER refused, not rows we chose to skip. */
    skipped,
    /** Anything but zero names an instrument at risk of outliving its only schedule. */
    termsRefused,
    termsWritten,
    complete,
    nextFrom,
  };
}

interface ImportFundHistoryRequest {
  refs?: string[];
}

/** Manual, and network-bound where `observe` is not. Each fund's CMS document list is read for
 *  the CURRENT link, because each upload's URL carries a random suffix and no URL is ever polled
 *  (*External sources*). The FX columns are dropped, the provider's rate being stored nowhere
 *  (*The price archive*). A fund that fails throws the whole invocation: a partial import reported
 *  as a success is the one outcome to avoid. */
async function importFundHistory(client: Client, req: ImportFundHistoryRequest) {
  const refs = req.refs ?? Object.keys(FUND_HISTORY_CATEGORIES);
  if (refs.length === 0) throw new Error('importFundHistory: no refs to import');
  const observedAt = new Date().toISOString();
  const funds = [];
  for (const ref of refs) {
    const category = FUND_HISTORY_CATEGORIES[ref];
    if (category === undefined) throw new Error(`unknown fund ref: ${ref}`);
    const url = documentListUrl(category);
    const list = await fetchFeed(url);
    if (!list.ok || list.body === undefined) throw new Error(`${list.error} for ${url}`);
    const file = priceFileLink(list.body, category);
    const rows = fundHistoryRows(ref, readXlsx(await fetchBytes(file)));
    if (rows.length === 0) throw new Error(`fund-history: ${file} holds no rows`);

    let written = 0;
    for (const row of rows) {
      const ins = await client.query(
        `INSERT INTO price_observation
           (as_of, instrument_ref, basis, source, price, observed_at, parser_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (as_of, instrument_ref, basis, source) DO NOTHING`,
        [
          row.asOf,
          ref,
          BASIS_NAV,
          SOURCE.inzhur,
          row.price,
          observedAt,
          FUND_HISTORY_PARSER_VERSION,
        ],
      );
      written += ins.rowCount ?? 0;
    }
    const from = rows[0].asOf;
    const to = rows[rows.length - 1].asOf;
    // The file widens `listed_from` only: its last date is where publishing stopped.
    await upsertInstrument(client, ref, { kind: 'fund', maturity: null, first: from, last: null });
    funds.push({ ref, file, rows: rows.length, written, from, to });
  }
  return {
    mode: 'importFundHistory' as const,
    observedAt,
    parserVersion: FUND_HISTORY_PARSER_VERSION,
    funds,
  };
}

/** A week, so a missed night repairs itself rather than leaving a permanent hole. */
const OBSERVE_WINDOW_DAYS = 7;

/** Negative because no successful run can report it, so "broken" and "nothing new today" can
 *  never read as the same point on the graph. */
const OBSERVE_FAILED = -1;

/** NO ALARM ON THIS METRIC, deliberately: `written: 0` is the normal healthy reading, so an alarm
 *  on zero pages every weekend and gets muted. The number is for the GRAPH — a flat zero across a
 *  working week means the derivation has stopped. Never throws; the payload is already stored. */
async function observeAndReport(
  client: Client,
  source: string,
  from: string,
  to: string,
): Promise<void> {
  try {
    // Each source derives over its OWN date: passing NBU's window to the Inzhur observer would
    // ask for a day that source has not captured yet.
    const r =
      source === SOURCE.inzhur
        ? await observeInzhur(client, { from, to })
        : await observeNbu(client, { from, to });
    console.log(
      JSON.stringify({
        metric: 'observationsWritten',
        source,
        from,
        dates: r.dates,
        seen: r.seen,
        value: r.written,
        // Two counters and neither is the other's synonym: `mismatched` is a row whose file date
        // disagreed, `skipped` an entry the PARSER refused. One name conflates them.
        ...('mismatched' in r ? { mismatched: r.mismatched } : { skipped: r.skipped }),
      }),
    );
  } catch (err) {
    // EMIT THE METRIC ANYWAY, with a value no healthy run can produce: logging a warning alone
    // drops the datapoint, so a permanently failing derivation publishes an EMPTY series — and
    // empty and healthy-at-zero look identical on a graph.
    console.log(
      JSON.stringify({
        metric: 'observationsWritten',
        source,
        from,
        value: OBSERVE_FAILED,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** AN AGE RATHER THAN A FLAG: a number can be watched drifting toward the threshold, where a
 *  boolean is watched flipping too late — and a backup plan fails silently. Filtered by the
 *  cluster's OWN arn, or another cluster's nightly points keep this fresh. Never throws. */
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
    const { value, completedAt } = backupAgeHours(page.RecoveryPoints ?? [], new Date());
    console.log(JSON.stringify({ metric: 'backupAgeHours', vault, completedAt, value }));
  } catch (err) {
    // Reported, not thrown, and not silent: a failed read is not "no backup exists".
    console.warn(
      `backup-freshness check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** DSQL bills bytes SCANNED and a primary key is index-organized, carrying every column, so a
 *  wide row inflates every range scan — whether that costs anything is a measurement rather than
 *  an opinion. `EXPLAIN ANALYZE` runs the query for real, and every statement here is a SELECT. */
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

  const plans: Record<string, string[]> = {};

  // ONE "today" for every plan, or a call straddling the Kyiv date boundary builds two nobody
  // can compare.
  const today = nbuAsOf(new Date());

  // ANALYZE is what yields the per-statement `Statement DPU Estimate` block; VERBOSE alone does
  // not. Costs nothing here, since this query projects only `as_of`.
  const completeness = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, VERBOSE)
     SELECT DISTINCT to_char(as_of, 'YYYY-MM-DD') AS as_of
       FROM price_capture WHERE source = $1 AND as_of BETWEEN $2 AND $3`,
    [SOURCE.nbuFairValue, NBU_ARCHIVE_START, today],
  );
  plans.backfillCompleteness = completeness.rows.map((r) => r['QUERY PLAN']);

  // BOTH BRANCHES, because a query that runs per source is not verified until every branch is
  // planned. ANALYZE here EXECUTES the query, payloads included, so this is a manual mode only.
  const observeWindow = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, VERBOSE) ${NEWEST_CAPTURE_PER_DATE}`,
    [SOURCE.nbuFairValue, addDays(today, -OBSERVE_WINDOW_DAYS), today, null],
  );
  plans.observeNbu = observeWindow.rows.map((r) => r['QUERY PLAN']);

  // The expensive branch, and what this plan must keep saying is that the SCAN IS BOUNDED: the
  // open range it once planned fell to a full scan. NO ANALYZE — planning it is the point.
  const observeFirstWindow = await client.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (VERBOSE) ${NEWEST_CAPTURE_PER_DATE}`,
    [SOURCE.nbuFairValue, NBU_ARCHIVE_START, observeWindowEnd(NBU_ARCHIVE_START, today), null],
  );
  plans.observeNbuFirstWindow = observeFirstWindow.rows.map((r) => r['QUERY PLAN']);

  // The days `observeInzhur` reads, delisting days included; `observeNbu` reads past nothing.
  const reconciled = await reconcileObservations(client, {
    source: SOURCE.inzhur,
    errorsLike: READ_PAST_LIKE,
  });

  // A count that reconciles proves the plumbing; only a value proves the parse.
  const sample = await client.query(
    // Qualified for the reason `NEWEST_CAPTURE_PER_DATE` is: the alias shadowed the sort key
    // here too, and a text sort cannot walk the key backwards.
    `SELECT to_char(as_of, 'YYYY-MM-DD') AS as_of, instrument_ref, basis,
            price::text, ytm::text, clean_rate::text
       FROM price_observation
      ORDER BY price_observation.as_of DESC, instrument_ref LIMIT 3`,
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
  backfill?: BackfillRequest;
  /** Manual re-capture of one date, e.g. to repair a bad day. */
  asOf?: string;
  diagnose?: boolean;
  /** Derive observations from payloads already stored. Network-free. */
  observe?: ObserveRequest;
  /** Manual, and network-bound. */
  importFundHistory?: ImportFundHistoryRequest;
}

export async function handler(event: HandlerEvent = {}) {
  forgetRobots();
  const client = await connect();
  try {
    await ensureSchema(client);

    if (event.diagnose === true) return await diagnose(client);

    if (event.importFundHistory !== undefined) {
      return await importFundHistory(client, event.importFundHistory);
    }

    if (event.observe !== undefined) {
      // NBU STAYS THE DEFAULT: `{observe:{}}` has always meant "derive the NBU archive", and
      // silently repointing it is how a habitual command becomes a surprise.
      const src = event.observe.source;
      if (src === SOURCE.inzhur) return await observeInzhur(client, event.observe);
      // A typo must not derive NBU over an Inzhur-shaped range and call it a success: only
      // ABSENT means "the default".
      if (src !== undefined && src !== SOURCE.nbuFairValue) {
        throw new Error(`unknown observe source: ${src}`);
      }
      return await observeNbu(client, event.observe);
    }

    if (event.backfill !== undefined) return await backfillNbu(client, event.backfill);

    // ONE automation, two sources, TWO as-of dates: Inzhur's live endpoint serves the price
    // struck for the run's own day, where NBU's URL asks for a file that cannot exist yet.
    const now = new Date();
    const runDate = kyivDateIso(now);
    const asOfOf = (source: string) =>
      event.asOf ?? (source === SOURCE.inzhur ? inzhurAsOf(now) : nbuAsOf(now));

    const results: CaptureResult[] = [];
    for (const source of [SOURCE.inzhur, SOURCE.nbuFairValue]) {
      const asOf = asOfOf(source);
      // The schedule fires several times a day, so a provider outage at 01:00 is not the end of
      // it. The guard runs BEFORE the fetch, so the providers still see one request a day.
      if (await alreadySettled(client, source, asOf)) continue;
      results.push(await captureOne(client, source, asOf));
    }
    // Reported under the RUN date, the one fact both sources share: each row carries its own
    // `as_of`, and a single top-level one would conflate the two.
    if (results.length === 0) return { runDate, results, skipped: 'already settled' };

    // A TRAILING WINDOW RATHER THAN JUST `asOf`, because a missed night is a hole nobody fills,
    // and a hole here is invisible. BOUNDED AT BOTH ENDS: `to` defaults to today, so omitting it
    // made a repair of an old date derive years forward as one enormous spike.
    for (const source of [SOURCE.inzhur, SOURCE.nbuFairValue]) {
      const date = asOfOf(source);
      await observeAndReport(client, source, addDays(date, -OBSERVE_WINDOW_DAYS), date);
    }

    // THE SHAPE OF THE FEED, PUBLISHED AND NEVER ALARMED: no threshold can judge either number,
    // and a single rule over both sources would be wrong for one. What DOES alarm is a named ref
    // going missing. Emitted HERE rather than in `captureOne`, or a long backfill scatters points
    // across ten years of graph; the scheduled path is the only caller that reaches this line.
    for (const r of results) {
      console.log(
        JSON.stringify({ metric: 'entryCount', source: r.source, asOf: r.asOf, value: r.entries }),
      );
      console.log(
        JSON.stringify({ metric: 'skippedRefs', source: r.source, asOf: r.asOf, value: r.skipped }),
      );
      if (r.quotes === undefined) continue;

      // GRAPHED, NEVER ALARMED: staleness is the steady state of this feed rather than an event,
      // so an alarm would fire nightly and be muted. A step change in the maximum is the signal.
      console.log(
        JSON.stringify({
          metric: 'quoteMaxStaleDays',
          source: r.source,
          asOf: r.asOf,
          value: r.quotes.maxStaleDays,
        }),
      );
      console.log(
        JSON.stringify({
          metric: 'quoteVerdicts',
          source: r.source,
          asOf: r.asOf,
          consistent: r.quotes.consistent,
          stale: r.quotes.stale,
          revised: r.quotes.revised,
          insensitive: r.quotes.insensitive,
        }),
      );

      // THE ONE VERDICT THAT DESERVES WAKING SOMEONE: no yield the model can produce explains the
      // quote at all, and it has never occurred, which is what makes an alarm on it safe.
      if (r.quotes.unexplained.length > 0) {
        console.warn(
          `UNEXPLAINED_QUOTE source=${r.source} asOf=${r.asOf} refs=${r.quotes.unexplained.join(',')}`,
        );
      }
    }

    // Only on the scheduled path: a backfill would emit the value hundreds of times.
    await reportAlertChannels();
    await reportBackupFreshness();

    // A weekend 404 from NBU is the calendar, not a failure.
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
