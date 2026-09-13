// The first HTTP handler in this repository, and the row it writes is the one the
// approval gate later rules on. Two things are worth a test and they pull opposite ways:
// the row must be EXACTLY what `003` and `006` accept, and the response must say NOTHING
// about who has already applied.
//
// PGlite for the first, applying the migrations the runner names the way
// `user-schema.test.ts` applies them — so a handler that ever produced a non-canonical
// address is refused by the real constraint rather than by an assertion written here. An
// injected double for the second, in the shape `pre-signup.test.ts` uses: every assertion
// is about the calls, so the calls are what the double keeps.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { type ApiEvent, applications, handler } from './applications';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';

// `005` is DML — the demo row — and it would sit underneath every count below. `DDL` is
// derived from `MIGRATIONS` so a new schema file cannot be forgotten here, exactly as
// `user-schema.test.ts` derives it.
const DML = '005_demo_user.sql';
const DDL = MIGRATIONS.filter((f) => f !== DML);
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

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
  // SCOPED TO THE BLOCK THAT USES IT. At file scope this booted a fresh PGlite and applied
  // every DDL statement for all 20-odd tests, including the ones whose whole point is that
  // the cluster is never asked anything.
  beforeEach(async () => {
    db = new PGlite();
    for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
      await db.exec(stmt).catch((e: Error) => {
        throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
      });
    }
  });

  // THE ACCEPTING TWIN COMES FIRST. Every refusal further down is green against a handler
  // that refuses everything, and against a schema that never loaded.
  it('leaves exactly one row, pending, for an address with none', async () => {
    const res = await applications(db, submit('new@quirenote.com'));
    expect(res.statusCode).toBe(202);
    expect(await rows()).toEqual([{ email: 'new@quirenote.com', status: 'pending', role: 'user' }]);
  });

  // THE POOL CANONICALISES NOTHING and this row is written before any identity exists, so
  // nothing upstream will do it. The assertion is against a database carrying `006`: were
  // the handler to skip the fold, the insert would be refused rather than merely wrong.
  it('writes the address lower-cased', async () => {
    await applications(db, submit('NEW@Quirenote.COM'));
    expect((await rows()).map((r) => r.email)).toEqual(['new@quirenote.com']);
  });

  // ONE MAILBOX, ONE ROW, AND THE SECOND ANSWER IS THE FIRST ONE'S BYTES.
  // `app_user_email_uq` is byte-exact, so it is the fold above that makes two spellings
  // collide at all, and `ON CONFLICT` is what makes the collision quiet. An answer that
  // differed on the repeat — a 409, another body, another shape — would make this route a
  // directory of who has already applied, readable by anyone.
  it('answers a repeat in another case with the first response, byte for byte', async () => {
    const first = await applications(db, submit('new@quirenote.com'));
    const again = await applications(db, submit('New@QUIRENOTE.com'));
    // The BYTES, spelled out, not just `toEqual` — the two are the same frozen singleton,
    // so a structural comparison is true of any pair of answers this module ever returns
    // and would stay green if the constant itself started naming the row.
    expect([again.statusCode, again.body]).toEqual([first.statusCode, first.body]);
    expect(again.body).toBe('{"status":"received"}');
    expect(await rows()).toHaveLength(1);
  });

  // THE OTHER WAY A DUPLICATE CAN ARRIVE. `dsql-constraints.md` measured `ON CONFLICT`
  // absorbing a conflict on the PRIMARY KEY; this statement asks the cluster to infer a
  // secondary unique index, which nothing has measured. If it does not, the duplicate
  // comes back as `23505` naming `app_user_email_uq` — and the repeat must still answer
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

  // AND A `23505` FROM ANYWHERE ELSE IS STILL A FAILURE, which is the whole reason the
  // branch above reads the constraint name rather than the code. `migrate.ts` refuses to
  // branch on a bare `23505` for exactly this reason.
  it('does not mistake another unique violation for a duplicate address', async () => {
    const elsewhere = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'app_user_user_id_pk',
    });
    const { client } = spy(elsewhere);
    const res = await applications(client, submit('new@quirenote.com'));
    expect(res.statusCode).toBe(500);
  });

  // API Gateway sets this flag whenever it does not treat the content type as text, so the
  // decode is on the ordinary path rather than an exotic one.
  it('reads a base64-encoded body', async () => {
    const body = Buffer.from('{"email":"New@quirenote.com"}').toString('base64');
    const res = await applications(db, { body, isBase64Encoded: true });
    expect(res.statusCode).toBe(202);
    expect((await rows()).map((r) => r.email)).toEqual(['new@quirenote.com']);
  });

  // The demo identity is `005`'s and carries the `demo` role; nothing here may mint a
  // second role, and `app_user_role_ck` is what would refuse it.
  it('applies as an ordinary user, never as anything else', async () => {
    await applications(db, submit('new@quirenote.com'));
    expect((await rows()).map((r) => r.role)).toEqual(['user']);
  });
});

describe('an address the cluster would refuse never reaches it', () => {
  // THE CASE RULE IS WHY THIS IS ASCII-ONLY, not tidiness. `006` refuses any row where
  // `email <> lower(email)`, and Postgres `lower()` and JavaScript `toLowerCase()` do not
  // agree outside ASCII — `'İ'` folds to two codepoints in one of them and one in the
  // other. A handler that folded and trusted itself would hand the cluster a row it
  // refuses and the caller would read a constraint name back. Narrowing the input is what
  // makes the two agree by construction rather than by hope.
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

  // AND SHOULD ONE EVER GET PAST THE RULE ABOVE, THE CLUSTER'S REFUSAL IS NOT REPEATED
  // BACK. A constraint name describes the schema, and this route stands outside the
  // authorizer — the three surfaces that do are named in `docs/DECISIONS.md`, **Auth
  // model**.
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

  // THE GATE IS IN `handler`, NOT ONLY IN `applications`, and this is the test that can
  // tell. `connect()` needs `DSQL_ENDPOINT` and an AWS credential chain, so it cannot
  // succeed here — which is exactly what makes the assertion meaningful: a 400 coming back
  // proves the connection was never attempted. Validated on the far side of `connect()`
  // this would throw, and every malformed body would cost an IAM token mint, a TLS
  // handshake and a concurrency slot on the one route a stranger can reach.
  it('refuses a malformed body without reaching for a connection', async () => {
    await expect(handler(raw('not json at all'))).resolves.toMatchObject({ statusCode: 400 });
  });

  // NO MAIL ON SUBMISSION, and it is not a policy note: mailing an address on submission
  // would let anyone type a stranger's address and have this domain deliver to it. The
  // invitation belongs to APPROVAL (#44), which is also what makes approval the
  // verification step. Asserted on the source, because a client that is never constructed
  // cannot be observed not calling anything.
  it('constructs no mail client and imports no mail SDK', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'applications.ts'),
      'utf8',
    );
    const forbidden = ['client-ses', 'SESClient', 'SendEmail', 'sendMail', 'nodemailer'];
    for (const name of forbidden) expect([name, source.includes(name)]).toEqual([name, false]);
  });
});
