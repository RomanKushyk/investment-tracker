// @vitest-environment jsdom
// The first-paint loading state (design/extensions/first-paint.dc.html, brief #406): from 300 ms
// after the read starts until it answers, and for at least 300 ms once shown, a screen holds its
// boxes; a read that answers sooner shows nothing, and a refetch shows none.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewOf } from '../__fixtures__/stored-view';
import { Loadable } from '../components/loading/Loadable';
import { LoadingStatus } from '../components/loading/LoadingStatus';
import { uk } from '../i18n/messages';
import { ApiError } from '../lib/repository';
import { PLACEHOLDER_AFTER_MS, PLACEHOLDER_HOLD_MS, usePlaceholder } from './loading';

vi.mock('../lib/api', () => ({
  repo: { readView: vi.fn(), readSeries: vi.fn(), readBalances: vi.fn(), readDay: vi.fn() },
}));
const { repo } = await import('../lib/api');
const { viewKey } = await import('./queries');

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

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(repo.readView).mockReset();
});

const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe('usePlaceholder', () => {
  const run = (pending: boolean) =>
    renderHook(({ p }) => usePlaceholder(p), { initialProps: { p: pending } });

  it('is never shown while nothing is pending', async () => {
    const { result } = run(false);
    await tick(5_000);
    expect(result.current).toBe(false);
  });

  it('appears once the read has been out for 300 ms, and not before', async () => {
    const { result } = run(true);
    await tick(PLACEHOLDER_AFTER_MS - 1);
    expect(result.current).toBe(false);
    await tick(1);
    expect(result.current).toBe(true);
  });

  it('is never shown for a read that answers inside 300 ms', async () => {
    const { result, rerender } = run(true);
    await tick(PLACEHOLDER_AFTER_MS - 50);
    rerender({ p: false });
    await tick(5_000);
    expect(result.current).toBe(false);
  });

  it('stays at least 300 ms once shown, so its fade-in completes', async () => {
    const { result, rerender } = run(true);
    await tick(PLACEHOLDER_AFTER_MS);
    expect(result.current).toBe(true);
    await tick(50);
    rerender({ p: false });
    expect(result.current).toBe(true);
    await tick(PLACEHOLDER_HOLD_MS - 51);
    expect(result.current).toBe(true);
    await tick(1);
    expect(result.current).toBe(false);
  });

  it('goes at once for a read that was shown for longer than that', async () => {
    const { result, rerender } = run(true);
    await tick(PLACEHOLDER_AFTER_MS + PLACEHOLDER_HOLD_MS + 100);
    rerender({ p: false });
    await tick(1);
    expect(result.current).toBe(false);
  });

  it('counts 300 ms again for the next read', async () => {
    const { result, rerender } = run(true);
    await tick(PLACEHOLDER_AFTER_MS + PLACEHOLDER_HOLD_MS);
    rerender({ p: false });
    await tick(10);
    expect(result.current).toBe(false);
    rerender({ p: true });
    await tick(PLACEHOLDER_AFTER_MS - 1);
    expect(result.current).toBe(false);
    await tick(1);
    expect(result.current).toBe(true);
  });
});

function Screen({ client }: { client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <LoadingStatus />
      <Loadable placeholder={<div data-testid="placeholder" aria-busy="true" />}>
        <div data-testid="content" />
      </Loadable>
    </QueryClientProvider>
  );
}
const clientOf = () => new QueryClient();
const later = () => {
  let answer!: (v: ReturnType<typeof body>) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<ReturnType<typeof body>>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { promise, answer, fail };
};
const status = () => screen.getByRole('status');

describe('a screen behind the view', () => {
  it('shows the shell alone for 300 ms, then the placeholder, and the content once the read answers', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    render(<Screen client={clientOf()} />);

    await tick(PLACEHOLDER_AFTER_MS - 1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(screen.queryByTestId('content')).toBeNull();
    expect(status().textContent).toBe('');

    await tick(1);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    expect(status().textContent).toBe(uk.loading.status);

    await tick(PLACEHOLDER_HOLD_MS);
    await act(async () => read.answer(body()));
    await tick(1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(screen.getByTestId('content')).toBeTruthy();
    expect(status().textContent).toBe('');
  });

  it('shows no placeholder at all when the view answers within 300 ms', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    render(<Screen client={clientOf()} />);

    await tick(100);
    await act(async () => read.answer(body()));
    await tick(1);

    expect(screen.getByTestId('content')).toBeTruthy();
    await tick(2_000);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('shows no placeholder for a refetch: the content in hand stays', async () => {
    const client = clientOf();
    vi.mocked(repo.readView).mockImplementation(async () => body());
    render(<Screen client={client} />);
    await tick(10);
    expect(screen.getByTestId('content')).toBeTruthy();

    const again = later();
    vi.mocked(repo.readView).mockImplementation(() => again.promise);
    await act(async () => void client.invalidateQueries({ queryKey: viewKey }));
    await tick(2_000);

    expect(screen.getByTestId('content')).toBeTruthy();
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('shows neither placeholder nor content to a caller who is signed out', async () => {
    vi.mocked(repo.readView).mockRejectedValue(new ApiError({ kind: 'unauthorized' }));
    render(<Screen client={clientOf()} />);

    await tick(2_000);

    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(screen.queryByTestId('content')).toBeNull();
    expect(status().textContent).toBe('');
  });

  it('keeps its status line empty once the placeholders go, however many are mounted', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    render(
      <QueryClientProvider client={clientOf()}>
        <LoadingStatus />
        <Loadable placeholder={<i />}>{null}</Loadable>
        <Loadable placeholder={<b />}>{null}</Loadable>
      </QueryClientProvider>,
    );
    await tick(PLACEHOLDER_AFTER_MS);
    expect(status().textContent).toBe(uk.loading.status);

    await act(async () => read.answer(body()));
    await tick(PLACEHOLDER_HOLD_MS);

    expect(status().textContent).toBe('');
  });
});
