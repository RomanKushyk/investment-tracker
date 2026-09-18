// The committed SQL is an artifact, not a source: the next `drizzle-kit
// generate` silently discards a hand edit, so it has to fail here instead.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('regenerating the schema reproduces the committed SQL', () => {
  const out = mkdtempSync(join(tmpdir(), 'drizzle-'));
  // drizzle-kit rejects `--config` with `--out`; DRIZZLE_OUT (infra/drizzle.config.ts) carries it.
  execFileSync(
    'pnpm',
    ['drizzle-kit', 'generate', '--config=infra/drizzle.config.ts', '--name=user_schema'],
    {
      stdio: 'pipe',
      shell: process.platform === 'win32',
      env: { ...process.env, DRIZZLE_OUT: out },
    },
  );
  const generated = readdirSync(out).find((f) => f.endsWith('.sql'));
  if (!generated) {
    throw new Error(`drizzle-kit generate produced no .sql file in ${out}`);
  }
  // drizzle-kit always writes LF and `.gitattributes` pins `*.sql` to it, but development is
  // Windows and CI is Linux — belt and braces, not redundancy.
  const fresh = readFileSync(join(out, generated), 'utf8').replace(/\r\n/g, '\n');
  const committed = readFileSync('infra/migrations/003_user_schema.sql', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(fresh.trim()).toBe(committed.trim());

  // The comparison above cannot catch a wrong action: both sides are generated from
  // `schema/user.ts`, so a missing `.onDelete('restrict')` emits `ON DELETE no action` on both
  // and stays green. A text assertion over the generated SQL is what catches it.
  const KEYS = [
    'account_user_fk',
    'asset_user_fk',
    'transaction_asset_fk',
    'transaction_account_fk',
    'user_price_asset_fk',
  ];
  for (const key of KEYS) {
    const line = committed.split('\n').find((l) => l.includes(`"${key}"`));
    expect(line, `no statement declares ${key}`).toBeDefined();
    expect(line, `${key} does not carry ON DELETE restrict`).toContain('ON DELETE restrict');
  }
  // Exactly these five — a column-level `references()` derives a name of its own.
  const declared = [...committed.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g)].map(
    (m) => m[1],
  );
  expect(declared.sort()).toEqual([...KEYS].sort());
  // `drizzle-kit generate` is a child process: under a full parallel run it loses the CPU
  // race and blows the default timeout, intermittently.
}, 30_000);

it('declares every foreign key as a post-hoc ALTER, which is what the NOT VALID rule acts on', () => {
  // Not a style point: DSQL refuses `ADD CONSTRAINT` without `NOT VALID`, and `rewriteForDsql`
  // appends it on the way out. A key inlined into `CREATE TABLE` would leave the rewrite nothing
  // to act on and still be accepted, silently, since an inline key needs no clause.
  const committed = readFileSync('infra/migrations/003_user_schema.sql', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const tables = committed
    .split('--> statement-breakpoint')
    .filter((s) => s.includes('CREATE TABLE'));
  for (const table of tables) expect(table).not.toContain('FOREIGN KEY');
});
