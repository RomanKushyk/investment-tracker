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

  it('reaches the Google routes under /auth/google', async () => {
    const fetch = answer(200, { authorize: 'https://auth.test/oauth2/authorize' });
    await createRelay({ base: 'https://api.test', fetch })('google/begin');
    expect(fetch).toHaveBeenCalledWith('https://api.test/auth/google/begin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'x-csrf': '1' },
      signal: expect.any(AbortSignal),
    });
  });

  // THE PASSKEY CALLS GO TO THE RELAY, which holds the token they take; Cognito's endpoint is
  // never the page's to call (*Auth model*).
  it('reaches the passkey routes under /auth/passkey, the credential as JSON', async () => {
    const fetch = answer(200, { status: 'registered' });
    const relay = createRelay({ base: 'https://api.test', fetch });
    await relay('passkey/list', { sub: 'u' });
    await relay('passkey/start', { sub: 'u' });
    await relay('passkey/complete', { sub: 'u', credential: { id: 'cred' } });
    const sent = (route: string, body: string) => [
      `https://api.test/auth/passkey/${route}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf': '1', 'content-type': 'application/json' },
        body,
        signal: expect.any(AbortSignal),
      },
    ];
    expect(fetch.mock.calls).toEqual([
      sent('list', '{"sub":"u"}'),
      sent('start', '{"sub":"u"}'),
      sent('complete', '{"sub":"u","credential":{"id":"cred"}}'),
    ]);
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
      { idToken: 'i', expiresIn: 3600 },
      { kind: 'tokens', tokens: { idToken: 'i', expiresIn: 3600 } },
    ],
    // THE PAGE KEEPS NO ACCESS TOKEN, even from a relay deployed before it stopped sending one.
    [
      200,
      { idToken: 'i', accessToken: 'a', expiresIn: 3600 },
      { kind: 'tokens', tokens: { idToken: 'i', expiresIn: 3600 } },
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
    [400, { error: 'invalid_password' }, { kind: 'refused', reason: 'invalidPassword' }],
    [400, { error: 'reused_password' }, { kind: 'refused', reason: 'reusedPassword' }],
    [400, 'not json', { kind: 'refused', reason: 'invalid' }],
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
    [200, { idToken: 'i' }, { kind: 'refused', reason: 'failed' }],
    [200, { passkey: false }, { kind: 'passkey', listed: false }],
    [200, { passkey: true }, { kind: 'passkey', listed: true }],
    [200, { passkey: 'yes' }, { kind: 'refused', reason: 'failed' }],
    [200, { options: { challenge: 'c' } }, { kind: 'options', options: { challenge: 'c' } }],
    [200, { options: null }, { kind: 'refused', reason: 'failed' }],
    [200, { options: 'c' }, { kind: 'refused', reason: 'failed' }],
    [200, { options: [] }, { kind: 'refused', reason: 'failed' }],
    [200, { status: 'registered' }, { kind: 'registered' }],
    // WHETHER GOOGLE IS ON rides a refresh's answers, both of them, and nothing else is read as it.
    [
      200,
      { idToken: 'i', expiresIn: 3600, google: true },
      {
        kind: 'tokens',
        tokens: { idToken: 'i', expiresIn: 3600 },
        google: true,
      },
    ],
    [
      401,
      { error: 'not_authorized', google: false },
      { kind: 'refused', reason: 'notAuthorized', google: false },
    ],
    [
      401,
      { error: 'not_authorized', google: 'true' },
      { kind: 'refused', reason: 'notAuthorized' },
    ],
    [
      200,
      { status: 'signed_out', logout: 'https://auth.test/logout?client_id=c' },
      { kind: 'signedOut', logout: 'https://auth.test/logout?client_id=c' },
    ],
    [200, { status: 'signed_out', logout: 7 }, { kind: 'signedOut' }],
    [
      200,
      { authorize: 'https://auth.test/oauth2/authorize?state=s' },
      { kind: 'authorize', url: 'https://auth.test/oauth2/authorize?state=s' },
    ],
    [200, { authorize: '' }, { kind: 'refused', reason: 'failed' }],
    [404, { error: 'google_disabled' }, { kind: 'refused', reason: 'failed' }],
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
    expect(await createRelay({ base: undefined, fetch })('start', {})).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  // No relay, no refresh cookie: the question a refresh asks has its answer, and the shell's
  // account slot can close instead of waiting on an answer that cannot come.
  it('answers a refresh there as signed out, not as a failure', async () => {
    const fetch = vi.fn();
    expect(await createRelay({ base: undefined, fetch })('refresh')).toEqual({
      kind: 'refused',
      reason: 'notAuthorized',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
