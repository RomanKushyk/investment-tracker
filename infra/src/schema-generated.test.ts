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
  const committed = readFileSync('infra/migrations/drafts/003_user_schema.sql', 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  expect(fresh.trim()).toBe(committed.trim());
});
