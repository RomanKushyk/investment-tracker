// The gate every authenticated route reads, and the assertions are about WHICH refusal rather
// than merely that one happened.
//
// A caller who is genuinely signed in and may not act yet is not a 401 — that is the whole point
// of the `pending` case, and a suite that only checked "refused" would pass against a handler
// that answered 401 to all three. So the three refusals are asserted as three distinct bodies,
// and the distinctness itself is a test.
//
// PGlite applying the migrations the runner names, the way `applications.test.ts` applies them,
// because the row this file writes has to be one `003` and `006` accept — `app_user_decided_ck`
// is what refuses a self-approved row with half a decision pair, and an assertion written here
// could not.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Gate, authorize, superAdminOnly } from './authorize';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';

// `005` is DML — the demo row — and it would sit underneath every count below. Derived from
// `MIGRATIONS` so a new schema file cannot be forgotten here, exactly as its neighbours derive it.
const DML = '005_demo_user.sql';
const DDL = MIGRATIONS.filter((f) => f !== DML);
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000a1';
const OTHER = '9f1e2d3c-0000-4000-8000-0000000000b2';
const EMAIL = 'applicant@quirenote.com';

/**
 * An ID TOKEN's claims, which is what this API takes. `token_use` is stamped by Cognito and is
 * the only thing that tells an id token from an access token — AWS's own note on JWT authorizers
 * says there is no standard mechanism, and an access token carries no `email` at all.
 */
const token = (claims: Record<string, string | string[]> = {}): ApiEvent => ({
  requestContext: {
    authorizer: {
      jwt: {
        claims: { token_use: 'id', sub: SUB, email: EMAIL, email_verified: 'true', ...claims },
      },
    },
  },
});

/** Records what the gate asked the cluster for, so "asked nothing" is assertable. */
const spy = () => {
  const asked: { text: string; values?: unknown[] }[] = [];
  const client: SqlClient = {
    query: async <R>(text: string, values?: unknown[]) => {
      asked.push({ text, values });
      return { rows: [] as R[] };
    },
  };
  return { client, asked };
};

let db: PGlite;

const row = (userId: string, email: string, status: string, role = 'user') =>
  status === 'pending'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', 'pending', '${role}', now());`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
         VALUES ('${userId}', '${email}', '${status}', '${role}', now(), now(), '${userId}');`;

const rows = async () =>
  (
    await db.query<{ user_id: string; email: string; status: string; role: string }>(
      'SELECT user_id, email, status, role FROM app_user ORDER BY email',
    )
  ).rows;

const pair = async (userId: string) =>
  (
    await db.query<{ decided: boolean; decided_by: string | null }>(
      'SELECT decided_at IS NOT NULL AS decided, decided_by FROM app_user WHERE user_id = $1',
      [userId],
    )
  ).rows[0];

beforeEach(async () => {
  db = new PGlite();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  vi.stubEnv('OPEN_REGISTRATION', 'false');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the row is what authorizes, on every request', () => {
  // THE ADMITTING CASE COMES FIRST. Every refusal below is green against a gate that refuses
  // everything, and against a schema that never loaded.
  it('admits an active row and hands back the role the ROW carries', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'super_admin'));
    const gate = await authorize(db, token());
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'super_admin' } });
  });

  // `cognito:groups` IS NOT THE AUTHORIZATION SOURCE. Group membership is stamped into a token
  // at issue time, so removing somebody from a group would not take effect until the token
  // refreshed — at any lifetime, since a shorter one shortens the wait without removing it. The
  // claim is present and says super-admin; the row says `user`; the row wins.
  it('ignores a cognito:groups claim that disagrees with the row', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'user'));
    const gate = await authorize(db, token({ 'cognito:groups': ['super_admin'] }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
    expect(superAdminOnly(gate)).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
  });

  // THE SAME FOLD THE ADDRESS GETS, and for the same reason one step along: the row's `user_id`
  // comes back from a `uuid` column and is canonical, and `answer()` compares it with `===`. A
  // `sub` left in the case it arrived would be FOUND by the cluster and then refused by the
  // comparison — which reads as somebody else holding this address, the loudest refusal here.
  it('admits a caller whose sub claim arrived in capitals', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const gate = await authorize(db, token({ sub: SUB.toUpperCase() }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
  });

  it('names the string nowhere in its own source', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'authorize.ts'),
      'utf8',
    );
    // The comment explaining why may name it; a `claims[...]` read may not. Asserted on the
    // subscript rather than the word, so the reason can stay written down.
    expect(source).not.toMatch(/claims\s*(\[|\.)\s*['"]?cognito:groups/);
  });
});

describe('three refusals, and they are three', () => {
  const body = (gate: Gate) => ('refusal' in gate ? gate.refusal.body : undefined);

  it('answers a pending caller without a 401 — they are signed in and may not act yet', async () => {
    await db.exec(row(SUB, EMAIL, 'pending'));
    const gate = await authorize(db, token());
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
    expect(body(gate)).toContain('pending');
  });

  it('refuses a rejected caller', async () => {
    await db.exec(row(SUB, EMAIL, 'rejected'));
    expect(body(await authorize(db, token()))).toContain('rejected');
  });

  it('refuses a caller with no row while registration is closed, and writes none', async () => {
    const gate = await authorize(db, token());
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
    expect(await rows()).toEqual([]);
  });

  // THE DISTINCTNESS IS THE CRITERION, not each body on its own. Three cases answering the same
  // bytes would satisfy every assertion above and tell a client nothing.
  it('gives each of the three a different answer, and none of them is 401', async () => {
    const answers: string[] = [];
    answers.push(body(await authorize(db, token())) as string);
    await db.exec(row(SUB, EMAIL, 'pending'));
    answers.push(body(await authorize(db, token())) as string);
    await db.exec(`UPDATE app_user SET status = 'rejected', decided_at = now(),
                                       decided_by = '${SUB}' WHERE user_id = '${SUB}';`);
    answers.push(body(await authorize(db, token())) as string);

    expect(new Set(answers).size).toBe(3);
  });

  // NOT A 401, ASSERTED ON THE ANSWERS THEMSELVES. A 401 says "you are not signed in", which is
  // false of all three and sends whoever reads it back through a sign-in that succeeds and
  // changes nothing.
  it('answers none of the three with a 401', async () => {
    const codes: number[] = [];
    const code = (gate: Gate) => ('refusal' in gate ? gate.refusal.statusCode : 200);
    codes.push(code(await authorize(db, token())));
    await db.exec(row(SUB, EMAIL, 'pending'));
    codes.push(code(await authorize(db, token())));
    await db.exec(`UPDATE app_user SET status = 'rejected', decided_at = now(),
                                       decided_by = '${SUB}' WHERE user_id = '${SUB}';`);
    codes.push(code(await authorize(db, token())));
    expect(codes).toEqual([403, 403, 403]);
  });

  // THE MOST SECURITY-RELEVANT BRANCH IN THE FILE, and it was the one case the suite did not
  // construct: an ACTIVE row holding this address under somebody else's id. It should not exist
  // — approval keys the row by the sub the create call returned, and the pool refuses a
  // duplicate address and its case variant — but if it ever did, returning the caller would hand
  // one person's portfolio to another. Asserted so that deleting the check fails a test.
  it('refuses an active row that holds this address under another id', async () => {
    await db.exec(row(OTHER, EMAIL, 'active'));
    const gate = await authorize(db, token());
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
    expect((gate as { refusal: { body: string } }).refusal.body).not.toContain('pending');
  });

  it('refuses the demo identity, which is not an application at all', async () => {
    await db.exec(row(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo'));
    const gate = await authorize(db, token({ sub: DEMO_USER_ID, email: DEMO_USER_EMAIL }));
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
  });
});

describe('open registration is the only thing that writes a row here', () => {
  it('gives a valid token with no row one, active, keyed by its own sub', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    const gate = await authorize(db, token());
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
    expect(await rows()).toEqual([{ user_id: SUB, email: EMAIL, status: 'active', role: 'user' }]);
    // SELF-DECIDED, and it is the only truthful shape available: `app_user_decided_ck` exempts
    // `role = 'demo'` alone, so an active row MUST carry both halves, and nobody ruled on this
    // one — the deploy that opened registration did. The bootstrap's own argument.
    expect(await pair(SUB)).toEqual({ decided: true, decided_by: SUB });
  });

  it('writes one row however many times that caller returns', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token());
    await authorize(db, token());
    expect(await rows()).toHaveLength(1);
  });

  it('lower-cases the address it takes from the token', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token({ email: 'Applicant@Quirenote.COM' }));
    expect((await rows()).map((r) => r.email)).toEqual([EMAIL]);
  });

  // THE ADDRESS IS ALREADY CLAIMED, which is reachable rather than exotic: someone applies, the
  // window opens, and they sign up. `app_user_email_uq` would refuse the insert, so the gate
  // answers with THAT ROW'S status instead — which keeps the approval queue in charge. An open
  // window may not launder a decided application into access, and the super-admin's approve
  // still repairs the pair: `AdminCreateUser` answers `UsernameExistsException`, `AdminGetUser`
  // returns this very sub, and the row is swapped onto it.
  it('answers a pending application under another id with pending, and writes nothing', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await db.exec(row(OTHER, EMAIL, 'pending'));
    const gate = await authorize(db, token());
    expect((gate as { refusal: { body: string } }).refusal.body).toContain('pending');
    expect(await rows()).toHaveLength(1);
  });

  it('will not let an open window overturn a rejection', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await db.exec(row(OTHER, EMAIL, 'rejected'));
    const gate = await authorize(db, token());
    expect((gate as { refusal: { body: string } }).refusal.body).toContain('rejected');
    expect(await rows()).toHaveLength(1);
  });

  // THE SAME QUESTION `pre-signup.ts` ASKS BEFORE IT LINKS, asked again of the claim. An open
  // window plus a provider that never checked the mailbox would otherwise buy a row for an
  // address its holder does not own — and the real owner's later application is then absorbed by
  // `app_user_email_uq` and answered 202 for somebody else's row.
  for (const value of ['false', '', 'True', 'yes']) {
    it(`writes no row when email_verified is ${JSON.stringify(value)}`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', 'true');
      const gate = await authorize(db, token({ email_verified: value }));
      expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
      expect(await rows()).toEqual([]);
    });
  }

  // AND IT IS ASKED ONLY OF A ROW THAT DOES NOT EXIST YET. A row already decided by a
  // super-admin is not re-litigated here; a pool that later stopped asserting the claim would
  // otherwise lock out everybody who already had one.
  it('does not re-ask it of a caller who already has a row', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const gate = await authorize(db, token({ email_verified: 'false' }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
  });

  // UNSET AND EVERY OTHER VALUE MEAN CLOSED, the rule `pre-signup.ts` already holds: an
  // environment variable arrives as text and `Boolean('false')` is `true`.
  for (const value of ['', 'false', 'open', 'yes', '1']) {
    it(`writes nothing when OPEN_REGISTRATION is ${JSON.stringify(value)}`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', value);
      await authorize(db, token());
      expect(await rows()).toEqual([]);
    });
  }
});

describe('a token this gate cannot read never reaches the cluster', () => {
  const unreadable: [string, ApiEvent][] = [
    ['no authorizer on the event at all', {}],
    ['no claims', { requestContext: { authorizer: { jwt: {} } } }],
    ['an access token rather than an id token', token({ token_use: 'access' })],
    ['no sub', token({ sub: '' })],
    ['a sub that is not a uuid', token({ sub: 'not-a-uuid' })],
    ['no email', token({ email: '' })],
    ['an address the schema could not store', token({ email: 'İREN@quirenote.com' })],
  ];

  for (const [what, event] of unreadable) {
    it(`refuses ${what} without asking the cluster anything`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', 'true');
      const { client, asked } = spy();
      const gate = await authorize(client, event);
      expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
      expect(asked).toEqual([]);
    });
  }
});
