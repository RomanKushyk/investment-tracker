# superpowers/ — specs and the plans built from them

**This folder is written to by tooling**, which is why it stays where it is
rather than moving under `docs/`'s four-question layout — moving it would split
new specs from old ones. `../README.md` surfaces the two live specs instead.

| Folder | What it is | The rule |
|---|---|---|
| [`specs/`](specs/) | Design specs. **Two are live and load-bearing** — `2026-08-04-cloud-stack-and-cost.md` (why this stack, what it costs, the gate on each phase) and `2026-08-04-data-model.md` (what is stored and why, including the columns that cannot be added later) | The data model's observation key is **immutable on DSQL (D30)** — changing it is a DROP/CREATE of a live archive, not a migration |
| [`plans/`](plans/) | Implementation plans generated from a spec | **A plan here is executed once and then closed.** `2026-07-29-amplify-hybrid-deploy.md` shipped 2026-07-29; do not run it. The maintained versions of what it contains are `../reference/DEPLOYMENT.md` and D15 |

## Split 2026-08-26 (D95)

No documentation file exceeds 200 lines. Each file here kept its path and its
name and became an index over a folder of its own — `cloud-stack/`,
`data-model/`, `amplify-design/`, `amplify-hybrid-deploy/`. Bodies moved
**verbatim**; nothing was summarised, and no tooling path changed.

**A caution specific to `plans/amplify-hybrid-deploy/`:** roughly 300 of its 822
lines are the text that was written INTO `../reference/DEPLOYMENT.md` and D15.
Those two are maintained and bind; the plan is the draft they came from. When
they disagree, the maintained document is right.
