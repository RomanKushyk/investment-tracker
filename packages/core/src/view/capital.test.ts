import { describe, expect, it } from 'vitest';

import { headlineKpis } from '../derive';
import { capitalView } from './capital';
import { TEST_LEDGERS } from './test-ledgers';

describe('capitalView', () => {
  it.each(TEST_LEDGERS.map((l) => [l.name, l.input] as const))(
    'is the headline figure, never windowed — %s',
    (_, input) => {
      expect(capitalView(input)).toStrictEqual(headlineKpis(input.snapshots, input.transactions));
    },
  );
});
