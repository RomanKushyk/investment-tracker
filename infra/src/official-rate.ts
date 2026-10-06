// NBU's official USD rate as `/view` serves it: one stored row per Kyiv day in this environment's
// user cluster, read first, fetched and stored on a miss, and otherwise the latest earlier day's
// rate under its own date. `rate-ahead.ts` calls `ensure` and `latestRate`; `view.ts` calls
// `served`, the request's read.
//
// A Lambda's module scope cannot hold the day's rate: each concurrent request runs in an execution
// environment of its own. A reader keeps one thing between its calls, the failed-fetch spacing, so
// where a caller builds it decides how far that spacing reaches.
//
// `fetch` IS THE RAW ONE, not `robotsFetch`: the robots rule is the capture's, for crawling, and
// RFC 9309 scopes robots rules to crawlers (*External sources*).
import { nbuRateUrl, parseNbuRate } from '@quirenote/core/nbu/rate';
import { codeOf } from './dsql';
import type { SqlClient } from './migrate';

/** RFC 2308's ceiling on caching a failure: "MUST NOT cache it for longer than five (5) minutes". */
export const RATE_SPACING_MS = 300_000;

/** The browser's and the capture's figure for the same host. */
export const RATE_FETCH_TIMEOUT_MS = 10_000;

export interface StoredRate {
  rate: number;
  /** The day the rate is NBU's for, ISO — today's, or an earlier day's when today's is unknown. */
  date: string;
}

/**
 * The latest stored rate on or before `date`. Read outside any transaction, and a read-only one is
 * conflict-free. The date comes back as text, `pg` turning a bare `date` into a local midnight.
 */
export async function latestRate(client: SqlClient, date: string): Promise<StoredRate | undefined> {
  const { rows } = await client.query<{ day: string; rate: string }>(
    `SELECT to_char(rate_date, 'YYYY-MM-DD') AS day, rate::text AS rate
       FROM official_rate
      WHERE currency = 'USD' AND rate_date <= $1
      ORDER BY rate_date DESC
      LIMIT 1`,
    [date],
  );
  return rows[0] && { rate: Number(rows[0].rate), date: rows[0].day };
}

/** NBU's rate for `date`, or why there is none. Every NBU failure is an HTTP 200, so the body is
 *  read as text and parsed; `exchangedate` echoes the date asked for, so another is not this one. */
async function fetchRate(fetchFn: typeof fetch, date: string): Promise<number | string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RATE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchFn(nbuRateUrl(date), { signal: controller.signal });
    if (!response.ok) {
      // An unread body holds its connection until it is collected.
      await response.body?.cancel().catch(() => undefined);
      return `status ${response.status}`;
    }
    const parsed = parseNbuRate(await response.text());
    return parsed?.date === date ? parsed.rate : 'unreadable';
  } catch (err) {
    // `fetch` rejects every network failure as one `TypeError`; the system's code is its cause.
    const code = (err as { cause?: { code?: unknown } } | null | undefined)?.cause?.code;
    return typeof code === 'string' ? code : err instanceof Error ? err.name : 'error';
  } finally {
    clearTimeout(timer);
  }
}

/** ALONE IN ITS TRANSACTION, so a conflict costs nothing else. A `40001` is usually another writer
 *  of the day, but DDL answers it too, so it is logged and the caller's re-read decides. */
async function store(client: SqlClient, date: string, rate: number): Promise<void> {
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO official_rate (rate_date, currency, rate) VALUES ($1, 'USD', $2)
       ON CONFLICT (rate_date, currency) DO NOTHING`,
      [date, rate],
    );
    await client.query('COMMIT');
  } catch (err) {
    // A conflicting transaction is left open rather than closed, so this is what ends it.
    await client.query('ROLLBACK').catch(() => undefined);
    if (codeOf(err) !== '40001') throw err;
    console.log(JSON.stringify({ officialRate: 'conflict', date }));
  }
}

/** The spacing a reader keeps reaches its own calls alone: built once per environment, it spaces
 *  that environment's requests; built per invocation, a retried invocation asks again. */
export function createOfficialRate(fetchFn: typeof fetch = fetch, now: () => number = Date.now) {
  const failedAt = new Map<string, number>();

  /** Fetches and stores `date`'s rate unless a fetch for it failed here under five minutes ago.
   *  A failure is logged and stored nowhere: the next caller past the spacing asks again. */
  async function ensure(client: SqlClient, date: string): Promise<void> {
    const failed = failedAt.get(date);
    if (failed !== undefined && now() - failed < RATE_SPACING_MS) return;
    const rate = await fetchRate(fetchFn, date);
    if (typeof rate === 'string') {
      failedAt.set(date, now());
      console.log(JSON.stringify({ officialRate: 'unfetched', date, reason: rate }));
      return;
    }
    await store(client, date, rate);
  }

  /** `today`'s rate, stored or fetched; else the latest earlier one under its own date (RFC 5861's
   *  stale-if-error); else nothing. Call it outside any open transaction: a miss writes. */
  async function served(client: SqlClient, today: string): Promise<StoredRate | undefined> {
    const latest = await latestRate(client, today);
    if (latest?.date === today) return latest;
    await ensure(client, today);
    return latestRate(client, today);
  }

  return { ensure, served };
}
