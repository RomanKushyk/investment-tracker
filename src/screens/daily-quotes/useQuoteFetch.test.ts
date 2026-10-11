// @vitest-environment jsdom
// One local store (#404): the Fetch quotes button waits on the feed and on a linked asset, and on
// no profile's dataset, so a linked asset on a fresh profile reads `idle` and a press reaches it.
import fixture from '@quirenote/core/inzhur/__fixtures__/assets-sample.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';
import { useQuoteFetch } from './useQuoteFetch';

// The draft store persists on every fill, and the node run has no localStorage (`draft.test.ts`).
vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
});

const linked: Asset = {
  id: 'reit',
  name: 'Inzhur REIT',
  code: 'RE',
  colorKey: 'reit',
  yieldType: 'div_cap',
  expectedPct: 14,
  targetPct: 40,
  payoutSchedule: 'monthly',
  firstPurchase: '2026-02-03',
  createdAt: '2026-02-03T10:00:00',
  inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 6164 },
};

function mount(assets: Asset[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useQuoteFetch(assets, { reit: 6164 }, []), { wrapper });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useQuoteFetch on a fresh profile', () => {
  it('reads idle for a linked asset, and unlinked for none', () => {
    expect(mount([linked]).result.current.state).toBe('idle');
    expect(mount([{ ...linked, inzhur: undefined }]).result.current.state).toBe('unlinked');
  });

  it('reaches the feed when pressed', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(fixture));
    const { result } = mount([linked]);

    result.current.fetchQuotes();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
