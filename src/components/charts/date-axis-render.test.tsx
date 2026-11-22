// @vitest-environment jsdom
// The axes as drawn (`charts.md` § Signed › Anatomy, C2; wave 23's twelve months at 360; wave 25's
// y steps): a date axis prints seven dates on a plot 500 px wide or more and the first, middle and
// last on a narrower one, a month axis of up to twelve months prints every month, and /balances'
// y labels sit on 1-2-5 gridlines.
import { cleanup, render } from '@testing-library/react';
import { cloneElement, createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';
import { MONO_ADVANCE, TICK } from './anatomy';

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
// The container's own width, which /yield's grid reads to pick its columns.
let width = 800;
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

// jsdom lays nothing out: the chart gets the width a test sets, and recharts' measuring span gets
// the tick face's monospaced width, so recharts thins labels here as it does in a browser.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width, height: 240 }),
}));
beforeAll(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const w = (this.textContent ?? '').length * TICK.fontSize * MONO_ADVANCE;
    return { width: w, height: 14, top: 0, left: 0, right: w, bottom: 14, x: 0, y: 0 } as DOMRect;
  });
});

const { BalancesArea } = await import('./BalancesArea');
const { YieldPanels } = await import('./YieldPanels');
const { YieldLines } = await import('./YieldLines');
const { PayoutsBars } = await import('./PayoutsBars');

afterEach(() => {
  cleanup();
  width = 800;
});

const DATES = Array.from({ length: 30 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
const CAPITAL = DATES.map((date, i) => ({ date, total: 123_000 + (26_000 * i) / 29 }));
const ASSETS = [
  { id: 'reit', name: 'Inzhur REIT', colorKey: 'reit', yieldType: 'div_cap' },
  { id: 'energy', name: 'Inzhur Energy', colorKey: 'energy', yieldType: 'capitalization' },
] as Asset[];
const YIELD = DATES.map((date, i) => ({ date, reit: i / 10, energy: -i / 40 }));

const labels = (root: ParentNode, axis: 'x' | 'y') =>
  [...root.querySelectorAll(`.recharts-${axis}Axis-tick-labels text`)].map((t) => t.textContent);
/** Each chart's own x labels: /yield's «Окремо» draws a chart per asset. */
const xLabels = (root: ParentNode) =>
  [...root.querySelectorAll('.recharts-wrapper')].map((chart) => labels(chart, 'x'));

const CHARTS = [
  ['BalancesArea', () => createElement(BalancesArea, { data: CAPITAL })],
  ['YieldPanels', () => createElement(YieldPanels, { data: YIELD, assets: ASSETS })],
  ['YieldLines', () => createElement(YieldLines, { data: YIELD, assets: ASSETS })],
] as const;

describe.each(CHARTS)('%s date axis', (_name, chart) => {
  it('prints seven dates on a plot 500 px wide or more, the first and the last among them', () => {
    width = 800;
    const { container } = render(chart());
    const charts = xLabels(container);
    expect(charts.length).toBeGreaterThan(0);
    for (const x of charts) {
      expect(x).toEqual(['01.01', '06.01', '11.01', '16.01', '20.01', '25.01', '30.01']);
    }
  });

  it('prints the first, the middle and the last date on a narrower plot', () => {
    width = 400;
    const { container } = render(chart());
    const charts = xLabels(container);
    expect(charts.length).toBeGreaterThan(0);
    for (const x of charts) expect(x).toEqual(['01.01', '16.01', '30.01']);
  });
});

// A narrow plot and an unmeasured one both print three: the threshold is pinned on a measured plot
// either side of it. /balances' plot is the chart less its 12 px right margin and 44 px y axis.
describe("/balances' date axis at the narrow threshold", () => {
  it.each([
    [556, 7],
    [555, 3],
  ])('prints, on a %i px chart, %i dates', (chartWidth, count) => {
    width = chartWidth;
    const { container } = render(createElement(BalancesArea, { data: CAPITAL }));
    expect(xLabels(container)[0]).toHaveLength(count);
  });
});

describe("/balances' y axis", () => {
  it('labels each 1-2-5 gridline with its own value', () => {
    const { container } = render(createElement(BalancesArea, { data: CAPITAL }));
    expect(labels(container, 'y')).toEqual(['₴120k', '₴130k', '₴140k', '₴150k']);
    const labelYs = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].map((t) =>
      Number(t.getAttribute('y')),
    );
    const gridYs = [...container.querySelectorAll('.recharts-cartesian-grid-horizontal line')].map(
      (l) => Number(l.getAttribute('y1')),
    );
    expect(gridYs.sort((a, b) => a - b)).toEqual(labelYs.sort((a, b) => a - b));
  });
});

describe("/payouts' month axis", () => {
  it("prints all twelve months on a 360 card's plot", () => {
    // 360 less the page's 16 px gutters and the card's 22 px padding.
    width = 360 - 2 * 16 - 2 * 22;
    const data = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      dividends: 300,
      coupons: 200,
      total: 500,
    }));
    const { container } = render(createElement(PayoutsBars, { data }));
    expect(xLabels(container)).toEqual([expect.any(Array)]);
    expect(xLabels(container)[0]).toHaveLength(12);
  });
});
