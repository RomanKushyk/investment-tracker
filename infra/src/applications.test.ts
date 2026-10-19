// The row must be EXACTLY what `003` and `006` accept, and the response must say NOTHING
// about who has already applied. PGlite for the first, so a non-canonical address is refused
// by the real constraint; an injected double for the second, since every assertion is about
// the calls.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADDRESS, watchConsole } from './__fixtures__/console';
import { freshDb } from './__fixtures__/pglite';
import {
  ROUTE,
  RESPONSES,
  applications as applicationsRoute,
  createHandler,
  handler as rawHandler,
} from './applications';
import { type Verify, verifyWith } from './bot-check';
import { connect } from './dsql';
import type { ApiEvent } from './http';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { proveRouteContract, recorder } from './route-contract';

// The DML files are excluded: the demo row and its account would sit under every count below, and
// the backfill is DML too. `DDL` is derived from `MIGRATIONS` so a new schema file cannot be forgotten here.
const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

// THE REAL `connect`, never called: a test that reached it would mint a token against no cluster.
vi.mock('./dsql', async (actual) => ({
  ...(await actual<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const { observed, record } = recorder(ROUTE);

const applications = async (
  ...args: Parameters<typeof applicationsRoute>
): ReturnType<typeof applicationsRoute> => record(args[1], await applicationsRoute(...args));

const handler = async (...args: Parameters<typeof rawHandler>): ReturnType<typeof rawHandler> =>
  record(args[0], await rawHandler(...args));

const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const raw = (body?: string): ApiEvent => ({ body, isBase64Encoded: false });
const submit = (email: unknown, botCheck: unknown = TOKEN): ApiEvent =>
  raw(JSON.stringify({ email, botCheck }));

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
    db = await freshDb();
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
    // EXACT-KEY, as the published schema's `additionalProperties: false` says.
    [
      'a key the route does not read',
      `{"email":"new@quirenote.com","botCheck":"${TOKEN}","role":"admin"}`,
    ],
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
      new Error(
        'new row for relation "app_user" violates check constraint "app_user_email_lower_ck"',
      ),
      {
        severity: 'ERROR',
        code: '23514',
        constraint: 'app_user_email_lower_ck',
        detail:
          'Failing row contains (9f1e2d3c-0000-4000-8000-0000000000c3, New@quirenote.com, pending, user).',
      },
    );
    const { client } = spy(refusal);
    const watched = watchConsole();
    try {
      const res = await applications(client, submit('new@quirenote.com'));
      expect(res.statusCode).toBe(500);
      const answered = JSON.stringify(res);
      expect(answered).not.toContain('app_user');
      expect(answered).not.toContain('constraint');
      // LOGGED BY ITS CODE AND CONSTRAINT, never its `detail`: the cluster quotes the refused row
      // there, address included.
      const lines = watched.lines();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('23514');
      expect(lines[0]).toContain('app_user_email_lower_ck');
      expect(lines[0]).not.toMatch(/detail|Failing row/);
      expect(lines[0]).not.toMatch(ADDRESS);
    } finally {
      watched.restore();
    }
  });
});

/** The mail assertion reads `applications.ts` through this: the comment there explains at length
 *  why no mail client exists, and a rationale naming one of the tokens would redden a raw read.
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

describe('a submission costs one parameterised statement and no mail', () => {
  it('asks the cluster once, binding the address rather than interpolating it', async () => {
    const { client, asked } = spy();
    await applications(client, submit('New@quirenote.com'));
    expect(asked).toHaveLength(1);
    expect(asked[0].values).toEqual(['new@quirenote.com']);
    expect(asked[0].text).toContain('$1');
    expect(asked[0].text.toLowerCase()).not.toContain('quirenote.com');
  });

  // The gate is in `handler`: a malformed body costs no token mint on the one route a stranger
  // can reach.
  it('refuses a malformed body without reaching for a connection', async () => {
    vi.mocked(connect).mockClear();
    await expect(handler(raw('not json at all'))).resolves.toMatchObject({ statusCode: 400 });
    expect(connect).not.toHaveBeenCalled();
  });

  // THE DEPLOYED WIRING, not a composed double: a body with no token is refused before the
  // secret, siteverify or the cluster is reached, whatever the environment holds.
  it('refuses an application with no token without reaching for a connection', async () => {
    vi.mocked(connect).mockClear();
    const res = await handler(raw('{"email":"new@quirenote.com"}'));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"bot_check_failed"}']);
    expect(connect).not.toHaveBeenCalled();
  });

  // Mailing on submission would let anyone type a stranger's address and have this domain
  // deliver to it; the invitation belongs to approval. Asserted on the source, since a client
  // that is never constructed cannot be observed not calling anything.
  it('constructs no mail client and imports no mail SDK', () => {
    const source = stripTs(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'applications.ts'), 'utf8'),
      'applications.ts',
    );
    const forbidden = ['client-ses', 'SESClient', 'SendEmail', 'sendMail', 'nodemailer'];
    for (const name of forbidden) expect([name, source.includes(name)]).toEqual([name, false]);
  });
});

describe('the bot check stands before the cluster', () => {
  /** A connection that records it was opened, and the statements asked of it. */
  const opened = () => {
    const { client, asked } = spy();
    const connect = vi.fn(async () => ({ ...client, end: async () => {} }));
    return { connect, asked };
  };
  const gated = (verify: Verify, connect: ReturnType<typeof opened>['connect']) => {
    const route = createHandler({ verify, connect });
    return async (event: ApiEvent) => record(event, await route(event));
  };
  const verdict = (v: Awaited<ReturnType<Verify>>) => vi.fn<Verify>(async () => v);

  // The accepting twin first: every refusal below is green against a gate refusing everything.
  it('records an application whose token passes, as before', async () => {
    const { connect, asked } = opened();
    const res = await gated(verdict('passed'), connect)(submit('New@quirenote.com'));
    expect([res.statusCode, res.body]).toEqual([202, '{"status":"received"}']);
    expect(asked).toHaveLength(1);
    expect(asked[0].values).toEqual(['new@quirenote.com']);
  });

  it('refuses a token the check refuses, and opens no connection', async () => {
    const { connect } = opened();
    const res = await gated(verdict('refused'), connect)(submit('new@quirenote.com'));
    expect([res.statusCode, res.body]).toEqual([403, '{"error":"bot_check_failed"}']);
    expect(connect).not.toHaveBeenCalled();
  });

  // FAIL CLOSED: an outage is no reason to admit what nothing checked (OWASP, "Fail securely").
  it('answers a check that could not run with the fixed 500, and opens no connection', async () => {
    const { connect } = opened();
    const res = await gated(verdict('unavailable'), connect)(submit('new@quirenote.com'));
    expect([res.statusCode, res.body]).toEqual([500, '{"error":"internal"}']);
    expect(connect).not.toHaveBeenCalled();
  });

  for (const [what, body] of [
    ['no token', '{"email":"new@quirenote.com"}'],
    ['a token that is not text', '{"email":"new@quirenote.com","botCheck":42}'],
    ['an empty token', '{"email":"new@quirenote.com","botCheck":""}'],
  ] as const) {
    it(`hands the check an empty token for ${what}`, async () => {
      const verify = verdict('refused');
      await gated(verify, opened().connect)(raw(body));
      expect(verify).toHaveBeenCalledWith('', undefined);
    });
  }

  // The field is checked first, as the form checks it: a bad address spends no token.
  it('refuses a bad address before asking the check anything', async () => {
    const verify = verdict('passed');
    const { connect } = opened();
    const res = await gated(verify, connect)(submit('no-at-sign'));
    expect(res.statusCode).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });

  // THE CALLER'S OWN ADDRESS, as API Gateway saw the connection: the `api.` hosts are DNS-only and
  // regional, so nothing in front of them sets a forwarding header worth believing.
  it("hands siteverify the caller's sourceIp as remoteip", async () => {
    const sent: unknown[] = [];
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return Response.json({ success: true, action: 'apply', hostname: 'localhost' });
    });
    const verify = verifyWith(
      fetch,
      () => ({ secret: async () => 's', forget: () => {}, hostnames: ['localhost'] }),
      'apply',
    );
    const event: ApiEvent = {
      ...submit('new@quirenote.com'),
      requestContext: { http: { sourceIp: '203.0.113.9' } },
    };
    const res = await gated(verify, opened().connect)(event);
    expect(res.statusCode).toBe(202);
    expect(sent).toEqual([{ secret: 's', response: TOKEN, remoteip: '203.0.113.9' }]);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 10 });
