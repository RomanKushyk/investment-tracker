// The migration RUNNER, which is W7's actual first contact with the cluster.
//
// Both first contacts have happened — the DDL's, and now the runner's, both
// recorded in `infra/docs/dsql-constraints.md`. What this file covers is the
// part a cluster round cannot repeat cheaply: the re-run and crash paths, which
// exist because the generated DDL carries no `IF NOT EXISTS` and DSQL has no
// cross-statement rollback, so a half-applied file cannot simply be re-run.
//
// PGlite covers the applier; the rewrite is covered as text, because the three
// promotion rules produce SQL that PGlite refuses BY DESIGN — `CREATE INDEX
// ASYNC` is DSQL-only. That is why the module keeps the rewrite and the apply
// apart: only the unrewritten half can be executed here.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { SqlClient } from './migrate';
import {
  MIGRATIONS,
  applyFile,
  dropRehearsalSchema,
  ensureLedger,
  migrate,
  rewriteForDsql,
  statementsOf,
} from './migrate';

const read = (file: string) =>
  readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');

const USER_SCHEMA = '003_user_schema.sql';
const DEMO_ROW = '005_demo_user.sql';
const CASE_RULE = '006_email_lower.sql';

describe('the file list', () => {
  // NOT A GLOB, deliberately. `001`, `002` and `004` are the ARCHIVE's, applied
  // by `ensureSchema` in capture.ts, and a tool globbing `migrations/**/*.sql`
  // by filename would run the user schema before them — the ambiguity the
  // numbering rule exists to remove.
  it('names the user schema, the demo row and the case rule, in that order, and nothing else', () => {
    expect(MIGRATIONS).toEqual([USER_SCHEMA, DEMO_ROW, CASE_RULE]);
  });
});

describe('statementsOf', () => {
  const stmts = statementsOf(read(USER_SCHEMA));

  it('splits the generated schema into its twelve statements', () => {
    // Five CREATE TABLE, five ALTER TABLE … ADD CONSTRAINT for the foreign
    // keys, two CREATE INDEX.
    expect(stmts).toHaveLength(12);
  });

  it('splits the case rule into its one statement', () => {
    // Hand-written and one statement, so it carries no breakpoint marker —
    // the same shape as `005`.
    expect(statementsOf(read(CASE_RULE))).toHaveLength(1);
  });

  it('leaves no breakpoint marker inside a statement', () => {
    for (const s of stmts) expect(s).not.toContain('statement-breakpoint');
  });

  // The generated file wraps two CHECKs across a line, with an eight-space
  // indent on the second. Splitting on `;` instead of the marker is what would
  // survive the count above and then mangle a real statement, so both halves of
  // one wrapped CHECK are asserted to be in ONE statement.
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

  // MEASURED, not hypothetical: `005`'s header gained a line explaining that a
  // second statement would need drizzle's marker, quoted it, and split the file
  // in half — the statement that reached PGlite began with a stray backtick.
  // Stripping comments BEFORE splitting is the fix, and this is the case that
  // tells the two orders apart.
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
  // The four promotion rules, `infra/docs/dsql-constraints.md`. Each was
  // measured against the live cluster, and doing any one of them alone still
  // leaves a statement the cluster refuses.
  it('appends NOT VALID to the case rule, which is why the file does not', () => {
    // DSQL refuses `ADD CONSTRAINT` without it. The file writing it too would
    // produce a second one, which is what the rule's idempotence prevents.
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

  // MEASURED, and it is what settles the question #47 carried as obligation 8:
  // "whether the schema qualification is harmless is UNKNOWN". It is not. A
  // qualified name ignores `search_path`, so a rehearsal into a throwaway schema
  // built its keys against the REAL `public` tables — which fails loudly where
  // `public` is empty and would succeed SILENTLY where it is not, leaving a
  // constraint pointing at production rows and then dropping the referencing
  // side out from under it.
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
    // The five keys are real now, so the assertion two cases down runs this
    // rule over the generated statements. This one stays because it names the
    // rule in a single line.
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

  // A runner that rewrote an already-rewritten statement would emit
  // `CREATE INDEX ASYNC ASYNC` or a second `NOT VALID`, and both are syntax
  // errors the cluster reports as the caller's fault.
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

  // THE LEDGER HASHES THE SOURCE, NOT WHAT REACHES THE CLUSTER, which is what
  // lets `send` change without re-presenting every statement as new. This
  // repository has twice recorded a DSQL limitation that a later release note
  // had already lifted, so relaxing a rewrite rule is a real event — and under
  // a rewritten-text key it would rehash the two index lines, re-execute them,
  // take a 42P07 and abort the run.
  //
  // Nothing executes on the second pass, so PGlite never meets the `ASYNC` it
  // could not run.
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

  // THE CRASH WINDOW. DSQL forbids DDL and DML in one transaction, so there is
  // no way to stamp the ledger and run the statement atomically. The runner
  // writes the row FIRST with a NULL `applied_at`, which is what makes the
  // window a named state rather than an ambiguity: on a re-run exactly that one
  // statement may answer "already exists" with success.
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

  // An INDEX rather than a table, because the absorb path does more for one: an
  // index that exists is not yet an index that works, so it re-checks
  // `pg_index.indisvalid` instead of stamping on the strength of the refusal.
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

  // The other half, and the reason the absorption above is not a blanket catch:
  // an object this runner has no record of opening is someone else's, and
  // applying over it silently is how two schemas become one nobody can read.
  //
  // THREE RUNS, NOT TWO, and the third is the whole test. A version of this
  // that stopped at the second passed while the refusal survived exactly one
  // attempt: the open row written just before the failed statement was left
  // behind, so the NEXT run found the hash open, absorbed the very error this
  // one refused, and adopted the foreign object. The row is withdrawn on a
  // raised error precisely so that the refusal is permanent.
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

  // THE OTHER HALF OF THE SAME RULE, and withdrawing on every error broke it:
  // `pg` reports a dropped connection with NO SQLSTATE, so an error carrying no
  // code is a statement whose fate is unknown — not proof it failed. Deleting
  // the row there also destroys a PREVIOUS run's crash evidence, and the state
  // that leaves cannot be recovered by re-running at all.
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

  // A failure AFTER the statement is not the statement failing. The index job
  // wait runs once `client.query` has returned, so the DDL is already on the
  // cluster — withdrawing there left an index nothing could ever adopt, and
  // every later run died on a bare `already exists`.
  it('keeps the row when the statement landed and the work after it failed', async () => {
    const index = stmts.findIndex((s) => s.startsWith('CREATE INDEX'));
    let landed = false;
    // THE STATEMENT HAS TO ACTUALLY LAND, which an earlier version of this test
    // did not arrange: it sent the rewritten `CREATE INDEX ASYNC`, PGlite
    // refused it at parse with `42601`, the mock's own throw was never reached,
    // and the bare `rejects.toThrow()` was satisfied by the wrong error — so the
    // region this test exists to guard had no coverage at all. `ASYNC` is
    // stripped back out on the way to PGlite, and the assertion names the
    // failure it means.
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

  // The ledger's key is `(file, stmt_sha256)`, so the second of two identical
  // statements collided on it and aborted with a duplicate-key error that read
  // as a cluster fault. #47 appends generated statements to `003`, which is
  // when a file could first grow one by accident.
  it('names the file when it repeats a statement byte for byte', async () => {
    await expect(applyFile(db, USER_SCHEMA, [...stmts, stmts[0]])).rejects.toThrow(
      /repeats a statement byte for byte/,
    );
  });

  // The same window over DML, and it raises NOTHING rather than being absorbed:
  // `005` carries `ON CONFLICT (user_id) DO NOTHING`, so a re-run is silent and
  // `23505` is left meaning a real collision — an address already taken, say,
  // which must stop the run rather than stamp a file whose row never landed.
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

// `40001` IS CONTENTION, NOT A REFUSAL, and the teardown was the one place in
// the design that met one and gave up. Dropping a six-table schema is a large
// catalogue change issued right behind two `CREATE INDEX ASYNC` jobs, and a
// waited-for job is not a settled catalogue — the drop that failed this way then
// succeeded by hand on its first attempt.
const conflict = () =>
  Object.assign(new Error('change conflicts with another transaction (OC000)'), {
    code: '40001',
  });

// A REHEARSAL CANNOT REACH ITS OWN TEARDOWN UNDER PGlite unaided: `rewriteForDsql`
// emits `CREATE INDEX ASYNC`, which the engine refuses, and `waitForIndexJob` then
// reads the un-stripped text and wants a job id out of the rows. This plays those
// two DSQL verbs and hands everything else to the engine.
//
// It plays them SETTLED — an index valid the moment it returns, a job already
// complete — which is the very condition a real cluster is thought to violate
// here. So these tests pin the report and the resolve-or-raise split, and cannot
// speak to whether the retry defeats the real conflict.
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

// Each exhausting retry spends the real backoff, which is comfortably inside the
// suite's default per-test budget only when the machine is not contended.
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

  // A CONFLICT IS THE CLIENT'S VIEW, NOT THE CLUSTER'S: an attempt can commit
  // and still answer `40001`. `IF EXISTS` is what keeps the retry from meeting
  // `3F000` — a refusal, so it is not retried — and reporting a schema that is
  // already gone as one the operator has to go and drop.
  //
  // DSQL accepts `DROP SCHEMA IF EXISTS … CASCADE`, schema present or absent;
  // measured on the dev cluster and recorded in `infra/docs/dsql-constraints.md`.
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
    // THE POINT OF THE TEST, and without it this is its sibling above wearing a
    // different name: the retry has to have met a schema that was ALREADY GONE.
    expect(goneByTheRetry).toBe(true);
  });

  // BOUNDED, because the alternative to giving up is holding the invocation
  // open against a conflict that may never clear. What it reports is what the
  // operator needs to finish the job by hand.
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

  // A REFUSAL IS REPORTED, NEVER HAMMERED. Retrying something the cluster will
  // not do spends the whole backoff to reach the same answer.
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
  // NO SAFE DEFAULT FOR A VERB THIS DESTRUCTIVE. An earlier shape took
  // `rehearse?: boolean` and fell through to the real apply for anything else,
  // so `{"rehearse":"true"}` — a quoted boolean, which is what a hand-typed
  // `aws lambda invoke` produces — migrated production while reading as a
  // rehearsal, and `role-deploy.md` grants exactly that invoke.
  it('refuses a missing or unrecognised mode rather than choosing one', async () => {
    const db = new PGlite();
    await expect(migrate(db, {})).rejects.toThrow(/mode must be one of/);
    await expect(migrate(db, { mode: 'rehearsal' } as never)).rejects.toThrow(
      /mode must be one of/,
    );
    await expect(migrate(db, { mode: true } as never)).rejects.toThrow(/mode must be one of/);
  });

  // The dry run is what covers the file RESOLUTION, which the deploy's CommonJS
  // bundle would otherwise be the first thing to exercise: `import.meta.url` is
  // empty in that format, so the path is built from `LAMBDA_TASK_ROOT` with the
  // repository root as the fallback this test runs under.
  //
  // `pending`, NOT `skipped`. An earlier version reported every statement as
  // skipped whatever the cluster held, so an operator dry-running an EMPTY one
  // read `{applied: 0, skipped: 12}` as "nothing to do" — the exact opposite of
  // the truth, and the CI smoke step had pinned that reading.
  it('reports what is still to run, against a cluster with no ledger at all', async () => {
    const db = new PGlite();
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 0, pending: 12 },
        { file: DEMO_ROW, applied: 0, skipped: 0, pending: 1 },
        { file: CASE_RULE, applied: 0, skipped: 0, pending: 1 },
      ],
    });
  });

  it('reports nothing pending once the ledger says everything applied', async () => {
    const db = new PGlite();
    await ensureLedger(db);
    await applyFile(db, USER_SCHEMA, statementsOf(read(USER_SCHEMA)));
    await applyFile(db, DEMO_ROW, statementsOf(read(DEMO_ROW)));
    await applyFile(db, CASE_RULE, statementsOf(read(CASE_RULE)));
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 12, pending: 0 },
        { file: DEMO_ROW, applied: 0, skipped: 1, pending: 0 },
        { file: CASE_RULE, applied: 0, skipped: 1, pending: 0 },
      ],
    });
  });

  // REHEARSE is the workflow's default and had no coverage at all. The rewrite
  // makes the statements unrunnable here — `ASYNC` is DSQL-only — so what is
  // asserted is the part that is engine-neutral and was wrong twice: the schema
  // is created and then dropped, `search_path` goes back to `public`, and the
  // failure the rehearsal was run to find is the one that surfaces rather than
  // the cleanup's.
  // THE CLEANUP MUST NOT REPLACE THE FAILURE, and a bare `rejects.toThrow()`
  // could not tell whether it did: under PGlite the drop succeeds, so the old
  // `finally { DROP SCHEMA }` shape would have passed this too. The drop is
  // forced to fail here, and the assertion is that the STATEMENT's error is
  // still the one that surfaces.
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

  // AND NOT ON A RUN THAT CLEANED UP AFTER ITSELF. The note is appended only
  // when the schema outlived the run; on the ordinary failure — statements
  // refused, drop fine — it would send an operator after a schema that is not
  // there, which is the same wrong answer this issue started from.
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

  // THE SHAPE EVERY RUN THAT CLEANS UP AFTER ITSELF RETURNS. The key's ABSENCE
  // is what gives its presence meaning, and it is what the workflow's check
  // falls through on — so it is worth a test of its own.
  it('omits the teardown key entirely when it drops its schema', async () => {
    const db = new PGlite();
    const report = await migrate(dsqlish(db), { mode: 'rehearse' });
    expect('teardown' in report).toBe(false);
    const { rows } = await db.query<{ nspname: string }>(
      `SELECT nspname FROM pg_namespace WHERE nspname LIKE 'migrate_rehearsal_%'`,
    );
    expect(rows).toEqual([]);
  });

  // A REHEARSAL THAT APPLIED CLEANLY AND THEN COULD NOT DROP ITS SCHEMA IS NOT
  // A FINDING, and must not read as one: the statements are what the mode
  // exists to test, and nothing was wrong with them. So it RESOLVES, carrying
  // the name of the schema it left behind — the one thing the operator needs,
  // and the only place they will see it short of CloudWatch.
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
        { file: USER_SCHEMA, applied: 12, skipped: 0, pending: 0 },
        { file: DEMO_ROW, applied: 1, skipped: 0, pending: 0 },
        { file: CASE_RULE, applied: 1, skipped: 0, pending: 0 },
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

  // THE ORPHAN IS NAMED ON BOTH PATHS. The statement's failure still outranks
  // the cleanup's — the test two above pins that — but when the drop failed
  // too, the schema is on the cluster and the raised message is the only thing
  // the operator reads.
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

describe('the demo user', () => {
  // One literal, in one place. #50's seed and #137's public route both have to
  // name this row, and a second copy of the id is a second source of truth.
  it('is the row the migration writes', () => {
    const sql = read(DEMO_ROW);
    expect(sql).toContain(DEMO_USER_ID);
    expect(sql).toContain(DEMO_USER_EMAIL);
  });

  // The address is under the owner's own SES-verified domain, which is what
  // stops a real applicant ever arriving holding it — see `app_user_email_uq`'s
  // comment in `infra/schema/user.ts`.
  it('holds an address the owner controls', () => {
    expect(DEMO_USER_EMAIL.endsWith('@quirenote.com')).toBe(true);
  });

  // `006` refuses anything else. `NOT VALID` spares a row already present the
  // initial scan, but on stock Postgres not a later write — the CHECK runs on
  // every UPDATE of it, whatever column is touched — so a capital here would
  // make the demo row unupdatable rather than harmlessly exempt. That half is
  // measured on PGlite and unprobed on DSQL; what is certain either way is that
  // DSQL refuses `VALIDATE CONSTRAINT`, so nothing goes looking later.
  it('is already the canonical spelling `006` requires', () => {
    expect(DEMO_USER_EMAIL).toBe(DEMO_USER_EMAIL.toLowerCase());
  });
});

describe('the bootstrap mode makes the one account that can approve the others', () => {
  // THE SUB IS NOT THIS FILE'S TO INVENT. `user_id` holds the Cognito `sub` and only
  // `AdminCreateUser` mints one, which is the whole reason this is a runner mode rather
  // than a line in `003`: a migration could not produce the value, and `005` gets away
  // with a pinned literal only because the demo identity must never gain a provider
  // account at all.
  const SUB = '9f1e2d3c-0000-4000-8000-00000000ad11';
  const POOL = 'eu-north-1_EXAMPLE';

  // The pool reaches this mode as an environment variable, because a hand-typed invoke
  // carries no pool the way a Cognito trigger's event does. Stubbed rather than assumed,
  // and restored after — a shell that happened to export it would make the refusal below
  // pass for the wrong reason.
  beforeEach(() => {
    vi.stubEnv('USER_POOL_ID', POOL);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Records what the runner asked Cognito for, in the shape `pre-signup.test.ts` uses. */
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

  it('creates the identity and one row keyed by the sub the create call returned', async () => {
    const db = await applied();
    const { idp, created } = spy();
    const report = await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp);

    expect(created).toHaveLength(1);
    expect(report.bootstrap).toEqual({
      email: 'owner@quirenote.com',
      identity: 'created',
      row: 'created',
    });
    expect(await rows(db)).toEqual([
      {
        user_id: SUB,
        email: 'owner@quirenote.com',
        status: 'active',
        role: 'super_admin',
        // SELF-APPROVED, and it is the only truthful shape available.
        // `app_user_decided_ck` exempts `role = 'demo'` alone, so an active row MUST
        // carry both halves of the pair — and naming anybody else would be a
        // fabricated approval by somebody who never ruled on it.
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
    });
    expect(await rows(db)).toHaveLength(1);
    // The identity is CONFIRMED rather than assumed on the re-run — otherwise a row
    // whose Cognito user had been deleted would report "existing" and repair nothing.
    expect(again.fetched).toHaveLength(1);
    expect(again.created).toEqual([]);
  });

  // `app_user_email_lower_ck` must never be the thing that reports this. The runner
  // holds the cluster's admin grant, so a constraint violation here is a half-applied
  // surprise rather than a clean refusal — and the address is operator-typed, which is
  // exactly where a capital letter comes from.
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

  // THE INVITATION IS WHAT MAKES THE ACCOUNT USABLE, and suppressing it was the trap.
  // `AdminCreateUser` generates a temporary password whatever else happens and leaves the
  // user in `FORCE_CHANGE_PASSWORD`; nobody told the password cannot sign in, and
  // `ForgotPassword` refuses a user in that state — so the mode would have produced a
  // perfect row attached to an account nobody could get into. The medium is named because
  // it DEFAULTS to SMS and this pool carries no phone number.
  it('sends the invitation, by email, rather than suppressing it', async () => {
    const db = await applied();
    const { idp, created } = spy();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp);
    const call = created[0] as { MessageAction?: string; DesiredDeliveryMediums?: string[] };
    expect(call.MessageAction).toBeUndefined();
    expect(call.DesiredDeliveryMediums).toEqual(['EMAIL']);
  });

  // ASKED BEFORE ANYTHING IRREVERSIBLE. `POST /v1/applications` is public, so any address
  // — including the owner's own, most likely from testing it — can already hold a pending
  // row. Insert-first, that collides on `app_user_email_uq` AFTER a Cognito identity has
  // been minted, raises a raw constraint message, and wedges: every re-run repeats it, and
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

  // THE FIRST super-admin, which is what the mode is named for in three places. Without
  // this the second dispatch writes another `active` super-admin for an address nobody
  // approved — the property the whole approval gate exists to hold.
  it('refuses to mint a second super-admin under another address', async () => {
    const db = await applied();
    await migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, spy().idp);
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'someone.else@quirenote.com' }, idp),
    ).rejects.toThrow(/super-admin already exists/);
    expect(created).toEqual([]);
  });

  // A REJECTED SUPER-ADMIN IS NOT A SUPER-ADMIN. Reject sets the status and the decision pair
  // and never touches `role`, so the row keeps saying `super_admin` after the decision — and
  // this look used to read it as one, which made the mode throw for EVERY address, forever. No
  // endpoint could undo it: approve refuses a non-pending row and the gate refuses the caller,
  // so the only repair was hand-written SQL against the cluster.
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
    });
  });

  // AND THE ADDRESS ITSELF IS STILL REFUSED BY NAME. Narrowing the look must not narrow the arm
  // that finds the caller's own row: without it a rejected row at the same address reaches the
  // insert and raises `app_user_email_uq` AFTER an identity has been minted, which is the exact
  // stranding this mode asks the database everything first to avoid.
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

  // The schema not being applied yet is the other way this used to strand an identity: the
  // read fails with `42P01` where the insert would have, which is one statement later.
  it('refuses before Cognito when the schema is not there at all', async () => {
    const db = new PGlite();
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
      // PATTERNED. A bare `toThrow()` here is satisfied by the USER_POOL_ID refusal just
      // as well, which is the trap this file already records at the unrecognised-mode case.
    ).rejects.toThrow(/app_user/);
    expect(created).toEqual([]);
  });

  // The pool is the template's to supply, and its absence means the function was deployed
  // without the wiring rather than that the operator typed something wrong — so it fails
  // before touching either side rather than creating an identity in no pool.
  it('refuses when the function was given no pool', async () => {
    vi.stubEnv('USER_POOL_ID', '');
    const db = await applied();
    const { idp, created } = spy();
    await expect(
      migrate(db, { mode: 'bootstrap', email: 'owner@quirenote.com' }, idp),
    ).rejects.toThrow(/USER_POOL_ID/);
    expect(created).toEqual([]);
  });

  // THE REHEARSE TAIL HAS NO GUARD OF ITS OWN — it is the fall-through — so a fourth
  // mode added without its own early return lands in `CREATE SCHEMA` and drops it
  // again, having created nothing and reported a rehearsal.
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
