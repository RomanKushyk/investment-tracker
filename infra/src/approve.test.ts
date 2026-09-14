// Approve is a COGNITO WRITE, not a status flip, and that is what most of this file is about.
// An approve that only moved `status` would leave the applicant with no way to sign in at all —
// `AdminCreateUser` is the only thing that mints the `sub` the row is keyed by, and the
// invitation it sends is the one message in the whole flow.
//
// PGlite for the row, in the shape `applications.test.ts` and `user-schema.test.ts` use, and a
// recording double for Cognito in the shape `pre-signup.test.ts` and `migrate.test.ts` use.
// Every assertion about Cognito is about the CALLS, so the calls are what the double keeps —
// there is no SDK mocking library in this repository and this file does not introduce one.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APPROVE_ROUTE, REJECT_ROUTE, approve, handler } from './approve';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';

const DML = '005_demo_user.sql';
const DDL = MIGRATIONS.filter((f) => f !== DML);
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const POOL = 'eu-north-1_EXAMPLE';
/** The super-admin doing the ruling — `decided_by` must end up naming this one. */
const ADMIN = '9f1e2d3c-0000-4000-8000-00000000ad11';
const ADMIN_EMAIL = 'owner@quirenote.com';
/** The placeholder `POST /v1/applications` wrote, which approval REPLACES. */
const PLACEHOLDER = '9f1e2d3c-0000-4000-8000-0000000000c3';
/** What the create call hands back, and what the row must end up keyed by. */
const SUB = '9f1e2d3c-0000-4000-8000-0000000000d4';
const EMAIL = 'applicant@quirenote.com';
const APPLIED = '2026-09-01T10:00:00Z';

const token = (sub = ADMIN, email = ADMIN_EMAIL): ApiEvent['requestContext'] => ({
  authorizer: { jwt: { claims: { token_use: 'id', sub, email } } },
});

const call = (
  routeKey: string,
  id: string | undefined = PLACEHOLDER,
  context = token(),
): ApiEvent => ({
  routeKey,
  pathParameters: id === undefined ? {} : { id },
  requestContext: context,
});

/**
 * Records every Cognito call, and answers `UsernameExistsException` when `existing` is set.
 *
 * `UserStatus` defaults to what an identity THIS SYSTEM made looks like: `AdminCreateUser` leaves
 * `FORCE_CHANGE_PASSWORD` until the invitation is used. The parameter exists because approve now
 * reads it — an `UNCONFIRMED` account is somebody who claimed the address and never proved it.
 */
const spy = (existing?: string, UserStatus = 'FORCE_CHANGE_PASSWORD', Enabled = true) => {
  const created: { Username: string; MessageAction?: string }[] = [];
  const fetched: unknown[] = [];
  const disabled: { Username: string }[] = [];
  const enabled: { Username: string }[] = [];
  const idp = {
    adminCreateUser: async (input: { UserPoolId: string; Username: string }) => {
      created.push(input as { Username: string });
      if (existing !== undefined) {
        throw Object.assign(new Error('User account already exists'), {
          name: 'UsernameExistsException',
        });
      }
      return { User: { Attributes: [{ Name: 'sub', Value: SUB }] } };
    },
    adminGetUser: async (input: { UserPoolId: string; Username: string }) => {
      fetched.push(input);
      return { UserAttributes: [{ Name: 'sub', Value: existing ?? SUB }], UserStatus, Enabled };
    },
    adminDisableUser: async (input: { UserPoolId: string; Username: string }) => {
      disabled.push(input);
      return {};
    },
    adminEnableUser: async (input: { UserPoolId: string; Username: string }) => {
      enabled.push(input);
      return {};
    },
  };
  return { idp, created, fetched, disabled, enabled };
};

/**
 * A pool holding no LOCAL account for the address, which is what "never had an identity" looks
 * like now that the row is not asked. `UserNotFoundException` is the only pool answer reject
 * treats as an absence; every other failure still stops it.
 */
const holdingNobody = () => {
  const base = spy();
  const fetched: unknown[] = [];
  return {
    ...base,
    fetched,
    idp: {
      ...base.idp,
      adminGetUser: async (input: { UserPoolId: string; Username: string }) => {
        fetched.push(input);
        throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
      },
    },
  };
};

let db: PGlite;

/** The real cluster, except that one statement fails — so a failure lands mid-flow. */
const failingOn = (needle: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes(needle)) throw new Error('the cluster said no');
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

/** The real cluster, except that one statement matches nothing — a write somebody else beat. */
const swallowing = (needle: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) =>
    text.includes(needle)
      ? { rows: [] as R[] }
      : (db.query<R>(text, values) as Promise<{ rows: R[] }>),
});

/**
 * The real cluster, except that somebody else decided the row between the read and the write.
 *
 * The delete is answered rather than run, so the pending row SURVIVES and the real `REPLACE`
 * collides on `app_user_email_uq` — a genuine constraint violation, which is what a decided row
 * produces. The read-back is answered too, because a row the harness wrote inside the transaction
 * would be rolled back with it and the read would then see the old state again.
 *
 * `status: undefined` stands for the address holding no row at all. The read-back is matched on
 * its PARAMETER as well as its text: looking the row up BY ADDRESS is the whole point of it, and
 * a lookup changed to the id would otherwise go on passing.
 */
const decidedDuring = (status?: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    // Both writes, because both cleanups face the same hazard: approve's `REMOVE` and reject's
    // `DECIDE` are each guarded on the status that was read, and each matches nothing once
    // somebody else has ruled.
    if (text.includes('DELETE FROM app_user') || text.includes('UPDATE app_user')) {
      return { rows: [] as R[] };
    }
    if (text.includes('SELECT status FROM app_user')) {
      // CAPTURED RATHER THAN ASSERTED HERE. Both cleanups catch a failing read by design, so an
      // expectation thrown inside this call is swallowed into the very "no call" outcome the
      // negative tests assert — it has to be checked by the test afterwards.
      askedFor.push(values);
      return { rows: (status === undefined ? [] : [{ status }]) as R[] };
    }
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

/** What the read-back was looked up by. Reading it BY ADDRESS is the whole point of `ROW_NOW`. */
let askedFor: unknown[] = [];

/** The real cluster, except that the read-back the cleanup depends on is the statement that fails. */
const blindTo = (needle: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes('DELETE FROM app_user') || text.includes('UPDATE app_user')) {
      return { rows: [] as R[] };
    }
    if (text.includes(needle)) throw new Error('the cluster said no');
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

const insert = (userId: string, email: string, status: string, role = 'user') =>
  status === 'pending'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', 'pending', '${role}', '${APPLIED}');`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
         VALUES ('${userId}', '${email}', '${status}', '${role}', '${APPLIED}', now(),
                 '${userId}');`;

type Row = {
  user_id: string;
  email: string;
  status: string;
  role: string;
  decided_by: string | null;
  decided: boolean;
  applied_at: Date;
};

const rows = async (email = EMAIL) =>
  (
    await db.query<Row>(
      `SELECT user_id, email, status, role, decided_by, decided_at IS NOT NULL AS decided,
              applied_at
         FROM app_user WHERE email = $1`,
      [email],
    )
  ).rows;

beforeEach(async () => {
  db = new PGlite();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  await db.exec(insert(ADMIN, ADMIN_EMAIL, 'active', 'super_admin'));
  askedFor = [];
  vi.stubEnv('USER_POOL_ID', POOL);
  vi.stubEnv('OPEN_REGISTRATION', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('approving replaces the placeholder with the sub the create call returned', () => {
  it('creates the identity and rekeys the row, decision pair and all', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created } = spy();
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(created).toHaveLength(1);
    expect(created[0].Username).toBe(EMAIL);

    const [row] = await rows();
    expect({ ...row, applied_at: undefined }).toEqual({
      user_id: SUB,
      email: EMAIL,
      status: 'active',
      role: 'user',
      // THE CALLER, not the row itself — this is a real approval by a real super-admin, unlike
      // the bootstrap's, which had nobody else it could truthfully name.
      decided_by: ADMIN,
      decided: true,
      applied_at: undefined,
    });
    // THE PLACEHOLDER IS GONE, proved by reading the row back rather than by the 200.
    expect(row.user_id).not.toBe(PLACEHOLDER);
    // AND THE APPLICATION'S OWN TIMESTAMP SURVIVES THE REPLACEMENT. It is the only thing the
    // pending row held that cannot be reconstructed, and a delete-and-insert is exactly where
    // it goes missing.
    expect(row.applied_at.toISOString()).toBe(new Date(APPLIED).toISOString());
  });

  // THE ROLE CROSSES TOO, and `REPLACE` binds it rather than writing `'user'`. Nothing produces
  // a pending super-admin today — the applications endpoint writes `user` and the bootstrap
  // writes `active` directly — so this is the assertion that stops the parameter being
  // simplified into a literal by somebody who checks only what the current callers write.
  it('carries the role across rather than assuming one', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending', 'super_admin'));
    await approve(db, spy().idp, call(APPROVE_ROUTE));
    expect((await rows())[0].role).toBe('super_admin');
  });

  // THE TWO STATEMENTS ARE ONE ACT, which is the whole reason the DSQL immutable-key ruling
  // needed a transaction rather than an update. Without it the delete lands, the insert fails,
  // and the application is GONE — no row, no identity to sign in as, nothing to approve again.
  it('leaves the pending row whole when the replacement fails', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(failingOn('INSERT INTO app_user'), spy().idp, call(APPROVE_ROUTE));
    expect(res.statusCode).toBe(500);
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: PLACEHOLDER, status: 'pending' }),
    ]);
  });

  // THE INVITATION IS SENT, and suppressing it is a measured trap: `AdminCreateUser` with
  // `MessageAction: SUPPRESS` and no `TemporaryPassword` fails outright, and a suppressed
  // message takes the generated password with it, leaving an account nobody can sign into —
  // `ForgotPassword` refuses a user in `FORCE_CHANGE_PASSWORD`.
  it('asks for an emailed invitation and suppresses nothing', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created } = spy();
    await approve(db, idp, call(APPROVE_ROUTE));
    expect(created[0]).toMatchObject({ UserPoolId: POOL, DesiredDeliveryMediums: ['EMAIL'] });
    expect(created[0].MessageAction).toBeUndefined();
  });

  it('creates no second identity on a repeat, and does not call it a fresh approval', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    await approve(db, spy().idp, call(APPROVE_ROUTE));

    const again = spy();
    const res = await approve(db, again.idp, call(APPROVE_ROUTE));
    expect(res.statusCode).not.toBe(200);
    expect(again.created).toEqual([]);
    expect(await rows()).toHaveLength(1);
  });

  // THE HALF-DONE STATE IS THE ONE THAT MATTERS. An identity created and a row that did not land
  // leaves a `sub` nothing refers to, and the only way back is to approve again — so a create
  // that says "already there" must continue to the row rather than fail.
  it('recovers a run whose identity was made and whose row was not', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched } = spy(SUB);
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(created).toHaveLength(1);
    expect(fetched).toHaveLength(1);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  // THE OWNER SIGNED THEMSELVES UP, which is the state an open window leaves behind: their row
  // stayed `pending` because the gate would not let an open door jump the approval queue, and
  // the identity exists anyway. Adopting it is the repair, and a `CONFIRMED` account is one
  // whose holder received mail at that address — so it is the owner, and the adoption is right.
  it('adopts the identity of an owner who signed themselves up', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched } = spy(SUB, 'CONFIRMED');
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect([created.length, fetched.length]).toEqual([1, 1]);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  // APPROVAL OWNS "ON", and adoption is the one place it has to say so. Reject turns an address
  // off before it knows its own write will land, so a reject that failed leaves a DISABLED
  // identity under a row still `pending` — and adopting it blindly writes a flawless `active` row
  // for an account nobody can sign in as, with no invitation, and approve refuses to run twice.
  it('turns an adopted account back on rather than approving onto a disabled one', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy(SUB, 'CONFIRMED', false);
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  // AND ONLY WHERE IT IS OFF, because an enable is a write and the common adoption needs none.
  it('does not touch an adopted account that is already on', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy(SUB, 'CONFIRMED');
    await approve(db, idp, call(APPROVE_ROUTE));

    expect(enabled).toEqual([]);
  });

  // AND AN UNCONFIRMED ACCOUNT IS NOT THE OWNER. The pool holds a username as taken even for a
  // sign-up nobody ever confirmed, so while the window is open anyone can take an address they
  // do not hold. Adopting that `sub` writes a flawless `active` row for an account nobody can
  // sign in as, and no invitation was sent — the create threw. Re-approving then answers
  // "already decided", so the address is bricked rather than merely taken.
  it('refuses an identity whose holder never proved the address', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp } = spy(SUB, 'UNCONFIRMED');
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('unclaimed_identity');
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: PLACEHOLDER, status: 'pending', decided: false }),
    ]);
  });

  // A REJECT RACING AN APPROVE, from the approve side. The identity is minted, then the pending
  // row is not ours to remove — decided under us — and `REPLACE` collides on `app_user_email_uq`
  // against the row the other caller left. The database stops the bad ROW; only this stops the
  // enabled identity attached to it, at the moment the decision is known rather than whenever
  // somebody thinks to rule again.
  it('disables the identity it minted when a reject won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled } = spy();
    const res = await approve(decidedDuring('rejected'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  // AND ONLY WHERE NOTHING STILL WANTS IT. A concurrent approve that won adopted this very
  // identity and wrote the row it belongs to, so disabling it here would turn off an account
  // somebody was just approved into.
  it('leaves the identity alone when a concurrent approve won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, disabled } = spy();
    const res = await approve(decidedDuring('active'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    // THE MINT HAS TO HAVE HAPPENED for "left alone" to mean anything: without this the test
    // passes on any early refusal, which records no calls of either kind.
    expect(created).toHaveLength(1);
    expect(disabled).toEqual([]);
  });

  // NOTHING REFERS TO IT AND NOTHING CAN, which is the fourth arm of the same rule.
  it('disables the identity it minted when the address ends up holding no row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, disabled } = spy();
    const res = await approve(decidedDuring(undefined), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(created).toHaveLength(1);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    // BY ADDRESS, not by the id this call was rekeying — the row may now be keyed by a `sub`.
    expect(askedFor).toEqual([[EMAIL]]);
  });

  // AND A READ THAT FAILS ANSWERS NOTHING, so the identity stays enabled: rejecting again retries
  // the disable, where an account wrongly turned off has no path back through this API.
  it('leaves the identity enabled when it cannot read what the address holds', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, disabled } = spy();
    const res = await approve(blindTo('SELECT status FROM app_user'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(created).toHaveLength(1);
    expect(disabled).toEqual([]);
  });

  // A TRANSIENT FAILURE IS NOT A RACE, and this is the difference the cleanup turns on. The
  // application is still `pending` and still nobody's, so the identity is exactly what approving
  // again needs: `UsernameExistsException` sends the retry to `AdminGetUser` for this same one.
  // Disabling it would leave a retry that answers 200 having written a flawless `active` row onto
  // an account that cannot sign in, and nothing in this API holds `AdminEnableUser` to undo it.
  it('leaves the identity enabled when the write failed and the application still stands', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled } = spy();
    const res = await approve(failingOn('INSERT INTO app_user'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(500);
    expect(disabled).toEqual([]);

    // AND THE RETRY FINISHES IT, which is the promise that disabling would have broken.
    const retry = spy(SUB);
    expect((await approve(db, retry.idp, call(APPROVE_ROUTE))).statusCode).toBe(200);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  // THE MINT IS NOT THE ONLY WAY OUT OF THIS FUNCTION past the create, so the cleanup cannot hang
  // off the transaction alone. A create that answers without a `sub` leaves the application whole,
  // so the identity stays enabled for the retry to find.
  it('leaves the identity enabled when the create answered no sub', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp } = spy();
    const idpWithoutSub = { ...idp, adminCreateUser: async () => ({ User: { Attributes: [] } }) };
    const res = await approve(db, idpWithoutSub, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(500);
    expect((await rows())[0].status).toBe('pending');
  });
});

describe('what approve refuses before it asks Cognito anything', () => {
  const refusals: [string, () => Promise<unknown>, string][] = [
    ['a row that is not there', async () => undefined, 'missing'],
    [
      'the demo identity',
      async () => db.exec(insert(DEMO_USER_ID, EMAIL, 'active', 'demo')),
      'demo',
    ],
    ['a row already active', async () => db.exec(insert(PLACEHOLDER, EMAIL, 'active')), 'active'],
    [
      'a row already rejected',
      async () => db.exec(insert(PLACEHOLDER, EMAIL, 'rejected')),
      'rejected',
    ],
  ];

  for (const [what, seed, tag] of refusals) {
    it(`refuses ${what}, and the injected client records nothing`, async () => {
      await seed();
      const { idp, created, fetched, disabled } = spy();
      const id = tag === 'demo' ? DEMO_USER_ID : PLACEHOLDER;
      const res = await approve(db, idp, call(APPROVE_ROUTE, id));
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      expect([created, fetched, disabled]).toEqual([[], [], []]);
    });
  }

  // APPROVING A DEMO ROW WOULD SPEND A MONTHLY ACTIVE USER AND MAIL A FABRICATED ADDRESS whose
  // bounce cannot be cleared. The role is what makes that refusal structural rather than a
  // convention somebody has to remember in the admin screen.
  it('names the demo refusal as its own, not as "already decided"', async () => {
    await db.exec(insert(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo'));
    const res = await approve(db, spy().idp, call(APPROVE_ROUTE, DEMO_USER_ID));
    expect(res.body).toContain('demo');
  });
});

describe('rejecting is a status, and disabling is its consequence', () => {
  // THE POOL IS ASKED ABOUT EVERY REJECT, and this is the criterion #146 shipped with rewritten:
  // it asked for NO Cognito call when rejecting an applicant who never had an identity, on the
  // reasoning that `status` says whether there is one. `status` never said that — it only looked
  // like it while registration had never been open. So the call is made and the pool's own
  // `UserNotFoundException` is what "never had one" means.
  it('asks the pool even for a row that never had an identity, and still records the decision', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched, disabled } = holdingNobody();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    // ASKED — without this the test passes for a reject that short-circuited before Cognito, which
    // is the defect it exists to catch.
    expect(fetched).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    // And answered not-found, so there was nothing to turn off and nothing was attempted.
    expect([created, disabled]).toEqual([[], []]);
    expect(await rows()).toEqual([
      expect.objectContaining({
        user_id: PLACEHOLDER,
        status: 'rejected',
        decided_by: ADMIN,
        decided: true,
      }),
    ]);
  });

  // THE CASE THE OLD PROXY SKIPPED, and the reason this issue exists. Somebody applies, the
  // window opens, they sign themselves up — Cognito mints a local identity and `authorize.ts`
  // deliberately keeps answering with their PENDING row, so nothing ever writes `active`.
  // Reading the disable off the row skips it for exactly this person, who keeps an enabled
  // account and a refresh token while their record says they were turned away.
  it('disables the identity of an applicant who signed up during an open window', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect((await rows())[0].status).toBe('rejected');
  });

  it('disables the identity of somebody who was approved', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, disabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect((await rows())[0].status).toBe('rejected');
  });

  // THE DISABLE COMES FIRST, and the order is the failure direction being chosen rather than
  // accepted. Written the other way round, a disable that failed after the row was written would
  // leave a `rejected` row whose owner can still sign in — and the retry would answer "already
  // decided" and repair nothing.
  // THE LOOKUP IS NEW SURFACE ON EVERY REJECT, so it is a new way for every reject to fail — and
  // only `UserNotFoundException` may be read as an absence. Anything else stops the decision with
  // the row untouched, the same direction the disable below takes.
  it('stops the rejection when the pool cannot be asked at all', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const idp = {
      ...spy().idp,
      adminGetUser: async () => {
        throw new Error('TooManyRequestsException');
      },
    };
    const res = await approve(db, idp, call(REJECT_ROUTE));
    expect(res.statusCode).toBe(500);
    expect((await rows())[0].status).toBe('pending');
  });

  // THE ACCOUNT CAN GO BETWEEN BEING READ AND BEING DISABLED — an operator deleting it in the
  // console is the only lever that does — and an absence is not a reason to refuse the decision.
  it('records the decision when the account vanishes between the read and the disable', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const idp = {
      ...spy().idp,
      adminDisableUser: async () => {
        throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
      },
    };
    const res = await approve(db, idp, call(REJECT_ROUTE, SUB));
    expect(res.statusCode).toBe(200);
    expect((await rows())[0].status).toBe('rejected');
  });

  it('leaves the row active when the disable fails, so a retry still repairs it', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const idp = {
      ...spy().idp,
      adminDisableUser: async () => {
        throw new Error('TooManyRequestsException');
      },
    };
    const res = await approve(db, idp, call(REJECT_ROUTE, SUB));
    expect(res.statusCode).toBe(500);
    expect((await rows())[0].status).toBe('active');
  });

  // A REJECT THAT MATCHED NOTHING MUST NOT ANSWER 200. `SqlClient` reports no rowcount, so the
  // row is read back — and without that read this returns `rejected` for a row somebody else
  // decided between the read and the write, which is the one thing an admin surface must not do.
  it('does not report a rejection that changed nothing', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(swallowing('UPDATE app_user'), spy().idp, call(REJECT_ROUTE));
    expect(res.statusCode).not.toBe(200);
    expect((await rows())[0].status).toBe('pending');
  });

  // THE OTHER HALF OF DISABLING FIRST. Reject turns the address off before it knows its own write
  // applied, which is what keeps a rejection from ever leaving a signed-in owner behind — but
  // where an approve won the race, the account it just turned off is somebody's approved one and
  // `DECIDE` matches nothing. Without the repair the row says `active`, the person cannot sign in,
  // and no route in this API can put it back.
  it('puts the account back when an approve won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring('active'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  // AND NOT WHEN ANOTHER REJECT WON IT, which takes BOTH tests to see. Two rejects can each read
  // the account while it is still on, so both hold "I turned it off" and the loser's own evidence
  // says to put it back — while a `rejected` row says it must stay off whoever turned it off. The
  // address is unique, so that row is unambiguous where `active` is not.
  it('leaves the account off when another reject won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring('rejected'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  // THE OTHER ORDERING OF THE SAME RACE: this reject reads the account after the winner has
  // already turned it off, so it disables nothing. Both guards would answer it, and what only this
  // one pins is the DISABLE being skipped — the row check cannot reach that far.
  it('leaves the account off when it arrives after the winner disabled it', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(decidedDuring('rejected'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([]);
    expect(enabled).toEqual([]);
  });

  // THE SAME EVIDENCE ANSWERS AN OUT-OF-BAND SUSPENSION. Somebody disabled the account in the
  // console and left the row `active`; a reject whose write then fails must not hand that account
  // back. Reading the row cannot see this at all — it says `active`, which is exactly what a
  // winning approve says too.
  it('leaves an account suspended elsewhere off when its own write fails', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(swallowing('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([]);
    expect(enabled).toEqual([]);
  });

  // A ROW STILL WANTING THE ACCOUNT PUTS IT BACK, and `pending` wants it as much as `active`
  // does: nothing decided, so turning the account off was premature rather than wrong. The
  // `active` half of the same rule is the approve-won case above.
  it('puts the account back where the row still wants it', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring('pending'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    // BY ADDRESS — the row this reject read may now be keyed by a `sub` the winner wrote.
    expect(askedFor).toEqual([[EMAIL]]);
  });

  // AN OPERATOR-SUSPENDED ACCOUNT IS STILL REJECTABLE. `live` gates the disable as well as the
  // repair, so the guard could have made a reject skip its own decision — this is the half of it
  // that no race touches.
  it('records the decision for an account somebody else had already turned off', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(db, idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(200);
    expect([disabled, enabled]).toEqual([[], []]);
    expect((await rows())[0].status).toBe('rejected');
  });

  // AN ADDRESS HOLDING NO ROW WANTS NOTHING, and the account stays off — the same answer
  // `withdraw` gives the same evidence. It is not the harmless case the `rejected` arm is: with a
  // window open the gate MINTS an `active` row for any verified identity holding none, so an
  // enabled orphan self-provisions rather than granting nothing.
  it('leaves the account off when the address ends up holding no row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring(undefined), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  // AND A READ THAT FAILS COUNTS AS NOT DECIDED, so the account goes back on. Turning it off is
  // already proved; the worst case is an enabled identity under a `rejected` row, which grants
  // nothing and which rejecting again repairs. Failing the other way strands an approved user with
  // no path back at all.
  it('puts the account back when it cannot tell whether the row was decided', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy();
    const res = await approve(blindTo('SELECT status FROM app_user'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  // A LOST RACE ARRIVES IN TWO SHAPES. DSQL settles a write-write conflict by ABORTING at commit,
  // so the reject that lost the row to an approve is thrown at rather than answered with no rows.
  // Hung off the row count alone, the repair is skipped on exactly the ordering it exists for.
  it('puts the account back when the decision is aborted rather than unmatched', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, enabled } = spy();
    const res = await approve(failingOn('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(500);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  // AND THE ABORTED SHAPE IS GATED ON `live` TOO. It is the shape the repair was added for, so an
  // account this call never turned off must not come back through it either.
  it('puts nothing back on an aborted decision it never turned off', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, enabled } = spy(undefined, undefined, false);
    const res = await approve(failingOn('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(500);
    expect(enabled).toEqual([]);
  });

  // AND ONLY THEN. A reject that decided the row must leave the account off; re-enabling on the
  // success path would undo the whole point of the call.
  it('leaves the account off when the rejection is the one that decided the row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(enabled).toEqual([]);
  });

  // A SECOND REJECTION IS A REPAIR, NOT A NO-OP, and that is what makes "reject again" a real
  // answer to every way an enabled identity can outlive a rejection — a disable that failed, and
  // the arms of `withdraw` and `restore` that deliberately leave an account on rather than guess
  // — `restore`'s failed read turns one back on, so it belongs in that list too.
  // It repairs only what is broken: after a rejection that landed the account is already off, so a
  // second one finds nothing to do, where an enabled account under a `rejected` row gets the retry.
  it('retries the disable for an enabled account under a rejected row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'rejected'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  // AND WHAT DOES NOT REPEAT IS THE WRITE: `decided_at` and `decided_by` go on naming whoever
  // ruled first, so a second super-admin re-rejecting cannot overwrite the record of who did.
  it('does not restamp the decision pair on a second rejection, nor report it as a fresh one', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    await approve(db, spy().idp, call(REJECT_ROUTE, SUB));
    // THE RAW PAIR, not the boolean `rows()` projects: a restamped `decided_at` is invisible to
    // "is not null", and a second ruler is what makes an overwritten `decided_by` visible at all.
    const pair = async () =>
      (
        await db.query<{ decided_at: Date; decided_by: string }>(
          `SELECT decided_at, decided_by FROM app_user WHERE email = $1`,
          [EMAIL],
        )
      ).rows;
    const first = await pair();

    // The first rejection turned the account off, so the second finds it already off.
    const again = spy(undefined, undefined, false);
    const other = '9f1e2d3c-0000-4000-8000-00000000ad22';
    await db.exec(insert(other, 'second@quirenote.com', 'active', 'super_admin'));
    const res = await approve(
      db,
      again.idp,
      call(REJECT_ROUTE, SUB, token(other, 'second@quirenote.com')),
    );
    expect(res.statusCode).not.toBe(200);
    expect([again.disabled, again.enabled]).toEqual([[], []]);
    expect(await pair()).toEqual(first);
  });
});

describe('every admin route reads the caller off the row', () => {
  const callers: [string, string][] = [
    ['an ordinary user', 'user'],
    ['a pending applicant', 'pending'],
  ];

  for (const route of [APPROVE_ROUTE, REJECT_ROUTE]) {
    for (const [what, kind] of callers) {
      it(`refuses ${what} on ${route}`, async () => {
        await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
        const caller = '9f1e2d3c-0000-4000-8000-0000000000e5';
        await db.exec(
          kind === 'user'
            ? insert(caller, 'someone@quirenote.com', 'active')
            : insert(caller, 'someone@quirenote.com', 'pending'),
        );
        const { idp, created, disabled } = spy();
        const res = await approve(
          db,
          idp,
          call(route, PLACEHOLDER, token(caller, 'someone@quirenote.com')),
        );
        expect(res.statusCode).toBe(403);
        expect([created, disabled]).toEqual([[], []]);
        expect((await rows())[0].status).toBe('pending');
      });
    }

    it(`refuses an unauthenticated request on ${route} rather than reaching the handler`, async () => {
      await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
      const { idp, created, disabled } = spy();
      const res = await approve(db, idp, { routeKey: route, pathParameters: { id: PLACEHOLDER } });
      expect(res.statusCode).toBe(403);
      expect([created, disabled]).toEqual([[], []]);
    });
  }

  const malformed: [string, ApiEvent][] = [
    ['an unknown route', call('POST /admin/users/{id}/promote')],
    ['no route at all', { pathParameters: { id: PLACEHOLDER }, requestContext: token() }],
    // NOT `call(APPROVE_ROUTE, undefined)` — a default parameter fires on `undefined`, so that
    // spelling sends the PLACEHOLDER and this case quietly approved a row instead of being
    // refused. It read as green only because the block seeded no target row, which is what
    // made a 404 look like the guard working.
    ['no id', { routeKey: APPROVE_ROUTE, pathParameters: {}, requestContext: token() }],
    ['an id that is not a uuid', call(APPROVE_ROUTE, 'not-a-uuid')],
  ];

  // THE TARGET ROW IS SEEDED AND THE CODE IS PINNED, and both matter. Written without a row,
  // every case passed against a handler with no route guard and no id guard at all: the target
  // read found nothing and answered 404, which is also `>= 400`. With a row present an unknown
  // route would fall through to reject and DECIDE THE APPLICANT, and a non-uuid id would reach
  // the cluster as `22P02` and come back as a 500. So the assertion is the exact answer, and the
  // row is here to make the fall-through reachable.
  for (const [what, event] of malformed) {
    it(`refuses ${what} with a 400, touching neither the row nor Cognito`, async () => {
      await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
      const { idp, created, fetched, disabled } = spy();
      const res = await approve(db, idp, event);
      expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
      expect([created, fetched, disabled]).toEqual([[], [], []]);
      expect((await rows())[0].status).toBe('pending');
    });
  }

  // NOBODY RULES ON THEIR OWN ROW, because the state it makes has no repair in code: the
  // super-admin disables their own account and marks their own row `rejected`, and from there the
  // gate refuses them, approve refuses a non-pending row, and the runner's bootstrap refuses the
  // address it already holds a row for. Refused before the row is even read.
  //
  // SPELLED BOTH WAYS, AND THE SECOND SPELLING IS THE WHOLE TEST. Hex is hex in either case and a
  // `uuid` column compares canonically, so capitals are the same row to the cluster and a
  // different string to `===`. Written without the fold, this guard was skipped by anyone who
  // typed their own id in capitals — the cluster found the row and the comparison did not.
  for (const route of [APPROVE_ROUTE, REJECT_ROUTE]) {
    for (const [spelling, id] of [
      ['as it is stored', ADMIN],
      ['in capitals', ADMIN.toUpperCase()],
    ] as const) {
      it(`refuses the caller's own row ${spelling} on ${route}`, async () => {
        const { idp, created, disabled } = spy();
        const res = await approve(db, idp, call(route, id));
        expect([res.statusCode, res.body]).toEqual([409, '{"error":"self"}']);
        expect([created, disabled]).toEqual([[], []]);
        expect((await rows(ADMIN_EMAIL))[0].status).toBe('active');
      });
    }
  }

  // THE OTHER HALF OF THE SAME FOLD: capitals must still REACH the row they name. A guard that
  // refused them outright would be safe and wrong, turning away an id the cluster resolves
  // perfectly well.
  it('approves a target whose id arrived in capitals', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(db, spy().idp, call(APPROVE_ROUTE, PLACEHOLDER.toUpperCase()));
    expect(res.statusCode).toBe(200);
    expect((await rows())[0].user_id).toBe(SUB);
  });
});

describe('the handler answers rather than throwing', () => {
  // `connect()` NEEDS `DSQL_ENDPOINT` AND A CREDENTIAL CHAIN, so it cannot succeed here — which
  // is what makes this meaningful. An uncaught throw would reach the caller as API Gateway's own
  // 502, a second shape for the same class of event; the 500 coming back is the proof that the
  // connection failure was answered instead. `applications.test.ts` covers its own handler the
  // same way, and this file had left the branch uncovered.
  it('answers a connection failure with its own 500', async () => {
    await expect(handler(call(APPROVE_ROUTE))).resolves.toEqual(
      expect.objectContaining({ statusCode: 500, body: '{"error":"internal"}' }),
    );
  });
});

describe('the one mail in this flow is Cognito’s own', () => {
  // Asserted on the source, because a client that is never constructed cannot be observed not
  // calling anything — the shape `applications.test.ts` uses for the same claim.
  it('constructs no mail client and imports no mail SDK', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'approve.ts'),
      'utf8',
    );
    for (const name of ['client-ses', 'SESClient', 'SendEmail', 'sendMail', 'nodemailer']) {
      expect([name, source.includes(name)]).toEqual([name, false]);
    }
  });
});
