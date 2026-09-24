// The assertions are about WHICH refusal: a caller signed in who may not act yet is not a 401,
// so a suite that only checked "refused" would pass against a handler answering 401 to all three.
// PGlite applies the migrations the runner names, because `app_user_decided_ck` refuses a
// self-approved row with half a decision pair and an assertion written here could not.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { type Gate, authorize, superAdminOnly } from './authorize';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';

// The two DML files — the demo row and the account it owns — would sit underneath every count
// below. Named, with `DDL` derived from `MIGRATIONS` so a new schema file cannot be forgotten here,
// exactly as its neighbours derive it.
const DML = ['005_demo_user.sql', '008_demo_account.sql'];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000a1';
const OTHER = '9f1e2d3c-0000-4000-8000-0000000000b2';
const EMAIL = 'applicant@quirenote.com';

/**
 * An ID TOKEN's claims, which is what this API takes. `token_use` is stamped by Cognito and is the
 * only thing telling an id token from an access token; an access token carries no `email` at all.
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

const accounts = async () =>
  (
    await db.query<{ user_id: string; provider: string; name: string }>(
      'SELECT user_id, provider, name FROM account',
    )
  ).rows;

/** The real cluster, except that one statement fails — so a failure lands mid-transaction. */
const failingOn = (needle: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes(needle)) throw new Error('the cluster said no');
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

const pair = async (userId: string) =>
  (
    await db.query<{ decided: boolean; decided_by: string | null }>(
      'SELECT decided_at IS NOT NULL AS decided, decided_by FROM app_user WHERE user_id = $1',
      [userId],
    )
  ).rows[0];

beforeEach(async () => {
  db = await freshDb();
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

/** `authorize.ts` is read through this, so the comment explaining the rule may quote the very read
 *  it forbids. LINE BY LINE, and the line boundary is the point: a regex literal may hold a
 *  quote, and one desync would switch stripping off for the rest of the file.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// never claims['cognito:groups']` in `authorize.ts` leaves
 *  this green and turns the reader it replaces red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

describe('the row is what authorizes, on every request', () => {
  it('admits an active row and hands back the role the ROW carries', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'super_admin'));
    const gate = await authorize(db, token());
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'super_admin' } });
  });

  // `cognito:groups` is not the authorization source: a group is stamped into a token at issue
  // time, so a removal would not take effect until the token refreshed. The row wins.
  it('ignores a cognito:groups claim that disagrees with the row', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'user'));
    const gate = await authorize(db, token({ 'cognito:groups': ['super_admin'] }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
    expect(superAdminOnly(gate)).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
  });

  // The row's `user_id` is canonical and `answer()` compares with `===`, so the fold happens here.
  it('admits a caller whose sub claim arrived in capitals', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const gate = await authorize(db, token({ sub: SUB.toUpperCase() }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
  });

  it('names the string nowhere in its own source', () => {
    const source = stripTs(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'authorize.ts'), 'utf8'),
    );
    // Asserted on the subscript rather than the word, and on the stripped text, so the reason may
    // stay written down: a comment may quote even the read, and a string may name the claim; the
    // subscript itself, anywhere outside a comment, fails.
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

  // The distinctness is the criterion: three cases answering the same bytes tell a client nothing.
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

  // An active row holding this address under another id would hand one portfolio to another.
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
    // Self-decided, the only truthful shape `app_user_decided_ck` leaves open: it exempts
    // `role = 'demo'` alone, so an active row must carry both halves and the deploy is what ruled.
    expect(await pair(SUB)).toEqual({ decided: true, decided_by: SUB });
  });

  it('writes one row however many times that caller returns', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token());
    await authorize(db, token());
    expect(await rows()).toHaveLength(1);
  });

  // THE ROW IS NOT USABLE WITHOUT IT: `transaction.account_id` is NOT NULL against a composite
  // key, so a caller admitted here with no account is one who cannot write anything.
  it('gives the row it writes an account, in the same write', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token());
    expect(await accounts()).toEqual([{ user_id: SUB, provider: 'inzhur', name: 'Inzhur' }]);
  });

  it('writes one account however many times that caller returns', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token());
    await authorize(db, token());
    expect(await accounts()).toHaveLength(1);
  });

  // NEITHER, OR THE GATE WOULD ADMIT SOMEBODY IT CANNOT SERVE. The row is what authorizes, so a
  // user row that landed alone is a caller the gate lets through and the mutation surface refuses.
  it('leaves neither row behind when the account insert fails', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    const gate = await authorize(failingOn('INSERT INTO account'), token());
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 500 }) });
    expect(await rows()).toEqual([]);
    expect(await accounts()).toEqual([]);
  });

  it('lower-cases the address it takes from the token', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token({ email: 'Applicant@Quirenote.COM' }));
    expect((await rows()).map((r) => r.email)).toEqual([EMAIL]);
  });

  // An open window may not launder a decided application into access: `app_user_email_uq` would
  // refuse the insert, so the gate answers with that row's status and the queue stays in charge.
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

  // A provider that never checked the mailbox would buy a row for an address its holder does not own.
  for (const value of ['false', '', 'True', 'yes']) {
    it(`writes no row when email_verified is ${JSON.stringify(value)}`, async () => {
      vi.stubEnv('OPEN_REGISTRATION', 'true');
      const gate = await authorize(db, token({ email_verified: value }));
      expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
      expect(await rows()).toEqual([]);
    });
  }

  // Only of a row that does not exist yet — otherwise a changed pool locks out everybody who has one.
  it('does not re-ask it of a caller who already has a row', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const gate = await authorize(db, token({ email_verified: 'false' }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user' } });
  });

  // Every other value means closed: the variable arrives as text and `Boolean('false')` is `true`.
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
