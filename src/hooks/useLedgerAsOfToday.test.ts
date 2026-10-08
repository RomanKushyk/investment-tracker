// @vitest-environment jsdom
// Mounted, because the step at midnight reaches the hook through the clock it subscribes to
// (*Review, gates, tests*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { keys } from './queries';
import { useLedgerAsOfToday } from './useLedgerAsOfToday';

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
const buy = (id: string, date: string): Transaction => ({
  id,
  date,
  type: 'buy',
  assetId: 'energy',
  amount: 1000,
  quantity: 100,
});
const quote = (date: string): Snapshot => ({ date, quotes: { energy: 1010 } });

const transactions = [buy('today', '2026-07-28'), buy('ahead', '2026-07-29')];
const snapshots = [quote('2026-07-28'), quote('2026-07-29')];

// The cache holds the rows before the hook mounts and never goes stale, so no query reads Dexie.
function seeded() {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(keys.assets, [fund]);
  client.setQueryData(keys.snapshots, snapshots);
  client.setQueryData(keys.transactions, transactions);
  return client;
}

function mount(client = seeded(), read = useLedgerAsOfToday) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(read, { wrapper });
}

describe('useLedgerAsOfToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 23, 59, 30)); // local 28.07, half a minute to midnight
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('hands over the ledger on or before today, and every asset', () => {
    const { result } = mount();
    expect(result.current.today).toBe('2026-07-28');
    expect(result.current.assets).toEqual([fund]);
    expect(result.current.transactions.map((t) => t.id)).toEqual(['today']);
    expect(result.current.snapshots.map((s) => s.date)).toEqual(['2026-07-28']);
    expect(result.current.ready).toBe(true);
  });

  it('is not ready until every list has loaded', () => {
    const client = seeded();
    client.removeQueries({ queryKey: keys.assets });
    const { result } = mount(client);
    expect(result.current.ready).toBe(false);
  });

  it('counts a row dated tomorrow once its day comes, without a remount', () => {
    const { result } = mount();
    expect(result.current.transactions.map((t) => t.id)).toEqual(['today']);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.today).toBe('2026-07-29');
    expect(result.current.transactions.map((t) => t.id)).toEqual(['today', 'ahead']);
    expect(result.current.snapshots.map((s) => s.date)).toEqual(['2026-07-28', '2026-07-29']);
  });

  it('moves every reader to the new day on the same tick, however far apart they mounted', () => {
    vi.setSystemTime(new Date(2026, 6, 28, 23, 59, 0));
    const client = seeded();
    const early = mount(client);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    const late = mount(client);
    // Half a second past midnight: a minute after the first mount, half a minute after the second.
    act(() => {
      vi.advanceTimersByTime(30_500);
    });
    expect([early.result.current.today, late.result.current.today]).toEqual([
      '2026-07-29',
      '2026-07-29',
    ]);
  });

  it('renders today on its first render when no other reader kept the clock running', () => {
    mount().unmount();
    vi.setSystemTime(new Date(2026, 6, 29, 0, 5)); // the next day, and no timer has fired since
    const seen: string[] = [];
    mount(seeded(), () => {
      const ledger = useLedgerAsOfToday();
      seen.push(ledger.today);
      return ledger;
    });
    expect(seen[0]).toBe('2026-07-29');
  });

  it('renders the new day on a mount past midnight, and moves the readers already mounted with it', async () => {
    const early = mount(); // the poll next fires half a minute past midnight
    vi.setSystemTime(new Date(2026, 6, 29, 0, 0, 5)); // past midnight, and no poll since
    const seen: string[] = [];
    mount(seeded(), () => {
      const ledger = useLedgerAsOfToday();
      seen.push(ledger.today);
      return ledger;
    });
    await act(async () => {});
    expect(seen[0]).toBe('2026-07-29');
    expect(early.result.current.today).toBe('2026-07-29');
  });

  it('keeps its identity across a render that changes nothing, so a memo keyed on it holds', () => {
    const { result, rerender } = mount();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
