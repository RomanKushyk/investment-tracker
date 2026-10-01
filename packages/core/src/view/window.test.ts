import { describe, expect, it } from 'vitest';

import { latestSnapshotDate } from '../dates';
import { portfolioStart } from '../derive';
import { PERIOD_OPTIONS, resolveWindow } from '../period';
import { TEST_LEDGERS } from './test-ledgers';
import { windowView } from './window';

describe.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))(
  'windowView — %s',
  (_, input) => {
    const span = windowView({ ...input, period: 'all' });

    it('spans the full history at `all`', () => {
      const from = portfolioStart(input.assets, input.snapshots, input.transactions);
      const to = latestSnapshotDate(input.snapshots);
      expect(span).toStrictEqual(
        from === undefined || to === undefined ? undefined : { from, to, clamped: false },
      );
    });

    // `PeriodControl` hints each option with `resolveWindow` over the span; the figures read
    // `windowView`. Equal, so the hint a press shows is the window the figures then use.
    it.each(PERIOD_OPTIONS)('resolves %s to what the period control shows for it', (o) => {
      expect(windowView({ ...input, period: o })).toStrictEqual(
        resolveWindow(o, span?.from, span?.to),
      );
    });
  },
);
