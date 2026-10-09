// @vitest-environment jsdom
// The Balances table pages by core's one size, the same the server's page is cut by (#189): mocked
// here to a size no hard-coded page has, the screen shows it.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '@quirenote/core/seed';
import type { Snapshot } from '@quirenote/core/types';

const SNAPSHOTS = buildSeedSnapshots();
let snapshots: Snapshot[] = SNAPSHOTS;

vi.mock('@quirenote/core/view/balances-page', () => ({ BALANCES_PAGE_SIZE: 4 }));
vi.mock('../hooks/useLedgerAsOfToday', () => ({
  useLedgerAsOfToday: () => ({
    assets: SEED_ASSETS,
    snapshots,
    transactions: SEED_TRANSACTIONS,
    ready: true,
  }),
}));
// The chart is not what is measured, and jsdom lays nothing out for it.
vi.mock('../components/charts/BalancesArea', () => ({ BalancesArea: () => null }));
vi.mock('../hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('../components/ui/Scroller', () => ({
  Scroller: ({ children }: { children: ReactNode }) => children,
}));

const { Balances } = await import('./Balances');

afterEach(() => {
  cleanup();
  snapshots = SNAPSHOTS;
});

const firstDates = (container: HTMLElement) =>
  [...container.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.textContent);

describe('the Balances table', () => {
  it('shows a page of the size core names', () => {
    const { container } = render(<Balances />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
  });

  // A replace or a clear in another tab re-renders this screen in place (`useDbSync`): a page the
  // new rows do not reach starts over rather than showing an empty table.
  it('starts over on the first page when the rows shrink under the one it is on', () => {
    const { container, rerender } = render(<Balances />);
    const first = firstDates(container);
    // The pager's second button steps forward.
    const next = () => container.querySelectorAll('button')[1];
    for (let i = 0; i < 5; i++) fireEvent.click(next());
    expect(firstDates(container)).not.toEqual(first);

    snapshots = SNAPSHOTS.slice(-6);
    act(() => rerender(<Balances />));
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4);
    expect(firstDates(container)).toEqual(firstDates(render(<Balances />).container));
  });
});
