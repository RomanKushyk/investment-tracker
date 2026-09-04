---
name: plan-epic
description: 'Use when the owner hands over a multi-part ask — a pre-plan, a feature paragraph, "let''s build X", a list of wishes — that will not fit one issue and one branch, or asks to plan, decompose, or turn something into an epic; also when triage finds an issue whose parts need research or sequencing (a plain two-way split stays triage-issue''s step 3). Not for a single bug or a one-branch change (that is triage-issue) and not for executing an issue (work-issue).'
---

# Plan an epic

The owner's paragraph becomes one `epic` issue with sub-issues that are already `Ready`: decomposed, researched against the repo and the industry, improved where the research says so, reviewed as a set, and written in the `triage-issue` body shape. **Nothing on GitHub is written — created or edited — until the owner says yes; no code is written during planning.**

Every `gh` call runs with `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"`. Reuse `PID`, `FID` and `opt` from the helper block in `triage-issue/SKILL.md`; not `item`/`set_status`, which re-fetch the whole item list per call — step 7 edits items from one fetch. Working files go under `$SCRATCH/plan-epic/<slug>/`. Shell state does not survive between tool calls: re-export what a call needs.

## Inputs

- The owner's text, kept verbatim for `## Original`.
- `--dry-run`: run every step, write the bodies to files, print them, write nothing on GitHub.
- `--into N`: an existing issue that turns out to be this epic — at step 7 its body is rewritten in place and it gains the `epic` label, instead of a new epic being created.
- If the owner is not present (a subagent run, a dry run in a background session), every question in steps 1 and 3 is answered with the assumption you would recommend, and the assumptions are listed in the report; step 6 still stops.

## Procedure

### 0. Look before planning
`gh issue list --repo RomanKushyk/investment-tracker --state open --limit 200 --json number,title,labels` and read `docs/DECISIONS.md`'s headings. An open issue that already covers the ask becomes the epic — continue as if `--into N` had been given; an issue that covers one part becomes a sub-issue by relation, not a copy: at step 7 it gets the standard body, the parent link and `Ready`, like the new ones. Say what you found in one line.

### 1. Decompose
Write the goal in one sentence, then a numbered table — `# | Item | What must be learned | Unknown that changes the plan`. An item is one deliverable a session could finish on one branch. Collect the unknowns and ask the four that change the plan most in ONE `AskUserQuestion` batch (a recommended option first); the remaining unknowns, and anything you decided without asking, are assumptions written down.

### 2. Investigate, without reading it all yourself
For every item dispatch a read-only `Explore` subagent (1–3 items per agent, all in parallel) with this brief: the item's text; "report facts with `file:line`: the code paths involved, the `docs/DECISIONS.md` topics that bind them, existing tests, related open issues (`gh issue list … --search`), and what is already built". Explore agents cannot write files: save each reply yourself, one file per item, `$SCRATCH/plan-epic/<slug>/item-N.md`. In parallel run one `WebSearch` per item for the industry practice (how mature products or standards do this) and keep at least one source URL per item. Read the reports, not the code.

### 3. Compare and propose
One table — `Item | Today (repo, file:line) | Practice (source) | Proposal | Owner's call`. A proposal is a concrete change to the item (scope, approach, sequencing), or "matches practice — keep". Put the proposals to the owner in ONE `AskUserQuestion` (multi-select: which to accept); record accepted / declined with the owner's reason.

### 4. Review the set
Check, and fix before writing bodies:
- each item fits one branch and one squash commit — otherwise split it;
- dependencies are explicit: which item blocks which (this becomes `blocked-by`);
- no item contradicts a `docs/DECISIONS.md` topic — or the item names the topic it will rewrite;
- the epic's own acceptance is an integration check, not the sum of sub-issues;
- what is deliberately out of scope is written down;
- a release is named only if the owner committed to it; otherwise the milestone is none.

### 5. Write the bodies (files first, one per issue)
**Epic** — `$SCRATCH/plan-epic/<slug>/epic.md`:
```
## Original
> the owner's text, unchanged
## Context
Why now; what exists (from step 2); what the research changed (from step 3, accepted and declined).
## Scope
| # | Sub-issue | Blocked by | Decision topic touched |
|---|---|---|---|
Out of scope: …
## Acceptance criteria
- [ ] every sub-issue closed
- [ ] <integration check a session can run: a route at a width, a test file, a command>
## Verification
Gates; browser checks; `navigation-map.md` rows that move; DECISIONS topics rewritten.
```
**Each sub-issue** — `$SCRATCH/plan-epic/<slug>/sub-N.md`, the `triage-issue` shape exactly: `## Original` (the sentence of the owner's text this item comes from, quoted), `## Context` (facts from step 2 with `file:line`; the practice with its source URL; the accepted proposal), `## Scope` (what changes; what does not), `## Acceptance criteria` (checkboxes; each verifiable by a named test or a browser check at a named width; intent, not implementation), `## Verification`. Title: `<Epic short name>: <what changes>`. Labels: `bug`, `enhancement` or `question`, plus one `area:*`. Before step 6, check every sub-issue against `triage-issue`'s Definition of Ready — it is the same `Ready`.

### 6. Present, then stop
Print: the epic title and goal; the sub-issue titles with one-line acceptance summaries; the blocked-by graph; milestone and labels; the questions you assumed answers to. **Stop here.** With `--dry-run` print the body files too and end. Otherwise wait for the owner's explicit yes.

### 7. Create (only after yes)
```bash
R=RomanKushyk/investment-tracker; D="$SCRATCH/plan-epic/<slug>"; M=""   # M="--milestone vX.Y.Z" only if committed
E=$(gh issue create --repo $R --title "<epic title>" --body-file "$D/epic.md" --label epic --label "area:<x>" $M | sed 's#.*/##')
# with --into N instead: E=N; gh issue edit $E --repo $R --body-file "$D/epic.md" --add-label epic --add-label "area:<x>"
S1=$(gh issue create --repo $R --title "<Epic>: <change 1>" --body-file "$D/sub-1.md" --label enhancement --label "area:<x>" $M | sed 's#.*/##')
S2=$(gh issue create --repo $R --title "<Epic>: <change 2>" --body-file "$D/sub-2.md" --label enhancement --label "area:<x>" $M | sed 's#.*/##')
gh issue edit $S1 --repo $R --parent $E; gh issue edit $S2 --repo $R --parent $E   # every sub-issue, adopted ones too
gh issue edit $S2 --repo $R --add-blocked-by $S1                                     # every edge from step 4, one call per edge
```
Then: ONE `gh project item-list 2 --owner RomanKushyk --format json --limit 500 > "$D/items.json"`, read the item ids from it, `gh project item-edit` each new or adopted issue and the epic to `Ready`; verify with one more item-list fetch, not one per issue; rewrite the epic's `## Scope` table with the real numbers (`gh issue edit $E --repo $R --body-file "$D/epic.md"`); report `#E` and the sub-issue numbers. GitHub's GraphQL budget is small — never fetch the item list per issue, never poll.

## Rules that hold throughout
- Research lives in subagent reports and search results, cited by `file:line` and URL; you read reports, not the codebase.
- The owner's words are bytes: quoted, never retyped.
- A criterion names what a test or a browser check will show, not how the code will do it.
- Decisions are not rewritten here; the body names the `docs/DECISIONS.md` topic the work will rewrite.
- Two owner interruptions at most: the unknowns (step 1) and the proposals (step 3). The yes at step 6 is the third and last.

## Red flags — stop and go back a step
| Seen | Means |
|---|---|
| A sub-issue with no `file:line` in its Context | step 2 was skipped for it |
| A proposal with no source | step 3 became opinion |
| A criterion that says "implement X" | it restates the plan; rewrite it in step 5 as what will be observed |
| An item that needs two branches | split it (step 4) |
| Any GitHub write — create or edit — before the owner's yes, or during a `--dry-run` | step 6 was skipped |
| Reading `src/` in this context to "just check" | dispatch an Explore agent instead |
