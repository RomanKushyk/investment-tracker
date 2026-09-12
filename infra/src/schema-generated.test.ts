// The committed SQL is an artifact, not a source. A hand edit is silently
// discarded by the next `drizzle-kit generate`, so it must fail here instead,
// where someone sees it.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('regenerating the schema reproduces the committed SQL', () => {
  const out = mkdtempSync(join(tmpdir(), 'drizzle-'));
  // DRIZZLE_OUT (infra/drizzle.config.ts) hands the config our own empty
  // temp dir directly, so `out` never needs to go on the command line —
  // drizzle-kit 0.31.10 rejects `--config` combined with `--out` anyway
  // ("You can't use both --config and other cli options for generate
  // command"). `out` holds exactly one file after this, so no need to know
  // or parse its generated name (`0000_user_schema.sql`).
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
  // drizzle-kit always writes LF; this repo's working tree does not (Windows
  // + core.autocrlf=true converts the committed file to CRLF on checkout,
  // invisibly to git itself — `git show HEAD:…` is LF-only). `.gitattributes`
  // pins `*.sql` to `eol=lf`, but development is Windows and CI is Linux, so
  // strip \r on both sides here too — belt and braces, not redundancy.
  const fresh = readFileSync(join(out, generated), 'utf8').replace(/\r\n/g, '\n');
  const committed = readFileSync('infra/migrations/003_user_schema.sql', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(fresh.trim()).toBe(committed.trim());

  // THE ACTION IS NOT GUARDED BY THE COMPARISON ABOVE, which is why this sits
  // here rather than trusting it. That comparison regenerates the SQL FROM
  // `schema/user.ts` and diffs it against a file regenerated the same way: omit
  // `.onDelete('restrict')` and drizzle silently emits `ON DELETE no action` on
  // BOTH sides, and the test is green. It catches a hand edit of the artifact,
  // never a wrong action in the source.
  //
  // A text assertion over the generated SQL is what catches exactly that
  // omission, and `schema/user.ts`'s header prescribes it by name. Five keys —
  // `asset.user_id -> app_user` is the one that is easy to miss, since `asset`
  // is the only per-user table whose `user_id` reaches `app_user` by no other
  // path.
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
  // And no SIXTH key slipped in unnamed — drizzle derives a name like
  // `account_user_id_app_user_user_id_fk` from a column-level `references()`,
  // which would break this file's rule that constraint names are ours.
  const declared = [...committed.matchAll(/ADD CONSTRAINT "([^"]+)" FOREIGN KEY/g)].map(
    (m) => m[1],
  );
  expect(declared.sort()).toEqual([...KEYS].sort());
  // A TIMEOUT ITS OWN COST EARNS, the same edit `d5a168d` made to the
  // scratch-directory guard for the same reason. This spawns `drizzle-kit
  // generate` as a child process: alone it finishes in about a second, but under
  // a full parallel run it loses the CPU race against 78 other files and blows
  // the 5000 ms default — intermittently, so the gate CLAUDE.md requires goes
  // red without a schema having changed. Measured 2026-09-02: three consecutive
  // full runs on `dev` failed twice this way, before this branch existed. Three
  // tests in `src/nested-checkouts.test.ts` carry the same edit for the same
  // reason; that file's fourth carries the note about what to do if a fifth
  // appears.
}, 30_000);

it('declares every foreign key as a post-hoc ALTER, which is what the NOT VALID rule acts on', () => {
  // Not a style point: DSQL refuses `ADD CONSTRAINT` without `NOT VALID`, and
  // `rewriteForDsql` appends it on the way out. If drizzle ever inlined a key
  // into `CREATE TABLE` instead, the rewrite would have nothing to act on and
  // the statement would still be accepted — silently, since an inline key needs
  // no clause. This is also what keeps the five CREATE TABLEs byte-identical,
  // so the migration ledger skips them and applies only the keys.
  const committed = readFileSync('infra/migrations/003_user_schema.sql', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const tables = committed
    .split('--> statement-breakpoint')
    .filter((s) => s.includes('CREATE TABLE'));
  for (const table of tables) expect(table).not.toContain('FOREIGN KEY');
});
