# archive/ — closed work

**Nothing here is a task list. Do not execute from this folder.**

These documents are kept because they explain how the current code got its
shape, and because a few of them still bind. They are not reopened: work that
comes out of reading one becomes a task in `../plans/PLAN-NOW.md`, never a
checkbox ticked here.

| What | Status | Still binding? |
|---|---|---|
| [`BUILD-PLAN.md`](BUILD-PLAN.md) | v1 index: global constraints, motion standards, status | **The motion standards, yes.** The pinned contracts and the seed spec moved to `build-plan/` on 2026-08-26 and bind from there |
| [`design-briefs/`](design-briefs/) | Phases 2–4, all shipped | Only as the record of what each surface was meant to be |
| [`plan-a/`](plan-a/README.md) | Plan A: <!--f:plan.closedTasks-->54<!--/f--> closed tasks, bodies + the full ledger | No — closed. Its rulings live in `../decisions/` |
| [`plan-b/`](plan-b/README.md) | Plan B: waiting items whose gate opened and closed | No — closed |
| [`plan-c/`](plan-c/README.md) | Plan C: the evidence under four answered questions | Only as the working a ruling rests on; the ruling binds, not this |
| [`build-plan/`](build-plan/) | The long half of `BUILD-PLAN.md` | **Its pinned contracts, yes** — see the index above |

**`NEXT-PHASE-DRAFT.md` left this folder on 2026-08-17.** It was the raw wishlist
`NEXT-PHASE-PLAN.md` was built from — and it was still being added to, which made
it a live task list in the one folder whose rule is *never a task list*. It moved
to `../plans/USER-FEATURES-DRAFT.md` and was
pruned to the seven items that are neither shipped nor already carried by a plan.
That file was itself retired 2026-08-28 (D103) and the inbox is now
[GitHub Issues](https://github.com/RomanKushyk/investment-tracker/issues) — the
name above is kept unlinked because it is what the record said at the time.

## Why BUILD-PLAN is here rather than in plans/

Because it is finished, and a finished plan sitting beside live ones invites
picking a task out of it. Its *contracts* are still in force — the seed figures,
the number formats, the motion standards — and those are cited from code by
name. Being binding and being open are different things.

## Two notes on reading these

**Paths inside these files were updated on 2026-08-12** when `docs/` was
reorganised, so their links still resolve. Nothing else in them was rewritten —
the text is the record as it stood.

**The wishlist that used to be here went to `../plans/USER-FEATURES-DRAFT.md`,
and since D103 lives in [GitHub Issues](https://github.com/RomanKushyk/investment-tracker/issues),**
with the shipped items removed and a table recording where each went. One had
changed shape rather than shipped as written: "live ₴/$ rate from Google
finances" became A5, sourced from the NBU statistics API instead, because it is
public, CORS-open and authoritative for a hryvnia rate.

## The 200-line cap (2026-08-26, D95)

The three live plans and `BUILD-PLAN.md` were split on 2026-08-26 so that no
documentation file exceeds 200 lines. Every folder here is the closed half of
that split — the three phase briefs included, each now an index over a
`phase-N/` folder of its own: bodies moved **verbatim**, IDs unchanged, each folder carrying a
`README.md` that maps every ID to the file holding it. Nothing was summarised —
a record that gets tidied stops being a record.
