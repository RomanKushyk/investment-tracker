// @vitest-environment jsdom
// The placeholder fill: `ink` at 7 %, a tint of the text that follows the glass in both themes
// (`empty-loading-error.md` § Signed, P2).
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { Block } from '../components/loading/Placeholder';

// Set before the stores load: they read `localStorage` as they do.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
// A getter: `useIsDesktop` keeps the first MediaQueryList it is handed, so the shell follows `wide`.
let wide = true;
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return wide && query.includes('min-width');
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

const P = await import('./placeholders');

afterEach(cleanup);

const FILL = 'bg-ink/7';

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
/** Every background on an element: its `bg-` and `[background…]` utilities, whatever the variant,
 *  and an inline background. */
const fills = (el: Element) => [
  ...classes(el).filter((c) => /(^|:)!?(bg-|\[background)/.test(c)),
  ...((el.getAttribute('style') ?? '').includes('background') ? ['style'] : []),
];
// Exact: `panel-border` is another token (`dropzone-edge.test.ts` makes the same point).
const PANEL = /panel(?![-\w])/;
/** A `panel` utility in any spelling, or an inline style naming it. */
const paintsPanel = (el: Element) =>
  classes(el).some((c) => PANEL.test(c)) || PANEL.test(el.getAttribute('style') ?? '');

describe('a placeholder block', () => {
  it('is filled with ink at 7 % and nothing else', () => {
    const { container } = render(<Block />);
    expect(fills(container.querySelector('[data-placeholder]')!)).toEqual([FILL]);
  });
});

// BalancesTablePlaceholder takes props and is reached through BalancesPlaceholder.
const SCREENS = [
  'OverviewPlaceholder',
  'QuoteRowsPlaceholder',
  'DailyQuotesPlaceholder',
  'TransactionsPlaceholder',
  'YieldPlaceholder',
  'BalancesPlaceholder',
  'PayoutsPlaceholder',
  'AttributesPlaceholder',
  'SeasonalityPlaceholder',
  'PortfolioPlaceholder',
  'AllocationPlaceholder',
] as const;

it('sweeps every placeholder the module exports', () => {
  expect(Object.keys(P).sort()).toEqual([...SCREENS, 'BalancesTablePlaceholder'].sort());
});

describe.each([true, false])('wide %s', (isWide) => {
  describe.each(SCREENS)('%s', (name) => {
    it('fills every block with ink at 7 % alone, and paints panel nowhere', () => {
      wide = isWide;
      const Screen = P[name];
      const { container } = render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <Screen />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      const blocks = [...container.querySelectorAll('[data-placeholder]')];
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) expect(fills(block)).toEqual([FILL]);
      const panel = [...container.querySelectorAll('*')].filter(paintsPanel);
      expect(panel.map((el) => el.outerHTML)).toEqual([]);
    });
  });
});
