---
name: work-issue
description: 'Use when the owner wants a Ready GitHub issue worked, however tersely: "work on #3", "fix #1", "take the next issue", "resume #N", a pasted issue URL, or a bare #N. Always before any code tied to an issue: the claim and the branch come after an approved plan. Not for triage (triage-issue), a multi-part ask (plan-epic) or re-sorting the board on its own (order-milestone).'
argument-hint: '[#N | issue URL]'
---

# Work an issue

Progress, copied and ticked as you go:

```
- [ ] 1 Plan mode entered, In progress empty, the issue picked
- [ ] 2 Body read from bytes, readiness checked
- [ ] 3 Working tree and branch state read
- [ ] 4 Code explored, choices researched, one question round, plan approved
- [ ] 5 Issue claimed, branch ready
- [ ] 6 Failing test committed alone, then the change
- [ ] 7 Gates green, UI verified, evidence shown
- [ ] 8 Reviewed within the cap
- [ ] 9 Criteria ticked, squash-merged, dev pushed
```

Three things run through every step.

**Nothing of the issue's is written before the plan is approved.** Steps 1 to 4 move no card, change no status and touch nothing in the working tree, so they run in plan mode: `EnterPlanMode` first, `ExitPlanMode` with the plan last, and the first write for the issue — the board move, the branch — comes after approval. A triaged issue is criteria, not a diff, and the gap between the two is cheaper to close in a ten-line plan than in a finished change. A harness with no plan mode gets the plan in chat and waits for an explicit yes.

**One question round.** Everything the issue, the tree and the code leave open goes to the owner together, once, inside plan mode. A choice the issue leaves open — a package, an approach, a default, a number — is researched before it is asked or made: standards, the tool's documentation and installed source, how mature projects do it, each option carrying its source. An option list built from the codebase alone is an opinion and invites a second round.

**The criteria are the contract.** Every plan item ties to an acceptance criterion and names its check. An item with no criterion is scope creep or a missing criterion; the plan says which.

`GH_CONFIG_DIR="$HOME/.quirenote/gh-config"` on every `gh` call. `set_status` comes from the helper block in `triage-issue/SKILL.md`, `facts` from `order-milestone/SKILL.md`; shell state does not survive between tool calls, so source what a call needs.

## Inputs

- **An issue**: `#N` or a URL. None named: Step 1 picks from the board as it stands; the `order-milestone` skill is not run first. A title fragment ("the backfill one") is resolved with `gh issue list --search` and confirmed with the owner before Step 1 goes on, never guessed.
- Anything else in the request is a constraint on the work or a step to run after it. The plan says which.

## Step 1: Enter plan mode, pick

`EnterPlanMode`. `In progress` must be empty — this prints nothing — or hold exactly the issue the owner named, which makes the run a **resume**, the one word Steps 3 and 5 use for it; anything else stops the run with what holds the column (`item-list` reads every field of every card; this reads two, and with `Ready` in place of `In progress` it reads that column):

```bash
gh api graphql --paginate -f o=RomanKushyk -F p=2 -f query='query($o:String!,$p:Int!,$endCursor:String){user(login:$o){projectV2(number:$p){items(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{... on Issue{number}}}}}}}' --jq '.data.user.projectV2.items.nodes[]|select(.status.name=="In progress")|.content.number'
```

A named issue is the pick when it is a resume, or `Ready` and in the lowest open version milestone, or a `Ready` `observation` whose title date has come, whatever its milestone — never before that date. None named: a due `observation` comes first when it is `Ready` (this read, with `Ready`) with no open blocker (Step 2's relation read) — `gh issue list --label observation --state open --json number,title`, the lowest such number; else `facts`, and the pick is its first `Ready` line with an empty `after:` and an empty `subs:` whose title carries no date still to come.

## Step 2: Read the bytes, check readiness

`gh issue view N --json body --jq .body > "$SCRATCH/N.md"` and read that file; a pasted sample is bytes, never retyped. Relations come from the `facts` line, or, for an issue outside the lowest milestone, from the same GraphQL fields (`blockedBy`, `subIssues`, `parent`) read for that one issue. Then the readiness check, one line per item:

- **Criteria** present and each verifiable by a named test or a browser check at a named width.
- **Not blocked**: no open blocker; an epic with open sub-issues is not worked, one of them is.
- **Size**: one branch and one squash commit, every criterion tickable before the merge. Too big is a split, which rewrites the issue and creates another — `triage-issue`'s write, so the finding proposes the slices and the run ends.
- **Milestone**: the lowest open version, or a due observation.

A failed item ends the run there: Steps 3 and 4 are not entered. The finding and the owner's choices (another issue, one of the epic's sub-issues, a split through `triage-issue`, a relation to remove, back to `Triage` with a comment) go in one `AskUserQuestion`. An answer that names another issue starts Step 1 again with it; an answer that names a write makes it the one-line plan `ExitPlanMode` presents, so approval releases it. A criterion is never filled in here, because one written now reads exactly like one the triage wrote.

## Step 3: Read the working tree and the branch state

```bash
git status --porcelain          # anything printed: a question for the round, never a checkout over it
git fetch origin --prune
git branch -a --list            # read whole: a name that shares the title's words is a candidate, confirmed in the question round
```

A resume, or a confirmed branch: read `git log origin/dev..<branch>` and its diff, so the plan starts from what is there. Neither: the plan branches from `dev`.

## Step 4: Explore, research, ask once, plan, get approval

1. **Explore.** Where each criterion lands and what depends on it: `navigation-map.md` for a route, the `docs/DECISIONS.md` topics that bind the area, the tests that pin it. A wide search goes through `Explore` subagents so the main context stays for the work. A `[BRIEF]` issue goes through its design session and `design/extensions/` before code.
2. **Research the open choices.** For each one, before the question round: one search or documentation read outside this repository (`WebSearch`, `WebFetch`, `context7`, the installed package's source), then the plan's `Research` line records the choice, the source opened and what it says, or the search run and that it found no practice. A measurement of this repo's data is evidence for a premise, never that line's source. A choice without that line is not asked and not made.
3. **One `AskUserQuestion` round**: every readiness gap, the tree question, every open choice with its evidence. Nothing is assumed on silence.
4. **Write the plan** in the file plan mode names:

   > **Plan for #N** — the title
   > 1. [failing test that pins the criterion] (AC1) verify: `pnpm test <file>` fails on [what]
   > 2. [concrete, checkable change] (AC1) verify: [what to run or look at, and the expected result]
   > 3. ...
   > n. [a step no criterion asks for] (no criterion: the claim and branch | docs the change needs | a criterion the issue lacks — say which)
   > Files: `...`
   > Not doing: [out of scope, the other slices of a split, already done]
   > Research: [choice → the source opened and what it says; or the search run and that it found no practice]
   > Answers: [what the round settled]

   A UI criterion names its browser check at desktop and 360. The message that presents the plan names the first writes approval releases: the board move, the branch. A diff that fits one sentence gets a one-item plan with its check; it still goes through the dialog.
5. **`ExitPlanMode`.** "Keep planning" means revise and resubmit. Approval ends plan mode and starts Step 5.

## Step 5: Claim the issue, get on the branch

The first writes, in this order: Step 1's `In progress` read again, still as Step 1 found it, or the run stops and says what changed; `set_status N "In progress"` unless this is a resume; then

```bash
git checkout dev && git pull --ff-only && git checkout -b <type>/<kebab-title>   # feat fix docs refactor test chore infra
```

A resume checks its branch out and rebases on `origin/dev` (local `dev` was only fetched). The tree answer (stash, commit elsewhere, abandon) is applied before any checkout.

## Step 6: Failing test first, then the change

The failing test is committed alone, its red output shown. Then the change, surgical: every changed line traces to a plan item, existing patterns are followed, and a refactoring is proposed out loud or not done. A requirement that forks mid-way is one more question with researched options, not a guess. A comment says why in one or two lines; history, dates and measurements come out of the comments you touch. `docs/DECISIONS.md` is rewritten in place when a decision changed, `navigation-map.md` when a route's values changed.

## Step 7: Gates and evidence

`pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, each read by its own exit code, never through a pipe; `pnpm exec tsc --noEmit -p infra` from the root when `infra/` or `packages/core/` changed. UI: the running dev server (check the port before starting one), the chrome-devtools MCP, desktop and 360, each criterion looked at. Report results as they came out, failures included, with the output or the screenshot; a check that could not run is reported as not run.

## Step 8: Review

`/code-review` on the branch diff, launched through an Agent on `opus` — a review does not run on this skill's model. Fix, or decline in writing in the squash body. A second or third round only when a fix changed behaviour in `packages/core/**`, `src/lib/repository.ts`, `infra/**`, `.github/workflows/**`, or a defect class surfaced. Three is the cap; a fourth wanted means the branch is wrong: a root-cause comment on the issue first, then split or redesign, no merge before that comment exists. A fix that keeps failing review is a heuristic: before offering patch, merge or redesign, research the principled tool (the repo's own precedents included) and prototype it against every finding.

## Step 9: Done, merge

Every criterion ticked in the issue body (`gh issue edit N --body-file`, the `[ ]` to `[x]`), then:

```bash
git checkout dev && git pull --ff-only && git merge --squash - && git commit   # body: what and why, the research sources, declined findings, "Closes #N"
git push origin dev && git branch -D @{-1}
```

The close moves the card to `Done`.

## Edge cases

- **Epic:** not worked; a failed readiness item, whose choices are its open sub-issues.
- **A branch already holds work:** a resume, from Step 3's reading; the plan lists what is done.
- **Already fixed or not reproducible:** report what you found; the owner decides whether it goes back to `Triage` with that comment.
- **No issue behind the ask:** ask whether there should be one (`triage-issue`); an owner's direct request for a docs or skill change goes on a branch without one.

## Not this skill

Turning a raw issue into a Ready one: `triage-issue`. A multi-part ask: `plan-epic`. Re-sorting the board on its own: `order-milestone`.
