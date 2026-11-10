// @vitest-environment jsdom
// Tap to pin on the three charts that carry a tooltip, below `md`
// (`docs/superpowers/specs/2026-11-05-layout-refresh/charts.md` § Перенесено).
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { cloneElement, type ReactElement } from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import type { Asset } from '@quirenote/core/types';

// Below `md` unless a test crosses the breakpoint.
const breakpoint = { wide: false, listeners: new Set<() => void>() };
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && breakpoint.wide;
  },
  media: query,
  addEventListener: (_: string, f: () => void) => breakpoint.listeners.add(f),
  removeEventListener: (_: string, f: () => void) => breakpoint.listeners.delete(f),
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
afterAll(() => vi.unstubAllGlobals());

function cross(wide: boolean) {
  breakpoint.wide = wide;
  act(() => breakpoint.listeners.forEach((f) => f()));
}

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

afterEach(() => {
  cleanup();
  breakpoint.wide = false;
});

const DATES = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05', '2026-05-05'];
const ASSET = { id: 'a1', name: 'Asset one', colorKey: 'reit' } as Asset;

// Five points on each: with recharts reading jsdom's zero-sized rect as the origin, x = 130 lands
// on the second point and x = 300 on the fourth of every plot here, and y = 198 is the x-axis strip
// under the plot. With two points, x = 380 lands on the second.
const CHARTS: [string, (n?: number) => ReactElement][] = [
  [
    'Balances',
    (n = 5) => (
      <BalancesArea
        data={DATES.slice(0, n).map((date, i) => ({ date, total: 100_000 + i * 1000 }))}
      />
    ),
  ],
  [
    'Payouts',
    (n = 5) => (
      <PayoutsBars
        data={['Jan', 'Feb', 'Mar', 'Apr', 'May'].slice(0, n).map((monthLabel, i) => ({
          monthLabel,
          dividends: 100 + i,
          coupons: 50 + i,
          totalLabel: String(150 + 2 * i),
        }))}
      />
    ),
  ],
  [
    'Yield',
    (n = 5) => (
      <YieldLines data={DATES.slice(0, n).map((date, i) => ({ date, a1: i }))} assets={[ASSET]} />
    ),
  ],
];

function tap(container: HTMLElement, x: number, y = 100) {
  const plot = container.querySelector('.recharts-wrapper');
  if (!plot) throw new Error('no chart mounted');
  fireEvent.click(plot, { clientX: x, clientY: y });
}

function pinned(container: HTMLElement) {
  const box = container.querySelector<HTMLElement>('.recharts-tooltip-wrapper');
  return {
    shown: box?.style.visibility === 'visible',
    label: container.querySelector('.recharts-tooltip-label')?.textContent ?? null,
    highlight: container.querySelector('.recharts-active-dot, .recharts-tooltip-cursor') !== null,
  };
}

describe.each(CHARTS)('%s below md', (_name, chart) => {
  it('pins on a tap and releases on a second tap on the same point', () => {
    const { container } = render(chart());
    tap(container, 130);
    expect(pinned(container)).toMatchObject({ shown: true, highlight: true });

    tap(container, 130);
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });

    // And a third tap pins it again: the release is not a dead end.
    tap(container, 130);
    expect(pinned(container)).toMatchObject({ shown: true, highlight: true });
  });

  it('moves the pin on a tap on another point', () => {
    const { container } = render(chart());
    tap(container, 130);
    const first = pinned(container).label;
    tap(container, 300);
    const moved = pinned(container);
    expect(moved.shown).toBe(true);
    expect(moved.label).not.toBe(first);
  });

  it('releases the pin on Escape, highlight and all, and the next tap pins again', () => {
    const { container } = render(chart());
    tap(container, 130);
    expect(pinned(container).shown).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });
    // recharts keeps its own box dismissed while the point is unchanged, so the highlight tells.
    tap(container, 130);
    expect(pinned(container).highlight).toBe(true);
  });

  it('ignores a tap off the plot, on the axis under it', () => {
    const { container } = render(chart());
    tap(container, 130);
    const at = pinned(container);
    tap(container, 300, 198);
    expect(pinned(container)).toEqual(at);

    tap(container, 130);
    tap(container, 300, 198);
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });
  });

  it('releases on a tap on the point a shorter series moved the pin to', () => {
    const { container, rerender } = render(chart());
    tap(container, 300);
    rerender(chart(2));
    expect(pinned(container).shown).toBe(true);
    tap(container, 380);
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });
  });

  it('releases on one tap a pin a click moved while the screen was wide', () => {
    const { container } = render(chart());
    tap(container, 300);
    const fourth = pinned(container).label;
    tap(container, 300);
    tap(container, 130);
    cross(true);
    // recharts records a click at any width, so back below md its pin is the fourth point.
    tap(container, 300);
    cross(false);
    expect(pinned(container)).toMatchObject({ shown: true, label: fourth });
    tap(container, 300);
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });
  });

  it('releases on one tap a pin made by a click while the screen was wide', () => {
    const { container } = render(chart());
    cross(true);
    tap(container, 300);
    cross(false);
    expect(pinned(container).shown).toBe(true);
    tap(container, 300);
    expect(pinned(container)).toMatchObject({ shown: false, highlight: false });
  });

  // recharts' keyboard walk shows the same rows a pin does, but no tap made it.
  it('leaves a keyboard-only tooltip to recharts: after Escape the next arrow shows it', () => {
    const { container } = render(chart());
    key(container, 'ArrowRight');
    expect(pinned(container).shown).toBe(true);
    key(container, 'Escape');
    key(container, 'ArrowRight');
    expect(pinned(container)).toMatchObject({ shown: true, highlight: true });
  });

  it('pins on a first tap at the point the keyboard reached', () => {
    const { container } = render(chart());
    key(container, 'ArrowRight');
    const reached = pinned(container).label;
    tap(container, 130);
    expect(pinned(container)).toMatchObject({ shown: true, label: reached });
  });
});

function key(container: HTMLElement, k: string) {
  const plot = container.querySelector<HTMLElement>('.recharts-wrapper');
  if (!plot) throw new Error('no chart mounted');
  fireEvent.focus(plot);
  fireEvent.keyDown(plot, { key: k });
}
