// @vitest-environment jsdom
// A new account's empty cards (empty-loading-error.md § Signed, E2): each says why it is empty
// under its subject's nav glyph, no frame is left bare, and none carries an action. Rendered through
// the real router over a fake of the user API holding nothing, at both shells.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../__fixtures__/router';
import { fakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const api = fakeApi({}, { today: '2026-07-28' });
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
vi.mock('../components/charts/YieldLines', () => ({ YieldLines: () => null }));
vi.mock('../components/charts/YieldPanels', () => ({ YieldPanels: () => null }));
vi.mock('../components/charts/BalancesArea', () => ({ BalancesArea: () => null }));
vi.mock('../components/charts/PayoutsBars', () => ({ PayoutsBars: () => null }));

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
const shell = { desktop: true };
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && shell.desktop;
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
afterEach(cleanup);

const { routes } = await import('../routes');
const { ANALYTICS } = await import('../app/Sidebar');

type NavKey = (typeof ANALYTICS)[number]['key'];

// The signed copy, verbatim: the dictionary is what is under test.
const PAYOUTS_CHART = 'Виплат ще не записано — дивіденди й купони з’являться тут, за місяцями.';
const PAYOUTS_TABLE = 'Виплат ще немає — кожна записана виплата стане рядком цієї таблиці.';
const TARGETS = 'Цілей ще немає — їх можна задати, щойно в портфелі з’явиться актив.';
const PLAN = 'Плану ще немає — він з’явиться, коли будуть і активи, і цілі.';

const lucide = (el: Element) =>
  (el.getAttribute('class')?.split(/\s+/) ?? []).filter((c) => c.startsWith('lucide-')).sort();

/** The lucide classes of the glyph the nav draws for `key`: the empty card's must match. */
function navGlyph(key: NavKey): string[] {
  const { Icon } = ANALYTICS.find((a) => a.key === key)!;
  const { container, unmount } = render(<Icon />);
  const out = lucide(container.querySelector('svg')!);
  unmount();
  return out;
}

const SCREENS: { path: string; lines: [string, NavKey][] }[] = [
  {
    path: '/payouts',
    lines: [
      [PAYOUTS_CHART, 'payouts'],
      [PAYOUTS_TABLE, 'payouts'],
      [uk.analytics.noUpcoming, 'payouts'],
    ],
  },
  {
    path: '/allocation',
    lines: [
      [uk.analytics.empty.allocation, 'allocation'],
      [TARGETS, 'allocation'],
      [PLAN, 'allocation'],
    ],
  },
  {
    path: '/overview',
    lines: [
      [uk.assets.empty, 'portfolio'],
      [uk.analytics.empty.rebalance, 'allocation'],
      [uk.analytics.noUpcoming, 'payouts'],
    ],
  },
  {
    path: '/balances',
    lines: [
      [uk.analytics.empty.chart, 'balances'],
      [uk.analytics.empty.table, 'balances'],
    ],
  },
  { path: '/yield', lines: [[uk.analytics.empty.chart, 'yield']] },
];

describe.each([
  ['at md and up', true],
  ['below md', false],
])('a new account, %s', (_, desktop) => {
  it.each(SCREENS)(
    '$path: every empty card says why, under its subject’s glyph',
    async ({ path, lines }) => {
      shell.desktop = desktop;
      const router = createMemoryRouter(routes, { initialEntries: [path] });
      render(
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      );
      await waitFor(
        () => {
          expect(document.querySelector('main [aria-busy="true"]')).toBeNull();
          expect(screen.getAllByText(lines[0][0]).length).toBeGreaterThan(0);
        },
        { timeout: 3_000 },
      );
      for (const [line, key] of lines) {
        const found = screen.getAllByText(line);
        expect(found, line).toHaveLength(1);
        const state = found[0].parentElement!;
        const glyph = state.querySelector('svg');
        expect(glyph, line).not.toBeNull();
        expect(lucide(glyph!), line).toEqual(navGlyph(key));
        // A table's cell spans its min-width, not the box you see, and hovers as a row.
        expect(state.closest('table'), `${line} sits in a table`).toBeNull();
        expect(
          state.querySelector('button, a, [role="button"], [role="link"]'),
          `${line} carries an action`,
        ).toBeNull();
      }
    },
  );
});
