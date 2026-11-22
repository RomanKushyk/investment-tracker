// @vitest-environment jsdom
// /yield's small multiples (`charts.md` § Signed › Identity, Y4; `open-values-charts-type.md`
// § Signed, wave 25): one panel per asset on one y domain, the others as `faint` context lines, a
// title of the name and its final value, two columns while the card is ≥ 600 px inside, and a panel
// with no line kept in its place with a line of text. A panel's tooltip names its own asset.
import { cleanup, render } from '@testing-library/react';
import { cloneElement, createElement, type ReactElement } from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { SERIES } from '@quirenote/core/colors';
import type { Asset } from '@quirenote/core/types';
import { uk } from '../../i18n/messages';

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
// jsdom lays nothing out: an observed box reports the width a test sets, once, on observe — unless
// a test holds the observer silent, as a browser's is until after the first paint.
let width = 640;
let silent = false;
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      if (silent) return;
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

// The container hands its chart a fixed size instead of measuring one.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('recharts')>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 300, height: 170 }),
}));

const { YieldPanels } = await import('./YieldPanels');
const { ChartTooltipContent } = await import('./ChartTooltip');

afterEach(() => {
  cleanup();
  width = 640;
  silent = false;
  vi.restoreAllMocks();
});

const DATES = ['2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26', '2026-07-27'];
const ASSETS = [
  { id: 'reit', name: 'Inzhur REIT', colorKey: 'reit', yieldType: 'div_cap' },
  { id: 'energy', name: 'Inzhur Energy', colorKey: 'energy', yieldType: 'capitalization' },
  { id: 'bond', name: 'OVDP UA4000238976', colorKey: 'ovdp8976', yieldType: 'fixed_coupon' },
  { id: 'late', name: 'Inzhur Fund 3', colorKey: 'reit', yieldType: 'capitalization' },
] as Asset[];
// reit climbs to +4, energy dips to −1, the bond starts late; `late` has no point at all.
const DATA = DATES.map((date, i) => ({
  date,
  reit: i,
  energy: -i / 4,
  ...(i > 1 ? { bond: (i - 2) * 0.5 } : {}),
}));

const draw = () => render(createElement(YieldPanels, { data: DATA, assets: ASSETS }));
const panels = () => [...document.querySelectorAll<HTMLElement>('[data-yield-panel]')];
const yLabels = (panel: Element) =>
  [...panel.querySelectorAll('.recharts-yAxis-tick-labels text')].map((t) => t.textContent);
const curves = (panel: Element) => [...panel.querySelectorAll('.recharts-line-curve')];

describe('the panels', () => {
  it('draws one panel per asset, in the assets’ order', () => {
    draw();
    expect(panels().map((p) => p.dataset.yieldPanel)).toEqual(['reit', 'energy', 'bond', 'late']);
  });

  it('puts every panel on one y domain: the same ticks, −1 to +4', () => {
    draw();
    const drawn = panels().filter((p) => p.querySelector('svg'));
    expect(drawn).toHaveLength(3);
    const first = yLabels(drawn[0]);
    expect(first).toEqual(['−1 %', '0 %', '+1 %', '+2 %', '+3 %', '+4 %']);
    for (const p of drawn) expect(yLabels(p)).toEqual(first);
  });

  it('draws the panel’s own line in its colour at 2 px, and the others as 1 px `faint` context', () => {
    draw();
    const [reit] = panels();
    const strokes = curves(reit).map((c) => [
      c.getAttribute('stroke'),
      c.getAttribute('stroke-width'),
    ]);
    expect(strokes).toContainEqual([SERIES.reit.main, '2']);
    const context = strokes.filter(([s]) => s === 'var(--color-chart-faint)');
    // The two other assets with a line; `late` has none to draw.
    expect(context).toHaveLength(2);
    for (const [, w] of context) expect(w).toBe('1');
  });

  it('titles each panel with its name and its final value; a bond by its short code', () => {
    draw();
    const titles = panels().map((p) => p.querySelector('[data-panel-title]')!.textContent);
    expect(titles[0]).toBe('Inzhur REIT+4,00 %');
    expect(titles[1]).toBe('Inzhur Energy−1,00 %');
    expect(titles[2]).toBe('OVDP …8976+1,00 %');
  });

  it('keeps a panel with no line in its place: its title, «—», and the line of text', () => {
    draw();
    const late = panels()[3];
    expect(late.querySelector('svg')).toBeNull();
    expect(late.querySelector('[data-panel-title]')!.textContent).toBe('Inzhur Fund 3—');
    const empty = late.querySelector<HTMLElement>('[data-panel-empty]')!;
    expect(empty.textContent).toBe(uk.analytics.yield.panelNoLine);
    expect(empty.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['border-b', 'border-hairline', 'text-small', 'text-muted']),
    );
  });
});

describe('the columns', () => {
  it.each([
    [640, '2'],
    [600, '2'],
    [599, '1'],
    [296, '1'],
  ])('a card %i px inside lays %s to a row', (w, columns) => {
    width = w;
    draw();
    const grid = document.querySelector<HTMLElement>('[data-yield-grid]')!;
    expect(grid.dataset.columns).toBe(columns);
    expect(grid.style.gridTemplateColumns).toBe(`repeat(${columns}, minmax(0, 1fr))`);
  });

  it('lays its columns out before the first paint, before any observer reports', () => {
    silent = true;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
    draw();
    expect(document.querySelector<HTMLElement>('[data-yield-grid]')!.dataset.columns).toBe('2');
  });
});

describe('the tooltip', () => {
  // Over a date the panel's asset has no point, only context lines: a box with a date and no row
  // names nothing.
  it('draws no box when no row is left', () => {
    render(
      createElement(ChartTooltipContent, {
        active: true,
        label: '2026-07-23',
        payload: [{ dataKey: 'energy', name: 'energy', value: 0, color: 'grey', type: 'none' }],
        formatLabel: String,
        formatValue: String,
      }),
    );
    expect(document.querySelector('[data-chart-tooltip]')).toBeNull();
  });

  it('leaves out a series recharts marks `none`, as its own content does', () => {
    render(
      createElement(ChartTooltipContent, {
        active: true,
        label: '2026-07-27',
        payload: [
          { dataKey: 'reit', name: 'reit', value: 4, color: 'red' },
          { dataKey: 'energy', name: 'energy', value: -1, color: 'grey', type: 'none' },
        ],
        formatLabel: String,
        formatValue: String,
      }),
    );
    expect([...document.querySelectorAll('[data-tooltip-name]')].map((n) => n.textContent)).toEqual(
      ['reit'],
    );
  });
});
