// @vitest-environment jsdom
// The 30-day window's gate through the real router, transport and shells: an account a deletion
// holds meets it in place of the portfolio, and «Скасувати видалення» opens the portfolio again
// with no second sign-in (`design/extensions/account-deletion.dc.html` T6, T7, T10).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { toast } from 'sonner';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

let api: FakeApi;
// `hold` keeps a route's answer back until the test lets it go.
const held = new Map<string, Promise<void>>();
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  await held.get(new URL(String(input), 'http://localhost').pathname.replace(/^\/relay/, ''));
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

// The copy character for character (T10).
const G = {
  title: 'Обліковий запис буде видалено',
  lead: 'Видалення відбудеться після 29.11.2026. Щоб і далі користуватися Quirenote, скасуйте його.',
  cancel: 'Скасувати видалення',
  busy: 'Скасовуємо…',
  failed: 'Не вдалося скасувати видалення. Спробуйте ще раз.',
  cancelled: 'Видалення скасовано',
  landing:
    'Обліковий запис буде видалено після 29.11.2026. Щоб скасувати, увійдіть до кінця цього дня й натисніть «Скасувати видалення».',
};

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  api.hold = { date: '2026-11-29', cancellable: true };
  await session.respond({});
});
afterEach(() => {
  cleanup();
  held.clear();
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
  await waitFor(() => expect(screen.queryByText(G.title)).not.toBeNull());
  return { page: view.container, router };
}

const requests = () => api.seen.map((r) => `${r.method} ${r.path.split('?')[0]}`);
const button = (name: string) => screen.queryByRole<HTMLButtonElement>('button', { name });
const press = (name: string) => act(async () => void fireEvent.click(button(name)!));

describe('an account a deletion holds', () => {
  it('meets the gate in place of the portfolio, the day it ends in its lead', async () => {
    const { page } = await open('/overview');
    expect(page.querySelector('#app-sidebar')).toBeNull();
    expect(screen.getByText(G.lead)).toBeTruthy();
    expect(screen.getByText(uk.auth.signedInAs(ME_EMAIL))).toBeTruthy();
    expect(page.querySelector('svg.lucide-calendar-clock')).not.toBeNull();
    // The drawn order: the cancel filled, then «Вийти» (T6).
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      G.cancel,
      uk.auth.signOut,
    ]);
  });

  it('opens the portfolio once it cancels, said once, with no second sign-in', async () => {
    const success = vi.spyOn(toast, 'success');
    const respond = vi.spyOn(session, 'respond');
    const { page, router } = await open('/overview');
    const release = hold('/me/deletion');
    await press(G.cancel);
    expect(button(G.busy)?.disabled, '«Скасовуємо…» is not busy').toBe(true);
    release();
    await waitFor(() => expect(page.querySelector('#app-sidebar')).not.toBeNull());
    expect(screen.queryByText(G.title)).toBeNull();
    expect(router.state.location.pathname).toBe('/overview');
    expect(api.hold).toBeUndefined();
    // The view is read again after the cancel, and this time it is served.
    await waitFor(() =>
      expect(requests().slice(requests().indexOf('DELETE /me/deletion') + 1)).toContain(
        'GET /view',
      ),
    );
    expect(success).toHaveBeenCalledExactlyOnceWith(G.cancelled);
    expect(respond).not.toHaveBeenCalled();
    expect(session.status()).toBe('signedIn');
  });

  it('says a cancel that failed under its buttons, which stay', async () => {
    api.cancels = ['failed'];
    const { router } = await open('/overview');
    await press(G.cancel);
    await waitFor(() => expect(screen.queryByRole('alert')?.textContent).toBe(G.failed));
    expect(button(G.cancel)?.disabled).toBe(false);
    expect(api.hold).toBeDefined();
    expect(router.state.location.pathname).toBe('/overview');
  });

  // A tab whose sign-in came before the request is offered no cancel the API would refuse: it is
  // signed out to the scheduled landing (#572's amendments 3 and 4).
  it('signs out to the scheduled landing when this sign-in may not cancel', async () => {
    api.hold = { date: '2026-11-29', cancellable: false };
    // The sign-out held back, so the gate is read while it still stands.
    const release = hold('/auth/sign-out');
    const { router } = await open('/overview');
    expect(button(G.cancel)).toBeNull();
    release();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await waitFor(() => expect(screen.queryByText(G.landing)).not.toBeNull());
    expect(session.status()).toBe('signedOut');
    expect(requests()).not.toContain('DELETE /me/deletion');
  });

  it('signs out to the plain landing on «Вийти»', async () => {
    const { router } = await open('/overview');
    await press(uk.auth.signOut);
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await waitFor(() => expect(screen.queryByText(uk.auth.signedOut)).not.toBeNull());
    expect(session.status()).toBe('signedOut');
    expect(api.hold).toBeDefined();
  });
});
