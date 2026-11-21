// @vitest-environment jsdom
// What each screen holds before its read answers: a box for every size that is known, the static
// words in place, «—» for every figure, and nothing a person could act on. The placeholders are
// read by no screen reader but the one status line.
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

  it('Overview holds the capital card’s figure and both its sub-lines as «—», and names no rate', () => {
    const root = mount('overview');
    const label = [...root.querySelectorAll('div')].find(
      (d) => d.textContent === uk.analytics.overview.totalCapital,
    )!;
    const value = label.nextElementSibling!;
    expect(value.querySelectorAll('[data-dash]')).toHaveLength(1);
    expect(value.nextElementSibling!.querySelectorAll('[data-dash]')).toHaveLength(2);
    // The rate is the view's, so nothing is known of it before the view answers.
    const subtitle = root.querySelector('p')!.textContent;
    expect(subtitle).toMatch(/ · \d{2}\.\d{2}\.\d{4}$/);
    expect(subtitle).not.toMatch(/курс|₴\/\$/);
  });

  it('Yield holds the chart as one block until its own read answers', () => {
    const root = mount('yield');
    expect(root.querySelectorAll('[data-placeholder="chart"]')).toHaveLength(1);
  });

  // Wave 23 L2 (`loading-and-compositions.md` § Signed): a chart is a block of its size at r6, not
  // the concentric 2 (*Shape system*).
  it('Balances holds the capital chart as one block of its size at r6', () => {
    const blocks = mount('balances').querySelectorAll('[data-placeholder="chart"]');
    expect(blocks).toHaveLength(1);
    const classes = blocks[0].className.split(/\s+/);
    expect(classes).toContain('h-[260px]');
    expect(classes.filter((c) => c.startsWith('rounded'))).toEqual(['rounded-[6px]']);
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

  // attributes-item.md § Signed, the loading placeholder.
  it('Attributes holds each item as its avatar circle, two text bars, the hero and the bar', () => {
    const root = mount('attributes');
    const items = [...root.querySelectorAll('[data-placeholder="avatar"]')].map((avatar) =>
      avatar.closest('.glass')!,
    );
    expect(items).toHaveLength(3);
    for (const card of items) {
      const blocks = [...card.querySelectorAll<HTMLElement>('[data-placeholder]')];
      expect(blocks.map((b) => b.dataset.placeholder)).toEqual([
        'avatar',
        'bar',
        'bar',
        'hero',
        'track',
      ]);
      const [avatar, , , hero, track] = blocks;
      expect(avatar.className).toContain('size-11');
      expect(avatar.className).toContain('rounded-full');
      expect(hero.className).toContain('h-9');
      expect(track.className).toContain('h-2');
    }
  });
});
