import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ANSWER_MS, type RelayAnswer, type RelayCall } from '../auth/relay';
import { createSession, type Locks } from '../auth/session';
import { REPO } from '../repo-root';
import { DATA_ROOTS, createTransport } from './transport';

// The suite runs the transport against MSW, in node, and a request no handler names is halted: the
// unhandled-request test below proves the option is live, since a renamed one is ignored silently.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(() => server.close());

const HOST = 'dev.quirenote.com';
const API = 'https://api.dev.quirenote.com';
const BUILD = 'derivation-of-this-build';
const ADDRESS = 'name@example.com';

/** An ID token whose payload carries `claims`, base64url and unpadded as a JWT's is. */
const jwt = (claims: object) => {
  const bytes = new TextEncoder().encode(JSON.stringify(claims));
  const payload = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `h.${payload}.s`;
};
const ID_TOKEN = jwt({ sub: 'u1', email: ADDRESS });
const TOKENS: RelayAnswer = { kind: 'tokens', tokens: { idToken: ID_TOKEN, expiresIn: 3600 } };
const noLocks = { request: (_: string, callback: () => unknown) => callback() } as unknown as Locks;

/** A transport over a session the relay signed in, then answers with `later` in order, a promise
 *  being an answer the relay has not given yet. */
async function transport(hostname = HOST, ...later: (RelayAnswer | Promise<RelayAnswer>)[]) {
  const answers = [TOKENS, ...later];
  const relay = vi.fn<RelayCall>(
    async () => answers.shift() ?? { kind: 'refused', reason: 'failed' },
  );
  const session = createSession({ relay, locks: noLocks });
  await session.restore();
  const showAnswer = vi.fn();
  const call = createTransport({
    hostname,
    fetch: (input, init) => fetch(input, init),
    session,
    showAnswer,
    derivationId: BUILD,
  });
  return { call, session, showAnswer };
}

const view = { method: 'GET', path: '/view' } as const;
const write = {
  method: 'POST',
  path: '/mutations',
  body: '{"ops":[{"op":"asset.delete","id":"a"}]}',
  headers: { 'if-match': '"3"' },
  keyed: true,
} as const;
const answering = (status: number, body?: unknown, headers?: Record<string, string>) =>
  HttpResponse.json(body ?? null, { status, headers });

describe('a request', () => {
  it('sends the ID token as a bearer, and no cookie, and reads the body and the tags', async () => {
    const seen: Request[] = [];
    server.use(
      http.get(`${API}/view`, ({ request }) => {
        seen.push(request.clone());
        return answering(
          200,
          { view: {}, etag: '"7"' },
          { etag: 'W/"abc"', 'derivation-id': BUILD },
        );
      }),
    );
    const { call } = await transport();

    expect(await call(view)).toEqual({
      kind: 'ok',
      status: 200,
      body: { view: {}, etag: '"7"' },
      etag: 'W/"abc"',
      derivationId: BUILD,
      stale: false,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.get('authorization')).toBe(`Bearer ${ID_TOKEN}`);
    expect(seen[0].credentials).toBe('omit');
    expect(seen[0].headers.get('cookie')).toBeNull();
    expect(seen[0].headers.get('idempotency-key')).toBeNull();
    expect(seen[0].headers.get('content-type')).toBeNull();
  });

  it.each([
    ['dev.quirenote.com', 'https://api.dev.quirenote.com'],
    ['quirenote.com', 'https://api.quirenote.com'],
    ['www.quirenote.com', 'https://api.quirenote.com'],
  ])('goes to the API of the host %s', async (hostname, base) => {
    server.use(http.get(`${base}/view`, () => answering(200, {})));
    const { call } = await transport(hostname);
    expect(await call(view)).toMatchObject({ kind: 'ok' });
  });

  it('goes through the dev server on localhost, where the proxy makes the API same-origin', async () => {
    const seen: string[] = [];
    server.use(
      http.get('http://localhost:3300/relay/view/series', ({ request }) => {
        seen.push(request.url);
        return answering(200, {});
      }),
    );
    const { session, showAnswer } = await transport('localhost');
    const call = createTransport({
      hostname: 'localhost',
      fetch: (input, init) => fetch(new URL(String(input), 'http://localhost:3300'), init),
      session,
      showAnswer,
      derivationId: BUILD,
    });
    expect(await call({ method: 'GET', path: '/view/series?period=3m' })).toMatchObject({
      kind: 'ok',
    });
    expect(seen).toEqual(['http://localhost:3300/relay/view/series?period=3m']);
  });

  it('sends nothing from a host no environment is listed for', async () => {
    const { call } = await transport('preview.example.com');
    expect(await call(view)).toEqual({ kind: 'failed' });
  });

  it('sends nothing while no ID token can be had, and waits for none once signed out', async () => {
    // Under fake timers a wait for a retry never ends, so the call would hang.
    vi.useFakeTimers();
    const { call, session } = await transport(HOST, { kind: 'signedOut' });
    await session.signOut();
    expect(await call(view)).toEqual({ kind: 'unauthorized' });
  });

  it('sends a body as the text it was given, under its content type and the caller headers', async () => {
    const seen: { text: string; type: string | null; match: string | null }[] = [];
    server.use(
      http.put(`${API}/imports/i1/parts/2`, async ({ request }) => {
        seen.push({
          text: await request.text(),
          type: request.headers.get('content-type'),
          match: request.headers.get('content-digest'),
        });
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { call } = await transport();
    const body = '{"rows": [ ]}';
    const reply = await call({
      method: 'PUT',
      path: '/imports/i1/parts/2',
      body,
      headers: { 'content-digest': 'sha-256=:AAAA:' },
    });
    expect(reply).toEqual({ kind: 'ok', status: 204, body: undefined, stale: false });
    expect(seen).toEqual([{ text: body, type: 'application/json', match: 'sha-256=:AAAA:' }]);
  });

  it.each(['content-type', 'Content-Type'])(
    'sends a body under the content type the caller names as %s, which a merge patch needs',
    async (name) => {
      const seen: { text: string; type: string | null }[] = [];
      server.use(
        http.patch(`${API}/settings`, async ({ request }) => {
          seen.push({ text: await request.text(), type: request.headers.get('content-type') });
          return answering(200, {});
        }),
      );
      const { call } = await transport();
      const body = '{"language":null}';
      const reply = await call({
        method: 'PATCH',
        path: '/settings',
        body,
        headers: { [name]: 'application/merge-patch+json' },
      });
      expect(reply).toMatchObject({ kind: 'ok', status: 200 });
      expect(seen).toEqual([{ text: body, type: 'application/merge-patch+json' }]);
    },
  );
});

describe('the derivation identifier', () => {
  it('is reported when it differs from the build, and the page is not reloaded', async () => {
    const location = { reload: vi.fn(), assign: vi.fn(), replace: vi.fn() };
    vi.stubGlobal('location', location);
    server.use(
      http.get(`${API}/view`, () => answering(200, {}, { 'derivation-id': 'another-derivation' })),
    );
    const { call } = await transport();

    expect(await call(view)).toMatchObject({
      kind: 'ok',
      derivationId: 'another-derivation',
      stale: true,
    });
    expect(location.reload).not.toHaveBeenCalled();
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
  });

  it('is not stale when the answer names none', async () => {
    server.use(http.get(`${API}/view`, () => answering(200, {})));
    const { call } = await transport();
    expect(await call(view)).toMatchObject({ kind: 'ok', derivationId: undefined, stale: false });
  });
});

describe('a refusal', () => {
  it.each([
    ['pending', 'pending'],
    ['rejected', 'rejected'],
    ['no_application', 'noApplication'],
    ['forbidden', 'forbidden'],
  ] as const)('reaches the caller as %s, and the screen', async (error, answer) => {
    server.use(http.get(`${API}/view`, () => answering(403, { error })));
    const { call, showAnswer } = await transport();

    expect(await call(view)).toEqual({ kind: 'answer', answer });
    expect(showAnswer).toHaveBeenCalledExactlyOnceWith({ answer, email: ADDRESS });
  });

  it('reaches a user from the settings route too, which every user may call', async () => {
    server.use(http.patch(`${API}/settings`, () => answering(403, { error: 'rejected' })));
    const { call, showAnswer } = await transport();

    expect(await call({ method: 'PATCH', path: '/settings', body: '{}' })).toEqual({
      kind: 'answer',
      answer: 'rejected',
    });
    expect(showAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'rejected', email: ADDRESS });
  });

  it.each([{ message: 'Forbidden' }, { error: 'blocked' }, 'Forbidden'])(
    'is no answer when a 403 carries %j, which is not the API reading the caller',
    async (body) => {
      server.use(http.get(`${API}/view`, () => answering(403, body)));
      const { call, showAnswer } = await transport();

      expect(await call(view)).toEqual({ kind: 'failed', status: 403, body });
      expect(showAnswer).not.toHaveBeenCalled();
    },
  );

  it('shows no answer for an admin route, which also says forbidden to a user who is not an admin', async () => {
    server.use(
      http.post(`${API}/admin/users/u2/approve`, () => answering(403, { error: 'forbidden' })),
    );
    const { call, showAnswer } = await transport();

    expect(await call({ method: 'POST', path: '/admin/users/u2/approve' })).toEqual({
      kind: 'answer',
      answer: 'forbidden',
    });
    expect(showAnswer).not.toHaveBeenCalled();
  });

  it('lists the routes every user may call by what the API documents, and no other', () => {
    const spec = JSON.parse(readFileSync(join(REPO, 'docs/reference/openapi.json'), 'utf8')) as {
      paths: Record<string, unknown>;
    };
    const roots = new Set(Object.keys(spec.paths).map((path) => path.split('/')[1]));
    // The relay, the application and the admin routes are not a user's data.
    expect([...roots].sort()).toEqual([...DATA_ROOTS, 'admin', 'auth', 'v1'].sort());
  });

  it('shows no answer to a request that began before a sign-out, even one still running', async () => {
    let reached!: () => void;
    const arrived = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    server.use(
      http.get(`${API}/view`, async () => {
        reached();
        await held;
        return answering(403, { error: 'pending' });
      }),
    );
    let signedOut!: (answer: RelayAnswer) => void;
    const { call, session, showAnswer } = await transport(
      HOST,
      new Promise<RelayAnswer>((resolve) => (signedOut = resolve)),
    );

    const asking = call(view);
    await arrived;
    const leaving = session.signOut();
    release();

    expect(await asking).toEqual({ kind: 'answer', answer: 'pending' });
    // The relay has not answered the sign-out, so the status has not changed: only the count of
    // sign-outs begun tells this request from one made after.
    expect(session.status()).toBe('signedIn');
    expect(showAnswer).not.toHaveBeenCalled();
    signedOut({ kind: 'signedOut' });
    await leaving;
  });

  it('shows no answer to a request that begins while a sign-out runs, and sends none', async () => {
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        return answering(403, { error: 'pending' });
      }),
    );
    let signedOut!: (answer: RelayAnswer) => void;
    const { call, session, showAnswer } = await transport(
      HOST,
      new Promise<RelayAnswer>((resolve) => (signedOut = resolve)),
    );

    const leaving = session.signOut();
    const reply = await call(view);

    // The relay has not answered, so the pair still held is the leaving account's.
    expect(session.status()).toBe('signedIn');
    expect(reply).toEqual({ kind: 'unauthorized' });
    expect(sent).toBe(0);
    expect(showAnswer).not.toHaveBeenCalled();
    signedOut({ kind: 'signedOut' });
    await leaving;
  });

  it('shows no answer to a request whose token waited on a refresh while a sign-out began', async () => {
    server.use(http.get(`${API}/view`, () => answering(403, { error: 'pending' })));
    let refreshed!: (answer: RelayAnswer) => void;
    let signedOut!: (answer: RelayAnswer) => void;
    const answers = [
      Promise.resolve(TOKENS),
      new Promise<RelayAnswer>((resolve) => (refreshed = resolve)),
      new Promise<RelayAnswer>((resolve) => (signedOut = resolve)),
    ];
    const relay = vi.fn<RelayCall>(
      () => answers.shift() ?? Promise.resolve({ kind: 'refused', reason: 'failed' }),
    );
    let clock = 0;
    const session = createSession({ relay, locks: noLocks, now: () => clock });
    await session.restore();
    const showAnswer = vi.fn();
    const call = createTransport({
      hostname: HOST,
      fetch: (input, init) => fetch(input, init),
      session,
      showAnswer,
      derivationId: BUILD,
    });

    // The pair has 30 s left, under the minute ahead of which a token is refreshed.
    clock = 3_600_000 - 30_000;
    const asking = call(view);
    const leaving = session.signOut();
    refreshed(TOKENS);
    await asking;

    expect(session.status()).toBe('signedIn');
    expect(showAnswer).not.toHaveBeenCalled();
    signedOut({ kind: 'signedOut' });
    await leaving;
  });

  it('shows an answer to a request that began after the sign-out, once someone signed in again', async () => {
    server.use(http.get(`${API}/view`, () => answering(403, { error: 'rejected' })));
    const { call, session, showAnswer } = await transport(HOST, { kind: 'signedOut' }, TOKENS);
    await session.signOut();
    await session.respond({});

    expect(await call(view)).toEqual({ kind: 'answer', answer: 'rejected' });
    expect(showAnswer).toHaveBeenCalledExactlyOnceWith({ answer: 'rejected', email: ADDRESS });
  });
});

describe('an answer that is not a success', () => {
  it('surfaces a 412 as a conflict and never sends the request again', async () => {
    vi.useFakeTimers();
    let sent = 0;
    server.use(
      http.post(`${API}/mutations`, () => {
        sent += 1;
        return answering(412, { error: 'precondition_failed' });
      }),
    );
    const { call } = await transport();

    const reply = call(write);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reply).toEqual({ kind: 'conflict' });
    expect(sent).toBe(1);
  });

  it.each([
    [401, { message: 'Unauthorized' }, { kind: 'unauthorized' }],
    [413, { error: 'payload_too_large', max: 1048576 }, { kind: 'tooLarge' }],
    [428, { error: 'precondition_required' }, { kind: 'preconditionRequired' }],
    [422, { error: 'key_reused' }, { kind: 'keyReused' }],
    [
      422,
      { error: 'invalid_op', index: 2, issues: [{ field: 'quantity', code: 'units-missing' }] },
      { kind: 'invalidOp', index: 2, issues: [{ field: 'quantity', code: 'units-missing' }] },
    ],
    // An invalid_op that does not name its op is no more than a 422.
    [422, { error: 'invalid_op', index: 'two', issues: [] }, { kind: 'failed', status: 422 }],
    [422, { error: 'invalid_op', index: 2 }, { kind: 'failed', status: 422 }],
    // What no kind of its own names comes back as it was, for the caller that knows its route.
    [400, { error: 'invalid_request' }, { kind: 'failed', status: 400 }],
    [409, { error: 'duplicate_id', index: 1 }, { kind: 'failed', status: 409 }],
    [422, { error: 'invalid_part' }, { kind: 'failed', status: 422 }],
    [404, { error: 'no_such_import' }, { kind: 'failed', status: 404 }],
    [500, { error: 'internal' }, { kind: 'failed', status: 500 }],
    [503, { message: 'Service Unavailable' }, { kind: 'failed', status: 503 }],
  ])('reads %i %j as %j, sent once', async (status, body, expected) => {
    let sent = 0;
    server.use(
      http.post(`${API}/mutations`, () => {
        sent += 1;
        return answering(status, body);
      }),
    );
    const { call } = await transport();

    const reply = await call(write);
    expect(reply).toMatchObject(expected);
    if (reply.kind === 'failed') expect(reply.body).toEqual(body);
    expect(sent).toBe(1);
  });

  it('reads a body that is not JSON as no body', async () => {
    server.use(
      http.get(`${API}/view`, () => new HttpResponse('<html>', { status: 502 })),
      http.get(`${API}/state`, () => new HttpResponse('<html>', { status: 200 })),
    );
    const { call } = await transport();
    expect(await call(view)).toEqual({ kind: 'failed', status: 502, body: undefined });
    expect(await call({ method: 'GET', path: '/state' })).toMatchObject({
      kind: 'ok',
      body: undefined,
    });
  });
});

describe('a write', () => {
  const MUTATED = { etag: '"4"', results: [{ dropped: [] }] };

  it('carries a key of its own for each call, and a read none', async () => {
    const keys: (string | null)[] = [];
    server.use(
      http.post(`${API}/mutations`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return answering(200, MUTATED, { etag: '"4"' });
      }),
    );
    const { call } = await transport();

    await call(write);
    await call(write);
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('carries the same key when it is sent again after the answer was lost, and applies once', async () => {
    vi.useFakeTimers();
    const stored = new Map<string, Response>();
    const sent: { key: string; match: string | null; body: string }[] = [];
    let applied = 0;
    let lose = true;
    server.use(
      http.post(`${API}/mutations`, async ({ request }) => {
        const key = request.headers.get('idempotency-key') ?? '';
        sent.push({ key, match: request.headers.get('if-match'), body: await request.text() });
        const replay = stored.get(key);
        if (replay) return replay.clone();
        applied += 1;
        const answer = answering(200, MUTATED, { etag: '"4"' });
        stored.set(key, answer.clone());
        if (lose) {
          lose = false;
          return HttpResponse.error();
        }
        return answer;
      }),
    );
    const { call } = await transport();

    const reply = call(write);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await reply).toMatchObject({ kind: 'ok', status: 200, body: MUTATED, etag: '"4"' });
    expect(applied).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0].key).not.toBe('');
  });

  it('waits out a request still running under its key, and sends it again', async () => {
    vi.useFakeTimers();
    const keys: (string | null)[] = [];
    server.use(
      http.post(`${API}/mutations`, ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        return keys.length === 1
          ? answering(409, { error: 'request_in_flight' })
          : answering(200, MUTATED, { etag: '"4"' });
      }),
    );
    const { call } = await transport();

    const reply = call(write);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await reply).toMatchObject({ kind: 'ok', etag: '"4"' });
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it('surfaces a request still running once the retries are spent', async () => {
    vi.useFakeTimers();
    let sent = 0;
    server.use(
      http.post(`${API}/mutations`, () => {
        sent += 1;
        return answering(409, { error: 'request_in_flight' });
      }),
    );
    const { call } = await transport();

    const reply = call(write);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await reply).toEqual({ kind: 'inFlight' });
    expect(sent).toBe(5);
  });
});

// Full jitter over 500 ms doubled at each retry, drawn at its half: 250, 500, 1000, 2000 ms.
describe('the retries', () => {
  const drawHalf = () => vi.spyOn(Math, 'random').mockReturnValue(0.5);

  it('retries a 429 with a growing wait up to a bound, then surfaces it', async () => {
    vi.useFakeTimers();
    drawHalf();
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        return answering(429, { message: 'Too Many Requests' });
      }),
    );
    const { call } = await transport();

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(sent).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(sent).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toBe(3);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sent).toBe(4);
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent).toBe(5);

    expect(await reply).toEqual({ kind: 'throttled' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toBe(5);
  });

  it('takes the first answer that is not a 429', async () => {
    vi.useFakeTimers();
    drawHalf();
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        return sent < 3 ? answering(429, { message: 'Too Many Requests' }) : answering(200, {});
      }),
    );
    const { call } = await transport();

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await reply).toMatchObject({ kind: 'ok' });
    expect(sent).toBe(3);
  });

  it('retries a failure of the network on the same schedule, then surfaces it', async () => {
    vi.useFakeTimers();
    drawHalf();
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        return HttpResponse.error();
      }),
    );
    const { call } = await transport();

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(3749);
    expect(sent).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toBe(5);
    expect(await reply).toEqual({ kind: 'offline' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent).toBe(5);
  });

  it('counts an answer cut off while its body is read as a failure of the network', async () => {
    vi.useFakeTimers();
    drawHalf();
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        if (sent > 1) return answering(200, {});
        const cut = new ReadableStream({ start: (controller) => controller.error(new Error('x')) });
        return new HttpResponse(cut, { status: 200 });
      }),
    );
    const { call } = await transport();

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await reply).toMatchObject({ kind: 'ok' });
    expect(sent).toBe(2);
  });

  describe('when the relay cannot be reached for a token', () => {
    const OFFLINE: RelayAnswer = { kind: 'refused', reason: 'offline' };
    const over = (relay: RelayCall, now: () => number) => {
      const session = createSession({ relay, locks: noLocks, now });
      const call = createTransport({
        hostname: HOST,
        fetch: (input, init) => fetch(input, init),
        session,
        showAnswer: vi.fn(),
        derivationId: BUILD,
      });
      return { session, call };
    };
    const served = () => {
      const sent = { count: 0 };
      server.use(
        http.get(`${API}/view`, () => {
          sent.count += 1;
          return answering(200, {});
        }),
      );
      return sent;
    };

    it('asks again on the same schedule for a pair past its expiry, then surfaces it as offline', async () => {
      vi.useFakeTimers();
      drawHalf();
      const sent = served();
      const answers = [TOKENS];
      const relay = vi.fn<RelayCall>(async () => answers.shift() ?? OFFLINE);
      let clock = 0;
      const { session, call } = over(relay, () => clock);
      await session.restore();
      clock = 3_600_000 + 1;

      const reply = call(view);
      await vi.advanceTimersByTimeAsync(3749);
      // The restore, and a refresh after 0, 250, 750 and 1750 ms.
      expect(relay).toHaveBeenCalledTimes(5);
      await vi.advanceTimersByTimeAsync(1);
      expect(relay).toHaveBeenCalledTimes(6);

      expect(await reply).toEqual({ kind: 'offline' });
      expect(sent.count).toBe(0);
      // The relay said nothing about the cookie, so the account is still signed in.
      expect(session.status()).toBe('signedIn');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(relay).toHaveBeenCalledTimes(6);
    });

    it('sends the call once a later refresh gives a token', async () => {
      vi.useFakeTimers();
      drawHalf();
      const sent = served();
      const answers = [TOKENS, OFFLINE, OFFLINE, TOKENS];
      const relay = vi.fn<RelayCall>(async () => answers.shift() ?? OFFLINE);
      let clock = 0;
      const { session, call } = over(relay, () => clock);
      await session.restore();
      clock = 3_600_000 + 1;

      const reply = call(view);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await reply).toMatchObject({ kind: 'ok' });
      expect(sent.count).toBe(1);
    });

    it('surfaces a load the relay never answered as offline, not as a rejected token', async () => {
      vi.useFakeTimers();
      drawHalf();
      const sent = served();
      const relay = vi.fn<RelayCall>(async () => OFFLINE);
      const { session, call } = over(relay, () => 0);

      const reply = call(view);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await reply).toEqual({ kind: 'offline' });
      expect(relay).toHaveBeenCalledTimes(5);
      expect(sent.count).toBe(0);
      expect(session.unanswered()).toBe(true);
    });
  });

  it('does not send again under another account when a sign-out and a sign-in come between', async () => {
    vi.useFakeTimers();
    drawHalf();
    const bearers: (string | null)[] = [];
    server.use(
      http.get(`${API}/view`, ({ request }) => {
        bearers.push(request.headers.get('authorization'));
        return answering(429, { message: 'Too Many Requests' });
      }),
    );
    const other = jwt({ sub: 'u2', email: 'other@example.com' });
    const { call, session } = await transport(
      HOST,
      { kind: 'signedOut' },
      {
        kind: 'tokens',
        tokens: { idToken: other, expiresIn: 3600 },
      },
    );

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(0);
    expect(bearers).toEqual([`Bearer ${ID_TOKEN}`]);
    await session.signOut();
    await session.respond({});
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await reply).toEqual({ kind: 'unauthorized' });
    expect(bearers).toEqual([`Bearer ${ID_TOKEN}`]);
  });

  it('counts an attempt no answer reaches in time as a failure of the network', async () => {
    vi.useFakeTimers();
    drawHalf();
    let sent = 0;
    server.use(
      http.get(`${API}/view`, () => {
        sent += 1;
        return new Promise<never>(() => undefined);
      }),
    );
    const { call } = await transport();

    const reply = call(view);
    await vi.advanceTimersByTimeAsync(ANSWER_MS + 249);
    expect(sent).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toBe(2);
    await vi.advanceTimersByTimeAsync(10 * ANSWER_MS);
    expect(sent).toBe(5);
    expect(await reply).toEqual({ kind: 'offline' });
  });
});

describe('the suite', () => {
  it('halts a request no handler names', async () => {
    await expect(fetch(`${API}/not-handled`)).rejects.toThrow(/\[MSW\].*"error" strategy/);
  });
});
