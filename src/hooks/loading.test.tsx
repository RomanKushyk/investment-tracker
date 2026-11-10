// @vitest-environment jsdom
// The first-paint loading state: from `PLACEHOLDER_AFTER_MS` after the read starts until it
// answers, and for at least `PLACEHOLDER_HOLD_MS` once shown, a screen holds its boxes; a read that
// answers sooner shows nothing, and a refetch shows none.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewOf } from '../__fixtures__/stored-view';
import { Loadable, ViewClock } from '../components/loading/Loadable';
import { LoadingStatus } from '../components/loading/LoadingStatus';
import { uk } from '../i18n/messages';
import { ApiError } from '../lib/repository';
import { PLACEHOLDER_AFTER_MS, PLACEHOLDER_HOLD_MS, usePlaceholder } from './loading';

vi.mock('../lib/api', () => ({
  repo: {
    readMe: vi.fn(async () => ({ userId: 'u', email: 'u@example.com', role: 'user' })),
    readView: vi.fn(),
    readSeries: vi.fn(),
    readBalances: vi.fn(),
    readDay: vi.fn(),
  },
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
      <ViewClock>
        <Loadable placeholder={<div data-testid="placeholder" aria-busy="true" />}>
          <div data-testid="content" />
        </Loadable>
      </ViewClock>
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

  it('gives a read that starts again, as after an account change, nothing of the last one’s hold', async () => {
    const first = later();
    vi.mocked(repo.readView).mockImplementation(() => first.promise);
    const client = clientOf();
    render(<Screen client={client} />);
    await tick(PLACEHOLDER_AFTER_MS + 50);
    expect(screen.getByTestId('placeholder')).toBeTruthy();

    // The next account's `/me`, held: the view is not asked for again until it answers.
    const caller = vi.mocked(repo.readMe).getMockImplementation()!;
    let named!: () => void;
    vi.mocked(repo.readMe).mockImplementationOnce(
      () => new Promise((resolve) => (named = () => void caller().then(resolve))),
    );
    const second = later();
    vi.mocked(repo.readView).mockImplementation(() => second.promise);
    await act(async () => void client.resetQueries());
    await tick(50);
    await act(async () => named());
    await tick(100);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    await act(async () => second.answer(body()));
    await tick(1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(screen.getByTestId('content')).toBeTruthy();
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

  // `Layout` keys the screen by route, so a route change remounts it while the read is still out;
  // `/settings` stands for a screen that does not wait behind the view.
  const Routed = ({ client, route }: { client: QueryClient; route: string }) => (
    <QueryClientProvider client={client}>
      <ViewClock>
        <div key={route}>
          {route === '/settings' ? null : (
            <Loadable placeholder={<div data-testid="placeholder" aria-busy="true" />}>
              <div data-testid="content" />
            </Loadable>
          )}
        </div>
      </ViewClock>
    </QueryClientProvider>
  );

  it('counts from the read, not the screen: a route change part way through the delay restarts nothing', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    const client = clientOf();
    const { rerender } = render(<Routed client={client} route="/" />);

    await tick(200);
    rerender(<Routed client={client} route="/balances" />);
    await tick(PLACEHOLDER_AFTER_MS - 200 - 1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    await tick(1);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
  });

  it('counts through a screen that does not wait on the view: back behind it, the delay already ran', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    const client = clientOf();
    const { rerender } = render(<Routed client={client} route="/" />);

    await tick(200);
    rerender(<Routed client={client} route="/settings" />);
    await tick(PLACEHOLDER_AFTER_MS - 200 + 50);
    rerender(<Routed client={client} route="/overview" />);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
  });

  it('holds back no answer for a placeholder nobody saw: one due while no screen waited on the view', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    const client = clientOf();
    const { rerender } = render(<Routed client={client} route="/settings" />);

    await tick(PLACEHOLDER_AFTER_MS + 20);
    await act(async () => read.answer(body()));
    await tick(80);
    rerender(<Routed client={client} route="/overview" />);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('holds a placeholder first drawn after it came due for its full time, from the draw', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    const client = clientOf();
    const { rerender } = render(<Routed client={client} route="/settings" />);

    await tick(PLACEHOLDER_AFTER_MS + 290);
    rerender(<Routed client={client} route="/overview" />);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    await tick(5);
    await act(async () => read.answer(body()));
    await tick(PLACEHOLDER_HOLD_MS - 5 - 1);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    await tick(1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
  });

  it('keeps the hold through a route change, from when the placeholder showed', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    const client = clientOf();
    const { rerender } = render(<Routed client={client} route="/" />);
    await tick(PLACEHOLDER_AFTER_MS);
    expect(screen.getByTestId('placeholder')).toBeTruthy();

    await tick(50);
    await act(async () => read.answer(body()));
    await tick(50);
    rerender(<Routed client={client} route="/balances" />);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    await tick(PLACEHOLDER_HOLD_MS - 100 - 1);
    expect(screen.getByTestId('placeholder')).toBeTruthy();
    await tick(1);
    expect(screen.queryByTestId('placeholder')).toBeNull();
    // The content replaced a placeholder, so it arrives with the animation.
    expect(screen.getByTestId('content').parentElement?.className).toContain('fade-in');
  });

  it('keeps its status line empty once the placeholders go, however many are mounted', async () => {
    const read = later();
    vi.mocked(repo.readView).mockImplementation(() => read.promise);
    render(
      <QueryClientProvider client={clientOf()}>
        <LoadingStatus />
        <ViewClock>
          <Loadable placeholder={<i />}>{null}</Loadable>
          <Loadable placeholder={<b />}>{null}</Loadable>
        </ViewClock>
      </QueryClientProvider>,
    );
    await tick(PLACEHOLDER_AFTER_MS);
    expect(status().textContent).toBe(uk.loading.status);

    await act(async () => read.answer(body()));
    await tick(PLACEHOLDER_HOLD_MS);

    expect(status().textContent).toBe('');
  });
});
