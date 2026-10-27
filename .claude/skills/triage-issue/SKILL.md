---
name: triage-issue
description: 'Turn a raw GitHub issue (Project Status "Triage") into a Ready one — reproduce, write the standard body with acceptance criteria, set labels, relations and milestone, move it to Ready. Use at session start when the Triage column is non-empty, or when asked to triage, groom or refine an issue. Never writes code.'
model: opus
---

# Triage an issue

Every `gh` call runs with `GH_CONFIG_DIR="$HOME/.quirenote/gh-config"`. Project 2, owner `RomanKushyk`; ids are resolved at run time:

```bash
export GH_CONFIG_DIR="$HOME/.quirenote/gh-config"; P=2; O=RomanKushyk
PID=$(gh project view $P --owner $O --format json --jq .id)
FID=$(gh project field-list $P --owner $O --format json --jq '.fields[]|select(.name=="Status")|.id')
opt()  { gh project field-list $P --owner $O --format json --jq ".fields[]|select(.name==\"Status\")|.options[]|select(.name==\"$1\")|.id"; }
# Read off the issue and paged through the board: `gh project item-list` stops at its --limit, and a
# new card sits at the end of the board.
item() { gh api graphql -f o=$O -f r=investment-tracker -F n=$1 -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){projectItems(first:20){nodes{id project{number}}}}}}' --jq ".data.repository.issue.projectItems.nodes[]|select(.project.number==$P)|.id"; }
triage_list() { gh api graphql --paginate -f o=$O -F p=$P -f query='query($o:String!,$p:Int!,$endCursor:String){user(login:$o){projectV2(number:$p){items(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{status:fieldValueByName(name:"Status"){... on ProjectV2ItemFieldSingleSelectValue{name}} content{... on Issue{number title}}}}}}}' --jq '.data.user.projectV2.items.nodes[]|select(.status.name=="Triage")|"#\(.content.number) \(.content.title)"'; }
set_status()  { gh project item-edit --project-id $PID --id $(item $1) --field-id $FID --single-select-option-id $(opt "$2"); }
```

For each issue in `triage_list` (skip closed ones):

1. **Read the bytes.** `gh issue view N --json body --jq .body > "$SCRATCH/N.md"`. A pasted sample is bytes; never retype it.
2. **Understand.** A `bug` is reproduced on the running app or as a failing-test sketch. Not reproducible → comment what was tried, add `question`, leave it in Triage. A duplicate → `gh issue close N --duplicate-of M` — the only close triage performs. A choice the body will fix — approach, metric, convention, a default or a number — is made against industry practice first (standards, regulation, mature products, the tool's installed source), never against the codebase alone; a question to the owner carries the sources in its options.
3. **Split** when it will not fit one branch and one squash commit: the parent gets `epic`; each child `gh issue edit C --parent N`.
4. **Write the body** with `gh issue edit N --body-file`: `## Original` (the owner's words, quoted, unchanged) · `## Context` (what is observed and why it matters; for a bug the reproduction and the test that will pin it; the practice with its source URL where step 2 made a choice) · `## Scope` (what changes; what does not) · `## Acceptance criteria` (checkboxes, each verifiable by a named test or a browser check at a named width; intent, not implementation) · `## Verification` (tests to add, browser checks, `navigation-map.md` row if a route's values move).
5. **Label and relate.** One of `bug` / `enhancement` / `question` / `observation` (a dated reading, its date in the title) plus one `area:ui|core|infra`; `--add-blocked-by M` where gated; `--milestone vX.Y.Z`, the open version it is planned for (each milestone's description names its theme), never below the next release and never none.
6. `set_status N Ready`.

Definition of Ready, checked before step 6: original preserved · context says why · scope fits one branch · every criterion verifiable · type and area labels · relations set · planned version milestone set. **No code is written during triage.**

After the last issue, run the `order-milestone` skill: triage changed what can be picked next.
