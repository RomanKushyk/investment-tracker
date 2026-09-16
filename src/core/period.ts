// The analysis WINDOW answers one question — what dates the chosen period covers
// — and nothing else. What each figure DOES with them differs by kind, and keeping
// that out of here is what stops this file growing a per-metric opinion.
import { addMonths } from './dates';

export type PeriodOption = 'all' | '1m' | '3m' | '6m' | '12m' | 'ytd';

/**
 * Exported because two callers need the SAME list and must not keep their own:
 * the control renders it, and `migrateSettings` validates a persisted value
 * against it. A union type vanishes at runtime, so a stored `"1y"` would reach
 * `resolveWindow` and fall through its switch to a window nobody chose.
 */
export const PERIOD_OPTIONS = ['all', '1m', '3m', '6m', '12m', 'ytd'] as const;

/**
 * The witness that keeps the list COMPLETE. `readonly PeriodOption[]` promises
 * only that every entry is a member — a seventh option compiles with the array
 * untouched, and the failure is silent: it never renders, and `migrateSettings`
 * then resets the saved period on every reload.
 */
const _PERIOD_OPTIONS_EXHAUSTIVE: Record<PeriodOption, true> = {
  all: true,
  '1m': true,
  '3m': true,
  '6m': true,
  '12m': true,
  ytd: true,
};
void _PERIOD_OPTIONS_EXHAUSTIVE;

export interface PeriodWindow {
  from: string;
  to: string;
  /**
   * The option reached FURTHER BACK than the data goes. A "12 months" that
   * silently covers five is a span the data does not fill, presented as though it
   * does. The UI decides what to do with the flag; what it may not do is show the
   * label without it.
   */
  clamped: boolean;
}

const MONTHS_BACK: Record<Exclude<PeriodOption, 'all' | 'ytd'>, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12,
};

/**
 * **Counted back from the LATEST SNAPSHOT, never from today.** Today is not a
 * portfolio fact — it moves while the data does not, so "3 months" measured to
 * today would lengthen every night on a portfolio nobody updated, and would
 * disagree with the `daysHeld` every other figure on these screens uses.
 */
export function resolveWindow(
  option: PeriodOption,
  start: string | undefined,
  to: string | undefined,
): PeriodWindow | undefined {
  if (!start || !to) return undefined;

  // `all` is not "the widest option" but the ABSENCE of one, and it must never
  // carry the clamp mark: that would warn about the default state, which is the
  // state that reproduces every pinned figure.
  if (option === 'all') return { from: start, to, clamped: false };

  const requested =
    option === 'ytd' ? `${to.slice(0, 4)}-01-01` : addMonths(to, -MONTHS_BACK[option]);

  // Clamped means "you asked for more than exists" — hence the REQUEST, not the result.
  return requested < start
    ? { from: start, to, clamped: true }
    : { from: requested, to, clamped: false };
}
