# Dependabot — security only, and how an advisory reaches `dev`

The ruling and its reasons are [`../decisions/D104.md`](../decisions/D104.md) §2.
This file is the runbook: what to run, in what order, and which steps fail
silently if skipped. `CLAUDE.md` carries a pointer here and no figures, because
figures in an always-loaded file go stale in every session at once.

**It is over the 200-line diagnostic and stays whole — the answer, not an
omission.** D110 was written by adding a ruling to this file while leaving the
paste block that contradicted it 72 lines below; a review caught it, and anyone
reading top-to-bottom would have hit the stale recipe first. Splitting the two
paths into separate files makes that failure STRUCTURAL rather than occasional: a
ruling edited in one file, a recipe left stale in another, and no single read that
shows the disagreement. The ecosystem table is read BEFORE choosing a path and the
two paths now share one merge sequence, so there is no seam that does not cost a
second file open mid-procedure. Trim it when a section stops being load-bearing;
do not split it by size.

## What is enabled

Alerts and automated security fixes, as **repository settings**. There is
deliberately **no `.github/dependabot.yml` and no `.yaml`** — GitHub honours both, and both are asserted absent by `src/dependabot-config.test.ts`, because GitHub's UI commits that file when someone switches version updates on. It is what turns on routine
version-bump PRs, and every merge here costs a `/code-review` (D76), so version
churn taxes the gate that protects the app while buying no security.

## The alert is the unit, not the PR

Dependabot cannot always raise a PR — no compatible version, or the advisory
sits on a transitive dependency. **Draining the PR list is not draining the
advisories.** When security updates were first switched on, the counts differed
immediately: several alerts, one PR.

```sh
GH_CONFIG_DIR="$HOME/.quirenote/gh-config" gh api --paginate \
  'repos/RomanKushyk/investment-tracker/dependabot/alerts?state=open&per_page=100'
```

Every part of that was run before being written here:

- **The query goes in the URL.** `gh api -f state=open` flips the method to POST
  and the endpoint 404s.
- **`state=open`** because the endpoint otherwise returns every state, and
  dismissed alerts accumulate for ever.
- **`per_page=100`** because the default is 30, and **`--paginate`** because 100
  is still a page. A client-side `select(.state=="open")` over one page will one
  day print nothing while open advisories sit on the next — which reads exactly
  like clean.

## THREE ecosystems — decide which one the alert is against, first

Dependabot watches all three, and the dependency graph confirms it:

| Manifest | Manager | Lockfile | Installed by |
|---|---|---|---|
| `package.json` (root) | **pnpm** | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` |
| `infra/package.json` | **npm** | `infra/package-lock.json` | `npm ci` (in `deploy-backend.yml`) |
| `.github/workflows/*.yml` | **github-actions** | none | nothing — the `@vN` pin IS the version |

**Every command below is written for the root tree.** For an `infra/` advisory —
`pg`, an `@aws-sdk/*` package — substitute throughout: `npm ls <pkg>` for
`pnpm why`, `npm ci` / `npm install` for the pnpm installs, `overrides` in `infra/package.json` for `overrides:` in `pnpm-workspace.yaml`
— npm still reads that field in the manifest, unlike pnpm — and run them
**in `infra/`**. **The SYNTAX changes too, and swapping only the location
reproduces the exact silent no-op this file is about:** npm has no `parent>child`
selector, so pnpm's `'<parent>><pkg>': '<range>'` is read as one literal package
name that matches nothing — `npm install` succeeds, the lockfile is untouched,
`pnpm exec tsc --noEmit -p infra` passes, and the advisory is still live. npm
nests instead:

```jsonc
"overrides": { "<parent>": { "<pkg>": "<range>" } }
``` An
alert's page names the manifest; read it before typing anything.

**For a GitHub Actions advisory neither substitution applies** — there is no
manifest to edit and no lockfile to regenerate. Bump the `@vN` pin in the
workflow by hand on a `chore/…` branch; the four actions in use are
`actions/checkout`, `actions/setup-node`, `aws-actions/configure-aws-credentials`
and `aws-actions/setup-sam`. `.github/WORKFLOWS.md` carries the trap that pass
stepped over last time.

**And the GATES differ too, which is the sharper trap.** `pnpm typecheck` runs
root `tsc --noEmit`, whose `include` is `src`, `vite.config.ts`, `scripts` — it
never reads `infra/`. A bump of `@types/pg` or an `@aws-sdk/*` package can break
`infra/src` types while all four local gates pass green and esbuild strips them
on the way out. **Install in `infra/` first, then `pnpm exec tsc --noEmit -p infra`** for any `infra/` bump — `pnpm exec` because that folder declares no TypeScript of its own, and the install because the typecheck resolves `pg` and three `@aws-sdk/*` imports from `infra/node_modules`. **`npm ci` on the WITH-a-PR path** (Dependabot already regenerated the lockfile); **`npm install` on the hand path**, where you edited `infra/package.json` yourself and `npm ci` aborts with `EUSAGE` for a lockfile it no longer matches —
`deploy-backend.yml` runs it too, but that is after the merge — and finish with
`npm ci` **in `infra/`** rather than the root reinstall.

**The install step is per-tree, and this is the trap.**
`pnpm install --frozen-lockfile` at the root does not touch `infra/node_modules`,
so an `infra/` bump verified with the root install runs every gate against the
**pre-bump backend tree** — the same silent pass this file warns about for the
frontend, one directory over.

## With a PR

Its branch is `dependabot/…`, not a D73 `<type>/<kebab-title>` one, and that is
fine: **the exception is the branch NAME, never the gate.**

```sh
export GH_CONFIG_DIR="$HOME/.quirenote/gh-config"   # not optional on any of these
gh pr checkout <n>
git fetch origin
git rebase origin/dev
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check && pnpm build
# /code-review <n>                 <- the PR number, not the local branch; see below
git checkout dev && git pull --ff-only          # <- NOT optional; see below
git merge-base --is-ancestor dev @{-1}   || echo 'STOP: dev moved since the rebase — rebase again and re-run the gates'
git merge --squash -               # `-` = the branch you were just on; see below
git commit -F <message-file>       # subject + body, and `Closes #<n>` on its own line
git push origin dev
git branch -D @{-1}                # NOT `-`; see below
pnpm install --frozen-lockfile
```

Why each line that looks skippable is not:

- **MERGE LOCALLY — `gh pr merge` appears nowhere above, and that is D110.**
  GitHub's squash preserves the PR author, so the button lands a
  `dependabot[bot]`-authored commit on `dev`; D104 exempts the branch NAME only and
  `CLAUDE.md` pins authorship to the owner. `dev` forbids force-push, so it would
  be permanent. The link survives the change of mechanism: `Closes #<n>` in the
  commit body closes the PR at push, because `dev` is the default branch —
  measured on #28, the PR closed and the alert flipped to `fixed` on the first
  poll afterwards.
- **`GH_CONFIG_DIR`** — `gh pr checkout` and the alert query are still `gh`, and
  `gh` writes stamp an actor permanently and publicly; the work account has
  `push: true` here.
- **`-`, NOT a spelled-out branch name.** Dependabot's naming has two variations
  this file explicitly supports and a template would get wrong: an `infra/` advisory
  includes the manifest path (`dependabot/npm_and_yarn/infra/<pkg>-<version>`,
  because the manifest is not at the repo root), and a scoped package drops the `@`
  (`@aws-sdk/client-s3` → `aws-sdk/client-s3-…`). `pg` and `@aws-sdk/*` are the two
  examples this file names one section earlier, so a pasted template fails on both —
  and now that the merge IS the mechanism rather than a button, it fails as
  `not something we can merge` at the step that matters. `-` is whatever
  `gh pr checkout` left you on, which is always right.

  **But `-` is NOT universal, and the delete line spells `@{-1}` for that reason.**
  The shorthand is special-cased in `checkout`, `switch` and `merge`; `git branch`
  has no such case. Measured on git 2.54.0: `git branch -D -` prints
  `error: branch '-' not found` and deletes nothing, so a paste would leave the
  branch behind and read as done. `@{-1}` is what `-` expands to, and it works
  everywhere.
- **`git pull --ff-only` BEFORE the squash, AND the ancestry check after it.** The
  rebase above moved the DEPENDABOT branch onto the remote tip and left local `dev`
  where it was. If `dev` advanced while the gates ran, `git merge --squash` stages
  `dev-old..branch` — every intervening commit folded into the bump — and the push
  is rejected non-fast-forward, with force-push blocked by the ruleset.
  **The pull alone does not fix that, it moves the problem:** the fetch at the top
  of the block ran before the install, the gates and the review, so a pull now can
  put `dev` PAST the base the branch was rebased onto. The squash is then a real
  three-way merge whose result no gate has seen, conflicting in `pnpm-lock.yaml` —
  the file this runbook already names as the divergence point — and the promise
  three bullets down, that "what the rebase produces is literally what lands", is
  no longer true. `git merge-base --is-ancestor dev @{-1}` is the test: if it
  fails, go back to the rebase and run the gates again. It costs nothing in the
  common case, where the pull did nothing.
- **`git fetch` + `git rebase`** — Dependabot branched off whatever `dev` was
  when the advisory landed, and `gh pr checkout` fetches only the PR's own head.
  Without both, `origin/dev` is this clone's last-seen tip and the gates run
  against a base GitHub will not squash onto. `pnpm-lock.yaml` is exactly the
  file where that diverges. **Under D110 the rebase is LOAD-BEARING, not merely a
  verification device.** `git merge --squash` reads the locally rebased branch, so
  what the rebase produces is literally what lands on `dev` — GitHub squashes
  nothing any more. That also inverts the old conflict advice: resolve a conflict
  HERE, because the local resolution is exactly what gets pushed. (`git rebase
  --abort` first only if you want to start over; do not wait on Dependabot to
  redo it, as the previous flow required.)
- **FOR AN `infra/` ALERT, TWO MORE LINES BEFORE THE GATES** — written out rather
  than folded into the block above with a flag, because a conditional in a
  paste-me snippet is a step that skips itself when nobody sets the flag:

  ```sh
  (cd infra && npm ci)
  pnpm exec tsc --noEmit -p infra
  ```

  `pnpm install --frozen-lockfile` never touches `infra/node_modules`, so without
  these a `pg` or `@aws-sdk/*` bump runs all four gates against the pre-bump
  backend and merges unverified — the silent pass this file's manifest table
  exists to warn about. Run them as their own statements: chained behind `&&`, a
  failed install would take the typecheck with it and read as "skipped".
- **`pnpm build`, which is NOT one of the four repo gates.** `tsc --noEmit`, eslint
  and vitest resolve modules through Node and vitest; only `vite build` resolves
  through the production `exports` conditions. A bump whose `exports` map or
  ESM/CJS shape changed passes all four documented gates and breaks at build —
  after the merge, on `dev`, taking the deploy with it. `deploy-frontend.yml` runs
  it, so the failure is real but arrives late; it is the same silent-pass class
  this file already documents for `infra/`, one ecosystem over.
- **`pnpm install --frozen-lockfile`, and its absence FAILS SILENTLY** — a
  Dependabot PR touches `package.json` and `pnpm-lock.yaml` only, so without it
  `node_modules` still holds the pre-bump tree and all four gates pass green
  against the version you are replacing. This was measured on the first such PR:
  `node_modules` carried the old version while the PR shipped the new one.
- **Give `/code-review` the PR NUMBER.** After the rebase, `gh pr checkout`'s
  upstream is still `origin/dependabot/…`, so the default `@{upstream}...HEAD`
  spans every `dev` commit replayed under the bump and buries the one-line
  dependency diff — it misbehaves exactly when the rebase did something, which is
  the case this runbook insists on. `/code-review` takes a PR number, a branch or
  a path (**not** a git range), and the number is immune to the local rebase
  because `gh pr diff` computes against the remote merge base.
- **A MESSAGE FILE, not `-m`.** The subject follows this repo's commit convention
  (`chore: bump <pkg> to <version>`) rather than Dependabot's PR title, and the
  body is where D76's declined findings go, because there is no PR to hold them.
  It is also what keeps Dependabot's own `Signed-off-by: dependabot[bot]` trailer
  and its `updated-dependencies:` block off `dev` — `git merge --squash` would
  otherwise seed the commit message from the branch's commit.
- **Re-run the alert query afterwards.** A merged PR is not a closed advisory —
  that is this file's whole thesis, and this is the path where the two are most
  easily confused.
- **The final reinstall** closes the loop the first one opened: `node_modules`
  still holds whatever the branch installed, which after a `git pull --ff-only`
  may no longer be `dev`'s lockfile — the same silent mismatch in the opposite
  direction.

**THERE IS NO CHECK AT ALL, which is sharper than the warning above.** Measured:
`gh pr checks 28` reports "no checks reported on the … branch". Both workflows
trigger only on `push` to `dev` or `main`, and this repository has no
`pull_request` trigger anywhere, so the first automated run of any gate happens on
`dev` AFTER the merge — where a failure is a failed deploy rather than a red PR.
The local gates are not a belt-and-braces second opinion here; they are the only
opinion.

**Forbidden:** merging before the gates and the review. **A green Dependabot
check is not this repository's gate** — and on this path there is no check to be
green.

**The merge button is not used at all** (D110) — and NOTHING MECHANICALLY STOPS
YOU. `allow_squash_merge` is `true`, so the Squash button is fully clickable and
would land the `dependabot[bot]`-authored commit the whole decision exists to
prevent. The settings that ARE enforced cover different mistakes:
`allow_merge_commit` is `false`, so no merge commit can be produced by anyone;
`allow_auto_merge` is `false`, so nothing merges unattended; and the
`protect-long-lived-branches` ruleset requires linear history on `dev` and `main`
with no bypass actors. Three layers, none of which blocks THIS one — which is why
the sequence above is written out rather than left to habit, and why none of it
needs a `.github/dependabot.yml` — which is the only place Dependabot's own
`rebase-strategy` could be set, and which D104 forbids and
`src/dependabot-config.test.ts` asserts absent.

## Without a PR

On a `chore/<kebab-title>` branch — but **first find out whether the package is
even yours.** This is the common case, not the exception: of the first three open
alerts, the two without a PR (`esbuild`, `js-yaml`) appear nowhere in
`package.json`. They arrive through other packages, and **the obvious parent is the wrong one**. **Written in the past tense on purpose — this repository has since applied the fix
below, so running the command today returns two copies, not three.** As it stood:
`pnpm why esbuild` returned three, and the advisory `0.18.20` sat under **`@esbuild-kit/core-utils@3.3.2` ← `@esbuild-kit/esm-loader` ← `drizzle-kit`**, while `drizzle-kit` *itself* depends on `0.25.12` and `vite` pulls `0.28.1` — both already outside the range. Run `pnpm update drizzle-kit` on that reading and it looks like a fix: drizzle-kit's own esbuild is fine, and `0.18.20` stays in the lockfile. `@esbuild-kit/core-utils` is deprecated, so no release of it will ever carry the fix — **which is exactly when an override is the answer rather than a shortcut** — in
`pnpm-workspace.yaml`, never in `package.json`; see below for why that distinction
is the difference between a fix and a no-op that passes every gate. This is why the first command is `pnpm why` and not a guess.

```sh
pnpm why <pkg>          # direct, or pulled in by whom?
```

- **Direct dependency** — edit `package.json`, then `pnpm install` to regenerate
  the lockfile. Use `pnpm install`, not `pnpm update <pkg>`: at a caret range
  `update` re-resolves and can walk past the version you just pinned.
- **Transitive** — editing `package.json` cannot reach it. **The discriminator is
  NOT transitive-vs-direct, it is whether the PARENT'S DECLARED RANGE admits the
  fix**, so read that range first:

  ```sh
  npm view '<parent>@<version>' dependencies peerDependencies optionalDependencies
  ```

  **Asked of the registry, not of `node_modules`.** The obvious form —
  `require('./node_modules/.pnpm/<parent>@<v>/…')` — was written here first and
  fails on the very case this section walks through: pnpm's virtual store flattens
  `/` to `+`, so a SCOPED parent lives at `@esbuild-kit+core-utils@3.3.2`, and the
  unflattened path is a `MODULE_NOT_FOUND`. All three range fields are printed
  because a constraint declared as a peer or optional dependency would otherwise
  read as `undefined` and look like "no constraint at all".

  - **Range admits it** — `pnpm update <pkg>` is enough, and re-resolves the
    transitive entry directly. An earlier version of this file said that command
    "is a no-op on the lockfile entry that carries the advisory"; **measured on
    pnpm 11.10.0, that is false** — `pnpm update --help` documents
    `--depth <number> … Infinity is default`. js-yaml went 4.3.0 → 4.3.2 under
    `@eslint/eslintrc`'s `^4.3.0` in four lockfile lines, with `package.json`
    untouched. Following the old rule would have sent that to an override.
  - **Range does NOT admit it** — update the parent (`pnpm update <parent>`, if a
    release exists that depends on a fixed version) or force it from above. The
    esbuild case below is the worked example: `@esbuild-kit/core-utils@3.3.2` pins
    `~0.18.20`, so nothing short of an override moves it.

  **Overrides live in `pnpm-workspace.yaml`, NOT in `package.json`:**

  ```yaml
  overrides:
    '<parent>><pkg>': '<range that lands on the copy the tree ALREADY has>'
  ```

  **Bound the range; do not write `>=<fixed-version>`.** An unbounded range
  re-resolves to the newest match on every lockfile-regenerating install — which is
  the install this very path prescribes — so the first release past the range the
  rest of the tree floats in hands the parent a copy nobody else has, and the
  dedupe that justified the surgical form is gone. For esbuild that meant
  `'^0.28.1'` rather than `'>=0.25.0'`: same advisory coverage, and it tracks the
  0.28.x that vite and tsx float in instead of running ahead of it.

  then `pnpm install`. **pnpm 11 no longer reads the `pnpm` field in
  `package.json`** — an earlier version of this file prescribed exactly that form,
  and following it literally prints
  `[WARN] The "pnpm" field in package.json is no longer read by pnpm … ignored:
  "pnpm.overrides"`, succeeds, changes nothing, and passes every gate green.
  Measured: `esbuild@0.18.20` stayed in the lockfile. **A WARNING, not an error —
  this file's own thesis failing on this file's own worked example.**

  Scope the override to the parent (`'<parent>><pkg>'`) rather than the bare
  package name: the surgical form let `@esbuild-kit/core-utils` dedupe onto the
  `0.28.1` vite and tsx already pull — three esbuild copies became two — while a
  blanket `esbuild` override would drag vite, vitest and drizzle-kit off their
  tested ranges for no extra advisory coverage. `pnpm-workspace.yaml` already
  exists (it carries `allowBuilds`), it is NOT in `.prettierignore`, and adding an
  `overrides:` key is a deliberate act that belongs in the branch's commit message
  with the GHSA id.

**Then the gates.** The install above already happened — and *unfrozen*, on
purpose, because regenerating the lockfile is the point. (`--frozen-lockfile`
would abort with `ERR_PNPM_OUTDATED_LOCKFILE` only if run *before* that
regeneration; run after, it passes and proves nothing new.) So: the four checks
**plus `pnpm build`**, for the reason the with-a-PR path gives, then `/code-review`.

**The merge is the same sequence as the path above, INCLUDING the rebase** —
`git fetch origin`, `git rebase origin/dev`, then `git checkout dev`,
`git pull --ff-only`, the ancestry check, `git merge --squash`, a message file,
`git push origin dev` — since D110 forbids `gh pr merge` on BOTH paths.

**The rebase matters MORE here, not less.** A `dependabot/…` branch is cut from
`dev` the moment the advisory lands; a `chore/…` branch is cut from whatever this
clone's `dev` happened to be, which on a hand path is routinely stale. Skip it and
the squash merges an un-rebased branch against a freshly pulled `dev`, with no gate
ever run against that base.

The differences are only these: the branch is a `chore/…` one you named, there is
no `Closes #<n>` line, and D76's declined findings go in that commit's body because
there was never a PR to hold them.

**Verify the alert actually closed** — re-run the alert query. A green gate says
the app still builds; it says nothing about whether the advisory is gone.
