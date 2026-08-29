# Dependabot — security only, and how an advisory reaches `dev`

The ruling and its reasons are [`../decisions/D104.md`](../decisions/D104.md) §2.
This file is the runbook: what to run, in what order, and which steps fail
silently if skipped. `CLAUDE.md` carries a pointer here and no figures, because
figures in an always-loaded file go stale in every session at once.

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
`pnpm why`, `npm ci` / `npm install` for the pnpm installs, `overrides` in
`infra/package.json` for `pnpm.overrides`, and run them **in `infra/`**. An
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
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
# /code-review <n>                 <- the PR number, not the local branch; see below
gh pr merge <n> --squash --subject "chore: bump <pkg> to <version>" --body "<declined findings>"
git checkout dev && git pull --ff-only && pnpm install --frozen-lockfile
```

Why each line that looks skippable is not:

- **`GH_CONFIG_DIR`** — `gh pr merge` is a write whose actor is stamped
  permanently and publicly, and the work account has `push: true` here.
- **`git fetch` + `git rebase`** — Dependabot branched off whatever `dev` was
  when the advisory landed, and `gh pr checkout` fetches only the PR's own head.
  Without both, `origin/dev` is this clone's last-seen tip and the gates run
  against a base GitHub will not squash onto. `pnpm-lock.yaml` is exactly the
  file where that diverges. **The rebase is a verification device, not a push:**
  GitHub squashes the PR's remote head onto the real `dev`, so what it buys is
  that the gates ran on the right base. If it conflicts, `git rebase --abort`
  first — otherwise you are left mid-rebase — and resolve it in the PR, because
  a local fix is never sent.
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
- **`--subject`** — without it GitHub composes the squash subject from Dependabot's
  PR title, landing `Bump esbuild from 0.18.20 to 0.25.12 (#28)` on `dev`. D104
  carves out the branch NAME only; the commit convention is untouched.
- **`--body`** — D76 says declined findings go in the squash-merge commit body,
  because there is no PR to hold them. With `--squash` and no `-b`, GitHub
  composes the body from the commit list and the reasons land nowhere.
- **Re-run the alert query afterwards.** A merged PR is not a closed advisory —
  that is this file's whole thesis, and this is the path where the two are most
  easily confused.
- **The final reinstall** closes the loop the first one opened: after the merge
  the clone sits on a `dependabot/…` branch whose remote is gone, with
  `node_modules` AHEAD of `dev`'s lockfile — the same silent mismatch in the
  opposite direction.

**Forbidden:** merging before the gates and the review. **A green Dependabot
check is not this repository's gate.**

On the merge button itself: `allow_merge_commit` is `false`, so no merge commit
is possible; `allow_rebase_merge` and `allow_squash_merge` are both `true`.
**Use Squash.** "Rebase and merge" keeps history linear and breaks no rule of
the owner's — his rule is about merge COMMITS (D107) — but it lands the
branch's individual commits on `dev`, and D73 says a change ARRIVES by
squash-merge. That is a convention here, not a setting, so it is on you.

## Without a PR

On a `chore/<kebab-title>` branch — but **first find out whether the package is
even yours.** This is the common case, not the exception: of the first three open
alerts, the two without a PR (`esbuild`, `js-yaml`) appear nowhere in
`package.json`. They arrive through other packages, and **the obvious parent is the wrong one**. `pnpm why esbuild` returns three copies: the advisory `0.18.20` sits under **`@esbuild-kit/core-utils@3.3.2` ← `@esbuild-kit/esm-loader` ← `drizzle-kit`**, while `drizzle-kit` *itself* depends on `0.25.12` and `vite` pulls `0.28.1` — both already outside the range. Run `pnpm update drizzle-kit` on that reading and it looks like a fix: drizzle-kit's own esbuild is fine, and `0.18.20` stays in the lockfile. `@esbuild-kit/core-utils` is deprecated, so no release of it will ever carry the fix — **which is exactly when `pnpm.overrides` is the answer rather than a shortcut.** This is why the first command is `pnpm why` and not a guess.

```sh
pnpm why <pkg>          # direct, or pulled in by whom?
```

- **Direct dependency** — edit `package.json`, then `pnpm install` to regenerate
  the lockfile. Use `pnpm install`, not `pnpm update <pkg>`: at a caret range
  `update` re-resolves and can walk past the version you just pinned.
- **Transitive** — editing `package.json` cannot reach it, and `pnpm update <pkg>`
  is a no-op on the lockfile entry that carries the advisory. Either update the
  **parent** that pulls it (`pnpm update <parent>`, if a release exists that
  depends on a fixed version) or force it from above:

  ```jsonc
  "pnpm": { "overrides": { "<pkg>": ">=<fixed-version>" } }
  ```

  then `pnpm install`. There is no `pnpm.overrides` section today; adding one is
  a deliberate act and belongs in the branch's commit message with the GHSA id.

**Then the gates.** The install above already happened — and *unfrozen*, on
purpose, because regenerating the lockfile is the point. (`--frozen-lockfile`
would abort with `ERR_PNPM_OUTDATED_LOCKFILE` only if run *before* that
regeneration; run after, it passes and proves nothing new.) So: the four checks,
then `/code-review`.

**There is no PR here, so the merge differs from the one above.** No `<n>`, and
no PR body — squash-merge the `chore/…` branch into `dev` locally, and D76's
declined findings go in **that** commit's body. `gh pr merge --squash --body`
belongs to the with-a-PR path only.

**Verify the alert actually closed** — re-run the alert query. A green gate says
the app still builds; it says nothing about whether the advisory is gone.
