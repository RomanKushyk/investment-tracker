# Dependabot — security only, and how an advisory reaches `dev`

Alerts and automated security fixes are on as a repository setting; there is no `.github/dependabot.yml` (nor `.yaml`) — see "Dependabot" in [`../DECISIONS.md`](../DECISIONS.md) for the ruling.
Dependabot cannot always raise a PR for an advisory — no compatible version, or it sits on a transitive dependency.
**The alert is the unit, not the PR**: closing the PR list is not closing the advisories, so re-run the alert query after any fix to confirm.

## Which manifest

| Manifest | Manager / lockfile | Fix |
|---|---|---|
| `package.json` (root) | pnpm / `pnpm-lock.yaml` | edit + `pnpm install`, or override |
| `infra/package.json` | npm / `infra/package-lock.json` | edit + `npm install`/`npm ci` |
| `.github/workflows/*.yml` | github-actions / none | hand-edit the `@vN` pin |

Overrides live in **`pnpm-workspace.yaml`**, never in `package.json`'s `pnpm` field — pnpm 11 no longer reads that field and only warns, so the fix looks applied and changes nothing.

**Merge locally, with this sequence — never with GitHub's merge button:** it would land a `dependabot[bot]`-authored squash on `dev`, which cannot be rewritten.

## With a PR

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

Steps that fail silently if skipped, not merely redundant:

- `git fetch` + `git rebase origin/dev` — without it the gates run against a stale base; `pnpm-lock.yaml` is where that diverges.
- The `pnpm install --frozen-lockfile` right after checkout — without it `node_modules` still holds the pre-bump tree and all four gates pass green against the version being replaced.
- `git merge-base --is-ancestor dev @{-1}` — without it, if `dev` moved while the gates ran, the squash silently becomes a three-way merge no gate has seen.
- `pnpm build` in the gate line — it is not one of the four repo gates; an `exports`/ESM shape change passes lint/typecheck/test/format and breaks only at build, after the merge.
- The final `pnpm install --frozen-lockfile` — without it `node_modules` can still hold the branch's tree rather than `dev`'s lockfile, the same mismatch in the opposite direction.
- `git branch -D @{-1}`, not `git branch -D -` — `git branch -D -` does not work; `@{-1}` is what `-` expands to elsewhere.

For an `infra/` alert, run `(cd infra && npm ci)` then `pnpm exec tsc --noEmit -p infra` before the gate line — the frozen-lockfile install above never touches `infra/node_modules`, so without these two a `pg` or `@aws-sdk/*` bump merges unverified.

## Without a PR

On a `chore/<kebab-title>` branch. First find out whether the package is even yours — a flagged version often sits under a transitive parent, not the one that looks obvious.

```sh
pnpm why <pkg>          # direct, or pulled in by whom?
```
If transitive, the discriminator is whether the parent's declared range admits the fix, not transitive-vs-direct — check the registry, not `node_modules` (pnpm's virtual store flattens scoped names, e.g. `@scope/pkg` → `scope+pkg`).

```sh
npm view '<parent>@<version>' dependencies peerDependencies optionalDependencies
```

If the range admits it, `pnpm update <pkg>`; if not, add a bounded override in `pnpm-workspace.yaml` (see "Which manifest" above), then `pnpm install`. Finish with the same gates and the same merge sequence as "With a PR", including the rebase.
