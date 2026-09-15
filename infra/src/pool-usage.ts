import {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// How many identities the pool holds, published nightly as a number.
//
// WHY A COUNT STANDS IN FOR MONTHLY ACTIVES. CloudWatch publishes no MAU metric, so the
// free tier cannot be watched directly at all. Total users is a strict upper bound on it
// — every monthly active is a user, and users that went quiet are still counted — so an
// alarm on this number fires EARLY and never late. That asymmetry is the whole argument:
// a guard that is wrong in the safe direction is worth having, and the alternative on
// offer is AWS's own Free Tier mail at 85%, which arrives with the bill rather than
// before it.
//
// WHY IT IS ITS OWN FUNCTION AND IN THIS STACK. The capture already emits every other
// number of this shape, and it is the ARCHIVE's function in the archive's stack, deployed
// from `dev` alone. The pool is neither: it is per-environment, in this stack, and giving
// the capture a pool id would be the same coupling the backup check refused one file over
// (`docs/DECISIONS.md`, **Alerting**). What the two share is the shape, not the function.
//
// PROD ONLY. Dev's pool holds a handful of accounts and cannot approach the limit, and
// every resource of this watch hangs off `IsProd` the way the backup check's does. What
// that gives up is named rather than discovered: dev identities do count toward the
// account's free tier, so this number is a bound on prod's share of it, not on the whole.

/** What Cognito Essentials bills nothing below, in monthly active users. The alarm's
 *  threshold is derived from this rather than written beside it — see
 *  `stack-split.test.ts`, which holds 8000 against both this and the 85% the billing
 *  alert uses. */
export const FREE_TIER_USERS = 10_000;

/** Narrowed to the one call this file makes, so a test injects a double rather than the
 *  SDK — the shape `backup-freshness.ts` and `pre-signup.ts` take their clients in. */
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
 * Read the pool, publish the count.
 *
 * AN ABSENT COUNT IS AN ERROR, NOT A ZERO, and this is the one decision in the file.
 * `backup-age.ts` faces the mirror of it: there, "no recovery point" must report a LARGE
 * number so that nothing lands on the bad side of a `GreaterThan` threshold. The alarm
 * here is `GreaterThan` as well, so the bad side is high — and 0 is therefore the reading
 * that says "fine". A pool that answered without `EstimatedNumberOfUsers` would publish
 * that 0 and read as healthy for as long as it kept doing so. `EstimatedNumberOfUsers` is
 * optional in the SDK's own types, so this is a shape the compiler makes us answer for
 * rather than one that has to be imagined.
 *
 * IT THROWS RATHER THAN WARNING, like `backup-freshness.ts` and unlike the capture. A
 * capture must not fail because a monitoring read did — it has a perishable price to
 * write first. This function has no other work, so swallowing the error would swallow the
 * whole invocation while reporting success. A throw on its own is not a signal either,
 * which is what `PoolUsageErrorAlarm` is beside it for: `Invocations` counts a failed
 * invocation as readily as a successful one, so the silence alarm cannot see this, and no
 * count is published, so the count alarm cannot either.
 */
export async function poolUsage(idp: PoolReader, pool: string): Promise<PoolUsers> {
  const { UserPool } = await idp.describeUserPool({ UserPoolId: pool });
  const value = UserPool?.EstimatedNumberOfUsers;
  if (value === undefined) {
    throw new Error(`the pool answered without EstimatedNumberOfUsers: ${pool}`);
  }
  // The log line IS the metric: `PoolUsersMetricFilter` reads `$.value` off it. Published
  // on every run, healthy or not — a signal that appears only on failure cannot tell
  // "fine" from "the check stopped running".
  const line: PoolUsers = { metric: 'poolUsers', pool, value };
  console.log(JSON.stringify(line));
  return line;
}

/** Read per invocation rather than at module load, so a value cannot be captured by a
 *  container that started before it changed. An absent one is a broken deploy, not a
 *  state to tolerate. */
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
