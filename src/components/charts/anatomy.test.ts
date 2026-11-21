import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CHART } from '@quirenote/core/colors';
import { stripCss } from '../../__fixtures__/palette';
import { CHART_MOTION, TICK, ringed, tooltipPlacement } from './anatomy';

// The values the C2 anatomy signs (`charts.md` § Signed › Anatomy), each held in one place.
const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '../../index.css'), 'utf8'), 'index.css');

describe('the tick labels', () => {
  it('are 11 px JetBrains Mono in `muted`', () => {
    expect(TICK).toEqual({ fontSize: 11, fill: CHART.muted, className: 'font-mono' });
  });
});

describe('the motion', () => {
  // `'auto'` is recharts' own reduced-motion check; a bare `true` opts out of it (#663).
  it("is 400 ms through recharts' reduced-motion check", () => {
    expect(CHART_MOTION.isAnimationActive).toBe('auto');
    expect(CHART_MOTION.animationDuration).toBe(400);
  });

  // recharts takes a curve string, never a `var()`, so the CSS token is mirrored here.
  it('is on `ease-soft`, the curve the stylesheet declares', () => {
    const soft = CSS.match(/--ease-soft:\s*([^;]+);/)?.[1];
    expect(soft, 'index.css declares no `--ease-soft`').toBeDefined();
    const norm = (s: string) => s.replace(/\s+/g, '');
    expect(norm(CHART_MOTION.animationEasing)).toBe(norm(soft!));
  });
});

describe('the ringed marker', () => {
  // r4 in the series colour on an r6 `card` disc: one circle, r5, with a 2 px `card` stroke.
  it('is the series colour inside a 2 px `card` ring', () => {
    expect(ringed('var(--x)')).toEqual({
      r: 5,
      fill: 'var(--x)',
      stroke: CHART.card,
      strokeWidth: 2,
    });
    expect(CHART.card).toBe('var(--color-chart-card)');
  });
});

describe('the tooltip placement', () => {
  const wide = { x: 40, y: 8, width: 800, height: 200 };
  const narrow = { x: 40, y: 8, width: 300, height: 200 };

  it('sits right of the crosshair up to mid-plot', () => {
    expect(tooltipPlacement(wide, 100)).toEqual({ reverseDirection: { x: false, y: false } });
    expect(tooltipPlacement(wide, 440)).toEqual({ reverseDirection: { x: false, y: false } });
  });

  it('sits left of it past mid-plot', () => {
    expect(tooltipPlacement(wide, 441)).toEqual({ reverseDirection: { x: true, y: false } });
  });

  it("is held inside the plot's left edge on a plot under 500 px, and wraps to its width", () => {
    expect(tooltipPlacement(narrow, 300)).toEqual({
      position: { x: 40 },
      reverseDirection: { x: false, y: false },
      maxWidth: 300,
    });
    expect(tooltipPlacement({ ...narrow, width: 500 }, 100)).not.toHaveProperty('position');
  });

  it('leaves recharts its own placement before the plot is measured', () => {
    expect(tooltipPlacement(undefined, undefined)).toEqual({
      reverseDirection: { x: false, y: false },
    });
  });
});
