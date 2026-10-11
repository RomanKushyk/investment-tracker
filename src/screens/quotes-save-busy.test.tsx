// @vitest-environment jsdom
// The quotes screen's Save control waits on its write as every control does: from the press until
// the view the save changed has been read again, in the layout that holds it in flow and in the one
// that holds it on the sticky bar (*Cloud target*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { uk } from '../i18n/messages';

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

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;

beforeAll(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
  vi.stubGlobal('__APP_VERSION__', '0.0.0');
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** The page at the desktop shell or below it: jsdom lays nothing out and answers no media query,
 *  and the breakpoint is read once per module, so each layout loads its own modules. */
async function open(desktop: boolean) {
  vi.resetModules();
  window.matchMedia = ((query: string) => ({
    matches: desktop && query.includes('min-width'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  const { routes } = await import('../routes');
  const { useDraft } = await import('../state/draft');
  const { repo } = await import('../lib/repository');
  const { readView } = await import('../lib/local-view');
  // What an earlier case left queued is not this one's.
  vi.mocked(readView).mockReset();
  vi.mocked(repo.saveSnapshot).mockReset();
  // A quote typed for today, so there is something to save.
  useDraft.setState({ date: seed.today, quotes: { reit: '68000.00' }, origins: {} });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: ['/'] });
  render(
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
  return { repo, readView: vi.mocked(readView) };
}

describe.each([
  ['in flow at the desktop shell', true],
  ['on the sticky bar below it', false],
])('Save %s', (_, desktop) => {
  it('stays disabled from the press until the view the save changed has been read again', async () => {
    const { repo, readView } = await open(desktop);
    const save = deferred();
    const read = deferred();
    vi.mocked(repo.saveSnapshot).mockImplementationOnce(() => save.promise);
    readView.mockClear();
    readView.mockImplementationOnce(async () => {
      await read.promise;
      const actual = await vi.importActual<typeof import('../lib/local-view')>('../lib/local-view');
      return actual.viewOf(
        { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions },
        seed.today,
      );
    });

    const button = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: uk.dailyQuotes.saveSnapshot });
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
