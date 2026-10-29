// @vitest-environment jsdom
// `/privacy` as the page a tab loads first: the session is not known until the page asks the relay,
// and a language chosen here is the account's once it says who is signed in. Its own file, because
// the session is the module's and only a fresh one has not been asked yet.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, expect, it, vi } from 'vitest';

import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
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
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

it('asks the relay who is signed in, and sends a language chosen here to the account', async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  expect(session.status()).toBe('unknown');
  const router = createMemoryRouter(routes, { initialEntries: ['/privacy'] });
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(session.status()).toBe('signedIn'));
  const english = [...container.ownerDocument.querySelectorAll('[role="radio"]')].find(
    (radio) => radio.textContent === uk.settings.language.en,
  );
  await act(async () => void fireEvent.click(english!));
  await new Promise((resolve) => setTimeout(resolve, 700));
  const sent = api.seen.filter((r) => r.method === 'PATCH' && r.path === '/me/settings');
  expect(sent.map((r) => JSON.parse(r.body) as unknown)).toEqual([{ language: 'en' }]);
});
