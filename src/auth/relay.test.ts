import { describe, expect, it, vi } from 'vitest';

import { createRelay } from './relay';

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('a relay call', () => {
  it('posts with the cookie, the CSRF header and a JSON body', async () => {
    const fetch = answer(200, { challenge: 'SELECT_CHALLENGE', session: 's', parameters: {} });
    await createRelay({ base: 'https://api.test', fetch })('start', { USERNAME: 'a@b.cd' });
    expect(fetch).toHaveBeenCalledWith('https://api.test/auth/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf': '1', 'content-type': 'application/json' },
      body: '{"USERNAME":"a@b.cd"}',
      signal: expect.any(AbortSignal),
    });
  });

  it('sends no body where the relay reads none', async () => {
    const fetch = answer(401, { error: 'not_authorized' });
    await createRelay({ base: '/relay', fetch })('refresh');
    expect(fetch).toHaveBeenCalledWith('/relay/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf': '1' },
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    [
      200,
      { idToken: 'i', accessToken: 'a', expiresIn: 3600 },
      { kind: 'tokens', tokens: { idToken: 'i', accessToken: 'a', expiresIn: 3600 } },
    ],
    [
      200,
      { challenge: 'WEB_AUTHN', session: 's', parameters: { X: '1' } },
      {
        kind: 'challenge',
        challenge: { challenge: 'WEB_AUTHN', session: 's', parameters: { X: '1' } },
      },
    ],
    [200, { status: 'signed_out' }, { kind: 'signedOut' }],
    [401, { error: 'not_authorized' }, { kind: 'refused', reason: 'notAuthorized' }],
    [400, { error: 'invalid_request' }, { kind: 'refused', reason: 'invalid' }],
    [429, { message: 'Too Many Requests' }, { kind: 'refused', reason: 'throttled' }],
    [429, { error: 'too_many_attempts' }, { kind: 'refused', reason: 'throttled' }],
    [403, { error: 'csrf' }, { kind: 'refused', reason: 'failed' }],
    [500, { error: 'internal' }, { kind: 'refused', reason: 'failed' }],
    [200, { unexpected: true }, { kind: 'refused', reason: 'failed' }],
    [200, { challenge: 'PASSWORD_VERIFIER', session: 's' }, { kind: 'refused', reason: 'failed' }],
    [
      200,
      { challenge: 'PASSWORD_VERIFIER', session: 's', parameters: null },
      { kind: 'refused', reason: 'failed' },
    ],
    [200, { idToken: 'i', accessToken: 'a' }, { kind: 'refused', reason: 'failed' }],
  ])('reads %i %j as %j', async (status, body, expected) => {
    const relay = createRelay({ base: '', fetch: answer(status, body) });
    expect(await relay('respond', {})).toEqual(expected);
  });

  // The cross-tab lock is held until the answer lands, so a stalled request must end: past API
  // Gateway's own 30-second ceiling no answer can still come.
  it('gives up on an answer that has not come in 30 seconds, as offline', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(
        (_: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('', 'AbortError')),
            ),
          ),
      );
      let settled: unknown;
      void createRelay({ base: '', fetch })('refresh').then((a) => (settled = a));
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toEqual({ kind: 'refused', reason: 'offline' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a network failure as offline', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await createRelay({ base: '', fetch })('start', {})).toEqual({
      kind: 'refused',
      reason: 'offline',
    });
  });

  it('refuses without a request where the host has no relay', async () => {
    const fetch = vi.fn();
    expect(await createRelay({ base: undefined, fetch })('refresh')).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
