// @vitest-environment jsdom
// How the app holds the view it reads over the API (*Cloud target*): fresh for a while and then
// revalidated with the tag it holds, a read refused for want of a sign-in told from one that failed,
// and a write refused for a stale tag told to the person once, with the view read again.
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { Component, createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { PeriodOption } from '@quirenote/core/period';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import { dayQuotes } from '@quirenote/core/view/serve';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewOf } from '../__fixtures__/stored-view';
import { ApiError } from '../lib/repository';
import { uk } from '../i18n/messages';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../lib/api', () => {
  const write = () => vi.fn(async () => []);
  return {
    repo: {
      readView: vi.fn(),
      readSeries: vi.fn(),
      readBalances: vi.fn(),
      readDay: vi.fn(),
      deleteTransaction: write(),
      deleteAsset: write(),
    },
  };
});

const { toast } = await import('sonner');
const { repo } = await import('../lib/api');
const queries = await import('./queries');
const {
  toastWriteFailure,
  useBalancesPage,
  useDayQuotes,
  useDeleteTransaction,
  useSeries,
  useView,
  useViewGate,
  VIEW_STALE_MS,
  viewKey,
} = queries;
const { selectCapital } = await import('./slices');

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
const body = () => ({
  ...viewOf(
    { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions },
    seed.today,
  ),
  settings: SETTINGS_DEFAULTS,
  tag: '"1"',
  validator: 'W/"1"',
});

function clientOf() {
  return new QueryClient();
}
const providerOf = (client: QueryClient) =>
  function Provider({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };

beforeEach(() => {
  vi.mocked(repo.readView).mockReset();
  vi.mocked(repo.readView).mockImplementation(async () => body());
  vi.mocked(toast.error).mockClear();
  // Each case counts the writes it makes, whatever ran before it.
  vi.mocked(repo.deleteTransaction).mockReset();
  vi.mocked(repo.deleteTransaction).mockResolvedValue([] as never);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('how long the view is held', () => {
  it('is fresh for a bounded while, so a mount within it reads nothing and one after it reads again', async () => {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const client = clientOf();
    const first = renderHook(() => useView(selectCapital), { wrapper: providerOf(client) });
    await vi.advanceTimersByTimeAsync(10);
    expect(repo.readView).toHaveBeenCalledTimes(1);
    first.unmount();

    // A screen mounted a minute later finds it fresh.
    await vi.advanceTimersByTimeAsync(60_000);
    const second = renderHook(() => useView(selectCapital), { wrapper: providerOf(client) });
    await vi.advanceTimersByTimeAsync(10);
    expect(repo.readView).toHaveBeenCalledTimes(1);
    second.unmount();

    // …and one mounted once the window has passed reads it again.
    await vi.advanceTimersByTimeAsync(VIEW_STALE_MS);
    renderHook(() => useView(selectCapital), { wrapper: providerOf(client) });
    await vi.advanceTimersByTimeAsync(10);
    expect(repo.readView).toHaveBeenCalledTimes(2);
  });

  it('is neither read at every mount, which a window of nothing would do, nor held for ever', () => {
    expect(VIEW_STALE_MS).toBeGreaterThan(0);
    expect(VIEW_STALE_MS).toBeLessThan(60 * 60_000);
  });

  it('reads again, with what it holds, when it is invalidated', async () => {
    const client = clientOf();
    const view = renderHook(() => useView(selectCapital), { wrapper: providerOf(client) });
    await waitFor(() => expect(repo.readView).toHaveBeenCalledTimes(1));
    expect(vi.mocked(repo.readView).mock.calls[0][0]).toBeUndefined();

    await act(() => client.invalidateQueries({ queryKey: viewKey }));

    expect(repo.readView).toHaveBeenCalledTimes(2);
    expect(vi.mocked(repo.readView).mock.calls[1][0]).toMatchObject({ validator: 'W/"1"' });
    view.unmount();
  });

  it('keeps the data it holds when the answer is the same one, so nothing renders again', async () => {
    const client = clientOf();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useView(selectCapital);
      },
      { wrapper: providerOf(client) },
    );
    await waitFor(() => expect(repo.readView).toHaveBeenCalledTimes(1));
    // A notification reaches a consumer a tick after the read it follows.
    const again = () =>
      act(async () => {
        await client.invalidateQueries({ queryKey: viewKey });
        await new Promise((r) => setTimeout(r, 30));
      });
    await again();
    const settled = renders;

    await again();

    expect(renders).toBe(settled);
  });
});

describe('a page shown again', () => {
  it('has no hook of its own: TanStack revalidates what has gone stale, and nothing within the window', async () => {
    expect(Object.keys(queries)).not.toContain('useViewShownAgain');
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const client = clientOf();
    renderHook(() => useView(selectCapital), { wrapper: providerOf(client) });
    await vi.advanceTimersByTimeAsync(10);
    expect(repo.readView).toHaveBeenCalledTimes(1);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(repo.readView).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(VIEW_STALE_MS);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(repo.readView).toHaveBeenCalledTimes(2);
  });
});

/** Throws what a render throws to the boundary above it, as a route's does. */
class Boundary extends Component<
  { children: ReactNode; caught: (e: unknown) => void },
  { e?: unknown }
> {
  state: { e?: unknown } = {};
  static getDerivedStateFromError(e: unknown) {
    return { e };
  }
  componentDidCatch(e: unknown) {
    this.props.caught(e);
  }
  render() {
    return this.state.e === undefined ? this.props.children : null;
  }
}

const boundaryOf = (client: QueryClient, caught: (e: unknown) => void) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <Boundary caught={caught}>{children}</Boundary>
      </QueryClientProvider>
    );
  };

describe('the gate a screen waits behind', () => {
  it('is pending until the read answers and ready after', async () => {
    let answer!: (v: ReturnType<typeof body>) => void;
    vi.mocked(repo.readView).mockImplementation(() => new Promise((r) => (answer = r)));
    const { result } = renderHook(() => useViewGate(), { wrapper: providerOf(clientOf()) });
    expect(result.current).toBe('pending');

    await act(async () => answer(body()));

    await waitFor(() => expect(result.current).toBe('ready'));
  });

  it('says signed out, and throws nothing, when the read was refused for want of a token', async () => {
    vi.mocked(repo.readView).mockRejectedValue(new ApiError({ kind: 'unauthorized' }));
    const caught = vi.fn();
    const { result } = renderHook(() => useViewGate(), {
      wrapper: boundaryOf(clientOf(), caught),
    });

    await waitFor(() => expect(result.current).toBe('signedOut'));
    expect(caught).not.toHaveBeenCalled();
  });

  it('throws a read that failed to the screen’s boundary, and retries nothing itself', async () => {
    vi.mocked(repo.readView).mockRejectedValue(new ApiError({ kind: 'offline' }));
    const caught = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHook(() => useViewGate(), { wrapper: boundaryOf(clientOf(), caught) });

    await waitFor(() => expect(caught).toHaveBeenCalled());
    expect(repo.readView).toHaveBeenCalledTimes(1);
  });
});

describe('a wide read that fails', () => {
  const today = dayQuotes([], { user: [], archive: [] }, '2026-07-28');
  const reads: [string, Mock, () => unknown][] = [
    ['the curve of a period', vi.mocked(repo.readSeries), () => useSeries('3m')],
    ['a page of the table', vi.mocked(repo.readBalances), () => useBalancesPage(0)],
    [
      'a day other than the caller’s',
      vi.mocked(repo.readDay),
      () => useDayQuotes('2026-07-01', today),
    ],
  ];

  beforeEach(() => {
    for (const [, read] of reads) read.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe.each(reads)('%s', (_, read, use) => {
    it('is thrown to the screen’s boundary when nothing has answered, as the view’s is, and retried by nothing', async () => {
      read.mockRejectedValue(new ApiError({ kind: 'offline' }));
      const caught = vi.fn();
      renderHook(use, { wrapper: boundaryOf(clientOf(), caught) });

      await waitFor(() => expect(caught).toHaveBeenCalledWith(expect.any(ApiError)));
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('is no failure of a caller nobody has signed in, which asks for nothing', async () => {
      read.mockRejectedValue(new ApiError({ kind: 'unauthorized' }));
      const caught = vi.fn();
      renderHook(use, { wrapper: boundaryOf(clientOf(), caught) });

      await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(caught).not.toHaveBeenCalled();
    });
  });

  it('leaves on screen the answer it holds when the same read fails again', async () => {
    const curve = { period: '3m', series: [] } as never;
    vi.mocked(repo.readSeries).mockResolvedValueOnce(curve);
    const client = clientOf();
    const caught = vi.fn();
    const { result } = renderHook(() => useSeries('3m'), { wrapper: boundaryOf(client, caught) });
    await waitFor(() => expect(result.current).toBe(curve));

    vi.mocked(repo.readSeries).mockRejectedValue(new ApiError({ kind: 'offline' }));
    await act(async () => {
      await client.invalidateQueries({ queryKey: viewKey });
      // A notification reaches a consumer a tick after the read it follows.
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(repo.readSeries).toHaveBeenCalledTimes(2);
    expect(result.current).toBe(curve);
    expect(caught).not.toHaveBeenCalled();
  });

  it('is no failure of the caller’s own day, which the view carries and is never read', async () => {
    const client = clientOf();
    const day = '2026-07-28';
    // A day other than the caller’s once failed here, and is the caller’s own now.
    vi.mocked(repo.readDay).mockRejectedValue(new ApiError({ kind: 'offline' }));
    await client.prefetchQuery(queries.dayQuery(day));
    const caught = vi.fn();

    const empty = dayQuotes([], { user: [], archive: [] }, day);
    const { result } = renderHook(() => useDayQuotes(day, empty), {
      wrapper: boundaryOf(client, caught),
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(result.current.pending).toBe(false);
    expect(caught).not.toHaveBeenCalled();
    expect(repo.readDay).toHaveBeenCalledTimes(1);
  });

  it('is thrown for the period switched to, not hidden behind the curve of the one before', async () => {
    const curve = { period: '3m', series: [] } as never;
    vi.mocked(repo.readSeries).mockImplementation(async (period) => {
      if (period === '3m') return curve;
      throw new ApiError({ kind: 'offline' });
    });
    const caught = vi.fn();
    const { result, rerender } = renderHook(({ period }) => useSeries(period), {
      initialProps: { period: '3m' as PeriodOption },
      wrapper: boundaryOf(clientOf(), caught),
    });
    await waitFor(() => expect(result.current).toBe(curve));

    rerender({ period: '6m' });

    await waitFor(() => expect(caught).toHaveBeenCalledWith(expect.any(ApiError)));
  });
});

describe('a write the API refuses for a stale tag', () => {
  it('says so once, reads the view again and is never retried', async () => {
    const client = clientOf();
    vi.mocked(repo.deleteTransaction).mockRejectedValue(new ApiError({ kind: 'conflict' }));
    const { result } = renderHook(
      () => ({ view: useView(selectCapital), del: useDeleteTransaction() }),
      {
        wrapper: providerOf(client),
      },
    );
    await waitFor(() => expect(repo.readView).toHaveBeenCalledTimes(1));

    await act(async () => {
      await Promise.allSettled([
        result.current.del.mutateAsync({ id: 'a' }),
        result.current.del.mutateAsync({ id: 'b' }),
      ]);
    });

    await waitFor(() =>
      expect(vi.mocked(repo.readView).mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(repo.deleteTransaction).toHaveBeenCalledTimes(2);
    const stale = vi.mocked(toast.error).mock.calls.filter(([m]) => m === uk.sync.staleWrite);
    expect(stale.length).toBeGreaterThan(0);
    // One id for every refusal, so two tabs' worth of them show as one toast.
    expect(new Set(stale.map(([, options]) => (options as { id: string }).id)).size).toBe(1);
  });

  it('leaves a control’s own failure message for any other refusal', () => {
    toastWriteFailure(new ApiError({ kind: 'conflict' }), 'Could not save');
    expect(toast.error).not.toHaveBeenCalled();

    toastWriteFailure(new ApiError({ kind: 'failed', status: 500 }), 'Could not save');
    toastWriteFailure(new Error('unreadable'), 'Could not save');

    expect(vi.mocked(toast.error).mock.calls).toEqual([['Could not save'], ['Could not save']]);
  });

  it('says nothing of a write refused for another reason', async () => {
    vi.mocked(repo.deleteTransaction).mockRejectedValue(
      new ApiError({ kind: 'failed', status: 500 }),
    );
    const { result } = renderHook(() => useDeleteTransaction(), {
      wrapper: providerOf(clientOf()),
    });

    await act(async () => void (await result.current.mutateAsync({ id: 'a' }).catch(() => {})));

    expect(toast.error).not.toHaveBeenCalledWith(uk.sync.staleWrite, expect.anything());
  });
});
