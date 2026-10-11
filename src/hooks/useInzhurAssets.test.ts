// @vitest-environment jsdom
// One local store (#404): no profile is a demo that fetches no market data, so the picker and the
// Fetch quotes button reach the Inzhur feed on the user's press and on nothing else.
import fixture from '@quirenote/core/inzhur/__fixtures__/assets-sample.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  INZHUR_ASSETS_URL,
  INZHUR_LAST_FETCH_KEY,
  INZHUR_LAST_PARSE_KEY,
  useInzhurAssets,
  useLastParse,
} from './useInzhurAssets';

// The browser's own storage, held in a map: the caches below are what this device keeps.
const kept = new Map<string, string>();
function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
}

function wrapperOf(client: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook(useInzhurAssets, { wrapper: wrapperOf(client) });
}

beforeEach(() => {
  kept.clear();
  stubStorage();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useInzhurAssets', () => {
  it('requests nothing until pressed, then fetches the feed with no gate to withhold it', async () => {
    const fetchMock = vi.fn(async () => Response.json(fixture));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = mount();
    expect(Object.keys(result.current)).not.toContain('disabled');
    expect(fetchMock).not.toHaveBeenCalled();

    let feed: Awaited<ReturnType<typeof result.current.fetchAssets>>;
    await act(async () => {
      feed = await result.current.fetchAssets();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toContain(INZHUR_ASSETS_URL);
    expect(feed!.feed.entries.map((e) => e.ref)).toContain('inzhur-reit');
  });

  it('keeps the last fetch in the browser, and a fresh mount reads it back as the last good one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(fixture)),
    );
    const first = mount();
    await act(async () => {
      await first.result.current.fetchAssets();
    });
    expect(JSON.parse(kept.get(INZHUR_LAST_FETCH_KEY) ?? 'null')).toMatchObject({
      payload: fixture,
    });
    first.unmount();

    const second = mount();
    await waitFor(() => expect(second.result.current.lastGood).toBeDefined());
    expect(second.result.current.lastGood?.feed.entries.map((e) => e.ref)).toContain('inzhur-reit');
  });

  it('keeps what the last parse made of the payload, and reads it back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(fixture)),
    );
    const feed = mount();
    await act(async () => {
      await feed.result.current.fetchAssets();
    });
    expect(JSON.parse(kept.get(INZHUR_LAST_PARSE_KEY) ?? 'null')).toMatchObject({
      entries: expect.any(Number) as number,
      skipped: expect.any(Array) as unknown[],
    });

    const parse = renderHook(useLastParse, { wrapper: wrapperOf(new QueryClient()) });
    await waitFor(() => expect(parse.result.current).toBeDefined());
    expect(parse.result.current?.entries).toBeGreaterThan(0);
  });
});
