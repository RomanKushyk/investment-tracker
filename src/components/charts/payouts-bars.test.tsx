// @vitest-environment jsdom
// /payouts' stacked columns (`charts.md` § Signed › Forms, B1; wave 25 item 5,
// `open-values-charts-type.md` § Signed): dividends below coupons with a 2 px gap, ≤ 24 px wide,
// square at the baseline and 4 px round at the top of the stack, the month's whole total on the cap.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The language lives in a persisted store, which writes through on every change.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
const breakpoint = { wide: false };
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && breakpoint.wide;
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

const { PayoutsBars } = await import('./PayoutsBars');
const { useSettings } = await import('../../state/settings');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  breakpoint.wide = false;
  useSettings.setState({ language: 'uk' });
});

type Point = { month: string; dividends: number; coupons: number; total: number };
const point = (month: string, dividends: number, coupons: number): Point => ({
  month,
  dividends,
  coupons,
  total: dividends + coupons,
});

function settle(data: Point[]) {
  const r = render(<PayoutsBars data={data} />);
  act(() => vi.advanceTimersByTime(2000));
  return r;
}

const box = (el: Element) => ({
  x: Number(el.getAttribute('x')),
  y: Number(el.getAttribute('y')),
  width: Number(el.getAttribute('width')),
  height: Number(el.getAttribute('height')),
});

/** Each column's parts, by month index, read from the drawn rectangles. */
function column(container: HTMLElement, kind: 'dividend' | 'coupon') {
  return [
    ...container.querySelectorAll(
      `.recharts-bar-rectangle path[fill="var(--color-chart-payout-${kind})"]`,
    ),
  ];
}

/** The clip a part is drawn through: the stack's outline, one per column. */
function clipOf(container: HTMLElement, part: Element) {
  const url = part.closest('[clip-path]')?.getAttribute('clip-path') ?? '';
  const [, id] = url.match(/^url\(#(.+)\)$/) ?? [];
  expect(id, `the part is drawn through ${url || 'no clip'}`).toBeDefined();
  const path = [...container.querySelectorAll('clipPath')]
    .find((c) => c.id === id)
    ?.querySelector('path');
  expect(path, `no clip #${id}`).toBeDefined();
  return path!;
}

/** The arcs a path draws, as their radius and end point. */
function arcs(path: Element) {
  const d = path.getAttribute('d') ?? '';
  return [...d.matchAll(/A\s*([\d.]+),([\d.]+),0,0,\d,\s*([\d.]+),([\d.]+)/g)].map((m) => ({
    r: Number(m[1]),
    endY: Number(m[4]),
  }));
}

describe('the columns', () => {
  it('stack dividends at the bottom and coupons on top, with a 2 px gap between them', () => {
    const { container } = settle([point('2026-01', 300, 200), point('2026-02', 250, 150)]);
    const dividends = column(container, 'dividend');
    const coupons = column(container, 'coupon');
    expect(dividends).toHaveLength(2);
    expect(coupons).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const d = box(dividends[i]);
      const c = box(coupons[i]);
      expect(c.y + c.height, 'coupons sit above dividends').toBeLessThan(d.y + d.height);
      expect(d.y - (c.y + c.height)).toBeCloseTo(2, 5);
      expect(d.x).toBe(c.x);
    }
  });

  // The gap is drawn only where the lower part has room for it, so no payout vanishes.
  it('keep a dividend part shorter than the gap visible, without the gap', () => {
    const { container } = settle([point('2026-01', 1, 2000)]);
    const [dividend] = column(container, 'dividend');
    const [coupon] = column(container, 'coupon');
    const d = box(dividend);
    expect(d.height).toBeGreaterThan(0);
    expect(d.height).toBeLessThan(2);
    expect(d.y).toBeCloseTo(box(coupon).y + box(coupon).height, 3);
  });

  it('are no wider than 24 px', () => {
    const { container } = settle([point('2026-01', 300, 200), point('2026-02', 250, 0)]);
    const parts = [...column(container, 'dividend'), ...column(container, 'coupon')];
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(box(p).width).toBeLessThanOrEqual(24);
  });

  it('round only the top of the stack, at 4 px, and keep the baseline square', () => {
    const { container } = settle([point('2026-01', 300, 200)]);
    const [dividend] = column(container, 'dividend');
    const [coupon] = column(container, 'coupon');
    // The parts themselves are square; the stack's clip carries the corners.
    expect(arcs(dividend)).toEqual([]);
    expect(arcs(coupon)).toEqual([]);
    const clip = clipOf(container, coupon);
    expect(clipOf(container, dividend)).toBe(clip);
    const outline = box(clip);
    expect(outline.y).toBeCloseTo(box(coupon).y, 5);
    expect(outline.y + outline.height).toBeCloseTo(box(dividend).y + box(dividend).height, 5);
    const top = arcs(clip);
    expect(top.map((a) => a.r)).toEqual([4, 4]);
    for (const a of top) expect(a.endY).toBeLessThanOrEqual(outline.y + 4);
  });

  it('round the top of whichever kind a one-kind month has', () => {
    const { container } = settle([point('2026-01', 300, 0), point('2026-02', 0, 200)]);
    const [dividend] = column(container, 'dividend');
    const [coupon] = column(container, 'coupon');
    expect(column(container, 'dividend')).toHaveLength(1);
    expect(column(container, 'coupon')).toHaveLength(1);
    for (const part of [dividend, coupon]) {
      const outline = box(clipOf(container, part));
      // Alone in its column, the part fills the stack: no gap cut from it.
      expect(outline.y).toBeCloseTo(box(part).y, 5);
      expect(outline.height).toBeCloseTo(box(part).height, 5);
      expect(arcs(clipOf(container, part)).map((a) => a.r)).toEqual([4, 4]);
    }
  });
});

describe('the cap', () => {
  // In column order: the dividend part labels a coupon-less month, so DOM order is by kind.
  const caps = (container: HTMLElement) =>
    [...container.querySelectorAll<SVGTextElement>('text[data-payouts-cap]')].sort(
      (a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x')),
    );
  const spaced = (s: string | null) => (s ?? '').replace(/\s/g, ' ');

  it('prints the month total, whole, at 11/700 in `ink`, once per column', () => {
    const { container } = settle([point('2026-01', 1000, 763.7), point('2026-02', 596, 0)]);
    const labels = caps(container);
    expect(labels.map((l) => spaced(l.textContent))).toEqual(['1 764', '596']);
    for (const l of labels) {
      expect({
        size: l.getAttribute('font-size'),
        weight: l.getAttribute('font-weight'),
        fill: l.getAttribute('fill'),
      }).toEqual({ size: '11', weight: '700', fill: 'var(--color-chart-ink)' });
    }
  });

  // recharts labels only the parts it draws, so a kind's label index skips the months it is 0 in.
  it('reads each column its own total where a kind skips a month', () => {
    const { container } = settle([
      point('2026-01', 300, 0),
      point('2026-02', 250, 150),
      point('2026-03', 0, 120),
      point('2026-04', 200, 0),
      point('2026-05', 100, 50),
    ]);
    expect(caps(container).map((l) => spaced(l.textContent))).toEqual([
      '300',
      '400',
      '120',
      '200',
      '150',
    ]);
  });

  it('follows the language: «1,764» in English', () => {
    useSettings.setState({ language: 'en' });
    const { container } = settle([point('2026-01', 1000, 763.7)]);
    expect(caps(container).map((l) => l.textContent)).toEqual(['1,764']);
  });

  it('sits just above the top of the stack', () => {
    const { container } = settle([point('2026-01', 300, 200), point('2026-02', 0, 150)]);
    const labels = caps(container);
    const tops = column(container, 'coupon').map((c) => box(c).y);
    expect(labels).toHaveLength(2);
    labels.forEach((l, i) => expect(Number(l.getAttribute('y'))).toBeLessThan(tops[i]));
  });
});

// #661: past twelve months a month name repeats, and the tooltip must still read its own row.
describe('a history longer than twelve months', () => {
  const HISTORY = [
    point('2025-11', 100, 0),
    point('2025-12', 101, 0),
    point('2026-11', 102, 0),
    point('2026-12', 103, 0),
    point('2027-01', 104, 0),
  ];
  const tooltip = (container: HTMLElement) => ({
    label: container.querySelector('[data-tooltip-date]')?.textContent ?? null,
    values: [...container.querySelectorAll('[data-tooltip-value]')].map((v) => v.textContent),
  });
  // With five columns on the 400 px mock, x = 300 lands on the fourth: the later «гру».
  const LATER_DEC = 300;

  it('shows the later month its own figures on a tap below md', () => {
    const { container } = settle(HISTORY);
    fireEvent.click(container.querySelector('.recharts-wrapper')!, {
      clientX: LATER_DEC,
      clientY: 100,
    });
    expect(tooltip(container)).toEqual({ label: 'гру', values: ['103,00', '0,00'] });
  });

  it('shows the later month its own figures on hover at md', () => {
    breakpoint.wide = true;
    const { container } = settle(HISTORY);
    fireEvent.mouseMove(container.querySelector('.recharts-wrapper')!, {
      clientX: LATER_DEC,
      clientY: 100,
    });
    act(() => vi.advanceTimersByTime(100));
    expect(tooltip(container)).toEqual({ label: 'гру', values: ['103,00', '0,00'] });
  });

  const ticks = (container: HTMLElement) =>
    [...container.querySelectorAll('.recharts-cartesian-axis-tick-value')].map(
      (t) => t.textContent,
    );

  it('reads the short month name on the ticks, in Ukrainian', () => {
    const { container } = settle(HISTORY);
    expect(ticks(container)).toEqual(['лис', 'гру', 'лис', 'гру', 'січ']);
  });

  it('reads the short month name on the ticks, in English', () => {
    useSettings.setState({ language: 'en' });
    const { container } = settle(HISTORY);
    expect(ticks(container)).toEqual(['Nov', 'Dec', 'Nov', 'Dec', 'Jan']);
  });
});
