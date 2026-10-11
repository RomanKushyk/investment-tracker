// @vitest-environment jsdom
// A session that ends reaches the screens that are mounted, not only the cache (*Auth model*): the
// app's own client, session and fake of the API, with the screens that read through them. A figure
// held on screen goes with the account's, and a read that was waiting for a token when the relay
// said nobody is signed in does not leave its placeholder up for ever.
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';

import { fakeApi } from '../__fixtures__/fake-api';

// Set before the stores and the session load: they read `localStorage` and `location` as they do.
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
// The relay answers for whichever account its cookie holds, which another tab's sign-in replaces.
let account = 'account-a';
const base64url = (text: string) =>
  btoa(text).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const idToken = (sub: string) =>
  `h.${base64url(JSON.stringify({ sub, email: `${sub}@example.com` }))}.s`;
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const reply = await api.fetch(input, init);
  const { pathname } = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!reply.ok || !/\/auth\/(refresh|respond)$/.test(pathname)) return reply;
  return new Response(JSON.stringify({ idToken: idToken(account), expiresIn: 3600 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
});
// The session keeps the clock it finds when it is made, so the clock is set before it is: moving
// `skew` on makes the pair it holds one that has gone stale, and a read then asks the relay for
// another.
let skew = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const { queryClient, repo } = await import('./api');
const { session } = await import('../auth/app');
const { Loadable } = await import('../components/loading/Loadable');
const { LoadingStatus } = await import('../components/loading/LoadingStatus');
const { PLACEHOLDER_AFTER_MS, PLACEHOLDER_HOLD_MS } = await import('../hooks/loading');
const { useView, viewKey } = await import('../hooks/queries');
const { selectCapital } = await import('../hooks/slices');
const { useDraft } = await import('../state/draft');

beforeEach(async () => {
  kept.clear();
  useDraft.setState(useDraft.getInitialState(), true);
  api.rows = structuredClone(rowsOf());
  api.version = 0;
  api.signedIn = true;
  api.seen.length = 0;
  skew = 0;
  account = 'account-a';
  queryClient.clear();
  repo.forget();
  await session.respond({});
});
afterEach(cleanup);

/** The shell's capital figure beside a screen behind the view, as the app mounts them. */
function Capital() {
  return <span data-testid="capital">{useView(selectCapital).total}</span>;
}
function Screens() {
  return (
    <QueryClientProvider client={queryClient}>
      <LoadingStatus />
      <Capital />
      <Loadable placeholder={<div data-placeholder="" aria-busy="true" />}>
        <div data-testid="content" />
      </Loadable>
    </QueryClientProvider>
  );
}

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
const status = () => screen.getByRole('status');

describe('a session that ends under a screen', () => {
  it('leaves no placeholder up when the relay refuses the token a waiting read asked for', async () => {
    // The pair held has gone stale and the relay holds no cookie: the read waits for a refresh, and
    // the answer is that nobody is signed in.
    api.signedIn = false;
    skew = 2 * 3_600_000;
    const { container } = render(<Screens />);

    await waitFor(() => expect(session.status()).toBe('signedOut'));
    await wait(PLACEHOLDER_AFTER_MS + PLACEHOLDER_HOLD_MS + 100);

    expect(container.querySelector('[data-placeholder]')).toBeNull();
    expect(container.querySelector('[aria-busy]')).toBeNull();
    expect(screen.queryByTestId('content')).toBeNull();
    expect(status().textContent).toBe('');
    expect(api.seen.filter((r) => r.path === '/view')).toHaveLength(0);
  });

  it('takes the figures off the screens that show them when the relay has answered a sign-out', async () => {
    render(<Screens />);
    await screen.findByTestId('content');
    const held = Number(screen.getByTestId('capital').textContent);
    expect(held).toBeGreaterThan(0);

    expect(await session.signOut()).not.toBe(false);

    await waitFor(() => expect(screen.queryByTestId('content')).toBeNull());
    expect(Number(screen.getByTestId('capital').textContent)).toBe(0);
    expect(status().textContent).toBe('');
    // The screens asked for nothing more: a caller nobody has signed in sends no data request.
    expect(api.seen.filter((r) => r.path === '/view')).toHaveLength(1);
  });

  it('shows the next account’s figures when another tab’s sign-in replaced the cookie', async () => {
    render(<Screens />);
    await screen.findByTestId('content');
    const held = Number(screen.getByTestId('capital').textContent);

    // Another tab signs in as someone else, whose dataset is another, and the pair this tab holds
    // has gone stale: its next read asks the relay, which answers for them.
    account = 'account-b';
    api.rows = { ...rowsOf(), transactions: rowsOf().transactions.slice(0, 1) };
    api.version = 7;
    skew = 2 * 3_600_000;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: viewKey });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('content')).not.toBeNull();
      const shown = Number(screen.getByTestId('capital').textContent);
      expect(shown).toBeGreaterThan(0);
      expect(shown).not.toBe(held);
    });
    expect(session.accountChanges()).toBe(1);
  });
});
