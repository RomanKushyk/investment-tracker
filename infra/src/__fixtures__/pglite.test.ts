import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

import { REPO } from '../../../src/repo-root';
import { bootCount, freshDb } from './pglite';

const HELPER = 'infra/src/__fixtures__/pglite.ts';

// THE ZONE IS PATH-KEYED in `eslint.config.js`, and a selector that stops matching still parses
// green, so these cases lint text AT a path rather than reading the config back.
const eslint = new ESLint({ cwd: REPO });

/** What the PGlite zone says about some text, as seen from one file. A snippet that does not
 *  parse, or a path lint skips, would read as allowed, so either fails here. */
const refused = async (text: string, file = 'infra/src/x.test.ts') => {
  const [result] = await eslint.lintText(text, { filePath: join(REPO, file) });
  expect(result.fatalErrorCount, `${file} parses`).toBe(0);
  expect(
    result.messages.filter((m) => m.ruleId === null).map((m) => m.message),
    `${file} is linted`,
  ).toEqual([]);
  return result.messages
    .filter(
      (m) =>
        m.ruleId === '@typescript-eslint/no-restricted-imports' ||
        m.ruleId === 'no-restricted-syntax',
    )
    .map((m) => m.message);
};

/** What a test could see of a cluster. A session's own temp schema outlives `DISCARD ALL` empty,
 *  so it is left out. */
const catalogue = async (db: PGlite) =>
  (
    await db.query(`
      SELECT (SELECT string_agg(nspname || ':' || coalesce(nspacl::text, '') || ':' ||
                                nspowner::regrole::text || ':' ||
                                coalesce(obj_description(oid, 'pg_namespace'), ''), ';' ORDER BY nspname)
                FROM pg_namespace
               WHERE nspname NOT LIKE 'pg\\_temp\\_%' AND nspname NOT LIKE 'pg\\_toast\\_temp\\_%')
               AS schemas,
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast'))::int AS relations,
             (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema'))::int AS functions,
             (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast'))::int AS types,
             (SELECT string_agg(rolname, ',' ORDER BY rolname) FROM pg_roles) AS roles,
             (SELECT count(*) FROM pg_default_acl)::int AS default_privileges,
             (SELECT count(*) FROM pg_db_role_setting)::int AS settings,
             (SELECT count(*) FROM pg_largeobject_metadata)::int AS large_objects,
             current_setting('search_path') AS search_path`)
  ).rows[0];

describe('PGlite is built in one place, held by lint', () => {
  // Resolving the real flat config is the cost, and it lands in whichever case runs first.
  beforeAll(async () => {
    await refused('export {};');
  }, 20_000);

  it('has the helper the zone exempts', () => {
    expect(existsSync(join(REPO, HELPER))).toBe(true);
  });

  const PKG = '@electric-sql/pglite';
  it.each([
    ['a value import', `import { PGlite } from '${PKG}';\nexport const x = new PGlite();`],
    ['an aliased import', `import { PGlite as Db } from '${PKG}';\nexport const x = new Db();`],
    ['a namespace import', `import * as pg from '${PKG}';\nexport const x = new pg.PGlite();`],
    ['a re-export', `export { PGlite } from '${PKG}';`],
    ['a re-export of everything', `export * from '${PKG}';`],
    ['a require', `const { PGlite } = require('${PKG}');\nexport const x = PGlite;`],
    ['a dynamic import', `export const m = await import('${PKG}');`],
    ['a dynamic import in backticks', 'export const m = await import(`' + PKG + '`);'],
    ["vitest's importActual", `export const m = await vi.importActual('${PKG}');`],
    ['a createRequire', `export const m = createRequire(import.meta.url)('${PKG}');`],
    [
      "drizzle's driver",
      `import { drizzle } from 'drizzle-orm/pglite';\nexport const x = drizzle;`,
    ],
    [
      "drizzle's driver by its subpath",
      `import { drizzle } from 'drizzle-orm/pglite/driver';\nexport const x = drizzle;`,
    ],
    ["drizzle's driver loaded at run time", `export const m = await import('drizzle-orm/pglite');`],
    [
      "drizzle's driver through importActual",
      `export const m = await vi.importActual('drizzle-orm/pglite');`,
    ],
    ['a concurrent test', `it.concurrent('x', () => {});`],
    ['a concurrent block', `describe.concurrent('x', () => {});`],
    ['a concurrent test by a computed name', `it['concurrent']('x', () => {});`],
    ['concurrency in a config', `export default { test: { sequence: { concurrent: true } } };`],
    [
      'concurrency under a quoted key',
      `export default { test: { sequence: { 'concurrent': true } } };`,
    ],
    [
      'a value import under a comment about types',
      `// Only an \`import type\` of the class is allowed\nimport { PGlite } from '${PKG}';\nexport const x = PGlite;`,
    ],
  ])('refuses %s', async (_name, text) => {
    expect(await refused(text)).not.toEqual([]);
  });

  it.each([
    ['a type import', `import type { PGlite } from '${PKG}';\nexport type X = PGlite;`],
    ['an inline type import', `import { type PGlite } from '${PKG}';\nexport type X = PGlite;`],
    ['a constant', `import { types } from '${PKG}';\nexport const x = types;`],
    ['a type query', `export type M = typeof import('${PKG}');`],
  ])('allows %s', async (_name, text) => {
    expect(await refused(text)).toEqual([]);
  });

  it('holds concurrency to tests and their config, not a field in the app', async () => {
    const field = `export const f = ({ concurrent }: { concurrent: boolean }) => concurrent;`;
    expect(await refused(field, 'src/lib/x.ts')).toEqual([]);
    const config = `export default { test: { sequence: { concurrent: true } } };`;
    expect(await refused(config, 'vitest.config.ts')).not.toEqual([]);
  });

  // THE CONTROL: the zone is every source file but the helper, whatever extension vitest collects,
  // so it must hold in each tree and let the helper alone.
  it.each([
    'src/lib/x.ts',
    'packages/core/src/x.ts',
    'infra/src/x.ts',
    'src/screens/X.tsx',
    'infra/src/x.test.mts',
    'infra/src/x.test.js',
    'infra/src/x.test.mjs',
  ])('holds in %s', async (file) => {
    expect(
      await refused(`import { PGlite } from '${PKG}';\nexport const x = PGlite;`, file),
    ).not.toEqual([]);
  });

  it('lets the helper build the cluster', async () => {
    expect(
      await refused(`import { PGlite } from '${PKG}';\nexport const x = new PGlite();`, HELPER),
    ).toEqual([]);
  });
});

describe('freshDb', () => {
  let fresh: Awaited<ReturnType<typeof catalogue>>;
  beforeAll(async () => {
    const reference = new PGlite();
    fresh = await catalogue(reference);
    await reference.close();
  });

  it('boots one cluster however often a test asks for one', async () => {
    const first = await freshDb();
    const booted = bootCount();
    expect(await freshDb()).toBe(first);
    expect(bootCount()).toBe(booted);
  });

  it('returns what a fresh cluster holds after a test leaves a mess', async () => {
    const db = await freshDb();
    await db.exec(`
      CREATE TABLE t (id int PRIMARY KEY);
      INSERT INTO t VALUES (1);
      COMMENT ON TABLE t IS 'c';
      GRANT SELECT ON t TO PUBLIC;
      CREATE SCHEMA migrate_rehearsal_1;
      CREATE TABLE migrate_rehearsal_1.u (a int);
      ALTER DEFAULT PRIVILEGES IN SCHEMA migrate_rehearsal_1 GRANT SELECT ON TABLES TO PUBLIC;
      CREATE TEMP TABLE scratch (a int);
      CREATE SEQUENCE s;
      CREATE TYPE mood AS ENUM ('a');
      CREATE FUNCTION f() RETURNS int LANGUAGE sql AS 'SELECT 1';
      SET search_path = migrate_rehearsal_1;`);
    await expect(db.exec('BEGIN; SELECT 1 / 0;')).rejects.toThrow();

    const reset = await freshDb();
    expect(await catalogue(reset)).toEqual(fresh);
    expect((await reset.query(`SELECT to_regclass('public.t') AS t`)).rows).toEqual([{ t: null }]);
  });

  it('ends a transaction a test left open without failing it', async () => {
    const db = await freshDb();
    await db.exec('BEGIN; CREATE TABLE t (a int);');
    const reset = await freshDb();
    expect(await catalogue(reset)).toEqual(fresh);
  });

  it('stops the listeners a test left registered', async () => {
    const db = await freshDb();
    const heard: string[] = [];
    await db.listen('chan', (payload) => heard.push(`stale:${payload}`));
    db.onNotification((_channel, payload) => heard.push(`stale-any:${payload}`));

    const next = await freshDb();
    await next.listen('chan', (payload) => heard.push(`fresh:${payload}`));
    await next.exec(`NOTIFY chan, 'x'`);
    await new Promise((settle) => setTimeout(settle, 100));
    expect(heard).toEqual(['fresh:x']);
  });

  it('stops listeners after ending the transaction a test left failed', async () => {
    const db = await freshDb();
    await db.listen('chan', () => {});
    await db.listen('"my chan"', () => {});
    await expect(db.exec('BEGIN; SELECT 1 / 0;')).rejects.toThrow();
    const booted = bootCount();
    expect(await catalogue(await freshDb())).toEqual(fresh);
    expect(bootCount()).toBe(booted);
  });

  it('refuses to clone the shared cluster', async () => {
    await expect((await freshDb()).clone()).rejects.toThrow(/freshDb/);
  });

  // One of each way a schema drop falls short: an object of its own, a shared setting, a grant
  // changed on something the cluster shipped.
  it.each([
    ['a role', 'CREATE ROLE app_reader', /pg_authid/],
    ['a database setting', `ALTER DATABASE postgres SET work_mem = '8MB'`, /pg_db_role_setting/],
    ['a revoked built-in', 'REVOKE EXECUTE ON FUNCTION pg_catalog.now() FROM PUBLIC', /pg_proc/],
  ])('refuses %s it cannot drop, and boots clean for the next test', async (_name, sql, named) => {
    await (await freshDb()).exec(sql);
    await expect(freshDb()).rejects.toThrow(named);
    const booted = bootCount();
    const next = await freshDb();
    expect(bootCount()).toBe(booted + 1);
    expect(await catalogue(next)).toEqual(fresh);
  });

  it('boots a new cluster for the next test when one closes the shared one', async () => {
    const closed = await freshDb();
    await closed.close();
    const booted = bootCount();
    const next = await freshDb();
    expect(next).not.toBe(closed);
    expect(bootCount()).toBe(booted + 1);
    expect(await catalogue(next)).toEqual(fresh);
  });

  it('runs a second call after the first rather than racing it', async () => {
    const [first, second] = await Promise.all([freshDb(), freshDb()]);
    expect(second).toBe(first);
  });
});
