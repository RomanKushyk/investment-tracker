// /yield's y axis, shared by its panels and «Разом» (`open-values-charts-type.md` § Signed, wave 25).
import { signed, type Format } from '@quirenote/core/money';
import { MONO_ADVANCE, TICK } from './anatomy';

export interface YieldAxis {
  ticks: number[];
  domain: [number, number];
  step: number;
  /** The step's decimals, which every label but zero carries. */
  decimals: number;
}

// Floating steps drift (0.1 × 3 = 0.30000000000000004); a tick is held to nine places.
const r9 = (x: number) => Math.round(x * 1e9) / 1e9;

// The tooltip and the titles print two decimals: a span under half a hundredth reads flat on every
// one of them, and no step is finer than the hundredth they print.
const FLAT = 0.005;
const FINEST = -2;

/** The smallest step of 1, 2 or 5 × 10ⁿ that spans the domain, zero included, in at most five
 *  intervals; a flat window gets one step above zero, where d3's `ticks` would give one line. */
export function yieldAxis(lo: number, hi: number): YieldAxis {
  const min = Math.min(lo, 0);
  const max = Math.max(hi, 0);
  if (max - min < FLAT) return { ticks: [0, 1], domain: [0, 1], step: 1, decimals: 0 };
  for (let e = Math.max(FINEST, Math.floor(Math.log10((max - min) / 5))); ; e++) {
    for (const m of [1, 2, 5]) {
      const step = r9(m * 10 ** e);
      const from = Math.floor(r9(min / step));
      const to = Math.ceil(r9(max / step));
      if (to - from > 5) continue;
      const ticks = Array.from({ length: to - from + 1 }, (_, i) => r9((from + i) * step));
      return { ticks, domain: [ticks[0], ticks.at(-1)!], step, decimals: Math.max(0, -e) };
    }
  }
}

/** Zero is «0 %», unsigned; every other tick signed, with the step's decimals. The values are
 *  already in percent, so `pctPlain` and never `pct`, which takes a fraction. */
export function yieldTickLabel(f: Pick<Format, 'pctPlain'>, decimals: number) {
  return (v: number) => (v === 0 ? f.pctPlain(0, 0) : signed(v, f.pctPlain(Math.abs(v), decimals)));
}

/** A curve's own figure, in the panel titles and both tooltips: two decimals, signed by what is
 *  printed, so a value that rounds to nothing reads «0,00 %» and never «−0,00 %». */
export function yieldValueLabel(f: Pick<Format, 'pctPlain'>) {
  return (n: number) =>
    Number(Math.abs(n).toFixed(2)) === 0 ? f.pctPlain(0, 2) : signed(n, f.pctPlain(Math.abs(n), 2));
}

/** The axis holds its widest label at the tick face, plus recharts' 8 px between label and plot
 *  and 4 px at the card's edge. */
export function yieldAxisWidth(labels: string[]): number {
  const widest = Math.max(...labels.map((l) => l.length));
  return Math.ceil(widest * TICK.fontSize * MONO_ADVANCE) + 12;
}
