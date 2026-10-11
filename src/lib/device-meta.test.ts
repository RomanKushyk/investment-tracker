// What this device keeps of the public feeds (*Persistence today*): the last good Inzhur payload and
// its parse record. They name nothing of the account, so they live in the browser's own storage and
// not behind the API.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readMeta, writeMeta } from './device-meta';

function storage(seed: Record<string, string> = {}) {
  const held = new Map(Object.entries(seed));
  return {
    held,
    getItem: (k: string) => held.get(k) ?? null,
    setItem: (k: string, v: string) => void held.set(k, v),
    removeItem: (k: string) => void held.delete(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('the Inzhur caches', () => {
  it('round-trips the last fetch and overwrites it in place', () => {
    const local = storage();
    vi.stubGlobal('localStorage', local);
    expect(readMeta('inzhur:lastFetch')).toBeUndefined();

    writeMeta('inzhur:lastFetch', { payload: [{ slug: 'inzhur-reit' }], fetchedAt: 'x' });
    expect(readMeta('inzhur:lastFetch')).toEqual({
      payload: [{ slug: 'inzhur-reit' }],
      fetchedAt: 'x',
    });

    writeMeta('inzhur:lastFetch', { payload: [], fetchedAt: 'y' });
    expect(readMeta('inzhur:lastFetch')).toEqual({ payload: [], fetchedAt: 'y' });
    expect([...local.held.keys()]).toEqual(['inzhur:lastFetch']);
  });

  it('round-trips the last parse record beside it', () => {
    vi.stubGlobal('localStorage', storage());
    const record = { at: '2026-10-11T08:00:00.000Z', entries: 12, skipped: [] };

    writeMeta('inzhur:lastParse', record);

    expect(readMeta('inzhur:lastParse')).toEqual(record);
  });
});

describe('a store that cannot be trusted', () => {
  it('reads nothing from a value that is not JSON', () => {
    vi.stubGlobal('localStorage', storage({ 'inzhur:lastFetch': '{not json' }));
    expect(readMeta('inzhur:lastFetch')).toBeUndefined();
  });

  it('reads nothing, and writes nothing, where the browser refuses the storage', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(readMeta('inzhur:lastFetch')).toBeUndefined();
    expect(() => writeMeta('inzhur:lastFetch', { fetchedAt: 'x' })).not.toThrow();
  });
});
