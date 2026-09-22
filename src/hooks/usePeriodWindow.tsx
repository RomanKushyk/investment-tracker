import { useMemo, type ReactNode } from 'react';

import { PeriodControl } from '../components/ui/PeriodControl';
import { latestSnapshotDate } from '@quirenote/core/dates';
import { portfolioStart } from '@quirenote/core/derive';
import { resolveWindow, type PeriodWindow } from '@quirenote/core/period';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { useSettings } from '../state/settings';

/**
 * The window a screen shows and the control that sets it, as one call.
 *
 * IT RETURNS BOTH BECAUSE RETURNING ONE WOULD LET THEM DISAGREE. A screen that
 * resolves its own window and separately renders a control which resolves its own
 * can drift apart by a line of code, and a header stating a window its figures do
 * not honour is the defect this rules out: there is one `resolveWindow` and the
 * control is built from the same call.
 *
 * `control` is `undefined`, not an element that renders null: `ScreenHeader`
 * branches on `actions === undefined`, and a defined element that happens to render
 * nothing would still put an empty action row on an empty-dataset screen, breaking
 * the byte-identity that component's doc pins.
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
  // MEMOISED HERE AND NOT AT THE CALL SITES: `resolveWindow` builds a fresh
  // `{from, to, clamped}` on each call, so an unmemoised return is a new reference
  // every render, which empties every `useMemo` keyed on it across the three
  // analytics screens and restarts recharts' bar animation on unrelated state
  // changes. Memoising at one call site would leave the other two broken.
  //
  // `resolved`, never `window` — the global is a real binding and shadowing it has
  // cost time here twice (`PeriodControl` carries the same note).
  const resolved = useMemo(() => resolveWindow(period, from, to), [period, from, to]);
  return {
    window: resolved,
    control:
      from !== undefined && to !== undefined ? <PeriodControl from={from} to={to} /> : undefined,
  };
}
