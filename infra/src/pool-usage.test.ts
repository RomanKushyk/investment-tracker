import { describe, expect, it, vi } from 'vitest';

import { FREE_TIER_USERS, poolUsage, type PoolReader } from './pool-usage';

// There is no CloudWatch metric for monthly actives, so the pool's total user count
// stands in for one. This file holds the two things only the handler can get wrong:
// which pool it asks about, and whether a read that produced no count is allowed to
// look like an answer.

const POOL = 'eu-north-1_EXAMPLE';

const pool = (answer: { UserPool?: { EstimatedNumberOfUsers?: number } }) => {
  const asked: { UserPoolId: string }[] = [];
  const reader: PoolReader = {
    describeUserPool: async (input) => {
      asked.push(input);
      return answer;
    },
  };
  return { reader, asked };
};

describe('poolUsage', () => {
  it('asks about the pool it was given', async () => {
    const { reader, asked } = pool({ UserPool: { EstimatedNumberOfUsers: 3 } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await poolUsage(reader, POOL);
    } finally {
      log.mockRestore();
    }
    expect(asked).toEqual([{ UserPoolId: POOL }]);
  });

  it('publishes the count and the pool as one line', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = pool({ UserPool: { EstimatedNumberOfUsers: 42 } });
      const line = await poolUsage(reader, POOL);
      expect(line).toEqual({ metric: 'poolUsers', pool: POOL, value: 42 });
      // The log line IS the metric — `PoolUsersMetricFilter` reads `$.value` off it, so
      // a line that stopped being emitted, or stopped being JSON, would leave the alarm
      // on an empty series with nothing else reporting it.
      expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(line);
    } finally {
      log.mockRestore();
    }
  });

  // A REAL ZERO IS A COUNT, AND AN ABSENT ONE IS NOT — which is why the check below is
  // `=== undefined` and not a truthiness test. A `!value` guard reads the two as the same
  // thing and turns a legitimately empty pool into an error every night.
  it('publishes a real zero as zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = pool({ UserPool: { EstimatedNumberOfUsers: 0 } });
      expect((await poolUsage(reader, POOL)).value).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  // THE ASSERTION THIS FILE EXISTS FOR, and it is the mirror image of `backup-age.ts`'s.
  // There, "nothing" must publish a LARGE number so it lands on the bad side of a
  // `GreaterThan` threshold. Here the alarm is `GreaterThan` too, so the bad side is
  // also high — and a pool that answers without a count would publish 0 and read as
  // healthy forever. `EstimatedNumberOfUsers` is optional in the SDK's own types, so
  // this is a shape the compiler forces a decision about rather than a hypothetical.
  it('refuses to turn an absent count into a healthy zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = pool({ UserPool: {} });
      await expect(poolUsage(reader, POOL)).rejects.toThrow(/EstimatedNumberOfUsers/);
      await expect(poolUsage(pool({}).reader, POOL)).rejects.toThrow(/EstimatedNumberOfUsers/);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  // IT THROWS RATHER THAN WARNING, like `backup-freshness.ts` and unlike the capture:
  // a capture must not fail because a monitoring read did, because it has a perishable
  // price to write first. This function has no other work, so a swallowed error would be
  // a successful-looking invocation that measured nothing — and `PoolUsageErrorAlarm` is
  // what turns the throw into a signal rather than a line in a log nobody reads.
  it('lets a failed read out rather than reporting it as an answer', async () => {
    const reader: PoolReader = {
      describeUserPool: async () => {
        throw new Error('AccessDeniedException');
      },
    };
    await expect(poolUsage(reader, POOL)).rejects.toThrow('AccessDeniedException');
  });

  // THE CEILING ONLY. The alarm's 8,000 is not asserted here, because the threshold lives
  // in the template — `stack-split.test.ts` is where the two are held against each other,
  // and repeating the figure here would be a second copy no gate reconciles.
  it('names the ceiling the threshold is derived from', () => {
    expect(FREE_TIER_USERS).toBe(10_000);
  });
});
