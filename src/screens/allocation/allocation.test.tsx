// @vitest-environment jsdom
// /allocation's tall segmented bar (`charts.md` § Signed › Forms, A3): the total above, then one part
// per quoted asset in the legend's order, as wide as its share, with its share inside only where
// the label fits, then the legend. Mounted on the seed through the router and a fake of the API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { SERIES } from '@quirenote/core/colors';
import { makeFormat } from '@quirenote/core/money';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { viewBody } from '@quirenote/core/view/serve';
import { RouterProvider } from '../../__fixtures__/router';
import { fakeApi, type FakeApi, type Rows } from '../../__fixtures__/fake-api';
import { uk } from '../../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const f = makeFormat('uk');
const seedRows = (): Rows => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
const allocationOf = (rows: Rows) =>
  viewBody({
    assets: rows.assets,
    transactions: rows.transactions,
    userPrices: rows.prices,
    archiveRows: [],
    paymentDates: [],
    today: TODAY,
    fx: undefined,
  }).view.allocation;

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
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
// jsdom lays nothing out: every observed box reports the width a test sets, as a browser reports
// a box's size once when it is first observed.
let width = 296;
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback(
        [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  },
);
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../../routes');

afterEach(() => {
  cleanup();
  width = 296;
});

async function open(rows: Rows) {
  api = fakeApi(rows, { today: TODAY });
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: ['/allocation'] });
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

const bar = () => document.querySelector<HTMLElement>('[data-allocation-bar]');
const parts = () => [...document.querySelectorAll<HTMLElement>('[data-allocation-part]')];
const legend = () => document.querySelector<HTMLElement>('[data-allocation-legend]')!;
const before = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('the allocation bar on the seed', () => {
  const { rows } = allocationOf(seedRows());

  it('draws a part per asset in the legend’s order, each as wide as its share', async () => {
    await open(seedRows());
    expect(bar()!.className).toContain('h-7');
    expect(document.querySelector('[data-allocation-parts]')!.className).toContain('gap-[2px]');
    expect(parts().map((p) => p.dataset.allocationPart)).toEqual(rows.map((r) => r.asset.id));
    parts().forEach((part, i) => {
      expect(part.className).toContain('rounded-[4px]');
      // The fit rule measures in JetBrains Mono's advance, true in that face alone.
      expect(part.className).toContain('font-mono');
      expect(Number(part.style.flexGrow)).toBeCloseTo(rows[i].share!, 6);
    });
  });

  it('prints a share inside a part only where it fits, in the slot’s label colour', async () => {
    await open(seedRows());
    const labels = parts().map((p) => p.textContent);
    // 296 px: 46,1 % and 40,3 % fit; 10,6 % needs 48 px of a 31 px part; 2,9 % has 9.
    expect(labels).toEqual([f.pctPlain(rows[0].share!), f.pctPlain(rows[1].share!), '', '']);
    for (const [i, part] of parts().slice(0, 2).entries()) {
      expect(part.style.color).toBe(SERIES[rows[i].asset.colorKey].label);
      // A label that starts to fit as its part grows waits out the growth, never clipped by it.
      expect(part.querySelector('span')!.className).toContain('animate-label-in');
    }
  });

  it('leaves free cash its share of the bar unpainted, so a part is as wide as its label says', async () => {
    const seed = seedRows();
    const rich: Rows = {
      ...seed,
      transactions: [
        ...seed.transactions,
        { id: 'd9', date: '2026-07-28', type: 'deposit', assetId: '', amount: 100_000 },
      ],
    };
    await open(rich);
    const shares = allocationOf(rich).rows.map((r) => r.share!);
    const held = shares.reduce((a, b) => a + b, 0);
    expect(held).toBeLessThan(65);
    const grow = (el: Element | null) => Number((el as HTMLElement).style.flexGrow);
    expect(grow(document.querySelector('[data-allocation-parts]'))).toBeCloseTo(held, 6);
    expect(grow(document.querySelector('[data-allocation-rest]'))).toBeCloseTo(100 - held, 6);
  });

  it('fits a label against the part as drawn, short of the cash left unpainted', async () => {
    const seed = seedRows();
    // About 40 % cash: at 196 px REIT's part is ~51 px and holds its label, Energy's ~45 px does
    // not; measured against the whole bar, as if the parts filled it, Energy's would read ~77.
    width = 196;
    await open({
      ...seed,
      transactions: [
        ...seed.transactions,
        { id: 'd9', date: '2026-07-28', type: 'deposit', assetId: '', amount: 100_000 },
      ],
    });
    expect(parts().map((p) => p.textContent !== '')).toEqual([true, false, false, false]);
  });

  it('follows the bar’s width: a wider one fits a third label', async () => {
    width = 1000;
    await open(seedRows());
    expect(parts().map((p) => p.textContent !== '')).toEqual([true, true, true, false]);
  });

  it('sits under the total and its sub-line, and over the legend', async () => {
    await open(seedRows());
    const text = (s: string) =>
      [...document.querySelectorAll('main *')].find(
        (el) => el.childElementCount === 0 && el.textContent === s,
      )!;
    const total = text(uk.analytics.allocation.centerTotal(149));
    const sub = text(uk.analytics.allocation.assetsPlusCash(4));
    expect(before(total, sub)).toBe(true);
    expect(before(sub, bar()!)).toBe(true);
    expect(before(bar()!, legend())).toBe(true);
    expect([...legend().children].map((row) => row.textContent)).toEqual(
      rows.map((r) => r.asset.name + f.pctPlain(r.share!)),
    );
  });
});

describe('the allocation bar’s states', () => {
  it('gives an asset no snapshot quotes no part, and «—» in the legend', async () => {
    const NEW: Asset = {
      id: 'new',
      name: 'New fund',
      code: 'NF',
      colorKey: 'reit',
      yieldType: 'capitalization',
      expectedPct: 12,
      targetPct: 0,
      payoutSchedule: 'none',
      firstPurchase: '2026-07-20',
      createdAt: '2026-07-20T10:00:00',
    };
    const seed = seedRows();
    await open({
      ...seed,
      assets: [...seed.assets, NEW],
      transactions: [
        ...seed.transactions,
        { id: 'd9', date: '2026-07-20', type: 'deposit', assetId: '', amount: 5000 },
        // No quantity: the ledger cannot count the units, and no snapshot values them.
        { id: 'b9', date: '2026-07-20', type: 'buy', assetId: 'new', amount: 5000 },
      ],
    });
    expect(parts().map((p) => p.dataset.allocationPart)).not.toContain('new');
    expect(parts()).toHaveLength(4);
    const row = [...legend().children].find((r) => r.textContent!.startsWith('New fund'))!;
    expect(row.textContent).toBe('New fund—' + uk.analytics.notComputable);
  });

  it('draws no bar while the ledger is short, and every legend share reads «—»', async () => {
    const seed = seedRows();
    await open({
      ...seed,
      transactions: [
        ...seed.transactions,
        { id: 'w9', date: '2026-07-28', type: 'withdrawal', assetId: '', amount: 200_000 },
      ],
    });
    expect(bar()).toBeNull();
    for (const row of legend().children)
      expect(row.textContent!.endsWith('—' + uk.analytics.notComputable)).toBe(true);
  });
});
