// @vitest-environment jsdom
// The four desktop tables wear one anatomy (tables.md § Signed, wave 6; Y2 in
// loading-and-compositions.md): a header band that stays at the top of the table's own box, 36 px
// zebra rows with no row lines, 8 + 8 cell padding with 12 at the row's ends, and `scope` on every
// `th`. Rendered through the real router over a fake of the user API, as a reader opens them.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { RouterProvider } from '../__fixtures__/router';
import { fakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

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
// jsdom scrolls nothing: the Scroller is told by the axes it was given and its viewport's classes.
vi.mock('../components/ui/Scroller', () => ({
  Scroller: ({
    children,
    orientation = 'vertical',
    className = '',
    radius,
  }: {
    children: ReactNode;
    orientation?: string;
    className?: string;
    radius?: number;
  }) => (
    <div data-scroller={orientation} data-viewport={className} data-radius={radius}>
      {children}
    </div>
  ),
}));

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// Desktop unless a test moves it, before the screen mounts.
const breakpoint = { desktop: true };
vi.stubGlobal('matchMedia', (query: string) => ({
  // A getter: the app holds one MediaQueryList and reads it on every render.
  get matches() {
    return query.includes('min-width') && breakpoint.desktop;
  },
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
afterEach(() => {
  cleanup();
  breakpoint.desktop = true;
});

const { routes } = await import('../routes');

async function table(path: string): Promise<HTMLTableElement> {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return waitFor(
    () => {
      // Not the placeholder's table: Баланси draws one while its page is out.
      expect(document.querySelector('main [aria-busy="true"]')).toBeNull();
      const found = document.querySelector<HTMLTableElement>('main table');
      expect(found).not.toBeNull();
      expect(found!.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
      return found!;
    },
    { timeout: 3_000 },
  );
}

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];
const has = (el: Element, ...want: string[]) =>
  expect(classes(el)).toEqual(expect.arrayContaining(want));

const ROUTES = ['/portfolio', '/balances', '/payouts', '/yield'] as const;

describe.each(ROUTES)('the table on %s', (path) => {
  it('heads every column on one band in the label role, sticking to its box, with a scope', async () => {
    const t = await table(path);
    has(t.querySelector('thead')!, 'sticky', 'top-0');
    has(t, 'border-separate', 'border-spacing-0');
    const heads = [...t.querySelectorAll('thead th')];
    expect(heads.length).toBeGreaterThan(1);
    for (const th of heads) {
      expect(th.getAttribute('scope')).toBe('col');
      // The band's opaque base and its tint, the label role, one line.
      has(th, 'bg-table-band', 'text-label-caps', 'uppercase', 'text-muted');
      has(th, 'whitespace-nowrap', 'first:rounded-l-[9px]', 'last:rounded-r-[9px]');
    }
  });

  it('draws 36 px zebra rows with no row lines, and every row takes the ink veil on hover', async () => {
    const t = await table(path);
    // Портфель's total is a sum, not a record: it stands apart (below).
    const records = [...t.querySelectorAll('tbody tr')].filter(
      (tr) => !tr.hasAttribute('data-total'),
    );
    expect(records.length).toBeGreaterThan(0);
    for (const tr of records) {
      has(tr, 'group/row');
      expect(classes(tr)).not.toContain('border-hairline');
      expect(classes(tr)).not.toContain('hover:bg-page/60');
      for (const cell of tr.children) {
        has(cell, 'h-9', 'group-even/row:bg-ink/3', 'group-hover/row:bg-ink/5');
        has(cell, 'first:rounded-l-[9px]', 'last:rounded-r-[9px]');
      }
    }
  });

  it('pads every cell 8 + 8, and 12 at the row ends, so no two columns touch', async () => {
    const t = await table(path);
    const cells = [...t.querySelectorAll('th, td')];
    for (const cell of cells) has(cell, 'px-2', 'first:pl-3', 'last:pr-3');
  });

  it('scrolls in a box of its own on both axes, at the signed height', async () => {
    const t = await table(path);
    const box = t.closest('[data-scroller]')!;
    expect(box.getAttribute('data-scroller')).toBe('both');
    expect(box.getAttribute('data-viewport')).toContain(
      'max-h-[max(200px,calc(100dvh-var(--table-top,197px)-80px))]',
    );
    // The gutter is fixed on both sides (*Scrolling*): a radius, never the rail-gated one.
    expect(box.getAttribute('data-radius')).toBe('24');
    // A control focused under the sticky band scrolls clear of it (WCAG 2.4.11).
    expect(box.getAttribute('data-viewport')).toContain('scroll-pt-9');
  });
});

describe('the Portfolio total', () => {
  it('keeps its 2 px panel-border rule on every cell, and takes no zebra or veil', async () => {
    const t = await table('/portfolio');
    const total = [...t.querySelectorAll('tbody tr')].at(-1)!;
    expect(total.textContent).toContain('Разом');
    expect(total.hasAttribute('data-total')).toBe(true);
    expect(classes(total)).not.toContain('group/row');
    for (const cell of total.children) has(cell, 'border-t-2', 'border-panel-border');
  });
});

describe('the /yield table (Y2)', () => {
  const column = (t: HTMLTableElement, head: string) => {
    const i = [...t.querySelectorAll('thead th')].findIndex((th) => th.textContent === head);
    expect(i).toBeGreaterThanOrEqual(0);
    return [
      t.querySelectorAll('thead th')[i],
      ...[...t.querySelectorAll('tbody tr')].map((tr) => tr.children[i]),
    ];
  };

  it('reads the basis columns muted, and draws a hairline after «Вартість зараз»', async () => {
    const t = await table('/yield');
    for (const cell of column(t, uk.analytics.invested).slice(1)) has(cell, 'text-muted');
    for (const cell of column(t, uk.analytics.valueNow).slice(1)) has(cell, 'text-muted');
    for (const cell of column(t, uk.analytics.valueNow)) has(cell, 'border-r', 'border-hairline');
  });

  it('colours XIRR on the record card as the table does', async () => {
    breakpoint.desktop = false;
    const router = createMemoryRouter(routes, { initialEntries: ['/yield'] });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const xirr = uk.analytics.yield.xirrAnn;
    const figures = await waitFor(
      () => {
        const dts = [...document.querySelectorAll('main dt')].filter(
          (dt) => dt.textContent === xirr,
        );
        expect(dts.length).toBeGreaterThan(0);
        return dts.map((dt) => dt.nextElementSibling!.querySelector('span')!);
      },
      { timeout: 3_000 },
    );
    for (const span of figures) {
      expect(classes(span).some((c) => ['text-pos', 'text-neg', 'text-muted'].includes(c))).toBe(
        true,
      );
    }
  });

  it('sets XIRR bold and signed', async () => {
    const t = await table('/yield');
    const xirr = [...t.querySelectorAll('thead th')].at(-2)!.textContent!;
    for (const cell of column(t, xirr).slice(1)) {
      has(cell, 'font-bold');
      expect(classes(cell).some((c) => ['text-pos', 'text-neg', 'text-muted'].includes(c))).toBe(
        true,
      );
    }
  });
});
