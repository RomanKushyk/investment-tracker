// The archive's one database grant, run by CloudFormation: `archive_reader`, mapped to the reader
// role the archive stack owns, reading every table in `public`, present and future. [*Cloud target*]
import { escapeIdentifier, escapeLiteral } from 'pg';
import { codeOf, connect } from './dsql';
import type { SqlClient } from './migrate';

export const READER = 'archive_reader';

export type GrantProperties = { ReaderRoleArn: string };

type Request = {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResponseURL: string;
  StackId: string;
  RequestId: string;
  LogicalResourceId: string;
  ResourceProperties: GrantProperties;
};

const ROLE_ARN = /^arn:aws[\w-]*:iam::\d{12}:role\/(?:[\w+=,.@-]+\/)*[\w+=,.@-]+$/;
export const CONFLICT_ATTEMPTS = 3;

/** One statement, run again on DSQL's `40001` as AWS directs. An attempt can commit and still
 *  answer `40001`, so `done` names the code that says its effect already holds. */
async function run(client: SqlClient, sql: string, values?: unknown[], done?: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.query<Record<string, unknown>>(sql, values);
    } catch (err) {
      const code = codeOf(err);
      if (done !== undefined && code === done) return { rows: [] };
      if (code !== '40001' || attempt === CONFLICT_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}

/** Every object type PostgreSQL 16 keeps privileges on, from its summary of access privileges
 *  (https://www.postgresql.org/docs/16/ddl-priv.html), each with what of it goes beyond reading. */
export const OBJECT_CHECKS: Record<string, string | { nothingBeyondReading: string }> = {
  TABLE: `SELECT 'it can write ' || n.nspname || '.' || c.relname AS found
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'sys') AND left(n.nspname, 3) <> 'pg_'
      AND has_table_privilege($1, c.oid, 'DELETE,TRUNCATE,TRIGGER')`,
  // Whole-table grants count here too, and a read passed on is a grant option, by column or table.
  'Table column': `SELECT CASE WHEN has_any_column_privilege($1, c.oid, 'INSERT,UPDATE,REFERENCES')
      THEN 'it can write ' ELSE 'it can pass on its read of ' END || n.nspname || '.' || c.relname AS found
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'sys') AND left(n.nspname, 3) <> 'pg_'
      AND (has_any_column_privilege($1, c.oid, 'INSERT,UPDATE,REFERENCES')
        OR has_any_column_privilege($1, c.oid, 'SELECT WITH GRANT OPTION'))`,
  // Guarded by CASE: SQL fixes no order between WHERE conditions, and this one throws on a table.
  SEQUENCE: `SELECT CASE WHEN has_sequence_privilege($1, c.oid, 'USAGE,UPDATE')
      THEN 'it can advance or set ' ELSE 'it can pass on its read of ' END || n.nspname || '.' || c.relname AS found
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'S'
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'sys') AND left(n.nspname, 3) <> 'pg_'
      AND CASE WHEN c.relkind = 'S'
        THEN has_sequence_privilege($1, c.oid, 'USAGE,UPDATE,SELECT WITH GRANT OPTION') END`,
  SCHEMA: `SELECT CASE WHEN has_schema_privilege($1, n.oid, 'CREATE')
      THEN 'it can create in ' ELSE 'it can pass on its use of ' END || n.nspname AS found
    FROM pg_namespace n
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'sys') AND left(n.nspname, 3) <> 'pg_'
      AND has_schema_privilege($1, n.oid, 'CREATE,USAGE WITH GRANT OPTION')`,
  DATABASE: `SELECT 'it can create in database ' || d.datname AS found FROM pg_database d
    WHERE has_database_privilege($1, d.oid, 'CREATE')`,
  TABLESPACE: `SELECT 'it can create in tablespace ' || t.spcname AS found FROM pg_tablespace t
    WHERE has_tablespace_privilege($1, t.oid, 'CREATE')`,
  // SET only shapes the reader's own session; DSQL publishes its planner settings that way.
  PARAMETER: `SELECT 'it can alter the system setting ' || a.parname AS found FROM pg_parameter_acl a
    WHERE has_parameter_privilege($1, a.parname, 'ALTER SYSTEM')`,
  'LARGE OBJECT': `SELECT 'it can write large object ' || l.oid AS found FROM pg_largeobject_metadata l
    WHERE l.lomowner = (SELECT r.oid FROM pg_roles r WHERE r.rolname = $1)
      OR l.lomacl::text ~ ('(^|[{,])"?(' || $1 || ')?"?=[^/]*w')`,
  // EXECUTE matters only where the function runs as its owner, PUBLIC's EXECUTE being the default.
  'FUNCTION or PROCEDURE': `SELECT 'it can run ' || p.oid::regprocedure::text || ' as its owner' AS found
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'sys') AND left(n.nspname, 3) <> 'pg_'
      AND has_function_privilege($1, p.oid, 'EXECUTE')`,
  'FOREIGN DATA WRAPPER': `SELECT 'it can use foreign data wrapper ' || w.fdwname AS found
    FROM pg_foreign_data_wrapper w WHERE has_foreign_data_wrapper_privilege($1, w.oid, 'USAGE')`,
  'FOREIGN SERVER': `SELECT 'it can use foreign server ' || s.srvname AS found FROM pg_foreign_server s
    WHERE has_server_privilege($1, s.oid, 'USAGE')`,
  DOMAIN: { nothingBeyondReading: 'USAGE names the domain in a definition it cannot create' },
  LANGUAGE: { nothingBeyondReading: 'USAGE writes a function only with CREATE on a schema' },
  TYPE: { nothingBeyondReading: 'USAGE names the type in a definition it cannot create' },
};

/** What the reader owns, of any kind: an owner may alter or drop what admin's objects depend on. */
export const OWNED = `SELECT 'it owns ' || pg_describe_object(d.classid, d.objid, d.objsubid) AS found
  FROM pg_shdepend d
  WHERE d.deptype = 'o' AND d.refclassid = 'pg_authid'::regclass
    AND d.refobjid = (SELECT r.oid FROM pg_roles r WHERE r.rolname = $1)
    AND d.dbid IN (0, (SELECT b.oid FROM pg_database b WHERE b.datname = current_database()))`;

/** The one thing the reader must be able to do: read every table in `public`. */
export const UNREAD = `SELECT 'it cannot read ' || n.nspname || '.' || c.relname AS found
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p') AND n.nspname = 'public' AND NOT has_table_privilege($1, c.oid, 'SELECT')`;

/** What a default may give the reader or PUBLIC on objects to come, by `defaclobjtype`. A kind
 *  missing here is refused whole. */
const DEFAULT_BEYOND_READING: Record<string, { name: string; letters: string }> = {
  r: { name: 'tables', letters: 'awdDxtm' },
  S: { name: 'sequences', letters: 'wU' },
  n: { name: 'schemas', letters: 'C' },
  f: { name: 'functions', letters: '' },
  T: { name: 'types', letters: '' },
};

/** Everything the reader can do beyond reading, from its EFFECTIVE privileges: whatever the source
 *  of a grant, by name, column, PUBLIC, a membership or a default, it shows here. */
export async function beyondReading(client: SqlClient): Promise<string[]> {
  const found: string[] = [];
  const role = await run(
    client,
    'SELECT rolcanlogin, rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls AS elevated FROM pg_roles WHERE rolname = $1',
    [READER],
  );
  if (role.rows[0]?.rolcanlogin !== true) found.push('it cannot log in');
  if (role.rows[0]?.elevated === true) found.push('it holds a role attribute beyond LOGIN');
  const memberships = await run(
    client,
    'SELECT g.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member JOIN pg_roles g ON g.oid = m.roleid WHERE r.rolname = $1',
    [READER],
  );
  for (const { rolname } of memberships.rows) found.push(`it is a member of ${String(rolname)}`);
  for (const check of [...Object.values(OBJECT_CHECKS), OWNED, UNREAD])
    if (typeof check === 'string')
      for (const row of (await run(client, check, [READER])).rows) found.push(String(row.found));
  const defaults = await run(
    client,
    'SELECT defaclnamespace::regnamespace::text AS schema, defaclobjtype AS kind, defaclacl::text AS acl FROM pg_default_acl',
  );
  for (const { schema, kind, acl } of defaults.rows) {
    const where = schema === '-' ? 'every schema' : String(schema);
    const beyond = DEFAULT_BEYOND_READING[String(kind)];
    for (const entry of String(acl)
      .replace(/^\{|\}$/g, '')
      .replaceAll('"', '')
      .split(',')) {
      const grantee = entry.slice(0, entry.indexOf('='));
      if (grantee !== READER && grantee !== '') continue;
      const letters = entry.slice(grantee.length + 1).split('/')[0];
      const exceeds =
        beyond === undefined ||
        letters.includes('*') ||
        [...letters].some((l) => beyond.letters.includes(l));
      if (exceeds)
        found.push(
          `a default in ${where} gives ${grantee === '' ? 'PUBLIC' : 'it'} ${letters} on ${beyond?.name ?? `kind ${String(kind)}`}`,
        );
    }
  }
  return found;
}

export async function grantReader(client: SqlClient, props: GrantProperties): Promise<void> {
  const arn = props.ReaderRoleArn;
  if (!ROLE_ARN.test(arn)) throw new Error(`not a role ARN: ${arn}`);

  // Postgres has no `CREATE ROLE IF NOT EXISTS`, DSQL no PL/pgSQL, and a second CREATE is `42710`;
  // the ALTER gives a role made some other way the LOGIN a mapping needs.
  const role = await run(client, 'SELECT 1 FROM pg_roles WHERE rolname = $1', [READER]);
  if (role.rows.length === 0)
    await run(client, 'CREATE ROLE archive_reader WITH LOGIN', undefined, '42710');
  await run(client, 'ALTER ROLE archive_reader WITH LOGIN');

  // Tables the capture creates later are readable on creation; the deploy runs before it does.
  await run(
    client,
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO archive_reader',
  );
  const held = await run(
    client,
    "SELECT table_name FROM information_schema.role_table_grants WHERE grantee = $1 AND table_schema = 'public' AND privilege_type = 'SELECT'",
    [READER],
  );
  const reading = new Set(held.rows.map((r) => String(r.table_name)));
  const tables = await run(client, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  for (const { tablename } of tables.rows)
    if (!reading.has(String(tablename)))
      await run(
        client,
        `GRANT SELECT ON public.${escapeIdentifier(String(tablename))} TO archive_reader`,
      );

  // Verified, never repaired: a privilege this grant did not give is an admin's to remove.
  const beyond = await beyondReading(client);

  // Every mapping revoked, the current one too: a mapping binds the role rather than its ARN, and
  // only a revoke and a grant re-bind it (`infra/docs/dsql-constraints.md`).
  const mapped = await run(
    client,
    'SELECT arn FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1',
    [READER],
  );
  for (const { arn: old } of mapped.rows)
    await run(
      client,
      `AWS IAM REVOKE archive_reader FROM ${escapeLiteral(String(old))}`,
      undefined,
      '42704',
    );
  // Failing closed: a reader that can do more than read is left with no mapping to connect by.
  if (beyond.length > 0)
    throw new Error(`archive_reader can do more than read: ${beyond.join('; ')}`);
  await run(client, `AWS IAM GRANT archive_reader TO ${escapeLiteral(arn)}`);
}

export const CONNECT_ATTEMPTS = 3;

/** A new stack's first connect can come before IAM carries the function's new grant, which DSQL
 *  refuses `08006`: attempts seconds apart outlast that, inside the function's timeout. */
async function connected() {
  for (let attempt = 1; ; attempt++) {
    try {
      return await connect();
    } catch (err) {
      if (codeOf(err) !== '08006' || attempt === CONNECT_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5_000 * attempt));
    }
  }
}

export async function handler(event: Request): Promise<void> {
  let reason: string | undefined;
  try {
    // A Delete sends nothing: the cluster is retained and the role goes with the stack.
    if (event.RequestType !== 'Delete') {
      const client = await connected();
      try {
        await grantReader(client, event.ResourceProperties);
      } finally {
        // A grant that committed is not failed by a connection that will not close.
        await client.end().catch((e: unknown) => console.error('archive reader grant: end', e));
      }
    }
  } catch (err) {
    console.error('archive reader grant failed', err);
    // Printable ASCII, so a character costs at most two bytes and the body stays under 4096.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    reason = text.replace(/[^ -~]/g, '?').slice(0, 1000);
  }

  // A constant physical id, or CloudFormation reads an Update as a replacement. A byte body and no
  // content type, as AWS's `cfn-response` sends: the presigned URL was signed without one.
  const body = JSON.stringify({
    Status: reason === undefined ? 'SUCCESS' : 'FAILED',
    ...(reason === undefined ? {} : { Reason: reason }),
    PhysicalResourceId: READER,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
  });
  const answer = await fetch(event.ResponseURL, { method: 'PUT', body: Buffer.from(body) });
  // Thrown, so Lambda's async retry sends it again while the event is young enough to run.
  if (!answer.ok) throw new Error(`the custom resource response was refused: ${answer.status}`);
}
