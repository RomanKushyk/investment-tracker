// `POST /admin/users/{id}/approve` and `/reject` — the two routes a super-admin rules with.
//
// APPROVE IS A COGNITO WRITE, NOT A STATUS FLIP. `user_id` holds the Cognito `sub` and the row was
// written before any identity existed, so approval MINTS the identity and REKEYS the row onto it —
// replaced rather than updated, because a DSQL primary key is immutable and changing one is a
// delete and an insert. A pending row owns nothing, so that disturbs no foreign key. It is also
// where the monthly active user is spent and the one invitation goes out, which is what makes
// approval the verification step (*Auth model*). REJECT IS THE OPPOSITE SHAPE: a status, with a
// Cognito call only as its consequence.
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import {
  FORBIDDEN,
  NO_APPLICATION,
  PENDING,
  REJECTED as REJECTED_APPLICANT,
  authorize,
  superAdminOnly,
} from './authorize';
import { connect } from './dsql';
import { INTERNAL, INVALID, type ApiEvent, type ApiResult, canonicalUuid, json } from './http';
import type { SqlClient } from './migrate';
import { ACCOUNT } from './provision';

export const APPROVE_ROUTE = 'POST /admin/users/{id}/approve';
export const REJECT_ROUTE = 'POST /admin/users/{id}/reject';

type UserAttribute = { Name?: string; Value?: string };

/** `adminGetUser` is asked three things: WHICH `sub` holds an address already taken, since
 *  `AdminCreateUser` answers `UsernameExistsException` without handing back the one it made;
 *  whether anybody has PROVED they hold it, which `UserStatus` says; and `Enabled`, which
 *  `UserStatus` cannot stand in for, since a disabled account keeps its status. `adminEnableUser`
 *  only undoes this file's own disable, and there is no `adminDeleteUser`. */
export type IdentityClient = {
  adminCreateUser(input: {
    UserPoolId: string;
    Username: string;
    UserAttributes: { Name: string; Value: string }[];
    // The literal, not `string[]`: the SDK types this as an enum and a widening stops compiling.
    DesiredDeliveryMediums?: ['EMAIL'];
  }): Promise<{ User?: { Attributes?: UserAttribute[] } }>;
  adminGetUser(input: {
    UserPoolId: string;
    Username: string;
  }): Promise<{ UserAttributes?: UserAttribute[]; UserStatus?: string; Enabled?: boolean }>;
  adminDisableUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
  adminEnableUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
};

const APPROVED = json(200, '{"status":"approved"}');
const REJECTED = json(200, '{"status":"rejected"}');
const NOT_FOUND = json(404, '{"error":"not_found"}');
// NOBODY RULES ON THEIR OWN ROW, because the state has no way back in code: rejecting yourself
// disables your account and sets your row `rejected`, after which the gate refuses you, approve
// refuses a non-pending row, and the bootstrap refuses an address it already holds a row for.
const SELF = json(409, '{"error":"self"}');
// Its own refusal rather than folded into "already decided", because the reason is different in
// kind and the caller has to tell them apart: approving a demo row would call `AdminCreateUser` on
// a fabricated address, spend a monthly active user and write to a mailbox whose bounce cannot be
// cleared. The role makes that structural rather than a screen's habit.
const DEMO = json(409, '{"error":"demo"}');
const ALREADY_DECIDED = json(409, '{"error":"already_decided"}');
// AN UNCONFIRMED ACCOUNT CLAIMED THE ADDRESS AND NEVER PROVED IT: Cognito holds a username as
// taken even for a sign-up nobody confirmed, so an open window lets anyone take one they do not
// hold. Its own refusal because the repair is outside this API — the account has to go.
const UNCLAIMED_IDENTITY = json(409, '{"error":"unclaimed_identity"}');

const GATE = [PENDING, REJECTED_APPLICANT, NO_APPLICATION, FORBIDDEN] as const;

/** WHAT EACH ROUTE CAN ANSWER, and the only list of it — `openapi.ts` builds the document from
 *  here, and `openapi.test.ts` catches a constant added above and not added to it. The two differ
 *  only in the success body and in `unclaimed_identity`, which only approve can reach. */
export const RESPONSES: Record<string, readonly ApiResult[]> = {
  [APPROVE_ROUTE]: [
    APPROVED,
    ...GATE,
    INVALID,
    SELF,
    NOT_FOUND,
    DEMO,
    ALREADY_DECIDED,
    UNCLAIMED_IDENTITY,
    INTERNAL,
  ],
  [REJECT_ROUTE]: [REJECTED, ...GATE, INVALID, SELF, NOT_FOUND, DEMO, ALREADY_DECIDED, INTERNAL],
};

const TARGET = `SELECT user_id, email, status, role, applied_at FROM app_user
                WHERE user_id = $1`;

/** `AND status = 'pending'` is not decoration: two approvals racing resolve to the SAME `sub`, so
 *  the loser's insert collides or aborts at `COMMIT`, the transaction rolls back and the winner's
 *  row is untouched — where an unguarded delete would have removed it. */
const REMOVE = `DELETE FROM app_user WHERE user_id = $1 AND status = 'pending'`;

/** `applied_at` IS CARRIED OVER rather than restamped: a delete-and-insert is where the one thing
 *  the pending row held that cannot be reconstructed goes missing. ONE STATEMENT WRITES BOTH
 *  HALVES OF THE DECISION PAIR, because `app_user_decided_ck` reads "not both null". */
const REPLACE = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                       decided_at, decided_by)
                 VALUES ($1, $2, 'active', $3, $4, now(), $5)`;

/** GUARDED ON THE STATUS THAT WAS READ, for the reason `REMOVE` is: a reject racing an approve
 *  must not write over the row the approval just made. NO ROWS MEANS THE STATUS MOVED UNDER US, so
 *  this reject is not the one that decided it. `RETURNING` is `asset-delete.ts`'s rule. */
const DECIDE = `UPDATE app_user SET status = 'rejected', decided_at = now(), decided_by = $2
                WHERE user_id = $1 AND status = $3
                RETURNING user_id`;

/** Read BY ADDRESS rather than by id, because the row this call was rekeying may now be keyed by
 *  another approve's `sub`, or be the `rejected` row somebody left under the placeholder. */
const ROW_NOW = `SELECT status FROM app_user WHERE email = $1`;

const subOf = (attributes: UserAttribute[] | undefined): string | undefined =>
  attributes?.find((a) => a.Name === 'sub')?.Value;

type Target = { user_id: string; email: string; status: string; role: string; applied_at: Date };

/** `minted` IS WHAT THIS CALL MAY UNDO: an identity created here belongs to this approval and
 *  nothing refers to it yet, where an ADOPTED one is somebody else's and turning it off would
 *  disable an account that was just approved. */
async function identify(
  idp: IdentityClient,
  UserPoolId: string,
  email: string,
): Promise<{ sub: string | undefined; minted: boolean } | 'unclaimed'> {
  try {
    const made = await idp.adminCreateUser({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        // APPROVAL IS THE VERIFICATION, and marking it verified is also what makes
        // forgot-password work afterwards.
        { Name: 'email_verified', Value: 'true' },
      ],
      // SUPPRESSING THE INVITATION IS A MEASURED TRAP: with `MessageAction: SUPPRESS` and no
      // `TemporaryPassword` the call fails outright, and a suppressed one leaves an account in
      // `FORCE_CHANGE_PASSWORD` that `ForgotPassword` refuses. The medium defaults to SMS.
      DesiredDeliveryMediums: ['EMAIL'],
    });
    return { sub: subOf(made.User?.Attributes), minted: true };
  } catch (err) {
    if ((err as { name?: string })?.name !== 'UsernameExistsException') throw err;
    // THE HALF-DONE STATE, AND THE ONLY WAY OUT IS THROUGH: an identity made and a row that did
    // not land leaves a `sub` nothing refers to, so approving again must finish the job rather
    // than report a duplicate. Same branch for an owner who signed up during an open window.
    const found = await idp.adminGetUser({ UserPoolId, Username: email });
    // WHAT SEPARATES THE OWNER FROM A STRANGER, and the only thing that can: `CONFIRMED` means
    // somebody received mail at the address, `FORCE_CHANGE_PASSWORD` is this system's own earlier
    // create, and `UNCONFIRMED` is neither — a claim nobody proved.
    if (found.UserStatus === 'UNCONFIRMED') return 'unclaimed';
    // APPROVAL OWNS "ON": a reject that failed leaves a DISABLED identity under a row still
    // `pending`, and this branch would otherwise write a flawless `active` row nobody can sign in
    // as. Safe here precisely because approve refuses every non-pending row.
    if (found.Enabled === false) {
      await idp.adminEnableUser({ UserPoolId, Username: email });
    }
    return { sub: subOf(found.UserAttributes), minted: false };
  }
}

/** Whether the address's row still wants its account ON — the one question both cleanups ask.
 *  `active` wants it, and so does `pending`, where disabling would break the retry that finishes a
 *  half-done approval. `rejected` does not, the address being unique; NOR DOES AN ABSENT ROW,
 *  since an open window lets an enabled orphan self-provision one. A READ THAT FAILS ANSWERS
 *  WANTED — the direction that leaves an account ON, because rejecting again retries a disable
 *  where an account wrongly turned off has no path back through this API. */
async function wanted(client: SqlClient, email: string): Promise<boolean> {
  return client
    .query<{ status: string }>(ROW_NOW, [email])
    .then(({ rows }) => rows[0]?.status === 'active' || rows[0]?.status === 'pending')
    .catch((e: unknown) => {
      console.error(`approve: could not read back what ${email} holds: ${e}`);
      return true;
    });
}

async function withdraw(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  email: string,
): Promise<void> {
  if (await wanted(client, email)) return;
  // Best effort: the caller must hear about the failure that actually sent us here.
  await idp.adminDisableUser({ UserPoolId, Username: email }).catch((e: unknown) => {
    console.error(`approve: could not disable the identity minted for ${email}: ${e}`);
  });
}

/** Puts back the disable a reject made before it knew its own write would land. TWO THINGS MUST BE
 *  TRUE AND NEITHER IS ENOUGH ALONE: `live` says the account was ON WHEN THIS CALL READ IT, which
 *  an operator's out-of-band suspension fails, and the row must still WANT it, which a reject
 *  losing to ANOTHER reject fails. The price of `wanted`'s failed-read arm is paid here — a failed
 *  read cannot tell `rejected` from absent, so it accepts an enabled ORPHAN rather than strand an
 *  approved user on a failure that is not one. */
async function restore(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  email: string,
): Promise<void> {
  if (!(await wanted(client, email))) return;
  await idp.adminEnableUser({ UserPoolId, Username: email }).catch((e: unknown) => {
    // The ordinary applicant has no identity at all, so this is a no-op, not an error.
    if ((e as { name?: string })?.name === 'UserNotFoundException') return;
    console.error(`approve: could not re-enable ${email} after losing the decision: ${e}`);
  });
}

async function approveRow(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  row: Target,
  decidedBy: string,
): Promise<ApiResult> {
  if (row.status !== 'pending') return ALREADY_DECIDED;

  const identity = await identify(idp, UserPoolId, row.email);
  if (identity === 'unclaimed') return UNCLAIMED_IDENTITY;
  const { sub, minted } = identity;
  if (!sub) {
    console.error(`approve: the pool returned no sub for ${row.user_id}`);
    // Untouched, so `withdraw` finds it `pending`: approving again is what recovers this.
    if (minted) await withdraw(client, idp, UserPoolId, row.email);
    return INTERNAL;
  }

  // `BEGIN` IS INSIDE THE TRY: past the mint, EVERY way out has to pass the cleanup.
  //
  // THE ACCOUNT IS KEYED BY THE MINTED SUB, which is why it is written here and not when the
  // application was taken: the row is deleted and re-inserted, so an account written earlier would
  // belong to an id that no longer exists — and `account_user_fk` being `ON DELETE restrict` would
  // refuse the delete outright.
  //
  // AND THIS TRANSACTION IS NOT `provision`'s, deliberately: a retry on `40001` would re-run
  // `REPLACE` against the row the winning approval just wrote, turning a loser that rolls back
  // cleanly into a `23505`. Nor is there anything for a retry to finish where another approval is
  // what caused the conflict — that transaction wrote both rows. A racing REJECT is the other way
  // in and a retry must not win that one either: the row reads `rejected`, and approving again
  // answering already-decided IS the ruling standing. Where the row is still `pending`, approving
  // again completes it, as it completes every other half-done state here.
  try {
    await client.query('BEGIN');
    await client.query(REMOVE, [row.user_id]);
    await client.query(REPLACE, [sub, row.email, row.role, row.applied_at, decidedBy]);
    await client.query(ACCOUNT, [sub]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (minted) await withdraw(client, idp, UserPoolId, row.email);
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
  // THE IDENTITY GOES FIRST, AND THE ORDER CHOOSES THE FAILURE DIRECTION: the other way round, a
  // disable failing after the row was written leaves a `rejected` row whose owner can still sign
  // in, and the retry answers "already decided" and repairs nothing.
  //
  // THE POOL IS ASKED ON EVERY REJECT, because Cognito owns the fact and the schema records none:
  // `status` stops standing in for it the moment a window opens, since somebody who applied BEFORE
  // it can sign up during it and hold an identity while the gate answers with their `pending` row.
  // `UserNotFoundException` is the absence and the only pool answer that is one.
  //
  // AND THE ACCOUNT IS READ BEFORE IT IS TOUCHED, so this call knows whether IT turned it off. The
  // row cannot say: it reads `rejected` whoever ruled, and `active` whether an approve won or an
  // operator suspended it by hand. THE ADDRESS FINDS IT BY ALIAS, not as the username — under
  // `UsernameAttributes: [email]` every account carries a UUID username, so this reaches every
  // LOCAL account however it was made, while a federated-only profile answers not-found
  // (*Auth model*; `docs/reference/COGNITO-POOL-PARAMS.md`).
  const live = await idp
    .adminGetUser({ UserPoolId, Username: row.email })
    .then((found) => found.Enabled !== false)
    .catch((err: unknown) => {
      if ((err as { name?: string })?.name !== 'UserNotFoundException') throw err;
      console.log(`approve: ${row.user_id} is being rejected with no local identity to disable`);
      return false;
    });
  if (live) {
    await idp.adminDisableUser({ UserPoolId, Username: row.email }).catch((err: unknown) => {
      if ((err as { name?: string })?.name !== 'UserNotFoundException') throw err;
      console.log(`approve: ${row.email} went between being read and being disabled`);
    });
  }

  // A ROW ALREADY `rejected` IS A REPAIR RATHER THAN A NO-OP, which makes "rule again" an answer
  // to every way an enabled identity can outlive a rejection. What does not repeat is the
  // DECISION: `decided_at` and `decided_by` go on naming whoever ruled first.
  if (row.status === 'rejected') return ALREADY_DECIDED;

  // THE WRITE REPORTS ITSELF, or a reject that matched nothing answers success having changed
  // nothing. AND IT FAILS IN TWO SHAPES, so the repair hangs off the failure rather than one: DSQL
  // aborts a write-write conflict at commit, so a lost reject arrives as `40001` or as no rows.
  const { rows } = await client
    .query<{ user_id: string }>(DECIDE, [row.user_id, decidedBy, row.status])
    .catch(async (err: unknown) => {
      if (live) await restore(client, idp, UserPoolId, row.email);
      throw err;
    });
  if (rows.length === 0) {
    console.error(`approve: reject matched no row for ${row.user_id}; it was decided elsewhere`);
    if (live) await restore(client, idp, UserPoolId, row.email);
    return ALREADY_DECIDED;
  }
  return REJECTED;
}

export async function approve(
  client: SqlClient,
  idp: IdentityClient,
  event: ApiEvent,
): Promise<ApiResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED: `authorize` reads the cluster, so a
  // gate left outside would throw past `handler` and reach the caller as API Gateway's own 502.
  try {
    // THE GATE FIRST, BEFORE THE ROUTE OR THE PATH IS READ: nothing at all is done for a caller
    // the row does not admit.
    const gate = superAdminOnly(await authorize(client, event));
    if ('refusal' in gate) return gate.refusal;

    const routeKey = event.routeKey;
    if (routeKey !== APPROVE_ROUTE && routeKey !== REJECT_ROUTE) return INVALID;

    // FOLDED BEFORE IT IS COMPARED TO ANYTHING, and the guard below is why: a `uuid` column
    // compares canonically, so unfolded the self check is skipped by an id typed in capitals.
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
    // ASKED BEFORE ANYTHING IRREVERSIBLE: no handler here holds `AdminDeleteUser`.
    if (row.role === 'demo') return DEMO;

    return routeKey === APPROVE_ROUTE
      ? await approveRow(client, idp, UserPoolId, row, gate.caller.userId)
      : await rejectRow(client, idp, UserPoolId, row, gate.caller.userId);
  } catch (err) {
    // LOGGED, NOT RETURNED: the caller gets no constraint name.
    console.error('approve failed', err);
    return INTERNAL;
  }
}

const identityClient = new CognitoIdentityProviderClient({});
const sdk: IdentityClient = {
  adminCreateUser: (input) => identityClient.send(new AdminCreateUserCommand(input)),
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
  adminDisableUser: (input) => identityClient.send(new AdminDisableUserCommand(input)),
  adminEnableUser: (input) => identityClient.send(new AdminEnableUserCommand(input)),
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  // A connection failure answers rather than throws, as the applications endpoint's does.
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
