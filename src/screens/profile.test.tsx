// @vitest-environment jsdom
// The profile, rendered through the real router, shell, client and relay over a fake of the user API
// and the relay's passkey list (`design/extensions/own-account.dc.html`, T1–T3 and T6).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const rowsOfSeed = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});

// The API a page is served by, behind the one `fetch` the page was given; `hold` keeps a route's
// answer back until the test lets it go, and `fail` answers it 500.
let api: FakeApi;
const held = new Map<string, Promise<void>>();
const failing = new Set<string>();
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/relay/, '');
  await held.get(path);
  if (failing.has(path)) {
    return new Response('{"error":"internal"}', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  return api.fetch(input, init);
});
function hold(path: string): () => void {
  let release!: () => void;
  held.set(path, new Promise<void>((r) => (release = r)));
  return () => {
    held.delete(path);
    release();
  };
}

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('min-width'),
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);
afterAll(() => vi.unstubAllGlobals());

// Whether Google sign-in is on, as a refresh would have said: the first refresh settles it for the
// page's life, so a test sets it here.
const google = vi.hoisted(() => ({ on: false }));
vi.mock('../auth/app', async (original) => ({
  ...(await original<typeof import('../auth/app')>()),
  useGoogle: () => google.on,
}));

const writeText = vi.fn<(text: string) => Promise<void>>();
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

beforeEach(async () => {
  api = fakeApi(rowsOfSeed(), { today: TODAY });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  google.on = false;
  writeText.mockReset().mockResolvedValue(undefined);
  await session.respond({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  held.clear();
  failing.clear();
});

async function open(path = '/profile') {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await settle(client);
  return { client, view, router, main: () => view.container.querySelector('main')! };
}

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = (el: Element) => el.textContent ?? '';
const p = uk.profile;

describe('the page', () => {
  it('shows the account, the data and the sign-in, in that order', async () => {
    const { main } = await open();
    const page = text(main());
    const at = [p.sections.account, p.sections.data, p.sections.signIn].map((l) => page.indexOf(l));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(page).toContain(ME_EMAIL);
    expect(page).toContain(ME_USER_ID);
    expect(page).toContain('28.07.2026');
    expect(page).toContain(String(SEED.assets.length));
    expect(page).toContain(String(SEED.transactions.length));
  });

  // The owner's rulings: every account holds a password while registration is closed, so the row
  // would have no varying source; a role is shown where it names a privilege.
  it('has no password row, and no role row for a plain user', async () => {
    const page = text((await open()).main());
    expect(page).not.toContain(p.role);
    expect(page).not.toContain('Пароль');
  });

  it('names the super-admin’s role', async () => {
    api.role = 'super_admin';
    const page = text((await open()).main());
    expect(page).toContain(p.role);
    expect(page).toContain(p.superAdmin);
  });

  it('shows the Google row only while Google sign-in is on', async () => {
    expect(text((await open()).main())).not.toContain(p.google);
    cleanup();
    google.on = true;
    api.googleLinked = true;
    const page = text((await open()).main());
    expect(page).toContain(p.google);
    expect(page).toContain(p.linked);
  });

  it('reads an empty dataset as 0, 0 and «—»', async () => {
    api.rows = { assets: [], transactions: [], prices: [] };
    const { main } = await open();
    const values = [...main().querySelectorAll('[data-fact]')].map((f) => [
      f.getAttribute('data-fact'),
      text(f.querySelector('dd')!),
    ]);
    expect(values).toEqual(
      expect.arrayContaining([
        ['assets', '0'],
        ['transactions', '0'],
        ['firstActivity', '—'],
      ]),
    );
  });

  it('leads to Settings by a link', async () => {
    const { main } = await open();
    const link = [...main().querySelectorAll('a')].find((a) => text(a) === p.copyData.open);
    expect(link?.getAttribute('href')).toBe('/settings');
  });
});

describe('the passkeys', () => {
  it('shows one card each, an empty name as «Ключ доступу», and the day it was made', async () => {
    api.passkeys = [
      { name: 'Roaming passkey', createdAt: '2026-10-22' },
      { name: '', createdAt: '2026-10-23' },
    ];
    const { main } = await open();
    const cards = [...main().querySelectorAll('[data-passkey]')].map(text);
    expect(cards).toEqual([
      `Roaming passkey${p.passkeys.created('22.10.2026')}`,
      `${p.passkeys.unnamed}${p.passkeys.created('23.10.2026')}`,
    ]);
  });

  it.each([
    ['none', [] as const, p.passkeys.none],
    ['a Google session', 'google' as const, p.passkeys.google],
    ['a failed read', 'failed' as const, p.passkeys.failed],
  ])('says so for %s, in a line that is announced', async (_, answer, note) => {
    api.passkeys = answer === 'google' || answer === 'failed' ? answer : [];
    const { main } = await open();
    const line = [...main().querySelectorAll('[role="status"]')].find((s) => text(s) === note);
    expect(line, `no status line reads ${note}`).toBeDefined();
    expect(main().querySelectorAll('[data-passkey]')).toHaveLength(0);
  });

  it('holds three rows while the list is out, and announces what lands', async () => {
    const release = hold('/auth/passkey/list');
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
    // Laid out unseen at first, as a read that answers soon shows nothing, then shown.
    const blocks = () => [...main().querySelectorAll('[data-placeholder="passkey"]')];
    expect(blocks()).toHaveLength(3);
    expect(blocks().every((b) => b.closest('.invisible') !== null)).toBe(true);
    await wait(400);
    expect(blocks().every((b) => b.closest('.invisible') === null)).toBe(true);
    const status = main().querySelector('[data-passkeys-note]');
    expect(status?.getAttribute('role')).toBe('status');
    release();
    await waitFor(() => expect(text(status!)).toBe(p.passkeys.none));
    expect(main().querySelectorAll('[data-placeholder="passkey"]')).toHaveLength(0);
  });

  // The account first: a list shown under an account still on its way moves the page as it lands.
  it('stays held until the account lands, whatever the list answered', async () => {
    api.passkeys = [{ name: 'Roaming passkey', createdAt: '2026-10-22' }];
    const release = hold('/me');
    const client = new QueryClient();
    const router = createMemoryRouter(routes, { initialEntries: ['/profile'] });
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.passkeyLists).toBe(1));
    await wait(400);
    const main = view.container.querySelector('main')!;
    expect(main.querySelectorAll('[data-placeholder="passkey"]')).toHaveLength(3);
    expect(main.querySelectorAll('[data-passkey]')).toHaveLength(0);
    release();
    await waitFor(() => expect(main.querySelectorAll('[data-passkey]')).toHaveLength(1));
  });

  // The list changes only from another device's sign-in, which this tab cannot learn of.
  it('is read again on every visit', async () => {
    const { router, client } = await open();
    expect(api.passkeyLists).toBe(1);
    await act(() => router.navigate('/settings'));
    await act(() => router.navigate('/profile'));
    await settle(client);
    expect(api.passkeyLists).toBe(2);
  });
});

describe('the account read', () => {
  it('shows nothing new for 300 ms, then holds every value and every control', async () => {
    const release = hold('/me');
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await wait(100);
    expect(text(main())).toBe('');
    await wait(300);
    expect(text(main())).toContain(p.sections.account);
    expect(main().querySelectorAll('[data-dash]').length).toBeGreaterThan(0);
    expect(text(main())).not.toContain(ME_EMAIL);
    expect(main().querySelectorAll('a, button')).toHaveLength(0);
    release();
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
  });

  // Once shown, the boxes stay their own while at least, so their fade-in always completes.
  it('keeps the held boxes for a while once shown, even when the read lands at once', async () => {
    const release = hold('/me');
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await wait(350);
    expect(main().querySelectorAll('[data-dash]').length).toBeGreaterThan(0);
    release();
    await wait(100);
    expect(text(main())).not.toContain(ME_EMAIL);
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
  });

  it('that fails shows the failed-screen state inside the shell', async () => {
    failing.add('/me');
    const { main, view } = await open();
    expect(text(main())).toContain(uk.boundary.failed.title);
    // The shell stands: the sidebar is still there around it.
    expect(view.container.querySelector('#app-sidebar')).not.toBeNull();
  });

  it('is not made, and nothing shows, when nobody is signed in', async () => {
    await session.signOut();
    const { main } = await open();
    expect(text(main())).toBe('');
    expect(api.seen.filter((r) => r.path === '/me')).toHaveLength(0);
    expect(api.passkeyLists).toBe(0);
  });
});

describe('copying the account ID', () => {
  const copyButton = (main: Element) =>
    [...main.querySelectorAll('button')].find((b) => text(b).includes(p.copy))!;

  it('writes it, reads «Скопійовано» for 2 s once written, and announces it', async () => {
    const { main } = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const button = copyButton(main());
    await act(async () => void fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith(ME_USER_ID);
    expect(text(button)).toBe(p.copied);
    const status = main().querySelector('[data-copy-status]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(text(status)).toBe(p.copiedStatus);
    act(() => void vi.advanceTimersByTime(1999));
    expect(text(button)).toBe(p.copied);
    act(() => void vi.advanceTimersByTime(1));
    expect(text(button)).toBe(p.copy);
    expect(text(status)).toBe('');
  });

  // Primer's copy pattern: never a silent failure, and the value left selected to copy by hand.
  it('that the browser refuses says so for 2 s, announced, with the ID selected', async () => {
    writeText.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const { main } = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const button = copyButton(main());
    await act(async () => void fireEvent.click(button));
    expect(text(button)).toBe(p.copyFailed);
    expect(text(main().querySelector('[data-copy-status]')!)).toBe(p.copyFailedStatus);
    expect(document.getSelection()?.toString()).toBe(ME_USER_ID);
    act(() => void vi.advanceTimersByTime(2000));
    expect(text(button)).toBe(p.copy);
  });
});
