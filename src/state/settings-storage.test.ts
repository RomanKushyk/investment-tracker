// @vitest-environment jsdom
// The store through a storage: the node run has none (see `draft.test.ts`), and without one the
// store persists nothing. One local store (#404): a profile written while a dataset was selectable
// keeps its key until the store next writes, and the write leaves it out.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_KEY } from '../lib/storage-keys';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('a profile that still carries a dataset', () => {
  it('hydrates around it and writes it out at the next change', async () => {
    const kept = new Map([
      [
        SETTINGS_KEY,
        JSON.stringify({ state: { dataset: 'live', defaultCurrency: 'USD' }, version: 1 }),
      ],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => kept.get(k) ?? null,
      setItem: (k: string, v: string) => void kept.set(k, v),
      removeItem: (k: string) => void kept.delete(k),
    });
    vi.resetModules();
    const { useSettings } = await import('./settings');
    expect(useSettings.getState().defaultCurrency).toBe('USD');

    useSettings.getState().setPeriod('3m');

    const written = JSON.parse(kept.get(SETTINGS_KEY)!) as { state: object };
    expect(Object.keys(written.state)).not.toContain('dataset');
    expect(written.state).toMatchObject({ defaultCurrency: 'USD', period: '3m' });
  });
});
