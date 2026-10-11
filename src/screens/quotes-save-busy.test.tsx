// @vitest-environment jsdom
// The quotes screen's Save control waits on its write as every control does: from the press until
// the view the save changed has been read again, in the layout that holds it in flow and in the one
// that holds it on the sticky bar (*Cloud target*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { dayOf, viewDataOf } from '../__fixtures__/stored-view';
import { uk } from '../i18n/messages';
import { ApiError, type Refusal } from '../lib/repository';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

// The API's client: its reads answer the seed, and its save is held for the case to settle.
vi.mock('../lib/api', () => ({
  repo: {
    readView: vi.fn(),
    readSeries: vi.fn(),
    readBalances: vi.fn(),
    readDay: vi.fn(),
    saveSnapshot: vi.fn(),
  },
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
const { repo } = await import('../lib/api');
const { toast } = await import('sonner');

const seedTables = {
  assets: seed.assets,
  snapshots: seed.snapshots,
  transactions: seed.transactions,
};
const bodyOf = () =>
  viewDataOf(
    { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions },
    seed.today,
  );

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
  vi.mocked(repo.readView).mockReset();
  vi.mocked(repo.readView).mockImplementation(async () => bodyOf());
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

// A day other than the caller's is a read of its own, and the save writes over what it holds.
describe.each([
  ['in flow at the desktop shell', true],
  ['on the sticky bar below it', false],
])('Save on a past day %s', (_, atDesktop) => {
  const PAST = '2026-07-20';

  /** The page on `PAST`, its day read answering when the test lets it. */
  async function openPast() {
    desktop = atDesktop;
    vi.mocked(repo.readView).mockReset();
    vi.mocked(repo.readView).mockImplementation(async () => bodyOf());
    vi.mocked(repo.saveSnapshot).mockReset();
    useDraft.setState({ date: PAST, quotes: {}, origins: {} });
    const day = deferred();
    vi.mocked(repo.readDay).mockReset();
    vi.mocked(repo.readDay).mockImplementation(async (date) => {
      await day.promise;
      return dayOf(seedTables, date);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(routes, { initialEntries: ['/'] });
    const { container } = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(repo.readDay).toHaveBeenCalledTimes(1));
    return { day, container };
  }
  const save = () =>
    screen.getByRole<HTMLButtonElement>('button', { name: uk.dailyQuotes.saveSnapshot });

  it('waits for the day it would write over, and is enabled once the day has landed', async () => {
    const { day, container } = await openPast();
    // A quote typed before the day lands has nothing to be compared with.
    act(() => useDraft.setState({ quotes: { [seed.assets[0].id]: '68000.00' } }));
    // The case is in the layout it names: the sticky bar is portalled out of the page.
    expect(container.contains(save())).toBe(atDesktop);
    expect(save().disabled).toBe(true);

    await act(async () => day.resolve());

    await waitFor(() => expect(save().disabled).toBe(false));
  });

  it('sends the day as it was stored, so a quote the drafts left out is cleared', async () => {
    const { day } = await openPast();
    await act(async () => day.resolve());
    const stored = dayOf(seedTables, PAST).quotes;
    const [kept, cleared] = Object.keys(stored);
    // The form prefills from the stored day; the person empties one of its rows.
    await waitFor(() => expect(Object.keys(useDraft.getState().quotes).length).toBeGreaterThan(1));
    act(() => useDraft.getState().setQuote(cleared, ''));
    await waitFor(() => expect(save().disabled).toBe(false));

    fireEvent.click(save());

    await waitFor(() => expect(repo.saveSnapshot).toHaveBeenCalledTimes(1));
    const [date, sent, held] = vi.mocked(repo.saveSnapshot).mock.calls[0];
    expect(date).toBe(PAST);
    expect(Object.keys(sent)).toContain(kept);
    expect(Object.keys(sent)).not.toContain(cleared);
    expect(held).toEqual(stored);
  });
});

describe.each([
  ['in flow at the desktop shell', true],
  ['on the sticky bar below it', false],
])('Save %s', (_, atDesktop) => {
  it('stays disabled from the press until the view the save changed has been read again', async () => {
    const { container } = await open(atDesktop);
    const save = deferred();
    const read = deferred();
    vi.mocked(repo.saveSnapshot).mockImplementationOnce(() => save.promise);
    vi.mocked(repo.readView).mockClear();
    vi.mocked(repo.readView).mockImplementationOnce(async () => {
      await read.promise;
      return bodyOf();
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
    await waitFor(() => expect(repo.readView).toHaveBeenCalledTimes(1));
    expect(button().disabled).toBe(true);

    await act(async () => read.resolve());
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  // A save is a request that can fail, and the person leaves believing the day was saved unless the
  // control says it was not.
  it.each<[string, Refusal]>([
    ['offline', { kind: 'offline' }],
    ['a server error', { kind: 'failed', status: 500 }],
    ['a value the API refuses', { kind: 'invalidOp', index: 0, issues: [] }],
  ])('says it could not save after %s, and is pressable again', async (_, refusal) => {
    await open(atDesktop);
    vi.mocked(toast.error).mockClear();
    vi.mocked(toast.success).mockClear();
    vi.mocked(repo.saveSnapshot).mockRejectedValueOnce(new ApiError(refusal));
    const button = () =>
      screen.getByRole<HTMLButtonElement>('button', { name: uk.dailyQuotes.saveSnapshot });

    fireEvent.click(button());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(uk.dailyQuotes.saveFailed));
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    await waitFor(() => expect(button().disabled).toBe(false));
  });

  it('leaves a save refused for a stale tag to the one toast that says so', async () => {
    await open(atDesktop);
    vi.mocked(toast.error).mockClear();
    vi.mocked(repo.saveSnapshot).mockRejectedValueOnce(new ApiError({ kind: 'conflict' }));

    fireEvent.click(
      screen.getByRole<HTMLButtonElement>('button', { name: uk.dailyQuotes.saveSnapshot }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(uk.sync.staleWrite, expect.anything()),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
