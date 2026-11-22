// The ticks of the date axes and of the capital area (`charts.md` § Signed › Anatomy, C2; the y
// steps are wave 25's, `open-values-charts-type.md` § Signed).
import { NARROW_PLOT } from './anatomy';

/** Seven dates on a wide plot and the first, middle and last on a narrow one, evenly spaced by
 *  index: a category axis places its points by index. A plot not yet measured reads as narrow. */
export function dateTicks<T>(dates: T[], plotWidth: number | undefined): T[] {
  const count = plotWidth !== undefined && plotWidth >= NARROW_PLOT ? 7 : 3;
  if (dates.length <= count) return dates;
  return Array.from(
    { length: count },
    (_, i) => dates[Math.round((i * (dates.length - 1)) / (count - 1))],
  );
}

export interface CapitalAxis {
  domain: [number, number];
  ticks: number[];
  step: number;
}

/** The capital area keeps its cropped domain, the data min − 5 000 to the max + 2 000, by the
 *  owner's ruling; its gridlines are the multiples inside it of the smallest step of 1, 2 or
 *  5 × 10ⁿ that spans it in at most five intervals. Takes one value at least: /balances draws
 *  its empty state instead of an empty chart. */
export function capitalAxis(values: number[]): CapitalAxis {
  const lo = Math.min(...values) - 5_000;
  const hi = Math.max(...values) + 2_000;
  for (let e = Math.floor(Math.log10((hi - lo) / 5)); ; e++) {
    for (const m of [1, 2, 5]) {
      const step = m * 10 ** e;
      if (Math.ceil(hi / step) - Math.floor(lo / step) > 5) continue;
      const from = Math.ceil(lo / step);
      const to = Math.floor(hi / step);
      const ticks = Array.from({ length: to - from + 1 }, (_, i) => (from + i) * step);
      return { domain: [lo, hi], ticks, step };
    }
  }
}
