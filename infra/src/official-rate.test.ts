// The official rate a request is served, executed against the user schema.
//
// WHAT THIS CANNOT PROVE: PGlite is pessimistic, so the race below meets a fabricated `40001`,
// the repo's precedent for OCC (`provision.test.ts`). What DSQL answers the losing COMMIT, and
// whether `ON CONFLICT` changes it, is AWS's word and unmeasured (`infra/docs/dsql-constraints.md`).
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nbuRateUrl } from '@quirenote/core/nbu/rate';
import { freshDb, refusingFirstCommit } from './__fixtures__/pglite';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { RATE_FETCH_TIMEOUT_MS, RATE_SPACING_MS, createOfficialRate } from './official-rate';

const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

// Noon in Kyiv on 29 September 2026, which is UTC+3 then.
const NOON = Date.parse('2026-09-29T09:00:00Z');
const TODAY = '2026-09-29';
const YESTERDAY = '2026-09-28';

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** NBU's body for one date, in the shape `packages/core/src/nbu/rate.test.ts` keeps verbatim. */
const body = (rate: number, iso: string) => {
  const [y, m, d] = iso.split('-');
  return `[\n{ \n"r030":840,"txt":"Долар США","rate":${rate},"cc":"USD","exchangedate":"${d}.${m}.${y}","special":"N"\n }\n]`;
};

/** A stand-in for NBU that counts what it is asked, so "no call" is a count of zero. */
const nbu = (reply: (signal: AbortSignal | undefined) => Promise<Response>) => {
  const asked: string[] = [];
  const fetchFn = ((...[input, init]: Parameters<typeof fetch>) => {
    asked.push(String(input));
    return reply(init?.signal ?? undefined);
  }) as typeof fetch;
  return { fetchFn, asked };
};

const answering = (rate: number, iso: string) => () =>
  Promise.resolve(new Response(body(rate, iso)));

const seed = (iso: string, rate: number) =>
  db.query(`INSERT INTO official_rate (rate_date, currency, rate) VALUES ($1, 'USD', $2)`, [
    iso,
    rate,
  ]);

const stored = async () =>
  (
    await db.query<{ day: string; rate: string }>(
      `SELECT to_char(rate_date, 'YYYY-MM-DD') AS day, rate::text AS rate
         FROM official_rate ORDER BY rate_date`,
    )
  ).rows;

/** Every statement, in order, so the transaction's edges are read rather than inferred. */
const recording = () => {
  const sent: string[] = [];
  const client: SqlClient = {
    query: <R>(text: string, values?: unknown[]) => {
      sent.push(text.trim());
      return db.query<R>(text, values) as Promise<{ rows: R[] }>;
    },
  };
  return { client, sent };
};

const verb = (text: string) => text.split(/\s+/)[0];

const until = async (ok: () => boolean) => {
  while (!ok()) await new Promise((resolve) => setImmediate(resolve));
};

describe('a rate stored for today', () => {
  it('is served with no call to NBU', async () => {
    await seed(TODAY, 44.8153);
    const { fetchFn, asked } = nbu(answering(44.9999, TODAY));
    expect(await createOfficialRate(fetchFn, () => NOON).served(db, TODAY)).toEqual({
      rate: 44.8153,
      date: TODAY,
    });
    expect(asked).toEqual([]);
  });
});

// The caller names the day its answer is built for, so a read straddling Kyiv midnight cannot pair
// one day's body with the next day's rate.
describe('a rate asked for by day', () => {
  it('serves the day it is asked for, whatever its own clock reads', async () => {
    await seed(YESTERDAY, 44.7626);
    await seed(TODAY, 44.8153);
    const { fetchFn, asked } = nbu(answering(44.9999, TODAY));
    expect(await createOfficialRate(fetchFn, () => NOON).served(db, YESTERDAY)).toEqual({
      rate: 44.7626,
      date: YESTERDAY,
    });
    expect(asked).toEqual([]);
  });
});

describe('a request that finds no row for today', () => {
  it('fetches once, stores one row, and serves it', async () => {
    await seed(YESTERDAY, 44.7626);
    const { fetchFn, asked } = nbu(answering(44.8153, TODAY));
    const rates = createOfficialRate(fetchFn, () => NOON);
    expect(await rates.served(db, TODAY)).toEqual({ rate: 44.8153, date: TODAY });
    expect(asked).toEqual([nbuRateUrl(TODAY)]);
    expect(await stored()).toEqual([
      { day: YESTERDAY, rate: '44.7626' },
      { day: TODAY, rate: '44.8153' },
    ]);
    // Stored is final: the next request reads it and asks nothing.
    expect(await rates.served(db, TODAY)).toEqual({ rate: 44.8153, date: TODAY });
    expect(asked).toHaveLength(1);
  });

  it('writes in a transaction holding that one insert and nothing else', async () => {
    const { client, sent } = recording();
    const { fetchFn } = nbu(answering(44.8153, TODAY));
    await createOfficialRate(fetchFn, () => NOON).served(client, TODAY);
    const begin = sent.indexOf('BEGIN');
    expect(sent.filter((t) => t === 'BEGIN')).toHaveLength(1);
    expect(sent.slice(begin, begin + 3).map(verb)).toEqual(['BEGIN', 'INSERT', 'COMMIT']);
    expect(sent[begin + 1]).toMatch(/^INSERT INTO official_rate\b/);
    expect(sent.map(verb)).toEqual(['SELECT', 'BEGIN', 'INSERT', 'COMMIT', 'SELECT']);
  });

  // THE LOSER FETCHED A DIFFERENT FIGURE, so serving its own fetch rather than the stored row
  // shows here; NBU's rate for a date is final, so in life the two would agree anyway.
  it('leaves one row when two race, and both answer the stored rate', async () => {
    await seed(YESTERDAY, 44.7626);
    const release: (() => void)[] = [];
    const gates = [0, 1].map(() => new Promise<void>((resolve) => release.push(resolve)));
    const first = nbu(() => gates[0].then(() => new Response(body(44.8153, TODAY))));
    const second = nbu(() => gates[1].then(() => new Response(body(44.9999, TODAY))));
    const loser = refusingFirstCommit(db, '40001');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    const won = createOfficialRate(first.fetchFn, () => NOON).served(db, TODAY);
    const lost = createOfficialRate(second.fetchFn, () => NOON).served(loser.client, TODAY);
    // Both have read "no row for today" before either fetch answers.
    await until(() => first.asked.length === 1 && second.asked.length === 1);
    release[0]();
    expect(await won).toEqual({ rate: 44.8153, date: TODAY });
    release[1]();
    expect(await lost).toEqual({ rate: 44.8153, date: TODAY });

    expect(await stored()).toEqual([
      { day: YESTERDAY, rate: '44.7626' },
      { day: TODAY, rate: '44.8153' },
    ]);
    expect(loser.sent.map(verb)).toEqual([
      'SELECT',
      'BEGIN',
      'INSERT',
      'COMMIT',
      'ROLLBACK',
      'SELECT',
    ]);
    // DDL answers `40001` too, so the swallowed code is said out loud.
    expect(log).toHaveBeenCalledWith(JSON.stringify({ officialRate: 'conflict', date: TODAY }));
  });

  it('reports a write that failed for any reason but contention', async () => {
    const refusing = refusingFirstCommit(db, '42501');
    const { fetchFn } = nbu(answering(44.8153, TODAY));
    await expect(
      createOfficialRate(fetchFn, () => NOON).served(refusing.client, TODAY),
    ).rejects.toThrow(/OC000/);
    expect(await stored()).toEqual([]);
  });
});

describe('a failed or empty NBU answer', () => {
  const failures: [string, (signal: AbortSignal | undefined) => Promise<Response>][] = [
    // A future date and an unknown currency both answer 200 with an empty array.
    ['an empty array', () => Promise.resolve(new Response('[]'))],
    // What NBU answers a malformed date: a 200 whose body is not JSON.
    ['a body that is not JSON', () => Promise.resolve(new Response('[{ Wrong date format }]'))],
    ['a 5xx', () => Promise.resolve(new Response('', { status: 503 }))],
    ['a refused connection', () => Promise.reject(new TypeError('fetch failed'))],
    ['a rejection carrying nothing', () => Promise.reject(null)],
    // `exchangedate` echoes the date asked for, so another date is not this day's rate.
    ['a rate for another date', answering(44.8153, YESTERDAY)],
  ];

  it.each(failures)(
    'is not stored, and yields the latest earlier rate with its own date: %s',
    async (_, reply) => {
      await seed('2026-09-27', 44.7);
      await seed(YESTERDAY, 44.7626);
      const { fetchFn, asked } = nbu(reply);
      expect(await createOfficialRate(fetchFn, () => NOON).served(db, TODAY)).toEqual({
        rate: 44.7626,
        date: YESTERDAY,
      });
      expect(asked).toEqual([nbuRateUrl(TODAY)]);
      expect((await stored()).map((r) => r.day)).toEqual(['2026-09-27', YESTERDAY]);
    },
  );

  it('is not stored, and yields the latest earlier rate with its own date: a timeout', async () => {
    await seed(YESTERDAY, 44.7626);
    const { fetchFn, asked } = nbu(
      (signal) =>
        new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason))),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let settled = false;
    const served = createOfficialRate(fetchFn, () => NOON)
      .served(db, TODAY)
      .finally(() => (settled = true));
    await until(() => asked.length === 1);
    await vi.advanceTimersByTimeAsync(RATE_FETCH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await served).toEqual({ rate: 44.7626, date: YESTERDAY });
    expect(await stored()).toEqual([{ day: YESTERDAY, rate: '44.7626' }]);
  });

  // `RateAgeAlarm` sends an operator to these lines, so each says why.
  it('logs why, naming a network failure by its system code', async () => {
    await seed(YESTERDAY, 44.7626);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    await createOfficialRate(nbu(() => Promise.reject(refused)).fetchFn, () => NOON).served(
      db,
      TODAY,
    );
    const status = nbu(() => Promise.resolve(new Response('', { status: 503 })));
    await createOfficialRate(status.fetchFn, () => NOON).served(db, TODAY);
    expect(log.mock.calls.map(([line]) => line)).toEqual([
      JSON.stringify({ officialRate: 'unfetched', date: TODAY, reason: 'ECONNREFUSED' }),
      JSON.stringify({ officialRate: 'unfetched', date: TODAY, reason: 'status 503' }),
    ]);
  });

  it('cancels the body of an answer it will not read', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel: () => void (cancelled = true) });
    const { fetchFn } = nbu(() => Promise.resolve(new Response(body, { status: 502 })));
    await createOfficialRate(fetchFn, () => NOON).served(db, TODAY);
    expect(cancelled).toBe(true);
  });

  it('serves nothing when nothing earlier is stored either', async () => {
    const { fetchFn } = nbu(() => Promise.resolve(new Response('[]')));
    expect(await createOfficialRate(fetchFn, () => NOON).served(db, TODAY)).toBeUndefined();
  });
});

describe('a failed fetch', () => {
  it('is not retried within five minutes by the same reader', async () => {
    await seed(YESTERDAY, 44.7626);
    let clock = NOON;
    const { fetchFn, asked } = nbu(() => Promise.resolve(new Response('', { status: 503 })));
    const rates = createOfficialRate(fetchFn, () => clock);

    await rates.served(db, TODAY);
    expect(asked).toHaveLength(1);
    clock += RATE_SPACING_MS - 1;
    expect(await rates.served(db, TODAY)).toEqual({ rate: 44.7626, date: YESTERDAY });
    expect(asked).toHaveLength(1);
    clock += 1;
    await rates.served(db, TODAY);
    expect(asked).toHaveLength(2);
  });

  it('holds back only the reader that saw it fail', async () => {
    await seed(YESTERDAY, 44.7626);
    const { fetchFn, asked } = nbu(() => Promise.resolve(new Response('', { status: 503 })));
    await createOfficialRate(fetchFn, () => NOON).served(db, TODAY);
    await createOfficialRate(fetchFn, () => NOON).served(db, TODAY);
    expect(asked).toHaveLength(2);
  });

  it('is spaced per date, so the next day is asked at once', async () => {
    await seed(YESTERDAY, 44.7626);
    const { fetchFn, asked } = nbu(() => Promise.resolve(new Response('[]')));
    const rates = createOfficialRate(fetchFn, () => NOON);
    await rates.ensure(db, TODAY);
    await rates.ensure(db, '2026-09-30');
    expect(asked).toEqual([nbuRateUrl(TODAY), nbuRateUrl('2026-09-30')]);
  });
});
