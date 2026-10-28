// @vitest-environment jsdom
// The app's one client of the user API, wired as the app wires it: a sign-out the relay has
// answered takes the figures, the tag and the draft with it, and the next account to sign in on the
// browser reads its own and finds none of the last one's (*Auth model*).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';

import { fakeApi } from '../__fixtures__/fake-api';
import { SETTINGS_PATCH_DELAY_MS } from './settings-copy';
import { DRAFT_KEY } from './storage-keys';

// Set before the stores and the session load: they read `localStorage` and `location` as they do.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
const SEED = buildSeedBackup('2026-07-28T12:00:00');
const api = fakeApi(
  {
    assets: SEED.assets as Asset[],
    transactions: SEED.transactions as Transaction[],
    prices: SEED.prices,
  },
  { today: '2026-07-28' },
);
vi.stubGlobal('fetch', api.fetch);
afterAll(() => vi.unstubAllGlobals());

const { queryClient, repo, settingsCopy } = await import('./api');
const { session } = await import('../auth/app');
const { viewQuery } = await import('../hooks/queries');
const { useDraft } = await import('../state/draft');
const { useSettings } = await import('../state/settings');

const rowsOf = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});

// Each case starts as the page does: the seed's account signed in, nothing cached, nothing held.
beforeEach(async () => {
  kept.clear();
  useDraft.setState(useDraft.getInitialState(), true);
  useSettings.setState(useSettings.getInitialState(), true);
  api.rows = structuredClone(rowsOf());
  api.version = 0;
  api.settings = null;
  api.signedIn = true;
  api.seen.length = 0;
  queryClient.clear();
  repo.forget();
  await session.respond({});
});
afterEach(() => vi.useRealTimers());

describe('the app signed in', () => {
  it('reads the view as the signed-in account, through the proxy the dev server makes same-origin', async () => {
    await session.restore();

    const view = await queryClient.fetchQuery(viewQuery);

    expect(view.assets).toHaveLength(4);
    expect(api.seen.at(-1)?.path).toBe('/view');
  });
});

describe('a sign-out', () => {
  it('takes every cached figure and the draft, and the next account on the browser sees none', async () => {
    const first = await queryClient.fetchQuery(viewQuery);
    expect(first.assets).toHaveLength(4);
    useDraft.getState().setDate('2026-07-27');
    useDraft.getState().setQuote(SEED.assets[0].id, '68702,1');
    expect(kept.get(DRAFT_KEY)).toContain('68702,1');

    expect(await session.signOut()).not.toBe(false);

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((q) => q.state.data !== undefined),
    ).toEqual([]);
    expect(useDraft.getState()).toMatchObject({ date: '', quotes: {}, origins: {} });
    expect(kept.has(DRAFT_KEY)).toBe(false);

    // Another account signs in on the same browser. Its dataset is at another version, and its first
    // write goes under a tag it read, not one the last account held.
    api.rows = { assets: [], transactions: [], prices: [] };
    api.version = 7;
    await session.respond({});
    await repo.clearAll();
    expect(api.seen.filter((r) => r.path === '/state')).toHaveLength(1);

    const second = await queryClient.fetchQuery(viewQuery);
    expect(second.assets).toEqual([]);
    expect(second.transactions).toEqual([]);
    expect(
      JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SEED.assets[0].id);
  });
});

// The device's store holds a copy of the account's settings (*Persistence today*): the view's answer
// overwrites it and a change is sent as a merge patch, through the one client the app is wired with.
describe('the account’s settings', () => {
  const patches = () => api.seen.filter((r) => r.method === 'PATCH');
  const timers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  /** A quiet half second, and the answer to the write it sent. */
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(SETTINGS_PATCH_DELAY_MS);
    await vi.advanceTimersByTimeAsync(0);
  };
  // Started once the store holds what the case begins with: a change made after is a person's.
  let stop = () => {};
  const listening = () => (stop = settingsCopy.start());
  afterEach(() => stop());

  it('overwrite what the view is read with, and the theme is not among them', async () => {
    api.settings = JSON.stringify({ period: '3m', language: 'en', sidebarCollapsed: true });
    useSettings.setState({ theme: 'dark', period: 'ytd', defaultCurrency: 'USD' });

    await queryClient.fetchQuery(viewQuery);

    expect(useSettings.getState()).toMatchObject({
      period: '3m',
      language: 'en',
      sidebarCollapsed: true,
      defaultCurrency: 'UAH',
      theme: 'dark',
    });
  });

  it('go out as one merge patch for a run of changes, and the view that follows is the same on another device', async () => {
    timers();
    listening();
    for (const period of ['1m', '3m', '6m', '12m', 'ytd'] as const) {
      useSettings.getState().setPeriod(period);
      await vi.advanceTimersByTimeAsync(SETTINGS_PATCH_DELAY_MS / 5);
    }
    await settle();

    expect(patches()).toHaveLength(1);
    expect(patches()[0]).toMatchObject({
      path: '/me/settings',
      headers: { 'content-type': 'application/merge-patch+json' },
      body: JSON.stringify({ period: 'ytd' }),
    });
    expect(api.settings).toBe(JSON.stringify({ period: 'ytd' }));

    // Another device: a page of its own, with a store that holds the defaults and sends nothing yet.
    stop();
    vi.useRealTimers();
    useSettings.setState(useSettings.getInitialState(), true);
    queryClient.clear();
    await queryClient.fetchQuery(viewQuery);
    expect(useSettings.getState().period).toBe('ytd');
  });

  it('are not filled from the copy of the account before: the second user starts from the defaults', async () => {
    timers();
    listening();
    useSettings.getState().setPeriod('3m');
    await settle();
    expect(patches()).toHaveLength(1);
    expect(await session.signOut()).not.toBe(false);
    // The copy outlives a sign-out; the next account's answer is what overwrites it.
    expect(useSettings.getState().period).toBe('3m');

    api.settings = null;
    api.seen.length = 0;
    await session.respond({});
    await queryClient.fetchQuery(viewQuery);
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(useSettings.getState().period).toBe('all');
    expect(patches()).toEqual([]);
    expect(api.settings).toBeNull();
  });

  it('are not sent to the next account when the last signed out before the change went', async () => {
    timers();
    listening();
    useSettings.getState().setPeriod('3m');
    expect(await session.signOut()).not.toBe(false);
    await session.respond({});
    api.seen.length = 0;
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(patches()).toEqual([]);
    expect(api.settings).toBeNull();
  });

  it('are not filled by a group closed before the new account first answers, which was built on the last account’s list', async () => {
    // The last account left two groups closed on the copy; the new account has stored no settings.
    useSettings.setState({ collapsedNavGroups: ['entry', 'analytics'] });
    timers();
    listening();

    // The shell paints from the copy, and the person opens a group before the answer comes.
    useSettings.getState().toggleNavGroup('analytics');
    await queryClient.fetchQuery(viewQuery);
    await settle();

    expect(patches()).toEqual([]);
    expect(api.settings).toBeNull();
    expect(useSettings.getState().collapsedNavGroups).toEqual([]);
  });

  it('are read and written on the copy alone by a signed-out page', async () => {
    timers();
    listening();
    expect(await session.signOut()).not.toBe(false);
    api.seen.length = 0;

    useSettings.getState().setLanguage('en');
    await vi.advanceTimersByTimeAsync(10 * SETTINGS_PATCH_DELAY_MS);

    expect(api.seen).toEqual([]);
    expect(useSettings.getState().language).toBe('en');
    expect(api.settings).toBeNull();
  });

  it('keep the copy when the write is refused, and the next read of the view says the account’s', async () => {
    api.settings = JSON.stringify({ period: '12m' });
    await queryClient.fetchQuery(viewQuery);
    expect(useSettings.getState().period).toBe('12m');

    timers();
    listening();
    let refused = 0;
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return api.fetch(input, init);
      refused += 1;
      return Promise.resolve(new Response('{}', { status: 500 }));
    });
    try {
      useSettings.getState().setPeriod('3m');
      await settle();
    } finally {
      vi.stubGlobal('fetch', api.fetch);
      vi.useRealTimers();
    }
    expect(refused).toBe(1);
    expect(useSettings.getState().period).toBe('3m');

    const unchanged = api.notModified;
    await queryClient.fetchQuery({ ...viewQuery, staleTime: 0 });

    // The account never changed, so the answer is a 304 and the copy is still put right.
    expect(api.notModified).toBe(unchanged + 1);
    expect(useSettings.getState().period).toBe('12m');
  });
});
