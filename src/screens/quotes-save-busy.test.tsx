// @vitest-environment jsdom
// The quotes screen's Save control waits on its write as every control does: from the press until
// the view the save changed has been read again, in the layout that holds it in flow and in the one
// that holds it on the sticky bar (*Cloud target*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { uk } from '../i18n/messages';
import { readView } from '../lib/local-view';
import { repo } from '../lib/repository';

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
// Nothing here opens a database: the meta keys the Inzhur and NBU hooks read answer empty.
vi.mock('../lib/repository', () => ({
  repo: {
    getMeta: async () => undefined,
    setMeta: async () => undefined,
    exportAll: async () => ({ assets: [], snapshots: [], transactions: [] }),
    saveSnapshot: vi.fn(),
  },
  openStore: async () => undefined,
  dbVersion: 1,
}));
// The shell a case renders, as wide-read-first-answer.test.tsx sets it.
vi.mock('../hooks/useIsDesktop', () => ({
  useIsDesktop: () => desktop,
  subscribeToBreakpoint: () => () => {},
}));

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;

// Set before the route graph loads: the persisted stores read `localStorage` as they load.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// jsdom answers no media query.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
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
let desktop = true;
afterAll(() => vi.unstubAllGlobals());

// Loaded while the file is collected, as routes.test.ts loads it, so the import counts against no
// test's timeout.
const { routes } = await import('../routes');
const { useDraft } = await import('../state/draft');

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** The page at the desktop shell or below it. */
async function open(atDesktop: boolean) {
  desktop = atDesktop;
  // What an earlier case left queued is not this one's.
  vi.mocked(readView).mockReset();
  vi.mocked(repo.saveSnapshot).mockReset();
  // A quote typed for today, so there is something to save.
  useDraft.setState({ date: seed.today, quotes: { reit: '68000.00' }, origins: {} });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  const { container } = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      client
        .getQueryCache()
        .findAll({ fetchStatus: 'fetching' })
        .map((q) => JSON.stringify(q.queryKey)),
    ).toEqual([]),
  );
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  return { container };
}

describe.each([
  ['in flow at the desktop shell', true],
  ['on the sticky bar below it', false],
])('Save %s', (_, atDesktop) => {
  it('stays disabled from the press until the view the save changed has been read again', async () => {
    const { container } = await open(atDesktop);
    const save = deferred();
    const read = deferred();
    vi.mocked(repo.saveSnapshot).mockImplementationOnce(() => save.promise);
    vi.mocked(readView).mockClear();
    vi.mocked(readView).mockImplementationOnce(async () => {
      await read.promise;
      const actual = await vi.importActual<typeof import('../lib/local-view')>('../lib/local-view');
      return actual.viewOf(
        { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions },
        seed.today,
      );
    });

    const button = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: uk.dailyQuotes.saveSnapshot });
    // The case is in the layout it names: the sticky bar is portalled out of the page.
    expect(container.contains(button())).toBe(atDesktop);
    expect(button().disabled).toBe(false);
    fireEvent.click(button());
    // The write is out.
    await waitFor(() => expect(repo.saveSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button().disabled).toBe(true));

    // The write is done and the view it changed is not read yet: the control is still busy.
    await act(async () => save.resolve());
    await waitFor(() => expect(readView).toHaveBeenCalledTimes(1));
    expect(button().disabled).toBe(true);

    await act(async () => read.resolve());
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
