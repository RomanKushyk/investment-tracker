// `POST /admin/users/{id}/approve` and `/reject` — the two routes a super-admin rules with.
//
// APPROVE IS A COGNITO WRITE, NOT A STATUS FLIP. `user_id` holds the Cognito `sub` and the
// application row was written before any identity existed, so approval is where the identity is
// made and where the row is rekeyed onto it. An approve that only moved `status` would leave the
// applicant perfectly recorded and unable to sign in at all. It is also where the single
// monthly active user is spent and where the one email in the whole flow is sent — which is what
// makes approval the verification step: the invitation reaches only the address's owner.
// `docs/DECISIONS.md`, **Auth model**.
//
// AND REJECT IS THE OPPOSITE SHAPE: a status, with a Cognito call only as its consequence. An
// applicant who was never approved has no identity to disable, so nothing is asked of the pool;
// the row's own status is what says whether there is one.
//
// THE ROW IS REPLACED RATHER THAN UPDATED, because a DSQL primary key is immutable — changing
// one is a delete and an insert, not an update (`demo-user.ts`). A pending row owns nothing:
// every foreign key in `schema/user.ts` hangs off `user_id` from tables that are empty for this
// user, so the replacement disturbs nothing. DSQL takes DML in a transaction where it refuses
// DDL beside it, which is what keeps the two statements one act.
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { authorize, superAdminOnly } from './authorize';
import { connect } from './dsql';
import { INTERNAL, INVALID, type ApiEvent, type ApiResult, canonicalUuid, json } from './http';
import type { SqlClient } from './migrate';

/** The two routes, spelled the way the template spells them — `<METHOD> <path>`. */
export const APPROVE_ROUTE = 'POST /admin/users/{id}/approve';
export const REJECT_ROUTE = 'POST /admin/users/{id}/reject';

type UserAttribute = { Name?: string; Value?: string };

/**
 * The three calls this file makes, narrowed so the tests inject a double rather than the SDK —
 * the shape `pre-signup.ts` and `migrate.ts` take theirs in.
 *
 * `adminGetUser` is here for the RE-RUN alone: `AdminCreateUser` answers
 * `UsernameExistsException` the second time and does not hand back the `sub` it made the first,
 * and an approval that failed between the identity and the row has to find it again.
 *
 * There is no `adminDeleteUser`. Deleting a user is not implemented and not decided.
 */
export type IdentityClient = {
  adminCreateUser(input: {
    UserPoolId: string;
    Username: string;
    UserAttributes: { Name: string; Value: string }[];
    // The literal rather than `string[]`: the SDK types this as an enum, and a widened
    // narrowing would stop compiling against the very call it exists to describe.
    DesiredDeliveryMediums?: ['EMAIL'];
  }): Promise<{ User?: { Attributes?: UserAttribute[] } }>;
  adminGetUser(input: {
    UserPoolId: string;
    Username: string;
  }): Promise<{ UserAttributes?: UserAttribute[] }>;
  adminDisableUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
};

const APPROVED = json(200, '{"status":"approved"}');
const REJECTED = json(200, '{"status":"rejected"}');
const NOT_FOUND = json(404, '{"error":"not_found"}');
// NOBODY RULES ON THEIR OWN ROW, and the reason is that the state it produces has no way back in
// code: rejecting yourself disables your own account and sets your row `rejected`, after which
// the gate refuses you, approve refuses a non-pending row, and the runner's `bootstrap` throws on
// both of its branches — on the row that exists and on the super-admin that already does. The
// only repair is hand-written SQL against the cluster, which is not something anybody should have
// to reach for because of one mis-click.
const SELF = json(409, '{"error":"self"}');
// NAMED AS ITS OWN REFUSAL rather than folded into "already decided", because the reason is
// different in kind and the caller has to be able to tell them apart: approving a demo row would
// call `AdminCreateUser` on a fabricated address, spend a monthly active user and mail a mailbox
// whose bounce cannot be cleared. The role is what makes that structural instead of a convention
// the admin screen has to remember.
const DEMO = json(409, '{"error":"demo"}');
const ALREADY_DECIDED = json(409, '{"error":"already_decided"}');

const TARGET = `SELECT user_id, email, status, role, applied_at FROM app_user
                WHERE user_id = $1`;

/**
 * `AND status = 'pending'` is not decoration: it is what makes two approvals racing each other
 * fail loudly instead of quietly.
 *
 * Both resolve to the SAME `sub` — the loser's `AdminCreateUser` answers `UsernameExistsException`
 * and `AdminGetUser` hands back the identity the winner just made — so the loser's insert
 * collides on `app_user_user_id_pk`, or is aborted at `COMMIT` as a serialization failure. Either
 * way the transaction rolls back and the row the winner wrote is untouched, where an unguarded
 * delete would have removed it.
 */
const REMOVE = `DELETE FROM app_user WHERE user_id = $1 AND status = 'pending'`;

/**
 * The replacement, keyed by the `sub` the create call returned.
 *
 * `applied_at` IS CARRIED OVER rather than restamped — it is the only thing the pending row held
 * that cannot be reconstructed, and a delete-and-insert is exactly where it goes missing.
 * `data_version` is left to its default: a pending row has had no mutation to count.
 *
 * ONE STATEMENT WRITES BOTH HALVES OF THE DECISION PAIR, and it has to be one, because
 * `app_user_decided_ck` reads "not both null" rather than "both present" (`user-schema.test.ts`,
 * `app_user`). The check cannot hold the pair together; this line can.
 */
const REPLACE = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                       decided_at, decided_by)
                 VALUES ($1, $2, 'active', $3, $4, now(), $5)`;

/**
 * GUARDED ON THE STATUS THAT WAS READ, for the reason `REMOVE` is: a reject racing an approve
 * must not write over the row the approval just made.
 *
 * `RETURNING` IS HOW A WRITE SAYS HOW MUCH IT DID, and the rule is `asset-delete.ts`'s rather
 * than this file's: the two clients disagree about the name — `pg` reports `rowCount`, PGlite
 * `affectedRows` — so `SqlClient` promises only `rows` and a returned column is the portable
 * answer. An earlier draft read the row back in a second statement and blamed the interface; that
 * was a second round trip buying what one clause already gives, and it could not tell "matched
 * nothing" from "somebody else wrote the same thing".
 *
 * NO ROWS MEANS THE STATUS MOVED UNDER US — decided by another caller, or re-keyed by an approve
 * — and either way this reject is not the one that decided it.
 */
const DECIDE = `UPDATE app_user SET status = 'rejected', decided_at = now(), decided_by = $2
                WHERE user_id = $1 AND status = $3
                RETURNING user_id`;

const subOf = (attributes: UserAttribute[] | undefined): string | undefined =>
  attributes?.find((a) => a.Name === 'sub')?.Value;

type Target = { user_id: string; email: string; status: string; role: string; applied_at: Date };

/** The identity for this address — created, or found because a previous run had made it. */
async function identify(
  idp: IdentityClient,
  UserPoolId: string,
  email: string,
): Promise<string | undefined> {
  try {
    const made = await idp.adminCreateUser({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        // APPROVAL IS THE VERIFICATION. A super-admin ruled on this address, and marking it
        // verified is also what makes forgot-password work afterwards.
        { Name: 'email_verified', Value: 'true' },
      ],
      // THE INVITATION IS SENT, AND SUPPRESSING IT IS A MEASURED TRAP. `AdminCreateUser` with
      // `MessageAction: SUPPRESS` and no `TemporaryPassword` fails outright — Cognito generates
      // the password only when it has a message to put it in — and a suppressed message leaves
      // an account in `FORCE_CHANGE_PASSWORD` that `ForgotPassword` refuses to reset. So
      // suppressing it produces a perfect row attached to an account nobody can sign into.
      // EMAIL EXPLICITLY: the delivery medium defaults to SMS and this pool holds no number.
      DesiredDeliveryMediums: ['EMAIL'],
    });
    return subOf(made.User?.Attributes);
  } catch (err) {
    if ((err as { name?: string })?.name !== 'UsernameExistsException') throw err;
    // THE HALF-DONE STATE, AND THE ONLY WAY OUT OF IT IS THROUGH. An identity made and a row
    // that did not land leaves a `sub` nothing refers to; approving again has to finish the job
    // rather than report a duplicate.
    const found = await idp.adminGetUser({ UserPoolId, Username: email });
    return subOf(found.UserAttributes);
  }
}

async function approveRow(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  row: Target,
  decidedBy: string,
): Promise<ApiResult> {
  if (row.status !== 'pending') return ALREADY_DECIDED;

  const sub = await identify(idp, UserPoolId, row.email);
  if (!sub) {
    console.error(`approve: the pool returned no sub for ${row.user_id}`);
    return INTERNAL;
  }

  await client.query('BEGIN');
  try {
    await client.query(REMOVE, [row.user_id]);
    await client.query(REPLACE, [sub, row.email, row.role, row.applied_at, decidedBy]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
  return APPROVED;
}

async function rejectRow(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  row: Target,
  decidedBy: string,
): Promise<ApiResult> {
  if (row.status === 'rejected') return ALREADY_DECIDED;

  // THE IDENTITY GOES FIRST, AND THE ORDER IS THE FAILURE DIRECTION BEING CHOSEN. Written the
  // other way round, a disable that failed after the row was written would leave a `rejected`
  // row whose owner can still sign in — and the retry would answer "already decided" and repair
  // nothing. This way a failure leaves the row untouched and rejecting again finishes it.
  //
  // `active` IS A PROXY FOR "AN IDENTITY EXISTS", AND IT IS NOT A SOUND ONE. It holds while
  // registration has only ever been closed, which is both environments today: approval is then
  // the only thing that mints an identity and it always leaves the row `active`. It stops holding
  // the moment a window opens — somebody who applied BEFORE the window can sign themselves up
  // during it, which gives them an identity while their row stays `pending`, and this branch then
  // skips the disable for a person who has one. They keep an enabled account and a refresh token;
  // they gain no access, because every route is authorized against the row and the row says
  // `rejected`. The sound test is to ask Cognito, and it is not made here because the acceptance
  // criterion this endpoint was built to explicitly asks for NO Cognito call when rejecting an
  // applicant who never had an identity — so changing the proxy changes the contract, and that is
  // a decision rather than a patch. Split out rather than smuggled in; see the issue.
  //
  // THE ADDRESS IS THE USERNAME, because the pool declares `UsernameAttributes: [email]`. That
  // holds for every identity this system creates — approval's `AdminCreateUser` and an
  // open-registration sign-up both make a LOCAL account — and not for a federated-only profile,
  // whose username is the provider and its subject. Such a profile can exist only with
  // registration open and a provider configured, since `pre-signup.ts` otherwise refuses it;
  // rejecting one answers `UserNotFoundException`, which is caught into a 500 that leaves the row
  // untouched. A stuck state rather than a silent one, and recorded rather than repaired here —
  // `docs/DECISIONS.md`, **Auth model**.
  if (row.status === 'active') {
    await idp.adminDisableUser({ UserPoolId, Username: row.email });
  }
  // THE WRITE REPORTS ITSELF. Without this a reject that matched nothing would answer 200 having
  // changed nothing, which is the one thing an admin surface must not do.
  const { rows } = await client.query<{ user_id: string }>(DECIDE, [
    row.user_id,
    decidedBy,
    row.status,
  ]);
  if (rows.length === 0) {
    console.error(`approve: reject matched no row for ${row.user_id}; it was decided elsewhere`);
    return ALREADY_DECIDED;
  }
  return REJECTED;
}

export async function approve(
  client: SqlClient,
  idp: IdentityClient,
  event: ApiEvent,
): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED. `authorize` reads the cluster, and a
  // read can fail — a serialization error, a socket reset on a warm container — so a gate left
  // outside would throw past `handler` and reach the caller as API Gateway's own 502. That is a
  // second shape for the same class of event, which is what this file's connection handling
  // exists to prevent; the gate would have been the quietest place for it to leak from.
  try {
    // THE GATE FIRST, BEFORE THE ROUTE OR THE PATH IS READ. Nothing at all is done for a caller
    // the row does not admit — and `superAdminOnly` reads the ROW's role, so a token claiming
    // super-admin against a `user` row gets the same refusal as one claiming nothing.
    const gate = superAdminOnly(await authorize(client, event));
    if ('refusal' in gate) return gate.refusal;

    const routeKey = event.routeKey;
    if (routeKey !== APPROVE_ROUTE && routeKey !== REJECT_ROUTE) return INVALID;

    // FOLDED BEFORE IT IS COMPARED TO ANYTHING, and the guard below is why. Hex is hex in
    // either case and a `uuid` column compares canonically, so an id spelled in capitals is the
    // same row to the cluster and a different string to `===`. Unfolded, the self check was
    // skipped by anyone who typed their own id in capitals — which is the one refusal here whose
    // absence has no repair in code.
    const id = canonicalUuid(event.pathParameters?.id);
    if (id === undefined) return INVALID;

    // BEFORE THE ROW IS EVEN READ, because the state it prevents has no repair in code.
    if (id === gate.caller.userId) return SELF;

    const UserPoolId = process.env.USER_POOL_ID;
    if (!UserPoolId) {
      console.error('approve: USER_POOL_ID is not set on this function');
      return INTERNAL;
    }

    const { rows } = await client.query<Target>(TARGET, [id]);
    const row = rows[0];
    if (row === undefined) return NOT_FOUND;
    // ASKED BEFORE ANYTHING IRREVERSIBLE HAPPENS, the rule the bootstrap states: an identity
    // cannot be un-made by a handler that holds no `AdminDeleteUser`, so every question the
    // database can answer is answered first.
    if (row.role === 'demo') return DEMO;

    return routeKey === APPROVE_ROUTE
      ? await approveRow(client, idp, UserPoolId, row, gate.caller.userId)
      : await rejectRow(client, idp, UserPoolId, row, gate.caller.userId);
  } catch (err) {
    // LOGGED, NOT RETURNED. Whatever the cluster or the pool said belongs in CloudWatch; the
    // caller gets the same two words every failure gets, and no constraint name.
    console.error('approve failed', err);
    return INTERNAL;
  }
}

// Constructed once, at module scope, the way `pre-signup.ts` and `migrate.ts` construct theirs —
// and passed in, so every test injects a double instead.
const identityClient = new CognitoIdentityProviderClient({});
const sdk: IdentityClient = {
  adminCreateUser: (input) => identityClient.send(new AdminCreateUserCommand(input)),
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
  adminDisableUser: (input) => identityClient.send(new AdminDisableUserCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  // A CONNECTION FAILURE ANSWERS RATHER THAN THROWS, as the applications endpoint's does: an
  // uncaught throw reaches the caller as API Gateway's own 502, which is a different shape for
  // the same class of event and one this API would then have two of.
  const client = await connect().catch((err: unknown) => {
    console.error('approve connect failed', err);
    return undefined;
  });
  if (client === undefined) return INTERNAL;

  try {
    return await approve(client, sdk, event);
  } finally {
    await client.end().catch((err: unknown) => console.error('approve disconnect failed', err));
  }
}
