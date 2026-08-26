# plans/ — what to do next

**Start here: [`PLAN-NOW.md`](PLAN-NOW.md), first non-done task in section
order.** Everything else in this folder exists to keep work *out* of that file
until it is genuinely startable.

| File | What it is | The rule |
|---|---|---|
| [`NEXT-PHASE-PLAN.md`](NEXT-PHASE-PLAN.md) | The plan of record: shipped work, retired items, governing decisions G1–G8 | A contract change needs a decision entry |
| [`PLAN-NOW.md`](PLAN-NOW.md) | **Plan A — startable today.** Index + live Status table | Pick the first non-done task in section order. Gates green per merge |
| [`PLAN-WAITING.md`](PLAN-WAITING.md) | **Plan B — dated.** Index + the dated table | Read the table before any session touching `infra/` or the migration |
| [`PLAN-OPEN.md`](PLAN-OPEN.md) | **Plan C — open questions.** Index + Status table | **Never implement from it.** Answer → decision → task in Plan A or B |
| [`USER-FEATURES-DRAFT.md`](USER-FEATURES-DRAFT.md) | The owner's raw idea list, in his words — what the app does not do yet | Never implement from it either; keep it plain — bare bullets, no ceremony |
| [`USER-BUGS-DRAFT.md`](USER-BUGS-DRAFT.md) | Its pair: what the app does **wrong**, in his words | **Never fix from it — a line there is a symptom, not a diagnosis.** Reproduce, write the failing test, then fix. Keep it plain, and **copy a pasted sample rather than re-keying it** |
| [`FOLLOW-UPS.md`](FOLLOW-UPS.md) | Cosmetic backlog shipped as-is | Add deferred cosmetics here rather than reopening a closed plan |

## The range files

**Split 2026-08-26 (D95): no file in this repository's documentation goes over
200 lines.** The three plans became indexes; their bodies live beside them in
range files named for the IDs they hold. `../decisions/` used that shape
until 2026-08-26 and **no longer does — D96 made it one file per decision**,
because an append rule that always targets the highest-numbered file cannot hold
a cap. The plans keep ranges: a task body is not appended to, so nothing here
overflows on a schedule.

| Plan | Index | Bodies |
|---|---|---|
| A | `PLAN-NOW.md` | [`A01-A20.md`](A01-A20.md) · [`A41-A50.md`](A41-A50.md) · [`A51-A60.md`](A51-A60.md) |
| B | `PLAN-WAITING.md` | [`W02-W08.md`](W02-W08.md) · [`W09-W17.md`](W09-W17.md) |
| C | `PLAN-OPEN.md` | [`O05-O29.md`](O05-O29.md) |

## Local rules

- **IDs never change.** `A20`, `W7`, `O26` are cited from commit messages, from
  `../decisions/`, from `infra/README.md` and from each other. A split moves a
  body between files; it never renumbers one.
- **Moving is not rewriting.** Bodies move verbatim. Tidying in transit is the
  one thing that breaks a caller — the same rule `../decisions/README.md` states
  for entries, and for the same reason.
- **A file that outgrows 200 lines splits before the next entry is added**, not
  after. The index's range table is updated in the same commit, and the drained
  file keeps a pointer rather than a stub.
- **Closing is a move, not a tick.** A finished task leaves for
  [`../archive/`](../archive/README.md) — body and ledger row together — so a
  live plan only ever lists live work. **Two exceptions, both deliberate:**
  Plan C's Status table keeps a row per answered question pointing at the
  decision, because there the row *is* the trail; and Plan B's **W2 stays in
  `W02-W08.md` although it closed 2026-08-17**, because it was written as one
  section with W6, which is still dated — splitting a measurement from the
  follow-up it is the baseline for would lose what W6 measures against. W2
  leaves when W6 does.
- **A new range file gets a row in the table above** in the commit that creates
  it. An index that does not list a file is how a body becomes unreachable.
