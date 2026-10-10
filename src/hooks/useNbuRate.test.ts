// @vitest-environment jsdom
// One local store (#404): no profile is a demo that fetches no market data, so the press is the
// only thing between the Settings button and the NBU directory.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useNbuRate } from './useNbuRate';

vi.mock('../lib/repository', () => ({
  repo: { getMeta: vi.fn(async () => undefined), setMeta: vi.fn(async () => undefined) },
}));

// Verbatim from the live endpoint, as `core/nbu/rate.test.ts` holds it.
const OK =
  '[\n{ \n"r030":840,"txt":"Долар США","rate":44.866,"cc":"USD","exchangedate":"12.08.2026","special":"N"\n }\n]';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(useNbuRate, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useNbuRate', () => {
  it('fetches on the press and hands the rate back, with no gate to withhold it', async () => {
    const fetchMock = vi.fn(async () => new Response(OK));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = mount();
    expect(Object.keys(result.current)).not.toContain('disabled');

    let rate: Awaited<ReturnType<typeof result.current.fetchRate>>;
    await act(async () => {
      rate = await result.current.fetchRate();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(rate!).toMatchObject({ rate: 44.866, date: '2026-08-12', currency: 'USD' });
  });
});
