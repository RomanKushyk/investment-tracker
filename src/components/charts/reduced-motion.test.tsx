// @vitest-environment jsdom
// REDUCED MOTION DRAWS EVERY CHART SETTLED (#663; `charts.md` § Signed › Anatomy, Motion;
// *Interaction rules*). recharts honours `prefers-reduced-motion` only through
// `isAnimationActive: 'auto'`; a bare `true` animates regardless.
import { act, cleanup, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';

const motion = { reduce: false };
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('prefers-reduced-motion') && motion.reduce;
  },
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

const { AllocationDonut } = await import('./AllocationDonut');
const { BalancesArea } = await import('./BalancesArea');
const { PayoutsBars } = await import('./PayoutsBars');
const { SeasonalityBars } = await import('./SeasonalityBars');
const { YieldLines } = await import('./YieldLines');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  motion.reduce = false;
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05'];
const ASSETS = [
  { id: 'a1', name: 'Asset one', colorKey: 'reit' },
  { id: 'a2', name: 'Asset two', colorKey: 'energy' },
] as Asset[];

// Each chart at two data sets, so a data change is an update and not a mount.
const CHARTS: [string, (k: number) => ReactElement][] = [
  [
    'Balances',
    (k) => (
      <BalancesArea data={DATES.map((date, i) => ({ date, total: 100_000 + i * k * 1000 }))} />
    ),
  ],
  [
    'Payouts',
    (k) => (
      <PayoutsBars
        data={['Jan', 'Feb', 'Mar'].map((monthLabel, i) => ({
          monthLabel,
          dividends: 100 * k + i,
          coupons: 50 + i * k,
          totalLabel: String(150 + i),
        }))}
      />
    ),
  ],
  [
    'Seasonality',
    (k) => (
      <SeasonalityBars
        data={[
          { day: 1, actual: 596 * k, actualLabel: '596 ₴' },
          {
            day: 5,
            actual: 1764,
            expected: 1240 * k,
            actualLabel: '1 764 ₴',
            expectedLabel: '1 240 ₴*',
          },
        ]}
      />
    ),
  ],
  [
    'Yield',
    (k) => <YieldLines data={DATES.map((date, i) => ({ date, a1: i * k }))} assets={[ASSETS[0]]} />,
  ],
  [
    'Allocation',
    (k) => (
      <AllocationDonut
        slices={ASSETS.map((asset, i) => ({ asset, value: 100 + i * 50 * k }))}
        centerTop="1"
        centerSub="2"
      />
    ),
  ],
];

/** Everything the chart drew, as markup: a frame mid-animation differs from the settled one in a
 *  path, a bar's height, a sector's angle or a line's dash. */
const frame = (container: HTMLElement) =>
  container.querySelector('svg.recharts-surface')?.innerHTML ?? '';
const settle = () => act(() => vi.advanceTimersByTime(2000));

describe.each(CHARTS)('%s', (_name, chart) => {
  it('animates when reduced motion is not set: the first frame is not the last', () => {
    const { container } = render(chart(1));
    const first = frame(container);
    settle();
    expect(first).not.toBe(frame(container));
  });

  it('is drawn settled on its first frame with reduced motion set', () => {
    motion.reduce = true;
    const { container } = render(chart(1));
    const first = frame(container);
    settle();
    expect(first).toBe(frame(container));
  });

  it('is drawn settled on a data change with reduced motion set', () => {
    motion.reduce = true;
    const { container, rerender } = render(chart(1));
    settle();
    rerender(chart(2));
    const first = frame(container);
    settle();
    expect(first).toBe(frame(container));
  });
});
