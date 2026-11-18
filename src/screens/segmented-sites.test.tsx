// @vitest-environment jsdom
// Every segmented set on the one control is a radiogroup (controls.md § Signed, D2), and none
// is an `aria-pressed` toggle — through the real router and shells over a fake of the user API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../__fixtures__/router';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('scrollTo', () => {});
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
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(cleanup);

async function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return view.container;
}

/** The named radiogroup, its radios' labels, and that nothing in it is a pressed toggle. */
async function group(root: HTMLElement, name: string) {
  const found = await waitFor(() => within(root).getByRole('radiogroup', { name }));
  expect(found.querySelector('[aria-pressed]')).toBeNull();
  expect(found.hasAttribute('data-filled-track')).toBe(false);
  return within(found)
    .getAllByRole('radio')
    .map((r) => r.textContent);
}

describe('each segmented set is a radiogroup', () => {
  it('Settings: theme, language and currency', async () => {
    const page = await open('/settings');
    const s = uk.settings;
    expect(await group(page, s.theme.ariaLabel)).toEqual([
      s.theme.light,
      s.theme.dark,
      s.theme.system,
    ]);
    expect(await group(page, s.language.ariaLabel)).toEqual([s.language.uk, s.language.en]);
    expect(await group(page, s.currency.title)).toEqual(['₴ UAH', '$ USD']);
    expect(page.querySelector('main [aria-pressed]')).toBeNull();
  });

  it('the signed-out bar: language', async () => {
    await session.signOut();
    const page = await open('/sign-in');
    expect(await group(page, uk.settings.language.ariaLabel)).toEqual([
      uk.settings.language.uk,
      uk.settings.language.en,
    ]);
  });

  it('Repairs: «Джерело»', async () => {
    api.role = 'super_admin';
    const page = await open('/admin/archive');
    const radios = await group(page, uk.archive.repairs.observe.source);
    expect(radios.length).toBe(2);
  });

  it('Seasonality: the axis', async () => {
    const page = await open('/seasonality');
    const a = uk.analytics.seasonality;
    expect(await group(page, a.axisAriaLabel)).toEqual([a.axisByDay, a.axisByMonth]);
    expect(page.querySelector('main [aria-pressed]')).toBeNull();
  });
});
