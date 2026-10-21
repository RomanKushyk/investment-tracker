// The scheduled run's own signal, which `SilenceAlarm` and `ErrorAlarm` read in place of the
// function's `Invocations` and `Errors`: every manual mode invokes the same function. [*Alerting*]
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { handler, inzhurAsOf, nbuAsOf, SOURCE, type HandlerEvent } from './capture';
import { connect } from './dsql';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const SCHEDULED: HandlerEvent = { scheduled: true };
const RAN = { metric: 'scheduledRun', value: 1 };
const FAILED = { metric: 'scheduledRunFailed', value: 1 };

let db: PGlite;

/** The cluster on PGlite, with `refuse` making each matching statement throw. */
const cluster = (refuse?: RegExp) =>
  vi.mocked(connect).mockResolvedValue({
    query: async (text: string, values?: unknown[]) => {
      if (refuse?.test(text)) throw new Error('injected failure');
      return db.query(text.replace(/\bINDEX\s+ASYNC\b/i, 'INDEX'), values);
    },
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);

beforeEach(async () => {
  db = await freshDb();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-24T04:00:00Z'));
  cluster();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The two signal lines among everything the run logged, parsed. */
const signals = () =>
  vi.mocked(console.log).mock.calls.flatMap(([line]) => {
    try {
      const parsed = JSON.parse(String(line)) as { metric?: unknown };
      return parsed.metric === RAN.metric || parsed.metric === FAILED.metric ? [parsed] : [];
    } catch {
      return [];
    }
  });

/** Both sources settled for the run's dates, so a firing fetches nothing and returns. */
async function settleToday() {
  await handler({ observe: { from: '2026-09-01', to: '2026-09-01' } });
  const now = new Date();
  for (const [source, asOf] of [
    [SOURCE.inzhur, inzhurAsOf(now)],
    [SOURCE.nbuFairValue, nbuAsOf(now)],
  ]) {
    await db.query(
      `INSERT INTO price_capture (id, requested_at, as_of, source, ok, http_status, payload_gzip,
                                  payload_bytes, payload_sha256, parser_version)
       VALUES ($1, now(), $2, $3, true, 200, $4, 2, '', 'test')`,
      [randomUUID(), asOf, source, gzipSync(Buffer.from('{}'))],
    );
  }
  vi.mocked(console.log).mockClear();
}

describe('a scheduled firing writes that it ran, and that it failed when it did', () => {
  it('writes the ran line alone when the firing succeeds', async () => {
    await settleToday();
    await expect(handler(SCHEDULED)).resolves.toMatchObject({ skipped: 'already settled' });
    expect(signals()).toEqual([RAN]);
  });

  it('writes both when the capture throws, and still throws', async () => {
    await settleToday();
    cluster(/SELECT 1 FROM price_capture/);
    await expect(handler(SCHEDULED)).rejects.toThrow('injected failure');
    expect(signals()).toEqual([RAN, FAILED]);
  });

  // Before any mode is known: the connection and the schema are the firing's too.
  it('writes both when the connection is refused', async () => {
    vi.mocked(connect).mockRejectedValue(new Error('connection refused'));
    await expect(handler(SCHEDULED)).rejects.toThrow('connection refused');
    expect(signals()).toEqual([RAN, FAILED]);
  });

  it('writes both when the schema cannot be ensured', async () => {
    cluster(/./);
    await expect(handler(SCHEDULED)).rejects.toThrow('injected failure');
    expect(signals()).toEqual([RAN, FAILED]);
  });
});

// A hand `{}` or `{asOf}` runs the capture too, and is still not the schedule firing.
const MANUAL: [string, HandlerEvent][] = [
  ['diagnose', { diagnose: true }],
  ['observe NBU', { observe: {} }],
  ['observe Inzhur', { observe: { source: SOURCE.inzhur } }],
  ['backfill', { backfill: {} }],
  ['importFundHistory', { importFundHistory: {} }],
  ['importDerivedSell', { importDerivedSell: { workbook: '' } }],
  ['importWaybackQuotes', { importWaybackQuotes: {} }],
  ['importChartHistory', { importChartHistory: {} }],
  ['a hand capture', {}],
  ['a hand re-capture', { asOf: '2026-09-23' }],
];

describe('no manual mode writes either line', () => {
  // The same refusal makes the scheduled event write both, so the mode alone is what differs.
  it.each(MANUAL)('%s, thrown before its mode runs', async (_, event) => {
    vi.mocked(connect).mockRejectedValue(new Error('connection refused'));
    await expect(handler(event)).rejects.toThrow('connection refused');
    expect(signals()).toEqual([]);
  });

  it('a mode that resolves', async () => {
    await expect(
      handler({ observe: { from: '2026-09-01', to: '2026-09-01' } }),
    ).resolves.toBeDefined();
    expect(signals()).toEqual([]);
  });

  it('a mode that throws once it runs', async () => {
    await expect(handler({ importFundHistory: { refs: [] } })).rejects.toThrow('no refs');
    expect(signals()).toEqual([]);
  });
});
