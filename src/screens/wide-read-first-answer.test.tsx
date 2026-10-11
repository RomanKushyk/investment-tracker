// @vitest-environment jsdom
// A wide read that has not answered is not an empty one: with the view already held, /yield and
// /balances say nothing of "no snapshots" until the curve and the page land (*Cloud target*), and
// once the read has been out for a while their boxes are held (the first-paint loading state).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { TEST_LEDGERS } from '@quirenote/core/view/test-ledgers';
import { viewKey } from '../hooks/queries';
import { uk } from '../i18n/messages';
import { balancesOf, seriesOf, viewOf } from '../__fixtures__/stored-view';

const seed = TEST_LEDGERS.find((l) => l.name === 'seed')!.input;
const TABLES = { assets: seed.assets, snapshots: seed.snapshots, transactions: seed.transactions };

// A wide read held back until the test lets it through.
let gate: Promise<void> | undefined;
let desktop = true;

// The API's client, whose two wide reads are held back until the test lets them through.
vi.mock('../lib/api', () => ({ repo: { readSeries: vi.fn(), readBalances: vi.fn() } }));
const { repo } = await import('../lib/api');
// The charts are not what is measured, and jsdom lays nothing out for them.
vi.mock('../components/charts/YieldLines', () => ({
  YieldLines: () => <div data-testid="curve" />,
}));
vi.mock('../components/charts/BalancesArea', () => ({ BalancesArea: () => null }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop }));
vi.mock('../components/ui/Scroller', () => ({
  Scroller: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
  const kept = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
const { Yield } = await import('./Yield');
const { Balances } = await import('./Balances');

beforeEach(() => {
  vi.mocked(repo.readSeries).mockReset();
  vi.mocked(repo.readSeries).mockImplementation(async (period) => {
    await gate;
    return seriesOf(TABLES, period, seed.today);
  });
  vi.mocked(repo.readBalances).mockReset();
  vi.mocked(repo.readBalances).mockImplementation(async (page) => {
    await gate;
    return balancesOf(TABLES, page, seed.today);
  });
});
afterEach(() => {
  cleanup();
  gate = undefined;
  desktop = true;
});

/** The screen with the view already read, as it is when a route is shown after another. */
function mount(screenElement: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(viewKey, viewOf(TABLES, seed.today));
  return render(<QueryClientProvider client={client}>{screenElement}</QueryClientProvider>);
}

function hold() {
  let release!: () => void;
  gate = new Promise<void>((r) => (release = r));
  return () => act(async () => release());
}

describe.each([true, false])('on the desktop shell: %s', (onDesktop) => {
  beforeEach(() => {
    desktop = onDesktop;
  });

  it('/yield draws no empty chart while the curve of its period is out', async () => {
    const release = hold();
    const { container } = mount(<Yield />);
    await waitFor(() => expect(repo.readSeries).toHaveBeenCalledTimes(1));
    // The figures beside it are the view's, which is held.
    expect(container.textContent).toContain(seed.assets[0].name);
    expect(container.textContent).not.toContain(uk.analytics.empty.chart);

    await release();
    await screen.findByTestId('curve');
    expect(container.textContent).not.toContain(uk.analytics.empty.chart);
  });

  it('/yield holds the chart’s box once the curve has been out for 300 ms, and not before', async () => {
    const release = hold();
    const { container } = mount(<Yield />);
    await waitFor(() => expect(repo.readSeries).toHaveBeenCalledTimes(1));
    expect(container.querySelector('[data-placeholder="chart"]')).toBeNull();

    await waitFor(() =>
      expect(container.querySelector('[data-placeholder="chart"]')).not.toBeNull(),
    );
    expect(container.textContent).not.toContain(uk.analytics.empty.chart);

    await release();
    await screen.findByTestId('curve');
    await waitFor(() => expect(container.querySelector('[data-placeholder]')).toBeNull(), {
      timeout: 1500,
    });
  });

  it('/balances holds three rows once the page has been out for 300 ms', async () => {
    const release = hold();
    const { container } = mount(<Balances />);
    await waitFor(() => expect(repo.readBalances).toHaveBeenCalledTimes(1));
    // Laid out unseen at first, so the rows' box is there and nothing moves when it is drawn.
    expect(container.querySelector('.invisible [data-placeholder-row]')).not.toBeNull();

    await waitFor(() =>
      expect(container.querySelector('[aria-busy="true"]:not(.invisible)')).not.toBeNull(),
    );
    expect(container.querySelectorAll('[data-placeholder-row]').length).toBeGreaterThanOrEqual(3);
    expect(container.textContent).not.toContain(uk.analytics.empty.table);

    await release();
    await waitFor(
      () => expect(container.querySelectorAll('[data-placeholder-row]').length).toBe(0),
      {
        timeout: 1500,
      },
    );
  });

  it('/balances states no empty table and no count while its first page is out', async () => {
    const release = hold();
    const { container } = mount(<Balances />);
    await waitFor(() => expect(repo.readBalances).toHaveBeenCalledTimes(1));
    const { earliest } = viewOf(TABLES, seed.today).view.balances;
    const since = makeFormat('uk').date(earliest!);
    expect(container.textContent).not.toContain(uk.analytics.empty.table);
    expect(container.textContent).not.toContain(uk.analytics.prose.showingSnapshots(0, 0, since));

    await release();
    await waitFor(() =>
      expect(container.textContent).toContain(
        uk.analytics.prose.showingSnapshots(6, seed.snapshots.length, since),
      ),
    );
    expect(container.textContent).not.toContain(uk.analytics.empty.table);
  });
});
