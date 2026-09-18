// The row must be EXACTLY what `003` and `006` accept, and the response must say NOTHING
// about who has already applied. PGlite for the first, so a non-canonical address is refused
// by the real constraint; an injected double for the second, since every assertion is about
// the calls.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  ROUTE,
  RESPONSES,
  applications as applicationsRoute,
  handler as rawHandler,
} from './applications';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

// `005` is DML — the demo row — and would sit underneath every count below. `DDL` is derived
// from `MIGRATIONS` so a new schema file cannot be forgotten here.
const DML = '005_demo_user.sql';
const DDL = MIGRATIONS.filter((f) => f !== DML);
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const { observed, record } = recorder(ROUTE);

const applications = async (
  ...args: Parameters<typeof applicationsRoute>
): ReturnType<typeof applicationsRoute> => record(args[1], await applicationsRoute(...args));

const handler = async (...args: Parameters<typeof rawHandler>): ReturnType<typeof rawHandler> =>
  record(args[0], await rawHandler(...args));

const raw = (body?: string): ApiEvent => ({ body, isBase64Encoded: false });
const submit = (email: unknown): ApiEvent => raw(JSON.stringify({ email }));

/** Records what the handler asked the cluster for, and answers nothing back. */
const spy = (thrown?: Error) => {
  const asked: { text: string; values?: unknown[] }[] = [];
  const client: SqlClient = {
    query: async <R>(text: string, values?: unknown[]) => {
      asked.push({ text, values });
      if (thrown !== undefined) throw thrown;
      return { rows: [] as R[] };
    },
  };
  return { client, asked };
};

let db: PGlite;

const rows = async () =>
  (
    await db.query<{ email: string; status: string; role: string }>(
      'SELECT email, status, role FROM app_user ORDER BY email',
    )
  ).rows;

describe('a submission writes one pending row', () => {
  beforeEach(async () => {
    db = new PGlite();
    for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
      await db.exec(stmt).catch((e: Error) => {
        throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
      });
    }
  });

  // The accepting twin first: every refusal below is green against a handler refusing everything.
  it('leaves exactly one row, pending, for an address with none', async () => {
    const res = await applications(db, submit('new@quirenote.com'));
    expect(res.statusCode).toBe(202);
    expect(await rows()).toEqual([{ email: 'new@quirenote.com', status: 'pending', role: 'user' }]);
  });

  // The pool canonicalises nothing and this row precedes any identity, so nothing upstream folds.
  it('writes the address lower-cased', async () => {
    await applications(db, submit('NEW@Quirenote.COM'));
    expect((await rows()).map((r) => r.email)).toEqual(['new@quirenote.com']);
  });

  // A repeat must answer the first response byte for byte: any difference — a 409, another
  // body, another shape — makes this route a directory of who has applied, readable by anyone.
  it('answers a repeat in another case with the first response, byte for byte', async () => {
    const first = await applications(db, submit('new@quirenote.com'));
    const again = await applications(db, submit('New@QUIRENOTE.com'));
    // The BYTES, not just `toEqual` — both are the same frozen singleton, so a structural match
    // alone would stay green if the constant itself started naming the row.
    expect([again.statusCode, again.body]).toEqual([first.statusCode, first.body]);
    expect(again.body).toBe('{"status":"received"}');
    expect(await rows()).toHaveLength(1);
  });

  // `ON CONFLICT` inferring a SECONDARY unique index is unmeasured on DSQL. If it does not,
  // the duplicate returns `23505` naming `app_user_email_uq`, and the repeat must still answer
  // what the first submission answered.
  it('answers the same when the duplicate arrives as a constraint violation instead', async () => {
    const duplicate = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'app_user_email_uq',
    });
    const { client } = spy(duplicate);
    const res = await applications(client, submit('new@quirenote.com'));
    expect([res.statusCode, res.body]).toEqual([202, '{"status":"received"}']);
  });

  // A `23505` from elsewhere is still a failure — hence reading the constraint name, not the code.
  it('does not mistake another unique violation for a duplicate address', async () => {
    const elsewhere = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'app_user_user_id_pk',
    });
    const { client } = spy(elsewhere);
    const res = await applications(client, submit('new@quirenote.com'));
    expect(res.statusCode).toBe(500);
  });

  it('reads a base64-encoded body', async () => {
    const body = Buffer.from('{"email":"New@quirenote.com"}').toString('base64');
    const res = await applications(db, { body, isBase64Encoded: true });
    expect(res.statusCode).toBe(202);
    expect((await rows()).map((r) => r.email)).toEqual(['new@quirenote.com']);
  });

  // Nothing here may mint a second role; `app_user_role_ck` is what would refuse it.
  it('applies as an ordinary user, never as anything else', async () => {
    await applications(db, submit('new@quirenote.com'));
    expect((await rows()).map((r) => r.role)).toEqual(['user']);
  });
});

describe('an address the cluster would refuse never reaches it', () => {
  // ASCII-only is the case rule, not tidiness: `006` refuses any row where
  // `email <> lower(email)`, and Postgres `lower()` and JavaScript `toLowerCase()` disagree
  // outside ASCII — `'İ'` folds to two codepoints in one and one in the other. A handler that
  // folded and trusted itself would hand the cluster a row it refuses.
  const refused = [
    'İREN@quirenote.com',
    'ольга@quirenote.com',
    'no-at-sign',
    '',
    'two@@quirenote.com',
    'trailing@quirenote.com.',
    'spaced address@quirenote.com',
    `${'a'.repeat(250)}@quirenote.com`,
  ];

  for (const bad of refused) {
    it(`refuses ${JSON.stringify(bad)} without asking the cluster anything`, async () => {
      const { client, asked } = spy();
      const res = await applications(client, submit(bad));
      expect(res.statusCode).toBe(400);
      expect(asked).toEqual([]);
    });
  }

  const malformed: [string, string | undefined][] = [
    ['no body at all', undefined],
    ['a body that is not JSON', 'email=new@quirenote.com'],
    ['a JSON array', '[]'],
    ['a JSON string', '"new@quirenote.com"'],
    ['an object with no email', '{"address":"new@quirenote.com"}'],
    ['an email that is not a string', '{"email":42}'],
  ];

  for (const [what, body] of malformed) {
    it(`refuses ${what} without asking the cluster anything`, async () => {
      const { client, asked } = spy();
      const res = await applications(client, raw(body));
      expect(res.statusCode).toBe(400);
      expect(asked).toEqual([]);
    });
  }

  // The cluster's refusal is not repeated back: a constraint name describes the schema, and
  // this route stands outside the authorizer — the three surfaces that do are in *Auth model*.
  it('returns a fixed error when the cluster refuses, naming no constraint', async () => {
    const refusal = Object.assign(
      new Error('new row violates check constraint "app_user_email_lower_ck"'),
      { code: '23514', constraint: 'app_user_email_lower_ck' },
    );
    const { client } = spy(refusal);
    const res = await applications(client, submit('new@quirenote.com'));
    expect(res.statusCode).toBe(500);
    const answered = JSON.stringify(res);
    expect(answered).not.toContain('app_user');
    expect(answered).not.toContain('constraint');
  });
});

describe('a submission costs one parameterised statement and no mail', () => {
  it('asks the cluster once, binding the address rather than interpolating it', async () => {
    const { client, asked } = spy();
    await applications(client, submit('New@quirenote.com'));
    expect(asked).toHaveLength(1);
    expect(asked[0].values).toEqual(['new@quirenote.com']);
    expect(asked[0].text).toContain('$1');
    expect(asked[0].text.toLowerCase()).not.toContain('quirenote.com');
  });

  // The gate is in `handler`, and this is the test that can tell: `connect()` cannot succeed
  // here, so a 400 proves the connection was never attempted and a malformed body costs no
  // token mint on the one route a stranger can reach.
  it('refuses a malformed body without reaching for a connection', async () => {
    await expect(handler(raw('not json at all'))).resolves.toMatchObject({ statusCode: 400 });
  });

  // Mailing on submission would let anyone type a stranger's address and have this domain
  // deliver to it; the invitation belongs to approval. Asserted on the source, since a client
  // that is never constructed cannot be observed not calling anything.
  it('constructs no mail client and imports no mail SDK', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'applications.ts'),
      'utf8',
    );
    const forbidden = ['client-ses', 'SESClient', 'SendEmail', 'sendMail', 'nodemailer'];
    for (const name of forbidden) expect([name, source.includes(name)]).toEqual([name, false]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 10 });
