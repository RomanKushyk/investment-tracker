// The purge: every account whose scheduled deletion's last day has ended in Kyiv, deleted with
// `account-delete.ts`'s steps, its rows last (*User schema and deletes*). Hourly, so one that fails
// is still due at the next run; a run out of time leaves the rest for the next (*Alerting*).
import {
  AdminDeleteUserCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { kyivDateIso } from '@quirenote/core/dates';

import {
  type AccountIdentity,
  deleteIdentities,
  deleteRows,
  keyedBySub,
  signOutEverywhere,
  soleSuperAdmin,
} from './account-delete';
import { connect } from './dsql';
import { loggable } from './log';
import type { Budget, SqlClient } from './migrate';

/** Left unspent so the deletion in flight ends before the function's timeout cuts the run line. */
const RESERVE_MS = 20_000;

// Past their last day: the gate already answers each as deleted (`authorize.ts`).
const DUE = `SELECT user_id, email FROM app_user
              WHERE deletion_due < $1::date
              ORDER BY deletion_due, user_id`;

export interface PurgeDeps {
  user: SqlClient;
  identity: AccountIdentity;
  userPoolId: string;
  /** Milliseconds, as `Date.now`. */
  now: () => number;
}

/** Deletes each account due while `remainingMs` leaves more than the reserve; `false` when one
 *  failed or was refused, which the next run asks again. */
export async function purge(deps: PurgeDeps, remainingMs: () => number): Promise<boolean> {
  const today = kyivDateIso(new Date(deps.now()));
  const { rows } = await deps.user.query<{ user_id: string; email: string }>(DUE, [today]);
  let clean = true;
  for (const { user_id: userId, email } of rows) {
    if (remainingMs() <= RESERVE_MS) break;
    try {
      // BY THE ID, which finds the row; the address stays out of CloudWatch (*Deployment*).
      if (await soleSuperAdmin(deps.user, userId)) {
        console.error(`purge: ${userId} was refused as sole_super_admin`);
        clean = false;
        continue;
      }
      // THE ROWS AFTER THE IDENTITIES, unlike a deletion asked for: nobody asks again, and the row
      // is what the next run finds, so it goes last and a failure anywhere before it resumes.
      const also = await keyedBySub(deps.identity, deps.userPoolId, userId);
      await signOutEverywhere(deps.identity, deps.userPoolId, email, also);
      await deleteIdentities(deps.identity, deps.userPoolId, email, also);
      await deleteRows(deps.user, userId);
    } catch (err) {
      console.error(`purge: ${userId} failed`, loggable(err));
      clean = false;
    }
  }
  return clean;
}

export interface PurgeEvent {
  /** Set by the schedule's own input alone: a hand `{}` runs the same purge. */
  scheduled?: boolean;
}

/** The scheduled run's two lines, read by `PurgeSilenceAlarm` and `PurgeErrorAlarm` through metric
 *  filters: the function's own `Invocations` and `Errors` count a hand run too. [*Alerting*] */
const signal = (metric: 'purgeRun' | 'purgeRunFailed') =>
  console.log(JSON.stringify({ metric, value: 1 }));

const identityClient = new CognitoIdentityProviderClient({});
const sdk: AccountIdentity = {
  adminUserGlobalSignOut: (input) => identityClient.send(new AdminUserGlobalSignOutCommand(input)),
  adminDeleteUser: (input) => identityClient.send(new AdminDeleteUserCommand(input)),
  listUsers: (input) => identityClient.send(new ListUsersCommand(input)),
};

export async function handler(event: PurgeEvent, context: Budget): Promise<void> {
  const scheduled = event.scheduled === true;
  try {
    const client = await connect();
    try {
      const userPoolId = process.env.USER_POOL_ID;
      if (!userPoolId) throw new Error('purge: USER_POOL_ID is not set on this function');
      const clean = await purge({ user: client, identity: sdk, userPoolId, now: Date.now }, () =>
        context.getRemainingTimeInMillis(),
      );
      if (scheduled) {
        signal('purgeRun');
        if (!clean) signal('purgeRunFailed');
      }
    } finally {
      await client.end().catch((err: unknown) => console.error('purge disconnect failed', err));
    }
  } catch (err) {
    if (scheduled) signal('purgeRunFailed');
    throw err;
  }
}
