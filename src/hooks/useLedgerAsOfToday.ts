import { useMemo } from 'react';

import { ledgerAsOf } from '@quirenote/core/view/build';
import { useAssets, useSnapshots, useTransactions } from './queries';
import { useToday } from './useToday';

/** The ledger every figure reads: nothing dated after today, cut as `buildView` cuts it (*Metric
 *  families and windows*). `today` is state, so a row dated tomorrow counts once its day comes. */
export function useLedgerAsOfToday() {
  const assetsData = useAssets().data;
  const snapshotsData = useSnapshots().data;
  const transactionsData = useTransactions().data;
  const today = useToday();
  return useMemo(
    () => ({
      ...ledgerAsOf({
        assets: assetsData ?? [],
        snapshots: snapshotsData ?? [],
        transactions: transactionsData ?? [],
        today,
      }),
      ready:
        assetsData !== undefined && snapshotsData !== undefined && transactionsData !== undefined,
    }),
    [assetsData, snapshotsData, transactionsData, today],
  );
}
