// @vitest-environment jsdom
// The account's two reads (*Cloud target*): `GET /me`, the caller and its settings, which the shell
// asks for on every load (#600), and `GET /me/account`, the profile's fields, asked for by the
// profile alone. Each is fresh for the view's window and gone with the account. The app's own
// client, session and repository over the fake of the API.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';

import { fakeApi } from '../__fixtures__/fake-api';

// Set before the stores and the session load: they read `localStorage` as they do.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
const SEED = buildSeedBackup('2026-07-28T12:00:00');
const rowsOf = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
const api = fakeApi(rowsOf(), { today: '2026-07-28' });
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
// TanStack reads staleness off `Date.now`: moving `skew` on ages what the cache holds.
let skew = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const { queryClient, repo, settingsCopy } = await import('../lib/api');
const { useSettings } = await import('../state/settings');
const { SETTINGS_PATCH_DELAY_MS } = await import('../lib/settings-copy');
const { session } = await import('../auth/app');
const { meKey } = await import('../lib/me-key');
const { useAccount, useDeleteTransaction, useMe, useRole, useRoleGate, viewKey, VIEW_STALE_MS } =
  await import('./queries');

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children);
const reads = (path = '/me') => api.seen.filter((r) => r.path === path).length;
const mount = async () => {
  const hook = renderHook(() => useMe(), { wrapper });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return hook;
};
const mountAccount = async () => {
  const hook = renderHook(() => useAccount(), { wrapper });
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  return hook;
};

beforeEach(async () => {
  kept.clear();
  api.rows = structuredClone(rowsOf());
  api.version = 0;
  api.role = 'user';
  api.settings = null;
  useSettings.setState(useSettings.getInitialState(), true);
  api.signedIn = true;
  api.seen.length = 0;
  api.notModified = 0;
  skew = 0;
  queryClient.clear();
  repo.forget();
  await session.respond({});
});
afterEach(cleanup);

describe("the account's own read", () => {
  it("answers the caller's role, a user's and a super-admin's", async () => {
    const user = await mount();
    expect(user.result.current?.role).toBe('user');
    user.unmount();

    queryClient.clear();
    api.role = 'super_admin';
    const admin = await mount();
    expect(admin.result.current?.role).toBe('super_admin');
  });

  it('answers what the account holds off the profile’s read, and asks /me nothing for it', async () => {
    const { result } = await mountAccount();
    expect(result.current).toMatchObject({
      assets: SEED.assets.length,
      transactions: SEED.transactions.length,
    });
    expect([reads(), reads('/me/account')]).toEqual([0, 1]);
  });

  it('is read once for a visit, and a visit inside the window reads nothing', async () => {
    (await mount()).unmount();
    (await mount()).unmount();
    expect(reads()).toBe(1);

    // Once the window has passed, the next visit revalidates with the tag it holds.
    skew = VIEW_STALE_MS + 1;
    await mount();
    expect(reads()).toBe(2);
    expect(api.seen.filter((r) => r.path === '/me').at(-1)?.headers['if-none-match']).toMatch(
      /^W\//,
    );
    expect(api.notModified).toBe(1);
  });

  it('is its own read: a view read again asks nothing of it', async () => {
    await mount();
    await act(() => queryClient.invalidateQueries({ queryKey: viewKey }));
    expect(reads()).toBe(1);
  });

  it('reads the profile’s fields again after a write, which moves what the account holds', async () => {
    (await mount()).unmount();
    (await mountAccount()).unmount();
    const write = renderHook(() => useDeleteTransaction(), { wrapper });
    await act(() => write.result.current.mutateAsync({ id: SEED.transactions[0].id }));
    // Inside the window: only the write's settling sends the next visit to the API.
    const { result } = await mountAccount();
    expect(reads('/me/account')).toBe(2);
    expect(result.current?.transactions).toBe(SEED.transactions.length - 1);
    // `/me` carries nothing a write moves.
    await mount();
    expect(reads()).toBe(1);
  });

  // The copy already holds what the patch sent, and the next read of `/me` finds it stored.
  it('asks nothing of either read after a settings change', async () => {
    const stop = settingsCopy.start();
    try {
      (await mount()).unmount();
      (await mountAccount()).unmount();
      act(() => useSettings.setState({ period: '1m' }));
      // The copy waits for the changes to go quiet before it sends them.
      const sent = { timeout: SETTINGS_PATCH_DELAY_MS + 2000 };
      await waitFor(() => expect(api.settings).toContain('1m'), sent);
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
      expect(queryClient.getQueryState(meKey)?.isInvalidated).toBe(false);
      await mount();
      await mountAccount();
      expect([reads(), reads('/me/account')]).toEqual([1, 1]);
      expect(useSettings.getState().period).toBe('1m');
    } finally {
      stop();
    }
  });

  it('puts the settings it answers on the device’s copy', async () => {
    api.settings = JSON.stringify({ period: '6m', language: 'en' });
    await mount();
    expect(useSettings.getState()).toMatchObject({ period: '6m', language: 'en' });
  });

  it('holds nothing of the last account once the relay has answered a sign-out', async () => {
    const { result } = await mount();
    expect(result.current?.role).toBe('user');

    expect(await session.signOut()).not.toBe(false);

    await waitFor(() => expect(result.current).toBeUndefined());
    expect(queryClient.getQueryData(meKey)).toBeUndefined();
    // A caller nobody has signed in sends no data request.
    expect(reads()).toBe(1);
  });
});

describe('signed out', () => {
  // Every reader of the role, as RoleGate is one, with each value it rendered.
  const mountGate = async () => {
    const seen: string[] = [];
    const hook = renderHook(
      () => {
        const gate = useRoleGate();
        seen.push(gate);
        return gate;
      },
      { wrapper },
    );
    await waitFor(() => expect(hook.result.current).toBe('signedOut'));
    return { hook, seen };
  };

  beforeEach(async () => {
    expect(await session.signOut()).not.toBe(false);
  });

  it('a reader mounted after the signed-out answer reads /me no more, and the gate stays signedOut', async () => {
    const { hook, seen } = await mountGate();
    const asked = vi.spyOn(repo, 'readMe');
    onTestFinished(() => asked.mockRestore());
    const answered = seen.length;

    renderHook(() => useRole(), { wrapper });
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(asked).not.toHaveBeenCalled();
    expect(seen.slice(answered)).not.toContain('pending');
    expect(hook.result.current).toBe('signedOut');
  });

  it('after a sign-in, a mounting reader reads /me again and answers the role', async () => {
    const { hook } = await mountGate();
    hook.unmount();

    await session.respond({});
    const { result } = await mount();

    expect(result.current?.role).toBe('user');
    expect(reads()).toBe(1);
  });
});
