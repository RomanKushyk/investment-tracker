// The migration runner — W7's first contact with the cluster.
//
// The DDL's own first contact already happened, and so now has this file's:
// `infra/docs/dsql-constraints.md` records both, the second in *The migration
// runner against the live cluster*. The rules below are why it is not a loop
// over `client.query`.
//
// THE GENERATED DDL IS NOT REPLAYABLE. The archive's DDL is hand-written and
// every statement carries `IF NOT EXISTS`, which is what lets `ensureSchema`
// (`capture.ts`) run on every invocation. drizzle-kit can emit neither that nor
// `CREATE INDEX IF NOT EXISTS`, so every statement in `003` is a bare `CREATE`.
// DSQL runs one DDL statement per transaction with no cross-statement rollback,
// so a file that fails partway through cannot simply be re-run: the retry dies
// on the first statement, which already exists. Hence the ledger.
//
// THE FOUR PROMOTION REWRITE RULES, measured against the cluster and recorded
// in `infra/docs/dsql-constraints.md`: insert `ASYNC` into every `CREATE INDEX`
// (`0A000 unsupported mode`), strip `USING btree` (`0A000 USING not supported
// for CREATE INDEX`), and append `NOT VALID` to every `ALTER TABLE … ADD
// CONSTRAINT` (`0A000 unsupported ALTER TABLE ADD CONSTRAINT statement`), and
// strip the schema drizzle hard-codes onto a key's target, which is about WHERE
// the statement lands rather than whether the cluster accepts it.
// Neither of the first two may live in the committed file: `ASYNC` is a syntax
// error on stock Postgres, and `USING btree` is what `user-schema.test.ts`
// applies to PGlite. So the rewrite happens here, on the way out.
//
// THE REWRITE IS NOT PART OF A STATEMENT'S IDENTITY. The ledger hashes the
// SOURCE text and `send` transforms it on the way to the cluster — which is why
// `applyFile` takes the transform rather than the caller applying it first. Two
// things follow, and both matter: the PGlite suite stores the same hashes
// production does, so the tests cover the real bookkeeping rather than a
// parallel one; and relaxing a rewrite rule — which this repository has twice
// had to do when DSQL lifted a limitation — does not re-present every index
// line as a new statement.
//
// AN ACCEPTED `CREATE INDEX ASYNC` IS NOT A BUILT INDEX. It returns a job id,
// and `sys.wait_for_job` is a PROCEDURE — `CALL`, never `SELECT`, which fails
// `42809`. A failed job leaves an `INVALID` definition AWS does not clean up —
// but so does a build still running, and `indisvalid` is false for both. So the
// absorb path finds the job again through `sys.jobs.object_name` and WAITS,
// rather than deciding from a flag which of the two it is looking at.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { canonicalAddress } from './address';
import { connect } from './dsql';

/**
 * The files this runner applies, in order — NOT a glob.
 *
 * `001`, `002` and `004` are the ARCHIVE's, applied by `ensureSchema` in
 * `capture.ts`, and they must stay there: the archive is provider data shared
 * by every environment, while these two are USER data, which splits dev from
 * prod (`docs/DECISIONS.md`, **Cloud target**). A tool globbing
 * `migrations/**` by filename would also run the user schema before the archive
 * tables, which is the ambiguity the numbering rule exists to remove.
 *
 * `005` is DML and depends on `003` having applied. Order is the guarantee.
 *
 * `006` constrains a table `003` creates, so it cannot precede it. Its position
 * relative to `005` is NOT load-bearing: the seeded address is already
 * lower-cased, so it is accepted whether the constraint checks it as a new row
 * or skips it as an old one. Numbering is the whole of why it sits last.
 */
export const MIGRATIONS = [
  '003_user_schema.sql',
  '005_demo_user.sql',
  '006_email_lower.sql',
] as const;

/** What both `pg` and PGlite give back, and all this module needs of either. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

const BREAKPOINT = '--> statement-breakpoint';

/**
 * One string per statement.
 *
 * Split on drizzle's own marker, never on `;`. `drizzle.config.ts` sets
 * `breakpoints: true` for exactly this, and the generated file wraps two CHECKs
 * across a line — a `;` split reproduces the statement COUNT and then mangles a
 * real statement, which is the failure the test pins.
 *
 * The marker is not line-anchored on purpose: drizzle puts it on its own line
 * between tables but appends it to the terminating `;` of an index line.
 *
 * **A HAND-WRITTEN FILE OBEYS THE SAME CONVENTION.** `005` is one statement and
 * needs no marker; a second statement added there without one would be glued
 * into the first and sent as a single query, which DSQL refuses for mixing two
 * statements in a transaction. Its own header says so.
 *
 * Comment lines are dropped BEFORE the split, and the marker is the one
 * `--` line kept. Two reasons, and the second was found the hard way: a
 * hand-written file's header must not enter the hash the ledger is keyed by, or
 * editing a comment would present the statement as new and re-apply it; and a
 * comment that MENTIONS the marker must not split the file. The sentence above
 * quoted it and cut this very file's header in half, which is the whole
 * argument for stripping first rather than after.
 *
 * Two shapes this does not handle, neither of which occurs: a `--` at the start
 * of a line inside a string literal is dropped as a comment, and a C-style
 * block comment is not stripped at all, so one quoting the marker inside it
 * would still split the file. `user-schema.test.ts` applies the same function, so the
 * suite that certifies the DDL validates the statements the runner sends rather
 * than a set of its own.
 */
export function statementsOf(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return !trimmed.startsWith('--') || trimmed === BREAKPOINT;
    })
    .join('\n')
    .split(BREAKPOINT)
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0);
}

/**
 * The four rewrite rules.
 *
 * Idempotent by construction — a runner that rewrote an already-rewritten
 * statement would emit `CREATE INDEX ASYNC ASYNC` or a second `NOT VALID`, and
 * the cluster reports both as the caller's fault.
 *
 * `NOT VALID` goes on every `ADD CONSTRAINT` this repository can generate, which
 * is CHECK and FOREIGN KEY. It is deliberately not conditional on which: DSQL
 * refuses `UNIQUE … NOT VALID` and `PRIMARY KEY … NOT VALID`, but it refuses
 * those `ADD CONSTRAINT`s outright in either spelling
 * (`infra/docs/dsql-constraints.md`), so the clause adds no failure that was not
 * already there — and drizzle emits both inline in `CREATE TABLE` anyway.
 */
export function rewriteForDsql(statement: string): string {
  let out = statement;
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(out)) {
    out = out.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)(?!\s+ASYNC\b)/i, '$1 ASYNC');
    out = out.replace(/\s+USING\s+btree\s*/i, ' ');
  }
  if (/^ALTER\s+TABLE\b/i.test(out) && /\bADD\s+CONSTRAINT\b/i.test(out)) {
    // THE FOURTH RULE, and it is about WHERE the statement lands rather than
    // whether DSQL accepts it. Drizzle hard-codes the schema on a foreign key's
    // target — `REFERENCES "public"."app_user"(…)` — and a qualified name
    // ignores `search_path`. Applied to `public` that is merely redundant;
    // applied inside the runner's own rehearsal schema it reaches back out and
    // builds the constraint against the REAL `public` table, then drops the
    // referencing side from under it. The rehearsal would stop being a
    // rehearsal, silently, on any cluster where `public` is populated — and
    // loudly on one where it is not, which is how this was found.
    //
    // Stripping the qualifier is right rather than merely convenient: every
    // table this schema declares lives in one schema, whichever one that is, so
    // resolving through `search_path` is what the statement means.
    out = out.replace(/\bREFERENCES\s+"public"\."/gi, 'REFERENCES "');
    if (!/\bNOT\s+VALID\b/i.test(out)) out = out.replace(/;?\s*$/, ' NOT VALID;');
  }
  return out;
}

const sha256 = (stmt: string) => createHash('sha256').update(stmt, 'utf8').digest('hex');

/**
 * The ledger, and the one table in this system whose own DDL may be replayed.
 *
 * It is hand-written, so it CAN carry `IF NOT EXISTS` — which is what makes the
 * runner's state safe to re-establish while the DDL it tracks is not. It is
 * deliberately not taught to `ensureSchema`: that function owns the archive and
 * `migrations/drafts/README.md` forbids it learning user tables. This is
 * neither; it is the runner's own bookkeeping.
 *
 * KEYED BY CONTENT HASH, not by position. #47 appends five
 * `ALTER TABLE … ADD CONSTRAINT` statements to `003`, and a hash key is what
 * lets the same file be re-run then: the seven already applied are recognised
 * wherever they sit, and only the five new ones execute.
 */
export async function ensureLedger(client: SqlClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      file TEXT NOT NULL,
      stmt_sha256 TEXT NOT NULL,
      stmt_index INT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      applied_at TIMESTAMPTZ,
      PRIMARY KEY (file, stmt_sha256))`);
}

export interface FileReport {
  file: string;
  /** Statements this run sent, or adopted after finding its own work done. */
  applied: number;
  /** Statements a previous run had already finished. */
  skipped: number;
  /** Statements still to run. Always 0 after a successful apply. */
  pending: number;
}

/**
 * `42P07` duplicate RELATION — a table, and an index too, which is the one
 * worth knowing: an existing index reports as a duplicate relation rather than
 * `42710`, measured on the cluster. `42710` is a duplicate object, which is
 * what a constraint would raise.
 *
 * `23505` is deliberately ABSENT. It was here for the demo INSERT, but a
 * unique violation does not say WHICH constraint without further work, and
 * `app_user_email_uq` can raise it for a row that is not the demo's at all —
 * which would have stamped `005` applied with no demo row in the table, for
 * #50's seed and #137's public read to discover as an empty portfolio. `005`
 * carries `ON CONFLICT (user_id) DO NOTHING` instead, so its re-run raises
 * nothing and a `23505` from it is a real collision that must stop the run.
 */
const ALREADY_THERE = new Set(['42P07', '42710']);

/**
 * A SQLSTATE, or nothing.
 *
 * `String(err.code)` was wrong twice over: an error carrying `code: undefined`
 * came back as the STRING `'undefined'`, which reads as a code that is simply
 * not in any set, and a transport failure's `ECONNRESET` is a Node code rather
 * than anything the server said.
 */
const codeOf = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
};

/**
 * `CREATE INDEX [ASYNC] [IF NOT EXISTS] "name" ON …` — the name EXACTLY as
 * written, quotes and all, because `::regclass` case-folds an unquoted
 * identifier and does not fold a quoted one. Stripping the quotes first made a
 * camelCase index resolve to its lower-cased spelling and raise `42P01` instead
 * of being found.
 *
 * `IF NOT EXISTS` is matched even though nothing this runner applies uses it —
 * the archive's hand-written DDL does, and without this clause such a line would
 * report its index as being named `IF`.
 */
const INDEX_NAME =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:ASYNC\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[^\s(]+)/i;

/**
 * Apply one file's statements, skipping the ones this ledger has already seen.
 *
 * `send` is what reaches the cluster; the LEDGER hashes what it was given. The
 * two differ in production and are the same in the PGlite suite, which is the
 * point — see the header.
 *
 * THE CRASH WINDOW IS NAMED RATHER THAN AVOIDED. DSQL forbids DDL and DML in
 * one transaction, so the ledger row and the statement it tracks cannot be
 * written atomically — there is no arrangement of the two that closes the gap.
 * What closes the AMBIGUITY is writing the row FIRST with a NULL `applied_at`,
 * so a re-run knows exactly which statement it was in the middle of, and
 * exactly that one may answer "already exists" with success.
 *
 * AND THE ROW IS WITHDRAWN ONLY WHEN THE SERVER REFUSED THE STATEMENT THIS RUN
 * OPENED. Leaving it after a refusal would hand the NEXT run a licence to
 * absorb the very error this one rejected, so an object the runner never
 * created would be adopted on the second attempt — which is why the test runs
 * three times rather than twice.
 *
 * But "it raised, so it did not land" is false three ways, and withdrawing on
 * all of them is worse than the defect it fixes, because the result is a state
 * no re-run can leave:
 *
 *   - a failure AFTER the statement — the index job wait — where the DDL is
 *     already on the cluster. So the wait happens outside the withdraw-eligible
 *     region: once `client.query` returns, the row stays whatever happens next.
 *   - a TRANSPORT failure, where the statement's fate is unknown. A dropped
 *     connection is not the server refusing anything.
 *   - a row a PREVIOUS run left open, which is evidence this run did not create
 *     and must not destroy. Hence `openedHere` rather than the absence of the
 *     hash from `open`.
 *
 * So the withdrawal is narrowed to exactly the shape it was added for — this
 * run opened the row and the object was ALREADY THERE — and every other failure
 * keeps it. A kept row is at worst a statement a later run re-attempts and
 * refuses identically; a withdrawn one can be a schema nobody can re-enter.
 */
export async function applyFile(
  client: SqlClient,
  file: string,
  statements: string[],
  send: (statement: string) => string = (s) => s,
): Promise<FileReport> {
  const { rows } = await client.query<{ stmt_sha256: string; applied_at: unknown }>(
    'SELECT stmt_sha256, applied_at FROM schema_migration WHERE file = $1',
    [file],
  );
  const done = new Set(rows.filter((r) => r.applied_at !== null).map((r) => r.stmt_sha256));
  const open = new Set(rows.filter((r) => r.applied_at === null).map((r) => r.stmt_sha256));

  // The ledger is keyed `(file, stmt_sha256)`, so two byte-identical statements
  // in one file collide on the SECOND insert and abort with a duplicate-key
  // error that reads as a cluster fault. Two identical `CREATE`s could not both
  // succeed anyway; say which file is wrong instead.
  const seen = new Set<string>();
  for (const source of statements) {
    const hash = sha256(source);
    if (seen.has(hash)) {
      throw new Error(`${file} repeats a statement byte for byte: ${source.split('\n')[0]}`);
    }
    seen.add(hash);
  }

  const report: FileReport = { file, applied: 0, skipped: 0, pending: 0 };
  for (const [index, source] of statements.entries()) {
    const hash = sha256(source);
    if (done.has(hash)) {
      report.skipped += 1;
      continue;
    }
    const openedHere = !open.has(hash);
    if (openedHere) {
      await client.query(
        `INSERT INTO schema_migration (file, stmt_sha256, stmt_index, started_at)
              VALUES ($1, $2, $3, now())`,
        [file, hash, index],
      );
    }
    const statement = send(source);
    let sent: Record<string, unknown>[] | undefined;
    try {
      sent = (await client.query<Record<string, unknown>>(statement)).rows;
    } catch (err) {
      const alreadyThere = ALREADY_THERE.has(codeOf(err) ?? '');
      if (!(open.has(hash) && alreadyThere)) {
        // WITHDRAW ONLY THE CASE THE WITHDRAWAL EXISTS FOR: this run opened the
        // row, and the object was already there. Anything else — a syntax
        // error, a dropped connection, a statement whose fate is unknown —
        // leaves the row, because the row is the only record that this
        // statement was ever in flight and a later run can still finish it.
        if (openedHere && alreadyThere) {
          await withdraw(client, file, hash);
          // The bare `relation … already exists` is the one message an operator
          // cannot act on: it names the object and says nothing about why this
          // run refused an object every other run would have adopted. The whole
          // recovery path is knowing the ledger has no row for it.
          throw new Error(
            `${file}: statement ${index} creates something that is already there, and this ` +
              `ledger has no record of creating it. Nothing was applied. Either the schema ` +
              `was built by something other than this runner, or schema_migration lost its row.`,
            { cause: err },
          );
        }
        throw err;
      }
    }
    // PAST THIS POINT THE STATEMENT IS ON THE CLUSTER — this run put it there,
    // or the run that left the row open did. Anything that fails below leaves
    // the row OPEN on purpose: the work is done and only the bookkeeping is
    // not, which is exactly the state a re-run knows how to finish.
    //
    // BOTH PATHS END IN `finishIndex`, and the first one used not to. Waiting on
    // the job was taken as proof the index was built, which rests entirely on
    // `sys.wait_for_job` RAISING when a job ends `failed` — never measured, and
    // this page records that a failed job leaves an `INVALID` definition behind.
    // If the procedure merely returns, the hash goes `done` for good and the
    // ledger reports a working index that is not one. `finishIndex` costs one
    // catalogue read and returns at once when `indisvalid` is already true.
    if (sent !== undefined) await waitForIndexJob(client, statement, sent);
    await finishIndex(client, statement);
    await client.query(
      'UPDATE schema_migration SET applied_at = now() WHERE file = $1 AND stmt_sha256 = $2',
      [file, hash],
    );
    report.applied += 1;
  }
  return report;
}

/**
 * The ledger is keyed `(file, stmt_sha256)`, so two byte-identical statements in
 * one file collide on the SECOND insert and abort with a duplicate-key error
 * that reads as a cluster fault. Two identical `CREATE`s could not both succeed
 * anyway; say which file is wrong instead.
 *
 * Checked by the dry run as well as the apply, so `mode: dry-run` — the thing an
 * operator reaches for before touching anything — is what reports it.
 */
function refuseDuplicates(file: string, statements: string[]): void {
  const seen = new Set<string>();
  for (const source of statements) {
    const hash = sha256(source);
    if (seen.has(hash)) {
      throw new Error(`${file} repeats a statement byte for byte: ${source.split('\n')[0]}`);
    }
    seen.add(hash);
  }
}

/** Best effort, and never allowed to replace the failure that prompted it. */
async function withdraw(client: SqlClient, file: string, hash: string): Promise<void> {
  try {
    await client.query('DELETE FROM schema_migration WHERE file = $1 AND stmt_sha256 = $2', [
      file,
      hash,
    ]);
  } catch {
    // The original error is the one worth raising; a ledger that could not be
    // tidied is visible in the next run's report as a statement still open.
  }
}

/** What WOULD run, contacting no object the migration owns. */
async function planFile(
  client: SqlClient,
  file: string,
  statements: string[],
): Promise<FileReport> {
  refuseDuplicates(file, statements);
  let done = new Set<string>();
  try {
    const { rows } = await client.query<{ stmt_sha256: string; applied_at: unknown }>(
      'SELECT stmt_sha256, applied_at FROM schema_migration WHERE file = $1',
      [file],
    );
    done = new Set(rows.filter((r) => r.applied_at !== null).map((r) => r.stmt_sha256));
  } catch (err) {
    // `42P01` — no ledger yet, so nothing has been applied. Any other failure
    // is the caller's to see.
    if (codeOf(err) !== '42P01') throw err;
  }
  const skipped = statements.filter((s) => done.has(sha256(s))).length;
  return { file, applied: 0, skipped, pending: statements.length - skipped };
}

/**
 * `CREATE INDEX ASYNC` returns a job, not an index, and the migration is not
 * finished until the job is. Inert everywhere but DSQL: the statement only
 * carries `ASYNC` after `rewriteForDsql`, so the PGlite suite never reaches
 * the `CALL`.
 */
async function waitForIndexJob(
  client: SqlClient,
  statement: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!/^CREATE\s+(UNIQUE\s+)?INDEX\s+ASYNC\b/i.test(statement)) return;
  const jobId = rows[0] === undefined ? undefined : Object.values(rows[0])[0];
  if (jobId === undefined || jobId === null) {
    throw new Error(`CREATE INDEX ASYNC returned no job id: ${statement.split('\n')[0]}`);
  }
  // A PROCEDURE — `SELECT sys.wait_for_job(…)` fails 42809.
  await client.query('CALL sys.wait_for_job($1)', [jobId]);
}

/**
 * Finish an index a previous run left open — an index that exists is not yet an
 * index that works.
 *
 * `indisvalid` alone cannot answer this. It is false for a build that FAILED
 * and false for one still RUNNING, and the likeliest way a row is left open is
 * the second: the invocation was killed while `CALL sys.wait_for_job` was still
 * waiting. Judging by `indisvalid` would tell an operator to `DROP INDEX` a
 * perfectly healthy build and pay for it again.
 *
 * `sys.jobs` separates them — it carries `status` and an `object_name` of
 * `schema.index`, so the job can be found again without the id the crashed run
 * took with it. So this WAITS rather than judging: it resumes exactly what the
 * previous run was doing.
 *
 * Inert on PGlite, which has no `sys` schema — and inert for a `CREATE TABLE`,
 * whose existence is the whole of its validity.
 */
async function finishIndex(client: SqlClient, statement: string): Promise<void> {
  const name = INDEX_NAME.exec(statement)?.[1];
  if (name === undefined) return;

  const resolved = await client.query<{ indisvalid: boolean; qualified: string }>(
    `SELECT indisvalid, current_schema() || '.' || indexrelid::regclass::text AS qualified
       FROM pg_index WHERE indexrelid = $1::regclass`,
    [name],
  );
  if (resolved.rows[0]?.indisvalid === true) return;

  const job = await indexBuildJob(client, resolved.rows[0]?.qualified);
  if (job !== undefined) {
    // `submitted` and `completed` are the only two spellings measured, so this
    // does not try to decide from the status which jobs are waitable — it waits
    // and lets a dead job refuse. Swallowing that refusal is deliberate: the
    // error worth raising is the one below, which names the index, the status
    // and what to do, rather than whatever `wait_for_job` says about a job the
    // operator never asked about.
    try {
      await client.query('CALL sys.wait_for_job($1)', [job.job_id]);
    } catch {
      // Fall through to the recheck; an unwaitable job is still evidence.
    }
    const after = await client.query<{ indisvalid: boolean }>(
      'SELECT indisvalid FROM pg_index WHERE indexrelid = $1::regclass',
      [name],
    );
    if (after.rows[0]?.indisvalid === true) return;
  }
  throw new Error(
    `${name} exists but is not a usable index` +
      (job === undefined
        ? ' and has no INDEX_BUILD job'
        : ` (job ${job.job_id} is ${job.status})`) +
      `. A failed async build is left behind INVALID and AWS does not clean it up: ` +
      `DROP INDEX ${name} and re-run.`,
  );
}

/** The most recent build job for one index, or nothing where `sys` is absent. */
async function indexBuildJob(
  client: SqlClient,
  qualified: string | undefined,
): Promise<{ job_id: string; status: string } | undefined> {
  if (qualified === undefined) return undefined;
  try {
    const { rows } = await client.query<{ job_id: string; status: string }>(
      `SELECT job_id, status FROM sys.jobs
        WHERE job_type = 'INDEX_BUILD' AND object_name = $1
        ORDER BY start_time DESC LIMIT 1`,
      [qualified],
    );
    return rows[0];
  } catch (err) {
    // `3F000` no such schema, `42P01` no such relation — every engine but DSQL.
    if (codeOf(err) === '3F000' || codeOf(err) === '42P01') return undefined;
    throw err;
  }
}

export type MigrateMode = 'rehearse' | 'dry-run' | 'apply' | 'bootstrap';

type UserAttribute = { Name?: string; Value?: string };

/**
 * The two Cognito calls the bootstrap makes, narrowed so the tests inject a double rather
 * than the SDK — the shape `pre-signup.ts` takes its `IdentityClient` in.
 *
 * `AdminGetUser` is here only for the re-run: `AdminCreateUser` answers
 * `UsernameExistsException` the second time and does not hand back the `sub` it made the
 * first time, and the bootstrap has to report the same identity rather than a fresh one.
 */
export type IdentityAdminClient = {
  adminCreateUser(input: {
    UserPoolId: string;
    Username: string;
    UserAttributes: { Name: string; Value: string }[];
    // The literal rather than `string`: the SDK types this as an enum, and a widened
    // narrowing would stop compiling against the very call it exists to describe.
    DesiredDeliveryMediums?: ['EMAIL'];
  }): Promise<{ User?: { Attributes?: UserAttribute[] } }>;
  adminGetUser(input: {
    UserPoolId: string;
    Username: string;
  }): Promise<{ UserAttributes?: UserAttribute[] }>;
};

/** What the bootstrap did, which the other three modes never set. */
export interface BootstrapReport {
  email: string;
  identity: 'created' | 'existing';
  row: 'created' | 'existing';
}

export interface MigrateEvent {
  /**
   * REQUIRED, and unknown values are refused rather than defaulted.
   *
   * An earlier shape took `rehearse?: boolean` and fell through to the real
   * apply for anything else, so `{"rehearse":"true"}` — a quoted boolean, which
   * is what a hand-typed `aws lambda invoke` produces — migrated production
   * while reading as a rehearsal. There is no safe default for a verb this
   * destructive, so there is none.
   */
  mode?: MigrateMode;

  /**
   * The address `bootstrap` creates, and an OPERATOR INPUT rather than a committed
   * literal or a stack parameter. The person running it names who it creates, at the
   * moment they run it — a migration must not carry a fixed privileged identity, and
   * this one could not produce the value anyway: `user_id` is the Cognito `sub`, which
   * only `AdminCreateUser` mints.
   */
  email?: string;
}

export interface MigrateReport {
  mode: MigrateMode;
  schema: string;
  files: FileReport[];
  /**
   * Set by `bootstrap` ALONE, and absent everywhere else — which is why the whole-report
   * `toEqual` assertions on the other three modes did not have to move. They report
   * exactly what they reported before this mode existed.
   */
  bootstrap?: BootstrapReport;

  /**
   * Set by a `rehearse` that OUTLIVED ITS SCHEMA, and absent from every clean run —
   * so, like `bootstrap`, it moves no existing whole-report assertion. Its presence is
   * what separates a teardown that failed from a statement that was refused: the second
   * raises, and only the second is something the rehearsal found.
   */
  teardown?: TeardownReport;
}

/**
 * NOT `import.meta.url`, and the reason is the bundle.
 *
 * The deploy emits CommonJS — `pg` is CommonJS and an ESM bundle died at
 * runtime on `Dynamic require of "events"` — and esbuild replaces
 * `import.meta.url` with an empty string in that format. The read would resolve
 * to nothing in the one place it actually has to work.
 *
 * `LAMBDA_TASK_ROOT` is set by the runtime and names the unzipped bundle, into
 * which the deploy copies `migrations/`. Everywhere else the repository root is
 * the working directory: `pnpm test` and `pnpm exec tsx` both run from it.
 */
const fileText = (file: string) =>
  readFileSync(join(process.env.LAMBDA_TASK_ROOT ?? 'infra', 'migrations', file), 'utf8');

const MODES: readonly MigrateMode[] = ['rehearse', 'dry-run', 'apply', 'bootstrap'];

/**
 * The first super-admin, and the row is self-approved because that is the only truthful
 * shape available.
 *
 * `app_user_decided_ck` exempts `role = 'demo'` alone, so an `active` row MUST carry both
 * halves of the decision pair — and `decided_by` has no foreign key, so the row can name
 * itself. A pair naming somebody else would be a fabricated approval by a person who never
 * ruled on it, which is exactly what `005_demo_user.sql` refused to write.
 *
 * `ON CONFLICT (user_id)` rather than absorbing a `23505`, following `005` and for its
 * reason: a `23505` does not say which constraint raised it, and `app_user_email_uq` can
 * raise one for a DIFFERENT row — an address that already applied. That is a real
 * collision and must stop the run rather than read as "already bootstrapped".
 */
/**
 * WHAT THE CLUSTER ALREADY HOLDS, asked BEFORE anything irreversible happens.
 *
 * `AdminCreateUser` cannot be undone by this runner — it has no `AdminDeleteUser` — so
 * every question that can be answered from the database is answered first. Three states
 * this turns into clean refusals that create nothing: the schema has not been applied yet
 * (`42P01` from here rather than an identity stranded in the pool), the address already
 * holds an application row, and a super-admin already exists under another address.
 *
 * A REJECTED SUPER-ADMIN IS NOT ONE. Reject sets the status and the decision pair and never
 * touches `role`, so a ruled-on row keeps saying `super_admin` — and read as one it makes this
 * mode throw for EVERY address, forever, with no endpoint able to undo it: approve refuses a
 * non-pending row and the gate refuses the caller. The two arms are separate on purpose. Only
 * the ROLE arm is narrowed; `email = $1` stays unconditional, because a rejected row at the
 * address being bootstrapped must still be found and refused BY NAME below, rather than reaching
 * the insert and raising `app_user_email_uq` after an identity has been minted.
 */
const BOOTSTRAP_LOOK = `SELECT user_id, email, status, role FROM app_user
                        WHERE email = $1 OR (role = 'super_admin' AND status <> 'rejected')`;

/**
 * `ON CONFLICT (user_id) DO NOTHING` and NOT `… RETURNING`.
 *
 * Following `005` on the conflict target, and for its reason: a `23505` does not say which
 * constraint raised it, and `app_user_email_uq` can raise one for a different row. What is
 * deliberately absent is `RETURNING` — `infra/docs/dsql-constraints.md` measured
 * `DO NOTHING` on the cluster, but not in combination with a returning clause, and this is
 * the one mode with no rehearsal to find that out in. Whether the row is new is already
 * known from the look above, so the unmeasured shape buys nothing.
 */
const BOOTSTRAP_ROW = `INSERT INTO app_user (user_id, email, status, role, applied_at,
                                             decided_at, decided_by)
                       VALUES ($1, $2, 'active', 'super_admin', now(), now(), $1)
                       ON CONFLICT (user_id) DO NOTHING`;

const subOf = (attributes: UserAttribute[] | undefined): string | undefined =>
  attributes?.find((a) => a.Name === 'sub')?.Value;

type AppUserRow = { user_id: string; email: string; status: string; role: string };

async function bootstrap(
  client: SqlClient,
  idp: IdentityAdminClient,
  supplied: unknown,
): Promise<MigrateReport> {
  // CANONICALISED BEFORE ANYTHING IS ASKED, so `app_user_email_lower_ck` is never what
  // reports an operator's capital letter. This runner holds the cluster's admin grant, so
  // a constraint violation here is a surprise in the middle of a privileged run rather
  // than a clean refusal — and the address arrives typed by hand.
  const email = canonicalAddress(supplied);
  if (email === undefined) {
    throw new Error(
      `email must be an address this schema can store, got ${JSON.stringify(supplied)}`,
    );
  }

  const UserPoolId = process.env.USER_POOL_ID;
  if (!UserPoolId) throw new Error('USER_POOL_ID is not set on this function');

  const { rows } = await client.query<AppUserRow>(BOOTSTRAP_LOOK, [email]);
  const mine = rows.find((r) => r.email === email);
  const otherAdmin = rows.find((r) => r.role === 'super_admin' && r.email !== email);

  // THE FINISHED STATE IS ANSWERED FIRST, and the order matters only for its message: a
  // re-run for the address that IS the super-admin must report that, not be told it is
  // trying to promote a second one.
  if (mine && mine.status === 'active' && mine.role === 'super_admin') {
    // The row says the identity exists; this is what makes that falsifiable rather than
    // assumed, and it is the difference between a recovery tool and one that reports
    // success while repairing nothing.
    const found = await idp.adminGetUser({ UserPoolId, Username: email }).catch((err: unknown) => {
      // NAMED ON BOTH SIDES, like every other refusal here. The raw SDK answer is "User
      // does not exist." with no address, no row and no next step — and this is the one
      // state an operator reaches while already locked out.
      throw new Error(
        `${email} holds a super-admin row (${mine.user_id}) but the pool has no such user: ${String(err)}`,
      );
    });
    const sub = subOf(found.UserAttributes);
    if (sub !== mine.user_id) {
      throw new Error(`${email} is row ${mine.user_id} but pool user ${sub ?? 'unknown'}`);
    }
    return {
      mode: 'bootstrap',
      schema: 'public',
      files: [],
      bootstrap: { email, identity: 'existing', row: 'existing' },
    };
  }

  // ALREADY IN THE WAY. A row this mode must not overwrite — most likely an application
  // from that address, which `POST /v1/applications` accepts from anyone. Refused by NAME,
  // because the alternative is a raw `app_user_email_uq` violation raised after an identity
  // has already been minted.
  if (mine) {
    throw new Error(
      `${email} already holds an app_user row (${mine.status}/${mine.role}); remove or decide it before bootstrapping`,
    );
  }

  // THE FIRST super-admin, which is what this mode is named for and what three documents
  // promise. Without this the second dispatch would quietly write another `active`
  // super-admin for an address nobody approved — the property the approval gate exists to
  // hold. Promoting a second one is the admin surface's decision, not a runner mode's.
  if (otherAdmin) {
    throw new Error(
      `a super-admin already exists (${otherAdmin.email}); promoting another is not this mode's to do`,
    );
  }

  // IDEMPOTENT ACROSS BOTH HALVES, because they can still fail apart: an identity created
  // and a row that did not land leaves a `sub` nothing refers to, and the only way back is
  // to run this again. So a create that says "already there" continues to the row.
  let userId: string | undefined;
  let identity: 'created' | 'existing' = 'created';
  try {
    const made = await idp.adminCreateUser({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        // The address is the operator's own and needs no round trip to prove. It is also
        // what makes forgot-password work afterwards.
        { Name: 'email_verified', Value: 'true' },
      ],
      // THE INVITATION IS SENT, and suppressing it was a trap. `AdminCreateUser` generates
      // a temporary password whatever else happens and leaves the account in
      // `FORCE_CHANGE_PASSWORD`; suppressed, nobody is ever told that password, and
      // `ForgotPassword` REFUSES a user in that state — so the mode would have produced a
      // perfect row attached to an account nobody could sign into, which is the one thing
      // it exists to prevent. The pool declares no `EmailConfiguration`, so Cognito's own
      // sender delivers this and no SES sandbox is involved.
      //
      // EMAIL, EXPLICITLY: the delivery medium defaults to SMS, and this pool carries no
      // phone number at all.
      DesiredDeliveryMediums: ['EMAIL'],
    });
    userId = subOf(made.User?.Attributes);
  } catch (err) {
    if ((err as { name?: string })?.name !== 'UsernameExistsException') throw err;
    identity = 'existing';
    const found = await idp.adminGetUser({ UserPoolId, Username: email });
    userId = subOf(found.UserAttributes);
  }
  if (!userId) throw new Error(`the pool returned no sub for ${email}`);

  await client.query(BOOTSTRAP_ROW, [userId, email]);
  // THE SUB IS LOGGED, NOT RETURNED. The report is printed and kept as a workflow artifact
  // on a PUBLIC repository; the address is in the dispatch inputs already, but the `sub` is
  // the key every row in this database is scoped by and has no reason to be published.
  console.log(`bootstrap: ${email} is ${userId} (identity ${identity})`);
  return {
    mode: 'bootstrap',
    schema: 'public',
    files: [],
    bootstrap: { email, identity, row: 'created' },
  };
}

// Constructed once, at module scope, the way `pre-signup.ts` constructs its own — and
// passed in, so every test injects a double instead.
const identityClient = new CognitoIdentityProviderClient({});
const sdkIdentity: IdentityAdminClient = {
  adminCreateUser: (input) => identityClient.send(new AdminCreateUserCommand(input)),
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
};

/**
 * `40001` is contention, not a refusal: dropping a six-table schema is a large
 * catalogue change issued right behind two `CREATE INDEX ASYNC` jobs, and a
 * waited-for job is not a settled catalogue.
 *
 * Bounded, because the alternative to giving up is holding the invocation open
 * against a conflict that may never clear — and a schema that will not go is
 * something an operator can finish by hand, once they are told its name.
 */
const DROP_RETRY_DELAYS_MS = [500, 2_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What became of a rehearsal's schema. Reported only when it outlived the run. */
export interface TeardownReport {
  schema: string;
  dropped: boolean;
  attempts: number;
  /** The SQLSTATE that refused, where the server gave one. */
  sqlstate?: string;
  message?: string;
}

export async function dropRehearsalSchema(
  client: SqlClient,
  schema: string,
): Promise<TeardownReport> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // `IF EXISTS` because a conflict is the client's view, not the cluster's:
      // an attempt can commit and still come back `40001`, and the retry would
      // then raise `3F000` over a schema that is already gone.
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      return { schema, dropped: true, attempts: attempt };
    } catch (err) {
      const sqlstate = codeOf(err);
      // COUNTED, NOT INFERRED FROM THE LOOKUP. `noUncheckedIndexedAccess` is off,
      // so an out-of-range read types as `number` and a guard on `undefined` reads
      // as dead code — which, removed, leaves this unbounded against a conflict
      // that never clears.
      //
      // A REFUSAL IS REPORTED, NEVER HAMMERED: retrying something the cluster will
      // not do spends the whole backoff to reach the same answer.
      if (sqlstate !== '40001' || attempt > DROP_RETRY_DELAYS_MS.length) {
        return {
          schema,
          dropped: false,
          attempts: attempt,
          ...(sqlstate === undefined ? {} : { sqlstate }),
          message: err instanceof Error ? err.message : String(err),
        };
      }
      await sleep(DROP_RETRY_DELAYS_MS[attempt - 1]);
    }
  }
}

/**
 * Name the orphan in the message of whatever is being raised. A Lambda error
 * payload carries a type, a message and a trace and no more, so the message is
 * the only part of a raise that reaches the run page.
 */
const orphaned = (err: unknown, teardown: TeardownReport): unknown => {
  if (teardown.dropped) return err;
  const message = err instanceof Error ? err.message : String(err);
  // The SQLSTATE travels with the name. Where the restore failed too it is the
  // only trace of WHY the drop did not go that leaves the invocation at all —
  // this raises the restore's error, and the drop's reaches CloudWatch alone.
  const why = teardown.sqlstate === undefined ? '' : ` (${teardown.sqlstate})`;
  return new Error(`${message} — ${teardown.schema} could not be dropped${why}`, { cause: err });
};

export async function migrate(
  client: SqlClient,
  event: MigrateEvent = {},
  idp: IdentityAdminClient = sdkIdentity,
): Promise<MigrateReport> {
  const mode = event.mode;
  if (mode === undefined || !MODES.includes(mode)) {
    throw new Error(`mode must be one of ${MODES.join(' | ')}, got ${JSON.stringify(event.mode)}`);
  }

  // BEFORE THE PLAN AND WELL BEFORE THE REHEARSE TAIL. This mode reads no migration file,
  // and the tail has no guard of its own — it is the fall-through — so a branch added
  // after it would land in `CREATE SCHEMA`, create nothing, and report a rehearsal.
  if (mode === 'bootstrap') return bootstrap(client, idp, event.email);

  const plan = MIGRATIONS.map((file) => ({ file, statements: statementsOf(fileText(file)) }));

  if (mode === 'dry-run') {
    const files: FileReport[] = [];
    for (const { file, statements } of plan) files.push(await planFile(client, file, statements));
    return { mode, schema: 'public', files };
  }

  if (mode === 'apply') {
    await ensureLedger(client);
    const files: FileReport[] = [];
    for (const { file, statements } of plan) {
      files.push(await applyFile(client, file, statements, rewriteForDsql));
    }
    return { mode, schema: 'public', files };
  }

  // REHEARSE. A throwaway schema dropped CASCADE, the shape every probe in
  // `infra/docs/dsql-constraints.md` used. The ledger lands inside it too and
  // dies with it, so a rehearsal cannot teach the real run anything.
  //
  // ISOLATION IS BY `search_path`, WHICH IS NOT TOTAL ON ITS OWN — a qualified
  // name reaches the schema it names whatever the path says. The foreign keys
  // are emitted `REFERENCES "public"."app_user"(…)` and DID reach out of a
  // rehearsal because of it; `rewriteForDsql` strips the qualifier for exactly
  // that reason, which is what makes this mode isolated in practice. Anything
  // ADDED to a migration that names a schema explicitly escapes again, and no
  // test would catch it on a cluster where `public` is populated — the failure
  // is silent success.
  const schema = `migrate_rehearsal_${Date.now()}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  let thrown: unknown;
  const files: FileReport[] = [];
  try {
    await client.query(`SET search_path TO ${schema}`);
    await ensureLedger(client);
    for (const { file, statements } of plan) {
      files.push(await applyFile(client, file, statements, rewriteForDsql));
    }
  } catch (err) {
    thrown = err;
  }
  // The cleanup must not REPLACE the failure it is cleaning up after. A drop
  // that throws from a `finally` surfaces instead of the statement the
  // rehearsal was run to identify, which is the one thing it exists to report.
  //
  // BOTH HALVES ALWAYS RUN, and neither raises where it stands. They are
  // separate because a failed drop must still restore the path: the suite and
  // the CI smoke step both pass a client they own, which would otherwise go on
  // resolving every later query in a schema that may no longer exist.
  const teardown = await dropRehearsalSchema(client, schema);
  if (!teardown.dropped) {
    // The whole report, not just its message: the SQLSTATE and the attempt count
    // are what separate a conflict that never cleared from a flat refusal.
    console.error(`rehearsal schema ${schema} could not be dropped`, teardown);
  }
  let restoreFailure: unknown;
  try {
    await client.query('SET search_path TO public');
  } catch (cleanup) {
    restoreFailure = cleanup;
    console.error('search_path could not be restored', cleanup);
  }
  // The statement's failure outranks the cleanup's: it is the one the rehearsal
  // was run to find. Either way the orphan is named, because on a raise the
  // message is all that reaches the run page.
  if (thrown !== undefined) throw orphaned(thrown, teardown);
  if (restoreFailure !== undefined) throw orphaned(restoreFailure, teardown);
  // A TEARDOWN FAILURE IS REPORTED, NOT RAISED. The statements are what this
  // mode exists to test and nothing was wrong with them, so a raise would read
  // as a finding the rehearsal did not make. The schema is still there, which
  // is what `migrate.yml` fails the run on.
  return { mode, schema, files, ...(teardown.dropped ? {} : { teardown }) };
}

export async function handler(event: MigrateEvent = {}): Promise<MigrateReport> {
  const client = await connect();
  try {
    return await migrate(client, event);
  } finally {
    await client.end();
  }
}
