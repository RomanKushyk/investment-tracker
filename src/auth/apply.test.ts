import { describe, expect, it, vi } from 'vitest';

import { createApply } from './apply';

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('an application', () => {
  it('posts the canonical address as JSON, and no cookie', async () => {
    const fetch = answer(202, { status: 'received' });
    await createApply({ base: 'https://api.test', fetch })('  Oksana.Melnyk@Example.com ');
    expect(fetch).toHaveBeenCalledWith('https://api.test/v1/applications', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json' },
      body: '{"email":"oksana.melnyk@example.com"}',
      signal: expect.any(AbortSignal),
    });
  });

  it('is recorded under the address the endpoint was sent', async () => {
    const apply = createApply({ base: '', fetch: answer(202, { status: 'received' }) });
    expect(await apply('Oksana.Melnyk@Example.com')).toEqual({
      kind: 'recorded',
      email: 'oksana.melnyk@example.com',
    });
  });

  it.each([
    [400, { error: 'invalid_request' }, 'emailInvalid'],
    [429, { message: 'Too Many Requests' }, 'throttled'],
    [500, { error: 'internal' }, 'failed'],
    [503, { message: 'Service Unavailable' }, 'failed'],
    [403, { error: 'forbidden' }, 'failed'],
    // Only the endpoint's own constant is a record: anything else was not written by it.
    [200, { status: 'received' }, 'failed'],
    [202, { status: 'queued' }, 'failed'],
    [202, 'received', 'failed'],
  ])('reads %i %j as %s', async (status, body, reason) => {
    const apply = createApply({ base: '', fetch: answer(status, body) });
    expect(await apply('a@b.cd')).toEqual({ kind: 'refused', reason });
  });

  it('reads an answer that is not JSON as failed', async () => {
    const fetch = vi.fn(async () => new Response('<html>', { status: 202 }));
    expect(await createApply({ base: '', fetch })('a@b.cd')).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
  });

  it.each([
    ['', 'emailMissing'],
    ['   ', 'emailMissing'],
    ['оксана@пошта.укр', 'emailInvalid'],
    ['name@example', 'emailInvalid'],
    [`${'a'.repeat(243)}@example.com`, 'emailInvalid'],
  ])('refuses %j as %s without a request', async (typed, reason) => {
    const fetch = vi.fn();
    expect(await createApply({ base: '', fetch })(typed)).toEqual({ kind: 'refused', reason });
    expect(fetch).not.toHaveBeenCalled();
  });

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
      void createApply({ base: '', fetch })('a@b.cd').then((a) => (settled = a));
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
    expect(await createApply({ base: '', fetch })('a@b.cd')).toEqual({
      kind: 'refused',
      reason: 'offline',
    });
  });

  it('refuses without a request where the host has no API', async () => {
    const fetch = vi.fn();
    expect(await createApply({ base: undefined, fetch })('a@b.cd')).toEqual({
      kind: 'refused',
      reason: 'failed',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
