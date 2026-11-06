// One PGlite per worker, emptied between tests: vitest gives each test file a worker process of its
// own, and an instance keeps the memory it booted with after `close()`. `userDb` migrates it once and
// empties its rows by TRUNCATE while the migrated shape holds, sparing each test the migrations.
import { PGlite } from '@electric-sql/pglite';

import type { SqlClient } from '../migrate';
import { applyUserSchema } from './user-ledger';

/** PostgreSQL numbers every object made after `initdb` from here up. */
const FIRST_NORMAL_OID = 16384;

const NOT_TEMP = `nspname NOT LIKE 'pg\\_temp\\_%' AND nspname NOT LIKE 'pg\\_toast\\_temp\\_%'`;

/** SQLSTATEs for a transaction left open and one left failed: the two a test can hand on. */
const LEFT_OPEN = new Set(['25001', '25P02']);

interface Cluster {
  db: PGlite;
  /** One row per catalogue measure, built from the catalogue itself rather than a list of kinds. */
  measure: string;
  /** Those measures with every schema dropped, taken the moment the cluster booted. */
  baseline: Map<string, string>;
  /** The measures plus the shape of everything numbered past `initdb`, which a column added in
   *  place or a rename moves where a count does not. */
  shape: string;
  /** What `userDb` left: the snapshot taken right after migrating, and the TRUNCATE that empties it. */
  migrated?: Migrated;
  /** What the tests registered to hear notifications; the instance, not the database, holds them. */
  listeners: (() => unknown)[];
}

interface Migrated {
  snapshot: Map<string, string>;
  truncate: string;
  also: Step | undefined;
}

let cluster: Cluster | undefined;
let queue: Promise<unknown> = Promise.resolve();
let boots = 0;
let migrations = 0;

/** Clusters this worker has booted; `initdb` runs once for each. */
export const bootCount = (): number => boots;

/** Times this worker has applied the user schema. */
export const migrationCount = (): number => migrations;

/** The worker's PGlite, emptied for each test. Isolation is per schema: a test that adds, grants or
 *  sets anything outside one fails the next call by catalogue, and a built-in edited in place is shared. */
export const freshDb = (): Promise<PGlite> => queued(ready);

/** The worker's PGlite with the user schema, its rows emptied for each test. A test that changed
 *  the schema or left a transaction open gets `freshDb`'s reset and the migrations again. */
export const userDb = (also?: Step): Promise<PGlite> => queued(() => migrated(also));

/** A suite's own tables, made after the migrations and so kept in the shape and emptied with it.
 *  Matched by identity: a step written inline in a hook is a new one each test, and migrates each. */
type Step = (db: PGlite) => Promise<unknown>;

function queued(step: () => Promise<PGlite>): Promise<PGlite> {
  // Queued rather than refused: a hook that timed out can still be emptying the cluster.
  const next = queue.then(step, step);
  queue = next.catch(() => {});
  return next;
}

async function migrated(also: Step | undefined): Promise<PGlite> {
  const kept = cluster;
  if (kept?.migrated && kept.migrated.also === also && !kept.db.closed) {
    try {
      if (await truncated(kept, kept.migrated)) return kept.db;
    } catch (err) {
      cluster = undefined;
      await kept.db.close().catch(() => {});
      throw err;
    }
  }
  const db = await ready();
  await applyUserSchema(db);
  await also?.(db);
  const { rows } = await db.query<{ t: string | null }>(
    `SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') AS t
       FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
        AND schemaname NOT LIKE 'pg\\_temp\\_%'`,
  );
  const truncate = rows[0].t ? `TRUNCATE ${rows[0].t} RESTART IDENTITY CASCADE` : '';
  // Emptied here too, so a step that writes rows hands every test the same tables.
  if (truncate) await db.exec(truncate);
  const now = cluster!;
  // And the step's session state ended, as every later test finds it.
  if (!(await discard(now))) throw new Error('the userDb step left a transaction open');
  now.migrated = { snapshot: await read(db, now.shape), truncate, also };
  migrations += 1;
  return db;
}

/** Empties the rows when nothing else changed; false sends the test to the full reset. */
async function truncated(kept: Cluster, { snapshot, truncate }: Migrated): Promise<boolean> {
  if (!(await discard(kept))) return false;
  const now = await read(kept.db, kept.shape);
  if ([...snapshot].some(([key, value]) => now.get(key) !== value)) return false;
  if (truncate) await kept.db.exec(truncate);
  return true;
}

/** Ends the session's state and its listeners; false, with nothing ended, when a test left a
 *  transaction open. */
async function discard({ db, listeners }: Cluster): Promise<boolean> {
  try {
    await db.exec('DISCARD ALL');
  } catch (err) {
    if (LEFT_OPEN.has((err as { code?: string }).code ?? '')) return false;
    throw err;
  }
  // After DISCARD's own `UNLISTEN *`, so a stop whose SQL fails changes nothing: PGlite drops the
  // callback before it sends the query.
  for (const stop of listeners.splice(0)) await (async () => stop())().catch(() => {});
  return true;
}

async function ready(): Promise<PGlite> {
  // A test that closed the shared instance left nothing to empty: the next one boots anew.
  if (cluster?.db.closed) cluster = undefined;
  if (!cluster) {
    cluster = await boot();
    return cluster.db;
  }
  try {
    await empty(cluster);
    return cluster.db;
  } catch (err) {
    // Dropped rather than handed on, so one bad cluster fails one test.
    const failed = cluster;
    cluster = undefined;
    await failed.db.close().catch(() => {});
    throw err;
  }
}

async function boot(): Promise<Cluster> {
  const db = new PGlite();
  try {
    await db.waitReady;
    const { measure, shape } = await measures(db);
    await dropSchemas(db);
    const baseline = await read(db, measure);
    await recreatePublic(db);
    boots += 1;
    return { db, measure, shape, baseline, listeners: shared(db) };
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }
}

/** Rewires the parts of the instance a test could carry into the next one: every listener it
 *  registers is recorded for the reset to stop, and a clone would be a second cluster's memory. */
function shared(db: PGlite): (() => unknown)[] {
  const listeners: (() => unknown)[] = [];
  const listen = db.listen.bind(db);
  db.listen = async (channel, callback, tx) => {
    const stop = await listen(channel, callback, tx);
    listeners.push(stop);
    return stop;
  };
  const onNotification = db.onNotification.bind(db);
  db.onNotification = (callback) => {
    const stop = onNotification(callback);
    listeners.push(stop);
    return stop;
  };
  db.clone = () => Promise.reject(new Error('a clone is a second cluster; take freshDb() again'));
  return listeners;
}

async function empty(target: Cluster): Promise<void> {
  const { db, measure, baseline } = target;
  target.migrated = undefined;
  if (!(await discard(target))) {
    await db.exec('ROLLBACK');
    await discard(target);
  }
  await dropSchemas(db);
  const now = await read(db, measure);
  const changed = [...baseline].filter(([key, value]) => now.get(key) !== value);
  if (changed.length > 0) {
    const what = changed.map(([key]) => key).join(', ');
    throw new Error(`a test changed what dropping its schemas cannot reach: ${what}`);
  }
  await recreatePublic(db);
}

async function dropSchemas(db: PGlite): Promise<void> {
  const { rows } = await db.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') AND ${NOT_TEMP}`,
  );
  for (const { nspname } of rows) {
    await db.exec(`DROP SCHEMA "${nspname.replaceAll('"', '""')}" CASCADE`);
  }
}

const recreatePublic = (db: PGlite) =>
  db.exec(`
    CREATE SCHEMA public AUTHORIZATION pg_database_owner;
    GRANT USAGE ON SCHEMA public TO PUBLIC;
    COMMENT ON SCHEMA public IS 'standard public schema';`);

const read = async (db: PGlite, measure: string) =>
  new Map((await db.query<{ k: string; v: string }>(measure)).rows.map((r) => [r.k, r.v]));

/** What a schema drop leaves: objects numbered past `initdb` in every catalogue that numbers them,
 *  the grants on what `initdb` made, and the settings and comments no schema holds. */
async function measures(db: PGlite): Promise<{ measure: string; shape: string }> {
  const numbered = await db.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'oid' AND NOT a.attisdropped
      WHERE c.relnamespace = 'pg_catalog'::regnamespace AND c.relkind = 'r' ORDER BY 1`,
  );
  const grants = await db.query<{ relname: string; attname: string }>(
    `SELECT c.relname, a.attname FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'pg_catalog'::regnamespace AND c.relkind = 'r'
        AND a.atttypid = 'aclitem[]'::regtype AND NOT a.attisdropped ORDER BY 1, 2`,
  );
  const hash = (rows: string, order: string, from: string) =>
    `md5(coalesce(string_agg(${rows}, ',' ORDER BY ${order}), '')) FROM ${from}`;
  const parts = [
    ...numbered.rows.map(
      ({ relname }) =>
        `SELECT '${relname}' AS k, count(*)::text AS v FROM pg_catalog.${relname}
          WHERE oid >= ${FIRST_NORMAL_OID}${relname === 'pg_namespace' ? ` AND ${NOT_TEMP}` : ''}`,
    ),
    // `pg_init_privs` is hashed whole below; `pg_attribute` is keyed by column, not by oid.
    ...grants.rows
      .filter(({ relname }) => relname !== 'pg_init_privs')
      .map(({ relname, attname }) => {
        const [key, where] =
          relname === 'pg_attribute'
            ? [`attrelid::text || '.' || attnum`, `attrelid < ${FIRST_NORMAL_OID}`]
            : ['oid::text', `oid < ${FIRST_NORMAL_OID}`];
        const rows = `${key} || '=' || coalesce(${attname}::text, '')`;
        return `SELECT '${relname}.${attname}', ${hash(rows, key, `pg_catalog.${relname}`)} WHERE ${where}`;
      }),
    ...['pg_db_role_setting', 'pg_shdescription', 'pg_description', 'pg_init_privs'].map(
      (relname) => `SELECT '${relname}', ${hash('t::text', 't::text', `pg_catalog.${relname} t`)}`,
    ),
  ];
  // A TRUNCATE gives a table new storage under the same oid, and VACUUM or ANALYZE re-estimate it.
  const rewritten = `'relfilenode', 'relpages', 'reltuples', 'relallvisible', 'relfrozenxid', 'relminmxid'`;
  const shape = [
    ...numbered.rows.map(({ relname }) => {
      const row = relname === 'pg_class' ? `(to_jsonb(t) - ARRAY[${rewritten}])::text` : 't::text';
      // A session's temp schema outlives `DISCARD ALL` empty, as in the counts.
      const temp = relname === 'pg_namespace' ? ` AND ${NOT_TEMP}` : '';
      return `SELECT 'shape.${relname}', ${hash(row, 't.oid', `pg_catalog.${relname} t`)}
                WHERE t.oid >= ${FIRST_NORMAL_OID}${temp}`;
    }),
    ...[
      ['pg_attribute', 'attrelid, attnum', 'attrelid'],
      ['pg_index', 'indexrelid', 'indexrelid'],
      ['pg_inherits', 'inhrelid, inhseqno', 'inhrelid'],
    ].map(
      ([relname, order, key]) =>
        `SELECT 'shape.${relname}', ${hash('t::text', order, `pg_catalog.${relname} t`)}
          WHERE ${key} >= ${FIRST_NORMAL_OID}`,
    ),
  ];
  const join = (all: string[]) => all.join('\nUNION ALL\n');
  return { measure: join(parts), shape: join([...parts, ...shape]) };
}

/**
 * The cluster, except that one `COMMIT` answers a code: by default WITHOUT reaching it — the state
 * a conflicting transaction is really in, still open and waiting to be rolled back — or, `lands`,
 * after it committed, which DSQL warns a client can be told. PGlite is pessimistic and never
 * answers `40001` itself. The refused one is the first after a statement matching `after`, or the
 * first of all. Every statement is recorded, so "it started again" is assertable.
 */
export const refusingCommit = (
  db: PGlite,
  code: string,
  { after, lands = false }: { after?: RegExp; lands?: boolean } = {},
) => {
  const sent: string[] = [];
  let armed = after === undefined;
  let refused = false;
  const client: SqlClient = {
    query: async <R>(text: string, values?: unknown[]) => {
      sent.push(text);
      if (!armed && after?.test(text)) armed = true;
      if (text === 'COMMIT' && armed && !refused) {
        refused = true;
        if (lands) await db.query(text);
        throw Object.assign(new Error('change conflicts with another transaction (OC000)'), {
          code,
        });
      }
      return db.query<R>(text, values) as Promise<{ rows: R[] }>;
    },
  };
  return { client, sent };
};

export const refusingFirstCommit = (db: PGlite, code: string) => refusingCommit(db, code);

/** DSQL's per-transaction row ceiling, lowered, which PGlite does not have: `peak` is the most
 *  rows one transaction mutated, past the ceiling `54000`. */
export const ceilingClient = (db: PGlite, ceiling: number) => {
  const seen = { peak: 0 };
  let open = false;
  let used = 0;
  const client: SqlClient = {
    query: async <R>(text: string, values?: unknown[]) => {
      const verb = text.trimStart().split(/\s/, 1)[0].toUpperCase();
      if (verb === 'BEGIN' || verb === 'START') {
        open = true;
        used = 0;
      }
      const result = await db.query<R>(text, values);
      if (verb === 'COMMIT' || verb === 'ROLLBACK') open = false;
      if (verb === 'INSERT' || verb === 'UPDATE' || verb === 'DELETE') {
        if (!open) used = 0;
        used += result.affectedRows ?? 0;
        seen.peak = Math.max(seen.peak, used);
        if (used > ceiling) {
          throw Object.assign(new Error('transaction row limit exceeded'), { code: '54000' });
        }
      }
      return result as { rows: R[] };
    },
  };
  return { client, seen };
};
