// One PGlite per worker, emptied between tests: vitest gives each test file a worker process of its
// own, and an instance keeps the memory it booted with after `close()`.
import { PGlite } from '@electric-sql/pglite';

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
  /** What the tests registered to hear notifications; the instance, not the database, holds them. */
  listeners: (() => unknown)[];
}

let cluster: Cluster | undefined;
let queue: Promise<unknown> = Promise.resolve();
let boots = 0;

/** Clusters this worker has booted; `initdb` runs once for each. */
export const bootCount = (): number => boots;

/** The worker's PGlite, emptied for each test. Isolation is per schema: a test that adds, grants or
 *  sets anything outside one fails the next call by catalogue, and a built-in edited in place is shared. */
export function freshDb(): Promise<PGlite> {
  // Queued rather than refused: a hook that timed out can still be emptying the cluster.
  const next = queue.then(ready, ready);
  queue = next.catch(() => {});
  return next;
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
    const measure = await measures(db);
    await dropSchemas(db);
    const baseline = await read(db, measure);
    await recreatePublic(db);
    boots += 1;
    return { db, measure, baseline, listeners: shared(db) };
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

async function empty({ db, measure, baseline, listeners }: Cluster): Promise<void> {
  await db.exec('DISCARD ALL').catch(async (err: unknown) => {
    if (!LEFT_OPEN.has((err as { code?: string }).code ?? '')) throw err;
    await db.exec('ROLLBACK');
    await db.exec('DISCARD ALL');
  });
  // After DISCARD's own `UNLISTEN *`, so a stop whose SQL fails changes nothing: PGlite drops the
  // callback before it sends the query.
  for (const stop of listeners.splice(0)) await (async () => stop())().catch(() => {});
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
async function measures(db: PGlite): Promise<string> {
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
  return parts.join('\nUNION ALL\n');
}
