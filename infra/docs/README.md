# infra/docs/ — the long half of `infra/README.md`

**Read [`../README.md`](../README.md) first.** It keeps what a session must see
before touching this folder: the layout, the local rules, the Deploying chapter
and the Phase 2 gate. These eight files moved **verbatim** on 2026-08-26 (D95);
nothing was summarised and every measured figure is where it was written.

| File | Holds | Read it when |
|---|---|---|
| [`durability.md`](durability.md) | Backups, PITR, the exercised restore, Vault Lock (D89) | Anything about backups changes |
| [`console-setup.md`](console-setup.md) | One-time console setup, SES by hand, the artifacts bucket, and whether reading the Inzhur feed is sanctioned | Rebuilding the account, or the sanction question comes up again |
| [`role-deploy.md`](role-deploy.md) | Role 1 — `quirenote-backend-deploy` | CI cannot assume its role |
| [`role-cfn-exec.md`](role-cfn-exec.md) | Role 2 — `quirenote-backend-cfn-exec`, **and the two traps that cost eight CI cycles** | Before touching either role |
| [`field-notes.md`](field-notes.md) | What only a real deploy revealed, and what the rename uncovered | A deploy behaves in a way the template does not explain |
| [`dpu.md`](dpu.md) | W2's week of real DPU, and the 2026-08-25 re-measurement | Cost, or before believing any DPU figure |
| [`replan-a50.md`](replan-a50.md) | A50's re-plan of `NEWEST_CAPTURE_PER_DATE`, 2026-08-26 — **a different query from `dpu.md`'s**, same defect class; the alias changed a sort node and no access path, at nine widths (D97) | Before quoting a DPU delta, or before measuring one |
| [`frozen-feed.md`](frozen-feed.md) | W1's detector on real data, and A20's deploy failure | The staleness alarms are in question |
| [`migrations-and-checks.md`](migrations-and-checks.md) | A19's `as_of` migration, A6's nightly DCF check | Running a migration on DSQL |

**`console-setup.md`, `role-deploy.md` and `role-cfn-exec.md` are `### ` sections
of the README's Deploying chapter** and read as part of it, not on their own.

**The DPU numbers have a history, and only the latest one is true.** `dpu.md`
carries both: ~1,620/month as first measured, and **~173/month after D91** found
an aliased `ORDER BY` disabling an index. A quote from that file without its date
is a wrong number.

**And a single figure is not a measurement.** `replan-a50.md` records four
rounds on `observeNbu`'s query — a *different* query from `dpu.md`'s streak one —
in which one cold `EXPLAIN (ANALYZE)` produced an apparent 9.1× compute win that
vanished once both forms were warmed and the run order alternated (D97). Before
quoting a DPU delta from anywhere in this folder, check it is a warm median and
not a first parse. **D91's 0.356 does not survive that check** — 0.26528 warm on
its own window — and **64.979 has never been re-measured at all.**
