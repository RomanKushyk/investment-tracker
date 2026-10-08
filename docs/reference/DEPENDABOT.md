# Dependabot — security only, and how an advisory reaches `dev`

Alerts and automated security fixes are on as a repository setting; there is no `.github/dependabot.yml` (nor `.yaml`) — the ruling is under "Dependabot" in [`../DECISIONS.md`](../DECISIONS.md). **The advisory in the lockfile is the unit, not the PR and not the alert**, and `pnpm audit` is what counts them: re-run it after any fix.

- **A transitive advisory whose fix its parent's range admits gets no PR.** Dependabot's security job asks pnpm for `<pkg>@<version>`, which pnpm leaves undone where the locked version already satisfies the parent's range, so the job ends `security_update_not_possible` ([dependabot-core#15766](https://github.com/dependabot/dependabot-core/issues/15766)). Do not wait for one.
- **The alert list understates the lockfile.** GitHub's preset auto-triage rule dismisses development-only npm alerts, and a dismissed alert leaves its version where it was.
- **`.github/workflows/advisories.yml` files them.** It runs `pnpm audit` on `dev` daily, and when advisories remain opens one issue, labelled `bug`, `area:infra` and `dependencies`, naming each advisory, whether the in-range update clears it, and the command. While that issue is open it opens no other, since its fix audits afresh. Dispatch it with `dry_run` to print the issue instead of opening it. What to do with an advisory its update leaves is below, under "Without a PR".

## Which manifest

| Manifest | Manager / lockfile | Fix |
|---|---|---|
| `package.json` (root), `infra/package.json`, `packages/core/package.json` | pnpm / `pnpm-lock.yaml` — one workspace, one lockfile | edit + `pnpm install`, or override |
| `.github/workflows/*.yml` **and `.github/actions/*/action.yml`** | github-actions / none | hand-edit the `@vN` pin — `actions/upload-artifact` is pinned in the composite action ALONE, so a workflows-only grep misses it |

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

For an `infra/` or `packages/core/` alert, add `pnpm exec tsc --noEmit -p infra` to the gate line — the four gates do not read `infra/`, so without it a `pg` or `@aws-sdk/*` bump merges unverified. The install above already covers those trees: they are workspace members.

## Without a PR

On a `chore/<kebab-title>` branch. `pnpm why <pkg>` first, because a flagged version often sits under a transitive parent rather than the obvious one — and the discriminator is then whether the parent's declared range admits the fix, which is a question for the registry rather than `node_modules` (pnpm's virtual store flattens scoped names, `@scope/pkg` → `scope+pkg`):

```sh
npm view '<parent>@<version>' dependencies peerDependencies optionalDependencies
```

If the range admits it, `pnpm update <pkg> -r` — the bare name: with `@<version>` pnpm changes nothing for a transitive entry and still exits 0, the same refusal that stops Dependabot. If not, and the package is transitive, add a bounded override in `pnpm-workspace.yaml`, or move to a parent whose range admits the fix, then `pnpm install`; a direct dependency raises its own specifier instead. An advisory with no fix, or one accepted as it stands, goes in `auditConfig.ignoreGhsas` there, with the reason beside it: pnpm drops that GHSA on every version line it sits on, so it is accepted wherever it appears. Closing the advisories issue alone files it again the next day. Never `pnpm audit --fix`: its default writes overrides, and `--fix update` rewrites direct specifiers across the manifests and adds `minimumReleaseAgeExclude` entries. Finish with the same gates and the same merge sequence as above, rebase included.
