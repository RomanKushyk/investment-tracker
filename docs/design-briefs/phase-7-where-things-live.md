# Phase 7 brief — where things live

**Written 2026-08-18.** Input to a separate Claude design session, which produces
`design/extensions/where-things-live.dc.html`. Until that extension merges, **no
Phase 7 UI task may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: three lines of the owner's idea list, groomed as **A22**
(`../archive/plan-a/section-h-1.md`, Section H — it left `PLAN-NOW.md` in D95). They are one brief because answering any of
them separately would re-decide the other two — each is an answer to *where does
a control live and how is it reached*.

Shape is governed by **D56** throughout (`README.md` §4). This brief adds no
exception to it.

---

## Owner decisions, taken 2026-08-18

1. **An edit MODE behind a button, not a relocation.** The analytics page stays
   read-only by default; a control top right opens editing in place. The
   alternative — simply moving the Settings blocks onto the pages as always-on
   cards — was put and declined.
2. **A general pattern, for every analytics page**, not a one-off on the two
   pages the idea list named.

Decision 2 is the one with consequences, and it asks a question it does not
answer: **what does the control do on a page where there is nothing to edit?**
The next section answers it, and that answer is the spine of the brief.

---

## The rule decision 2 forces

> **A page is editable where it displays STORED data. A page that displays only
> DERIVED data has no edit control at all — not a disabled one.**

A disabled control with no explanation is a worse answer than an absent one, and
"editable" cannot mean "editable" on a screen whose every number is computed
from snapshots the user entered somewhere else. The rule is not a taste: the app
already draws this line in `core/` — `derive.ts` computes, the repository stores,
and no screen has ever written a derived figure back (G5).

Applied to the eight analytics routes:

| Route | What it draws | Stored rows behind it | Edit control |
|---|---|---|---|
| `/overview` | 5 KPIs, assets card, next payouts, rebalance, income | none of its own — every figure derives | **no** |
| `/balances` | area chart + snapshot table | **snapshots** | yes — *not this phase* |
| `/payouts` | stacked bars + payout log | **transactions** | yes — *not this phase* |
| `/yield` | 4-line chart + per-asset table | none of its own | **no** |
| `/attributes` | 2 × 2 asset fact cards | **assets** (attributes) | yes — *not this phase* |
| `/seasonality` | day-of-month bars + 3 insight cards | none of its own | **no** |
| `/portfolio` | positions + 3 highlight cards | **assets** (CRUD) | **yes — S3** |
| `/allocation` | donut + current-vs-target + plan | **assets.targetPct** | **yes — S2** |

**Five of eight are editable, three are not, and Phase 7 builds two.** The other
three are named here so the pattern is designed once and needs no second
invention when they come; they are explicitly **out of this phase's scope** and
the design session does not draw them.

`/settings` is not in the table: it is not an analytics page, and it is
editable everywhere by definition.

---

## What the code is today — read 2026-08-18, not assumed

| Fact | Where | Why it matters here |
|---|---|---|
| **`ScreenHeader` is a FRAGMENT, not a box** — `<h2>` + `<p>` with no container | `src/components/ui/ScreenHeader.tsx` | "a button top right" has **nothing to attach to** on 9 of the 10 routes. The component has to become a row before any of this exists. |
| `/` is the exception — it already has a header ROW | `src/screens/DailyQuotes.tsx:227` | `flex flex-wrap items-center gap-3` with the title, a count chip, the fetch button, and a date field pushed right by `ml-auto`. **This is the precedent the new header row must match**, not a new invention. |
| Settings card 1 "Portfolio" = `AssetManager` + `TargetsEditor` | `src/screens/Settings.tsx:457` | Both move out. The card disappears; it holds nothing else. |
| `TargetsEditor` brings its own divider + microlabel so it vanishes with the empty state | `src/screens/settings/TargetsEditor.tsx:22` | That self-hiding behaviour has to survive the move. |
| `/allocation` already draws a "Current vs target" card | `src/screens/Allocation.tsx:66` | The targets editor has an obvious host — the same rows, the same order, the same bar. |
| `TransactionPanel` renders **inside** `/`'s aside, and carries the last-3 "Recent transactions" list | `src/screens/DailyQuotes.tsx:326`, `TransactionPanel.tsx:150` | S4 is not a rename. It is splitting one screen into two routes. |
| The sidebar already has **three** groups | `src/app/Sidebar.tsx:209, 214, 223` | S5 adds an affordance to an existing structure, not the structure. |
| A collapse control already exists, and it hides the WHOLE sidebar | `src/app/Sidebar.tsx:194` (`t.nav.collapseNav`) | S5 must not be mistaken for it. Two controls, two meanings, one panel. |

**Measured**, Chromium, demo dataset, 2026-08-18: at 1440 the viewport gives
`main` **1196 px**; `/allocation`'s content column is **1124 px** and its grid is
`340px 1fr` collapsing to one column below `lg`. The `ScreenHeader` `<h2>` renders
at **39 px** tall.

---

## The long sections are in `phase-7/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`phase-7/constraints.md`](phase-7/constraints.md) | Global constraints |
| [`phase-7/s1-s2.md`](phase-7/s1-s2.md) | S1 — The edit affordance · S2 — /allocation in edit mode: the targets |
| [`phase-7/s3-s4.md`](phase-7/s3-s4.md) | S3 — /portfolio in edit mode: the assets · S4 — The Entry group and the /transactions route |
| [`phase-7/s5.md`](phase-7/s5.md) | S5 — Collapsible sidebar groups |

## What this brief does not decide

- **The three other editable routes** (`/balances`, `/payouts`, `/attributes`).
  Named by the rule, out of scope, and deliberately not drawn.
- **Whether `/settings` survives as a screen.** With S2 and S3 it loses one of
  its four cards. Three remain — Data, Automation, Appearance — and that is
  still a settings screen. If a later phase empties it further, that is that
  phase's question.
- **`/`'s column layout once the aside is nearly empty** (S4 § 6). Flagged for
  the design session as the one open layout question, rather than guessed here.

---

## Corrections — 2026-08-19, SUPERSEDING three lines above

**A superseding section rather than an edit, because the rule says so.**
`../design-briefs/README.md`: *"Amend a brief in place, with a dated note, while
it is still here. Once its extension has merged, never amend — supersede with a
new brief section."* `design/extensions/where-things-live.dc.html` merged the
same day, so the three lines below stand as written above and are overruled
here. All three were found by the design session reading this brief cold, and
all three would otherwise have been built.

**C1 — supersedes § S1 § 6's button figures.** That section reads *"`Button`
size `md`: rendered height **44**, radius **11**"*. **That is the below-`md`
value only.** `src/components/ui/button-variants.ts` ships
`md: 'rounded-[10px] max-md:rounded-[11px] h-10 max-md:h-11 …'`, so the correct
pair is **40 / r10 at and above `md`, 44 / r11 below it** — `round(40 × 0.26) =
10` and `round(44 × 0.26) = 11`. An implementer following the original line
builds a 44 px header button on the desktop shell.

**C2 — supersedes § S1 § 2's `Could not save — nothing was changed.`** That
string is **never added**. `t.targets.saveFailed` already ships (*"Could not
save targets — please try again."*), and `asset.saveFailed` beside it; a generic
third sentence is less informative than either and would have **no caller at
all**, since the per-entity variant has no Save to fail.

**C3 — supersedes § S2's and § S3's silence about the strings they invalidate.**
Three dictionary entries name a home this brief removes, and each must change in
the commit that moves what it points at:

| Key | After | Moves in |
|---|---|---|
| `screen.allocation.subtitle` | *"Current mix vs your targets — edit them here"* | S2 |
| `screen.attributes.subtitle` | *"…edited on Portfolio"* | S3 |
| `dailyQuotes.fetch.unlinked` | *"…link one on Portfolio."* | S3 |

The brief found the first two. **The third was found by re-checking**, and its
neighbour `dailyQuotes.fetch.demo` points at **Settings → Data**, which does not
move — do not "fix" it.

*(Filed as Section J's resolution table as well — now `../archive/plan-a/section-j-1.md`. This section
exists so the correction reaches an implementer who opens the brief and never
opens the plan.)*
