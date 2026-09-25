// Approve is a COGNITO WRITE, not a status flip: `AdminCreateUser` is the only thing that mints
// the `sub` the row is keyed by, and the invitation it sends is the one message in the whole flow.
//
// TWO RULES GOVERN THE DISABLE/ENABLE MATRIX BELOW. Approve turns an identity off only when nothing
// still refers to it; reject turns the address off before it knows its own write landed, so a
// rejection never leaves a signed-in owner.
//
// APPROVAL OWNS "ON", unconditionally: a row it is adopting is `pending` by definition, so an
// identity found disabled is switched back on with nothing else asked. REJECT'S REPAIR TAKES TWO
// THINGS and neither is enough alone — `live`, meaning this call is what turned it off, which an
// operator's out-of-band suspension fails; and a row that still wants it, where `pending` wants it
// as much as `active` does. Where the evidence is missing, the call fails towards the state a
// retry can repair.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  APPROVE_ROUTE,
  REJECT_ROUTE,
  RESPONSES,
  approve as approveRoute,
  handler as rawHandler,
} from './approve';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

const { observed, record } = recorder(APPROVE_ROUTE);

const approve = async (...args: Parameters<typeof approveRoute>): ReturnType<typeof approveRoute> =>
  record(args[2], await approveRoute(...args));

const handler = async (...args: Parameters<typeof rawHandler>): ReturnType<typeof rawHandler> =>
  record(args[0], await rawHandler(...args));

const DML = ['005_demo_user.sql', '008_demo_account.sql'];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
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
 * `UserStatus` defaults to what an identity THIS SYSTEM made looks like; an `UNCONFIRMED` account
 * is somebody who claimed the address and never proved it.
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
 * A pool holding no LOCAL account for the address. `UserNotFoundException` is the only pool answer
 * reject treats as an absence; every other failure still stops it.
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
 * The delete is ANSWERED rather than run, so the pending row survives and the real `REPLACE`
 * collides on `app_user_email_uq` — a genuine constraint violation, which is what a decided row
 * produces. The read-back is answered too, because a row the harness wrote inside the transaction
 * would be rolled back with it and the read would see the old state again. It is matched on its
 * PARAMETER as well as its text: looking the row up BY ADDRESS is the whole point of it.
 */
const decidedDuring = (status?: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes('DELETE FROM app_user') || text.includes('UPDATE app_user')) {
      return { rows: [] as R[] };
    }
    if (text.includes('SELECT status FROM app_user')) {
      // CAPTURED RATHER THAN ASSERTED: both cleanups catch a failing read by design, so an
      // expectation thrown here is swallowed into the very "no call" outcome the negative tests
      // assert. It has to be checked by the test afterwards.
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

/** The super-admin below is inserted as raw SQL and provisions nothing, so every row here is one
 *  the call under test wrote. */
const accounts = async () =>
  (
    await db.query<{ user_id: string; provider: string; name: string }>(
      'SELECT user_id, provider, name FROM account',
    )
  ).rows;

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
  db = await freshDb();
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
      decided_by: ADMIN,
      decided: true,
      applied_at: undefined,
    });
    expect(row.user_id).not.toBe(PLACEHOLDER);
    expect(row.applied_at.toISOString()).toBe(new Date(APPLIED).toISOString());
  });

  it('carries the role across rather than assuming one', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending', 'super_admin'));
    await approve(db, spy().idp, call(APPROVE_ROUTE));
    expect((await rows())[0].role).toBe('super_admin');
  });

  it('leaves the pending row whole when the replacement fails', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(failingOn('INSERT INTO app_user'), spy().idp, call(APPROVE_ROUTE));
    expect(res.statusCode).toBe(500);
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: PLACEHOLDER, status: 'pending' }),
    ]);
  });

  // THE ACCOUNT IS KEYED BY THE MINTED SUB, not by the placeholder: the row is deleted and
  // re-inserted, so an account written earlier would belong to an id that no longer exists.
  it('gives the rekeyed row an account, inside the transaction that rekeys it', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    await approve(db, spy().idp, call(APPROVE_ROUTE));
    expect(await accounts()).toEqual([{ user_id: SUB, provider: 'inzhur', name: 'Inzhur' }]);
  });

  // The replay answer for THIS path is a refusal, not a second idempotent write: approve turns away
  // every non-pending row before it reaches the account insert at all. One account either way.
  it('refuses a second approval of the same row, and adds no account', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    await approve(db, spy().idp, call(APPROVE_ROUTE));
    const again = await approve(db, spy().idp, call(APPROVE_ROUTE, SUB));
    expect(again.statusCode).toBe(409);
    expect(await accounts()).toHaveLength(1);
  });

  it('leaves the pending row whole when the account insert fails', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(failingOn('INSERT INTO account'), spy().idp, call(APPROVE_ROUTE));
    expect(res.statusCode).toBe(500);
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: PLACEHOLDER, status: 'pending' }),
    ]);
    expect(await accounts()).toEqual([]);
  });

  /**
   * WHY `applications.ts` PROVISIONS NOTHING, measured rather than asserted in a comment. A pending
   * row is DELETED to rekey it onto the minted `sub`, and `account_user_fk` is `ON DELETE restrict`
   * — so an account hung off the placeholder makes every approval fail on the foreign key. A
   * pending row owns nothing, and this is what holds anyone to it.
   */
  it('could not approve at all if the pending row had been given an account', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    await db.exec(`INSERT INTO account (user_id, id, provider, name, created_at)
                     VALUES ('${PLACEHOLDER}', '${SUB}', 'inzhur', 'Inzhur', now());`);
    const res = await approve(db, spy().idp, call(APPROVE_ROUTE));
    expect(res.statusCode).toBe(500);
    expect(await rows()).toEqual([
      expect.objectContaining({ user_id: PLACEHOLDER, status: 'pending' }),
    ]);
  });

  // Suppressing the invitation is a measured trap: `AdminCreateUser` with `MessageAction: SUPPRESS`
  // and no `TemporaryPassword` fails outright, and a suppressed message takes the generated
  // password with it, leaving an account nobody can sign into.
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

  it('recovers a run whose identity was made and whose row was not', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched } = spy(SUB);
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(created).toHaveLength(1);
    expect(fetched).toHaveLength(1);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  it('adopts the identity of an owner who signed themselves up', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched } = spy(SUB, 'CONFIRMED');
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect([created.length, fetched.length]).toEqual([1, 1]);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  it('turns an adopted account back on rather than approving onto a disabled one', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy(SUB, 'CONFIRMED', false);
    const res = await approve(db, idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect((await rows())[0].user_id).toBe(SUB);
  });

  it('does not touch an adopted account that is already on', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy(SUB, 'CONFIRMED');
    await approve(db, idp, call(APPROVE_ROUTE));

    expect(enabled).toEqual([]);
  });

  // An unconfirmed account is not the owner: the pool holds a username as taken even for a sign-up
  // nobody confirmed, so adopting that `sub` bricks the address rather than merely taking it.
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

  it('disables the identity it minted when a reject won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled } = spy();
    const res = await approve(decidedDuring('rejected'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  it('leaves the identity alone when a concurrent approve won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, disabled } = spy();
    const res = await approve(decidedDuring('active'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    // The mint has to have happened for "left alone" to mean anything.
    expect(created).toHaveLength(1);
    expect(disabled).toEqual([]);
  });

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

  it('leaves the identity enabled when it cannot read what the address holds', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, disabled } = spy();
    const res = await approve(blindTo('SELECT status FROM app_user'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(created).toHaveLength(1);
    expect(disabled).toEqual([]);
  });

  it('leaves the identity enabled when the write failed and the application still stands', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled } = spy();
    const res = await approve(failingOn('INSERT INTO app_user'), idp, call(APPROVE_ROUTE));

    expect(res.statusCode).toBe(500);
    expect(disabled).toEqual([]);

    const retry = spy(SUB);
    expect((await approve(db, retry.idp, call(APPROVE_ROUTE))).statusCode).toBe(200);
    expect((await rows())[0].user_id).toBe(SUB);
  });

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

  it('names the demo refusal as its own, not as "already decided"', async () => {
    await db.exec(insert(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo'));
    const res = await approve(db, spy().idp, call(APPROVE_ROUTE, DEMO_USER_ID));
    expect(res.body).toContain('demo');
  });
});

describe('rejecting is a status, and disabling is its consequence', () => {
  it('asks the pool even for a row that never had an identity, and still records the decision', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched, disabled } = holdingNobody();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    // Asked — without this the test passes for a reject that short-circuited before Cognito.
    expect(fetched).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
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

  it('does not report a rejection that changed nothing', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(swallowing('UPDATE app_user'), spy().idp, call(REJECT_ROUTE));
    expect(res.statusCode).not.toBe(200);
    expect((await rows())[0].status).toBe('pending');
  });

  it('puts the account back when an approve won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring('active'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  it('leaves the account off when another reject won the race', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring('rejected'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  it('leaves the account off when it arrives after the winner disabled it', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(decidedDuring('rejected'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([]);
    expect(enabled).toEqual([]);
  });

  it('leaves an account suspended elsewhere off when its own write fails', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(swallowing('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([]);
    expect(enabled).toEqual([]);
  });

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

  it('records the decision for an account somebody else had already turned off', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, disabled, enabled } = spy(undefined, undefined, false);
    const res = await approve(db, idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(200);
    expect([disabled, enabled]).toEqual([[], []]);
    expect((await rows())[0].status).toBe('rejected');
  });

  it('leaves the account off when the address ends up holding no row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(decidedDuring(undefined), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  it('puts the account back when it cannot tell whether the row was decided', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy();
    const res = await approve(blindTo('SELECT status FROM app_user'), idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  it('puts the account back when the decision is aborted rather than unmatched', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, enabled } = spy();
    const res = await approve(failingOn('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(500);
    expect(enabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
  });

  it('puts nothing back on an aborted decision it never turned off', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    const { idp, enabled } = spy(undefined, undefined, false);
    const res = await approve(failingOn('UPDATE app_user'), idp, call(REJECT_ROUTE, SUB));

    expect(res.statusCode).toBe(500);
    expect(enabled).toEqual([]);
  });

  it('leaves the account off when the rejection is the one that decided the row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, enabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    expect(enabled).toEqual([]);
  });

  it('retries the disable for an enabled account under a rejected row', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'rejected'));
    const { idp, disabled, enabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).not.toBe(200);
    expect(disabled).toEqual([{ UserPoolId: POOL, Username: EMAIL }]);
    expect(enabled).toEqual([]);
  });

  it('does not restamp the decision pair on a second rejection, nor report it as a fresh one', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    await approve(db, spy().idp, call(REJECT_ROUTE, SUB));
    // The RAW pair, not the boolean `rows()` projects: a restamped `decided_at` is invisible to
    // "is not null".
    const pair = async () =>
      (
        await db.query<{ decided_at: Date; decided_by: string }>(
          `SELECT decided_at, decided_by FROM app_user WHERE email = $1`,
          [EMAIL],
        )
      ).rows;
    const first = await pair();

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
    // spelling sends the PLACEHOLDER and quietly approves a row instead of being refused.
    ['no id', { routeKey: APPROVE_ROUTE, pathParameters: {}, requestContext: token() }],
    ['an id that is not a uuid', call(APPROVE_ROUTE, 'not-a-uuid')],
  ];

  // The target row is seeded and the code is pinned: without a row every case passes against a
  // handler with no guards at all, since a 404 is also `>= 400`. With one present an unknown route
  // would fall through to reject and DECIDE THE APPLICANT.
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

  // Nobody rules on their own row, because the state it makes has no repair in code. SPELLED BOTH
  // WAYS, and the second spelling is the whole test: a `uuid` column compares canonically, so
  // capitals are the same row to the cluster and a different string to `===`.
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

  // The other half of the same fold: a guard refusing capitals outright would be safe and wrong.
  it('approves a target whose id arrived in capitals', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const res = await approve(db, spy().idp, call(APPROVE_ROUTE, PLACEHOLDER.toUpperCase()));
    expect(res.statusCode).toBe(200);
    expect((await rows())[0].user_id).toBe(SUB);
  });
});

describe('the handler answers rather than throwing', () => {
  // `connect()` cannot succeed here, which is what makes this meaningful: an uncaught throw would
  // reach the caller as API Gateway's own 502, so the 500 is proof the failure was answered.
  it('answers a connection failure with its own 500', async () => {
    await expect(handler(call(APPROVE_ROUTE))).resolves.toEqual(
      expect.objectContaining({ statusCode: 500, body: '{"error":"internal"}' }),
    );
  });
});

/** The mail assertion reads `approve.ts` through this, so a comment explaining why no mail client
 *  exists may name one.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

describe('the one mail in this flow is Cognito’s own', () => {
  // Asserted on the source: a client never constructed cannot be observed not calling anything.
  it('constructs no mail client and imports no mail SDK', () => {
    const source = stripTs(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'approve.ts'), 'utf8'),
      'approve.ts',
    );
    for (const name of ['client-ses', 'SESClient', 'SendEmail', 'sendMail', 'nodemailer']) {
      expect([name, source.includes(name)]).toEqual([name, false]);
    }
  });
});

// The answers the two routes share, driven through both. The gate's own refusals are covered in
// `authorize.test.ts`.
describe('both routes meet the gate, and reject reads its argument like approve does', () => {
  const OUTSIDER = '9f1e2d3c-0000-4000-8000-0000000000f7';

  for (const route of [APPROVE_ROUTE, REJECT_ROUTE]) {
    it(`refuses a caller whose own row was rejected, on ${route}`, async () => {
      await db.exec(insert(OUTSIDER, 'outsider@quirenote.com', 'rejected'));
      const res = await approve(
        db,
        spy().idp,
        call(route, PLACEHOLDER, token(OUTSIDER, 'outsider@quirenote.com')),
      );
      expect([route, res.statusCode, res.body]).toEqual([route, 403, '{"error":"rejected"}']);
    });

    it(`refuses a caller with no application at all, on ${route}`, async () => {
      const res = await approve(
        db,
        spy().idp,
        call(route, PLACEHOLDER, token(OUTSIDER, 'nobody@quirenote.com')),
      );
      expect([route, res.statusCode, res.body]).toEqual([route, 403, '{"error":"no_application"}']);
    });
  }

  it('refuses an unparseable id on reject, the way approve does', async () => {
    const res = await approve(db, spy().idp, call(REJECT_ROUTE, 'not-a-uuid'));
    expect([res.statusCode, res.body]).toEqual([400, '{"error":"invalid_request"}']);
  });

  it('answers not_found when reject names a row that is not there', async () => {
    const res = await approve(db, spy().idp, call(REJECT_ROUTE, OUTSIDER));
    expect([res.statusCode, res.body]).toEqual([404, '{"error":"not_found"}']);
  });

  it('refuses a demo row on reject, as its own answer', async () => {
    await db.exec(insert(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo'));
    const res = await approve(db, spy().idp, call(REJECT_ROUTE, DEMO_USER_ID));
    expect([res.statusCode, res.body]).toEqual([409, '{"error":"demo"}']);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 20 });
