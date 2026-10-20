// `importWaybackQuotes` on PGlite with the cluster connection and the network replaced: every listed
// snapshot answers with the committed Nuxt-era page, dated by its own Memento-Datetime.
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { handler } from './capture';
import { connect } from './dsql';
import { WAYBACK_SNAPSHOTS } from './wayback';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const PAGE = readFileSync(
  new URL(
    '../../packages/core/src/inzhur/__fixtures__/offer-nuxt-2026-05-11.html',
    import.meta.url,
  ),
  'utf8',
);

let db: PGlite;
/** An observation insert to fail, by a value it carries, to reach the import's rollback. */
let failOn: RegExp | undefined;
/** How each snapshot answers; the default is the page with its own Memento-Datetime. */
let answer: (timestamp: string) => Response;
/** Run once, just before the import opens its transaction: another writer committing between the
 *  plan's read and its write. */
let racing: (() => Promise<unknown>) | undefined;

const mementoOf = (ts: string) =>
  new Date(
    `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}T${ts.slice(8, 10)}:${ts.slice(10, 12)}:${ts.slice(12, 14)}Z`,
  ).toUTCString();
const page = (ts: string, body = PAGE) =>
  new Response(body, { status: 200, headers: { 'memento-datetime': mementoOf(ts) } });

// `ensureSchema` builds its indexes `ASYNC`, a DSQL verb PGlite refuses; `rowCount` is pg's name
// for PGlite's `affectedRows`.
beforeEach(async () => {
  db = await freshDb();
  failOn = undefined;
  racing = undefined;
  answer = (ts) => page(ts);
  vi.mocked(connect).mockResolvedValue({
    query: async (text: string, values?: unknown[]) => {
      const insert = /^\s*INSERT INTO price_observation/.test(text);
      if (insert && failOn !== undefined && values?.some((v) => failOn!.test(String(v)))) {
        throw new Error('injected failure');
      }
      if (text.trim() === 'BEGIN' && racing !== undefined) {
        const race = racing;
        racing = undefined;
        await race();
      }
      const r = await db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values);
      return { ...r, rowCount: r.affectedRows };
    },
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  // RFC 9309 reads a 404 robots.txt as no rule, which is what web.archive.org answers.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    const ts = /\/web\/(\d{14})id_\//.exec(url)?.[1];
    return ts === undefined ? new Response('', { status: 404 }) : answer(ts);
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const schema = () =>
  handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });
const run = () => handler({ importWaybackQuotes: {} });

const rows = async (where = 'true', values: unknown[] = []) =>
  (
    await db.query<{ row: string }>(
      `SELECT concat_ws(' ', to_char(as_of, 'YYYY-MM-DD'), instrument_ref, basis, price::text,
                        parser_version) AS row
         FROM price_observation WHERE ${where} ORDER BY 1`,
      values,
    )
  ).rows.map((r) => r.row);

const observe = (asOf: string, ref: string, basis: string, price: string, parserVersion: string) =>
  db.query(
    `INSERT INTO price_observation
       (as_of, instrument_ref, basis, source, price, observed_at, parser_version)
     VALUES ($1, $2, $3, 'inzhur', $4, now(), $5)`,
    [asOf, ref, basis, price, parserVersion],
  );

/** The Kyiv days the 14 snapshots fall on. */
const DAYS = [
  '2026-05-08',
  '2026-05-11',
  '2026-05-14',
  '2026-05-17',
  '2026-05-18',
  '2026-05-29',
  '2026-06-07',
  '2026-06-15',
  '2026-07-28',
];

describe('importWaybackQuotes', () => {
  it('writes every basis each snapshot served, dated by the Kyiv day it was read', async () => {
    await schema();
    const result = (await run()) as {
      written: Record<string, number>;
      snapshots: { asOf: string }[];
    };
    expect([...new Set(result.snapshots.map((s) => s.asOf))]).toEqual(DAYS);
    const reit = await rows(`instrument_ref = 'inzhur-reit'`);
    expect(reit).toHaveLength(DAYS.length * 3);
    expect(reit.filter((r) => r.startsWith('2026-05-11 '))).toEqual([
      '2026-05-11 inzhur-reit buy 10.8238 wayback-1',
      '2026-05-11 inzhur-reit nav 10.7166 wayback-1',
      '2026-05-11 inzhur-reit sell 10.813 wayback-1',
    ]);
    // A bond's nav is the provider's 0, never a reading.
    expect(await rows(`instrument_ref = 'UA4000236475' AND as_of = '2026-05-11'`)).toEqual([
      '2026-05-11 UA4000236475 buy 1060.12 wayback-1',
      '2026-05-11 UA4000236475 sell 1060.12 wayback-1',
    ]);
    const observedAt = await db.query<{ t: string }>(
      `SELECT to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS t
         FROM price_observation WHERE as_of = '2026-05-29' LIMIT 1`,
    );
    expect(observedAt.rows[0].t).toBe('2026-05-29T00:29:53');
    expect(result.written['inzhur-reit']).toBe(DAYS.length * 3);
  });

  it('marks its rows apart from the feed, the offer page, the history file and an imputation', async () => {
    await schema();
    await observe('2026-08-11', 'inzhur-reit', 'sell', '11.2', '1');
    await observe('2026-09-25', 'inzhur-reit', 'sell', '11.6', '2');
    await observe('2026-04-01', 'inzhur-reit', 'nav', '10.6', 'fund-history-1');
    await observe('2026-04-23', 'UA4000236475', 'sell', '1050.00', 'derived-sell-1');
    await run();
    const versions = await db.query<{ v: string }>(
      `SELECT DISTINCT parser_version AS v FROM price_observation ORDER BY 1`,
    );
    expect(versions.rows.map((r) => r.v)).toEqual([
      '1',
      '2',
      'derived-sell-1',
      'fund-history-1',
      'wayback-1',
    ]);
  });

  it('writes nothing the second time', async () => {
    await schema();
    await run();
    const after = await rows();
    const second = (await run()) as { written: Record<string, number>; collisions: unknown[] };
    // Every key it planned is now held, so it writes none and reports each as a collision.
    expect(second.written).toEqual({});
    expect(second.collisions).toHaveLength(after.length);
    expect(await rows()).toEqual(after);
  });

  it('leaves an agreeing archive row as it is, and reports it', async () => {
    await schema();
    await observe('2026-05-11', 'inzhur-reit', 'nav', '10.716600', 'fund-history-1');
    const result = (await run()) as { collisions: unknown[] };
    expect(result.collisions).toContainEqual({
      asOf: '2026-05-11',
      ref: 'inzhur-reit',
      basis: 'nav',
      parserVersion: 'fund-history-1',
    });
    expect(
      await rows(`as_of = '2026-05-11' AND instrument_ref = 'inzhur-reit' AND basis = 'nav'`),
    ).toEqual(['2026-05-11 inzhur-reit nav 10.716600 fund-history-1']);
  });

  it('writes nothing when an archive row on its key disagrees', async () => {
    await schema();
    await observe('2026-05-11', 'inzhur-reit', 'nav', '10.716700', 'fund-history-1');
    const before = await rows();
    await expect(run()).rejects.toThrow(
      /2026-05-11 inzhur-reit nav: the archive's fund-history-1 row disagrees/,
    );
    expect(await rows()).toEqual(before);
  });

  it('refuses a snapshot that answers with no Memento-Datetime, or not 200, before writing', async () => {
    await schema();
    const last = WAYBACK_SNAPSHOTS.at(-1)!.timestamp;
    answer = (ts) => (ts === last ? new Response(PAGE, { status: 200 }) : page(ts));
    await expect(run()).rejects.toThrow(`${last}: HTTP 200, no snapshot`);
    answer = (ts) =>
      ts === last
        ? new Response('offline', { status: 503, headers: { 'memento-datetime': mementoOf(ts) } })
        : page(ts);
    await expect(run()).rejects.toThrow(`${last}: HTTP 503, no snapshot`);
    expect(await rows()).toEqual([]);
  });

  it('refuses a key another writer filled between its read and its insert, writing nothing', async () => {
    await schema();
    racing = () => observe('2026-05-08', 'UA4000236475', 'sell', '1.00', 'derived-sell-1');
    await expect(run()).rejects.toThrow(/written since the plan read the archive/);
    expect(await rows()).toEqual(['2026-05-08 UA4000236475 sell 1.00 derived-sell-1']);
  });

  it('names the snapshot a fetch failed on', async () => {
    await schema();
    const ninth = WAYBACK_SNAPSHOTS[8].timestamp;
    answer = (ts) => {
      if (ts === ninth) throw new Error('This operation was aborted');
      return page(ts);
    };
    await expect(run()).rejects.toThrow(`${ninth}: This operation was aborted`);
  });

  it('writes no row when a write fails partway', async () => {
    await schema();
    failOn = /^UA4000236475$/;
    await expect(run()).rejects.toThrow('injected failure');
    expect(await rows()).toEqual([]);
  });

  it('widens each instrument’s bounds to its snapshot days, never narrowing one', async () => {
    await schema();
    await db.query(
      `INSERT INTO instrument (ref, kind, currency, listed_from, last_seen_on)
       VALUES ('inzhur-reit', 'fund', 'UAH', '2026-08-11', '2026-10-20')`,
    );
    await run();
    const i = await db.query<{ f: string; l: string }>(
      `SELECT to_char(listed_from, 'YYYY-MM-DD') AS f, to_char(last_seen_on, 'YYYY-MM-DD') AS l
         FROM instrument WHERE ref = 'inzhur-reit'`,
    );
    expect(i.rows[0]).toEqual({ f: '2026-05-08', l: '2026-10-20' });
    const bond = await db.query<{ f: string; m: string }>(
      `SELECT to_char(listed_from, 'YYYY-MM-DD') AS f, to_char(maturity, 'YYYY-MM-DD') AS m
         FROM instrument WHERE ref = 'UA4000236475'`,
    );
    expect(bond.rows[0]).toEqual({ f: '2026-05-08', m: '2028-09-27' });
    // A fund only the copies hold is seen from its first snapshot day to its last.
    const merged = await db.query<{ f: string; l: string }>(
      `SELECT to_char(listed_from, 'YYYY-MM-DD') AS f, to_char(last_seen_on, 'YYYY-MM-DD') AS l
         FROM instrument WHERE ref = '1001'`,
    );
    expect(merged.rows[0]).toEqual({ f: '2026-05-08', l: '2026-07-28' });
  });

  it('names a refused snapshot even when its body has already failed', async () => {
    await schema();
    const last = WAYBACK_SNAPSHOTS.at(-1)!.timestamp;
    answer = (ts) =>
      ts === last
        ? new Response(
            new ReadableStream({ start: (c) => c.error(new Error('connection reset')) }),
            {
              status: 503,
            },
          )
        : page(ts);
    await expect(run()).rejects.toThrow(`${last}: HTTP 503, no snapshot`);
  });

  it('names the snapshot whose body failed to arrive', async () => {
    await schema();
    const fifth = WAYBACK_SNAPSHOTS[4].timestamp;
    answer = (ts) =>
      ts === fifth
        ? new Response(new ReadableStream({ start: (c) => c.error(new Error('body stalled')) }), {
            status: 200,
            headers: { 'memento-datetime': mementoOf(ts) },
          })
        : page(ts);
    await expect(run()).rejects.toThrow(`${fifth}: body stalled`);
    expect(await rows()).toEqual([]);
  });
});
