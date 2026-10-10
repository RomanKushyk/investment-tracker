// @vitest-environment jsdom
// One local store (#404): no profile is a demo that fetches no market data, so the picker and the
// Fetch quotes button reach the Inzhur feed on the user's press and on nothing else.
import fixture from '@quirenote/core/inzhur/__fixtures__/assets-sample.json';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INZHUR_ASSETS_URL, useInzhurAssets } from './useInzhurAssets';

vi.mock('../lib/repository', () => ({
  repo: { getMeta: vi.fn(async () => undefined), setMeta: vi.fn(async () => undefined) },
}));

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(useInzhurAssets, { wrapper });
}

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
});
