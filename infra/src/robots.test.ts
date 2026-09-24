import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { alreadySettled, fetchFeed } from './capture';
import { forgetRobots, RobotsRefusal, robotsFetch } from './robots';

type Route = (req: IncomingMessage, res: ServerResponse) => void;

const text =
  (body: string): Route =>
  (_req, res) =>
    res.writeHead(200, { 'content-type': 'text/plain' }).end(body);
const redirect =
  (to: string, status = 302): Route =>
  (_req, res) =>
    res.writeHead(status, { location: to }).end();
const status =
  (code: number): Route =>
  (_req, res) =>
    res.writeHead(code).end();
/** A connection reset before any answer: the network error of RFC 9309 §2.3.1.4. */
const drop: Route = (req) => req.socket.destroy();

const servers: Server[] = [];

/** One host per test, on its own port, so no two tests share an origin and its rules. Every
 *  request is counted by path: "never requested" is a count of zero, not an inference. */
async function host(routes: Record<string, Route>) {
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const path = req.url ?? '';
    hits.push(path);
    (routes[path] ?? status(404))(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url: (path: string) => origin + path,
    count: (path: string) => hits.filter((h) => h === path).length,
  };
}

const signal = () => AbortSignal.timeout(5_000);
const failure = (url: string) => robotsFetch(url, signal()).catch((err: unknown) => err);

beforeEach(() => forgetRobots());

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('a redirect is followed only where the target host’s robots.txt allows it', () => {
  it('refuses a redirect into a disallowed path, never requests it, and names it', async () => {
    const h = await host({
      '/robots.txt': text('User-agent: *\nAllow: /\nDisallow: /dashboard/\n'),
      '/_api/assets': redirect('/dashboard/_api/assets'),
      '/dashboard/_api/assets': text('{}'),
    });

    const err = await failure(h.url('/_api/assets'));

    expect(err).toBeInstanceOf(RobotsRefusal);
    expect((err as RobotsRefusal).message).toContain(h.url('/dashboard/_api/assets'));
    expect((err as RobotsRefusal).httpStatus).toBe(302);
    expect(h.count('/_api/assets')).toBe(1);
    expect(h.count('/dashboard/_api/assets')).toBe(0);
  });

  it('follows a redirect into an allowed path', async () => {
    const h = await host({
      '/robots.txt': text('User-agent: *\nDisallow: /dashboard/\n'),
      '/a': redirect('/b'),
      '/b': text('landed'),
    });

    const response = await robotsFetch(h.url('/a'), signal());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('landed');
    expect([h.count('/a'), h.count('/b')]).toEqual([1, 1]);
  });

  it('follows twenty redirects and fails on the twenty-first, the Fetch standard’s limit', async () => {
    const chain = (name: string, redirects: number): Record<string, Route> =>
      Object.fromEntries(
        Array.from({ length: redirects + 1 }, (_, i) => [
          `/${name}/${i}`,
          i < redirects ? redirect(`/${name}/${i + 1}`) : text('end'),
        ]),
      );
    const h = await host({ ...chain('twenty', 20), ...chain('twentyone', 21) });

    const twenty = await robotsFetch(h.url('/twenty/0'), signal());
    expect(await twenty.text()).toBe('end');

    const err = await failure(h.url('/twentyone/0'));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RobotsRefusal);
    expect(h.count('/twentyone/20')).toBe(1);
    expect(h.count('/twentyone/21')).toBe(0);
  });

  it('never sends a first request its host disallows', async () => {
    const h = await host({
      '/robots.txt': text('User-agent: *\nDisallow: /private\n'),
      '/private/feed': text('secret'),
    });

    const err = await failure(h.url('/private/feed'));

    expect(err).toBeInstanceOf(RobotsRefusal);
    expect((err as RobotsRefusal).message).toContain(h.url('/private/feed'));
    expect((err as RobotsRefusal).httpStatus).toBeUndefined();
    expect(h.count('/private/feed')).toBe(0);
  });
});

/** Whether a path on a host serving `robots` is fetched, counted at the host rather than read
 *  off the error, so a refusal that still sent the request cannot pass. */
async function verdicts(robots: Route, paths: string[]): Promise<Record<string, boolean>> {
  const h = await host({
    '/robots.txt': robots,
    ...Object.fromEntries(paths.map((p) => [p, text('ok')])),
  });
  const out: Record<string, boolean> = {};
  for (const path of paths) {
    const got = await robotsFetch(h.url(path), signal()).catch(() => null);
    out[path] = got !== null && h.count(path) === 1;
  }
  return out;
}

describe('robots.txt is read per RFC 9309', () => {
  it('allows everything when robots.txt is a 4xx (§2.3.1.3)', async () => {
    expect(await verdicts(status(404), ['/', '/dashboard/x'])).toEqual({
      '/': true,
      '/dashboard/x': true,
    });
  });

  it('disallows everything when robots.txt is a 5xx (§2.3.1.4)', async () => {
    const h = await host({ '/robots.txt': status(503), '/open': text('ok') });

    const err = await failure(h.url('/open'));

    expect(err).toBeInstanceOf(Error);
    // A failed attempt, not a refusal: the next attempt may read the file.
    expect(err).not.toBeInstanceOf(RobotsRefusal);
    expect(h.count('/open')).toBe(0);
  });

  // §2.3.1.3 makes a 4xx a MAY, and "slow down" read as "crawl anything" would answer a rate
  // limit by crawling more. Google reads a 429 as a server error for the same reason.
  it('disallows everything when robots.txt is a 429', async () => {
    const h = await host({ '/robots.txt': status(429), '/open': text('ok') });

    const err = await failure(h.url('/open'));

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RobotsRefusal);
    expect(h.count('/open')).toBe(0);
  });

  it('disallows everything when robots.txt cannot be reached (§2.3.1.4)', async () => {
    const h = await host({ '/robots.txt': drop, '/open': text('ok') });

    const err = await failure(h.url('/open'));

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RobotsRefusal);
    expect(h.count('/open')).toBe(0);
  });

  it('obeys the group naming the product token over `*`, matched case-insensitively (§2.2.1)', async () => {
    const robots = text(
      'User-agent: *\nDisallow: /\n\nUser-agent: Quirenote-Price-Capture\nDisallow: /private\n',
    );
    expect(await verdicts(robots, ['/open', '/private'])).toEqual({
      '/open': true,
      '/private': false,
    });
  });

  it('takes the longest matching rule (§2.2.2)', async () => {
    const robots = text('User-agent: *\nAllow: /\nDisallow: /dashboard/\nAllow: /dashboard/pub\n');
    expect(await verdicts(robots, ['/offer', '/dashboard/x', '/dashboard/pub/x'])).toEqual({
      '/offer': true,
      '/dashboard/x': false,
      '/dashboard/pub/x': true,
    });
  });

  it('matches `*` as any run of characters and `$` as the end (§2.2.3)', async () => {
    const robots = text('User-agent: *\nDisallow: /*utm_\nDisallow: /*.xlsx$\n');
    expect(
      await verdicts(robots, ['/offer?utm_source=x', '/offer', '/f.xlsx', '/f.xlsx?v=1']),
    ).toEqual({
      '/offer?utm_source=x': false,
      '/offer': true,
      '/f.xlsx': false,
      '/f.xlsx?v=1': true,
    });
  });

  it('lets `allow` win a tie with `disallow` (§2.2.2)', async () => {
    const robots = text('User-agent: *\nDisallow: /same\nAllow: /same\n');
    expect(await verdicts(robots, ['/same'])).toEqual({ '/same': true });
  });
});

describe('a definitive robots.txt is read at most once per host per invocation', () => {
  it('reads it once for two fetches, and again after the invocation is forgotten', async () => {
    const h = await host({ '/robots.txt': text('User-agent: *\nAllow: /\n'), '/a': text('a') });

    await robotsFetch(h.url('/a'), signal());
    await robotsFetch(h.url('/a'), signal());
    expect(h.count('/robots.txt')).toBe(1);

    forgetRobots();
    await robotsFetch(h.url('/a'), signal());
    expect(h.count('/robots.txt')).toBe(2);
  });

  it('does not remember an unreachable robots.txt, so a retry reads it again', async () => {
    let reads = 0;
    const h = await host({
      '/robots.txt': (req, res) => (++reads === 1 ? status(503) : text(''))(req, res),
      '/a': text('a'),
    });

    expect(await failure(h.url('/a'))).toBeInstanceOf(Error);
    const retried = await robotsFetch(h.url('/a'), signal());

    expect(retried.status).toBe(200);
    expect([h.count('/robots.txt'), h.count('/a')]).toEqual([2, 1]);
  });
});

/** `capture.ts` is read through this, so a `fetch(` in a comment neither trips the guard nor
 *  stands in for the import it looks for. LINE BY LINE, and the line boundary is the point: a
 *  regex literal may hold a quote, and one desync would switch stripping off for the rest of the
 *  file.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a `fetch(` in a comment leaves this green; a bare `fetch(` in
 *  `fetchBytes`, a `globalThis.fetch(` in `fetchNbu`, or the import left only in a comment turns
 *  it red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

const capture = stripTs(readFileSync(new URL('./capture.ts', import.meta.url), 'utf8'));

// The journal's table from `ensureSchema`'s own literal, so the settled test runs on what
// production writes.
const PRICE_CAPTURE =
  capture.match(/`\s*(CREATE TABLE IF NOT EXISTS price_capture \([^`]*)`/)?.[1] ?? 'unread';

describe('capture.ts fetches nothing except through robotsFetch', () => {
  it('takes its fetch from robots.ts', () => {
    expect(capture).toMatch(/import \{[^}]*\brobotsFetch\b[^}]*\} from '\.\/robots';/);
  });

  // `globalThis.fetch(` is a bypass too, so only a name continuing an identifier is excluded.
  it('calls no `fetch` of its own', () => {
    const bypasses = [...capture.matchAll(/(?<![\w$])fetch\s*\(/g)].map(
      (m) => `capture.ts:${capture.slice(0, m.index).split('\n').length}`,
    );
    expect(bypasses).toEqual([]);
  });
});

describe('the capture records a refusal and does not retry it', () => {
  const refused = () =>
    host({
      '/robots.txt': text('User-agent: *\nDisallow: /dashboard/\n'),
      '/_api/assets': redirect('/dashboard/_api/assets'),
    });

  it('journals the redirect’s status and the refused URL after one request', async () => {
    const h = await refused();

    // A retry would sleep thirty seconds first, so a retried refusal times this test out too.
    const outcome = await fetchFeed(h.url('/_api/assets'));

    expect(outcome).toMatchObject({ ok: false, httpStatus: 302 });
    expect(outcome.error).toContain(h.url('/dashboard/_api/assets'));
    expect(h.count('/_api/assets')).toBe(1);
  });

  // The error `fetchFeed` returns is the one journalled, so the message and the settled query
  // are held together here rather than by two literals that could drift.
  it('settles the day, so no later firing asks the provider again', async () => {
    const h = await refused();
    const outcome = await fetchFeed(h.url('/_api/assets'));
    // The nearest message that must stay open: it too starts `robots.txt `.
    const down = await host({ '/robots.txt': status(503) });
    const unreachable = (await failure(down.url('/_api/assets'))) as Error;
    const db = await freshDb();
    await db.exec(PRICE_CAPTURE);
    const journal = (asOf: string, error: string | undefined) =>
      db.query(
        `INSERT INTO price_capture (id, requested_at, as_of, source, ok, error,
                                    payload_gzip, payload_bytes, payload_sha256, parser_version)
         VALUES ($1, now(), $2, 'inzhur', false, $3, ''::bytea, 0, '', '1')`,
        [randomUUID(), asOf, error],
      );

    await journal('2026-09-25', outcome.error);
    await journal('2026-09-26', unreachable.message);

    expect(await alreadySettled(db, 'inzhur', '2026-09-25')).toBe(true);
    // A failure a later firing can fix leaves its day open.
    expect(await alreadySettled(db, 'inzhur', '2026-09-26')).toBe(false);
  });
});
