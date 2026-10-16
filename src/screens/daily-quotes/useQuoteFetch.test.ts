// @vitest-environment jsdom
// One local store (#404): the Fetch quotes button waits on the feed and on a linked asset, and on
// no profile's dataset, so a linked asset on a fresh profile reads `idle` and a press reaches it.
import fixture from '@quirenote/core/inzhur/__fixtures__/assets-sample.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { todayIso } from '@quirenote/core/dates';
import { inputValue } from '@quirenote/core/money';
import type { Asset } from '@quirenote/core/types';
import { inzhurKeys } from '../../hooks/useInzhurAssets';
import { useDraft } from '../../state/draft';
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

/** The fixture's REIT `sell` × the 6164 units, the figure `fetch-quotes.test.ts` pins. */
const REIT_FILL = inputValue(68660.18, 2);

/** A day before today for good: the feed is struck for today, so it has no use for this one. */
const ANOTHER_DAY = '2026-02-03';

function mount(assets: Asset[], today = todayIso()) {
  // No backoff: the feed query keeps its own `retry`, so a failure runs out at once.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useQuoteFetch(assets, { reit: 6164 }, [], today), { wrapper });
  return { ...hook, client };
}

/** Lets a press that was going to fetch reach the mock and fill before anything is read. */
const flush = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useDraft.getState().setDate('');
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

  it('on today set as the date, as the screen sets it, reads idle and a press fills', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(fixture));
    useDraft.getState().setDate(todayIso());
    const { result } = mount([linked]);

    expect(result.current.state).toBe('idle');
    result.current.fetchQuotes();

    await waitFor(() => expect(useDraft.getState().quotes.reit).toBe(REIT_FILL));
  });

  it('on today, a press fills the empty linked row with units × sell', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(fixture));
    const { result } = mount([linked]);

    result.current.fetchQuotes();

    await waitFor(() => expect(useDraft.getState().quotes.reit).toBe(REIT_FILL));
  });
});

describe('useQuoteFetch on a date other than today', () => {
  // The feed's price is struck for today (#435): on any other day the button is gated, a press
  // reaches no feed, and nothing is filled — the day would otherwise store today's price as its own.
  it('gates the button, and a press neither fetches nor fills', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(fixture));
    useDraft.getState().setDate(ANOTHER_DAY);
    const { result } = mount([linked]);

    expect(result.current.state).toBe('otherDay');

    result.current.fetchQuotes();
    await flush();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(useDraft.getState().quotes.reit).toBeUndefined();
  });

  it('fills nothing when the date moved off today while the feed was in flight', async () => {
    let land: (value: Response) => void = () => {};
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => new Promise<Response>((resolve) => (land = resolve)));
    const { result } = mount([linked]);

    result.current.fetchQuotes();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => useDraft.getState().setDate(ANOTHER_DAY));
    land(Response.json(fixture));

    await waitFor(() => expect(result.current.feedFetchedAt).toBeDefined());
    await flush();
    expect(useDraft.getState().quotes.reit).toBeUndefined();
  });

  it('neither shows nor accepts an offer made on today', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(fixture));
    useDraft.getState().setDate(todayIso());
    useDraft.getState().setQuote('reit', '1');
    const { result } = mount([linked]);

    result.current.fetchQuotes();
    await waitFor(() => expect(result.current.offerFor(linked)).toBeDefined());
    // The screen's prefill writes the other day's saved quote back as the user's own.
    act(() => {
      useDraft.getState().setDate(ANOTHER_DAY);
      useDraft.getState().setQuote('reit', '2');
    });

    expect(result.current.offerFor(linked)).toBeUndefined();
    act(() => result.current.acceptOffer('reit'));
    expect(useDraft.getState().quotes.reit).toBe('2');
  });

  it('raises no failure toast for a fetch that fails after the date moved off today', async () => {
    let fail: (reason: unknown) => void = () => {};
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((_, reject) => (fail = reject)))
      .mockImplementation(() => Promise.reject(new TypeError('offline')));
    const failure = vi.spyOn(toast, 'error');
    const { result, client } = mount([linked]);

    result.current.fetchQuotes();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    act(() => useDraft.getState().setDate(ANOTHER_DAY));
    fail(new TypeError('offline'));
    // On the query, not the button: the button reads `otherDay` the moment the date moves.
    await waitFor(() => expect(client.getQueryState(inzhurKeys.assets)?.status).toBe('error'));
    await flush();

    expect(failure).not.toHaveBeenCalled();
  });

  it('dismisses the failure toast when the date leaves today', () => {
    const dismiss = vi.spyOn(toast, 'dismiss');
    const { rerender } = mount([linked]);
    expect(dismiss).not.toHaveBeenCalledWith('fetch-failed');

    act(() => useDraft.getState().setDate(ANOTHER_DAY));
    rerender();

    expect(dismiss).toHaveBeenCalledWith('fetch-failed');
  });
});
