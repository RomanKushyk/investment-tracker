// The migration RUNNER. What this file covers is the part a cluster round cannot
// repeat cheaply: the re-run and crash paths, which exist because the generated DDL
// carries no `IF NOT EXISTS` and DSQL has no cross-statement rollback, so a
// half-applied file cannot simply be re-run.
//
// PGlite covers the applier; the rewrite is covered as text, because `CREATE INDEX
// ASYNC` is DSQL-only and PGlite refuses it BY DESIGN. Only the unrewritten half can
// be executed here, which is why the module keeps the rewrite and the apply apart.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_ACCOUNT_ID, DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import { connect } from './dsql';
import type { SqlClient } from './migrate';
import {
  MIGRATIONS,
  TEARDOWN_RESERVE_MS,
  applyFile,
  dropRehearsalSchema,
  ensureLedger,
  handler,
  migrate,
  rewriteForDsql,
  statementsOf,
} from './migrate';

// THE ONE PATH WITH A REAL BUDGET IS THE ONE PGlite CANNOT REACH: `handler` opens a
// cluster connection before it forwards Lambda's context, so the forward is only
// testable with the connection replaced. Nothing else in this file calls `handler`.
vi.mock('./dsql', () => ({ connect: vi.fn() }));

const read = (file: string) =>
  readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');

const USER_SCHEMA = '003_user_schema.sql';
const DEMO_ROW = '005_demo_user.sql';
const CASE_RULE = '006_email_lower.sql';
const DROP_POLICY = '007_drop_reinvest_policy.sql';
const DEMO_ACCOUNT = '008_demo_account.sql';

describe('the file list', () => {
  // NOT A GLOB, deliberately: `001`, `002` and `004` are the ARCHIVE's, applied by
  // `ensureSchema` in capture.ts, and globbing `migrations/**/*.sql` by filename would
  // run the user schema before them.
  it('names the user schema, the demo row, the case rule, the dropped column and the demo account, in that order, and nothing else', () => {
    expect(MIGRATIONS).toEqual([USER_SCHEMA, DEMO_ROW, CASE_RULE, DROP_POLICY, DEMO_ACCOUNT]);
  });
});

describe('statementsOf', () => {
  const stmts = statementsOf(read(USER_SCHEMA));

  it('splits the generated schema into its twelve statements', () => {
    expect(stmts).toHaveLength(12);
  });

  it('splits the case rule into its one statement', () => {
    expect(statementsOf(read(CASE_RULE))).toHaveLength(1);
  });

  it('splits the dropped column into its one statement', () => {
    expect(statementsOf(read(DROP_POLICY))).toHaveLength(1);
  });

  it('splits the demo account into its one statement', () => {
    expect(statementsOf(read(DEMO_ACCOUNT))).toHaveLength(1);
  });

  it('leaves no breakpoint marker inside a statement', () => {
    for (const s of stmts) expect(s).not.toContain('statement-breakpoint');
  });

  // The generated file wraps two CHECKs across a line, and splitting on `;` instead of
  // the marker would survive the count above and then mangle a real statement.
  it('keeps a CHECK that wraps across a line in one statement', () => {
    const type = stmts.find((s) => s.includes('transaction_type_ck'));
    expect(type).toContain("'dividend_payout',");
    expect(type).toContain("'interest_payout'");
  });

  it('trims each statement and drops empties', () => {
    for (const s of stmts) {
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(0);
    }
  });

  // Comments are stripped BEFORE splitting: a marker quoted in a file's own header
  // otherwise splits the file there.
  it('does not split on a marker quoted inside a comment', () => {
    const sql = [
      '-- a second statement would need a --> statement-breakpoint before it',
      'INSERT INTO t (a) VALUES (1);',
    ].join('\n');
    expect(statementsOf(sql)).toEqual(['INSERT INTO t (a) VALUES (1);']);
  });

  // Both spellings drizzle emits: on its own line between tables, and appended
  // to the terminating `;` of an index line.
  it('splits on a marker whether it stands alone or trails a statement', () => {
    const sql = 'CREATE TABLE a ();--> statement-breakpoint\nCREATE TABLE b ();';
    expect(statementsOf(sql)).toEqual(['CREATE TABLE a ();', 'CREATE TABLE b ();']);
  });

  it('drops a hand-written header so a comment edit is not a new statement', () => {
    const body = 'INSERT INTO t (a) VALUES (1);';
    expect(statementsOf(`-- one reason\n--\n${body}`)).toEqual(
      statementsOf(`-- a different reason entirely\n${body}`),
    );
  });
});

describe('rewriteForDsql', () => {
  // The four promotion rules, each measured against the live cluster
  // (`infra/docs/dsql-constraints.md`); any one alone still leaves a statement DSQL
  // refuses.
  it('appends NOT VALID to the case rule, which is why the file does not', () => {
    // DSQL refuses `ADD CONSTRAINT` without it.
    const [stmt] = statementsOf(read(CASE_RULE));
    expect(stmt).not.toContain('NOT VALID');
    expect(rewriteForDsql(stmt)).toContain('NOT VALID');
  });

  it('inserts ASYNC and strips USING btree from an index line', () => {
    expect(
      rewriteForDsql(
        'CREATE INDEX "asset_user_created" ON "asset" USING btree ("user_id","created_at");',
      ),
    ).toBe('CREATE INDEX ASYNC "asset_user_created" ON "asset" ("user_id","created_at");');
  });

  // A qualified name ignores `search_path`, so a rehearsal into a throwaway schema
  // builds its keys against the REAL `public` tables — loudly where `public` is empty,
  // SILENTLY where it is not, leaving a constraint pointing at production rows and
  // then dropping the referencing side out from under it.
  it('strips the schema qualifier drizzle hard-codes onto a key target', () => {
    expect(
      rewriteForDsql(
        'ALTER TABLE "account" ADD CONSTRAINT "account_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE restrict ON UPDATE no action;',
      ),
    ).toBe(
      'ALTER TABLE "account" ADD CONSTRAINT "account_user_fk" FOREIGN KEY ("user_id") REFERENCES "app_user"("user_id") ON DELETE restrict ON UPDATE no action NOT VALID;',
    );
  });

  it('leaves no schema qualifier anywhere in the generated file', () => {
    for (const s of statementsOf(read(USER_SCHEMA)).map(rewriteForDsql)) {
      expect(s).not.toContain('"public".');
    }
  });

  it('appends NOT VALID to an ADD CONSTRAINT', () => {
    expect(
      rewriteForDsql(
        'ALTER TABLE "asset" ADD CONSTRAINT "asset_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("user_id") ON DELETE restrict;',
      ),
    ).toMatch(/ NOT VALID;$/);
  });

  it('leaves a CREATE TABLE untouched', () => {
    const table = statementsOf(read(USER_SCHEMA)).find((s) =>
      s.startsWith('CREATE TABLE "app_user"'),
    );
    expect(table).toBeDefined();
    expect(rewriteForDsql(table!)).toBe(table);
  });

  it('leaves nothing DSQL refuses in the whole generated file', () => {
    for (const s of statementsOf(read(USER_SCHEMA)).map(rewriteForDsql)) {
      expect(s).not.toContain('USING btree');
      if (s.startsWith('CREATE INDEX')) expect(s.startsWith('CREATE INDEX ASYNC')).toBe(true);
    }
  });

  // A second rewrite would emit `CREATE INDEX ASYNC ASYNC` or a second `NOT VALID`,
  // both syntax errors the cluster reports as the caller's fault.
  it('is idempotent', () => {
    // Both files: `003` carries the index lines and the foreign keys, `006` the
    // bare `ADD CONSTRAINT` that the `NOT VALID` rule is the only one to touch.
    for (const file of [USER_SCHEMA, CASE_RULE]) {
      for (const s of statementsOf(read(file))) {
        expect(rewriteForDsql(rewriteForDsql(s))).toBe(rewriteForDsql(s));
      }
    }
  });
});

describe('applyFile', () => {
  let db: PGlite;
  // UNREWRITTEN on purpose: `CREATE INDEX ASYNC` is DSQL-only and PGlite
  // refuses it. This block covers the applier, never the rewrite.
  const stmts = statementsOf(read(USER_SCHEMA));

  beforeEach(async () => {
    db = new PGlite();
    await ensureLedger(db);
  });

  it('applies every statement once and skips them all on a re-run', async () => {
    expect(await applyFile(db, USER_SCHEMA, stmts)).toEqual({
      file: USER_SCHEMA,
      applied: 12,
      skipped: 0,
      pending: 0,
    });
    expect(await applyFile(db, USER_SCHEMA, stmts)).toEqual({
      file: USER_SCHEMA,
      applied: 0,
      skipped: 12,
      pending: 0,
    });
  });

  // THE LEDGER HASHES THE SOURCE, NOT WHAT REACHES THE CLUSTER, which is what lets
  // `send` change without re-presenting every statement as new: under a
  // rewritten-text key it would rehash the two index lines, re-execute them, take a
  // 42P07 and abort. Nothing executes on the second pass, so PGlite never meets the
  // `ASYNC` it could not run.
  it('recognises its own statements after the transform changes', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    expect(await applyFile(db, USER_SCHEMA, stmts, rewriteForDsql)).toEqual({
      file: USER_SCHEMA,
      applied: 0,
      skipped: 12,
      pending: 0,
    });
  });

  it('leaves the tables it claims to have created', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('app_user','account','asset','transaction','user_price')`,
    );
    expect(rows[0].count).toBe(5);
  });

  // THE CRASH WINDOW. DSQL forbids DDL and DML in one transaction, so there is no way
  // to stamp the ledger and run the statement atomically. The runner writes the row
  // FIRST with a NULL `applied_at`, which makes the window a named state rather than an
  // ambiguity: on a re-run exactly that one statement may answer "already exists".
  it('absorbs an already-exists refusal for the statement the ledger left open', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    await db.query(
      `UPDATE schema_migration SET applied_at = NULL WHERE file = $1 AND stmt_index = 0`,
      [USER_SCHEMA],
    );
    expect(await applyFile(db, USER_SCHEMA, stmts)).toEqual({
      file: USER_SCHEMA,
      applied: 1,
      skipped: 11,
      pending: 0,
    });
  });

  // An INDEX rather than a table: an index that exists is not yet an index that works,
  // so the absorb path re-checks `pg_index.indisvalid` rather than stamping.
  it('absorbs an open index statement only after checking the index is valid', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    const i = stmts.findIndex((s) => s.startsWith('CREATE INDEX'));
    await db.query(
      `UPDATE schema_migration SET applied_at = NULL WHERE file = $1 AND stmt_index = $2`,
      [USER_SCHEMA, i],
    );
    expect(await applyFile(db, USER_SCHEMA, stmts)).toEqual({
      file: USER_SCHEMA,
      applied: 1,
      skipped: 11,
      pending: 0,
    });
  });

  // The reason the absorption above is not a blanket catch: an object this runner has
  // no record of opening is someone else's. THREE RUNS, NOT TWO — the row is withdrawn
  // on a raised error so the refusal is permanent, and the third run is what shows the
  // second left nothing open for it to absorb.
  it('refuses an already-exists refusal for a statement the ledger never opened', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    await db.query(`DELETE FROM schema_migration WHERE file = $1 AND stmt_index = 0`, [
      USER_SCHEMA,
    ]);
    await expect(applyFile(db, USER_SCHEMA, stmts)).rejects.toThrow();
    await expect(applyFile(db, USER_SCHEMA, stmts)).rejects.toThrow();
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM schema_migration
        WHERE file = $1 AND applied_at IS NULL`,
      [USER_SCHEMA],
    );
    expect(rows[0].count).toBe(0);
  });

  // THE OTHER HALF OF THE SAME RULE. `pg` reports a dropped connection with NO
  // SQLSTATE, so a code-less error is a statement whose fate is unknown, not proof it
  // failed — and deleting the row also destroys a PREVIOUS run's crash evidence.
  it('keeps the row when the failure carries no SQLSTATE', async () => {
    const dropped = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: undefined,
    });
    let armed = false;
    const flaky: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (armed && text.startsWith('CREATE TABLE "account"')) throw dropped;
        return db.query(text, values);
      },
    };
    armed = true;
    await expect(applyFile(flaky, USER_SCHEMA, stmts)).rejects.toThrow(/Connection terminated/);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM schema_migration
        WHERE file = $1 AND applied_at IS NULL`,
      [USER_SCHEMA],
    );
    expect(rows[0].count).toBe(1);
  });

  // A failure AFTER the statement is not the statement failing: the index job wait runs
  // once `client.query` has returned, so the DDL is already on the cluster.
  it('keeps the row when the statement landed and the work after it failed', async () => {
    const index = stmts.findIndex((s) => s.startsWith('CREATE INDEX'));
    let landed = false;
    // THE STATEMENT HAS TO ACTUALLY LAND, so `ASYNC` is stripped back out on the way to
    // PGlite, which would otherwise refuse it at parse with `42601` and satisfy a bare
    // `rejects.toThrow()` with the wrong error.
    const failing: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('CREATE INDEX')) {
          await db.query(text.replace(' ASYNC', ''), values);
          landed = true;
          throw new Error('job wait died');
        }
        return db.query(text, values);
      },
    };
    await expect(applyFile(failing, USER_SCHEMA, stmts, rewriteForDsql)).rejects.toThrow(
      /job wait died/,
    );
    expect(landed).toBe(true);
    const { rows } = await db.query<{ stmt_index: number }>(
      `SELECT stmt_index FROM schema_migration WHERE file = $1 AND applied_at IS NULL`,
      [USER_SCHEMA],
    );
    expect(rows.map((r) => r.stmt_index)).toEqual([index]);
  });

  // The ledger's key is `(file, stmt_sha256)`, so a byte-identical repeat collides on
  // it and must be named rather than left reading as a cluster fault.
  it('names the file when it repeats a statement byte for byte', async () => {
    await expect(applyFile(db, USER_SCHEMA, [...stmts, stmts[0]])).rejects.toThrow(
      /repeats a statement byte for byte/,
    );
  });

  // The same window over DML, raising NOTHING rather than being absorbed: `005` carries
  // `ON CONFLICT (user_id) DO NOTHING`, so a re-run is silent and `23505` is left
  // meaning a real collision, which must stop the run.
  it('re-runs an open DML statement without raising', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    const demo = statementsOf(read(DEMO_ROW));
    await applyFile(db, DEMO_ROW, demo);
    await db.query(`UPDATE schema_migration SET applied_at = NULL WHERE file = $1`, [DEMO_ROW]);
    expect(await applyFile(db, DEMO_ROW, demo)).toEqual({
      file: DEMO_ROW,
      applied: 1,
      skipped: 0,
      pending: 0,
    });
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app_user WHERE user_id = $1`,
      [DEMO_USER_ID],
    );
    expect(rows[0].count).toBe(1);
  });

  // The same window over a DROP, and the reason `007` carries `IF EXISTS`: the column is
  // already gone on the re-send, so a bare DROP would raise `42703`, which is neither in
  // `ALREADY_THERE` nor the `openedHere` case — the run would abort on it and keep
  // aborting, blocking every later file.
  it('re-runs an open DROP COLUMN without raising', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    const drop = statementsOf(read(DROP_POLICY));
    await applyFile(db, DROP_POLICY, drop);
    await db.query(`UPDATE schema_migration SET applied_at = NULL WHERE file = $1`, [DROP_POLICY]);
    expect(await applyFile(db, DROP_POLICY, drop)).toEqual({
      file: DROP_POLICY,
      applied: 1,
      skipped: 0,
      pending: 0,
    });
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_name = 'asset' AND column_name = 'reinvest_policy'`,
    );
    expect(rows[0].count).toBe(0);
  });

  it('applies the demo row against the schema it depends on', async () => {
    await applyFile(db, USER_SCHEMA, stmts);
    await applyFile(db, DEMO_ROW, statementsOf(read(DEMO_ROW)));
    const { rows } = await db.query<{ role: string; status: string; decided_at: Date | null }>(
      `SELECT role, status, decided_at FROM app_user WHERE user_id = $1`,
      [DEMO_USER_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'demo', status: 'active', decided_at: null });
  });
});

// `40001` IS CONTENTION, NOT A REFUSAL. Dropping a six-table schema is a large
// catalogue change issued right behind two `CREATE INDEX ASYNC` jobs, and a waited-for
// job is not a settled catalogue — the drop that failed this way then succeeded by
// hand on its first attempt.
const conflict = () =>
  Object.assign(new Error('change conflicts with another transaction (OC000)'), {
    code: '40001',
  });

// A REHEARSAL CANNOT REACH ITS OWN TEARDOWN UNDER PGlite unaided: `rewriteForDsql`
// emits `CREATE INDEX ASYNC`, which the engine refuses, and `waitForIndexJob` wants a
// job id out of the rows. This plays those two DSQL verbs and hands the rest to the
// engine — and plays them SETTLED, which is the very condition a real cluster is
// thought to violate here. So these tests pin the report and the resolve-or-raise
// split, and cannot speak to whether the retry defeats a real conflict.
const dsqlish = (db: PGlite): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+ASYNC\b/i.test(text)) {
      await db.query(text.replace(/\bASYNC\s+/i, ''));
      return { rows: [{ job_id: 'job' }] as unknown as R[] };
    }
    if (text.startsWith('CALL sys.wait_for_job')) return { rows: [] as R[] };
    return db.query<R>(text, values);
  },
});

// Each exhausting retry spends the real backoff, inside the suite's default per-test
// budget only when the machine is not contended.
const THROUGH_THE_BACKOFF = 20_000;

describe('dropRehearsalSchema', () => {
  it('retries a drop that answers 40001, and the schema goes', async () => {
    const db = new PGlite();
    await db.query('CREATE SCHEMA rehearsal_a');
    let attempts = 0;
    const flaky: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('DROP SCHEMA')) {
          attempts += 1;
          if (attempts === 1) throw conflict();
        }
        return db.query(text, values);
      },
    };
    expect(await dropRehearsalSchema(flaky, 'rehearsal_a')).toEqual({
      schema: 'rehearsal_a',
      dropped: true,
      attempts: 2,
    });
    const { rows } = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname = 'rehearsal_a'`,
    );
    expect(rows).toEqual([]);
  });

  // A CONFLICT IS THE CLIENT'S VIEW, NOT THE CLUSTER'S: an attempt can commit and still
  // answer `40001`. `IF EXISTS` is what keeps the retry off `3F000` — a refusal, so not
  // retried — and off reporting a schema already gone as one to go and drop. DSQL
  // accepts `DROP SCHEMA IF EXISTS … CASCADE` present or absent, measured on the dev
  // cluster and recorded in `infra/docs/dsql-constraints.md`.
  it('reports a drop that committed under a conflict as dropped, not orphaned', async () => {
    const db = new PGlite();
    await db.query('CREATE SCHEMA rehearsal_d');
    let attempts = 0;
    let goneByTheRetry: boolean | undefined;
    const committed: SqlClient = {
      query: async <R>(text: string, values?: unknown[]) => {
        if (text.startsWith('DROP SCHEMA')) {
          attempts += 1;
          if (attempts === 1) {
            // It LANDED, and the client was told otherwise.
            await db.query<R>(text, values);
            throw conflict();
          }
          const { rows } = await db.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'rehearsal_d'`,
          );
          goneByTheRetry = rows[0].n === 0;
        }
        return db.query<R>(text, values);
      },
    };
    expect(await dropRehearsalSchema(committed, 'rehearsal_d')).toEqual({
      schema: 'rehearsal_d',
      dropped: true,
      attempts: 2,
    });
    // Without this the test is its sibling above wearing a different name: the retry
    // has to have met a schema that was ALREADY GONE.
    expect(goneByTheRetry).toBe(true);
  });

  // BOUNDED, because the alternative is holding the invocation open against a conflict
  // that may never clear; the report is what the operator needs to finish by hand.
  it(
    'gives up after a bounded number of attempts, and says what refused',
    async () => {
      const stubborn: SqlClient = {
        query: async () => {
          throw conflict();
        },
      };
      expect(await dropRehearsalSchema(stubborn, 'rehearsal_b')).toEqual({
        schema: 'rehearsal_b',
        dropped: false,
        attempts: 3,
        sqlstate: '40001',
        message: expect.stringContaining('OC000'),
      });
    },
    THROUGH_THE_BACKOFF,
  );

  // Retrying something the cluster will not do spends the whole backoff to reach the
  // same answer.
  it('does not retry anything but 40001', async () => {
    const refused: SqlClient = {
      query: async () => {
        throw Object.assign(new Error('permission denied for schema'), { code: '42501' });
      },
    };
    expect(await dropRehearsalSchema(refused, 'rehearsal_c')).toMatchObject({
      schema: 'rehearsal_c',
      dropped: false,
      attempts: 1,
      sqlstate: '42501',
    });
  });
});

describe('migrate', () => {
  // NO SAFE DEFAULT FOR A VERB THIS DESTRUCTIVE, for the reason `MigrateEvent.mode`'s
  // own doc gives. What is only true here: `role-deploy.md` grants the invoke on prod's
  // runner as well as dev's, so a mode nobody recognises has somewhere to land.
  it('refuses a missing or unrecognised mode rather than choosing one', async () => {
    const db = new PGlite();
    await expect(migrate(db, {})).rejects.toThrow(/mode must be one of/);
    await expect(migrate(db, { mode: 'rehearsal' } as never)).rejects.toThrow(
      /mode must be one of/,
    );
    await expect(migrate(db, { mode: true } as never)).rejects.toThrow(/mode must be one of/);
  });

  // The dry run is what covers the file RESOLUTION, which the deploy's CommonJS bundle
  // would otherwise be the first thing to exercise: `import.meta.url` is empty in that
  // format, so the path comes from `LAMBDA_TASK_ROOT`, with the repository root as the
  // fallback this test runs under. `pending`, NOT `skipped` — on an empty cluster
  // `skipped: 12` reads as "nothing to do".
  it('reports what is still to run, against a cluster with no ledger at all', async () => {
    const db = new PGlite();
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      ms: expect.any(Number),
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 0, pending: 12, ms: expect.any(Number) },
        { file: DEMO_ROW, applied: 0, skipped: 0, pending: 1, ms: expect.any(Number) },
        { file: CASE_RULE, applied: 0, skipped: 0, pending: 1, ms: expect.any(Number) },
        { file: DROP_POLICY, applied: 0, skipped: 0, pending: 1, ms: expect.any(Number) },
        { file: DEMO_ACCOUNT, applied: 0, skipped: 0, pending: 1, ms: expect.any(Number) },
      ],
    });
  });

  it('reports nothing pending once the ledger says everything applied', async () => {
    const db = new PGlite();
    await ensureLedger(db);
    await applyFile(db, USER_SCHEMA, statementsOf(read(USER_SCHEMA)));
    await applyFile(db, DEMO_ROW, statementsOf(read(DEMO_ROW)));
    await applyFile(db, CASE_RULE, statementsOf(read(CASE_RULE)));
    await applyFile(db, DROP_POLICY, statementsOf(read(DROP_POLICY)));
    await applyFile(db, DEMO_ACCOUNT, statementsOf(read(DEMO_ACCOUNT)));
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      ms: expect.any(Number),
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 12, pending: 0, ms: expect.any(Number) },
        { file: DEMO_ROW, applied: 0, skipped: 1, pending: 0, ms: expect.any(Number) },
        { file: CASE_RULE, applied: 0, skipped: 1, pending: 0, ms: expect.any(Number) },
        { file: DROP_POLICY, applied: 0, skipped: 1, pending: 0, ms: expect.any(Number) },
        { file: DEMO_ACCOUNT, applied: 0, skipped: 1, pending: 0, ms: expect.any(Number) },
      ],
    });
  });

  // REHEARSE is the workflow's default. The rewrite makes the statements unrunnable
  // here, so what is asserted is the engine-neutral part: schema created and dropped,
  // `search_path` back to `public`, and the STATEMENT's error surfacing over the
  // cleanup's. Under PGlite the drop succeeds, so it is forced to fail here —
  // otherwise a `finally { DROP SCHEMA }` shape passes this test too.
  it('reports the statement that failed, not the cleanup that failed after it', async () => {
    const db = new PGlite();
    const brittle: SqlClient = {
      query: async (text: string, values?: unknown[]) => {
        if (text.startsWith('DROP SCHEMA')) throw new Error('drop failed too');
        return db.query(text, values);
      },
    };
    const raised = await migrate(brittle, { mode: 'rehearse' }).catch((err: unknown) => err);
    expect((raised as Error).message).toMatch(/ASYNC|syntax/i);
    // A cleanup failure that carries NO SQLSTATE still has to read as prose. The
    // code is appended only where the server gave one, and this drop gave none.
    expect((raised as Error).message).not.toContain('undefined');
  });

  // The note is appended only when the schema outlived the run; otherwise it would
  // send an operator after a schema that is not there.
  it('says nothing about a schema on a statement failure whose drop succeeded', async () => {
    const db = new PGlite();
    const raised = await migrate(db, { mode: 'rehearse' }).catch((err: unknown) => err);
    expect((raised as Error).message).toMatch(/ASYNC|syntax/i);
    expect((raised as Error).message).not.toMatch(/could not be dropped/);
  });

  it('drops its throwaway schema and restores search_path even when a statement fails', async () => {
    const db = new PGlite();
    await expect(migrate(db, { mode: 'rehearse' })).rejects.toThrow();
    const { rows } = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(rows).toEqual([]);
    const path = await db.query<{ search_path: string }>('SHOW search_path');
    expect(path.rows[0].search_path).toContain('public');
  });

  // The workflow's check falls through on the key's ABSENCE, so absence is worth a
  // test of its own.
  it('omits the teardown key entirely when it drops its schema', async () => {
    const db = new PGlite();
    const report = await migrate(dsqlish(db), { mode: 'rehearse' });
    expect('teardown' in report).toBe(false);
    const { rows } = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(rows).toEqual([]);
  });

  // A REHEARSAL THAT APPLIED CLEANLY AND THEN COULD NOT DROP ITS SCHEMA IS NOT A
  // FINDING: the statements are what the mode exists to test. So it RESOLVES, carrying
  // the schema name — the operator's only sight of it short of CloudWatch.
  it(
    'resolves with a report naming the schema when the statements applied and the drop did not',
    async () => {
      const db = new PGlite();
      const settled = dsqlish(db);
      const conflicted: SqlClient = {
        query: async <R>(text: string, values?: unknown[]) => {
          if (text.startsWith('DROP SCHEMA')) throw conflict();
          return settled.query<R>(text, values);
        },
      };
      const report = await migrate(conflicted, { mode: 'rehearse' });
      expect(report.schema).toMatch(/^migrate_rehearsal_\d+$/);
      expect(report.files).toEqual([
        { file: USER_SCHEMA, applied: 12, skipped: 0, pending: 0, ms: expect.any(Number) },
        { file: DEMO_ROW, applied: 1, skipped: 0, pending: 0, ms: expect.any(Number) },
        { file: CASE_RULE, applied: 1, skipped: 0, pending: 0, ms: expect.any(Number) },
        { file: DROP_POLICY, applied: 1, skipped: 0, pending: 0, ms: expect.any(Number) },
        { file: DEMO_ACCOUNT, applied: 1, skipped: 0, pending: 0, ms: expect.any(Number) },
      ]);
      expect(report.teardown).toEqual({
        schema: report.schema,
        dropped: false,
        attempts: 3,
        sqlstate: '40001',
        message: expect.stringContaining('OC000'),
      });
    },
    THROUGH_THE_BACKOFF,
  );

  // THE ORPHAN IS NAMED ON BOTH PATHS: when the drop failed too, the schema is on the
  // cluster and the raised message is the only thing the operator reads.
  it(
    'names the schema it could not drop when a statement failed and the drop failed after it',
    async () => {
      const db = new PGlite();
      const doomed: SqlClient = {
        query: async <R>(text: string, values?: unknown[]) => {
          if (text.startsWith('DROP SCHEMA')) throw conflict();
          return db.query<R>(text, values);
        },
      };
      const raised = await migrate(doomed, { mode: 'rehearse' }).catch((err: unknown) => err);
      expect(raised).toBeInstanceOf(Error);
      expect((raised as Error).message).toMatch(/ASYNC|syntax/i);
      expect((raised as Error).message).toMatch(/migrate_rehearsal_\d+ could not be dropped/);
      // The SQLSTATE rides along, because where the restore fails too this is
      // the only place it leaves the invocation.
      expect((raised as Error).message).toContain('(40001)');
    },
    THROUGH_THE_BACKOFF,
  );
});

// The invocation is the bound nothing else measures: the rehearsal replays the WHOLE
// history every time — the ledger lives inside the throwaway schema, so no file is
// ever skipped — while `Timeout: 900` is already Lambda's maximum. What these pin is
// the shape of running out: refused by name, before the work starts, with the schema
// still dropped. A kill at the ceiling has none of those properties.
describe('the invocation budget', () => {
  /** Lambda's context, reduced to the one method the runner reads. Constant rather
   *  than counting down: what is under test is the decision, not the clock. */
  const left = (ms: number) => ({ getRemainingTimeInMillis: () => ms });

  it('refuses a rehearsal statement it cannot finish, naming the file and the statement', async () => {
    const db = new PGlite();
    const raised = await migrate(dsqlish(db), { mode: 'rehearse' }, undefined, left(0)).catch(
      (err: unknown) => err,
    );
    expect(raised).toBeInstanceOf(Error);
    // The three things an operator has to read off a run page: which file, which
    // statement, and that the wall clock rather than the statement is what refused.
    expect((raised as Error).message).toContain(USER_SCHEMA);
    expect((raised as Error).message).toMatch(/statement 0\b/);
    expect((raised as Error).message).toContain(String(TEARDOWN_RESERVE_MS));
  });

  // THE PROPERTY THAT SEPARATES THIS FROM A KILL. A timed-out invocation never reaches
  // `dropRehearsalSchema`, so it leaves a schema whose name is only in CloudWatch.
  it('still drops its throwaway schema and restores search_path when the budget refuses', async () => {
    const db = new PGlite();
    await expect(migrate(dsqlish(db), { mode: 'rehearse' }, undefined, left(0))).rejects.toThrow();
    const { rows } = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(rows).toEqual([]);
    const path = await db.query<{ search_path: string }>('SHOW search_path');
    expect(path.rows[0].search_path).toContain('public');
  });

  // An apply is the worse kill: a wait killed over `CREATE INDEX ASYNC` leaves the
  // ledger row open. Refusing BEFORE the insert is what keeps the ledger honest.
  it('refuses an apply the same way, and the ledger records nothing it did not run', async () => {
    const db = new PGlite();
    await expect(migrate(dsqlish(db), { mode: 'apply' }, undefined, left(0))).rejects.toThrow(
      USER_SCHEMA,
    );
    const { rows } = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migration',
    );
    expect(rows[0].n).toBe(0);
  });

  // WHERE THE FIGURE LIVES. The reserve exists to cover the teardown, so a budget that
  // is exactly it is already too little.
  it('completes on a budget just above the reserve and refuses on the reserve itself', async () => {
    const above = new PGlite();
    const report = await migrate(
      dsqlish(above),
      { mode: 'rehearse' },
      undefined,
      left(TEARDOWN_RESERVE_MS + 1),
    );
    expect(report.files.map((f) => f.applied)).toEqual([12, 1, 1, 1, 1]);

    const below = new PGlite();
    await expect(
      migrate(dsqlish(below), { mode: 'rehearse' }, undefined, left(TEARDOWN_RESERVE_MS)),
    ).rejects.toThrow();
  });

  // The check sits AFTER the ledger's skip, or a long-applied history would refuse a
  // run with nothing to do — the state every deploy that ships no new SQL is in.
  it('does not spend the budget on a statement the ledger has already finished', async () => {
    const db = new PGlite();
    const client = dsqlish(db);
    await migrate(client, { mode: 'apply' });
    const report = await migrate(client, { mode: 'apply' }, undefined, left(0));
    expect(report.files.map((f) => f.skipped)).toEqual([12, 1, 1, 1, 1]);
    expect(report.files.map((f) => f.applied)).toEqual([0, 0, 0, 0, 0]);
  });

  // A BUDGET THAT IS NEVER FORWARDED IS A GUARD THAT NEVER FIRES, and it would compile.
  it("carries the budget from the handler's Lambda context", async () => {
    const db = new PGlite();
    const client = dsqlish(db);
    vi.mocked(connect).mockResolvedValue({
      query: (text: string, values?: unknown[]) => client.query(text, values),
      end: async () => {},
    } as unknown as Awaited<ReturnType<typeof connect>>);
    const raised = await handler({ mode: 'rehearse' }, left(0)).catch((err: unknown) => err);
    expect(raised).toBeInstanceOf(Error);
    expect((raised as Error).message).toContain(USER_SCHEMA);
  });
});

// THE RUN THAT BLEW THE BUDGET IS THE ONE WHOSE COST MATTERS: the raise is all that leaves the
// invocation, so what the runner measured before it has to travel in the message.
describe('what a budget refusal carries out', () => {
  /** Plenty for the first `calls` statements, then nothing — a refusal mid-run. */
  const after = (calls: number) => {
    let seen = 0;
    return { getRemainingTimeInMillis: () => (seen++ < calls ? 10 * TEARDOWN_RESERVE_MS : 0) };
  };
  const refusal = (mode: 'apply' | 'rehearse', db: PGlite, calls: number) =>
    migrate(dsqlish(db), { mode }, undefined, after(calls)).then(
      () => expect.fail('the budget did not refuse'),
      (err: unknown) => (err as Error).message,
    );
  const inSchema = statementsOf(read(USER_SCHEMA)).length;
  const figure = (message: string, file: string) =>
    message.match(new RegExp(`${file.replace('.', '\\.')} (\\d+)ms`))?.[1];

  // One call per statement sent, so the call after `003`'s last is `005`'s first.
  it.each(['apply', 'rehearse'] as const)(
    'names the ms of every file %s finished, and still names the refusal',
    async (mode) => {
      const message = await refusal(mode, new PGlite(), inSchema);
      expect(message).toContain(DEMO_ROW);
      expect(message).toMatch(/statement 0\b/);
      expect(message).toContain(String(TEARDOWN_RESERVE_MS));
      expect(figure(message, USER_SCHEMA)).toMatch(/^\d+$/);
      // Only what finished: the refused file has no figure, and neither does a later one.
      expect(figure(message, DEMO_ROW)).toBeUndefined();
      expect(figure(message, CASE_RULE)).toBeUndefined();
      // The gap between this and the list bounds the refused file's share.
      expect(message).toMatch(/\d+ms since the run began/);
    },
  );

  // The repair is an apply dispatched again, so the second run's list must not show a file the
  // ledger held as a finished one that cost next to nothing.
  it('counts a file the ledger held rather than timing it, on a resumed apply', async () => {
    const db = new PGlite();
    await refusal('apply', db, inSchema);
    const message = await refusal('apply', db, 1);
    expect(message).toContain(CASE_RULE);
    expect(figure(message, USER_SCHEMA)).toBeUndefined();
    expect(figure(message, DEMO_ROW)).toMatch(/^\d+$/);
    expect(message).toMatch(/\b1 file already in the ledger\b/);
  });

  // Half-held, its ms covers only the statements this run sent, and the figure says so.
  it('says how much of a file the ledger had already held', async () => {
    const db = new PGlite();
    await refusal('apply', db, 5);
    const message = await refusal('apply', db, inSchema - 5 + 1);
    expect(message).toContain(CASE_RULE);
    expect(figure(message, USER_SCHEMA)).toMatch(/^\d+$/);
    expect(message).toContain(`ms for ${inSchema - 5} of ${inSchema},`);
  });

  it('still drops the rehearsal schema when the refusal carries its costs', async () => {
    const db = new PGlite();
    await refusal('rehearse', db, inSchema);
    const { rows } = await db.query(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(rows).toEqual([]);
    const path = await db.query<{ search_path: string }>('SHOW search_path');
    expect(path.rows[0].search_path).toContain('public');
  });

  it.each(['apply', 'rehearse'] as const)(
    'says so when %s had finished no file yet',
    async (mode) => {
      const message = await refusal(mode, new PGlite(), 0);
      expect(message).toContain(USER_SCHEMA);
      expect(message).toMatch(/statement 0\b/);
      expect(message).toContain(String(TEARDOWN_RESERVE_MS));
      expect(message).toMatch(/no file had finished/i);
    },
  );
});

// WHAT THE REHEARSAL COSTS, in the only artifact a run leaves. The cost grows with
// every file added and the report is what turns the next decision about it into a
// curve rather than a paragraph.
describe("the report's wall time", () => {
  it('reports a total and a per-file ms, the total covering every file', async () => {
    const db = new PGlite();
    const report = await migrate(dsqlish(db), { mode: 'rehearse' });
    expect(report.ms).toEqual(expect.any(Number));
    // `?? NaN` rather than `?? 0`: `ms` is optional on a file entry, so a spread
    // dropped from `migrate` would otherwise sum to a number and pass.
    const summed = report.files.reduce((total, file) => total + (file.ms ?? NaN), 0);
    expect(Number.isNaN(summed)).toBe(false);
    // The total also covers `CREATE SCHEMA` and the teardown, so it can only be larger.
    expect(report.ms).toBeGreaterThanOrEqual(summed);
  });
});

describe('the demo user', () => {
  // One literal, in one place: #50's seed and #137's public read will each have to name
  // this row, and a second copy of the id is a second source of truth.
  it('is the row the migration writes', () => {
    const sql = read(DEMO_ROW);
    expect(sql).toContain(DEMO_USER_ID);
    expect(sql).toContain(DEMO_USER_EMAIL);
  });

  // Under the owner's own SES-verified domain, which is what stops a real applicant
  // ever arriving holding it — see `app_user_email_uq` in `infra/schema/user.ts`.
  it('holds an address the owner controls', () => {
    expect(DEMO_USER_EMAIL.endsWith('@quirenote.com')).toBe(true);
  });

  // `006` refuses anything else. `NOT VALID` spares a row already present the initial
  // scan but, on stock Postgres, not a later write — the CHECK runs on every UPDATE of
  // it — so a capital here would make the demo row unupdatable rather than harmlessly
  // exempt. Measured on PGlite and unprobed on DSQL; either way DSQL refuses
  // `VALIDATE CONSTRAINT`, so nothing goes looking later.
  it('is already the canonical spelling `006` requires', () => {
    expect(DEMO_USER_EMAIL).toBe(DEMO_USER_EMAIL.toLowerCase());
  });

  it('owns the account `008` writes', () => {
    const sql = read(DEMO_ACCOUNT);
    expect(sql).toContain(DEMO_USER_ID);
    expect(sql).toContain(DEMO_ACCOUNT_ID);
  });

  // A LATER FILE, NEVER AN EDIT OF AN EARLIER ONE. The ledger keys by statement content hash and
  // both are applied on both clusters, so an account added to `005` would be re-presented as a
  // statement the runner has no record of — refused, and nothing applied.
  it('takes its account from a file of its own, leaving `003` and `005` as they were applied', () => {
    expect(read(USER_SCHEMA)).not.toMatch(/INSERT INTO account/i);
    expect(read(DEMO_ROW)).not.toMatch(/INSERT INTO account/i);
    expect(statementsOf(read(DEMO_ROW))).toHaveLength(1);
  });

  it('has exactly one account once every file has run', async () => {
    const db = new PGlite();
    await ensureLedger(db);
    for (const file of MIGRATIONS) await applyFile(db, file, statementsOf(read(file)));

    const { rows } = await db.query<{ id: string; provider: string; name: string }>(
      'SELECT id, provider, name FROM account WHERE user_id = $1',
      [DEMO_USER_ID],
    );
    expect(rows).toEqual([{ id: DEMO_ACCOUNT_ID, provider: 'inzhur', name: 'Inzhur' }]);
  });

  // The runner's crash window lets a statement it left open be sent twice, which `ON CONFLICT` on
  // the PRIMARY KEY is what makes silent — the target `dsql-constraints.md` measured.
  it('still has one account when the statement runs twice', async () => {
    const db = new PGlite();
    await ensureLedger(db);
    for (const file of MIGRATIONS) await applyFile(db, file, statementsOf(read(file)));
    for (const stmt of statementsOf(read(DEMO_ACCOUNT))) await db.exec(stmt);

    const { rows } = await db.query('SELECT id FROM account WHERE user_id = $1', [DEMO_USER_ID]);
    expect(rows).toHaveLength(1);
  });
});

describe('the bootstrap mode makes the one account that can approve the others', () => {
  // THE SUB IS NOT THIS FILE'S TO INVENT. `user_id` holds the Cognito `sub` and only
  // `AdminCreateUser` mints one, which is why this is a runner mode and not a line in
  // `003`; `005` gets away with a pinned literal only because the demo identity must
  // never gain a provider account at all.
  const SUB = '9f1e2d3c-0000-4000-8000-00000000ad11';
  const POOL = 'eu-north-1_EXAMPLE';

  // The pool arrives as an environment variable, a hand-typed invoke carrying none the
  // way a Cognito trigger's event does. Stubbed and restored rather than assumed, or an
  // exported one would make the refusal below pass for the wrong reason.
  beforeEach(() => {
    vi.stubEnv('USER_POOL_ID', POOL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The shape `pre-signup.test.ts` uses. */
  const spy = (existing?: string) => {
    const created: unknown[] = [];
    const fetched: unknown[] = [];
    const idp = {
      adminCreateUser: async (input: { UserPoolId: string; Username: string }) => {
        created.push(input);
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
    };
    return { idp, created, fetched };
  };

  const applied = async () => {
    const db = new PGlite();
    await ensureLedger(db);
    for (const file of MIGRATIONS) await applyFile(db, file, statementsOf(read(file)));
    return db;
  };

  const rows = async (db: PGlite) =>
    (
      await db.query<{ user_id: string; email: string; status: string; role: string }>(
        `SELECT user_id, email, status, role, decided_by, decided_at IS NOT NULL AS decided
           FROM app_user WHERE role = 'super_admin'`,
      )
    ).rows;

  const accounts = async (db: PGlite, userId: string) =>
    (
      await db.query<{ provider: string; name: string }>(
        'SELECT provider, name FROM account WHERE user_id = $1',
        [userId],
      )
    ).rows;

  it('creates the identity and one row keyed by the sub the create call returned', async () => {
    const db = await applied();
    const { idp, created } = spy();
    const report = await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp);

    expect(created).toHaveLength(1);
    expect(report.bootstrap).toEqual({
      email: 'owner@quirenote.com',
      identity: 'created',
      row: 'created',
      account: 'created',
    });
    expect(await rows(db)).toEqual([
      {
        user_id: SUB,
        email: 'owner@quirenote.com',
        status: 'active',
        role: 'super_admin',
        // SELF-APPROVED, and the only truthful shape available: `app_user_decided_ck`
        // exempts `role = 'demo'` alone, so an active row MUST carry both halves of the
        // decision pair, and naming anybody else would be an approval nobody made.
        decided_by: SUB,
        decided: true,
      },
    ]);
  });

  it('creates no second identity and no second row, and says so', async () => {
    const db = await applied();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, spy().idp);

    const again = spy(SUB);
    const report = await migrate(
      db,
      { mode: 'bootstrap', email: 'owner@quirenote.com' },
      again.idp,
    );
    expect(report.bootstrap).toEqual({
      email: 'owner@quirenote.com',
      identity: 'existing',
      row: 'existing',
      account: 'existing',
    });
    expect(await rows(db)).toHaveLength(1);
    // CONFIRMED rather than assumed on the re-run, or a row whose Cognito user had been
    // deleted would report "existing" and repair nothing.
    expect(again.fetched).toHaveLength(1);
    expect(again.created).toEqual([]);
    expect(await accounts(db, SUB)).toHaveLength(1);
  });

  it('gives the super-admin an account it can write against', async () => {
    const db = await applied();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, spy().idp);
    expect(await accounts(db, SUB)).toEqual([{ provider: 'inzhur', name: 'Inzhur' }]);
  });

  /**
   * A RE-RUN IS THE REPAIR, and this arm is why the provisioning is not tucked behind the branch
   * that writes the row: the clusters already hold a super-admin, so every bootstrap for that
   * address takes the FINISHED path and would otherwise hand back an account-less user — one the
   * gate admits and the mutation surface refuses.
   */
  it('supplies the account a finished row is missing', async () => {
    const db = await applied();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, spy().idp);
    await db.query('DELETE FROM account WHERE user_id = $1', [SUB]);

    const report = await migrate(
      db,
      { mode: 'bootstrap', email: 'owner@quirenote.com' },
      spy(SUB).idp,
    );
    expect(report.bootstrap).toEqual({
      email: 'owner@quirenote.com',
      identity: 'existing',
      row: 'existing',
      account: 'created',
    });
    expect(await accounts(db, SUB)).toHaveLength(1);
  });

  // `app_user_email_lower_ck` must never be the thing that reports this: the runner
  // holds the cluster's admin grant, so a violation here is a half-applied surprise
  // rather than a clean refusal — and the address is operator-typed.
  it('canonicalises the address before the insert, and asks Cognito for the same one', async () => {
    const db = await applied();
    const { idp, created } = spy();
    const report = await migrate(db, { mode: 'bootstrap', email: 'Owner@Quirenote.COM' }, idp);
    expect(report.bootstrap?.email).toBe('owner@quirenote.com');
    expect((created[0] as { Username: string }).Username).toBe('owner@quirenote.com');
    expect((await rows(db))[0].email).toBe('owner@quirenote.com');
  });

  it('refuses an address it cannot canonicalise, before asking Cognito anything', async () => {
    const db = await applied();
    for (const email of [undefined, '', 'not-an-address', 'ольга@quirenote.com']) {
      const { idp, created } = spy();
      await expect(migrate(db, { mode: 'bootstrap', email }, idp)).rejects.toThrow(
        /email must be an address this schema can store/,
      );
      expect([email, created]).toEqual([email, []]);
    }
  });

  // THE INVITATION IS WHAT MAKES THE ACCOUNT USABLE. `AdminCreateUser` mints a
  // temporary password whatever else happens and leaves the user in
  // `FORCE_CHANGE_PASSWORD`, which `ForgotPassword` refuses — suppress the message and
  // the row is perfect and the account unreachable. The medium is named because it
  // DEFAULTS to SMS and this pool carries no phone number.
  it('sends the invitation, by email, rather than suppressing it', async () => {
    const db = await applied();
    const { idp, created } = spy();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp);
    const call = created[0] as { MessageAction?: string; DesiredDeliveryMediums?: string[] };
    expect(call.MessageAction).toBeUndefined();
    expect(call.DesiredDeliveryMediums).toEqual(['EMAIL']);
  });

  // ASKED BEFORE ANYTHING IRREVERSIBLE. `POST /v1/applications` is public, so any
  // address — the owner's own included — can already hold a pending row. Insert-first,
  // that collides on `app_user_email_uq` AFTER an identity has been minted, and wedges:
  // this runner has no `AdminDeleteUser` to undo the identity with.
  it('refuses an address that already applied, without minting an identity', async () => {
    const db = await applied();
    await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at)
                   VALUES ('11111111-0000-4000-8000-000000000001',
                           'owner@quirenote.com', 'pending', 'user', now());`);
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
    ).rejects.toThrow(/already holds an app_user row \(pending\/user\)/);
    expect(created).toEqual([]);
  });

  // THE FIRST super-admin. Without this the second dispatch writes another `active`
  // super-admin for an address nobody approved.
  it('refuses to mint a second super-admin under another address', async () => {
    const db = await applied();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, spy().idp);
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'someone.else@quirenote.com' }, idp),
    ).rejects.toThrow(/super-admin already exists/);
    expect(created).toEqual([]);
  });

  // A REJECTED SUPER-ADMIN IS NOT A SUPER-ADMIN: reject sets the status and the
  // decision pair and never touches `role`, so the row keeps saying `super_admin` after
  // the decision and the look has to exclude it.
  it('is not blocked by a super-admin row that was rejected', async () => {
    const db = await applied();
    await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                   VALUES ('11111111-0000-4000-8000-000000000001',
                           'former@quirenote.com', 'rejected', 'super_admin', now(), now(),
                           '11111111-0000-4000-8000-000000000001');`);
    const { idp, created } = spy();
    const report = await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp);

    expect(created).toHaveLength(1);
    expect(report.bootstrap).toEqual({
      email: 'owner@quirenote.com',
      identity: 'created',
      row: 'created',
      account: 'created',
    });
  });

  // AND THE ADDRESS ITSELF IS STILL REFUSED BY NAME. Narrowing the look must not narrow
  // the arm that finds the caller's own row, or a rejected row at that address reaches
  // the insert and raises `app_user_email_uq` AFTER an identity has been minted.
  it('still refuses a rejected row at the address being bootstrapped', async () => {
    const db = await applied();
    await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                   VALUES ('11111111-0000-4000-8000-000000000002',
                           'owner@quirenote.com', 'rejected', 'super_admin', now(), now(),
                           '11111111-0000-4000-8000-000000000002');`);
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
    ).rejects.toThrow(/already holds an app_user row \(rejected\/super_admin\)/);
    expect(created).toEqual([]);
  });

  // The other way an identity strands: reading first fails with `42P01` one statement
  // before the insert would have.
  it('refuses before Cognito when the schema is not there at all', async () => {
    const db = new PGlite();
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
      // PATTERNED: a bare `toThrow()` here is satisfied by the `USER_POOL_ID` refusal
      // just as well.
    ).rejects.toThrow(/app_user/);
    expect(created).toEqual([]);
  });

  // The pool is the template's to supply, so its absence means the function was
  // deployed without its wiring — it fails before touching either side.
  it('refuses when the function was given no pool', async () => {
    vi.stubEnv('USER_POOL_ID', '');
    const db = await applied();
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
    ).rejects.toThrow(/USER_POOL_ID/);
    expect(created).toEqual([]);
  });

  // THE REHEARSE TAIL HAS NO GUARD OF ITS OWN — it is the fall-through — so a new mode
  // added without an early return lands in `CREATE SCHEMA`, having created nothing.
  it('does not fall through into the rehearsal', async () => {
    const db = await applied();
    const report = await migrate(
      db,
      { mode: 'bootstrap', email: 'owner@quirenote.com' },
      spy().idp,
    );
    expect(report.schema).toBe('public');
    expect(report.files).toEqual([]);
    const schemas = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(schemas.rows).toEqual([]);
    const path = await db.query<{ search_path: string }>('SHOW search_path');
    expect(path.rows[0].search_path).toContain('public');
  });
});
