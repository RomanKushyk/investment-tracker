---
name: work-issue
description: 'End-to-end path for a Ready GitHub issue — move to In progress, branch, failing test, implement, gates, /code-review within the round cap, squash-merge with Closes #N. Use for "work on #3", "fix #1", "take the next bug" or a pasted issue URL. Not for triage (that is triage-issue).'
---

# Work an issue

`GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` on every `gh` call. Use the helper block from `triage-issue/SKILL.md` for `set_status`.

1. **Pick.** Only a `Ready` issue with no open blocker; a `bug` first, otherwise the open version milestone in order. `In progress` must be empty — `gh project item-list 2 --owner RomanKushyk --format json --jq '.items[]|select(.status=="In progress")|.content.number'` prints nothing. Then `set_status N "In progress"`.
2. **Read the bytes** of the body. The acceptance criteria are the contract; if one is not verifiable, `set_status N Triage`, comment why, stop.
3. **Branch** from `dev`: `git checkout dev && git pull --ff-only && git checkout -b <type>/<kebab-title>`.
4. **Failing test first**, committed alone. Then the change. A choice the issue leaves open — a package, an approach, a default, a number — is made against industry practice first (standards, the tool's documentation and installed source, how mature projects do it) and the source goes in the squash body; a question to the owner carries the sources in its options. Then `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`; `pnpm exec tsc --noEmit -p infra` from the root when `infra/` or `packages/core/` changes. UI: verify in the running browser at desktop and 360.
5. **Review.** `/code-review` on the branch. Fix, or decline in writing (the squash body). A second or third round only when a fix changed behaviour in `packages/core/**`, `src/lib/repository.ts`, `infra/**`, `.github/workflows/**`, or a defect class surfaced. Three is the cap; a fourth wanted → root-cause comment on the issue, split or redesign, no merge before that comment exists. A fix that keeps failing review is a heuristic: before offering patch, merge or redesign, research the principled tool (the repo's own precedents included) and prototype it against every finding.
6. **Done** — every criterion ticked, `navigation-map.md` updated if a route's values changed, `docs/DECISIONS.md` rewritten if a decision changed — then:

```bash
git checkout dev && git pull --ff-only && git merge --squash - && git commit   # body: what and why, declined findings, "Closes #N"
git push origin dev && git branch -D @{-1}
```
The close moves the item to `Done`.
