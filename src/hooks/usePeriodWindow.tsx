import type { ReactNode } from 'react';

import { PeriodControl } from '../components/ui/PeriodControl';
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { windowView } from '@quirenote/core/view/window';
import { useSettings } from '../state/settings';

/**
 * The period a screen shows and the control that sets it, as one call. The screen reads its
 * window back from its composer; `view/window.test.ts` holds the control's hints equal to it.
 *
 * `control` is `undefined`, not an element that renders null: `ScreenHeader`
 * branches on `actions === undefined`, and a defined element that happens to render
 * nothing would still put an empty action row on an empty-dataset screen, breaking
 * the byte-identity that component's doc pins.
 */
export function usePeriodWindow(
  assets: Asset[],
  snapshots: Snapshot[],
  transactions: Transaction[],
): { period: PeriodOption; control: ReactNode | undefined } {
  const period = useSettings((s) => s.period);
  const span = windowView({ assets, snapshots, transactions, period: 'all' });
  return {
    period,
    control: span ? <PeriodControl from={span.from} to={span.to} /> : undefined,
  };
}
