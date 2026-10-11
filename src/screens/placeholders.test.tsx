// @vitest-environment jsdom
// What each screen holds before its read answers (design/extensions/first-paint.dc.html): a box for
// every size that is known, the static words in place, «—» for every figure, and nothing a person
// could act on. The placeholders are read by no screen reader but the one status line.
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { uk } from '../i18n/messages';

// Set before the stores load: they read `localStorage` as they do.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
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

const SCREENS = {
  overview: P.OverviewPlaceholder,
  dailyQuotes: P.DailyQuotesPlaceholder,
  transactions: P.TransactionsPlaceholder,
  yield: P.YieldPlaceholder,
  balances: P.BalancesPlaceholder,
  payouts: P.PayoutsPlaceholder,
  attributes: P.AttributesPlaceholder,
  seasonality: P.SeasonalityPlaceholder,
  portfolio: P.PortfolioPlaceholder,
  allocation: P.AllocationPlaceholder,
} as const;

function mount(name: keyof typeof SCREENS) {
  const Screen = SCREENS[name];
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Screen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return view.container;
}

describe.each(Object.keys(SCREENS) as (keyof typeof SCREENS)[])('the %s placeholder', (name) => {
  it('is one busy screen, and holds its boxes', () => {
    const root = mount(name);
    const busy = root.querySelectorAll('[aria-busy="true"]');
    expect(busy).toHaveLength(1);
    expect(busy[0].querySelectorAll('[data-placeholder]').length).toBeGreaterThan(0);
  });

  it('hides every block and every «—» from assistive technology, and pulses each block', () => {
    const root = mount(name);
    const blocks = [...root.querySelectorAll('[data-placeholder]')];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.getAttribute('aria-hidden')).toBe('true');
      expect(block.className).toContain('animate-pulse');
    }
    const dashes = [...root.querySelectorAll('[data-dash]')];
    for (const dash of dashes) {
      expect(dash.getAttribute('aria-hidden')).toBe('true');
      expect(dash.textContent).toBe('—');
    }
  });

  it('holds nothing a person could act on: no period control, Edit, Add, ✕, link or field', () => {
    const root = mount(name);
    const actionable = root.querySelectorAll(
      'a, button, input, select, textarea, [tabindex], [role="button"], [role="tab"], [role="switch"], [role="combobox"], [role="radio"]',
    );
    expect([...actionable].map((e) => e.outerHTML)).toEqual([]);
  });

  it('says nothing aloud: the status line is the layout’s, and no placeholder carries one', () => {
    const root = mount(name);
    expect(root.querySelector('[role="status"], [aria-live]')).toBeNull();
  });
});

describe('what a placeholder keeps of its screen', () => {
  it('Overview keeps the label of every card and reads «—» for each figure', () => {
    const root = mount('overview');
    const text = root.textContent ?? '';
    for (const label of [
      uk.analytics.overview.totalCapital,
      uk.analytics.overview.capitalGain,
      uk.analytics.overview.totalReturnNet,
      uk.analytics.overview.depositedReinvested,
      uk.analytics.overview.freeCash,
      uk.analytics.overview.assets,
      uk.analytics.overview.nextPayouts,
      uk.analytics.overview.rebalanceHint,
      uk.analytics.overview.incomeReceived,
    ]) {
      expect(text).toContain(label);
    }
    expect(root.querySelectorAll('[data-dash]').length).toBeGreaterThanOrEqual(10);
  });

  it('Yield holds the chart as one block until its own read answers', () => {
    const root = mount('yield');
    expect(root.querySelectorAll('[data-placeholder="chart"]')).toHaveLength(1);
  });

  it('Transactions keeps the form’s title and holds its fields as one block', () => {
    const root = mount('transactions');
    expect(root.querySelectorAll('[data-placeholder="fields"]')).toHaveLength(1);
    expect(root.textContent).toContain(uk.transaction.title);
  });

  it('every list is three rows', () => {
    for (const name of ['overview', 'payouts', 'portfolio', 'allocation', 'balances'] as const) {
      const rows = mount(name).querySelectorAll('[data-placeholder-row]');
      expect(rows.length, name).toBeGreaterThanOrEqual(3);
      expect(rows.length % 3, name).toBe(0);
      cleanup();
    }
  });
});
