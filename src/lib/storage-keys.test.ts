// The rename is only safe because of these. A key rename is not a
// find-and-replace: the key IS the data, so an untested migration is a silent
// reset of the user's currency, rate, dataset flag and dismissals (D42, E1).
import { beforeEach, describe, expect, it, vi } from 'vitest';

function fakeStorage(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
}

const PROFILE = JSON.stringify({
  state: { currency: 'USD', usdRate: 41.5, dataset: 'live', dismissedReminders: ['coupon:x:2026-09-23'] },
  version: 1,
});

describe('pre-Quirenote profile migration', () => {
  beforeEach(() => vi.resetModules());

  it('carries settings and draft across, and removes the old keys', async () => {
    const ls = fakeStorage({ 'kubushka-settings': PROFILE, 'kubushka-draft': '{"state":{"quotes":{}}}' });
    vi.stubGlobal('localStorage', ls);

    const keys = await import('./storage-keys');

    expect(ls.getItem(keys.SETTINGS_KEY)).toBe(PROFILE);
    expect(ls.getItem(keys.DRAFT_KEY)).toBe('{"state":{"quotes":{}}}');
    // One live profile: the old keys are gone, not left to diverge.
    expect(ls.getItem('kubushka-settings')).toBeNull();
    expect(ls.getItem('kubushka-draft')).toBeNull();
  });

  it('never clobbers a profile already written under the new key', async () => {
    const ls = fakeStorage({ 'kubushka-settings': PROFILE, 'quirenote-settings': '{"state":{"currency":"UAH"}}' });
    vi.stubGlobal('localStorage', ls);

    const keys = await import('./storage-keys');

    expect(ls.getItem(keys.SETTINGS_KEY)).toBe('{"state":{"currency":"UAH"}}');
    expect(ls.getItem('kubushka-settings')).toBeNull();
  });

  it('is a no-op on a fresh profile', async () => {
    const ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);

    const keys = await import('./storage-keys');

    expect(ls.getItem(keys.SETTINGS_KEY)).toBeNull();
    expect(ls.store.size).toBe(0);
  });

  it('does not throw when localStorage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
    });
    // The boot must survive a locked-down browser — nothing here is worth
    // failing a boot over.
    await expect(import('./storage-keys')).resolves.toBeDefined();
  });
});
