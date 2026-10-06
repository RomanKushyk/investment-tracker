import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The committed tree, not the working one: every change under it runs both deploy workflows,
// and a commit's tree is one object whatever line endings a checkout of it has (*Deployment*).
const TREE = 'HEAD:packages/core/src';
const HERE = fileURLToPath(import.meta.url);

/** The derivation identifier: the git tree hash of packages/core/src at HEAD of `repo`, by
 *  default the repository this file sits in. */
export function derivationId(repo = resolve(dirname(HERE), '..')): string {
  // `repo` alone names the repository: every `GIT_` variable goes, a superset of `git rev-parse
  // --local-env-vars`, so a `GIT_DIR` that a hook or `rebase --exec` exported cannot outrank it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
  const id = execFileSync('git', ['rev-parse', TREE], { cwd: repo, encoding: 'utf8', env }).trim();
  if (!/^[0-9a-f]{40}$/.test(id)) throw new Error(`git rev-parse ${TREE} answered "${id}"`);
  return id;
}

// Run as a script, it prints what esbuild's `--define` takes: a value that is itself quoted.
// Both sides through realpath, since a link may stand in either; imported, `argv[1]` may be no file.
const main = process.argv[1];
if (main && existsSync(main) && realpathSync(main) === realpathSync(HERE)) {
  process.stdout.write(JSON.stringify(derivationId()));
}
