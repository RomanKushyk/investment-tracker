// @vitest-environment jsdom
// /seasonality's columns (`charts.md` § Signed › Forms, Seasonality; wave 25,
// `open-values-charts-type.md` § Signed): ≤ 18 px alone and 12 paired, the expected bar dashed at
// 40 %, an 8×4 hairline stub on an empty bucket, 4 px round at the value end and square at the
// baseline, and the labels inside the plot.
import { act, cleanup, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';
import { uk } from '../../i18n/messages';
import { MONO_ADVANCE } from './anatomy';
import type { SeasonalityChartPoint } from './SeasonalityBars';
import { seasonalityDayPoints } from './seasonality-labels';

// The language lives in a persisted store, which writes through on every change.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
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
const size = { width: 400 };
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: size.width, height: 230 }),
}));

const { SeasonalityBars } = await import('./SeasonalityBars');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  size.width = 400;
});

function settle(data: SeasonalityChartPoint[], axis: 'day' | 'month' = 'day') {
  const r = render(<SeasonalityBars data={data} axis={axis} />);
  act(() => vi.advanceTimersByTime(2000));
  return r;
}

const num = (el: Element, a: string) => Number(el.getAttribute(a));
const box = (el: Element) => ({
  x: num(el, 'x'),
  y: num(el, 'y'),
  width: num(el, 'width'),
  height: num(el, 'height'),
});

/** The drawn columns of one series, left to right. */
function columns(container: HTMLElement, kind: 'actual' | 'expected') {
  return [...container.querySelectorAll(`[data-seasonality-bar="${kind}"] path`)].sort(
    (a, b) => box(a).x - box(b).x,
  );
}

/** Each tick's label and the x it is centred on: the category's centre. */
function ticks(container: HTMLElement) {
  return [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map((t) => ({
    text: t.textContent,
    x: num(t, 'x'),
  }));
}

/** The arcs a path draws, as their radius and end point. */
function arcs(path: Element) {
  const d = path.getAttribute('d') ?? '';
  return [...d.matchAll(/A\s*([\d.]+),([\d.]+),0,0,\d,\s*([\d.]+),([\d.]+)/g)].map((m) => ({
    r: Number(m[1]),
    endY: Number(m[4]),
  }));
}

// Four buckets on the day axis's own ticks: received alone, received with an expectation, an
// expectation alone, and nothing.
const DAYS: SeasonalityChartPoint[] = [
  { day: 1, actual: 100, actualLabel: '100 · REIT' },
  { day: 5, actual: 200, expected: 150, actualLabel: '200 · OVDP …6475', expectedLabel: '150*' },
  { day: 10, actual: 0, expected: 300, expectedLabel: '300*' },
  { day: 15, actual: 0 },
];

describe('the columns', () => {
  it('are 18 px alone, centred on their category', () => {
    const { container } = settle(DAYS);
    const centre = ticks(container);
    const [alone] = columns(container, 'actual');
    // Left to right: day 5's paired expectation, then day 10's alone.
    const expectedAlone = columns(container, 'expected')[1];
    expect(box(alone!).width).toBe(18);
    expect(box(alone!).x + 9).toBeCloseTo(centre[0]!.x, 0);
    expect(box(expectedAlone!).width).toBe(18);
    expect(box(expectedAlone!).x + 9).toBeCloseTo(centre[2]!.x, 0);
  });

  it('are 12 px paired, either side of their category’s centre', () => {
    const { container } = settle(DAYS);
    const centre = ticks(container)[1]!.x;
    const received = box(columns(container, 'actual')[1]!);
    const expected = box(columns(container, 'expected')[0]!);
    expect(received.width).toBe(12);
    expect(expected.width).toBe(12);
    expect(received.x + received.width).toBeLessThanOrEqual(centre);
    expect(expected.x).toBeGreaterThanOrEqual(centre);
  });

  it('never overlap a neighbour on a full month of days', () => {
    const { container } = settle(
      Array.from({ length: 31 }, (_, i) => ({ day: i + 1, actual: 100 + i })),
    );
    const drawn = columns(container, 'actual').map(box);
    expect(drawn).toHaveLength(31);
    for (const c of drawn) expect(c.width).toBeLessThanOrEqual(18);
    drawn.slice(1).forEach((c, i) => expect(c.x).toBeGreaterThan(drawn[i]!.x + drawn[i]!.width));
  });

  it('are 4 px round at the value end and square at the baseline', () => {
    const { container } = settle(DAYS);
    const drawn = [...columns(container, 'actual'), ...columns(container, 'expected')];
    expect(drawn).toHaveLength(4);
    for (const path of drawn) {
      const { y } = box(path);
      const round = arcs(path);
      expect(round, path.getAttribute('d') ?? '').toHaveLength(2);
      // Both arcs close within the top 4 px; none reaches the baseline.
      for (const a of round) {
        expect(a.r).toBe(4);
        expect(a.endY).toBeGreaterThanOrEqual(y - 0.5);
        expect(a.endY).toBeLessThanOrEqual(y + 4.5);
      }
    }
  });

  it('paint the received bar in the accent and the expected bar dashed at 40 %', () => {
    const { container } = settle(DAYS);
    expect(columns(container, 'actual')).toHaveLength(2);
    expect(columns(container, 'expected')).toHaveLength(2);
    for (const path of columns(container, 'actual')) {
      expect(path.getAttribute('fill')).toBe('var(--color-chart-accent)');
    }
    for (const path of columns(container, 'expected')) {
      expect({
        fill: path.getAttribute('fill'),
        opacity: path.getAttribute('fill-opacity'),
        stroke: path.getAttribute('stroke'),
        dash: path.getAttribute('stroke-dasharray'),
      }).toEqual({
        fill: 'var(--color-chart-accent)',
        opacity: '0.4',
        stroke: 'var(--color-chart-accent)',
        dash: '3 2',
      });
    }
  });
});

describe('the stub', () => {
  it('is an 8×4 hairline on a bucket with neither amount, and nowhere else', () => {
    const { container } = settle(DAYS);
    const stubs = [...container.querySelectorAll('[data-seasonality-stub]')];
    expect(stubs).toHaveLength(1);
    const stub = stubs[0]!;
    expect({ ...box(stub), fill: stub.getAttribute('fill') }).toMatchObject({
      width: 8,
      height: 4,
      fill: 'var(--color-chart-hairline)',
    });
    expect(box(stub).x + 4).toBeCloseTo(ticks(container)[3]!.x, 0);
  });
});

describe('the labels', () => {
  const labels = (container: HTMLElement, line: 'main' | 'expected') => [
    ...container.querySelectorAll<SVGTextElement>(`text[data-seasonality-label="${line}"]`),
  ];
  const spaced = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

  it('print the received amount and its asset at 11/700 `ink`', () => {
    const { container } = settle(DAYS);
    const main = labels(container, 'main');
    expect(main.map((l) => spaced(l.textContent))).toEqual(['100 · REIT', '200 · OVDP …6475']);
    for (const l of main) {
      expect({
        size: l.getAttribute('font-size'),
        weight: l.getAttribute('font-weight'),
        fill: l.getAttribute('fill'),
      }).toEqual({ size: '11', weight: '700', fill: 'var(--color-chart-ink)' });
    }
  });

  it('print the expected amount on its own `muted` 11 px line, under the received one', () => {
    const { container } = settle(DAYS);
    const expected = labels(container, 'expected');
    expect(expected.map((l) => spaced(l.textContent)).sort()).toEqual(['150*', '300*']);
    for (const l of expected) {
      expect(l.getAttribute('font-size')).toBe('11');
      expect(l.getAttribute('font-weight')).not.toBe('700');
      expect(l.getAttribute('fill')).toBe('var(--color-chart-muted)');
    }
    const paired = labels(container, 'main')[1]!;
    const under = expected.find((l) => l.textContent === '150*')!;
    expect(num(paired, 'y')).toBeLessThan(num(under, 'y'));
    // Both above the taller of the pair.
    const top = Math.min(
      box(columns(container, 'actual')[1]!).y,
      box(columns(container, 'expected')[0]!).y,
    );
    expect(num(under, 'y')).toBeLessThan(top);
  });

  it('keep the top line inside the chart over the tallest bar', () => {
    const { container } = settle([
      { day: 1, actual: 500, expected: 450, actualLabel: '500 · REIT', expectedLabel: '450*' },
      { day: 5, actual: 10, actualLabel: '10 · REIT' },
    ]);
    const [top] = labels(container, 'main');
    expect(num(top!, 'y') - 11).toBeGreaterThanOrEqual(0);
  });
});

describe('the labels at 360', () => {
  // Recharts hands a label the whole chart as its `parentViewBox`, margins included; the plot is
  // where the grid runs.
  it('keep the longest day label inside the plot, not just inside the chart', () => {
    size.width = 292;
    const label = '1 184 · OVDP …8976';
    const { container } = settle(
      Array.from({ length: 31 }, (_, i) => ({
        day: i + 1,
        actual: i === 24 ? 1184 : 0,
        actualLabel: i === 24 ? label : undefined,
      })),
    );
    const grid = container.querySelector('.recharts-cartesian-grid-horizontal line')!;
    const text = container.querySelector('text[data-seasonality-label="main"]')!;
    const half = (label.length * 11 * MONO_ADVANCE) / 2;
    expect(num(text, 'x') - half).toBeGreaterThanOrEqual(num(grid, 'x1'));
    expect(num(text, 'x') + half).toBeLessThanOrEqual(num(grid, 'x2'));
  });

  // Wave 27's longest label: an expected-only bar naming its bond, on the plot's last day, built
  // the way the screen builds it.
  it('keep the named expected-only label inside the plot at its edge', () => {
    size.width = 292;
    const bond = { id: 'b8976', name: 'OVDP UA4000238976', yieldType: 'fixed_coupon' } as Asset;
    const whole = new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 0 }).format;
    const due = [{ assetId: 'b8976', amount: 1240 }];
    const points = seasonalityDayPoints(
      Array.from({ length: 31 }, (_, i) => ({
        day: i + 1,
        actual: 0,
        expected: i === 30 ? 1240 : undefined,
        actualByAsset: [],
        expectedByAsset: i === 30 ? due : [],
        dominantAssetId: undefined,
        expectedAssetId: undefined,
      })),
      [bond],
      whole,
      uk.importing.count.assets,
    );
    const label = points[30]!.expectedLabel!;
    expect(label.replace(/\s/g, ' ')).toBe('1 240* · OVDP …8976');
    const { container } = settle(points);
    const grid = container.querySelector('.recharts-cartesian-grid-horizontal line')!;
    const text = container.querySelector('text[data-seasonality-label="expected"]')!;
    expect(text.textContent).toBe(label);
    const half = (label.length * 11 * MONO_ADVANCE) / 2;
    expect(num(text, 'x') - half).toBeGreaterThanOrEqual(num(grid, 'x1'));
    expect(num(text, 'x') + half).toBeLessThanOrEqual(num(grid, 'x2'));
  });
});

describe('a label pair at the plot’s edge', () => {
  // Clamped one by one, the wide line would move inward and the short one stay put.
  it('keeps both lines on one centre', () => {
    size.width = 292;
    const { container } = settle(
      Array.from({ length: 31 }, (_, i) =>
        i === 30
          ? {
              day: 31,
              actual: 1184,
              expected: 1240,
              actualLabel: '1 184 · OVDP …8976',
              expectedLabel: '1 240*',
            }
          : { day: i + 1, actual: 0 },
      ),
    );
    const main = container.querySelector('text[data-seasonality-label="main"]')!;
    const under = container.querySelector('text[data-seasonality-label="expected"]')!;
    expect(num(under, 'x')).toBe(num(main, 'x'));
  });
});

describe('the month axis at 360', () => {
  it('prints all twelve month labels on the 360 card’s plot', () => {
    size.width = 328;
    const { container } = settle(
      Array.from({ length: 12 }, (_, i) => ({ day: i + 1, actual: 100 })),
      'month',
    );
    expect(ticks(container)).toHaveLength(12);
  });
});
