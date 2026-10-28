// @vitest-environment jsdom
// The super-admin's entry on /settings (`design/extensions/archive-admin.dc.html`, T1): rendered only
// once `GET /me` answers `super_admin`, and while that read is out or after it fails the three cards
// stand alone, nothing in the fourth's place.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');

// `hold` keeps a route's answer back until the test lets it go, and `failing` answers it 500.
let api: FakeApi;
const held = new Map<string, Promise<void>>();
const failing = new Set<string>();
const hit: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/relay/, '');
  hit.push(path);
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

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

beforeEach(async () => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: '2026-07-28' },
  );
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(() => {
  cleanup();
  held.clear();
  failing.clear();
  hit.length = 0;
});

function mount() {
  const router = createMemoryRouter(routes, { initialEntries: ['/settings'] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { main: () => view.container.querySelector('main')?.textContent ?? '' };
}

const s = uk.settings.sections;
const THREE = [s.data, s.automation, s.appearance];
const asked = () => hit.filter((p) => p === '/me').length;

describe('the administration card on /settings', () => {
  it('is the fourth card for the super-admin, once GET /me answers', async () => {
    api.role = 'super_admin';
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(s.admin));
    const at = [...THREE, s.admin].map((label) => page.main().indexOf(label));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(page.main()).toContain(uk.settings.archive.title);
  });

  it('is never there for a plain user', async () => {
    const page = mount();
    await waitFor(() => expect(asked()).toBe(1));
    await waitFor(() => expect(page.main()).toContain(s.appearance));
    expect(page.main()).not.toContain(s.admin);
  });

  it('is not there while GET /me is out, and the three cards are', async () => {
    api.role = 'super_admin';
    const release = hold('/me');
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(s.appearance));
    for (const label of THREE) expect(page.main()).toContain(label);
    expect(page.main()).not.toContain(s.admin);
    await act(async () => release());
    await waitFor(() => expect(page.main()).toContain(s.admin));
  });

  it('is not there after GET /me fails, and the page does not fail with it', async () => {
    api.role = 'super_admin';
    failing.add('/me');
    const page = mount();
    await waitFor(() => expect(asked()).toBe(1));
    await waitFor(() => expect(page.main()).toContain(s.appearance));
    // Long enough for a throw to have replaced the screen.
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    for (const label of THREE) expect(page.main()).toContain(label);
    expect(page.main()).not.toContain(s.admin);
    expect(page.main()).not.toContain(uk.boundary.failed.title);
  });
});
