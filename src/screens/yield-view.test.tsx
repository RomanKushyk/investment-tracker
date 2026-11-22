// @vitest-environment jsdom
// /yield's chart card (`charts.md` § Signed › Identity, Y4; `open-values-charts-type.md` § Signed):
// «Окремо» by default, the small multiples with no legend; «Разом» the combined chart with its
// legend row; a window where no asset has a line shows #338's message in place of either view, with
// no legend, and the toggle stays and works. Mounted through the router over a fake of the API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { ledgerUnits } from '@quirenote/core/derive';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { RouterProvider } from '../__fixtures__/router';
import { fakeApi, type FakeApi, type Rows } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const seedRows = (): Rows => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
// Every position sold out on 01.06, then a deposit on 27.07. A day after a full exit values nothing,
// and the deposit's day closes the windows (`rebuildSnapshots`), so «1 місяць» (27.06–27.07) holds
// a point and no line.
const soldOutRows = (): Rows => {
  const rows = seedRows();
  const kept = rows.transactions.filter((t) => t.date <= '2026-06-01');
  const units = ledgerUnits(kept, '2026-06-01').units;
  const sells = rows.assets
    .filter((a) => (units[a.id] ?? 0) > 0)
    .map((a, i) => ({
      id: `sold${i}`,
      date: '2026-06-01',
      type: 'sell' as const,
      assetId: a.id,
      amount: 1000,
      quantity: units[a.id],
    }));
  const deposit = {
    id: 'dep',
    date: '2026-07-27',
    type: 'deposit' as const,
    assetId: '',
    amount: 100,
  };
  return { ...rows, transactions: [...kept, ...sells, deposit] };
};

let api: FakeApi;
let hangSeries = false;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
  hangSeries && String(input).includes('/view/series')
    ? new Promise<Response>(() => {})
    : api.fetch(input, init),
);
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('scrollTo', () => {});
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('min-width'),
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
  class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width: 640 } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  },
);
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../routes');

afterEach(() => {
  cleanup();
  kept.clear();
  hangSeries = false;
});

async function open(rows: Rows, period?: string) {
  api = fakeApi(rows, { today: TODAY });
  if (period) api.settings = JSON.stringify({ period });
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: ['/yield'] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(
    () => {
      expect(document.querySelector('main h2')).not.toBeNull();
      expect(document.querySelector('main [aria-busy="true"]')).toBeNull();
      expect(client.isFetching()).toBe(0);
    },
    { timeout: 3_000 },
  );
}

const y = uk.analytics.yield;
const card = () => document.querySelector<HTMLElement>('[data-yield-card]')!;
const toggle = () => within(card()).getByRole('radiogroup', { name: y.viewAriaLabel });
const radio = (name: string) => within(toggle()).getByRole('radio', { name });
const grid = () => card().querySelector('[data-yield-grid]');
const combined = () => card().querySelector('[data-yield-combined]');
const legend = () => card().querySelector('[data-yield-legend]');

async function arrowTo(from: string, to: string) {
  const r = radio(from);
  act(() => r.focus());
  fireEvent.keyDown(r, { key: 'ArrowRight' });
  await waitFor(() => expect(radio(to).getAttribute('aria-checked')).toBe('true'));
}

describe('the views on the seed', () => {
  it('opens on «Окремо»: one panel per asset, no legend', async () => {
    await open(seedRows());
    expect(radio(y.viewSeparate).getAttribute('aria-checked')).toBe('true');
    expect(card().querySelectorAll('[data-yield-panel]')).toHaveLength(SEED.assets.length);
    expect(combined()).toBeNull();
    expect(legend()).toBeNull();
  });

  it('moves to «Разом» by arrow key: the combined chart and its legend row', async () => {
    await open(seedRows());
    await arrowTo(y.viewSeparate, y.viewCombined);
    expect(grid()).toBeNull();
    expect(combined()).not.toBeNull();
    expect(
      [...legend()!.querySelectorAll('[data-yield-legend-item]')].map((e) => e.textContent),
    ).toEqual(SEED.assets.map((a) => a.name));
  });
});

describe('a window where no asset has a line', () => {
  it('shows the message in place of the panels, with no legend, and the toggle stays', async () => {
    await open(soldOutRows(), '1m');
    expect(card().querySelector('[data-yield-no-line]')!.textContent).toBe(
      'За цей період жоден актив не має лінії — оберіть довший період.',
    );
    expect(grid()).toBeNull();
    expect(legend()).toBeNull();
    expect(radio(y.viewSeparate).getAttribute('aria-checked')).toBe('true');
  });

  it('shows it under «Разом» too, after the toggle moves', async () => {
    await open(soldOutRows(), '1m');
    await arrowTo(y.viewSeparate, y.viewCombined);
    expect(card().querySelector('[data-yield-no-line]')).not.toBeNull();
    expect(combined()).toBeNull();
    expect(legend()).toBeNull();
  });

  it('is not shown under «Від початку», where the same ledger draws its lines', async () => {
    await open(soldOutRows());
    expect(card().querySelector('[data-yield-no-line]')).toBeNull();
    expect(grid()).not.toBeNull();
  });
});

describe('the curve held after the view answers', () => {
  // Only the first read is held, so the held card is always «Окремо»'s: a period's curve stays on
  // show until the next lands, and the view the reader chose stays with it.
  it('under «Разом», keeps the combined chart while the next period’s curve is out', async () => {
    await open(seedRows());
    await arrowTo(y.viewSeparate, y.viewCombined);
    hangSeries = true;
    const { useSettings } = await import('../state/settings');
    act(() => useSettings.getState().setPeriod('1m'));
    // Past the hold's delay.
    await act(() => new Promise((r) => setTimeout(r, 1_500)));
    expect(document.querySelector('[data-yield-card][aria-busy="true"]')).toBeNull();
    expect(combined()).not.toBeNull();
    expect(radio(y.viewCombined).getAttribute('aria-checked')).toBe('true');
  });

  it('holds the toggle’s block and one chart block per asset, at r6', async () => {
    hangSeries = true;
    api = fakeApi(seedRows(), { today: TODAY });
    const router = createMemoryRouter(routes, { initialEntries: ['/yield'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const blocks = await waitFor(
      () => {
        const held = document.querySelector('[data-yield-card][aria-busy="true"]');
        expect(held).not.toBeNull();
        const found = held!.querySelectorAll<HTMLElement>('[data-placeholder="chart"]');
        expect(found.length).toBeGreaterThan(0);
        return found;
      },
      { timeout: 3_000 },
    );
    expect(blocks).toHaveLength(SEED.assets.length);
    for (const b of blocks) {
      expect(b.className.split(/\s+/).filter((c) => c.startsWith('rounded'))).toEqual([
        'rounded-[6px]',
      ]);
    }
    expect(document.querySelector('[data-yield-card] [data-placeholder="toggle"]')).not.toBeNull();
  });
});
