import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// How many identities the pool holds, published nightly as a number.
//
// A COUNT STANDS IN FOR MONTHLY ACTIVES because CloudWatch publishes no MAU metric. Total users
// is a strict upper bound on this pool's share, so the alarm errs early — but dev identities count
// toward the same account tier and are NOT here, so it bounds prod's share only (*Alerting*).

/** What Cognito Essentials bills nothing below, in monthly active users. The alarm's threshold is
 *  derived from this rather than written beside it: `stack-split.test.ts` pins it to 80% of this
 *  value, under the 85% at which AWS's own Free Tier alert mails the root account. */
export const FREE_TIER_USERS = 10_000;

export type PoolReader = {
  describeUserPool(input: {
    UserPoolId: string;
  }): Promise<{ UserPool?: { EstimatedNumberOfUsers?: number } }>;
};

export interface PoolUsers {
  metric: 'poolUsers';
  pool: string;
  value: number;
}

/**
 * AN ABSENT COUNT IS AN ERROR, NOT A ZERO. The alarm is `GreaterThan`, so 0 is the reading that
 * says "fine": a pool answering without `EstimatedNumberOfUsers` would publish 0 and read as
 * healthy for as long as it kept doing so. It throws rather than warning, unlike the capture —
 * and a throw is no signal on its own, which is what `PoolUsageErrorAlarm` is beside it for.
 */
export async function poolUsage(idp: PoolReader, pool: string): Promise<PoolUsers> {
  const { UserPool } = await idp.describeUserPool({ UserPoolId: pool });
  const value = UserPool?.EstimatedNumberOfUsers;
  if (value === undefined) {
    throw new Error(`the pool answered without EstimatedNumberOfUsers: ${pool}`);
  }
  // The log line IS the metric: `PoolUsersMetricFilter` reads `$.value` off it. Published on
  // every run, or it cannot tell "fine" from "it stopped running".
  const line: PoolUsers = { metric: 'poolUsers', pool, value };
  console.log(JSON.stringify(line));
  return line;
}

/** Read per invocation, so a value cannot be captured by a container that started before it
 *  changed. */
function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set`);
  return value;
}

const client = new CognitoIdentityProviderClient({});

const sdk: PoolReader = {
  describeUserPool: (input) => client.send(new DescribeUserPoolCommand(input)),
};

export const handler = () => poolUsage(sdk, required('USER_POOL_ID'));
