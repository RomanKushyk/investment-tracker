# Section H — groomed from the idea list of 2026-08-18 (2 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A23. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

## A23 — Design brief: provider-first asset creation — `docs/design-brief-asset-create`

**The draft's own words for the goal are the best statement of it:** *"the user
should input minimum data, especially minimum sensitive data"* — pick a provider,
pick from the assets it lists, type a name only for `custom`, and let everything
else fill itself.

- [x] Read what exists first — and it is indeed a re-ordering, not a new
      capability. Every state the flow needs (loading · loaded · empty ·
      error→manual · stale · demo-disabled) already ships from Phase 3's S7.
      What is currently the LAST group, off by default, becomes the FIRST
      question.
- [x] The catalog boundary is stated as G-1 — **and it turned out not to be an
      open question at all, which retires my own twice-repeated advice to hold
      this task until W7.** `NEXT-PHASE-PLAN.md` pins it verbatim: the scheduler
      registers newly listed provider assets *into the catalog, never into a
      portfolio*. W7 does not DECIDE that boundary, it IMPLEMENTS it, so a brief
      written today can state it correctly rather than guess.
- [x] Both hosts covered — § S5 takes the quick-create sub-card, including the
      nesting problem the provider step creates inside an already-nested dashed
      card at 360.

**THE FINDING THAT RESHAPES THE REQUEST.** The idea list asks the form to "fill
all possible inputs" so the user types "only asset name and amount". Mapped
field by field from `InzhurQuote` onto `Asset`, **that is achievable for a BOND
and is not for a FUND**: `yieldType`, `expectedPct` and `payoutSchedule` are
bonds-only — the type's own comment says *"Bonds only — funds carry none"* — and
nothing in the feed distinguishes a dividend fund from a capitalizing one. The
seed proves it is not pedantic: REIT pays dividends, Energy capitalizes, and the
feed separates them nowhere. So a bond pick leaves the user two fields and a
fund pick leaves four, and the design may not present the two as one flow.

**The second finding is about the dataset, not the feed.** The fetch is disabled
in DEMO (G4/D16, D19) and demo is the DEFAULT — so a form whose first question
is "which provider" has a dead provider list on first run, for every new user.
Today that is harmless because the link is an opt-in afterthought. Making it the
headline makes it the first thing a newcomer meets. § S4 draws the demo path as
a first-class screen for that reason, with the note that if the drawing needs an
apology, the design is wrong.

**Five decisions are left to the design session** rather than guessed: which
provider is preselected (the request's spirit and the default dataset point
different ways), whether units still leads inside the linked group, how a user's
edit is shown to be protected from a later fill, whether choosing Inzhur in demo
is allowed at all, and — ruled OUT of scope — a second real provider.

---

