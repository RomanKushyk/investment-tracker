// @vitest-environment jsdom
// Chart text is data, so it is set in JetBrains Mono (`type.md` § Signed, R2), and
// `clampLabelX`'s `MONO_ADVANCE` is only true in that face.
import { act, cleanup, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';

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
afterAll(() => vi.unstubAllGlobals());

// jsdom lays nothing out, so the container hands its chart a fixed size instead of measuring one.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 400, height: 200 }),
}));

const { BalancesArea } = await import('./BalancesArea');
const { PayoutsBars } = await import('./PayoutsBars');
const { SeasonalityBars } = await import('./SeasonalityBars');
const { YieldLines } = await import('./YieldLines');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05'];
const ASSET = { id: 'a1', name: 'Asset one', colorKey: 'reit' } as Asset;

const CHARTS: [string, ReactElement][] = [
  ['Balances', <BalancesArea data={DATES.map((date, i) => ({ date, total: 100_000 + i }))} />],
  [
    'Payouts',
    <PayoutsBars
      data={['Jan', 'Feb', 'Mar'].map((monthLabel, i) => ({
        monthLabel,
        dividends: 100 + i,
        coupons: 50 + i,
        totalLabel: `${150 + i} ₴`,
      }))}
    />,
  ],
  [
    'Seasonality',
    <SeasonalityBars
      data={[
        { day: 1, actual: 596, actualLabel: '596 ₴' },
        { day: 5, actual: 1764, expected: 1240, actualLabel: '1 764 ₴', expectedLabel: '1 240 ₴*' },
        { day: 10, actual: 0, expected: 216, expectedLabel: '216 ₴*' },
      ]}
    />,
  ],
  ['Yield', <YieldLines data={DATES.map((date, i) => ({ date, a1: i }))} assets={[ASSET]} />],
];

describe.each(CHARTS)('%s chart text', (_name, chart) => {
  it('is set in the mono face: every <text> sits in a `font-mono`', () => {
    const { container } = render(chart);
    // The bars animate in, and their value labels follow the animation's end.
    act(() => vi.advanceTimersByTime(2000));
    const texts = [...container.querySelectorAll('svg text')];
    expect(texts.length, 'the chart drew no text').toBeGreaterThan(0);
    const bare = texts.filter((t) => !t.closest('.font-mono')).map((t) => t.textContent);
    expect(bare, 'chart text outside the mono face').toEqual([]);
  });

  it('opens its tooltip in the mono face', () => {
    const { container } = render(chart);
    const wrapper = container.querySelector('[data-chart-tooltip]');
    // recharts' accessibility layer is on by default: the keyboard walk is announced.
    expect(wrapper?.getAttribute('role')).toBe('status');
    expect(wrapper?.getAttribute('aria-live')).toBe('assertive');
    expect(wrapper, 'no tooltip content').not.toBeNull();
    expect(wrapper?.classList.contains('font-mono')).toBe(true);
  });
});

// The value labels are the text `MONO_ADVANCE` estimates, so the list above must reach them.
it('reaches the Seasonality value labels, not only the ticks', () => {
  const { container } = render(CHARTS[2][1]);
  act(() => vi.advanceTimersByTime(2000));
  const labels = [...container.querySelectorAll('svg text')].map((t) => t.textContent);
  expect(labels).toEqual(expect.arrayContaining(['596 ₴', '1 764 ₴ · 1 240 ₴*', '216 ₴*']));
});
