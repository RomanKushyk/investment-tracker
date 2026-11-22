// @vitest-environment jsdom
// The marks of the C2 anatomy, drawn (`charts.md` § Signed › Anatomy; the bar band is wave 25's,
// `open-values-charts-type.md` § Signed): 2 px round lines with no dots along them, a ringed end
// marker, a crosshair with ringed markers on every line, and /yield's line at 0 %. «Разом»'s marks
// are wave 14's glyphs (`yield-series-shapes.md`), pinned in `yield-lines-render.test.tsx`.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';

// Below `md`, so a tap pins the crosshair where the test can read it.
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
const { YieldLines } = await import('./YieldLines');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'];
const ASSETS = [
  { id: 'a1', name: 'Asset one', colorKey: 'reit', createdAt: '2026-01-01T00:00:00' },
  { id: 'a2', name: 'Asset two', colorKey: 'energy', createdAt: '2026-01-02T00:00:00' },
] as Asset[];

const balances = () => (
  <BalancesArea data={DATES.map((date, i) => ({ date, total: 100_000 + i * 1000 }))} />
);
// a2 starts later, so its end and the chart's end differ; both lines cross zero.
const yieldLines = () => (
  <YieldLines
    data={DATES.map((date, i) => ({ date, a1: i - 1, ...(i > 1 ? { a2: 2 - i } : {}) }))}
    assets={ASSETS}
  />
);
const payouts = () => (
  <PayoutsBars
    data={['2026-01', '2026-02', '2026-03'].map((month, i) => ({
      month,
      dividends: 100 + i,
      coupons: 50 + i,
      total: 150 + 2 * i,
    }))}
  />
);

function settle(chart: ReactElement) {
  const r = render(chart);
  act(() => vi.advanceTimersByTime(2000));
  return r;
}

function tap(container: HTMLElement, x: number, y = 100) {
  const plot = container.querySelector('.recharts-wrapper');
  if (!plot) throw new Error('no chart mounted');
  fireEvent.click(plot, { clientX: x, clientY: y });
}

const RING = { r: '5', stroke: 'var(--color-chart-card)', 'stroke-width': '2' };
const attrs = (el: Element, names: string[]) =>
  Object.fromEntries(names.map((n) => [n, el.getAttribute(n)]));
const ringOf = (el: Element) => attrs(el, ['r', 'stroke', 'stroke-width']);

/** The plot rectangle, read from the clip recharts draws its series inside. */
function plotOf(container: HTMLElement) {
  const clip = container.querySelector('clipPath rect');
  if (!clip) throw new Error('no plot clip');
  const top = Number(clip.getAttribute('y'));
  return { top, bottom: top + Number(clip.getAttribute('height')) };
}

describe.each([
  ['Balances', balances, '.recharts-area-curve', 1, false],
  ['Yield', yieldLines, '.recharts-line-curve', 2, true],
] as const)('%s lines', (_name, chart, curve, lines, glyph) => {
  it('are 2 px with round joins and caps', () => {
    const { container } = settle(chart());
    const curves = [...container.querySelectorAll(curve)];
    expect(curves).toHaveLength(lines);
    for (const c of curves) {
      expect(attrs(c, ['stroke-width', 'stroke-linejoin', 'stroke-linecap'])).toEqual({
        'stroke-width': '2',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      });
    }
  });

  it('carry no dots along them, and end on one marker each', () => {
    const { container } = settle(chart());
    const dots = [
      ...container.querySelectorAll(
        '.recharts-line-dots circle, .recharts-line-dots [data-glyph], .recharts-area-dots circle',
      ),
    ];
    expect(dots).toHaveLength(lines);
    if (glyph) return;
    for (const d of dots) expect(ringOf(d)).toEqual(RING);
  });

  it('draw a marker on every line at the crosshair', () => {
    const { container } = settle(chart());
    tap(container, 300);
    const active = [
      ...container.querySelectorAll(
        '.recharts-active-dot circle, .recharts-active-dot [data-glyph]',
      ),
    ];
    expect(active).toHaveLength(lines);
    if (glyph) return;
    for (const d of active) expect(ringOf(d)).toEqual(RING);
  });

  it('draw the crosshair as one full-height 1 px `field-border` line', () => {
    const { container } = settle(chart());
    tap(container, 130);
    const cursor = container.querySelector('.recharts-tooltip-cursor');
    expect(cursor, 'no crosshair').not.toBeNull();
    expect(attrs(cursor!, ['stroke', 'stroke-width'])).toEqual({
      stroke: 'var(--color-chart-field-border)',
      'stroke-width': '1',
    });
    // A vertical path from the plot's top to its bottom: `M x,top L x,bottom`.
    const d = cursor!.getAttribute('d') ?? '';
    const [, x1, y1, x2, y2] = d.match(/M([\d.]+),([\d.]+)L([\d.]+),([\d.]+)/) ?? [];
    expect(x1).toBe(x2);
    const { top, bottom } = plotOf(container);
    expect(Number(y1)).toBe(top);
    expect(Number(y2)).toBe(bottom);
  });
});

// `charts.md` § Signed: the area is a gradient of the series colour from 32 % to 0 under the line,
// and the capital chart is the C2 area with a single series and no legend.
describe('the capital area', () => {
  it('is one series with no legend', () => {
    const { container } = settle(balances());
    expect(container.querySelectorAll('.recharts-area')).toHaveLength(1);
    expect(container.querySelector('.recharts-legend-wrapper')).toBeNull();
  });

  it('fills from the accent at 32 % at the line to 0 at the baseline', () => {
    const { container } = settle(balances());
    const fill = container.querySelector('.recharts-area-area')?.getAttribute('fill') ?? '';
    const [, id] = fill.match(/^url\(#(.+)\)$/) ?? [];
    expect(id, `the area is filled with ${fill || 'nothing'}, not a gradient`).toBeDefined();
    const gradient = [...container.querySelectorAll('svg linearGradient')].find((g) => g.id === id);
    expect(gradient, `no gradient #${id} in the chart`).toBeDefined();
    // Top to bottom of the area's own box: the line's peak to the baseline.
    expect(attrs(gradient!, ['x1', 'y1', 'x2', 'y2'])).toEqual({
      x1: '0',
      y1: '0',
      x2: '0',
      y2: '1',
    });
    const stops = [...gradient!.querySelectorAll('stop')].map((s) =>
      attrs(s, ['offset', 'stop-color', 'stop-opacity']),
    );
    expect(stops).toEqual([
      { offset: '0', 'stop-color': 'var(--color-chart-accent)', 'stop-opacity': '0.32' },
      { offset: '1', 'stop-color': 'var(--color-chart-accent)', 'stop-opacity': '0' },
    ]);
    // recharts' `Area` defaults to 0.6, which would multiply the stops.
    expect(container.querySelector('.recharts-area-area')!.getAttribute('fill-opacity')).toBe('1');
  });
});

describe('the bar charts', () => {
  it('mark the hovered category with a full-height `hairline` band', () => {
    const { container } = settle(payouts());
    tap(container, 130);
    const band = container.querySelector('.recharts-tooltip-cursor');
    expect(band, 'no band').not.toBeNull();
    expect(band!.getAttribute('fill')).toBe('var(--color-chart-hairline)');
    // recharts insets its band half a pixel at each end (`getCursorRectangle.js`).
    const { top, bottom } = plotOf(container);
    const y = Number(band!.getAttribute('y'));
    expect(y - top).toBe(0.5);
    expect(bottom - (y + Number(band!.getAttribute('height')))).toBe(0.5);
  });
});

describe('/yield', () => {
  it('draws a `field-border` line at 0 %', () => {
    const { container } = settle(yieldLines());
    const zero = container.querySelectorAll('.recharts-reference-line line');
    expect(zero).toHaveLength(1);
    expect(zero[0].getAttribute('stroke')).toBe('var(--color-chart-field-border)');
    // On the y of 0: the y axis prints its zero tick on the same line.
    const tick = [...container.querySelectorAll('.recharts-yAxis-tick-labels text')].find((t) =>
      /^0\s?%$/.test(t.textContent?.trim() ?? ''),
    );
    expect(tick, 'no zero tick').toBeDefined();
    expect(Number(zero[0].getAttribute('y1'))).toBeCloseTo(Number(tick!.getAttribute('y')), 0);
  });
});
