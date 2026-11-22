// @vitest-environment jsdom
// «Разом» told apart by shape (wave 14, `yield-series-shapes.md` § Signed): a shape per asset by
// its order, one ringed glyph at the signed sizes, a legend of the drawn lines, and the line
// nearest the pointer brought forward while the others fall back.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset, ColorKey } from '@quirenote/core/types';

// At `md` and up unless a test crosses back: hover drives the crosshair there.
const breakpoint = { wide: true };
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

const { YieldLines, YieldLegend } = await import('./YieldLines');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  breakpoint.wide = true;
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'];
const SLOTS: ColorKey[] = ['reit', 'energy', 'ovdp8976', 'ovdp6475'];
const asset = (i: number, colorKey: ColorKey = SLOTS[i % 4]) =>
  ({
    id: `a${i}`,
    name: `Asset ${i}`,
    colorKey,
    yieldType: 'div_cap',
    createdAt: `2026-01-0${i + 1}T00:00:00`,
  }) as Asset;

function settle(chart: ReactElement) {
  const r = render(chart);
  act(() => vi.advanceTimersByTime(2000));
  return r;
}

function hover(container: HTMLElement, x: number, y: number) {
  fireEvent.mouseMove(container.querySelector('.recharts-wrapper')!, { clientX: x, clientY: y });
  act(() => vi.advanceTimersByTime(100));
}

/** The centre of a glyph, from the extent of its `x,y` pairs. */
function centreOf(glyph: Element) {
  const pts = [...(glyph.getAttribute('d') ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
  const ys = pts.map((m) => Number(m[2]));
  return (Math.max(...ys) + Math.min(...ys)) / 2;
}

const glyphs = (container: HTMLElement, scope: string) => [
  ...container.querySelectorAll(`${scope} [data-glyph]`),
];
const shapeAndSize = (g: Element) => [
  g.getAttribute('data-glyph'),
  g.getAttribute('data-glyph-size'),
];

describe('shapes by order', () => {
  // Seven assets on four colour slots: a0 and a4 share a colour, as do a1 and a5, and a2 and a6.
  const SEVEN = Array.from({ length: 7 }, (_, i) => asset(i));
  const data = DATES.map((date, d) => ({
    date,
    ...Object.fromEntries(SEVEN.map((a, i) => [a.id, i - 3 + d * 0.1])),
  }));

  it('ends each line on its createdAt shape at 9 px, whatever its colour slot', () => {
    const { container } = settle(<YieldLines data={data} assets={SEVEN} />);
    const ends = glyphs(container, '.recharts-line-dots');
    expect(ends.map(shapeAndSize)).toEqual([
      ['circle', '9'],
      ['square', '9'],
      ['triangle', '9'],
      ['diamond', '9'],
      ['triangle-down', '9'],
      ['cross', '9'],
      ['circle', '9'],
    ]);
    // a0 and a4 share a colour slot and still differ by shape.
    expect(ends[0].getAttribute('fill')).toBe(ends[4].getAttribute('fill'));
    expect(ends[0].getAttribute('data-glyph')).not.toBe(ends[4].getAttribute('data-glyph'));
  });

  it('draws every glyph filled on a 2 px `card` ring painted under the fill', () => {
    const { container } = settle(<YieldLines data={data} assets={SEVEN} />);
    for (const g of glyphs(container, '.recharts-line-dots')) {
      expect(g.getAttribute('stroke')).toBe('var(--color-chart-card)');
      expect(g.getAttribute('stroke-width')).toBe('4');
      expect(g.getAttribute('paint-order')).toBe('stroke');
    }
  });
});

describe('the legend', () => {
  const THREE = [asset(0), asset(1), asset(2)];
  // a1 has no point in the window, so it draws no line.
  const data = DATES.map((date, d) => ({ date, a0: d, a2: -d }));

  it('lists only the assets with a line, each on a 22 px segment carrying its glyph', () => {
    const { container } = render(<YieldLegend data={data} assets={THREE} />);
    const items = [...container.querySelectorAll('[data-yield-legend-item]')];
    expect(items.map((i) => i.textContent)).toEqual(['Asset 0', 'Asset 2']);
    for (const [item, shape] of [
      [items[0], 'circle'],
      [items[1], 'triangle'],
    ] as const) {
      const key = item.querySelector('svg[data-legend-key]')!;
      expect(key.getAttribute('width')).toBe('22');
      expect(key.querySelector('line')?.getAttribute('stroke-width')).toBe('2');
      expect(shapeAndSize(key.querySelector('[data-glyph]')!)).toEqual([shape, '9']);
    }
  });

  it('reads on the small role in `muted`', () => {
    const { container } = render(<YieldLegend data={data} assets={THREE} />);
    const legend = container.querySelector('[data-yield-legend]')!;
    expect([...legend.classList]).toEqual(expect.arrayContaining(['text-small', 'text-muted']));
  });
});

describe('the nearest line comes forward', () => {
  const THREE = [asset(0), asset(1), asset(2)];
  // Flat lines at +3 %, +1 % and −1 %: a1 sits between the other two.
  const data = DATES.map((date) => ({ date, a0: 3, a1: 1, a2: -1 }));
  const colour = (i: number) => `var(--color-chart-${SLOTS[i]})`;

  /** Hover once anywhere, read each line's y off its crosshair glyph, then hover near `target`. */
  function focusNear(container: HTMLElement, target: number) {
    hover(container, 300, 100);
    const at = glyphs(container, '.recharts-active-dot').find(
      (g) => g.getAttribute('fill') === colour(target),
    );
    if (!at) throw new Error('no crosshair glyph');
    hover(container, 300, centreOf(at) + 3);
  }

  const curves = (container: HTMLElement) => [
    ...container.querySelectorAll('.recharts-line-curve'),
  ];

  it('draws the focused line at 3 px on top, and the others at 30 %', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    const all = curves(container);
    const focused = all.filter((c) => c.getAttribute('stroke-width') === '3');
    expect(focused.map((c) => c.getAttribute('stroke'))).toEqual([colour(1)]);
    expect(all.at(-1)).toBe(focused[0]);
    for (const c of all) {
      const layer = c.closest('.recharts-line')!;
      expect(layer.classList.contains('opacity-30')).toBe(c.getAttribute('stroke') !== colour(1));
    }
  });

  it('draws the focused glyph at 12 px and the others at 10 at the crosshair', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    const at = glyphs(container, '.recharts-active-dot');
    expect(at).toHaveLength(3);
    const sizes = Object.fromEntries(
      at.map((g) => [g.getAttribute('fill'), g.getAttribute('data-glyph-size')]),
    );
    expect(sizes).toEqual({ [colour(0)]: '10', [colour(1)]: '12', [colour(2)]: '10' });
  });

  it('sets the focused row bold and the others at 55 %, largest first, keyed by glyph', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-tooltip-row]')];
    expect(rows.map((r) => r.querySelector('[data-tooltip-name]')?.textContent)).toEqual([
      'Asset 0',
      'Asset 1',
      'Asset 2',
    ]);
    expect(rows.map((r) => [r.style.fontWeight, r.style.opacity])).toEqual([
      ['', '0.55'],
      ['700', ''],
      ['', '0.55'],
    ]);
    expect(
      rows.map((r) =>
        r.querySelector('[data-tooltip-key] [data-glyph]')?.getAttribute('data-glyph'),
      ),
    ).toEqual(['circle', 'square', 'triangle']);
  });

  // The end marks are drawn outside the line's own layer, so they take the fade themselves.
  it('fades the others’ end glyphs with their lines', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    for (const g of glyphs(container, '.recharts-line-dots')) {
      const other = g.getAttribute('fill') !== colour(1);
      expect([g.getAttribute('data-glyph-size'), (g as SVGElement).style.opacity]).toEqual([
        '9',
        other ? '0.3' : '',
      ]);
    }
  });

  it('lets every line go back when the pointer moves off the plot, onto the axis strip', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    hover(container, 300, 198);
    for (const c of curves(container)) {
      expect(c.getAttribute('stroke-width')).toBe('2');
      expect(c.closest('.recharts-line')!.classList.contains('opacity-30')).toBe(false);
    }
  });

  // recharts hides its box on an Escape anywhere on the page, the plot focused or not.
  it('lets every line go back on Escape while hovering', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(100));
    for (const c of curves(container)) {
      expect(c.getAttribute('stroke-width')).toBe('2');
      expect(c.closest('.recharts-line')!.classList.contains('opacity-30')).toBe(false);
    }
  });

  // The pointer brings recharts' box back on that same date, so Up and Down come back with it.
  it('after Escape on hover, a pointer focus on the same date lets Up and Down move again', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(100));
    focusNear(container, 1);
    fireEvent.keyDown(container.querySelector('.recharts-surface')!, { key: 'ArrowDown' });
    act(() => vi.advanceTimersByTime(100));
    const focused = curves(container).filter((c) => c.getAttribute('stroke-width') === '3');
    expect(focused.map((c) => c.getAttribute('stroke'))).toEqual([colour(2)]);
  });

  it('lets every line go back when the pointer leaves', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    focusNear(container, 1);
    fireEvent.mouseLeave(container.querySelector('.recharts-wrapper')!);
    act(() => vi.advanceTimersByTime(100));
    for (const c of curves(container)) {
      expect(c.getAttribute('stroke-width')).toBe('2');
      expect(c.closest('.recharts-line')!.classList.contains('opacity-30')).toBe(false);
    }
  });

  it('focuses the nearest line on a tap below md', () => {
    breakpoint.wide = false;
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    const wrapper = container.querySelector('.recharts-wrapper')!;
    fireEvent.click(wrapper, { clientX: 300, clientY: 100 });
    const at = glyphs(container, '.recharts-active-dot').find(
      (g) => g.getAttribute('fill') === colour(2),
    )!;
    fireEvent.click(wrapper, { clientX: 130, clientY: centreOf(at) - 3 });
    const focused = curves(container).filter((c) => c.getAttribute('stroke-width') === '3');
    expect(focused.map((c) => c.getAttribute('stroke'))).toEqual([colour(2)]);
  });

  // Off the plot recharts reports its last index: the bottom line would be nearest a tap there.
  it('keeps the focus on a tap on the axis strip under the plot', () => {
    breakpoint.wide = false;
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    const wrapper = container.querySelector('.recharts-wrapper')!;
    fireEvent.click(wrapper, { clientX: 300, clientY: 100 });
    const at = glyphs(container, '.recharts-active-dot').find(
      (g) => g.getAttribute('fill') === colour(0),
    )!;
    fireEvent.click(wrapper, { clientX: 130, clientY: centreOf(at) + 3 });
    fireEvent.click(wrapper, { clientX: 130, clientY: 198 });
    const focused = curves(container).filter((c) => c.getAttribute('stroke-width') === '3');
    expect(focused.map((c) => c.getAttribute('stroke'))).toEqual([colour(0)]);
  });

  // `yield-series-shapes.md` § Signed › Motion, stilled by the reduced-motion kill-switch in
  // `index.css`. recharts rebuilds a line's curve and glyphs on every render and keeps only its
  // layer, so the others fade there, and the focused line's 3 px copy fades in over them.
  it('fades the focus change over 150 ms on `ease-soft`', () => {
    const { container } = settle(<YieldLines data={data} assets={THREE} />);
    for (const layer of container.querySelectorAll('.recharts-line')) {
      expect([...layer.classList]).toEqual(
        expect.arrayContaining(['transition-opacity', 'duration-150', 'ease-soft']),
      );
    }
    focusNear(container, 1);
    const lead = curves(container)
      .find((c) => c.getAttribute('stroke-width') === '3')!
      .closest('.recharts-line')!;
    expect([...lead.classList]).toEqual(
      expect.arrayContaining(['animate-in', 'fade-in', 'duration-150', 'ease-soft']),
    );
  });
});
