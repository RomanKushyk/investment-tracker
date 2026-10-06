// The scheduled half: what the job asks NBU for, and what it publishes. `dates.test.ts` holds
// the rule for which dates are due; `official-rate.test.ts` how one is fetched and stored.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nbuRateUrl } from '@quirenote/core/nbu/rate';
import { freshDb } from './__fixtures__/pglite';
import { connect } from './dsql';
import { MIGRATIONS, statementsOf as statements } from './migrate';
import { createOfficialRate } from './official-rate';
import { handler, rateAhead } from './rate-ahead';

// THE HANDLER'S FETCH IS THE GLOBAL ONE, taken when its rate reader is built. Installed before any
// import runs, so a reader built at import, the regression the handler test pins, takes the
// stand-in too rather than the network. It always fails: what is counted is whether it is asked.
const globalNbu = vi.hoisted(() => {
  const asked: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((...[input]: Parameters<typeof fetch>) => {
    asked.push(String(input));
    return Promise.resolve(new Response('', { status: 503 }));
  }) as typeof fetch;
  return { asked, original };
});

afterAll(() => {
  globalThis.fetch = globalNbu.original;
});

vi.mock('./dsql', async (actual) => ({
  ...(await actual<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const DML = ['005_demo_user.sql', '008_demo_account.sql'];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

// 29 September 2026 is UTC+3 in Kyiv: 16:00 there is the schedule's first firing, 15:29 is before
// NBU has to have set tomorrow's rate.
const FIRING = new Date('2026-09-29T13:00:00Z');
const BEFORE = new Date('2026-09-29T12:29:00Z');
const TODAY = '2026-09-29';
const TOMORROW = '2026-09-30';
const YESTERDAY = '2026-09-28';

let db: PGlite;
let log: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt);
  }
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** NBU answering every date it is asked, from the `date=` it was asked with. */
const nbu = (answer: (iso: string) => Response) => {
  const asked: string[] = [];
  const fetchFn = ((...[input]: Parameters<typeof fetch>) => {
    const url = String(input);
    asked.push(url);
    const [, y, m, d] = /date=(\d{4})(\d{2})(\d{2})/.exec(url) ?? [];
    return Promise.resolve(answer(`${y}-${m}-${d}`));
  }) as typeof fetch;
  return { fetchFn, asked };
};

const published = (iso: string) =>
  new Response(
    `[{"r030":840,"txt":"Долар США","rate":44.8153,"cc":"USD","exchangedate":"${iso.split('-').reverse().join('.')}","special":"N"}]`,
  );

const seed = (iso: string) =>
  db.query(`INSERT INTO official_rate (rate_date, currency, rate) VALUES ($1, 'USD', 44.7626)`, [
    iso,
  ]);

const days = async () =>
  (
    await db.query<{ day: string }>(
      `SELECT to_char(rate_date, 'YYYY-MM-DD') AS day FROM official_rate ORDER BY rate_date`,
    )
  ).rows.map((r) => r.day);

const run = (fetchFn: typeof fetch, now: Date) =>
  rateAhead(
    db,
    createOfficialRate(fetchFn, () => now.getTime()),
    now,
  );

describe('rateAhead', () => {
  it('stores the next day’s rate at a firing after 15:30', async () => {
    await seed(TODAY);
    const { fetchFn, asked } = nbu(published);
    expect(await run(fetchFn, FIRING)).toEqual({ metric: 'rateAgeDays', value: 0 });
    expect(asked).toEqual([nbuRateUrl(TOMORROW)]);
    expect(await days()).toEqual([TODAY, TOMORROW]);
  });

  it('stores today’s too when it is missing', async () => {
    await seed(YESTERDAY);
    const { fetchFn, asked } = nbu(published);
    expect(await run(fetchFn, FIRING)).toEqual({ metric: 'rateAgeDays', value: 0 });
    expect(asked).toEqual([nbuRateUrl(TODAY), nbuRateUrl(TOMORROW)]);
    expect(await days()).toEqual([YESTERDAY, TODAY, TOMORROW]);
  });

  it('asks for today alone before 15:30', async () => {
    await seed(YESTERDAY);
    const { fetchFn, asked } = nbu(published);
    await run(fetchFn, BEFORE);
    expect(asked).toEqual([nbuRateUrl(TODAY)]);
  });

  it('asks nothing for a day already stored', async () => {
    await seed(TODAY);
    await seed(TOMORROW);
    const { fetchFn, asked } = nbu(published);
    await run(fetchFn, FIRING);
    expect(asked).toEqual([]);
  });

  // The log line IS the metric: `RateAgeMetricFilter` reads `$.value` off it.
  it('publishes the age of the rate a request would be served', async () => {
    await seed('2026-09-27');
    const { fetchFn } = nbu(() => new Response('[]'));
    expect(await run(fetchFn, FIRING)).toEqual({ metric: 'rateAgeDays', value: 2 });
    expect(log).toHaveBeenCalledWith(JSON.stringify({ metric: 'rateAgeDays', value: 2 }));
  });

  // A FAILED FETCH IS NOT AN ERROR HERE: the next firing asks again, and the age above is what
  // says it never answered. Thrown, one slow afternoon would trip `RateAheadErrorAlarm`.
  it('does not throw when NBU fails', async () => {
    await seed(YESTERDAY);
    const { fetchFn } = nbu(() => new Response('', { status: 503 }));
    await expect(run(fetchFn, FIRING)).resolves.toEqual({ metric: 'rateAgeDays', value: 1 });
    expect(await days()).toEqual([YESTERDAY]);
  });

  // AN ABSENT AGE IS AN ERROR, NOT A ZERO: zero is the healthy side of `RateAgeAlarm`.
  it('throws, publishing nothing, when no rate is stored at all', async () => {
    const { fetchFn } = nbu(() => new Response('[]'));
    await expect(run(fetchFn, FIRING)).rejects.toThrow(/no official rate/);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('rateAgeDays'));
  });
});

describe('the handler', () => {
  // Lambda retries a failed asynchronous invocation within minutes, and the retry can land in the
  // environment that just failed it. A spacing kept across invocations would turn it into a skip.
  // The clock is fixed, so two calls cannot straddle 15:30 or midnight and ask for different days.
  it('asks NBU again when a failed firing is retried minutes later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIRING);
    vi.mocked(connect).mockImplementation(
      async () => ({ query: db.query.bind(db), end: async () => {} }) as never,
    );
    await expect(handler()).rejects.toThrow(/no official rate/);
    const first = globalNbu.asked.length;
    expect(first).toBeGreaterThan(0);
    await expect(handler()).rejects.toThrow(/no official rate/);
    expect(globalNbu.asked).toHaveLength(2 * first);
  });
});
