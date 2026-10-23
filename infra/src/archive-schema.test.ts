// A DSQL key is immutable, so `ensureSchema` and its records in `migrations/` must agree on keys and
// names, never on columns outside a key. Read from the catalogue: a pattern misses key forms.
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { handler } from './capture';
import { connect } from './dsql';

vi.mock('./dsql', () => ({ connect: vi.fn() }));

const RECORDS = ['001_price_capture', '002_price_observation', '004_bond_terms'];

// `CREATE INDEX ASYNC` is DSQL's verb and PGlite refuses it; the index it builds is the same.
const local = (sql: string) => sql.replace(/\bINDEX\s+ASYNC\b/gi, 'INDEX');

let db: PGlite;

beforeEach(async () => {
  db = await freshDb();
  vi.mocked(connect).mockResolvedValue({
    query: (text: string, values?: unknown[]) => db.query(local(text), values),
    end: async () => {},
  } as unknown as Awaited<ReturnType<typeof connect>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const tables = async (schema: string) =>
  (
    await db.query<{ name: string }>(
      `SELECT table_name AS name FROM information_schema.tables
        WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`,
      [schema],
    )
  ).rows.map((r) => r.name);

// `pg_indexes`, because the SQL standard has no indexes; a primary key's own index is the key, read
// below, while a UNIQUE constraint's index is reported like any other.
const indexes = async (schema: string) =>
  (
    await db.query<{ name: string }>(
      `SELECT i.indexname AS name FROM pg_indexes i
        WHERE i.schemaname = $1
          AND NOT EXISTS (SELECT 1 FROM information_schema.table_constraints c
                           WHERE c.constraint_schema = $1 AND c.constraint_name = i.indexname
                             AND c.constraint_type = 'PRIMARY KEY')
        ORDER BY 1`,
      [schema],
    )
  ).rows.map((r) => r.name);

/** Each table's primary key as `(a date, b text)`, in key order: a retyped key column is a new key.
 *  `format_type`, because the standard's `data_type` drops a modifier such as `varchar(32)`. */
const keys = async (schema: string) =>
  new Map(
    (
      await db.query<{ name: string; key: string }>(
        `SELECT c.table_name AS name,
                '(' || string_agg(k.column_name || ' ' || format_type(a.atttypid, a.atttypmod), ', '
                                  ORDER BY k.ordinal_position) || ')' AS key
           FROM information_schema.table_constraints c
           JOIN information_schema.key_column_usage k
             ON k.constraint_schema = c.constraint_schema AND k.constraint_name = c.constraint_name
           JOIN pg_attribute a
             ON a.attrelid = format('%I.%I', k.table_schema, k.table_name)::regclass
            AND a.attname = k.column_name
          WHERE c.constraint_type = 'PRIMARY KEY' AND c.table_schema = $1
          GROUP BY 1`,
        [schema],
      )
    ).rows.map((r) => [r.name, r.key]),
  );

it('finds every table and index ensureSchema creates named in a record, and every primary key equal to its record', async () => {
  // An observe over an empty archive derives nothing, so `ensureSchema` is all it leaves.
  await handler({ observe: { source: 'inzhur', from: '2026-09-01', to: '2026-09-01' } });

  await db.exec('CREATE SCHEMA archive_record; SET search_path TO archive_record');
  const recordedIn = new Map<string, string>();
  for (const file of RECORDS) {
    await db.exec(
      local(readFileSync(new URL(`../migrations/${file}.sql`, import.meta.url), 'utf8')),
    );
    for (const table of await tables('archive_record')) {
      if (!recordedIn.has(table)) recordedIn.set(table, `${file}.sql`);
    }
  }

  // A `search_path` that sent `ensureSchema` elsewhere would leave nothing here to compare.
  const live = await tables('public');
  expect(live, 'ensureSchema created no table in public').not.toEqual([]);

  const recordedIndexes = new Set(await indexes('archive_record'));
  const unrecorded = [
    ...live.filter((table) => !recordedIn.has(table)),
    ...(await indexes('public')).filter((index) => !recordedIndexes.has(index)),
  ];
  expect(
    unrecorded,
    `created by ensureSchema, recorded by none of ${RECORDS.map((file) => `${file}.sql`).join(', ')}`,
  ).toEqual([]);

  const liveKeys = await keys('public');
  const recordedKeys = await keys('archive_record');
  for (const table of live) {
    const file = recordedIn.get(table);
    expect(
      recordedKeys.get(table),
      `${table}: ensureSchema (capture.ts) keys it ${liveKeys.get(table)}, ${file} ${recordedKeys.get(table)}`,
    ).toBe(liveKeys.get(table));
  }
});
