// @vitest-environment jsdom
// Every route, rendered cold through the real router and shell: the view is read once, and a
// screen or a form reads no more than that beyond the wide figures it names (*Cloud target*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inputValue, makeFormat } from '@quirenote/core/money';
import type { Snapshot } from '@quirenote/core/types';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { uk } from '../i18n/messages';
import {
  balancesOf,
  dayOf,
  readBalances,
  readDay,
  readSeries,
  readView,
  seriesOf,
  viewOf,
} from '../lib/local-view';

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
const TABLES = { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions };
const TODAY = seed.today;

vi.mock('../lib/local-view', async (importActual) => {
  const actual = await importActual<typeof import('../lib/local-view')>();
  // Read when called, not when the factory runs: the seed is imported after the mock is hoisted.
  const tables = () => {
    const seeded = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
    return {
      tables: {
        assets: seeded.assets,
        snapshots: seeded.snapshots,
        transactions: seeded.transactions,
      },
      today: seeded.today,
    };
  };
  return {
    ...actual,
    readView: vi.fn(async () => actual.viewOf(tables().tables, tables().today)),
    readSeries: vi.fn(async (period) => actual.seriesOf(tables().tables, period, tables().today)),
    readBalances: vi.fn(async (page) => actual.balancesOf(tables().tables, page, tables().today)),
    readDay: vi.fn(async (date) => actual.dayOf(tables().tables, date)),
  };
});
// jsdom lays nothing out for a chart, so the curve is told by the date it ends on.
vi.mock('../components/charts/YieldLines', () => ({
  YieldLines: ({ data }: { data: { date: string }[] }) => (
    <div data-testid="curve" data-ends={data.at(-1)?.date} />
  ),
}));
// Nothing here opens a database: the meta keys the Inzhur and NBU hooks read answer empty.
vi.mock('../lib/repository', () => ({
  repo: {
    getMeta: async () => undefined,
    setMeta: async () => undefined,
    exportAll: async () => ({ assets: [], snapshots: [], transactions: [] }),
  },
  openStore: async () => undefined,
  dbVersion: 1,
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

beforeEach(() => {
  vi.mocked(readView).mockClear();
  vi.mocked(readSeries).mockClear();
  vi.mocked(readBalances).mockClear();
  vi.mocked(readDay).mockClear();
});
afterEach(() => {
  cleanup();
  // A test that opens the quotes form on a past day leaves the draft on that day.
  useDraft.setState(useDraft.getInitialState(), true);
});

async function open(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  it.each(READS)('%s reads the view once', async (path, wide) => {
    await open(path);
    expect(readView).toHaveBeenCalledTimes(1);
    expect(readSeries).toHaveBeenCalledTimes(wide.series);
    expect(readBalances).toHaveBeenCalledTimes(wide.balances);
    // Today's quotes ride the view, so no route asks for a day.
    expect(readDay).not.toHaveBeenCalled();
  });

  it('shows the figures of the view it read', async () => {
    await open('/payouts');
    const { income } = viewOf(TABLES, TODAY).view.payouts;
    expect(document.body.textContent).toContain(makeFormat('uk').money(income.total));
  });
});

describe('moving between screens', () => {
  it('reads the view no more, and reads a screen’s own wide figure when it is opened', async () => {
    const { client, router } = await open('/overview');
    expect(readView).toHaveBeenCalledTimes(1);
    for (const path of ['/payouts', '/yield', '/balances', '/portfolio', '/']) {
      await act(async () => {
        await router.navigate(path);
      });
      await settle(client);
    }
    expect(readView).toHaveBeenCalledTimes(1);
    expect(readSeries).toHaveBeenCalledTimes(1);
    expect(readBalances).toHaveBeenCalledTimes(1);
    expect(readDay).not.toHaveBeenCalled();
  });
});

describe('a form', () => {
  it('the asset dialogs read nothing more: opening the form and the delete dialog', async () => {
    await open('/portfolio');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.add }));
    await screen.findByRole('dialog');
    expect(readView).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const reit = TABLES.assets[0];
    const counts = viewOf(TABLES, TODAY).deleteCounts[reit.id];
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.deleteAria(reit.name) }));
    const dialog = await screen.findByRole('alertdialog');
    // The delete dialog names what the delete takes, as the view counted it.
    expect(dialog.textContent).toContain(
      uk.assets.deleteBody(counts.transactions, counts.quoteDays),
    );
    expect(readView).toHaveBeenCalledTimes(1);
    expect(readDay).not.toHaveBeenCalled();
  });

  it('the quotes form reads one day when it is opened on a past date', async () => {
    const past = '2026-07-20';
    useDraft.setState({ date: past, quotes: {}, origins: {} });
    await open('/');
    expect(readView).toHaveBeenCalledTimes(1);
    expect(readDay).toHaveBeenCalledTimes(1);
    expect(readDay).toHaveBeenCalledWith(past);
    // The form is filled with what was recorded that day, not with today's.
    const day = await readDayOf(past);
    expect(Object.keys(day.quotes).length).toBeGreaterThan(0);
    for (const [id, quote] of Object.entries(day.quotes)) {
      expect(useDraft.getState().quotes[id]).toBe(inputValue(quote, 2));
    }
  });
});

describe('a page shown again after another tab wrote', () => {
  // A row written in one tab is announced to no other, so the page being shown again is the only
  // thing that tells this tab. It reaches a read the screen on show holds and one it left cached.
  const written: Snapshot = { date: '2026-07-28', quotes: { reit: 75000 } };
  const WRITTEN = { ...TABLES, snapshots: [...TABLES.snapshots, written] };

  async function visit(
    router: Awaited<ReturnType<typeof open>>['router'],
    client: QueryClient,
    path: string,
  ) {
    await act(async () => {
      await router.navigate(path);
    });
    await settle(client);
  }
  async function showAgain(client: QueryClient) {
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    });
    await settle(client);
  }
  const curveEnds = () => screen.getByTestId('curve').getAttribute('data-ends');

  it('reads again the curve /yield left cached, when it is opened', async () => {
    const { client, router } = await open('/yield');
    expect(curveEnds()).toBe(seriesOf(TABLES, 'all', TODAY).series.at(-1)?.date);
    expect(curveEnds()).not.toBe(written.date);
    await visit(router, client, '/portfolio');

    vi.mocked(readSeries).mockImplementationOnce(async (period) =>
      seriesOf(WRITTEN, period, TODAY),
    );
    await showAgain(client);
    await visit(router, client, '/yield');

    expect(readSeries).toHaveBeenCalledTimes(2);
    expect(curveEnds()).toBe(written.date);
  });

  it('reads again the page /balances left cached, when it is opened', async () => {
    const { client, router } = await open('/balances');
    await visit(router, client, '/portfolio');

    vi.mocked(readBalances).mockImplementationOnce(async (page) =>
      balancesOf(WRITTEN, page, TODAY),
    );
    await showAgain(client);
    await visit(router, client, '/balances');

    expect(readBalances).toHaveBeenCalledTimes(2);
    const since = makeFormat('uk').date(viewOf(TABLES, TODAY).view.balances.earliest!);
    expect(document.body.textContent).toContain(
      uk.analytics.prose.showingSnapshots(6, WRITTEN.snapshots.length, since),
    );
  });

  it('reads again the day the quotes form left cached, and fills the form with it', async () => {
    const past = '2026-07-20';
    useDraft.setState({ date: past, quotes: {}, origins: {} });
    // The day as this tab first read it: nothing recorded yet.
    const unrecorded = { ...TABLES, snapshots: TABLES.snapshots.filter((s) => s.date !== past) };
    vi.mocked(readDay).mockImplementationOnce(async (date) => dayOf(unrecorded, date));
    const { client, router } = await open('/');
    expect(readDay).toHaveBeenCalledTimes(1);
    expect(useDraft.getState().quotes).toEqual({});
    await visit(router, client, '/portfolio');

    await showAgain(client);
    await visit(router, client, '/');

    expect(readDay).toHaveBeenCalledTimes(2);
    const recorded = dayOf(TABLES, past).quotes;
    await waitFor(() => expect(Object.keys(useDraft.getState().quotes).length).toBeGreaterThan(0));
    for (const [id, quote] of Object.entries(recorded)) {
      expect(useDraft.getState().quotes[id]).toBe(inputValue(quote, 2));
    }
  });

  it('reads what is on show once more, not twice', async () => {
    const { client } = await open('/yield');
    await showAgain(client);
    expect(readView).toHaveBeenCalledTimes(2);
    expect(readSeries).toHaveBeenCalledTimes(2);
  });
});

async function readDayOf(date: string) {
  const { dayOf } = await vi.importActual<typeof import('../lib/local-view')>('../lib/local-view');
  return dayOf(TABLES, date);
}
