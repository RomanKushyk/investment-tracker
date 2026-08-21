import type { ReactNode } from 'react';

import { PeriodControl } from '../components/ui/PeriodControl';
import { latestSnapshotDate } from '../core/dates';
import { portfolioStart } from '../core/derive';
import { resolveWindow, type PeriodWindow } from '../core/period';
import type { Asset, Snapshot, Transaction } from '../core/types';
import { useSettings } from '../state/settings';

/**
 * The window a screen shows, and the control that sets it — as one call (A39
 * review).
 *
 * IT RETURNS BOTH BECAUSE RETURNING ONE WOULD LET THEM DISAGREE. A screen that
 * resolves its own window and separately renders a control which resolves its
 * own can drift apart by a line of code, and a header stating a window its
 * figures do not honour is exactly the defect A38's review rejected. Here there
 * is one `resolveWindow` and the control is built from the same call.
 *
 * `control` is `undefined`, not an element that renders null, and the
 * difference matters: `ScreenHeader` branches on `actions === undefined`, and a
 * defined element that happens to render nothing would still put an empty
 * action row on an empty-dataset screen — breaking the byte-identity that
 * component's doc pins.
 *
 * `window` is `undefined` when there is nothing to window: no start, or no
 * valuation. Every consumer already treats that as its empty state.
 */
export function usePeriodWindow(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): { window: PeriodWindow | undefined; control: ReactNode | undefined } {
  const period = useSettings((s) => s.period);
  const from = portfolioStart(assets, snapshots, transactions);
  const to = latestSnapshotDate(snapshots);
  return {
    window: resolveWindow(period, from, to),
    control:
      from !== undefined && to !== undefined ? <PeriodControl from={from} to={to} /> : undefined,
  };
}
