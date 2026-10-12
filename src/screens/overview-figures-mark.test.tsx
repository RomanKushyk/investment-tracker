// @vitest-environment jsdom
// The mark the figures' paint is read by (*Measurement*): the Element Timing API reports the paint
// of the element carrying `elementtiming`, so the attribute must be on the headline figure once the
// view has answered, and on nothing the loading state draws, whose words and dashes paint earlier
// and would stop the clock at the wrong moment.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { viewBody } from '@quirenote/core/view/serve';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const f = makeFormat('uk');
const o = viewBody({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  userPrices: SEED.prices,
  archiveRows: [],
  paymentDates: [],
  today: TODAY,
  fx: undefined,
}).view.periods.all.overview;

// The API a page is served by: a new one for each test, behind the one `fetch` the page was given,
// whose answer to `GET /view` waits for the test to let it through.
let api: FakeApi;
let gate: Promise<void> | undefined;
const isView = (input: RequestInfo | URL) => String(input).split('?')[0].endsWith('/view');
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  if (isView(input)) await gate;
  return api.fetch(input, init);
});
vi.mock('../components/charts/YieldLines', () => ({ YieldLines: () => null }));

// Set before the route graph loads: the persisted stores read `localStorage` as they load.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// jsdom lays nothing out and answers no media query.
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

// Loaded while the file is collected, so the import counts against no test's timeout.
const { routes } = await import('../routes');

beforeEach(() => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: TODAY },
  );
});
afterEach(() => {
  cleanup();
  gate = undefined;
});

const marked = () => Array.from(document.querySelectorAll('[elementtiming]'));
const placeholderShown = () => document.querySelector('main [aria-busy="true"]') !== null;

function mount(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

describe("the mark of the figures' paint", () => {
  it('is on the capital figure once the view has answered, and on nothing else', async () => {
    const client = mount('/overview');
    await waitFor(() => expect(client.isFetching()).toBe(0));
    await waitFor(() => expect(marked()).toHaveLength(1));

    const [mark] = marked();
    expect(mark.getAttribute('elementtiming')).toBe('figures');
    expect(mark.previousElementSibling?.textContent).toBe(uk.analytics.overview.totalCapital);
    expect(mark.textContent).toBe(f.money(o.total));
  });

  it('is on nothing while the view is out, the loading state drawn or not', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    const client = mount('/overview');

    // Before the placeholder: nothing of the screen is there.
    expect(marked()).toHaveLength(0);
    // After it: the boxes are drawn, holding «—» where the figures will be.
    await waitFor(() => expect(placeholderShown()).toBe(true));
    expect(marked()).toHaveLength(0);

    await act(async () => release());
    await waitFor(() => expect(client.isFetching()).toBe(0));
    // The placeholder is held for a moment once shown; the mark comes with the figures and not before.
    await waitFor(() => expect(marked()).toHaveLength(1), { timeout: 1500 });
    expect(placeholderShown()).toBe(false);
  });

  it.each(['/transactions', '/balances', '/payouts', '/portfolio'])(
    '%s carries none: the headline of /overview is the one',
    async (path) => {
      const client = mount(path);
      await waitFor(() => expect(client.isFetching()).toBe(0));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(marked()).toHaveLength(0);
    },
  );
});
