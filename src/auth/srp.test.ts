import { describe, expect, it } from 'vitest';

import vectors from './__fixtures__/srp-vectors.json';
import { cognitoTimestamp, passwordClaim, srpStart } from './srp';

// THE VECTORS ARE THE REFERENCE LIBRARY'S (amazon-cognito-identity-js 6.3.16, a fixed `a`), and
// cover A, B, the salt and U each with and without the high bit, so every padding branch is crossed.
describe('the SRP port answers as the reference library does', () => {
  it.each(vectors)('A and the claim for pool $poolName, password $password', async (v) => {
    const { srpA } = srpStart(BigInt(`0x${v.a}`));
    expect(srpA).toBe(v.srpA);

    const signature = await passwordClaim({
      a: BigInt(`0x${v.a}`),
      poolName: v.poolName,
      userId: v.userId,
      password: v.password,
      srpB: v.srpB,
      salt: v.salt,
      secretBlock: v.secretBlock,
      timestamp: v.timestamp,
    });
    expect(signature).toBe(v.signature);
  });

  it('draws a fresh a each time it is not given one', () => {
    expect(srpStart().srpA).not.toBe(srpStart().srpA);
  });

  it('refuses a B that is zero modulo N, as the protocol requires', async () => {
    const v = vectors[0];
    await expect(passwordClaim({ ...v, a: BigInt(`0x${v.a}`), srpB: '0' })).rejects.toThrow();
  });
});

describe('the timestamp Cognito signs', () => {
  it('leaves the day unpadded and the time padded, in UTC', () => {
    expect(cognitoTimestamp(new Date(Date.UTC(2026, 8, 5, 7, 3, 9)))).toBe(
      'Sat Sep 5 07:03:09 UTC 2026',
    );
    expect(cognitoTimestamp(new Date(Date.UTC(2026, 8, 26, 10, 0, 0)))).toBe(
      'Sat Sep 26 10:00:00 UTC 2026',
    );
  });
});
