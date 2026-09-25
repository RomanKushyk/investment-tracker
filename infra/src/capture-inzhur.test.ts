// The Inzhur half of `handler`, on PGlite with the cluster connection replaced: what a capture
// records and what `observe` derives from it, across the feed era and the offer page's, and
// where `importFundHistory` finds each fund's price file.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { fundHistoryParts, zipOf } from './__fixtures__/xlsx';
import { handler } from './capture';
import { connect } from './dsql';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const FEED = readFileSync(
  new URL('../../packages/core/src/inzhur/__fixtures__/assets-2026-09-24.json', import.meta.url),
  'utf8',
);
const PAGE = readFileSync(
  new URL(
    '../../packages/core/src/inzhur/__fixtures__/offer-ovdp-2026-09-24.html',
    import.meta.url,
  ),
  'utf8',
);

/** The page without one element, counted first so a pattern that matched nothing cannot pass. */
function without(pattern: RegExp): string {
  expect(PAGE.match(new RegExp(pattern.source, 'g'))).toHaveLength(1);
  return PAGE.replace(pattern, '');
}

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

/** The schema, from `ensureSchema` itself: an observe over an empty archive derives nothing. */
const schema = () =>
  handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });

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

describe('observe reads each stored payload by the parser that wrote it', () => {
  it('derives the feed era and the offer page to the same observations and terms', async () => {
    await schema();
    await store('inzhur', '2026-09-24', FEED, '1');
    await store('inzhur', '2026-09-25', PAGE, '2');

    const result = await handler({
      observe: { source: 'inzhur', from: '2026-09-24', to: '2026-09-25' },
    });
    expect(result).toMatchObject({ dates: 2, skipped: 5, termsRefused: 0 });

    const observed = async (asOf: string) =>
      (
        await db.query<{ row: string }>(
          `SELECT concat_ws(' ', instrument_ref, basis, price::text, return_rate_buy::text,
                            return_rate_sell::text, status) AS row
             FROM price_observation WHERE as_of = $1 ORDER BY 1`,
          [asOf],
        )
      ).rows.map((r) => r.row);
    const feedDay = await observed('2026-09-24');
    const pageDay = await observed('2026-09-25');
    expect(feedDay.length).toBeGreaterThan(0);
    // The page's superset is the five bonds that matured before the feed dropped them.
    const matured = /^(UA4000228449|UA4000228910|UA4000230635|UA4000231187|UA40002312K7) /;
    expect(pageDay.filter((r) => !matured.test(r))).toEqual(feedDay);

    const terms = async (asOf: string) =>
      (
        await db.query<{ ref: string; terms_sha256: string }>(
          `SELECT ref, terms_sha256 FROM bond_terms WHERE as_of = $1 ORDER BY ref`,
          [asOf],
        )
      ).rows;
    const feedTerms = await terms('2026-09-24');
    expect(feedTerms).toHaveLength(34);
    const pageTerms = new Map((await terms('2026-09-25')).map((t) => [t.ref, t.terms_sha256]));
    for (const t of feedTerms) expect(pageTerms.get(t.ref), t.ref).toBe(t.terms_sha256);
  });

  it('refuses a payload whose parser version it does not know', async () => {
    await schema();
    await store('inzhur', '2026-09-25', PAGE, '9');
    await expect(
      handler({ observe: { source: 'inzhur', from: '2026-09-25', to: '2026-09-25' } }),
    ).rejects.toThrow('unknown inzhur parser_version: 9');
  });
});

describe('a capture of a page missing what it reads is a recorded failure', () => {
  const AS_OF = '2026-09-25';

  async function captureOf(body: string) {
    await schema();
    // NBU settled for the day, so the run asks only the provider under test.
    await store('nbu_fv', AS_OF, '', '1');
    vi.stubEnv('FEED_URL', await provider(body));
    const raised = await handler({ asOf: AS_OF }).catch((err: unknown) => err);
    const { rows } = await db.query<{
      ok: boolean;
      error: string | null;
      payload_bytes: number;
      parser_version: string;
    }>(
      `SELECT ok, error, payload_bytes, parser_version
         FROM price_capture WHERE source = 'inzhur' AND as_of = $1`,
      [AS_OF],
    );
    return { raised, rows };
  }

  it('names the bonds when the page carries no schedules, and keeps the page', async () => {
    const body = without(/<astro-island\b[\s\S]*?<\/astro-island>/);
    const { raised, rows } = await captureOf(body);
    expect(raised).toBeInstanceOf(Error);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ok: false,
      payload_bytes: Buffer.byteLength(body, 'utf8'),
      parser_version: '2',
    });
    expect(rows[0].error).toMatch(/^schedule absent: /);
    expect(rows[0].error).toContain('UA4000238976');
    expect(rows[0].error?.split(',')).toHaveLength(39);
  });

  // The prices are intact, and a day nothing derives is a day no later run can fill.
  it('still derives that day’s prices, and writes no terms for it', async () => {
    await captureOf(without(/<astro-island\b[\s\S]*?<\/astro-island>/));
    const count = async (sql: string) =>
      Number((await db.query<{ n: string }>(sql, [AS_OF])).rows[0].n);
    expect(
      await count(
        `SELECT count(*)::text AS n FROM price_observation WHERE source = 'inzhur' AND as_of = $1`,
      ),
    ).toBeGreaterThan(0);
    expect(await count(`SELECT count(*)::text AS n FROM bond_terms WHERE as_of = $1`)).toBe(0);
  });

  it('fails a page without the catalogue rather than record an empty success', async () => {
    const body = without(/<script class="it-astro-state"[\s\S]*?<\/script>/);
    const { raised, rows } = await captureOf(body);
    expect(raised).toBeInstanceOf(Error);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ok: false,
      error: 'feed parsed to zero entries',
      payload_bytes: Buffer.byteLength(body, 'utf8'),
    });
  });
});

describe('importFundHistory reads each fund’s price file from its CMS document list', () => {
  const LIST = readFileSync(
    new URL('./__fixtures__/cms-category-19-2026-09-25.json', import.meta.url),
    'utf8',
  );
  const CZINA =
    'https://d2zk2gr3fhkmim.cloudfront.net/Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx';
  const API_ROBOTS = 'https://api.inzhur.reit/robots.txt';
  const CDN_ROBOTS = 'https://d2zk2gr3fhkmim.cloudfront.net/robots.txt';
  const LIST_19 = expect.stringMatching(
    /^https:\/\/api\.inzhur\.reit\/cms\/api\/general-document-categories\?filters\[id\]=19&/,
  );

  /** The provider's hosts with the network replaced: robots.txt a 404 on both, which RFC 9309
   *  reads as no rule, and category 19 answering `list`. Every URL asked is recorded, so "never
   *  fetched" is a count, not an inference. */
  function inzhur(list: string): string[] {
    const asked: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      asked.push(url);
      const at = new URL(url);
      if (
        `${at.origin}${at.pathname}` ===
          'https://api.inzhur.reit/cms/api/general-document-categories' &&
        at.searchParams.get('filters[id]') === '19'
      ) {
        return new Response(list, { headers: { 'content-type': 'application/json' } });
      }
      if (url === CZINA) return new Response(Buffer.from(zipOf(fundHistoryParts())));
      return new Response(null, { status: 404 });
    });
    return asked;
  }

  it('imports the price file the category lists, and asks for nothing else', async () => {
    const asked = inzhur(LIST);

    const result = await handler({ importFundHistory: { refs: ['inzhur-reit'] } });

    expect(result).toMatchObject({
      mode: 'importFundHistory',
      funds: [
        {
          ref: 'inzhur-reit',
          file: CZINA,
          rows: 9,
          written: 9,
          from: '2025-12-26',
          to: '2026-01-03',
        },
      ],
    });
    expect(asked).toEqual([API_ROBOTS, LIST_19, CDN_ROBOTS, CZINA]);
  });

  it('stops at an answer of another shape, naming the category, and fetches nothing after it', async () => {
    const asked = inzhur('{"data":[{"id":19,"title":"Inzhur REIT","documents":[]}]}');

    await expect(handler({ importFundHistory: {} })).rejects.toThrow(/category 19/);
    expect(asked).toEqual([API_ROBOTS, LIST_19]);
  });
});
