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
import { beforeEach, describe, expect, it } from 'vitest';

import { DEMO_USER_EMAIL, DEMO_USER_ID } from './demo-user';
import type { SqlClient } from './migrate';
import {
  MIGRATIONS,
  applyFile,
  ensureLedger,
  migrate,
  rewriteForDsql,
  statementsOf,
} from './migrate';

const read = (file: string) =>
  readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8');

const USER_SCHEMA = '003_user_schema.sql';
const DEMO_ROW = '005_demo_user.sql';

describe('the file list', () => {
  // NOT A GLOB, deliberately. `001`, `002` and `004` are the ARCHIVE's, applied
  // by `ensureSchema` in capture.ts, and a tool globbing `migrations/**/*.sql`
  // by filename would run the user schema before them — the ambiguity the
  // numbering rule exists to remove.
  it('names the user schema and the demo row, in that order, and nothing else', () => {
    expect(MIGRATIONS).toEqual([USER_SCHEMA, DEMO_ROW]);
  });
});

describe('statementsOf', () => {
  const stmts = statementsOf(read(USER_SCHEMA));

  it('splits the generated schema into its seven statements', () => {
    expect(stmts).toHaveLength(7);
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
  // The three promotion rules, `infra/docs/dsql-constraints.md`. Each was
  // measured against the live cluster, and doing any one of them alone still
  // leaves a statement the cluster refuses.
  it('inserts ASYNC and strips USING btree from an index line', () => {
    expect(
      rewriteForDsql(
        'CREATE INDEX "asset_user_created" ON "asset" USING btree ("user_id","created_at");',
      ),
    ).toBe('CREATE INDEX ASYNC "asset_user_created" ON "asset" ("user_id","created_at");');
  });

  it('appends NOT VALID to an ADD CONSTRAINT', () => {
    // Nothing emits one until the five foreign keys land (#47); the rule ships
    // now because promotion is what will apply them.
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
    for (const s of statementsOf(read(USER_SCHEMA))) {
      expect(rewriteForDsql(rewriteForDsql(s))).toBe(rewriteForDsql(s));
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
      applied: 7,
      skipped: 0,
      pending: 0,
    });
    expect(await applyFile(db, USER_SCHEMA, stmts)).toEqual({
      file: USER_SCHEMA,
      applied: 0,
      skipped: 7,
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
      skipped: 7,
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
      skipped: 6,
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
      skipped: 6,
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
  // read `{applied: 0, skipped: 7}` as "nothing to do" — the exact opposite of
  // the truth, and the CI smoke step had pinned that reading.
  it('reports what is still to run, against a cluster with no ledger at all', async () => {
    const db = new PGlite();
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 0, pending: 7 },
        { file: DEMO_ROW, applied: 0, skipped: 0, pending: 1 },
      ],
    });
  });

  it('reports nothing pending once the ledger says everything applied', async () => {
    const db = new PGlite();
    await ensureLedger(db);
    await applyFile(db, USER_SCHEMA, statementsOf(read(USER_SCHEMA)));
    await applyFile(db, DEMO_ROW, statementsOf(read(DEMO_ROW)));
    expect(await migrate(db, { mode: 'dry-run' })).toEqual({
      mode: 'dry-run',
      schema: 'public',
      files: [
        { file: USER_SCHEMA, applied: 0, skipped: 7, pending: 0 },
        { file: DEMO_ROW, applied: 0, skipped: 1, pending: 0 },
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
    await expect(migrate(brittle, { mode: 'rehearse' })).rejects.toThrow(/ASYNC|syntax/i);
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
});
