import { useMemo, type ReactNode } from 'react';

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
  // MEMOISED HERE AND NOT AT THE CALL SITES, because the window is a dependency
  // of nearly every derivation on three screens. `resolveWindow` builds a fresh
  // `{from, to, clamped}` on each call, so an unmemoised return made `win` a new
  // reference every render and silently emptied every `useMemo` keyed on it —
  // `/overview`'s five, and `/seasonality`'s four, including the one the A41
  // review added specifically to stop `dominantExpectedAssetOnDay` re-walking
  // the ledger 31 times a frame. It also handed recharts a new `chartData`
  // identity every render, restarting the 900 ms bar animation on unrelated
  // state changes (A42 review). Patching a third screen would have left the
  // other two broken; the depth that fixes all of them is this one.
  // `resolved`, never `window` — the global is a real binding and shadowing it
  // has cost this codebase time twice already (`PeriodControl` carries the same
  // note).
  const resolved = useMemo(() => resolveWindow(period, from, to), [period, from, to]);
  return {
    window: resolved,
    control:
      from !== undefined && to !== undefined ? <PeriodControl from={from} to={to} /> : undefined,
  };
}
