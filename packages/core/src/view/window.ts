// The window a period option resolves to — the composer every windowed screen and the
// period control read, so a header can never state a window its figures do not use.
import { latestSnapshotDate } from '../dates';
import { portfolioStart } from '../derive';
import { resolveWindow, type PeriodWindow } from '../period';
import type { LedgerInput, PeriodInput } from './input';

/** From the portfolio's start to its latest valuation, cut to the option. `undefined`
 *  when there is nothing to window: no start, or no valuation. */
export function windowView({
  assets,
  snapshots,
  transactions,
  period,
}: LedgerInput & PeriodInput): PeriodWindow | undefined {
  return resolveWindow(
    period,
    portfolioStart(assets, snapshots, transactions),
    latestSnapshotDate(snapshots),
  );
}
