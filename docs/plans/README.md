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

## The section files

**Split 2026-08-26 (D95), renamed by section 2026-08-27 (D98): no file in this
repository's documentation grows past its own committed length without
review.** The three plans became indexes; their bodies live beside them in
files named for the section they hold — the same shape `../decisions/` moved
to at D96. The plans started out named for the IDs they held (`A01-A20.md` and
so on); **D98 retires that scheme for live plans the way D96 retired it for
decisions** — a filename asserting an ID range disagrees with the Status
table's own section order the moment a section runs out of ID order, which
Section P running ahead of Section M already had.

| Plan | Index | Bodies |
|---|---|---|
| A | `PLAN-NOW.md` | [`section-c.md`](section-c.md) · [`section-p.md`](section-p.md) · [`section-m.md`](section-m.md) |
| B | `PLAN-WAITING.md` | [`phase-w-i-ii-iii.md`](phase-w-i-ii-iii.md) · [`phase-w-iv-v.md`](phase-w-iv-v.md) |
| C | `PLAN-OPEN.md` | [`still-open.md`](still-open.md) |

## Local rules

- **IDs never change.** `A20`, `W7`, `O26` are cited from commit messages, from
  `../decisions/`, from `infra/README.md` and from each other. A split or a
  rename moves a body between files; neither renumbers one.
- **Moving is not rewriting.** Bodies move verbatim. Tidying in transit is the
  one thing that breaks a caller — the same rule `../decisions/RULES.md` states
  for entries, and for the same reason.
- **The 200-line cap is a ratchet, not a wall (D95, ratcheted by D98).** A file
  may not grow past its own committed length in `distillation-baseline.json`;
  growth that lands a file over 200 lines is reported with the diagnostic
  question — a file this long usually holds a second purpose — rather than an
  instruction to split. The index's section table is updated in the same
  commit as any split, and the drained file keeps a pointer rather than a stub.
- **Closing is a move, not a tick.** A finished task leaves for
  [`../archive/`](../archive/README.md) — body and ledger row together — so a
  live plan only ever lists live work. **Two exceptions, both deliberate:**
  Plan C's Status table keeps a row per answered question pointing at the
  decision, because there the row *is* the trail; and Plan B's **W2 stays in
  `phase-w-i-ii-iii.md` although it closed 2026-08-17**, because it was
  written as one section with W6, which is still dated — splitting a
  measurement from the follow-up it is the baseline for would lose what W6
  measures against. W2 leaves when W6 does.
- **A new section file gets a row in the table above** in the commit that
  creates it. An index that does not list a file is how a body becomes
  unreachable.
