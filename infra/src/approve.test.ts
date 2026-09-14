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

/** Records every Cognito call, and answers `UsernameExistsException` when `existing` is set. */
const spy = (existing?: string) => {
  const created: { Username: string; MessageAction?: string }[] = [];
  const fetched: unknown[] = [];
  const disabled: { Username: string }[] = [];
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
      return { UserAttributes: [{ Name: 'sub', Value: existing ?? SUB }] };
    },
    adminDisableUser: async (input: { UserPoolId: string; Username: string }) => {
      disabled.push(input);
      return {};
    },
  };
  return { idp, created, fetched, disabled };
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
  it('sets rejected with both halves of the pair and makes no Cognito call at all', async () => {
    await db.exec(insert(PLACEHOLDER, EMAIL, 'pending'));
    const { idp, created, fetched, disabled } = spy();
    const res = await approve(db, idp, call(REJECT_ROUTE));

    expect(res.statusCode).toBe(200);
    expect([created, fetched, disabled]).toEqual([[], [], []]);
    expect(await rows()).toEqual([
      expect.objectContaining({
        user_id: PLACEHOLDER,
        status: 'rejected',
        decided_by: ADMIN,
        decided: true,
      }),
    ]);
  });

  // AN APPLICANT WHO WAS NEVER APPROVED HAS NO COGNITO IDENTITY, so the row's own status is what
  // says whether there is anything to disable. Nothing asks the pool.
  it('disables the identity when one exists, and only then', async () => {
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

  it('does not report a second rejection as a fresh one, and disables nothing twice', async () => {
    await db.exec(insert(SUB, EMAIL, 'active'));
    await approve(db, spy().idp, call(REJECT_ROUTE, SUB));

    const again = spy();
    const res = await approve(db, again.idp, call(REJECT_ROUTE, SUB));
    expect(res.statusCode).not.toBe(200);
    expect(again.disabled).toEqual([]);
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
  // gate refuses them, approve refuses a non-pending row, and the runner's bootstrap throws on
  // both of its branches. Refused before the row is even read.
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
