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
| [`FOLLOW-UPS.md`](FOLLOW-UPS.md) | Cosmetic backlog shipped as-is | Add deferred cosmetics here rather than reopening a closed plan |

## The inbox is GitHub Issues, not a file (D103)

**Raw ideas and bug reports live at
[github.com/RomanKushyk/investment-tracker/issues](https://github.com/RomanKushyk/investment-tracker/issues)**,
labelled `enhancement` and `bug`. `USER-FEATURES-DRAFT.md` and
`USER-BUGS-DRAFT.md` were retired 2026-08-28; their 27 lines became issues
#1–#27, byte for byte.

- **The DIAGNOSIS rules did not change, only the surface — the routing rule did
  (D105, below). Nothing is built from an issue without understanding it first,
  and nothing is fixed from a `bug` issue without reproducing it first** — a
  line there is a symptom, not a diagnosis: reproduce, write the failing test,
  then fix. That is about diagnosis, never paperwork: since
  [D105](../decisions/D105.md) the work needs no plan body. A missing capability is an `enhancement`, not a `bug`; a cosmetic shipped
  on purpose is [`FOLLOW-UPS.md`](FOLLOW-UPS.md).
- **A pasted sample is BYTES — never re-key one.** Issue #1 carries a U+00A0 as
  its thousands separator, which is plausibly the whole bug. Quote the issue, do
  not retype it, and write the failing test against the bytes.
- **The default is: branch, do the work, `Closes #N`, and add NOTHING to this
  folder ([D105](../decisions/D105.md)).** `dev` is the default branch, so
  GitHub closes the issue on the squash-merge and leaves the commit↔issue link
  behind. Draining the inbox must not silt up the repository it was moved out
  of.
- **Grooming is the exception, not the handoff.** D103 made an issue into work
  by giving it a Status row in the right index and its body in the matching
  section file, in one commit; **D105 narrowed that to the cases that need it** —
  an issue big enough to want a plan body, or one that turns out to be gated on
  something. Reach for it deliberately, not by default.
- **Sequenced issues sit in the `after-current-plans` milestone**, and that is
  the whole progress view: it counts open against closed on one page. **The
  count is deliberately not repeated here** — triage adds issues to the
  milestone and `Closes #N` moves them from its open half to its closed half
  (they stay in it, which is what makes the progress bar work), so any number
  written down is wrong by the next session. (An issue filed from the app arrives with no milestone at
  all; that one shows up in `Needs sequencing`, not in this count.)
- **[D105](../decisions/D105.md)** finishes the live plans first — everything
  live in the three indexes minus three kinds of row: **the four far-gated W items
  D105 names (W9–W12); a task an index marks denied or withdrawn; a question that
  is open by design or costs nothing to leave.** For that last one read
  `PLAN-OPEN.md`'s **disposition sentence**, not the row's status cell — O30's cell
  says "not measurable on a free-tier pool" while the disposition puts it under
  "cost nothing to leave", and applying the rule to the cell yields six questions
  where D105 names five. Phase 6 and Phase 7 are IN. Only
  then are issues worked, one at a time. **No task IDs here on purpose** — they
  close, and a list in a rules file outlives the work it names. The indexes are
  the live authority; D105 is the authority on the rule. The milestone says
  *sequenced*, not *done first*, and `PLAN-WAITING.md`'s table — not any date
  repeated here — says which gates have actually opened.
- **Two saved views sit in the Issues sidebar (D108).** **`Needs sequencing`** is
  the one that matters: an issue filed from the GitHub app arrives with **no
  milestone**, so without this view a new issue lands invisibly among the ones
  already sequenced. Check it before assuming the inbox is drained.
  **`Bugs`** is the `bug` label — small, but that is the class allowed to
  preempt the plan order.
- **A GitHub Project exists, and it holds ISSUES ONLY.** It was created ahead of
  need on purpose (D108): until the plans are finished nothing is in progress, so
  the board draws one column, and the point is to have it configured before
  issues start moving rather than during. **Never put a plan task (`A`, `W`, `O`)
  on it** — that makes a second source of truth for state that lives in `git`,
  which is the thing D103 declined to do in the first place.
- **The two surfaces differ in how checkable they are.** Saved views have **no
  API at all** — UI-only, and nothing can detect one being deleted. The
  **Project is reachable** (`gh project list --owner RomanKushyk`; the token
  carries the `project` scope since 2026-08-28), so a check that the board
  still exists and holds only issues could be written. None is written yet.
  Either way their CONFIGURATION is hand-made in the UI, which is why it is
  described here — the board's CONTENTS are not: `Auto-add to project` is on,
  so a new issue reaches the board by itself. Its milestone still does not get
  set, which is why `Needs sequencing` stays the check that matters — **and it
  is deliberately manual (D108)**: the milestone means "read, and decided it
  waits", so a workflow setting it would empty this view for good and delete the
  one place a `bug` gets recognised as able to preempt the queue.
- **`Auto-close issue` is deliberately OFF (D108).** It would close an issue
  when its card is dragged to Done — closing the work with **no commit pointing
  at it**. Here an issue closes by `Closes #N` in the squash-merge, and that
  two-way link is one of the reasons D103 chose GitHub Issues at all. The board
  reflects state; it does not decide it. Turning this on quietly undoes that.
- **Why it left the repo:** the two files were the only ones in this
  documentation exempt from every mechanism that governs the rest — no claims
  ratchet, no line cap, no `pnpm facts` — because they held the owner's private,
  uncommitted state. Groomed once in eleven days while the ideas list grew 7 → 24
  and an empty bullet sat unnoticed for two days. See
  [`../decisions/D103.md`](../decisions/D103.md) and [`D108.md`](../decisions/D108.md).

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
