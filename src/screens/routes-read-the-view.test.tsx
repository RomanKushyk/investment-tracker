// @vitest-environment jsdom
// Every route, rendered cold through the real router, shell, client and transport over a fake of the
// user API, counting the requests the API sees: the view is read once, and a screen or a form reads
// no more than that beyond the wide figures it names (*Cloud target*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inputValue, makeFormat } from '@quirenote/core/money';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { viewBody } from '@quirenote/core/view/serve';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const rowsOfSeed = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
const served = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  userPrices: SEED.prices,
  archiveRows: [],
  paymentDates: [],
  today: TODAY,
  fx: undefined,
});

// The API a page is served by: a new one for each test, behind the one `fetch` the page was given.
let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
// jsdom lays nothing out for a chart, so the curve is told by the date it ends on.
vi.mock('../components/charts/YieldLines', () => ({
  YieldLines: ({ data }: { data: { date: string }[] }) => (
    <div data-testid="curve" data-ends={data.at(-1)?.date} />
  ),
}));

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

// Loaded while the file is collected, as routes.test.ts loads it, so the import counts against no
// test's timeout.
const { routes } = await import('../routes');
const { useDraft } = await import('../state/draft');
const { VIEW_STALE_MS } = await import('../hooks/queries');

beforeEach(() => {
  api = fakeApi(rowsOfSeed(), { today: TODAY });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // A test that opens the quotes form on a past day leaves the draft on that day.
  useDraft.setState(useDraft.getInitialState(), true);
});

async function open(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await settle(client);
  return { client, view, router };
}

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  // A read that follows from another's answer starts a tick after it.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

/** What the API was asked, by route: the data routes only, the relay's refresh being the session's. */
const asked = () => {
  const count = (route: string) => api.seen.filter((r) => r.path.split('?')[0] === route).length;
  return {
    view: count('/view'),
    series: count('/view/series'),
    balances: count('/view/balances'),
    day: count('/view/day'),
    total: api.seen.length,
  };
};

// The wide figures are reads of their own: the curve by period, the table by page.
const READS: [string, { series: number; balances: number }][] = [
  ['/', { series: 0, balances: 0 }],
  ['/transactions', { series: 0, balances: 0 }],
  ['/overview', { series: 0, balances: 0 }],
  ['/balances', { series: 0, balances: 1 }],
  ['/payouts', { series: 0, balances: 0 }],
  ['/yield', { series: 1, balances: 0 }],
  ['/attributes', { series: 0, balances: 0 }],
  ['/seasonality', { series: 0, balances: 0 }],
  ['/portfolio', { series: 0, balances: 0 }],
  ['/allocation', { series: 0, balances: 0 }],
  ['/settings', { series: 0, balances: 0 }],
];

describe('a cold render', () => {
  it.each(READS)('%s sends one data request, and the wide figure it names', async (path, wide) => {
    await open(path);
    // Today's quotes ride the view, so no route asks for a day, and none of them writes.
    expect(asked()).toEqual({
      view: 1,
      series: wide.series,
      balances: wide.balances,
      day: 0,
      total: 1 + wide.series + wide.balances,
    });
  });

  it('shows the figures of the view it read', async () => {
    await open('/payouts');
    const { income } = viewBody(served()).view.payouts;
    expect(document.body.textContent).toContain(makeFormat('uk').money(income.total));
  });
});

describe('moving between screens', () => {
  it('sends nothing more, and a screen’s own wide figure when it is opened', async () => {
    const { client, router } = await open('/overview');
    expect(asked().total).toBe(1);
    for (const path of ['/payouts', '/yield', '/balances', '/portfolio', '/']) {
      await act(async () => {
        await router.navigate(path);
      });
      await settle(client);
    }
    expect(asked()).toEqual({ view: 1, series: 1, balances: 1, day: 0, total: 3 });
  });

  it('sends nothing for any screen that has no wide figure of its own', async () => {
    const { client, router } = await open('/overview');
    for (const path of [
      '/transactions',
      '/payouts',
      '/attributes',
      '/seasonality',
      '/portfolio',
      '/allocation',
      '/settings',
      '/',
    ]) {
      await act(async () => {
        await router.navigate(path);
      });
      await settle(client);
    }
    expect(asked().total).toBe(1);
  });
});

describe('a form', () => {
  it('the asset dialogs send nothing: opening the form and the delete dialog', async () => {
    await open('/portfolio');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.add }));
    await screen.findByRole('dialog');
    expect(asked().total).toBe(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const reit = SEED.assets[0];
    const counts = viewBodyCounts(reit.id);
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.deleteAria(reit.name) }));
    const dialog = await screen.findByRole('alertdialog');
    // The delete dialog names what the delete takes, as the view counted it.
    expect(dialog.textContent).toContain(
      uk.assets.deleteBody(counts.transactions, counts.quoteDays),
    );
    expect(asked().total).toBe(1);
  });

  it('the quotes form reads one day when it is opened on a past date', async () => {
    const past = '2026-07-20';
    useDraft.setState({ date: past, quotes: {}, origins: {} });
    await open('/');
    expect(asked()).toMatchObject({ view: 1, day: 1, total: 2 });
    expect(api.seen.at(-1)?.path).toBe(`/view/day?date=${past}`);
    // The form is filled with what was recorded that day, not with today's.
    await waitFor(() => expect(Object.keys(useDraft.getState().quotes).length).toBeGreaterThan(0));
    for (const [id, quote] of Object.entries(recordedOn(past))) {
      expect(useDraft.getState().quotes[id]).toBe(inputValue(quote, 2));
    }
  });
});

function viewBodyCounts(id: string) {
  return viewBody(served()).deleteCounts[id];
}
function recordedOn(date: string) {
  const day = api.seen.find((r) => r.path === `/view/day?date=${date}`);
  expect(day).toBeDefined();
  return viewBody({ ...served(), today: date }).today.quotes;
}

describe('a page shown again', () => {
  const showAgain = async (client: QueryClient) => {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await settle(client);
  };

  it('sends nothing while what it holds is fresh', async () => {
    const { client } = await open('/yield');
    const before = asked().total;

    await showAgain(client);

    expect(asked().total).toBe(before);
  });

  it('revalidates what is on show once it has gone stale, with the tag it holds, and gets 304s', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const { client } = await open('/yield');
    expect(api.seen.every((r) => r.headers['if-none-match'] === undefined)).toBe(true);
    const before = asked().total;

    vi.setSystemTime(Date.now() + VIEW_STALE_MS + 1_000);
    await showAgain(client);

    // The view and the curve on show, each once more, each under its validator and unchanged.
    expect(asked().total).toBe(before + 2);
    const again = api.seen.slice(before);
    expect(again.map((r) => r.path.split('?')[0]).sort()).toEqual(['/view', '/view/series']);
    expect(again.every((r) => r.headers['if-none-match']?.startsWith('W/'))).toBe(true);
    expect(api.notModified).toBe(2);
  });

  it('shows the rows another tab wrote, once the view has gone stale and is shown again', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const { client } = await open('/payouts');
    const before = viewBody(served()).view.payouts.income.total;
    expect(document.body.textContent).toContain(makeFormat('uk').money(before));

    // Another tab recorded a payout: the dataset is at another version, and the figure moves.
    api.rows.transactions.push({
      id: '5eed0000-0000-4000-8000-0000000000ff',
      date: TODAY,
      type: 'interest_payout',
      assetId: SEED.assets[2].id,
      amount: 1_000,
    });
    api.version += 1;
    vi.setSystemTime(Date.now() + VIEW_STALE_MS + 1_000);
    await showAgain(client);

    const after = viewBody({ ...served(), transactions: api.rows.transactions }).view.payouts.income
      .total;
    expect(after).not.toBe(before);
    await waitFor(() => expect(document.body.textContent).toContain(makeFormat('uk').money(after)));
  });
});
