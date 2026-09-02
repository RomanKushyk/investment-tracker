# Plan B — the closed record

**Not a task list.** Plan B's live items are in [`../../plans/PLAN-WAITING.md`](../../plans/PLAN-WAITING.md). This folder holds the waiting items whose gate opened and whose question was answered, moved **verbatim** on 2026-08-26 (D95).

| Item | Closed | Where |
|---|---|---|
| W1 — frozen-feed detector on real data | 2026-08-18 | [`W01.md`](W01.md) |
| W3 — Inzhur observation window, read | 2026-08-31 | [`W03-W04.md`](W03-W04.md) |
| W4 — Inzhur observation schema | 2026-09-02 | [`W03-W04.md`](W03-W04.md) |

**W3 AND W4 SHARE A FILE, and W4 is the first item to be archived from a plan
it did not live in.** Its row spent 2026-09-02 in `PLAN-NOW.md`'s Section Q
under [D130](../../decisions/D130.md), which rules that a moved item closes back
to the plan it came FROM — here, and not `plan-a/`. That is not tidiness:
`plan.closedTasks` counts `plan-a`'s ledger rows with a pattern that matches
`| W4 |`, so filing it there would have moved a fact fence three live indexes
cite and changed what it counts. W4 produced `observeInzhur`, `bond_terms` and
[D132](../../decisions/D132.md); W3 produced the window reading in
[`../../../infra/docs/w3-window.md`](../../../infra/docs/w3-window.md).

**W2 is not here.** It closed 2026-08-17, but it was written as one section with W6, which is still dated — the section stays in `PLAN-WAITING.md`'s range file until W6 closes too.
