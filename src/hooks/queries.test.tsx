// @vitest-environment jsdom
// The view query, its slices and its writes, mounted: a slice is read through a selector held at
// module level, so a consumer renders only when its own slice moves (*Core is pure*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { createElement, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import type { PeriodOption } from '@quirenote/core/period';
import type { BalancesBody, DayQuotes, SeriesBody, ViewBody } from '@quirenote/core/view/serve';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { balancesOf, dayOf, seriesOf, viewDataOf, viewOf } from '../__fixtures__/stored-view';
import { selectCapital, selectPayouts, selectPortfolio, selectQuotesForm } from './slices';

// The API's client: its reads answer the seed unless a case says otherwise, and each write resolves.
vi.mock('../lib/api', () => {
  const write = () => vi.fn(async () => undefined);
  return {
    repo: {
      readView: vi.fn(),
      readSeries: vi.fn(),
      readBalances: vi.fn(),
      readDay: vi.fn(),
      saveSnapshot: write(),
      recordTransaction: write(),
      recordCoupon: write(),
      addAsset: write(),
      updateAsset: write(),
      saveTargets: write(),
      deleteAsset: write(),
      updateTransaction: write(),
      deleteTransaction: write(),
      deleteSnapshot: write(),
      replaceAll: vi.fn(async () => 'imported'),
      clearAll: write(),
      exportState: vi.fn(),
    },
  };
});
const { repo } = await import('../lib/api');
const {
  useAddAsset,
  useBalancesPage,
  useClearAll,
  useDayQuotes,
  useDeleteAsset,
  useDeleteSnapshot,
  useDeleteTransaction,
  useRecordCoupon,
  useRecordTransaction,
  useReplaceAll,
  useSaveSnapshot,
  useSaveTargets,
  useSeries,
  useUpdateAsset,
  useUpdateTransaction,
  useView,
  useViewDayRollover,
  useViewReady,
  viewKey,
} = await import('./queries');
const readView = vi.mocked(repo.readView);
const readSeries = vi.mocked(repo.readSeries);
const readBalances = vi.mocked(repo.readBalances);
const readDay = vi.mocked(repo.readDay);

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
const TODAY = seed.today;
const bodyOf = (
  tables: { assets: Asset[]; snapshots: Snapshot[]; transactions: Transaction[] } = seed,
  today = TODAY,
) => viewDataOf(tables, today);

/** A read that answers when the test says so. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function clientOf() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function providerOf(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  vi.mocked(readView).mockReset();
  vi.mocked(readView).mockImplementation(async () => bodyOf());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useView', () => {
  it('reads the view once, however many slices are taken of it', async () => {
    const client = clientOf();
    const { result } = renderHook(
      () => ({
        payouts: useView(selectPayouts),
        portfolio: useView(selectPortfolio),
        capital: useView(selectCapital),
        ready: useViewReady(),
      }),
      { wrapper: providerOf(client) },
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(readView).toHaveBeenCalledTimes(1);
    expect(result.current.payouts.payouts).toEqual(bodyOf().view.payouts);
    expect(result.current.portfolio.portfolio).toEqual(bodyOf().view.portfolio);
    expect(result.current.capital).toEqual(bodyOf().view.capital);
  });

  it('holds the slice of an empty portfolio until the read answers, and says it is not ready', async () => {
    const later = deferred<ViewBody>();
    vi.mocked(readView).mockImplementation(() => later.promise);
    const { result } = renderHook(
      () => ({ payouts: useView(selectPayouts), ready: useViewReady() }),
      { wrapper: providerOf(clientOf()) },
    );
    expect(result.current.ready).toBe(false);
    expect(result.current.payouts.assets).toEqual([]);
    expect(result.current.payouts.payouts).toEqual(
      bodyOf({ assets: [], snapshots: [], transactions: [] }).view.payouts,
    );
    await act(async () => later.resolve(bodyOf()));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.payouts.assets).toEqual(seed.assets);
  });

  it('hands the same empty slice on every render while the read is pending', () => {
    vi.mocked(readView).mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderHook(() => useView(selectPayouts), {
      wrapper: providerOf(clientOf()),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('a slice is rendered only when it moves', () => {
  // The cache holds the body before the consumers mount and never goes stale, so the one read is
  // the test's own `setQueryData`.
  function mount() {
    const renders = { payouts: 0, portfolio: 0, whole: 0 };
    function Payouts() {
      const { payouts } = useView(selectPayouts);
      useEffect(() => {
        renders.payouts += 1;
      });
      return createElement('p', null, String(payouts.income.total));
    }
    function Portfolio() {
      const { portfolio } = useView(selectPortfolio);
      useEffect(() => {
        renders.portfolio += 1;
      });
      return createElement('p', null, String(portfolio.cash));
    }
    // The control: a consumer of the whole body moves with any change, so a count that stays put
    // above is the slice's doing and not a counter that cannot move.
    const everything = (body: ViewBody) => body;
    function Whole() {
      const body = useView(everything);
      useEffect(() => {
        renders.whole += 1;
      });
      return createElement('p', null, String(body.view.portfolio.cash));
    }
    const client = clientOf();
    client.setQueryData(viewKey, bodyOf());
    const view = render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(Payouts),
        createElement(Portfolio),
        createElement(Whole),
      ),
    );
    return { client, renders, view };
  }

  it("does not render a consumer of one slice when another's changes", async () => {
    const { client, renders } = mount();
    await waitFor(() => expect(renders.whole).toBeGreaterThan(0));
    const before = { ...renders };
    // A fresh copy of the whole body with one figure changed: nothing but the Portfolio slice
    // differs, though every object in it is new.
    const next = structuredClone(bodyOf());
    next.view.portfolio.cash += 1;
    act(() => {
      client.setQueryData(viewKey, next);
    });
    await waitFor(() => expect(renders.portfolio).toBe(before.portfolio + 1));
    expect(renders.whole).toBe(before.whole + 1);
    expect(renders.payouts).toBe(before.payouts);
  });

  it('runs a module-level selector once per change of the data, not once per render', async () => {
    const calls = vi.fn();
    const counted = (body: ViewBody) => {
      calls(body);
      return selectPayouts(body);
    };
    const client = clientOf();
    client.setQueryData(viewKey, bodyOf());
    function Probe({ tick }: { tick: number }) {
      useView(counted);
      return createElement('p', null, String(tick));
    }
    const { rerender } = render(
      createElement(QueryClientProvider, { client }, createElement(Probe, { tick: 0 })),
    );
    await waitFor(() => expect(calls).toHaveBeenCalled());
    const first = calls.mock.calls.length;
    for (const tick of [1, 2, 3]) {
      rerender(createElement(QueryClientProvider, { client }, createElement(Probe, { tick })));
    }
    expect(calls).toHaveBeenCalledTimes(first);
  });
});

describe('a read by period or by day', () => {
  it('keeps the curve a period had until the next period lands', async () => {
    const all = seriesOf(seed, 'all', TODAY);
    const month = seriesOf(seed, '1m', TODAY);
    expect(month.series.length).not.toBe(all.series.length);
    const later = deferred<SeriesBody>();
    vi.mocked(readSeries).mockReset();
    vi.mocked(readSeries).mockResolvedValueOnce(all);
    vi.mocked(readSeries).mockImplementationOnce(() => later.promise);
    const { result, rerender } = renderHook(({ period }) => useSeries(period), {
      wrapper: providerOf(clientOf()),
      initialProps: { period: 'all' as PeriodOption },
    });
    await waitFor(() => expect(result.current).toEqual(all));
    rerender({ period: '1m' });
    await waitFor(() => expect(readSeries).toHaveBeenCalledTimes(2));
    // The month is out and not back: the chart still draws the history it had.
    expect(result.current).toEqual(all);
    await act(async () => later.resolve(month));
    await waitFor(() => expect(result.current).toEqual(month));
  });

  it('is nothing, and not an empty curve or page, until the first answer lands', async () => {
    const curve = deferred<SeriesBody>();
    const page = deferred<BalancesBody>();
    vi.mocked(readSeries).mockReset();
    vi.mocked(readSeries).mockImplementationOnce(() => curve.promise);
    vi.mocked(readBalances).mockReset();
    vi.mocked(readBalances).mockImplementationOnce(() => page.promise);
    const { result } = renderHook(() => ({ curve: useSeries('all'), page: useBalancesPage(0) }), {
      wrapper: providerOf(clientOf()),
    });
    await waitFor(() => expect(readSeries).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readBalances).toHaveBeenCalledTimes(1));
    expect(result.current.curve).toBeUndefined();
    expect(result.current.page).toBeUndefined();

    await act(async () => {
      curve.resolve(seriesOf(seed, 'all', TODAY));
      page.resolve(balancesOf(seed, 0, TODAY));
    });
    await waitFor(() => expect(result.current.curve).toEqual(seriesOf(seed, 'all', TODAY)));
    expect(result.current.page).toEqual(balancesOf(seed, 0, TODAY));
  });

  it("is the view's own for the caller's day, and reads no day for it", async () => {
    vi.mocked(readDay).mockReset();
    const opening = viewOf(seed, TODAY).today;
    const { result } = renderHook(() => useDayQuotes(opening.date, opening), {
      wrapper: providerOf(clientOf()),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.day).toBe(opening);
    expect(result.current.pending).toBe(false);
    expect(readDay).not.toHaveBeenCalled();
  });

  it('is an empty day until another lands, never the last one read', async () => {
    const opening = viewOf(seed, TODAY).today;
    const [first, second] = ['2026-07-20', '2026-07-21'];
    const later = deferred<DayQuotes>();
    vi.mocked(readDay).mockReset();
    vi.mocked(readDay).mockResolvedValueOnce(dayOf(seed, first));
    vi.mocked(readDay).mockImplementationOnce(() => later.promise);
    const { result, rerender } = renderHook(({ date }) => useDayQuotes(date, opening), {
      wrapper: providerOf(clientOf()),
      initialProps: { date: first },
    });
    expect(result.current.day).toMatchObject({ date: first, quotes: {}, previous: {} });
    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(Object.keys(result.current.day.quotes).length).toBeGreaterThan(0));
    expect(result.current.day.date).toBe(first);
    expect(result.current.pending).toBe(false);

    rerender({ date: second });
    // The second day is out and not back: no quote of the first stands in its place.
    expect(result.current.day).toMatchObject({ date: second, quotes: {}, previous: {} });
    expect(result.current.pending).toBe(true);
    await act(async () => later.resolve(dayOf(seed, second)));
    await waitFor(() => expect(Object.keys(result.current.day.quotes).length).toBeGreaterThan(0));
    expect(result.current.day.date).toBe(second);
  });
});

describe('a write', () => {
  // Every write, with the call that makes it. Each must hand the invalidation's promise back, so the
  // control that waits on the write waits for the view it changed.
  const tx: Transaction = {
    id: 't1',
    date: '2026-07-20',
    type: 'deposit',
    assetId: '',
    amount: 100,
  };
  const asset = seed.assets[0];
  const WRITES: [string, () => { mutateAsync: () => Promise<unknown> }][] = [
    [
      'saveSnapshot',
      function useWrite() {
        const m = useSaveSnapshot();
        return { mutateAsync: () => m.mutateAsync({ date: TODAY, quotes: {}, stored: {} }) };
      },
    ],
    [
      'recordTransaction',
      function useWrite() {
        const m = useRecordTransaction();
        return { mutateAsync: () => m.mutateAsync({ tx }) };
      },
    ],
    [
      'recordCoupon',
      function useWrite() {
        const m = useRecordCoupon();
        return { mutateAsync: () => m.mutateAsync({ payout: tx }) };
      },
    ],
    [
      'addAsset',
      function useWrite() {
        const m = useAddAsset();
        return { mutateAsync: () => m.mutateAsync(asset) };
      },
    ],
    [
      'updateAsset',
      function useWrite() {
        const m = useUpdateAsset();
        return { mutateAsync: () => m.mutateAsync({ id: asset.id, patch: { targetPct: 1 } }) };
      },
    ],
    [
      'saveTargets',
      function useWrite() {
        const m = useSaveTargets();
        return { mutateAsync: () => m.mutateAsync([{ id: asset.id, targetPct: 1 }]) };
      },
    ],
    [
      'deleteAsset',
      function useWrite() {
        const m = useDeleteAsset();
        return { mutateAsync: () => m.mutateAsync(asset.id) };
      },
    ],
    [
      'updateTransaction',
      function useWrite() {
        const m = useUpdateTransaction();
        return { mutateAsync: () => m.mutateAsync({ id: tx.id, patch: { amount: 1 } }) };
      },
    ],
    [
      'deleteTransaction',
      function useWrite() {
        const m = useDeleteTransaction();
        return { mutateAsync: () => m.mutateAsync({ id: tx.id }) };
      },
    ],
    [
      'deleteSnapshot',
      function useWrite() {
        const m = useDeleteSnapshot();
        return { mutateAsync: () => m.mutateAsync(TODAY) };
      },
    ],
    [
      'replaceAll',
      function useWrite() {
        const m = useReplaceAll();
        return {
          mutateAsync: () =>
            m.mutateAsync({ etag: '"1"', plan: { manifest: {} as never, parts: [] } }),
        };
      },
    ],
    [
      'clearAll',
      function useWrite() {
        const m = useClearAll();
        return { mutateAsync: () => m.mutateAsync() };
      },
    ],
  ];

  it.each(WRITES)(
    '%s resolves only once the view it changed has been read again',
    async (_, write) => {
      const client = clientOf();
      const { result } = renderHook(() => ({ ready: useViewReady(), write: write() }), {
        wrapper: providerOf(client),
      });
      await waitFor(() => expect(result.current.ready).toBe(true));
      expect(readView).toHaveBeenCalledTimes(1);

      const refetch = deferred<ViewBody>();
      vi.mocked(readView).mockImplementation(() => refetch.promise);
      let settled = false;
      const done = result.current.write.mutateAsync().then(() => {
        settled = true;
      });
      await waitFor(() => expect(readView).toHaveBeenCalledTimes(2));
      // The write has landed and the read is out, so the answer is still being waited on.
      await act(async () => {
        await Promise.resolve();
      });
      expect(settled).toBe(false);

      await act(async () => refetch.resolve(bodyOf()));
      await done;
      expect(settled).toBe(true);
    },
  );
});

describe('a control that waits on a write', () => {
  it('stays busy until the refetched view has landed, and never renders the old figure idle', async () => {
    const before = bodyOf();
    // A buy today, so the capital figure the control sits beside moves.
    const after = bodyOf({
      assets: seed.assets,
      snapshots: seed.snapshots,
      transactions: [
        ...seed.transactions,
        { id: 'late', date: '2026-07-27', type: 'deposit', assetId: '', amount: 1000 },
      ],
    });
    expect(after.view.capital.total).not.toBe(before.view.capital.total);

    const refetch = deferred<ViewBody>();
    vi.mocked(readView).mockReset();
    vi.mocked(readView).mockResolvedValueOnce(before);
    vi.mocked(readView).mockImplementationOnce(() => refetch.promise);

    const seen: { pending: boolean; total: number }[] = [];
    const press: { current: () => void } = { current: () => {} };
    function Submit() {
      const capital = useView(selectCapital);
      const mutation = useRecordTransaction();
      useEffect(() => {
        press.current = () =>
          mutation.mutate({
            tx: { id: 'late', date: '2026-07-27', type: 'deposit', assetId: '', amount: 1000 },
          });
        seen.push({ pending: mutation.isPending, total: capital.total });
      });
      return createElement('button', { disabled: mutation.isPending }, String(capital.total));
    }
    render(createElement(QueryClientProvider, { client: clientOf() }, createElement(Submit)));
    await waitFor(() => expect(seen.at(-1)?.total).toBe(before.view.capital.total));

    const clicked = seen.length;
    act(() => press.current());
    await waitFor(() => expect(readView).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    // The write is done and the view is not: the control is busy and the old figure stands.
    expect(seen.at(-1)).toEqual({ pending: true, total: before.view.capital.total });

    await act(async () => refetch.resolve(after));
    await waitFor(() => expect(seen.at(-1)?.pending).toBe(false));
    expect(seen.at(-1)).toEqual({ pending: false, total: after.view.capital.total });
    // At no render after the press was the control idle beside the figure it had not changed.
    const idleAndStale = seen
      .slice(clicked)
      .filter((s) => !s.pending && s.total === before.view.capital.total);
    expect(idleAndStale).toEqual([]);
  });
});

describe('the day', () => {
  const buy = (id: string, date: string): Transaction => ({
    id,
    date,
    type: 'buy',
    assetId: 'energy',
    amount: 1000,
    quantity: 100,
  });
  const fund: Asset = {
    id: 'energy',
    name: 'Inzhur Energy',
    code: 'EN',
    colorKey: 'energy',
    yieldType: 'capitalization',
    expectedPct: 10,
    targetPct: 40,
    payoutSchedule: 'none',
    firstPurchase: '2026-07-28',
    createdAt: '2026-07-28T10:00:00',
  };
  const tables = {
    assets: [fund],
    snapshots: [
      { date: '2026-07-28', quotes: { energy: 1010 } },
      { date: '2026-07-29', quotes: { energy: 1020 } },
    ],
    transactions: [buy('today', '2026-07-28'), buy('ahead', '2026-07-29')],
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 23, 59, 30)); // local 28.07, half a minute to midnight
    // The device's day is read when the read is made, as the real one does.
    vi.mocked(readView).mockImplementation(async () => viewDataOf(tables, '2026-07-28'));
  });

  it('reads the view again when the day changes, so a row dated tomorrow counts on its day', async () => {
    const client = clientOf();
    // The shell mounts the rollover above the screens, whose effects run first: the read it must
    // not repeat is already out when its own effect runs.
    const { result } = renderHook(
      () => {
        const slice = useView(selectQuotesForm);
        useViewDayRollover();
        return slice;
      },
      { wrapper: providerOf(client) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(readView).toHaveBeenCalledTimes(1);
    expect(result.current.day.date).toBe('2026-07-28');

    vi.mocked(readView).mockImplementation(async () => viewDataOf(tables, '2026-07-29'));
    // Before midnight nothing is read again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(readView).toHaveBeenCalledTimes(1);
    // The minute's poll finds the new day.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(readView).toHaveBeenCalledTimes(2);
    expect(result.current.day.date).toBe('2026-07-29');
  });

  it('reads nothing when it mounts over a view that was already read', async () => {
    const client = clientOf();
    client.setQueryData(viewKey, viewOf(tables, '2026-07-28'));
    renderHook(
      () => {
        useView(selectQuotesForm);
        useViewDayRollover();
      },
      { wrapper: providerOf(client) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(readView).not.toHaveBeenCalled();
  });
});
