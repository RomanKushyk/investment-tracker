// @vitest-environment jsdom
// The Balances table pages by core's one size, the same the server's page is cut by (#189): mocked
// here to a size no hard-coded page has, the screen shows it. Each page is a read of its own.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import type { Snapshot } from '@quirenote/core/types';
import { readBalances } from '../lib/local-view';

const SNAPSHOTS = buildSeedSnapshots();
let snapshots: Snapshot[] = SNAPSHOTS;
// A page held back until the test lets it through.
let gate: Promise<void> | undefined;
const TODAY = '2026-07-28';

vi.mock('@quirenote/core/view/balances-page', () => ({ BALANCES_PAGE_SIZE: 4 }));
vi.mock('../lib/local-view', async (importActual) => {
  const actual = await importActual<typeof import('../lib/local-view')>();
  const tables = () => ({
    assets: SEED_ASSETS,
    snapshots,
    transactions: SEED_TRANSACTIONS,
  });
  return {
    ...actual,
    readView: vi.fn(async () => actual.viewOf(tables(), TODAY)),
    readBalances: vi.fn(async (page: number) => {
      await gate;
      return actual.balancesOf(tables(), page, TODAY);
    }),
  };
});
// The chart is not what is measured, and jsdom lays nothing out for it.
vi.mock('../components/charts/BalancesArea', () => ({ BalancesArea: () => null }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../components/ui/Scroller', () => ({
  Scroller: ({ children }: { children: ReactNode }) => children,
}));

beforeAll(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});
const { Balances } = await import('./Balances');

beforeEach(() => {
  vi.mocked(readBalances).mockClear();
});
afterEach(() => {
  cleanup();
  snapshots = SNAPSHOTS;
  gate = undefined;
});

const firstDates = (container: HTMLElement) =>
  [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Balances />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

// The pager's second button steps forward.
const next = (container: HTMLElement) => container.querySelectorAll('button')[1];

describe('the Balances table', () => {
  it('shows a page of the size core names', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
  });

  it('reads the next page when the pager steps, and shows it once it lands', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const first = firstDates(container);

    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    fireEvent.click(next(container));
    await waitFor(() => expect(readBalances).toHaveBeenCalledWith(1));
    // The page is out and not back: the table holds the rows it had, and the screen has not gone
    // back to the first page for want of rows.
    expect(firstDates(container)).toEqual(first);

    await act(async () => release());
    await waitFor(() => expect(firstDates(container)).not.toEqual(first));
    expect(vi.mocked(readBalances).mock.calls.filter(([page]) => page === 0)).toHaveLength(1);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  // The page shown while the next is out is the one before's, and its `next` is the page already on
  // its way: a second press would ask for one past the end, which lands empty and sends the screen
  // back to the first page.
  it('steps no further while the page it stepped to is out', async () => {
    snapshots = SNAPSHOTS.slice(-10);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const first = firstDates(container);
    fireEvent.click(next(container));
    await waitFor(() => expect(firstDates(container)).not.toEqual(first));

    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    fireEvent.click(next(container));
    await waitFor(() => expect(readBalances).toHaveBeenCalledWith(2));
    expect(next(container).disabled).toBe(true);
    fireEvent.click(next(container));

    await act(async () => release());
    // The last page, two rows, and no read past it.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(readBalances).not.toHaveBeenCalledWith(3);
  });

  // Two presses before the screen has drawn the first both come from the page it drew.
  it('steps once for two presses made before the first is drawn', async () => {
    snapshots = SNAPSHOTS.slice(-10);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const first = firstDates(container);
    fireEvent.click(next(container));
    await waitFor(() => expect(firstDates(container)).not.toEqual(first));

    const button = next(container);
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    // The last page, two rows, and no read past it.
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(2));
    expect(readBalances).not.toHaveBeenCalledWith(3);
  });

  // A replace or a clear in another tab re-renders this screen in place (`useDbSync`): a page the
  // new rows do not reach starts over rather than showing an empty table.
  it('starts over on the first page when the rows shrink under the one it is on', async () => {
    const { container, client } = mount();
    await waitFor(() => expect(container.querySelectorAll('tbody tr')).toHaveLength(4));
    const first = firstDates(container);
    for (let i = 0; i < 5; i++) {
      const before = firstDates(container);
      fireEvent.click(next(container));
      await waitFor(() => expect(firstDates(container)).not.toEqual(before));
    }
    expect(firstDates(container)).not.toEqual(first);

    snapshots = SNAPSHOTS.slice(-6);
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() => expect(readBalances).toHaveBeenLastCalledWith(0));
    // The first page of the shrunken rows, not a page the rows no longer reach.
    const { balancesOf } =
      await vi.importActual<typeof import('../lib/local-view')>('../lib/local-view');
    const shrunk = balancesOf(
      { assets: SEED_ASSETS, snapshots, transactions: SEED_TRANSACTIONS },
      0,
      TODAY,
    );
    await waitFor(() =>
      expect(firstDates(container)).toEqual(shrunk.rows.map((r) => makeFormat('uk').date(r.date))),
    );
  });
});
