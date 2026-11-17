// @vitest-environment jsdom
// Below md the four tables are their records in ONE glass card (tables.md § Signed, R2), and the
// /portfolio total is that card's last record under a 2 px rule (loading-and-compositions.md).
// Rendered through the real router over a fake of the user API, as a reader opens them.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ComponentType } from 'react';
import { createMemoryRouter, MemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { RouterProvider } from '../__fixtures__/router';
import { fakeApi } from '../__fixtures__/fake-api';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const api = fakeApi(
  {
    assets: SEED.assets as Asset[],
    transactions: SEED.transactions as Transaction[],
    prices: SEED.prices,
  },
  { today: '2026-07-28' },
);
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
vi.mock('../components/charts/YieldLines', () => ({ YieldLines: () => null }));
vi.mock('../components/charts/BalancesArea', () => ({ BalancesArea: () => null }));
vi.mock('../components/charts/PayoutsBars', () => ({ PayoutsBars: () => null }));

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// The narrow shell: no `min-width` query matches.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const { routes } = await import('../routes');

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];

/** Each record of the screen: the element whose child is its `dl`. */
async function records(path: string): Promise<Element[]> {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return waitFor(
    () => {
      expect(document.querySelector('main [aria-busy="true"]')).toBeNull();
      const found = [...document.querySelectorAll('main dl')].map((dl) => dl.parentElement!);
      expect(found.length).toBeGreaterThan(1);
      return found;
    },
    { timeout: 3_000 },
  );
}

describe.each(['/yield', '/portfolio', '/payouts', '/balances'])('below md, %s', (path) => {
  it('holds every record in one glass card, nested at r18', async () => {
    const found = await records(path);
    const cards = new Set(found.map((record) => record.closest('.glass')));
    expect(cards.size).toBe(1);
    const [card] = cards;
    expect(card).not.toBeNull();
    expect(classes(card!)).toEqual(expect.arrayContaining(['rounded-3xl', 'p-1.5']));
    for (const record of found) {
      expect(record.parentElement).toBe(card);
      expect(classes(record)).toEqual(expect.arrayContaining(['rounded-[18px]', 'p-4']));
    }
  });
});

// A placeholder is its screen's own composition, its glass cards at their real size
// (loading-and-compositions.md § Signed): one card of nested records, as the screen it holds.
describe('below md, the placeholders', () => {
  it.each([
    'YieldPlaceholder',
    'BalancesPlaceholder',
    'PayoutsPlaceholder',
    'PortfolioPlaceholder',
  ])('%s holds three records in one glass card, nested at r18', async (name) => {
    const P = (await import('./placeholders')) as unknown as Record<string, ComponentType>;
    const Screen = P[name];
    const root = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Screen />
        </MemoryRouter>
      </QueryClientProvider>,
    ).container;
    const slots = [...root.querySelectorAll('[data-placeholder-record]')];
    expect(slots).toHaveLength(3);
    const cards = new Set(slots.map((slot) => slot.parentElement));
    expect(cards.size).toBe(1);
    const [card] = cards;
    expect(classes(card!)).toEqual(expect.arrayContaining(['glass', 'rounded-3xl', 'p-1.5']));
    for (const slot of slots) {
      expect(classes(slot)).toEqual(
        expect.arrayContaining(['rounded-[18px]', 'p-4', 'even:bg-ink/3']),
      );
    }
  });
});

describe('below md, the /portfolio total', () => {
  it('is the card’s last record, under a 2 px rule', async () => {
    const found = await records('/portfolio');
    const total = found.at(-1)!;
    expect(total).toBe(total.parentElement!.lastElementChild);
    expect(total.querySelector('h3')!.textContent).toMatch(/Разом/);
    // A drawn line, not `border-top`, which bends into the record's rounded corners.
    const rule = total.querySelector(':scope > [data-rule]')!;
    expect(rule).not.toBeNull();
    expect(classes(rule)).toEqual(expect.arrayContaining(['h-0.5', 'bg-panel-border', 'absolute']));
    expect(classes(total)).toContain('relative');
    expect(classes(total)).not.toContain('border-t-2');
  });
});
