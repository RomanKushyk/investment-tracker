// The migration runner, and why it is a ledger rather than a loop. Every refusal below was
// measured against the cluster and recorded in `infra/docs/dsql-constraints.md`.
//
// THE GENERATED DDL IS NOT REPLAYABLE. drizzle-kit can emit neither `IF NOT EXISTS` nor
// `CREATE INDEX IF NOT EXISTS`, so every statement in `003` is a bare `CREATE`, and DSQL runs one
// DDL per transaction with no cross-statement rollback — so a file failing partway cannot be
// re-run: the retry dies on the first statement, which already exists. Hence the ledger.
//
// THE REWRITE IS NOT PART OF A STATEMENT'S IDENTITY: the ledger hashes the SOURCE and `send`
// transforms it on the way out, so the PGlite suite stores the hashes production does and
// relaxing a rule does not re-present every index line as new. AN ACCEPTED `CREATE INDEX ASYNC`
// IS NOT A BUILT INDEX: `sys.wait_for_job` is a PROCEDURE — `CALL`, never `SELECT` — and a failed
// job leaves an `INVALID` definition AWS does not clean up, as does a build still running.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AdminCreateUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';

import { canonicalAddress } from '@quirenote/core/address';
import { connect } from './dsql';
import { type Provisioned, provision } from './provision';

/** IN ORDER, AND NOT A GLOB. `001`, `002` and `004` are the ARCHIVE's and stay with `ensureSchema`
 *  in `capture.ts`: the archive is provider data shared by every environment, while these are USER
 *  data, which splits dev from prod (*Cloud target*). `005` is DML and depends on `003`; `008` is
 *  DML and depends on `005`, the account it writes pointing at that row. */
export const MIGRATIONS = [
  '003_user_schema.sql',
  '005_demo_user.sql',
  '006_email_lower.sql',
  '007_drop_reinvest_policy.sql',
  '008_demo_account.sql',
] as const;

/** What both `pg` and PGlite give back, and all this module needs of either. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>;
}

const BREAKPOINT = '--> statement-breakpoint';

/**
 * Split on drizzle's own marker, never on `;`: the generated file wraps two CHECKs across a line,
 * so a `;` split reproduces the statement COUNT and then mangles a real statement. The marker is
 * not line-anchored, because drizzle appends it to an index line's terminating `;`. A HAND-WRITTEN
 * FILE OBEYS THE SAME CONVENTION, or a second statement is glued into the first.
 *
 * COMMENT LINES ARE DROPPED BEFORE THE SPLIT, AND THE MARKER IS THE ONE `--` LINE KEPT: a
 * hand-written header must not enter the hash the ledger is keyed by, and a comment that MENTIONS
 * the marker must not split the file — this very header once did.
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
 * THE FOUR PROMOTION REWRITES, applied on the way out and never committed: `ASYNC` is a syntax
 * error on stock Postgres, and `USING btree` has to stay in the file because that is what
 * `user-schema.test.ts` applies to PGlite. Idempotent by construction. `NOT VALID` is deliberately
 * not conditional on the constraint kind — DSQL refuses `UNIQUE`/`PRIMARY KEY` `ADD CONSTRAINT`
 * outright in either spelling (`infra/docs/dsql-constraints.md`).
 */
export function rewriteForDsql(statement: string): string {
  let out = statement;
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\b/i.test(out)) {
    out = out.replace(/^(CREATE\s+(?:UNIQUE\s+)?INDEX)(?!\s+ASYNC\b)/i, '$1 ASYNC');
    out = out.replace(/\s+USING\s+btree\s*/i, ' ');
  }
  if (/^ALTER\s+TABLE\b/i.test(out) && /\bADD\s+CONSTRAINT\b/i.test(out)) {
    // THE FOURTH RULE IS ABOUT WHERE THE STATEMENT LANDS, not whether DSQL accepts it. Drizzle
    // hard-codes the schema on a foreign key's target — `REFERENCES "public"."app_user"(…)` — and
    // a qualified name ignores `search_path`, so inside the rehearsal schema it reaches back out,
    // builds against the REAL table and drops the referencing side from under it. Silently, on any
    // cluster where `public` is populated. Every table this schema declares lives in one schema,
    // so resolving through `search_path` is what the statement means.
    out = out.replace(/\bREFERENCES\s+"public"\."/gi, 'REFERENCES "');
    if (!/\bNOT\s+VALID\b/i.test(out)) out = out.replace(/;?\s*$/, ' NOT VALID;');
  }
  return out;
}

const sha256 = (stmt: string) => createHash('sha256').update(stmt, 'utf8').digest('hex');

/**
 * The one table here whose own DDL may be replayed: hand-written, so it CAN carry `IF NOT EXISTS`.
 * KEYED BY CONTENT HASH, not by position, so appending statements to a file already applied
 * re-runs only the new ones. Deliberately not taught to `ensureSchema`, which owns the archive.
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
  /** Wall time, and OPTIONAL because the two functions that build this report have no
   *  clock: `migrate` is what stamps it, being the only caller that sees a whole run. */
  ms?: number;
}

/** `42P07` is a duplicate RELATION, which an existing INDEX reports rather than `42710`, the
 *  duplicate OBJECT a constraint raises. `23505` is deliberately ABSENT: it does not say which
 *  constraint raised it, so a file could be stamped applied with nothing written. */
const ALREADY_THERE = new Set(['42P07', '42710']);

/** A SQLSTATE, or nothing. Shaped rather than stringified: `code: undefined` comes back as the
 *  STRING `'undefined'`, which reads as a code simply not in any set, and a transport failure's
 *  `ECONNRESET` is a Node code rather than anything the server said. */
const codeOf = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
};

/** The name EXACTLY as written, quotes and all, because `::regclass` case-folds an unquoted
 *  identifier and not a quoted one — stripping the quotes made a camelCase index raise `42P01`.
 *  `IF NOT EXISTS` is matched although nothing here emits it: the archive's hand-written DDL does,
 *  and without the clause such a line reports its index as being named `IF`. */
const INDEX_NAME =
  /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:ASYNC\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("[^"]+"|[^\s(]+)/i;

/**
 * THE CRASH WINDOW IS NAMED RATHER THAN AVOIDED: DSQL forbids DDL and DML in one transaction, so
 * no arrangement writes the ledger row and its statement atomically. What closes the AMBIGUITY is
 * writing the row FIRST with a NULL `applied_at`, so a re-run knows which statement it was in the
 * middle of and exactly that one may answer "already exists" with success.
 *
 * THE ROW IS WITHDRAWN ONLY WHERE THIS RUN OPENED IT AND THE OBJECT WAS ALREADY THERE. Leaving it
 * would license the NEXT run to absorb the error this one rejected; withdrawing on every failure
 * is worse, since "it raised, so it did not land" is false for a failure AFTER the statement, a
 * TRANSPORT failure, and a row a PREVIOUS run left open — and a withdrawn row can be a schema
 * nobody can re-enter.
 */
export async function applyFile(
  client: SqlClient,
  file: string,
  statements: string[],
  send: (statement: string) => string = (s) => s,
  guard: (file: string, index: number) => void = () => {},
): Promise<FileReport> {
  const { rows } = await client.query<{ stmt_sha256: string; applied_at: unknown }>(
    'SELECT stmt_sha256, applied_at FROM schema_migration WHERE file = $1',
    [file],
  );
  const done = new Set(rows.filter((r) => r.applied_at !== null).map((r) => r.stmt_sha256));
  const open = new Set(rows.filter((r) => r.applied_at === null).map((r) => r.stmt_sha256));

  // See `refuseDuplicates` — the same rule, checked on the apply path too.
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
    // AFTER THE SKIP, so a budget is spent only on work that will really run: a
    // long history with nothing pending is the state every deploy shipping no new
    // SQL is in, and refusing that one would be the guard refusing to do nothing.
    guard(file, index);
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
        // WITHDRAW ONLY THE CASE THE WITHDRAWAL EXISTS FOR — this run opened the row and the
        // object was already there. Anything else leaves the row, the only record that the
        // statement was ever in flight and that a later run can still finish it.
        if (openedHere && alreadyThere) {
          await withdraw(client, file, hash);
          // The bare `relation … already exists` is the one message an operator cannot act on:
          // the whole recovery path is knowing the ledger has no row for it.
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
    // PAST THIS POINT THE STATEMENT IS ON THE CLUSTER, so anything failing below leaves the row
    // OPEN on purpose: the work is done and only the bookkeeping is not.
    //
    // BOTH PATHS END IN `finishIndex`, because taking the job wait as proof rests on
    // `sys.wait_for_job` RAISING on a `failed` job — never measured. If it merely returns, the
    // hash goes `done` for good and the ledger reports a working index that is not one.
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

/** The ledger is keyed `(file, stmt_sha256)`, so two byte-identical statements in one file collide
 *  on the SECOND insert and abort with an error that reads as a cluster fault. Checked by the dry
 *  run as well, so the mode an operator reaches for first is what reports it. */
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
    // The original error is the one worth raising; an untidied ledger shows in the next report.
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

/** `CREATE INDEX ASYNC` returns a job, not an index. Inert everywhere but DSQL: the statement
 *  carries `ASYNC` only after `rewriteForDsql`. */
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

/** An index that exists is not yet one that works, and `indisvalid` cannot say which: it is false
 *  for a build that FAILED and for one still RUNNING, the likelier case, so judging by it would
 *  have an operator `DROP INDEX` a healthy build. `sys.jobs` separates them through `status` and
 *  an `object_name` of `schema.index`, so this WAITS rather than judging. */
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
    // It does not decide from the status which jobs are waitable — it waits and lets a dead job
    // refuse. The error worth raising is the one below, which names the index and what to do.
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

/** `AdminGetUser` is here only for the re-run: `AdminCreateUser` answers
 *  `UsernameExistsException` the second time without handing back the `sub` it made the first. */
export type IdentityAdminClient = {
  adminCreateUser(input: {
    UserPoolId: string;
    Username: string;
    UserAttributes: { Name: string; Value: string }[];
    // The literal, not `string`: the SDK types this as an enum and a widening stops compiling.
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
  /** Reported on EVERY run, including one that found the row finished: the clusters hold a
   *  super-admin written before anything provisioned, so `created` here on a re-run is this mode
   *  repairing exactly that. */
  account: Provisioned;
}

export interface MigrateEvent {
  /** REQUIRED, and an unknown value is refused rather than defaulted: a boolean shape once fell
   *  through to the real apply, so a quoted `"true"` migrated production while reading as a
   *  rehearsal. There is no safe default for a verb this destructive. */
  mode?: MigrateMode;

  /** An OPERATOR INPUT rather than a committed literal: a migration must not carry a fixed
   *  privileged identity, and could not produce the value anyway — `user_id` is the Cognito
   *  `sub`, which only `AdminCreateUser` mints. */
  email?: string;
}

export interface MigrateReport {
  mode: MigrateMode;
  schema: string;
  /** Wall time for the run, taken from the top of `migrate` — so it EXCLUDES the connection
   *  the handler opens around it, a constant rather than a function of how many files there
   *  are, and it is NOT what `getRemainingTimeInMillis` counts down. What it does cover is
   *  everything the file entries leave out: the throwaway schema, the ledger, the drop. The
   *  cost of a rehearsal is then a figure in the artifact the caller already uploads. */
  ms: number;
  files: FileReport[];
  /** Set by `bootstrap` alone, and absent everywhere else. */
  bootstrap?: BootstrapReport;

  /** Set by a `rehearse` that OUTLIVED ITS SCHEMA. Its presence separates a teardown that failed
   *  from a statement that was refused: the second raises, and only it is a finding. */
  teardown?: TeardownReport;
}

/** NOT `import.meta.url`: the deploy emits CommonJS, and esbuild replaces `import.meta.url` with
 *  an empty string in that format, so the read would resolve to nothing in the one place it has to
 *  work. `LAMBDA_TASK_ROOT` names the unzipped bundle the deploy copies `migrations/` into. */
const fileText = (file: string) =>
  readFileSync(join(process.env.LAMBDA_TASK_ROOT ?? 'infra', 'migrations', file), 'utf8');

const MODES: readonly MigrateMode[] = ['rehearse', 'dry-run', 'apply', 'bootstrap'];

/**
 * WHAT THE CLUSTER ALREADY HOLDS, asked BEFORE anything irreversible: `AdminCreateUser` cannot be
 * undone by a runner holding no `AdminDeleteUser`. A REJECTED SUPER-ADMIN IS NOT ONE — reject
 * never touches `role`, so a ruled-on row keeps saying `super_admin` and read as one makes this
 * mode throw for EVERY address forever. Only the ROLE arm is narrowed; `email = $1` stays
 * unconditional, so a rejected row at this address is refused BY NAME below rather than raising
 * `app_user_email_uq` after an identity has been minted.
 */
const BOOTSTRAP_LOOK = `SELECT user_id, email, status, role FROM app_user
                        WHERE email = $1 OR (role = 'super_admin' AND status <> 'rejected')`;

/** Self-approved because it is the only truthful shape available: `app_user_decided_ck` exempts
 *  `role = 'demo'` alone, and `decided_by` has no foreign key, so the row can name itself.
 *  `ON CONFLICT (user_id)` because a `23505` does not say which constraint raised it. `RETURNING`
 *  is deliberately absent: the combination is unmeasured, and this mode has no rehearsal. */
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
): Promise<Omit<MigrateReport, 'ms'>> {
  // CANONICALISED BEFORE ANYTHING IS ASKED, so a constraint is never what reports an operator's
  // capital letter in the middle of a privileged run.
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

  // THE FINISHED STATE IS ANSWERED FIRST, so a re-run for the address that IS the super-admin
  // reports that rather than being told it is promoting a second one.
  if (mine && mine.status === 'active' && mine.role === 'super_admin') {
    // The row says the identity exists; this is what makes that falsifiable rather than assumed.
    const found = await idp.adminGetUser({ UserPoolId, Username: email }).catch((err: unknown) => {
      // NAMED ON BOTH SIDES: the raw SDK answer carries no address, no row and no next step, and
      // this is the one state an operator reaches while already locked out.
      throw new Error(
        `${email} holds a super-admin row (${mine.user_id}) but the pool has no such user: ${String(err)}`,
      );
    });
    const sub = subOf(found.UserAttributes);
    if (sub !== mine.user_id) {
      throw new Error(`${email} is row ${mine.user_id} but pool user ${sub ?? 'unknown'}`);
    }
    // THE FINISHED ROW IS PROVISIONED TOO, and this arm is the only way an EXISTING super-admin ever
    // gets an account: both clusters hold one written before anything provisioned, so without this
    // a re-run would keep handing back a user the gate admits and every write refuses. Idempotent,
    // as the row write beside it is.
    const account = await provision(client, mine.user_id, () =>
      client.query(BOOTSTRAP_ROW, [mine.user_id, email]),
    );
    return {
      mode: 'bootstrap',
      schema: 'public',
      files: [],
      bootstrap: { email, identity: 'existing', row: 'existing', account },
    };
  }

  // ALREADY IN THE WAY — most likely an application, which `applications.ts` takes from anyone.
  // Refused by NAME, or the alternative is a raw violation raised after an identity was minted.
  if (mine) {
    throw new Error(
      `${email} already holds an app_user row (${mine.status}/${mine.role}); remove or decide it before bootstrapping`,
    );
  }

  // THE FIRST super-admin, which is what this mode is named for: without this a second dispatch
  // writes another `active` super-admin for an address nobody approved.
  if (otherAdmin) {
    throw new Error(
      `a super-admin already exists (${otherAdmin.email}); promoting another is not this mode's to do`,
    );
  }

  // IDEMPOTENT ACROSS BOTH HALVES, because they can fail apart: an identity created and a row
  // that did not land leaves a `sub` nothing refers to, so "already there" continues to the row.
  let userId: string | undefined;
  let identity: 'created' | 'existing' = 'created';
  try {
    const made = await idp.adminCreateUser({
      UserPoolId,
      Username: email,
      UserAttributes: [
        { Name: 'email', Value: email },
        // The operator's own address, and what makes forgot-password work afterwards.
        { Name: 'email_verified', Value: 'true' },
      ],
      // SUPPRESSING THE INVITATION IS A TRAP: the account is left in `FORCE_CHANGE_PASSWORD`
      // with a temporary password nobody is told, and `ForgotPassword` REFUSES a user in that
      // state — a perfect row on an account nobody can sign into. The medium is named because it
      // defaults to SMS and this pool carries no phone number.
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

  const account = await provision(client, userId, () =>
    client.query(BOOTSTRAP_ROW, [userId, email]),
  );
  // THE SUB IS LOGGED, NOT RETURNED: the report is kept as a workflow artifact on a PUBLIC
  // repository, and the `sub` is the key every row in this database is scoped by.
  console.log(`bootstrap: ${email} is ${userId} (identity ${identity})`);
  return {
    mode: 'bootstrap',
    schema: 'public',
    files: [],
    bootstrap: { email, identity, row: 'created', account },
  };
}

const identityClient = new CognitoIdentityProviderClient({});
const sdkIdentity: IdentityAdminClient = {
  adminCreateUser: (input) => identityClient.send(new AdminCreateUserCommand(input)),
  adminGetUser: (input) => identityClient.send(new AdminGetUserCommand(input)),
};

/** `40001` is contention, not a refusal: dropping the schema is a large catalogue change issued
 *  right behind two `CREATE INDEX ASYNC` jobs, and a waited-for job is not a settled catalogue.
 *  Bounded, because a schema that will not go is something an operator can finish by hand. */
const DROP_RETRY_DELAYS_MS = [500, 2_000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Held back from the invocation so a rehearsal can still drop its schema: three
 *  attempts across `DROP_RETRY_DELAYS_MS`, the `search_path` restore, and room for a
 *  slow one. `apply` tears nothing down and holds back the same margin anyway, so that
 *  the refusal itself is reported rather than cut off by the kill it is avoiding. The
 *  boundary is pinned in `migrate.test.ts`. */
export const TEARDOWN_RESERVE_MS = 30_000;

/** What `budgetGuard` raises, so `costed` can tell it from a statement the cluster refused. */
class BudgetRefusal extends Error {}

/** Lambda's context, reduced to the one method the runner reads. */
export interface Budget {
  getRemainingTimeInMillis(): number;
}

/**
 * REFUSES TO SEND A STATEMENT WITH THE RESERVE ALREADY SPENT, because being killed at
 * the ceiling has none of the properties a refusal has: the caller gets no report, a
 * rehearsal never reaches `dropRehearsalSchema` and leaves a schema named only in
 * CloudWatch, and an apply killed inside `sys.wait_for_job` leaves its ledger row open.
 * `Timeout` already sits at Lambda's maximum, so stopping early is the only move left.
 *
 * IT BOUNDS WHEN A STATEMENT STARTS, NOT HOW LONG IT RUNS. A single `CALL
 * sys.wait_for_job` that overruns on its own is still a kill — the connection sets no
 * `statement_timeout` — so what this catches is a history grown past one invocation,
 * which is the cost that rises with every file added.
 *
 * A NO-OP WITHOUT A BUDGET, which is every caller but the deployed handler: only
 * Lambda knows how long an invocation has left.
 */
const budgetGuard = (budget: Budget | undefined): ((file: string, index: number) => void) => {
  if (budget === undefined) return () => {};
  return (file, index) => {
    const remaining = budget.getRemainingTimeInMillis();
    if (remaining > TEARDOWN_RESERVE_MS) return;
    // Names no teardown: `apply` runs none, and this one message serves both modes. What
    // the run cost before it is `costed`'s to add, the only one holding the finished files.
    throw new BudgetRefusal(
      `${file} statement ${index} was not started: ${remaining}ms of this invocation is ` +
        `left and the runner holds back ${TEARDOWN_RESERVE_MS}ms. Timeout already sits ` +
        `at Lambda's maximum.`,
    );
  };
};

/** A BUDGET REFUSAL CARRIES OUT WHAT THE RUN MEASURED, the message being all that leaves the
 *  invocation: it is what tells a history grown too long from one file that ate the budget. */
const costed = (err: unknown, files: FileReport[], started: number): unknown => {
  if (!(err instanceof BudgetRefusal)) return err;
  // What the ledger already held cost nothing here; timed as if run, it reads as cheap work.
  const ran = files.filter((f) => f.applied > 0);
  const held = files.filter((f) => f.applied === 0 && f.skipped > 0).length;
  const part = (f: FileReport) =>
    f.skipped === 0 ? '' : ` for ${f.applied} of ${f.applied + f.skipped}`;
  const spent =
    ran.length === 0
      ? 'No file had finished in this invocation.'
      : `Finished before it: ${ran.map((f) => `${f.file} ${f.ms}ms${part(f)}`).join(', ')}.`;
  const ledger =
    held === 0 ? '' : ` ${held} ${held === 1 ? 'file' : 'files'} already in the ledger.`;
  // Read before any teardown. It spans more than the list, so the gap bounds the refused file's share.
  const total = ` ${Date.now() - started}ms since the run began.`;
  return new Error(`${err.message} ${spent}${ledger}${total}`, { cause: err });
};

/** One file's report, with what it cost. The only place a `FileReport` gets its `ms`. */
const timed = async (run: () => Promise<FileReport>): Promise<FileReport> => {
  const from = Date.now();
  const report = await run();
  return { ...report, ms: Date.now() - from };
};

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
      // `IF EXISTS` because a conflict is the client's view: an attempt can commit and still
      // come back `40001`, and the retry would raise `3F000` over a schema already gone.
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      return { schema, dropped: true, attempts: attempt };
    } catch (err) {
      const sqlstate = codeOf(err);
      // COUNTED, NOT INFERRED FROM THE LOOKUP: `noUncheckedIndexedAccess` is off, so an
      // out-of-range read types as `number` and a guard on `undefined` reads as dead code —
      // removed, this goes unbounded. A REFUSAL IS REPORTED, NEVER HAMMERED.
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

/** A Lambda error payload carries a type, a message and a trace and no more, so the message is
 *  the only part of a raise that reaches the run page. */
const orphaned = (err: unknown, teardown: TeardownReport): unknown => {
  if (teardown.dropped) return err;
  const message = err instanceof Error ? err.message : String(err);
  // The SQLSTATE travels with the name: where the restore failed too, it is the only trace of
  // why the drop did not go that leaves the invocation at all.
  const why = teardown.sqlstate === undefined ? '' : ` (${teardown.sqlstate})`;
  return new Error(`${message} — ${teardown.schema} could not be dropped${why}`, { cause: err });
};

export async function migrate(
  client: SqlClient,
  event: MigrateEvent = {},
  idp: IdentityAdminClient = sdkIdentity,
  budget?: Budget,
): Promise<MigrateReport> {
  const started = Date.now();
  const mode = event.mode;
  if (mode === undefined || !MODES.includes(mode)) {
    throw new Error(`mode must be one of ${MODES.join(' | ')}, got ${JSON.stringify(event.mode)}`);
  }

  // BEFORE THE PLAN AND WELL BEFORE THE REHEARSE TAIL, which is the fall-through and has no
  // guard of its own: a branch added after it lands in `CREATE SCHEMA` and reports a rehearsal.
  if (mode === 'bootstrap') {
    return { ...(await bootstrap(client, idp, event.email)), ms: Date.now() - started };
  }

  const plan = MIGRATIONS.map((file) => ({ file, statements: statementsOf(fileText(file)) }));

  if (mode === 'dry-run') {
    const files: FileReport[] = [];
    // NO BUDGET: a dry run reads the files and the ledger and contacts no object the
    // migration owns, so there is no work to refuse.
    for (const { file, statements } of plan) {
      files.push(await timed(() => planFile(client, file, statements)));
    }
    return { mode, schema: 'public', ms: Date.now() - started, files };
  }

  const guard = budgetGuard(budget);

  if (mode === 'apply') {
    await ensureLedger(client);
    const files: FileReport[] = [];
    try {
      for (const { file, statements } of plan) {
        files.push(await timed(() => applyFile(client, file, statements, rewriteForDsql, guard)));
      }
    } catch (err) {
      throw costed(err, files, started);
    }
    return { mode, schema: 'public', ms: Date.now() - started, files };
  }

  // REHEARSE: a throwaway schema dropped CASCADE, the ledger inside it, so it teaches the real
  // run nothing. ISOLATION IS BY `search_path`, WHICH IS NOT TOTAL ON ITS OWN — a qualified name
  // reaches the schema it names, which is why `rewriteForDsql` strips the qualifier. ANYTHING
  // ADDED THAT NAMES A SCHEMA EXPLICITLY ESCAPES AGAIN, silently, where `public` is populated.
  const schema = `migrate_rehearsal_${Date.now()}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  let thrown: unknown;
  const files: FileReport[] = [];
  try {
    await client.query(`SET search_path TO ${schema}`);
    await ensureLedger(client);
    for (const { file, statements } of plan) {
      files.push(await timed(() => applyFile(client, file, statements, rewriteForDsql, guard)));
    }
  } catch (err) {
    thrown = costed(err, files, started);
  }
  // The cleanup must not REPLACE the failure it is cleaning up after, which is the one thing
  // this mode exists to report. BOTH HALVES ALWAYS RUN and neither raises where it stands: a
  // failed drop must still restore the path, or a caller's client goes on resolving every later
  // query in a schema that may no longer exist.
  const teardown = await dropRehearsalSchema(client, schema);
  if (!teardown.dropped) {
    // The whole report: the SQLSTATE and attempt count separate contention from a refusal.
    console.error(`rehearsal schema ${schema} could not be dropped`, teardown);
  }
  let restoreFailure: unknown;
  try {
    await client.query('SET search_path TO public');
  } catch (cleanup) {
    restoreFailure = cleanup;
    console.error('search_path could not be restored', cleanup);
  }
  // The statement's failure outranks the cleanup's: it is the one the rehearsal was run to find.
  if (thrown !== undefined) throw orphaned(thrown, teardown);
  if (restoreFailure !== undefined) throw orphaned(restoreFailure, teardown);
  // A TEARDOWN FAILURE IS REPORTED, NOT RAISED: nothing was wrong with the statements, so a
  // raise would read as a finding the rehearsal did not make. The caller fails the run on the key —
  // `.github/actions/invoke-migration`, which both the deploy and a dispatch go through.
  return {
    mode,
    schema,
    ms: Date.now() - started,
    files,
    ...(teardown.dropped ? {} : { teardown }),
  };
}

export async function handler(
  event: MigrateEvent = {},
  // THE ONLY BUDGET THERE IS. Nothing else knows how long this invocation has left, so
  // a forward dropped here disarms the guard silently — `migrate.test.ts` covers it.
  context?: Budget,
): Promise<MigrateReport> {
  const client = await connect();
  try {
    return await migrate(client, event, sdkIdentity, context);
  } finally {
    await client.end();
  }
}
