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
// AND REJECT IS THE OPPOSITE SHAPE: a status, with a Cognito call only as its consequence. The
// pool is asked on every reject, because nothing in the schema records whether an identity exists
// and the row's status only ever looked as though it did — `UserNotFoundException` is the absence.
//
// THE ROW IS REPLACED RATHER THAN UPDATED, because a DSQL primary key is immutable — changing
// one is a delete and an insert, not an update (`demo-user.ts`). A pending row owns nothing:
// every foreign key in `schema/user.ts` hangs off `user_id` from tables that are empty for this
// user, so the replacement disturbs nothing. DSQL takes DML in a transaction where it refuses
// DDL beside it, which is what keeps the two statements one act.
import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
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
 * The four calls this file makes, narrowed so the tests inject a double rather than the SDK —
 * the shape `pre-signup.ts` and `migrate.ts` take theirs in.
 *
 * `adminGetUser` answers three questions. Two are for the branch where the address is already
 * taken: WHICH `sub` holds it — `AdminCreateUser` answers `UsernameExistsException` the second
 * time and does not hand back the one it made the first — and WHETHER ANYBODY HAS PROVED THEY HOLD
 * THE ADDRESS, which is what `UserStatus` says and what separates a repair from a stranger's claim.
 * The third is for reject, which reads `Enabled` on every decision so that it knows whether it was
 * the one that turned an account off. `UserStatus` cannot stand in for it: a disabled account keeps
 * the status it had.
 *
 * `adminEnableUser` EXISTS ONLY TO UNDO THIS FILE'S OWN DISABLE, on the one path that can disable
 * an account somebody else has just approved. It is never how an account is granted: approval
 * still goes through `adminCreateUser` and the row.
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
  }): Promise<{ UserAttributes?: UserAttribute[]; UserStatus?: string; Enabled?: boolean }>;
  adminDisableUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
  adminEnableUser(input: { UserPoolId: string; Username: string }): Promise<unknown>;
};

const APPROVED = json(200, '{"status":"approved"}');
const REJECTED = json(200, '{"status":"rejected"}');
const NOT_FOUND = json(404, '{"error":"not_found"}');
// NOBODY RULES ON THEIR OWN ROW, and the reason is that the state it produces has no way back in
// code: rejecting yourself disables your own account and sets your row `rejected`, after which the
// gate refuses you, approve refuses a non-pending row, and the runner's `bootstrap` refuses the
// address it already holds a row for. Bootstrapping a DIFFERENT address is the way back, and it is
// a new super-admin rather than your account returned — still further than anybody should be sent
// by one mis-click.
const SELF = json(409, '{"error":"self"}');
// NAMED AS ITS OWN REFUSAL rather than folded into "already decided", because the reason is
// different in kind and the caller has to be able to tell them apart: approving a demo row would
// call `AdminCreateUser` on a fabricated address, spend a monthly active user and mail a mailbox
// whose bounce cannot be cleared. The role is what makes that structural instead of a convention
// the admin screen has to remember.
const DEMO = json(409, '{"error":"demo"}');
const ALREADY_DECIDED = json(409, '{"error":"already_decided"}');
// AN UNCONFIRMED ACCOUNT IS SOMEBODY WHO CLAIMED THE ADDRESS AND NEVER PROVED IT. Cognito holds a
// username as taken even for a sign-up nobody confirmed, so while a registration window is open
// anyone can take an address they do not hold. Adopting that `sub` would write a flawless `active`
// row for an account nobody can sign in as, and no invitation was sent — the create threw. Named as
// its own refusal because the repair is outside this API: the account has to go, and nothing here
// holds `AdminDeleteUser`.
const UNCLAIMED_IDENTITY = json(409, '{"error":"unclaimed_identity"}');

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

/**
 * WHAT THE ADDRESS HOLDS AFTER AN APPROVAL THAT FAILED, which is the only thing that says whether
 * the identity it minted is still wanted. Read by address rather than by id, because the row this
 * call was rekeying may now be keyed by a `sub` — the winner of a concurrent approve — or may be
 * the `rejected` row somebody else left under the placeholder.
 */
const ROW_NOW = `SELECT status FROM app_user WHERE email = $1`;

const subOf = (attributes: UserAttribute[] | undefined): string | undefined =>
  attributes?.find((a) => a.Name === 'sub')?.Value;

type Target = { user_id: string; email: string; status: string; role: string; applied_at: Date };

/**
 * The identity for this address — created, or found because something else already made it.
 *
 * `minted` IS WHAT THIS CALL MAY UNDO. An identity created here belongs to this approval and
 * nothing else refers to it yet, so a row that then fails to land leaves it to be disabled. An
 * ADOPTED one is somebody else's: a concurrent approve resolves to the same `sub`, and turning it
 * off would disable an account that was just approved.
 */
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
    return { sub: subOf(made.User?.Attributes), minted: true };
  } catch (err) {
    if ((err as { name?: string })?.name !== 'UsernameExistsException') throw err;
    // THE HALF-DONE STATE, AND THE ONLY WAY OUT OF IT IS THROUGH. An identity made and a row
    // that did not land leaves a `sub` nothing refers to; approving again has to finish the job
    // rather than report a duplicate. The same branch covers an owner who signed themselves up
    // during an open window: the gate kept answering with their `pending` row, so nothing wrote
    // `active` and only this call can finish the approval.
    const found = await idp.adminGetUser({ UserPoolId, Username: email });
    // WHAT SEPARATES THE OWNER FROM A STRANGER, and the only thing that can. `CONFIRMED` means
    // somebody received mail at the address, so they hold it; `FORCE_CHANGE_PASSWORD` is this
    // system's own earlier `AdminCreateUser`. `UNCONFIRMED` is neither — a claim nobody proved.
    // A confirmed self-signup is indistinguishable from the genuine applicant, and costs nothing
    // to treat as them: confirming required the mailbox.
    if (found.UserStatus === 'UNCONFIRMED') return 'unclaimed';
    // APPROVAL OWNS "ON", and an adopted account is the one place it has to say so rather than
    // assume it. Reject turns an address off before it knows its own write will land, so a reject
    // that failed leaves a DISABLED identity under a row still `pending` — and this branch would
    // otherwise write a flawless `active` row for an account nobody can sign in as, with no
    // invitation sent because the create threw. Safe precisely here: approve refuses every
    // non-pending row, so a `pending` one means no decision says this account should be off.
    if (found.Enabled === false) {
      await idp.adminEnableUser({ UserPoolId, Username: email });
    }
    return { sub: subOf(found.UserAttributes), minted: false };
  }
}

/**
 * Disables an identity THIS CALL MINTED when an approval fails, and only where the row no longer
 * wants it.
 *
 * `pending` is the arm worth naming, because it is the one that looks like a leak and is not: the
 * write failed transiently and the application stands, so approving again finishes the job —
 * `UsernameExistsException` sends the retry to `AdminGetUser` for this same identity. DISABLING
 * HERE WOULD BREAK THAT RETRY, which would then write a flawless `active` row onto an account that
 * cannot sign in.
 *
 * An ADOPTED identity never reaches here: it is somebody else's, and the caller gates on that.
 */
/**
 * Whether the address's row still wants its account ON — the one question both cleanups ask, and
 * the reason they ask it ONCE here rather than each spelling out the same table.
 *
 * `active` wants it: somebody is approved. `pending` wants it: nothing has decided, so an account
 * that exists should go on existing until something does. `rejected` does not — the address is
 * unique, so that row means this account must be off whoever turned it off. NOR DOES AN ABSENT
 * ROW, and not because nothing could refer to the identity: with a window open the gate mints a
 * row for any verified identity holding none, so an enabled orphan self-provisions.
 *
 * A READ THAT FAILS ANSWERS WANTED. It is the direction that leaves an account ON, which is the
 * one both callers can recover from — rejecting again retries a disable, where an account wrongly
 * turned off has no path back through this API at all.
 */
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
  // BEST EFFORT, AND UNDER WHATEVER SENT US HERE. The caller has to be told about the failure that
  // actually happened, so a disable that fails too is logged rather than raised over it.
  await idp.adminDisableUser({ UserPoolId, Username: email }).catch((e: unknown) => {
    console.error(`approve: could not disable the identity minted for ${email}: ${e}`);
  });
}

/**
 * Puts back the disable a reject made before it knew its own write would land.
 *
 * TWO THINGS MUST BE TRUE, AND NEITHER IS ENOUGH ALONE. The caller's `live` says the account was
 * ON WHEN THIS CALL READ IT, which is what an operator's out-of-band suspension fails — already
 * off means there is nothing of ours to undo, and no row state can tell you that. And the row must
 * still WANT the account, which is what a reject losing to ANOTHER REJECT fails: two callers can
 * both see the account on and both disable it, so the loser's own evidence says to put it back,
 * and doing so would leave an enabled identity under a decision that says otherwise.
 *
 * What `wanted` decides is why a `rejected` row is unambiguous where `active` is two states. The
 * price of its failed-read arm is paid HERE rather than in `withdraw`: a failed read cannot tell
 * `rejected` from absent, so answering wanted accepts the worse of the two — not merely an enabled
 * identity under a decision, which grants nothing, but an enabled ORPHAN. Deliberate, because
 * absent is near-unreachable, `REMOVE` being the only delete and re-inserting in the same
 * transaction, while the other direction strands an approved user on a failure that is not one.
 *
 * `live` is sampled BEFORE the disable, so it is evidence rather than proof — an operator
 * suspending the account inside that window is undone here. Known, and narrower than what it
 * replaced.
 */
async function restore(
  client: SqlClient,
  idp: IdentityClient,
  UserPoolId: string,
  email: string,
): Promise<void> {
  if (!(await wanted(client, email))) return;
  await idp.adminEnableUser({ UserPoolId, Username: email }).catch((e: unknown) => {
    // The ordinary applicant has no identity at all, so the disable above was already a no-op and
    // so is this — not an error, and the commonest way through here.
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
    // The row is untouched, so `withdraw` will find it `pending` and leave the identity alone —
    // which is right: approving again is what recovers a create whose `sub` did not come back.
    if (minted) await withdraw(client, idp, UserPoolId, row.email);
    return INTERNAL;
  }

  // `BEGIN` IS INSIDE THE TRY for the same reason the rest is: past the mint, EVERY way out of
  // this function has to pass the cleanup, and a connection that fails on the first statement
  // would otherwise carry an enabled identity out with it.
  try {
    await client.query('BEGIN');
    await client.query(REMOVE, [row.user_id]);
    await client.query(REPLACE, [sub, row.email, row.role, row.applied_at, decidedBy]);
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
  // THE IDENTITY GOES FIRST, AND THE ORDER IS THE FAILURE DIRECTION BEING CHOSEN. Written the
  // other way round, a disable that failed after the row was written would leave a `rejected`
  // row whose owner can still sign in — and the retry would answer "already decided" and repair
  // nothing. This way a failure leaves the row untouched and rejecting again finishes it.
  //
  // THE POOL IS ASKED ABOUT EVERY REJECT, because nothing in the schema records whether an
  // identity exists and `status` only ever looked like it did. `active` holds while registration
  // has only ever been closed — approval is then the one thing that mints an identity and it
  // always leaves the row `active` — and stops holding the moment a window opens: somebody who
  // applied BEFORE the window can sign themselves up during it, which gives them an identity while
  // `authorize.ts` keeps answering with their `pending` row, deliberately, so an open door cannot
  // jump the approval queue. Cognito owns the fact, so Cognito is what gets asked; a column here
  // would be a second record of it that a federated sign-in never writes.
  //
  // `UserNotFoundException` IS THE ABSENCE, and the only pool answer that is one. Every other
  // failure still stops the reject with the row untouched, which is the order chosen above.
  //
  // AND THE ACCOUNT IS READ BEFORE IT IS TOUCHED, so this call knows whether IT was the one that
  // turned the account off. That is the only evidence that distinguishes the three ways a decision
  // fails to land — an approve won, another reject won, or the write simply broke — because the
  // row cannot: it reads `rejected` whether this caller ruled or somebody else did, and `active`
  // whether an approve won or an operator suspended the account in the console by hand. Acting on
  // what this call CHANGED rather than on what the row now SAYS is what keeps a failed reject from
  // handing back an account it never turned off.
  //
  // THE ADDRESS FINDS THE ACCOUNT BY ALIAS, not because it is the username. Under
  // `UsernameAttributes: [email]` every account carries a UUID username, the ones
  // `AdminCreateUser` makes included, and the address resolves through the `email` alias instead —
  // so this reaches every LOCAL account however it was made, the open-window signer-up included. A
  // federated-only profile gets no such alias and answers not-found, which marks the row and logs
  // rather than failing; the row is what governs access. `docs/DECISIONS.md`, **Auth model**, and
  // `docs/reference/COGNITO-POOL-PARAMS.md` for what the pool actually answered.
  const live = await idp
    .adminGetUser({ UserPoolId, Username: row.email })
    .then((found) => found.Enabled !== false)
    .catch((err: unknown) => {
      if ((err as { name?: string })?.name !== 'UserNotFoundException') throw err;
      console.log(`approve: ${row.user_id} is being rejected with no local identity to disable`);
      return false;
    });
  // The account can still go between the read and this — an operator deleting it in the console is
  // the only lever that does it — and that is an absence like any other, not a reason to refuse.
  if (live) {
    await idp.adminDisableUser({ UserPoolId, Username: row.email }).catch((err: unknown) => {
      if ((err as { name?: string })?.name !== 'UserNotFoundException') throw err;
      console.log(`approve: ${row.email} went between being read and being disabled`);
    });
  }

  // A ROW ALREADY `rejected` IS A REPAIR RATHER THAN A NO-OP, which is what makes "rule again" a
  // real answer to every way an enabled identity can outlive a rejection — a disable that failed,
  // or either cleanup leaving one on rather than guess — `withdraw` where the row still wants it,
  // `restore` where the row could not be read. Short-circuiting before the pool made
  // those states reachable and unrepairable at once, and the read above is what keeps the repair
  // from costing a write when there is nothing to repair. What does not repeat is the DECISION:
  // `decided_at` and `decided_by` go on naming whoever ruled first.
  if (row.status === 'rejected') return ALREADY_DECIDED;

  // THE WRITE REPORTS ITSELF. Without this a reject that matched nothing would answer 200 having
  // changed nothing, which is the one thing an admin surface must not do.
  //
  // AND A WRITE CAN FAIL IN TWO SHAPES, so the repair hangs off the failure rather than off one of
  // them: DSQL settles a write-write conflict by ABORTING at commit, so a reject that lost the row
  // to an approve arrives here as a thrown `40001` just as readily as it arrives as no rows.
  // Attached to the row count alone, the restore would be skipped on exactly the ordering it
  // exists for.
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
  adminEnableUser: (input) => identityClient.send(new AdminEnableUserCommand(input)),
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
