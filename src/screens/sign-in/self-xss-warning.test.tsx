// @vitest-environment jsdom
// The console's self-XSS warning (*Auth model*). Each test is one page load: a fresh module graph
// behind the real routes.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, type FakeApi } from '../../__fixtures__/fake-api';
import { en, uk } from '../../i18n/messages';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../../components/charts/YieldLines', () => ({ YieldLines: () => null }));

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
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

const log = vi.spyOn(console, 'log').mockImplementation(() => {});

beforeEach(() => {
  api = fakeApi({}, { today: '2026-10-19' });
  kept.clear();
  log.mockClear();
  vi.resetModules();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

/** A page load: a new module graph in `build`'s mode and `language`, opened at `path`. */
async function load(path: string, { prod = true, language = 'uk' as 'uk' | 'en' } = {}) {
  vi.stubEnv('PROD', prod);
  vi.stubEnv('DEV', !prod);
  // jsdom applies no stylesheet, so the theme's tokens are set where the warning reads them.
  document.documentElement.style.setProperty('--color-neg-tint', '#eddfd8');
  document.documentElement.style.setProperty('--color-neg-tint-text', '#a03c30');
  const { useSettings } = await import('../../state/settings');
  useSettings.setState({ language });
  const { routes } = await import('../../routes');
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return router;
}

/** The two lines the warning is: the styled headline, then every sentence in plain text. */
function warning(t: typeof en) {
  return [
    [
      '%c' + t.auth.selfXss.headline,
      expect.stringContaining('background: #eddfd8; color: #a03c30;'),
    ],
    [t.auth.selfXss.body],
  ];
}

// A cold module graph per test: the first import alone can outlast the default.
describe('the self-XSS warning', { timeout: 30_000 }, () => {
  it.each(['/sign-in', '/apply', '/auth/callback?code=x&state=y'])(
    'a production build says it once on %s, in Ukrainian',
    async (path) => {
      api.signedIn = false;
      await load(path);
      expect(log.mock.calls).toEqual(warning(uk));
    },
  );

  it('in English when the page is', async () => {
    api.signedIn = false;
    await load('/sign-in', { language: 'en' });
    expect(log.mock.calls).toEqual(warning(en));
  });

  it('once per load, though a second auth page shows', async () => {
    api.signedIn = false;
    const router = await load('/sign-in');
    await act(() => router.navigate('/apply'));
    await act(() => router.navigate('/sign-in'));
    expect(log.mock.calls).toEqual(warning(uk));
  });

  it('says nothing on another route', async () => {
    const router = await load('/');
    expect(router.state.location.pathname).toBe('/');
    expect(log).not.toHaveBeenCalled();
  });

  it('says nothing to a signed-in visitor sent on from /sign-in, who sees no card', async () => {
    const router = await load('/');
    await act(() => router.navigate('/sign-in'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    expect(log).not.toHaveBeenCalled();
  });

  it('says nothing in a development build', async () => {
    api.signedIn = false;
    await load('/sign-in', { prod: false });
    expect(log).not.toHaveBeenCalled();
  });
});
