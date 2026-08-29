import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from './facts/markdown-files';

// GitHub renders a README in `.github/` as the repository landing page IN PLACE OF
// the root one, which here is the product spec. `.github/` documents itself in
// `WORKFLOWS.md` for exactly that reason — but a session following this repo's own
// "every folder has a README" habit would create the file, replace the public front
// page with CI notes, and pass every other check.
//
// Matched by SHAPE, not by an extension list. A first version named four spellings
// and claimed to name them all; GitHub also renders `.markdown`, `.mdown`, `.rdoc`,
// `.org`, `.textile`, `.asciidoc`, `.mediawiki` and more, so any list is a hole where
// the next one goes. `README` plus anything is the rule GitHub actually applies.
//
// Its own file, named for what it guards: this lived inside `dependabot-config.test.ts`
// for one review round, where the folder index described that file as being about
// `dependabot.yml` alone — and a later session superseding D104 would have deleted
// this guard along with it.
describe('a .github README stays absent, whatever it is called', () => {
  // A guard that only ever asserts ABSENCE passes just as well when it is looking
  // at the wrong place — the failure `markdown-files.ts` warns about, and the
  // reason every other check here opens with an anchor.
  it('is looking at the real .github/ — without this it could pass vacuously', () => {
    expect(existsSync(join(REPO, '.github/workflows/deploy-backend.yml'))).toBe(true);
  });

  // The chain has a SECOND hop. GitHub falls back `.github/README.md` → root
  // `README.md` → `docs/README.md`, and this repo has all three candidates but
  // wants the middle one. Guarding only the first hop leaves the other way to
  // displace the product spec wide open: delete or rename the root README and the
  // DOCS INDEX becomes the public front page, with nothing red anywhere.
  it('keeps the root README — deleting it promotes docs/README.md to the front page', () => {
    expect(existsSync(join(REPO, 'README.md'))).toBe(true);
  });

  it('finds no README of any spelling — one would replace the product spec as the front page', () => {
    // No `.github/` at all is a PASS, not a crash: a guard whose job is to assert
    // absence must not fail with ENOENT on a sparse checkout, which would read as
    // the caller's fault rather than as the clean state it actually is.
    const dir = join(REPO, '.github');
    const offenders = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile() && /^readme(\.|$)/i.test(e.name))
          .map((e) => e.name)
      : [];
    expect(offenders).toEqual([]);
  });
});
