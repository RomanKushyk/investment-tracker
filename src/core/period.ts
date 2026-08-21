// The analysis WINDOW — which slice of the history every figure on `/yield`,
// `/overview` and `/seasonality` is measured over (A27, Phase 8 brief § G-5).
//
// This module answers one question — "what dates does the chosen period cover"
// — and nothing else. What each figure DOES with those dates is the caller's,
// and it differs by kind: a FLOW sums over the window, a STOCK is a level at
// its end, a RETURN needs both ends. The brief calls that the spine; keeping it
// out of here is what stops this file from growing a per-metric opinion.
import { addMonths } from './dates';

/**
 * `all` is the default and reproduces today's behaviour exactly — every screen
 * measured since the portfolio began.
 */
export type PeriodOption = 'all' | '1m' | '3m' | '6m' | '12m' | 'ytd';

/**
 * The six, in the order they are offered. Exported because two callers need the
 * SAME list and must not keep their own: the control renders it, and
 * `migrateSettings` validates a persisted value against it (A38). A union type
 * vanishes at runtime, so a stored `"1y"` would otherwise reach `resolveWindow`
 * and fall through its switch to a window nobody chose.
 */
export const PERIOD_OPTIONS = ['all', '1m', '3m', '6m', '12m', 'ytd'] as const;

/**
 * The witness that keeps the list COMPLETE (A38 review). `readonly
 * PeriodOption[]` only promised every entry was a member — adding a seventh
 * option to the union above would have compiled with the array untouched, and
 * the failure is silent and nasty: the option never renders, and
 * `migrateSettings` then rejects it and resets a user's saved period to `'all'`
 * on every reload. This line makes that a type error instead.
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
  /** Inclusive, ISO `yyyy-MM-dd`. */
  from: string;
  /** Inclusive, ISO `yyyy-MM-dd`. */
  to: string;
  /**
   * The option reached FURTHER BACK than the data goes, so `from` is the
   * portfolio's start rather than the date asked for.
   *
   * It exists because of G-3: a "12 months" that silently covers five is the
   * same defect A24 removed from `PORTFOLIO_START` — a span the data does not
   * fill, presented as though it does. The UI decides what to do with the flag;
   * what it may not do is show the label without it.
   */
  clamped: boolean;
}

/** Months back from `to`, per option. `all` and `ytd` are computed, not listed. */
const MONTHS_BACK: Record<Exclude<PeriodOption, 'all' | 'ytd'>, number> = {
  '1m': 1,
  '3m': 3,
  '6m': 6,
  '12m': 12,
};

/**
 * The concrete window an option resolves to, or `undefined` when there is no
 * history to window.
 *
 * `start` is `portfolioStart(...)` and `to` is `latestSnapshotDate(...)`.
 *
 * **Counted back from the LATEST SNAPSHOT, never from today.** Today is not a
 * portfolio fact — it moves while the data does not, so "3 months" measured to
 * today would quietly lengthen every night on a portfolio nobody updated, and
 * would disagree with the `daysHeld` every other figure on these screens is
 * already measured to (`latestSnapshotDate`, and A24's derived start).
 *
 * Dates are ISO, so `<` is chronological and the comparisons below need no
 * parsing — the same property `byDate` and `portfolioStart` rely on.
 */
export function resolveWindow(
  option: PeriodOption,
  start: string | undefined,
  to: string | undefined,
): PeriodWindow | undefined {
  if (!start || !to) return undefined;

  // `all` is not "the widest option" — it is the absence of one, and it must
  // never carry the clamp mark. Flagging it would put a warning on the default
  // state, which is the state that reproduces every pinned figure.
  if (option === 'all') return { from: start, to, clamped: false };

  const requested = option === 'ytd' ? `${to.slice(0, 4)}-01-01` : addMonths(to, -MONTHS_BACK[option]);

  // Clamped means "you asked for more than exists", which is why it is decided
  // by comparing the REQUEST against the start rather than the result.
  return requested < start
    ? { from: start, to, clamped: true }
    : { from: requested, to, clamped: false };
}
