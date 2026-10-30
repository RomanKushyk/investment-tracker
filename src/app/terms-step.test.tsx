// @vitest-environment jsdom
// The terms step through the real router, transport and shells: an account whose row holds no terms
// version meets it in place of the portfolio, and pressing «Прийняти умови» opens the portfolio
// with no second sign-in (`design/extensions/terms-acceptance-step.dc.html`).
import { TERMS_VERSION } from '@quirenote/core/terms';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const { session, showAnswer } = await import('../auth/app');
const { queryClient } = await import('../lib/api');

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  api.termsAccepted = false;
  await session.respond({});
});
afterEach(() => {
  cleanup();
  showAnswer(undefined);
  queryClient.clear();
  vi.restoreAllMocks();
});

/** Mounted on the app's own query client, as `main.tsx` mounts it. */
async function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={queryClient as QueryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByText(uk.auth.terms.title)).not.toBeNull());
  return { page: view.container, router };
}

const requests = () => api.seen.map((r) => `${r.method} ${r.path.split('?')[0]}`);

describe('an account with no recorded terms version', () => {
  it('meets the step in place of the portfolio, and no app shell mounts behind it', async () => {
    const { page } = await open('/overview');
    expect(page.querySelector('#app-sidebar')).toBeNull();
    expect(screen.getByText(uk.auth.signedInAs(ME_EMAIL))).toBeTruthy();
    expect(requests()).toContain('GET /view');
  });

  it('opens the portfolio once it accepts, with no second sign-in', async () => {
    const { page, router } = await open('/overview');
    const respond = vi.spyOn(session, 'respond');
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: uk.terms.step.submit })),
    );
    await waitFor(() => expect(page.querySelector('#app-sidebar')).not.toBeNull());
    expect(screen.queryByText(uk.auth.terms.title)).toBeNull();
    expect(router.state.location.pathname).toBe('/overview');
    expect(api.termsAccepted).toBe(true);
    const posted = api.seen.find((r) => r.method === 'POST' && r.path === '/me/terms');
    expect(JSON.parse(posted!.body)).toEqual({ termsVersion: TERMS_VERSION });
    // The view is read again after the write, and this time it is served.
    await waitFor(() =>
      expect(requests().slice(requests().indexOf('POST /me/terms') + 1)).toContain('GET /view'),
    );
    expect(respond).not.toHaveBeenCalled();
    expect(session.status()).toBe('signedIn');
  });

  it('signs out and lands on /sign-in when it declines', async () => {
    const { router } = await open('/overview');
    await act(
      async () => void fireEvent.click(screen.getByRole('button', { name: uk.terms.step.decline })),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(session.status()).toBe('signedOut');
    expect(api.termsAccepted).toBe(false);
    expect(screen.queryByText(uk.auth.terms.title)).toBeNull();
  });
});
