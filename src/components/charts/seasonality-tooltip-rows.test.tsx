// @vitest-environment jsdom
// /seasonality's tooltip names each series' assets (wave 27, `open-values-charts-type.md` § Wave 27,
// step 3 A): under each series row one row per asset, by amount, at most five, the fifth turning
// into «+N активи» past that.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { uk } from '../../i18n/messages';
import type { SeasonalityChartPoint } from './SeasonalityBars';

// Below `md`, where a tap pins the tooltip.
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

const { SeasonalityBars } = await import('./SeasonalityBars');

afterEach(cleanup);

const parts = (...xs: [string, number][]) => xs.map(([name, value]) => ({ name, value }));
const sum = (xs: { value: number }[]) => xs.reduce((s, x) => s + x.value, 0);

// Six payers received, two due: the second of five buckets, where a tap at x = 130 lands (as in
// `tap-pin.test.tsx`). Listed out of order, so the rows' order is the tooltip's own.
const SIX = parts(['F', 50], ['A', 600], ['C', 400], ['E', 100], ['B', 500], ['D', 300]);
const TWO = parts(['Y', 20], ['X', 30]);
const points = (bucket: Partial<SeasonalityChartPoint>): SeasonalityChartPoint[] =>
  [1, 2, 3, 4, 5].map((day) => (day === 2 ? { day, actual: 0, ...bucket } : { day, actual: 10 }));

function open(data: SeasonalityChartPoint[], axis: 'day' | 'month') {
  const { container } = render(<SeasonalityBars data={data} axis={axis} />);
  fireEvent.click(container.querySelector('.recharts-wrapper')!, { clientX: 130, clientY: 100 });
  return container;
}

/** The tooltip's lines below its date, top to bottom: a series, an asset, or the overflow. */
function lines(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[data-tooltip-row] [data-tooltip-name], [data-tooltip-part] [data-tooltip-name], [data-tooltip-more]',
    ),
  ].map((el) => el.textContent);
}

/** Each asset row as its name and its amount, whitespace normalised. */
function assetRows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-tooltip-part]')].map((el) =>
    [el.querySelector('[data-tooltip-name]'), el.querySelector('[data-tooltip-value]')].map((s) =>
      (s?.textContent ?? '').replace(/\s/g, ' '),
    ),
  );
}

describe.each(['day', 'month'] as const)('the %s axis tooltip', (axis) => {
  it('lists each series’ assets under its row, by amount, four and «+2 активи» past five', () => {
    const container = open(
      points({
        actual: sum(SIX),
        expected: sum(TWO),
        actualParts: SIX,
        expectedParts: TWO,
      }),
      axis,
    );
    expect(lines(container)).toEqual([
      'Отримано',
      'A',
      'B',
      'C',
      'D',
      `+${uk.importing.count.assets(2)}`,
      'Очікувано',
      'X',
      'Y',
    ]);
    // Each asset's own amount, in the series row's money form.
    expect(assetRows(container)).toEqual([
      ['A', '600,00 ₴'],
      ['B', '500,00 ₴'],
      ['C', '400,00 ₴'],
      ['D', '300,00 ₴'],
      ['X', '30,00 ₴'],
      ['Y', '20,00 ₴'],
    ]);
  });

  it('shows five assets whole, with no overflow row', () => {
    const five = SIX.slice(0, 5);
    const container = open(points({ actual: sum(five), actualParts: five }), axis);
    expect(lines(container)).toEqual(['Отримано', 'A', 'B', 'C', 'E', 'F']);
  });

  it('draws an asset row at 400, indented to the series name, and the overflow in `muted`', () => {
    const container = open(points({ actual: sum(SIX), actualParts: SIX }), axis);
    const part = container.querySelector<HTMLElement>('[data-tooltip-part]')!;
    // 400 is the tooltip's own weight: no inline weight and no weight class on the row or its spans.
    for (const el of [part, ...part.querySelectorAll<HTMLElement>('span')]) {
      expect(el.style.fontWeight).toBe('');
      expect(el.className).not.toMatch(/\bfont-(thin|light|normal|medium|semibold|bold|black)\b/);
    }
    // The series row's 12 px key and its 8 px gap.
    expect(part.style.paddingLeft).toBe('20px');
    const more = container.querySelector<HTMLElement>('[data-tooltip-more]')!;
    expect(more.className).toMatch(/\btext-muted\b/);
    expect(more.style.paddingLeft).toBe('20px');
  });
});
