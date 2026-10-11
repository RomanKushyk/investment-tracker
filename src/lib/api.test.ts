// @vitest-environment jsdom
// The app's one client of the user API, wired as the app wires it: a sign-out the relay has
// answered takes the figures, the tag and the draft with it, and the next account to sign in on the
// browser reads its own and finds none of the last one's (*Auth model*).
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';

import { fakeApi } from '../__fixtures__/fake-api';
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

const { queryClient, repo } = await import('./api');
const { session } = await import('../auth/app');
const { viewQuery } = await import('../hooks/queries');
const { useDraft } = await import('../state/draft');

const rowsOf = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});

// Each case starts as the page does: the seed's account signed in, nothing cached, nothing held.
beforeEach(async () => {
  kept.clear();
  useDraft.setState(useDraft.getInitialState(), true);
  api.rows = structuredClone(rowsOf());
  api.version = 0;
  api.signedIn = true;
  api.seen.length = 0;
  queryClient.clear();
  repo.forget();
  await session.respond({});
});

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
