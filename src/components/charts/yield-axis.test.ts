// /yield's y axis (`open-values-charts-type.md` § Signed, wave 25): steps of 1, 2 or 5 × 10ⁿ, the
// smallest that spans the domain in at most five intervals; every label but zero carries the step's
// decimals, so each names its own gridline and no two print the same (#339); zero is «0 %», unsigned.
import { describe, expect, it } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { MONO_ADVANCE, TICK } from './anatomy';
import { yieldAxis, yieldAxisWidth, yieldTickLabel, yieldValueLabel } from './yield-axis';

const uk = makeFormat('uk');
const en = makeFormat('en');

// #339's two ranges, a calm window, a wide one, the seed's «1 місяць» and «Від початку», a loss.
const RANGES: [number, number][] = [
  [0, 2.88],
  [0, 2.76],
  [0, 0.4],
  [0, 0.04],
  [-1, 8],
  [-0.008, 2.764],
  [0, 5.198],
  [-3.3, 0],
  [-0.6, 0.35],
  [0, 140],
];

const isNiceStep = (s: number) => {
  const n = Math.floor(Math.log10(s) + 1e-9);
  const m = Math.round((s / 10 ** n) * 1e6) / 1e6;
  return m === 1 || m === 2 || m === 5;
};

// A label read back as a number: the sign, a decimal comma, a percent with or without its space.
const parse = (label: string) =>
  Number(label.replace('−', '-').replace('+', '').replace(',', '.').replace(/\s?%$/u, ''));

describe('the step', () => {
  it.each(RANGES)(
    '[%s, %s] is the smallest 1-2-5 step that spans it, zero included, in ≤ 5',
    (lo, hi) => {
      const { ticks, step, domain } = yieldAxis(lo, hi);
      expect(isNiceStep(step), `step ${step}`).toBe(true);
      expect(domain).toEqual([ticks[0], ticks.at(-1)]);
      expect(ticks[0]).toBeLessThanOrEqual(Math.min(lo, 0));
      expect(ticks.at(-1)!).toBeGreaterThanOrEqual(Math.max(hi, 0));
      expect(ticks).toContain(0);
      expect(ticks.length - 1).toBeLessThanOrEqual(5);
      ticks.slice(1).forEach((t, i) => expect(t - ticks[i]).toBeCloseTo(step, 9));
      // The next smaller 1-2-5 step would need more than five intervals.
      const prev = isNiceStep(step / 2) ? step / 2 : step / 2.5;
      const intervals =
        Math.ceil(Math.max(hi, 0) / prev - 1e-9) - Math.floor(Math.min(lo, 0) / prev + 1e-9);
      expect(intervals).toBeGreaterThan(5);
    },
  );

  it('reads the seed: «Від початку» 0 to +6 by 2, «1 місяць» −1 to +3 by 1', () => {
    expect(yieldAxis(0, 5.198).ticks).toEqual([0, 2, 4, 6]);
    expect(yieldAxis(-0.008, 2.764).ticks).toEqual([-1, 0, 1, 2, 3]);
  });

  it("puts #339's ranges on whole percent, where recharts put them on 0,75 and 0,7", () => {
    expect(yieldAxis(0, 2.88).ticks).toEqual([0, 1, 2, 3]);
    expect(yieldAxis(0, 2.76).ticks).toEqual([0, 1, 2, 3]);
  });

  it('gives a flat window one step above zero, never a single gridline', () => {
    expect(yieldAxis(0, 0).ticks).toEqual([0, 1]);
  });

  // The tooltip prints two decimals, so a span under half a hundredth is flat on every reading:
  // float residue of an unmoved price must not reach a step that rounds to nothing.
  it.each([
    [0, 1.1e-14],
    [-2.2e-14, 0],
    [0, 2e-8],
    [0, 0.004],
  ])('reads [%s, %s] as flat', (lo, hi) => {
    expect(yieldAxis(lo, hi)).toEqual({ ticks: [0, 1], domain: [0, 1], step: 1, decimals: 0 });
  });

  it('steps no finer than a hundredth, the precision the tooltip prints', () => {
    expect(yieldAxis(0, 0.012)).toMatchObject({ ticks: [0, 0.01, 0.02], step: 0.01, decimals: 2 });
  });
});

describe('the value', () => {
  it('signs the figure it prints, so a near-zero value reads «0,00 %»', () => {
    const value = yieldValueLabel(uk);
    expect(value(-0.004)).toBe('0,00 %');
    expect(value(0.004)).toBe('0,00 %');
    expect(value(-0.006)).toBe('−0,01 %');
    expect(value(4.414)).toBe('+4,41 %');
    expect(value(0)).toBe('0,00 %');
  });
});

describe('the labels', () => {
  it.each(RANGES)('[%s, %s]: each names its gridline, none repeats, one precision', (lo, hi) => {
    const { ticks, decimals } = yieldAxis(lo, hi);
    const label = yieldTickLabel(uk, decimals);
    const labels = ticks.map(label);
    expect(new Set(labels).size).toBe(labels.length);
    labels.forEach((l, i) => expect(parse(l)).toBeCloseTo(ticks[i], 9));
    for (const l of labels.filter((_, i) => ticks[i] !== 0)) {
      expect(l).toMatch(/^[+−]/u);
      expect((l.match(/,(\d+)/u)?.[1] ?? '').length).toBe(decimals);
    }
  });

  it('prints zero «0 %», unsigned and with no decimals', () => {
    for (const [lo, hi] of RANGES) {
      const { ticks, decimals } = yieldAxis(lo, hi);
      if (ticks.includes(0)) expect(yieldTickLabel(uk, decimals)(0)).toBe('0 %');
    }
  });

  it('prints whole ticks with no decimals: «0 %», «+2 %», «−1 %»', () => {
    const { ticks, decimals } = yieldAxis(-0.008, 2.764);
    expect(ticks.map(yieldTickLabel(uk, decimals))).toEqual([
      '−1 %',
      '0 %',
      '+1 %',
      '+2 %',
      '+3 %',
    ]);
    expect(ticks.map(yieldTickLabel(en, decimals))).toEqual(['−1%', '0%', '+1%', '+2%', '+3%']);
  });

  it('carries the step’s decimals on a calm window: «+0,1 %» … «+0,4 %»', () => {
    const { ticks, decimals } = yieldAxis(0, 0.4);
    expect(ticks.map(yieldTickLabel(uk, decimals))).toEqual([
      '0 %',
      '+0,1 %',
      '+0,2 %',
      '+0,3 %',
      '+0,4 %',
    ]);
  });
});

describe('the width', () => {
  it('holds the widest label at the tick face, with room between it and the plot', () => {
    for (const [lo, hi] of RANGES) {
      const { ticks, decimals } = yieldAxis(lo, hi);
      const labels = ticks.map(yieldTickLabel(uk, decimals));
      const widest = Math.max(...labels.map((l) => l.length)) * TICK.fontSize * MONO_ADVANCE;
      expect(yieldAxisWidth(labels)).toBeGreaterThanOrEqual(Math.ceil(widest) + 8);
    }
  });
});
