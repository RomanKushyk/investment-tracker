# archive/ — closed work

**Nothing here is a task list. Do not execute from this folder.**

These documents are kept because they explain how the current code got its
shape, and because a few of them still bind. They are not reopened: work that
comes out of reading one becomes a task in `../plans/PLAN-NOW.md`, never a
checkbox ticked here.

| What | Status | Still binding? |
|---|---|---|
| [`BUILD-PLAN.md`](BUILD-PLAN.md) | v1, Tasks 1–7, closed 2026-07-28 | **Yes** — its pinned contracts, seed spec and motion standards hold until a decision supersedes them |
| [`design-briefs/`](design-briefs/) | Phases 2–4, all shipped | Only as the record of what each surface was meant to be |

**`NEXT-PHASE-DRAFT.md` left this folder on 2026-08-17.** It was the raw wishlist
`NEXT-PHASE-PLAN.md` was built from — and it was still being added to, which made
it a live task list in the one folder whose rule is *never a task list*. It moved
to [`../plans/USER-FEATURES-DRAFT.md`](../plans/USER-FEATURES-DRAFT.md) and was
pruned to the seven items that are neither shipped nor already carried by a plan.

## Why BUILD-PLAN is here rather than in plans/

Because it is finished, and a finished plan sitting beside live ones invites
picking a task out of it. Its *contracts* are still in force — the seed figures,
the number formats, the motion standards — and those are cited from code by
name. Being binding and being open are different things.

## Two notes on reading these

**Paths inside these files were updated on 2026-08-12** when `docs/` was
reorganised, so their links still resolve. Nothing else in them was rewritten —
the text is the record as it stood.

**The wishlist that used to be here is now `../plans/USER-FEATURES-DRAFT.md`,**
with the shipped items removed and a table recording where each went. One had
changed shape rather than shipped as written: "live ₴/$ rate from Google
finances" became A5, sourced from the NBU statistics API instead, because it is
public, CORS-open and authoritative for a hryvnia rate.
