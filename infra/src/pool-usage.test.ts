import { describe, expect, it, vi } from 'vitest';

import { FREE_TIER_USERS, poolUsage, type PoolReader } from './pool-usage';

// There is no CloudWatch metric for monthly actives, so the pool's total user count
// stands in for one. Here, the two things only the handler can get wrong: which pool
// it asks about, and whether a read that produced no count can look like an answer.

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
      // on an empty series.
      expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual(line);
    } finally {
      log.mockRestore();
    }
  });

  // A REAL ZERO IS A COUNT, AND AN ABSENT ONE IS NOT, which is why the check below is
  // `=== undefined`: a `!value` guard reads the two alike and turns a legitimately
  // empty pool into an error every night.
  it('publishes a real zero as zero', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const { reader } = pool({ UserPool: { EstimatedNumberOfUsers: 0 } });
      expect((await poolUsage(reader, POOL)).value).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  // THE ASSERTION THIS FILE EXISTS FOR. This alarm is `GreaterThan`, so the bad side
  // is high and a pool that answered without a count would publish 0 and read as
  // healthy forever. `EstimatedNumberOfUsers` is optional in the SDK's own types, so
  // it is a shape the compiler forces a decision about rather than a hypothetical.
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

  // IT THROWS RATHER THAN WARNING, like `backup-freshness.ts` and unlike the capture,
  // which has a perishable price to write first. This function has no other work, so a
  // swallowed error would be a successful-looking invocation that measured nothing, and
  // `PoolUsageErrorAlarm` turns the throw into a signal.
  it('lets a failed read out rather than reporting it as an answer', async () => {
    const reader: PoolReader = {
      describeUserPool: async () => {
        throw new Error('AccessDeniedException');
      },
    };
    await expect(poolUsage(reader, POOL)).rejects.toThrow('AccessDeniedException');
  });

  // THE CEILING ONLY: the alarm's threshold lives in the template, and
  // `stack-split.test.ts` is where the two are held against each other.
  it('names the ceiling the threshold is derived from', () => {
    expect(FREE_TIER_USERS).toBe(10_000);
  });
});
