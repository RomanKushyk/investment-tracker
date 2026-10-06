// The archive read `GET /view` makes, on PGlite with `ensureSchema`'s own DDL; the capture and
// replay cases add their rows through `handler`, the real writers.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import type { PGlite } from '@electric-sql/pglite';
import { addDays } from '@quirenote/core/dates';
import { parseAssetsFeed } from '@quirenote/core/inzhur/parse';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { bondTermsRow } from './bond-terms';
import { handler } from './capture';
import { connect } from './dsql';
import type { SqlClient } from './migrate';
import { OBSERVE_CAP_DAYS } from './observe-window';
import { readPaymentDates, readSellObservations } from './sell-observations';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const PAGE = readFileSync(
  new URL(
    '../../packages/core/src/inzhur/__fixtures__/offer-ovdp-2026-09-24.html',
    import.meta.url,
  ),
  'utf8',
);

let db: PGlite;

// `ensureSchema` builds its indexes `ASYNC`, a DSQL verb PGlite refuses; the rest is the engine's.
beforeEach(async () => {
  db = await freshDb();
  vi.mocked(connect).mockResolvedValue({
    query: (text: string, values?: unknown[]) =>
      db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values),
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

/** The schema, from `ensureSchema` itself: an observe over an empty archive derives nothing. */
const schema = () =>
  handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });

const client = () => db as unknown as SqlClient;

const observe = (
  asOf: string,
  ref: string,
  { basis = 'sell', source = 'inzhur', price = 100 } = {},
) =>
  db.query(
    `INSERT INTO price_observation (as_of, instrument_ref, basis, source, price, observed_at,
                                    parser_version)
     VALUES ($1, $2, $3, $4, $5, now(), '2')`,
    [asOf, ref, basis, source, price],
  );

describe('readSellObservations', () => {
  it('matches a ref stored in either case to the asset that names it in any case', async () => {
    await schema();
    await observe('2026-09-10', 'UA4000238976', { price: 1004.2 });
    await observe('2026-09-10', 'inzhur-reit', { price: 11.5866 });

    const { rows } = await readSellObservations(
      client(),
      ['Ua4000238976', 'Inzhur-REIT'],
      '2026-09-01',
      '2026-09-30',
    );
    expect(rows.sort((a, b) => a.ref.localeCompare(b.ref))).toEqual([
      { ref: 'inzhur-reit', asOf: '2026-09-10', price: 11.5866 },
      { ref: 'UA4000238976', asOf: '2026-09-10', price: 1004.2 },
    ]);
  });

  it('returns only the dealer’s sell rows, never another basis or another source', async () => {
    await schema();
    await observe('2026-09-10', 'UA4000238976', { price: 101 });
    await observe('2026-09-10', 'UA4000238976', { basis: 'buy', price: 102 });
    await observe('2026-09-10', 'UA4000238976', { basis: 'nav', price: 103 });
    await observe('2026-09-10', 'UA4000238976', { basis: 'fair', source: 'nbu_fv', price: 104 });
    await observe('2026-09-10', 'UA4000238976', { source: 'nbu_fv', price: 105 });

    const { rows } = await readSellObservations(
      client(),
      ['UA4000238976'],
      '2026-09-01',
      '2026-09-30',
    );
    expect(rows).toEqual([{ ref: 'UA4000238976', asOf: '2026-09-10', price: 101 }]);
  });

  it('reads a span longer than the cap whole, in windows that each name both bounds', async () => {
    await schema();
    const from = '2020-01-01';
    const firstEnd = addDays(from, OBSERVE_CAP_DAYS);
    const to = addDays(firstEnd, 300);
    const inside = [from, firstEnd, addDays(firstEnd, 1), to];
    for (const day of [addDays(from, -1), ...inside, addDays(to, 1)]) {
      await observe(day, 'inzhur-reit');
    }

    const calls: { sql: string; values: unknown[] }[] = [];
    const recording: SqlClient = {
      query: (sql, values) => {
        calls.push({ sql, values: values ?? [] });
        return db.query(sql, values) as never;
      },
    };
    const { rows } = await readSellObservations(recording, ['inzhur-reit'], from, to);

    expect(rows.map((r) => r.asOf).sort()).toEqual(inside);
    expect(calls).toHaveLength(2);
    let next = from;
    for (const { sql, values } of calls) {
      expect(sql).toMatch(/\bas_of BETWEEN \$2 AND \$3\b/);
      const [lo, hi] = values.slice(1) as [string, string];
      expect(lo).toBe(next);
      expect(hi >= lo && hi <= addDays(lo, OBSERVE_CAP_DAYS)).toBe(true);
      next = addDays(hi, 1);
    }
    expect(next).toBe(addDays(to, 1));
  });

  it('sends no statement for a portfolio with no linked ref', async () => {
    const calls: string[] = [];
    const recording: SqlClient = {
      query: (sql) => {
        calls.push(sql);
        return Promise.resolve({ rows: [] }) as never;
      },
    };
    const { rows } = await readSellObservations(recording, [], '2026-09-01', '2026-09-30');
    expect(rows).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a bound it cannot read as a day, and a span that ends before it starts', async () => {
    await schema();
    await expect(readSellObservations(client(), ['x'], '2026-9-1', '2026-09-30')).rejects.toThrow(
      /YYYY-MM-DD/,
    );
    await expect(readSellObservations(client(), ['x'], '2026-09-30', '2026-09-01')).rejects.toThrow(
      /after/,
    );
  });
});

/** A `bond_terms` row as the capture writes one: the schedule serialised whole, a payment a date. */
const terms = (asOf: string, ref: string, dates: readonly string[]) =>
  db.query(
    `INSERT INTO bond_terms (as_of, ref, terms_sha256, maturity, payment_schedule, observed_at,
                             parser_version)
     VALUES ($1, $2, '', NULL, $3, now(), '2')`,
    [asOf, ref, JSON.stringify(dates.map((date) => ({ date, amount: 78.4 })))],
  );

const EARLIER = ['2026-03-25', '2026-09-23', '2027-03-24'];
const LATER = ['2026-03-25', '2026-09-23', '2027-03-23'];

describe('readPaymentDates', () => {
  const read = (refs: readonly string[], from: string, to: string) =>
    readPaymentDates(client(), refs, from, to);

  it('answers with the latest row on or before the day, not one after it', async () => {
    await schema();
    await terms('2026-09-01', 'UA4000238976', EARLIER);
    await terms('2026-09-10', 'UA4000238976', LATER);

    expect((await read(['UA4000238976'], '2026-08-01', '2026-09-15')).rows).toEqual([
      { ref: 'UA4000238976', dates: LATER },
    ]);
    expect((await read(['UA4000238976'], '2026-08-01', '2026-09-05')).rows).toEqual([
      { ref: 'UA4000238976', dates: EARLIER },
    ]);
  });

  it('leaves out a ref with no row on or before the day, or none inside the window', async () => {
    await schema();
    await terms('2026-09-01', 'UA4000238976', EARLIER);
    await terms('2026-09-10', 'UA4000238976', LATER);

    expect((await read(['UA4000238976'], '2026-08-01', '2026-08-31')).rows).toEqual([]);
    expect((await read(['UA4000238976'], '2026-09-11', '2026-09-30')).rows).toEqual([]);
    // The same windows reach the row once they hold its day, so the absence above is the bound's.
    expect((await read(['UA4000238976'], '2026-08-01', '2026-09-01')).rows).toHaveLength(1);
    expect((await read(['UA4000238976'], '2026-09-10', '2026-09-30')).rows).toHaveLength(1);
  });

  it('answers a ref stored upper-case to the ref as core folds it', async () => {
    await schema();
    await terms('2026-09-10', 'UA4000238976', LATER);
    expect((await read(['ua4000238976'], '2026-09-01', '2026-09-30')).rows).toEqual([
      { ref: 'UA4000238976', dates: LATER },
    ]);
  });

  // Each spelling holds each schedule once, so whichever spelling the read meets first, only the
  // schedule decides. `LATER`'s text sorts first.
  it('picks one of two spellings stored on one day by its schedule, never by arrival', async () => {
    await schema();
    const answer = async () => (await read(['UA4000238976'], '2026-09-01', '2026-09-30')).rows;
    await terms('2026-09-10', 'UA4000238976', EARLIER);
    await terms('2026-09-10', 'ua4000238976', LATER);
    expect(await answer()).toEqual([{ ref: 'ua4000238976', dates: LATER }]);
    await db.query(`DELETE FROM bond_terms`);
    await terms('2026-09-10', 'UA4000238976', LATER);
    await terms('2026-09-10', 'ua4000238976', EARLIER);
    expect(await answer()).toEqual([{ ref: 'UA4000238976', dates: LATER }]);
  });

  it('keeps one row per ref however many spellings the archive holds it under', async () => {
    await schema();
    await terms('2026-09-10', 'UA4000238976', LATER);
    await terms('2026-09-01', 'ua4000238976', EARLIER);
    expect((await read(['UA4000238976'], '2026-08-01', '2026-09-30')).rows).toEqual([
      { ref: 'UA4000238976', dates: LATER },
    ]);
  });

  it('serves every date the feed published, each once, for every bond it carried', async () => {
    await schema();
    const bonds = parseAssetsFeed(
      JSON.parse(
        readFileSync(
          new URL(
            '../../packages/core/src/inzhur/__fixtures__/assets-2026-09-24.json',
            import.meta.url,
          ),
          'utf8',
        ),
      ),
    ).entries.filter((q) => q.kind === 'bond');
    for (const quote of bonds) {
      const row = bondTermsRow(quote)!;
      await db.query(
        `INSERT INTO bond_terms (as_of, ref, terms_sha256, maturity, payment_schedule,
                                 observed_at, parser_version)
         VALUES ('2026-09-24', $1, $2, $3, $4, now(), '2')`,
        [row.ref, row.termsSha256, row.maturity, row.paymentSchedule],
      );
    }
    const published = (dates: string[]) => [...new Set(dates)];
    // The maturity carries the last coupon and the principal, so a payload repeats its date.
    expect(
      bonds.some(
        (q) => published(q.paymentSchedule.map((p) => p.date)).length < q.paymentSchedule.length,
      ),
    ).toBe(true);

    const { rows } = await read(
      bonds.map((q) => q.ref),
      '2026-09-01',
      '2026-09-30',
    );
    expect(Object.fromEntries(rows.map((r) => [r.ref, r.dates]))).toEqual(
      Object.fromEntries(
        bonds.map((q) => [q.ref, published(q.paymentSchedule.map((p) => p.date))]),
      ),
    );
  });

  it('reads a span longer than the cap in windows that each name both bounds', async () => {
    await schema();
    const from = '2020-01-01';
    const firstEnd = addDays(from, OBSERVE_CAP_DAYS);
    const to = addDays(firstEnd, 300);
    await terms(from, 'UA4000238976', EARLIER);
    await terms(addDays(firstEnd, 1), 'UA4000238976', LATER);
    await terms(addDays(to, 1), 'UA4000238976', ['2030-01-01']);

    const calls: { sql: string; values: unknown[] }[] = [];
    const recording: SqlClient = {
      query: (sql, values) => {
        calls.push({ sql, values: values ?? [] });
        return db.query(sql, values) as never;
      },
    };
    const { rows } = await readPaymentDates(recording, ['UA4000238976'], from, to);

    expect(rows).toEqual([{ ref: 'UA4000238976', dates: LATER }]);
    expect(calls).toHaveLength(2);
    let next = from;
    for (const { sql, values } of calls) {
      expect(sql).toMatch(/\bas_of BETWEEN \$2 AND \$3\b/);
      const [lo, hi] = values.slice(1) as [string, string];
      expect(lo).toBe(next);
      expect(hi >= lo && hi <= addDays(lo, OBSERVE_CAP_DAYS)).toBe(true);
      next = addDays(hi, 1);
    }
    expect(next).toBe(addDays(to, 1));
  });

  it('sends no statement for a portfolio with no linked ref', async () => {
    const calls: string[] = [];
    const recording: SqlClient = {
      query: (sql) => {
        calls.push(sql);
        return Promise.resolve({ rows: [] }) as never;
      },
    };
    const { rows } = await readPaymentDates(recording, [], '2026-09-01', '2026-09-30');
    expect(rows).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('refuses a bound it cannot read as a day, and a span that ends before it starts', async () => {
    await schema();
    await expect(read(['x'], '2026-9-1', '2026-09-30')).rejects.toThrow(/YYYY-MM-DD/);
    await expect(read(['x'], '2026-09-30', '2026-09-01')).rejects.toThrow(/after/);
  });

  describe('its digest', () => {
    const digest = async () =>
      (await read(['UA4000238976', 'UA4000236475'], '2026-09-01', '2026-09-30')).digest;

    it('moves when the dates served change', async () => {
      await schema();
      await terms('2026-09-10', 'UA4000238976', EARLIER);
      const before = await digest();
      await terms('2026-09-11', 'UA4000238976', LATER);
      expect(await digest()).not.toBe(before);
    });

    it('stands still when a later day repeats the same dates', async () => {
      await schema();
      await terms('2026-09-10', 'UA4000238976', EARLIER);
      const before = await digest();
      await terms('2026-09-11', 'UA4000238976', EARLIER);
      expect(await digest()).toBe(before);
    });

    it('moves with the ref the dates are for', async () => {
      await schema();
      await terms('2026-09-10', 'UA4000238976', EARLIER);
      const before = await digest();
      await db.query(`DELETE FROM bond_terms`);
      await terms('2026-09-10', 'UA4000236475', EARLIER);
      expect(await digest()).not.toBe(before);
    });
  });
});

/** A provider serving `body` at `/offer/ovdp` and a 404 for its robots.txt, which RFC 9309 reads
 *  as "any resource may be accessed". */
async function provider(body: string): Promise<string> {
  const server = createServer((req, res) => {
    if (req.url === '/offer/ovdp') res.writeHead(200, { 'content-type': 'text/html' }).end(body);
    else res.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/offer/ovdp`;
}

const store = (source: string, asOf: string, body: string, parserVersion: string) =>
  db.query(
    `INSERT INTO price_capture (id, requested_at, as_of, source, ok, http_status, payload_gzip,
                                payload_bytes, payload_sha256, parser_version)
     VALUES ($1, now(), $2, $3, true, 200, $4, $5, '', $6)`,
    [
      randomUUID(),
      asOf,
      source,
      gzipSync(Buffer.from(body, 'utf8')),
      Buffer.byteLength(body, 'utf8'),
      parserVersion,
    ],
  );

describe('the validator input moves with the observations it covers, and only with them', () => {
  const AS_OF = '2026-09-25';
  const REFS = ['UA4000238976', 'inzhur-reit'];
  const digest = async () =>
    (await readSellObservations(client(), REFS, '2026-09-01', '2026-09-30')).digest;

  /** NBU settled for the day, so a capture run asks only the provider served here. */
  async function captureDay(body: string) {
    await store('nbu_fv', AS_OF, '', '1');
    vi.stubEnv('FEED_URL', await provider(body));
  }

  it('moves when a capture adds an observation inside the span', async () => {
    await schema();
    await captureDay(PAGE);
    const before = await digest();
    await handler({ asOf: AS_OF });
    const after = await readSellObservations(client(), REFS, '2026-09-01', '2026-09-30');
    expect(after.rows.length).toBeGreaterThan(0);
    expect(after.digest).not.toBe(before);
  });

  it('moves when an observe replay adds an observation inside the span', async () => {
    await schema();
    await store('inzhur', AS_OF, PAGE, '2');
    const before = await digest();
    await handler({ observe: { source: 'inzhur', from: AS_OF, to: AS_OF } });
    const after = await readSellObservations(client(), REFS, '2026-09-01', '2026-09-30');
    expect(after.rows.length).toBeGreaterThan(0);
    expect(after.digest).not.toBe(before);
    // The replay wrote no capture of its own: the one row is the stored one.
    const { rows } = await db.query(`SELECT 1 FROM price_capture WHERE source = 'inzhur'`);
    expect(rows).toHaveLength(1);
  });

  it('stands still when a capture repeats the same day’s identical quotes', async () => {
    await schema();
    // Without its schedules the page records `schedule absent`, which leaves the day unsettled,
    // so the second run really fetches again rather than stopping at `alreadySettled`.
    const unsettled = PAGE.replace(/<astro-island\b[\s\S]*?<\/astro-island>/, '');
    expect(unsettled).not.toBe(PAGE);
    await captureDay(unsettled);
    // The run's last step throws for the recorded failure, after the observe has run.
    const unscheduled = /inzhur \(as_of 2026-09-25\): schedule absent: /;
    await expect(handler({ asOf: AS_OF })).rejects.toThrow(unscheduled);
    const first = await readSellObservations(client(), REFS, '2026-09-01', '2026-09-30');
    await expect(handler({ asOf: AS_OF })).rejects.toThrow(unscheduled);

    const { rows } = await db.query<{ quotes_sha256: string | null }>(
      `SELECT quotes_sha256 FROM price_capture WHERE source = 'inzhur' AND as_of = $1`,
      [AS_OF],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].quotes_sha256).not.toBeNull();
    expect(rows[1].quotes_sha256).toBe(rows[0].quotes_sha256);
    expect(first.rows.length).toBeGreaterThan(0);
    expect(await digest()).toBe(first.digest);
  });

  it('digests the quote, not only its day: two archives apart by one price differ', async () => {
    await schema();
    await observe('2026-09-10', 'UA4000238976', { price: 100 });
    const before = await digest();
    // No writer rewrites a row, so the test does it by hand to isolate the price.
    await db.query(`DELETE FROM price_observation`);
    await observe('2026-09-10', 'UA4000238976', { price: 100.01 });
    expect(await digest()).not.toBe(before);
  });

  it('stands still when a row outside the refs is added', async () => {
    await schema();
    await observe('2026-09-10', 'UA4000238976');
    const before = await digest();
    await observe('2026-09-11', 'UA4000999999');
    expect(await digest()).toBe(before);
    // The same row for a ref in the set is seen, so the stillness above is the filter's.
    await observe('2026-09-11', 'UA4000238976');
    expect(await digest()).not.toBe(before);
  });

  it('stands still when a row outside the span is added', async () => {
    await schema();
    await observe('2026-09-10', 'UA4000238976');
    const before = await digest();
    await observe('2026-08-31', 'UA4000238976');
    await observe('2026-10-01', 'UA4000238976');
    expect(await digest()).toBe(before);
    await observe('2026-09-30', 'UA4000238976');
    expect(await digest()).not.toBe(before);
  });
});
