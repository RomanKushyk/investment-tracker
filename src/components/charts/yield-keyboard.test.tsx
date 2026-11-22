// @vitest-environment jsdom
// «Разом»'s keyboard map (wave 14, `yield-series-shapes.md` § Signed › Keyboard): the plot takes
// focus, the arrows walk the dates, Up and Down move the focus to the nearest line above or below
// with no wrap (Highcharts' series navigation; the APG data grid stops at its edge), and Escape
// releases it.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';

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

const { YieldLines } = await import('./YieldLines');

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05'];
const ASSETS = [
  { id: 'hi', name: 'High', colorKey: 'reit', createdAt: '2026-01-01T00:00:00' },
  { id: 'mid', name: 'Middle', colorKey: 'energy', createdAt: '2026-01-02T00:00:00' },
  { id: 'lo', name: 'Low', colorKey: 'ovdp8976', createdAt: '2026-01-03T00:00:00' },
] as Asset[];
const COLOUR = {
  hi: 'var(--color-chart-reit)',
  mid: 'var(--color-chart-energy)',
  lo: 'var(--color-chart-ovdp8976)',
};
// The order of the lines changes on the last date: there `lo` climbs above `mid`.
const DATA = DATES.map((date, i) => ({ date, hi: 3, mid: 1, lo: i === 2 ? 2 : -1 }));

function mount() {
  const r = render(<YieldLines data={DATA} assets={ASSETS} />);
  act(() => vi.advanceTimersByTime(2000));
  const surface = r.container.querySelector<SVGElement>('.recharts-surface');
  if (!surface) throw new Error('no chart surface');
  return { ...r, surface };
}

function press(el: Element, key: string) {
  fireEvent.keyDown(el, { key });
  act(() => vi.advanceTimersByTime(100));
}

/** The line drawn at 3 px, by its colour; `null` while no line has the focus. */
function focused(container: HTMLElement): string | null {
  const wide = [...container.querySelectorAll('.recharts-line-curve')].filter(
    (c) => c.getAttribute('stroke-width') === '3',
  );
  expect(wide.length).toBeLessThanOrEqual(1);
  const stroke = wide[0]?.getAttribute('stroke');
  return (Object.keys(COLOUR) as (keyof typeof COLOUR)[]).find((k) => COLOUR[k] === stroke) ?? null;
}

const date = (container: HTMLElement) =>
  container.querySelector('[data-tooltip-date]')?.textContent ?? null;

describe('«Разом» by keyboard', () => {
  it('takes focus, and the arrows walk the dates', () => {
    const { container, surface } = mount();
    expect(surface.getAttribute('tabindex')).toBe('0');
    act(() => surface.focus());
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    const first = date(container);
    expect(first).not.toBeNull();
    press(surface, 'ArrowRight');
    expect(date(container)).not.toBe(first);
    expect(focused(container)).toBeNull();
  });

  it('Down from no focus takes the top line, then the nearest below, and stops at the bottom', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('hi');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('mid');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('lo');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('lo');
  });

  it('Up moves to the nearest line above, and stops at the top', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'ArrowDown');
    press(surface, 'ArrowDown');
    press(surface, 'ArrowUp');
    expect(focused(container)).toBe('hi');
    press(surface, 'ArrowUp');
    expect(focused(container)).toBe('hi');
  });

  it('keeps the focused line while the dates walk, and reads nearness at the new date', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'ArrowDown');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('mid');
    press(surface, 'ArrowRight');
    press(surface, 'ArrowRight');
    expect(focused(container)).toBe('mid');
    // On the last date `lo` (+2 %) sits between `hi` and `mid`, so Up from `mid` reaches it first.
    press(surface, 'ArrowUp');
    expect(focused(container)).toBe('lo');
  });

  it('Up and Down keep the page still', () => {
    const { surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      surface.dispatchEvent(down);
    });
    expect(down.defaultPrevented).toBe(true);
  });

  it('Escape releases the focus', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('hi');
    press(surface, 'Escape');
    expect(focused(container)).toBeNull();
    for (const layer of container.querySelectorAll('.recharts-line'))
      expect(layer.classList.contains('opacity-30')).toBe(false);
  });

  // recharts' Escape hides the box and keeps the date: Up and Down wait for the walk to move on.
  it('after Escape, Up and Down focus nothing until the dates walk again', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'Escape');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBeNull();
    press(surface, 'ArrowRight');
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('hi');
  });

  it('after Escape, Up and Down work again on that date once the walk comes back to it', () => {
    const { container, surface } = mount();
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    const first = date(container);
    press(surface, 'Escape');
    press(surface, 'ArrowRight');
    press(surface, 'ArrowLeft');
    expect(date(container)).toBe(first);
    press(surface, 'ArrowDown');
    expect(focused(container)).toBe('hi');
  });

  // A line bought later has no point on the first dates: walked there, it is not focused, and
  // walked back to its points, it is again.
  it('holds no focus on a date the focused line has no point on', () => {
    const late = [
      ASSETS[0],
      { ...ASSETS[1], id: 'late', createdAt: '2026-01-09T00:00:00' },
    ] as Asset[];
    const data = DATES.map((date, i) => ({ date, hi: 1, ...(i > 0 ? { late: 2 } : {}) }));
    const r = render(<YieldLines data={data} assets={late} />);
    act(() => vi.advanceTimersByTime(2000));
    const surface = r.container.querySelector<SVGElement>('.recharts-surface')!;
    fireEvent.focus(surface);
    act(() => vi.advanceTimersByTime(100));
    press(surface, 'ArrowRight');
    press(surface, 'ArrowDown');
    expect(focused(r.container)).toBe('mid');
    press(surface, 'ArrowLeft');
    expect(focused(r.container)).toBeNull();
    for (const layer of r.container.querySelectorAll('.recharts-line'))
      expect(layer.classList.contains('opacity-30')).toBe(false);
    press(surface, 'ArrowRight');
    expect(focused(r.container)).toBe('mid');
  });
});
