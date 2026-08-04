// Cross-tab write serialization (P4 feat/backup-import, D24). Pure logic over
// a stubbed LockManager — no IndexedDB, no browser.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DB_LOCK, withDbLock } from './sync';

interface RequestCall {
  name: string;
  ifAvailable: boolean;
}

function stubLocks(available: boolean) {
  const calls: RequestCall[] = [];
  const request = async (
    name: string,
    optionsOrCallback: unknown,
    maybeCallback?: unknown,
  ): Promise<unknown> => {
    const callback = (
      typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
    ) as (lock: unknown) => Promise<unknown>;
    const options = (
      typeof optionsOrCallback === 'function' ? {} : (optionsOrCallback as { ifAvailable?: boolean })
    ) as { ifAvailable?: boolean };
    calls.push({ name, ifAvailable: options.ifAvailable === true });
    return callback(options.ifAvailable === true && !available ? null : { name });
  };
  vi.stubGlobal('navigator', { locks: { request } });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('withDbLock', () => {
  it('runs the write under the lock and never reports a wait when it is free', async () => {
    const calls = stubLocks(true);
    const onBlocked = vi.fn();

    await expect(withDbLock(() => Promise.resolve('written'), onBlocked)).resolves.toBe('written');
    expect(calls).toEqual([{ name: DB_LOCK, ifAvailable: true }]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('reports the wait once, then queues for the lock — and writes exactly once', async () => {
    const calls = stubLocks(false);
    const onBlocked = vi.fn();
    const write = vi.fn(() => Promise.resolve('written'));

    await expect(withDbLock(write, onBlocked)).resolves.toBe('written');
    // Two-phase: the ifAvailable probe is what makes "another tab holds it"
    // knowable at all; a plain request cannot tell instant from queued.
    expect(calls).toEqual([
      { name: DB_LOCK, ifAvailable: true },
      { name: DB_LOCK, ifAvailable: false },
    ]);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('still writes where Web Locks do not exist — a missing safeguard never blocks', async () => {
    vi.stubGlobal('navigator', {});
    const onBlocked = vi.fn();

    await expect(withDbLock(() => Promise.resolve(7), onBlocked)).resolves.toBe(7);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('propagates a failing write instead of swallowing it under the lock', async () => {
    stubLocks(true);
    await expect(withDbLock(() => Promise.reject(new Error('aborted')))).rejects.toThrow('aborted');
  });
});
