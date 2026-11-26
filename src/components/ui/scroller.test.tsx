// @vitest-environment jsdom
// The scroll surface's construction (controls.md § Wave 28, Signed): a thumb-wide Scrollbar with a
// rail half the thumb drawn inside it, and nothing filled or stroked but the two of them.
import { cleanup, render, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { declaredIn, mixOf, ruleBody, stripCss, themeBlocks } from '../../__fixtures__/palette';
import { Scroller } from './Scroller';

const CSS = stripCss(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.css'), 'utf8'),
  'index.css',
);

// Radix mounts an `auto` bar only once a resize shows the viewport overflowing, and jsdom lays
// nothing out: every box reads 100 across and its content 300, and an observer fires at once.
const SIZES = { offsetWidth: 100, offsetHeight: 100, scrollWidth: 300, scrollHeight: 300 };
const saved = new Map<string, PropertyDescriptor | undefined>();
const savedObserver = globalThis.ResizeObserver;

beforeAll(() => {
  for (const [key, value] of Object.entries(SIZES)) {
    saved.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe() {
      this.callback([], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
});

afterAll(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
  globalThis.ResizeObserver = savedObserver;
});

afterEach(cleanup);

async function mount(props: { overlay?: boolean } = {}) {
  const { container } = render(
    <Scroller orientation="both" {...props}>
      <p>content</p>
    </Scroller>,
  );
  const root = container.firstElementChild as HTMLElement;
  await waitFor(() => {
    expect(root.querySelectorAll(':scope > [data-orientation]')).toHaveLength(2);
    expect(root.querySelectorAll(':scope > [data-orientation] > *')).toHaveLength(2);
  });
  const bar = (o: 'vertical' | 'horizontal') =>
    root.querySelector<HTMLElement>(`:scope > [data-orientation=${o}]`)!;
  return { root, bar, thumb: (o: 'vertical' | 'horizontal') => bar(o).firstElementChild! };
}

const px = (root: HTMLElement, name: string) => parseFloat(root.style.getPropertyValue(name));
const classes = (el: Element) => el.getAttribute('class')!.split(/\s+/);

describe('the scroll surface (wave 28)', () => {
  // The rail's radius is fixed rather than a quarter of its width (*Scrolling*).
  it('derives the rail from the one thumb width, half of it, at r1', async () => {
    const { root } = await mount();
    const thumb = px(root, '--thumb-w');
    expect(thumb).toBe(6);
    expect(px(root, '--rail-w')).toBe(thumb / 2);
    expect(px(root, '--rail-r')).toBe(1);
  });

  it('reserves 2 × 8 + 6 − 4 = 18, and floats an overlay bar 2 from its edge', async () => {
    expect(px((await mount()).root, '--rail-gutter')).toBe(18);
    cleanup();
    expect(px((await mount({ overlay: true })).root, '--rail-inset')).toBe(2);
  });

  it.each(['vertical', 'horizontal'] as const)(
    'sizes the %s Scrollbar to the thumb and draws the rail inside it from the rail variables',
    async (o) => {
      const cls = classes((await mount()).bar(o));
      const across = o === 'vertical' ? 'w' : 'h';
      expect(cls).toContain(`data-[orientation=${o}]:${across}-(--thumb-w)`);
      // Preflight zeroes the box's padding; no class may add one back.
      expect(cls.filter((c) => /^(?:[a-z-]+:)*p[xytrbl]?-/.test(c))).toEqual([]);
      // The rail is a layer, never in the flow, where it would push the thumb.
      expect(cls).toContain('before:absolute');
      expect(cls).toContain('before:pointer-events-none');
      expect(cls).toContain(`data-[orientation=${o}]:before:${across}-(--rail-w)`);
      expect(cls).toContain('before:rounded-(--rail-r)');
      expect(cls).toContain('before:scroll-rail');
    },
  );

  // The well's fill and an edge of its own; the well's inset shadow's blur would fill a rail this narrow.
  it('paints the rail in the well’s fill and an edge of its own, without the well’s inset shadow', () => {
    const well = ruleBody(CSS, '@utility glass-well');
    const rail = ruleBody(CSS, '@utility scroll-rail');
    const fill = /background-color:\s*([^;]+);/;
    expect(rail.match(fill)?.[1]).toBe(well.match(fill)?.[1]);
    expect(rail).toContain('box-shadow: inset 0 0 0 1px var(--color-scroll-rail-edge)');
    expect(rail).not.toMatch(/--shadow-glass-well/);
  });

  // Light's edge is the well's ring. A hairline reads weaker on a dark plane, so dark doubles its
  // alpha (*Scrolling*).
  it('draws the rail’s edge as the well’s ring in light and at twice its alpha in dark', () => {
    const blocks = themeBlocks(CSS);
    const ring = ruleBody(CSS, '@utility glass-well').match(
      /inset 0 0 0 1px (color-mix\([^;]*?transparent\))/,
    )?.[1];
    expect(ring, 'the well lost its ring').toBeDefined();
    expect(declaredIn(blocks.light, 'scroll-rail-edge')).toBe(ring);
    const light = mixOf(blocks, 'light', 'scroll-rail-edge');
    const dark = mixOf(blocks, 'dark', 'scroll-rail-edge');
    expect(dark.alpha).toBeCloseTo(2 * light.alpha, 5);
    expect(declaredIn(blocks.dark, 'scroll-rail-edge')).toBe(ring!.replace(/ [0-9.]+%/, ' 16%'));
  });

  it.each(['vertical', 'horizontal'] as const)(
    'gives the %s rail, thumb and Scrollbar no border, and the Scrollbar no fill',
    async (o) => {
      const { bar, thumb } = await mount();
      const barCls = classes(bar(o));
      expect(barCls.filter((c) => /^(?:[a-z-]+:)*bg-/.test(c) && !c.includes('before:'))).toEqual(
        [],
      );
      // Preflight zeroes every border; no class on the bar, its rail or the thumb adds one.
      const stroke = (c: string) => /(?:^|:)border(?:-|$)/.test(c);
      expect(barCls.filter(stroke)).toEqual([]);
      expect(classes(thumb(o)).filter(stroke)).toEqual([]);
    },
  );

  it.each([
    ['vertical', '90deg'],
    ['horizontal', '180deg'],
  ] as const)(
    'paints the %s thumb accent at rest, accent-hover hovered and accent-pressed dragged, r2, its sheen at %s',
    async (o, angle) => {
      const cls = classes((await mount()).thumb(o));
      for (const c of ['bg-accent', 'hover:bg-accent-hover', 'active:bg-accent-pressed']) {
        expect(cls).toContain(c);
      }
      expect(cls).toContain('rounded-[2px]');
      // The sheen runs across the thumb's short side: from the left on a vertical bar.
      expect(cls).toContain(
        `bg-[linear-gradient(${angle},var(--color-glass-knob-sheen)_0%,transparent_40%)]`,
      );
    },
  );

  it.each(['vertical', 'horizontal'] as const)(
    'forces the %s thumb to CanvasText and its rail to GrayText under forced colours',
    async (o) => {
      const { bar, thumb } = await mount();
      // Hovered and dragged too: `:hover` outranks a bare forced class, and forced colours turn
      // an author fill into `Canvas`, so the thumb would vanish under the pointer.
      for (const c of ['', 'hover:', 'active:']) {
        expect(classes(thumb(o))).toContain(`forced-colors:${c}bg-[CanvasText]`);
      }
      expect(classes(bar(o))).toContain('forced-colors:before:bg-[GrayText]');
    },
  );
});
