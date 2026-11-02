// The assertions are about WHICH refusal: a caller signed in who may not act yet is not a 401,
// so a suite that only checked "refused" would pass against a handler answering 401 to all three.
// PGlite applies the migrations the runner names, because `app_user_decided_ck` refuses a
// self-approved row with half a decision pair and an assertion written here could not.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { TERMS_VERSION } from '@quirenote/core/terms';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UserNotFoundException } from '@aws-sdk/client-cognito-identity-provider';

import { ADDRESS, watchConsole } from './__fixtures__/console';
import { freshDb } from './__fixtures__/pglite';
import {
  FORBIDDEN,
  type Gate,
  NO_APPLICATION,
  TERMS,
  authorize,
  superAdminOnly,
} from './authorize';
import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { ApiEvent } from './http';
import { provision } from './provision';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';

// The DML files are excluded: the demo row and its account would sit under every count below, and
// the backfill is DML too. Named, with `DDL` derived from `MIGRATIONS` so a new schema file cannot be forgotten here,
// exactly as its neighbours derive it.
const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const SUB = '9f1e2d3c-0000-4000-8000-0000000000a1';
const OTHER = '9f1e2d3c-0000-4000-8000-0000000000b2';
const EMAIL = 'applicant@quirenote.com';
const POOL = 'eu-north-1_EXAMPLE';

/** What the gate asked the pool, and what the pool answers next: a user under the username whose
 *  `sub` is SUB unless a test queues otherwise. Nothing reaches AWS. */
const pool = vi.hoisted(() => ({
  asked: [] as unknown[],
  answers: [] as (unknown | Error)[],
}));
vi.mock('@aws-sdk/client-cognito-identity-provider', async (actual) => {
  const real = await actual<typeof import('@aws-sdk/client-cognito-identity-provider')>();
  return {
    ...real,
    CognitoIdentityProviderClient: vi.fn(function () {
      return {
        send: async (command: { input: unknown }) => {
          pool.asked.push(command.input);
          const answer = pool.answers.length > 0 ? pool.answers.shift() : held(SUB);
          if (answer instanceof Error) throw answer;
          return answer;
        },
      };
    }),
  };
});
const held = (sub: string) => ({ UserAttributes: [{ Name: 'sub', Value: sub }] });
const gone = () => new UserNotFoundException({ message: 'User does not exist.', $metadata: {} });

/**
 * An ID TOKEN's claims, which is what this API takes. `token_use` is stamped by Cognito and is the
 * only thing telling an id token from an access token; an access token carries no `email` at all.
 */
const token = (claims: Record<string, string | string[]> = {}): ApiEvent => ({
  requestContext: {
    authorizer: {
      jwt: {
        claims: {
          token_use: 'id',
          sub: SUB,
          'cognito:username': SUB,
          email: EMAIL,
          email_verified: 'true',
          ...claims,
        },
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

/** An active row holds the terms unless `accepted` says otherwise: the case every other test is
 *  about is a caller the terms do not stop. */
const row = (userId: string, email: string, status: string, role = 'user', accepted = true) =>
  status === 'pending'
    ? `INSERT INTO app_user (user_id, email, status, role, applied_at)
         VALUES ('${userId}', '${email}', 'pending', '${role}', now());`
    : `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by,
                             terms_version, terms_accepted_at)
         VALUES ('${userId}', '${email}', '${status}', '${role}', now(), now(), '${userId}',
                 ${accepted ? `'${TERMS_VERSION}', now()` : 'NULL, NULL'});`;

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
  vi.stubEnv('USER_POOL_ID', POOL);
  pool.asked.length = 0;
  pool.answers.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** `authorize.ts` is read through this, so the comment explaining the rule may quote the very read
 *  it forbids.
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

describe('the row is what authorizes, on every request', () => {
  it('admits an active row and hands back the role the ROW carries', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'super_admin'));
    const gate = await authorize(db, token());
    expect(gate).toEqual({
      caller: { userId: SUB, email: EMAIL, role: 'super_admin', settings: null },
    });
  });

  // `cognito:groups` is not the authorization source: a group is stamped into a token at issue
  // time, so a removal would not take effect until the token refreshed. The row wins.
  it('ignores a cognito:groups claim that disagrees with the row', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'user'));
    const gate = await authorize(db, token({ 'cognito:groups': ['super_admin'] }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user', settings: null } });
    expect(superAdminOnly(gate)).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
  });

  // The row's `user_id` is canonical and `answer()` compares with `===`, so the fold happens here.
  it('admits a caller whose sub claim arrived in capitals', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const gate = await authorize(db, token({ sub: SUB.toUpperCase() }));
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user', settings: null } });
  });

  // The settings ride the read the gate already makes (*Persistence today*): one more column on a
  // row already read, never a second statement.
  it('hands back the settings text the row holds byte for byte, and NULL where it holds none', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const text = '{"language":"en","note":"Облігації ₴"}';
    await db.query('UPDATE app_user SET settings = $1 WHERE user_id = $2', [text, SUB]);
    expect(await authorize(db, token())).toEqual({
      caller: { userId: SUB, email: EMAIL, role: 'user', settings: text },
    });
    await db.query('UPDATE app_user SET settings = NULL WHERE user_id = $1', [SUB]);
    expect(await authorize(db, token())).toEqual({
      caller: { userId: SUB, email: EMAIL, role: 'user', settings: null },
    });
  });

  it('reads the settings in the statement that reads the row', async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    const sent: string[] = [];
    const client: SqlClient = {
      query: <R>(text: string, values?: unknown[]) => {
        sent.push(text);
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    await authorize(client, token());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/\bsettings\b/);
  });

  it('names the string nowhere in its own source', () => {
    const source = stripTs(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'authorize.ts'), 'utf8'),
      'authorize.ts',
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
  // LOGGED BY BOTH IDS, which is everything an operator needs to find the two rows, and never by
  // the address (*Deployment*).
  it('refuses an active row that holds this address under another id, logging both ids', async () => {
    await db.exec(row(OTHER, EMAIL, 'active'));
    const watched = watchConsole();
    try {
      const gate = await authorize(db, token());
      expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
      expect((gate as { refusal: { body: string } }).refusal.body).not.toContain('pending');
      const lines = watched.lines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(SUB);
      expect(lines[0]).toContain(OTHER);
      expect(lines[0]).not.toMatch(ADDRESS);
    } finally {
      watched.restore();
    }
  });

  it('refuses the demo identity, which is not an application at all', async () => {
    await db.exec(row(DEMO_USER_ID, DEMO_USER_EMAIL, 'active', 'demo'));
    const gate = await authorize(db, token({ sub: DEMO_USER_ID, email: DEMO_USER_EMAIL }));
    expect(gate).toEqual({ refusal: expect.objectContaining({ statusCode: 403 }) });
  });
});

describe('the terms, asked after every status', () => {
  for (const role of ['user', 'super_admin']) {
    it(`refuses an active ${role} whose row holds no terms version with terms`, async () => {
      await db.exec(row(SUB, EMAIL, 'active', role, false));
      const gate = await authorize(db, token());
      expect(gate).toEqual({ refusal: TERMS });
      expect(TERMS).toEqual(
        expect.objectContaining({ statusCode: 403, body: '{"error":"terms"}' }),
      );
      expect(superAdminOnly(gate)).toEqual({ refusal: TERMS });
    });

    it(`admits an active ${role} whose row holds a version`, async () => {
      await db.exec(row(SUB, EMAIL, 'active', role));
      expect(await authorize(db, token())).toEqual({
        caller: { userId: SUB, email: EMAIL, role, settings: null },
      });
    });
  }

  // A pending applicant never meets the step: the terms would apply before any approval.
  it('keeps pending, rejected and no-application ahead of terms', async () => {
    const said = async () => (await authorize(db, token())) as { refusal: { body: string } };
    expect((await said()).refusal.body).toBe('{"error":"no_application"}');
    await db.exec(row(SUB, EMAIL, 'pending'));
    expect((await said()).refusal.body).toBe('{"error":"pending"}');
    await db.exec(`UPDATE app_user SET status = 'rejected', decided_at = now(),
                                       decided_by = '${SUB}' WHERE user_id = '${SUB}';`);
    expect((await said()).refusal.body).toBe('{"error":"rejected"}');
  });

  it('keeps the address held under another id ahead of terms', async () => {
    await db.exec(row(OTHER, EMAIL, 'active', 'user', false));
    const watched = watchConsole();
    try {
      expect(await authorize(db, token())).toEqual({
        refusal: expect.objectContaining({ body: '{"error":"forbidden"}' }),
      });
    } finally {
      watched.restore();
    }
  });

  // The one route that records the acceptance is the one a caller with none may reach.
  it('admits a caller with no version when the route asks for no terms', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'user', false));
    expect(await authorize(db, token(), { terms: 'optional' })).toEqual({
      caller: { userId: SUB, email: EMAIL, role: 'user', settings: null },
    });
  });

  it('still answers every status first when the route asks for no terms', async () => {
    await db.exec(row(SUB, EMAIL, 'pending'));
    const gate = await authorize(db, token(), { terms: 'optional' });
    expect((gate as { refusal: { body: string } }).refusal.body).toBe('{"error":"pending"}');
  });

  it('reads the terms in the statement that reads the row', async () => {
    await db.exec(row(SUB, EMAIL, 'active', 'user', false));
    const sent: string[] = [];
    const client: SqlClient = {
      query: <R>(text: string, values?: unknown[]) => {
        sent.push(text);
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    await authorize(client, token());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/\bterms_version\b/);
  });
});

// A SCHEDULED DELETION HOLDS THE ACCOUNT (#576): the gate refuses it on every route before any
// read, with the date, and only a sign-in made after the request may cancel.
describe('a scheduled deletion holds the account', () => {
  const DUE = '2026-11-29';
  /** The request, and the instant every test's clock reads unless it says otherwise. */
  const REQUESTED = Date.UTC(2026, 9, 30, 12, 0, 0);
  const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
  const at = (ms: number) => ({ now: () => ms });
  const signedIn = (ms: number) => token({ auth_time: String(Math.floor(ms / 1000)) });
  const hold = async (userId = SUB) =>
    db.query(
      `UPDATE app_user SET deletion_due = $2, deletion_requested_at = $3 WHERE user_id = $1`,
      [userId, DUE, new Date(REQUESTED).toISOString()],
    );
  const refusal = (gate: Gate) => {
    if (!('refusal' in gate)) throw new Error('admitted');
    return [gate.refusal.statusCode, JSON.parse(gate.refusal.body)];
  };

  beforeEach(async () => {
    await db.exec(row(SUB, EMAIL, 'active'));
    await hold();
  });

  it('refuses a sign-in made before the request with the date, and no cancel', async () => {
    const gate = await authorize(db, signedIn(REQUESTED - 60_000), at(NOW));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('refuses a sign-in made after the request too, and says it may cancel', async () => {
    const gate = await authorize(db, signedIn(REQUESTED + 60_000), at(NOW));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: true }]);
  });

  it('reads a sign-in in the same second as the request as before it', async () => {
    const gate = await authorize(db, signedIn(REQUESTED + 999), at(NOW));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('says no cancel to a token that carries no sign-in time', async () => {
    const gate = await authorize(db, token(), at(NOW));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('admits, on the cancel route alone, a sign-in made after the request', async () => {
    expect(
      await authorize(db, signedIn(REQUESTED + 60_000), { ...at(NOW), held: 'cancel' }),
    ).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user', settings: null } });
  });

  it('refuses the cancel route to a sign-in made before the request', async () => {
    const gate = await authorize(db, signedIn(REQUESTED - 60_000), { ...at(NOW), held: 'cancel' });
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('holds to the last instant of the last day in Kyiv', async () => {
    const last = Date.parse('2026-11-29T21:59:59.999Z');
    const gate = await authorize(db, signedIn(REQUESTED + 60_000), at(last));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: true }]);
  });

  it('answers as deleted once that day has ended, on every route and the cancel one', async () => {
    const after = Date.parse('2026-11-29T22:00:00Z');
    for (const held of [undefined, 'cancel'] as const) {
      const gate = await authorize(db, signedIn(REQUESTED + 60_000), { ...at(after), held });
      expect(gate).toEqual({ refusal: NO_APPLICATION });
    }
  });

  it('is asked before the terms', async () => {
    await db.query('UPDATE app_user SET terms_version = NULL, terms_accepted_at = NULL');
    const gate = await authorize(db, signedIn(REQUESTED - 60_000), at(NOW));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('is asked of a super-admin as of anyone', async () => {
    await db.query("UPDATE app_user SET role = 'super_admin'");
    const gate = superAdminOnly(await authorize(db, signedIn(REQUESTED - 60_000), at(NOW)));
    expect(refusal(gate)).toEqual([403, { error: 'scheduled', date: DUE, cancellable: false }]);
  });

  it('leaves an account no deletion waits on as it was, on the cancel route too', async () => {
    await db.query('UPDATE app_user SET deletion_due = NULL, deletion_requested_at = NULL');
    for (const held of [undefined, 'cancel'] as const) {
      expect(await authorize(db, signedIn(REQUESTED - 60_000), { ...at(NOW), held })).toEqual({
        caller: { userId: SUB, email: EMAIL, role: 'user', settings: null },
      });
    }
  });

  it('reads the hold in the statement that reads the row', async () => {
    const sent: string[] = [];
    const client: SqlClient = {
      query: <R>(text: string, values?: unknown[]) => {
        sent.push(text);
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    await authorize(client, signedIn(REQUESTED - 60_000), at(NOW));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/\bdeletion_due\b/);
  });

  // NO PORTFOLIO READ GAINS A FILTER FOR THE HOLD, the tombstone's objection (*User schema and
  // deletes*): the gate refuses before any read, and only the deletion's own modules name it.
  it('is named in no module but the gate, the deletion route, its core and the purge', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const naming = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
      .filter((f) =>
        /\bdeletion_(due|requested_at)\b/.test(stripTs(readFileSync(join(dir, f), 'utf8'), f)),
      );
    expect(naming.sort()).toEqual(['account-delete.ts', 'authorize.ts', 'deletion.ts', 'purge.ts']);
  });
});

describe('open registration is the only thing that writes a row here', () => {
  // Active, and holding no terms: nobody accepted them at sign-up, so the call that wrote the row
  // is answered with the step, and so is the next.
  it('gives a valid token with no row one, active, keyed by its own sub, and asks for the terms', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    expect(await authorize(db, token())).toEqual({ refusal: TERMS });
    expect(await authorize(db, token())).toEqual({ refusal: TERMS });
    expect(await rows()).toEqual([{ user_id: SUB, email: EMAIL, status: 'active', role: 'user' }]);
    const { rows: terms } = await db.query('SELECT terms_version, terms_accepted_at FROM app_user');
    expect(terms).toEqual([{ terms_version: null, terms_accepted_at: null }]);
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

  // The dataset the caller's rows will live in, written with the account (#390).
  it('gives the row it writes one live dataset', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await authorize(db, token());
    const { rows: sets } = await db.query<{ id: string; live: string }>(
      `SELECT d.id, u.dataset_id AS live
         FROM dataset d JOIN app_user u ON u.user_id = d.user_id WHERE d.user_id = $1`,
      [SUB],
    );
    expect(sets).toHaveLength(1);
    expect(sets[0].live).toBe(sets[0].id);
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
    expect(gate).toEqual({ caller: { userId: SUB, email: EMAIL, role: 'user', settings: null } });
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

// A DELETED ACCOUNT'S ID TOKEN OUTLIVES IT by up to an hour, and Cognito's revocation does not
// reach a token verified by signature and expiry (#577). Provisioning is the one path that writes
// for a token with no row, so it asks the pool, before the write and again after it (CWE-367).
describe('open registration provisions only an identity the pool still holds', () => {
  const datasets = async () => (await db.query('SELECT id FROM dataset')).rows;
  const nothingWritten = async () => {
    expect(await rows()).toEqual([]);
    expect(await accounts()).toEqual([]);
    expect(await datasets()).toEqual([]);
  };
  /** The cluster, recording every statement sent: "writes nothing" is no INSERT at all, which a
   *  write taken back afterwards would not pass. */
  const recording = () => {
    const sent: string[] = [];
    const client: SqlClient = {
      query: <R>(text: string, values?: unknown[]) => {
        sent.push(text);
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    return { client, inserts: () => sent.filter((t) => /^\s*INSERT\b/i.test(t)) };
  };

  it('answers no_application to a token whose identity the pool no longer holds, and writes nothing', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(gone());
    const { client, inserts } = recording();
    expect(await authorize(client, token())).toEqual({ refusal: NO_APPLICATION });
    expect(inserts()).toEqual([]);
    await nothingWritten();
  });

  // A Google profile deleted and signed in again keeps its `google_…` username under a new `sub`.
  it('answers no_application when the username is held under another sub, and writes nothing', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(held(OTHER));
    const { client, inserts } = recording();
    expect(await authorize(client, token())).toEqual({ refusal: NO_APPLICATION });
    expect(inserts()).toEqual([]);
    await nothingWritten();
  });

  it('provisions an identity the pool holds, asking by the pool username before and after the write', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    expect(await authorize(db, token({ 'cognito:username': 'google_1234567890' }))).toEqual({
      refusal: TERMS,
    });
    expect(await rows()).toEqual([{ user_id: SUB, email: EMAIL, status: 'active', role: 'user' }]);
    expect(await accounts()).toHaveLength(1);
    expect(await datasets()).toHaveLength(1);
    expect(pool.asked).toEqual([
      { UserPoolId: POOL, Username: 'google_1234567890' },
      { UserPoolId: POOL, Username: 'google_1234567890' },
    ]);
  });

  // The deletion deleted the identity and ran its second pass between this gate's check and its
  // write; the check after the write is what finds it.
  it('takes back what it wrote when the identity is gone by the time the write lands', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(held(SUB), gone());
    expect(await authorize(db, token())).toEqual({ refusal: NO_APPLICATION });
    await nothingWritten();
  });

  // A declined application's identity is disabled before its row goes and deleted after: a token
  // arriving between the two finds no row and an identity that is off.
  it('answers no_application to an identity the pool holds disabled, and writes nothing', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push({ ...held(SUB), Enabled: false });
    const { client, inserts } = recording();
    expect(await authorize(client, token())).toEqual({ refusal: NO_APPLICATION });
    expect(inserts()).toEqual([]);
    await nothingWritten();
  });

  it('takes back what it wrote when the pool cannot answer the second time, and fails', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(held(SUB), new Error('Rate exceeded'));
    await expect(authorize(db, token())).rejects.toThrow('Rate exceeded');
    await nothingWritten();
  });

  // FAIL-SAFE, WHOEVER WROTE IT: an unanswered recheck cannot tell a new caller from a deleted one,
  // so the row goes even when another request wrote it, and the next request provisions it again.
  it('takes back a row another request wrote when the pool cannot answer the second time', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(held(SUB), new Error('Rate exceeded'));
    let first = true;
    const racing: SqlClient = {
      query: async <R>(text: string, values?: unknown[]) => {
        if (first && text === 'BEGIN') {
          first = false;
          await db.exec(row(SUB, EMAIL, 'active'));
          await provision(db, SUB, async () => undefined);
        }
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    await expect(authorize(racing, token())).rejects.toThrow('Rate exceeded');
    await nothingWritten();
    expect(await authorize(db, token())).toEqual({ refusal: TERMS });
    expect(await accounts()).toHaveLength(1);
  });

  // The pool's failure is the one an operator needs; the take-back's own is logged beside it.
  it('reports the pool failure, not a take-back that failed after it', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(held(SUB), new Error('Rate exceeded'));
    const watched = watchConsole();
    try {
      await expect(authorize(failingOn('DELETE FROM user_price'), token())).rejects.toThrow(
        'Rate exceeded',
      );
      expect(watched.lines()).toEqual([expect.stringContaining('could not take back')]);
    } finally {
      watched.restore();
    }
  });

  it('answers internal and writes nothing on a function not told its pool', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    vi.stubEnv('USER_POOL_ID', '');
    const watched = watchConsole();
    try {
      expect(await authorize(db, token())).toEqual({
        refusal: expect.objectContaining({ statusCode: 500 }),
      });
      expect(watched.lines()).toEqual([expect.stringContaining('USER_POOL_ID is not set')]);
    } finally {
      watched.restore();
    }
    expect(pool.asked).toEqual([]);
    await nothingWritten();
  });

  it('writes nothing when the pool cannot answer, and does not take its failure for an answer', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    pool.answers.push(new Error('Rate exceeded'));
    await expect(authorize(db, token())).rejects.toThrow('Rate exceeded');
    await nothingWritten();
  });

  it('refuses a token with no pool username without asking the pool', async () => {
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    expect(await authorize(db, token({ 'cognito:username': '' }))).toEqual({
      refusal: FORBIDDEN,
    });
    expect(pool.asked).toEqual([]);
    await nothingWritten();
  });

  it('asks the pool nothing while registration is closed, or of a caller who has a row', async () => {
    await authorize(db, token());
    vi.stubEnv('OPEN_REGISTRATION', 'true');
    await db.exec(row(SUB, EMAIL, 'active'));
    await authorize(db, token());
    expect(pool.asked).toEqual([]);
  });
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
