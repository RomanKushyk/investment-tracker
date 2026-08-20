# Phase 7 brief — where things live

**Written 2026-08-18.** Input to a separate Claude design session, which produces
`design/extensions/where-things-live.dc.html`. Until that extension merges, **no
Phase 7 UI task may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Source: three lines of the owner's idea list, groomed as **A22**
(`../plans/PLAN-NOW.md` § Section H). They are one brief because answering any of
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

## Global constraints

### G-1 — The header row, and it is one component

`ScreenHeader` gains an optional trailing slot and becomes a row. Every screen
keeps calling it the same way; only the ones with an action pass anything.

- Title and subtitle keep their exact type and spacing — `text-[26px]`, `mb-1`,
  subtitle `text-[13px] text-muted`, `mb-[22px]`. **No figure here moves.**
- The action slot is pushed right by `ml-auto`, matching `/`'s date field.
- **It wraps, it does not shrink.** Below the width where title + actions fit,
  the slot drops to its own line, left-aligned under the title. This is what `/`
  already does (`flex-wrap`), and it is why the 360 px case needs no separate
  drawing.
- `/` keeps its bespoke header. It is not an analytics page, it carries four
  controls rather than one, and folding it into the shared component would drag
  the fetch button and date picker into a slot designed for a pair of buttons.

### G-2 — Two variants of edit mode, and the page declares which

This is the constraint that stops S2 and S3 from being drawn as one thing.

| Variant | Header controls | Commit | Used by |
|---|---|---|---|
| **Batch** | `Cancel` + `Save` | one explicit Save writes every changed row | **S2** — targets are a set that only makes sense together (Σ = 100) |
| **Per-entity** | `Done` only | each action commits through its own dialog | **S3** — asset create/edit/delete already own their confirms |

**A per-entity page must NOT show a Save**, because there would be nothing for it
to write: by the time the user reaches it, every change is already committed. A
`Save` that saves nothing is a lie, and a `Cancel` that cannot undo the deletion
behind it is a worse one.

### G-3 — Edit state is ephemeral, and nothing about it is persisted

Being in edit mode is not a preference. It resets on reload, it does not survive
navigation, and it is never written to `quirenote-settings` — the same line A21
drew for the currency toggle three days earlier, for the same reason: a glance
and an arrangement are different kinds of thing.

**One page at a time.** Navigating away exits edit mode. If the page is dirty,
G-4 applies first.

### G-4 — Unsaved work is never dropped silently

Applies to the **batch** variant only (the per-entity variant is never dirty).

- `Cancel` with no changes exits immediately.
- `Cancel` with changes, `Escape`, or a route change opens the discard dialog
  (`Dialog`, not the D17 typed-name `AlertDialog` — nothing is being destroyed,
  only abandoned).
- A **failed save keeps the user in edit mode with every entered value intact**
  and reports through a toast. Input is never the price of an error.

### G-5 — No page-wide edit tint

The design session must not invent a wash, border or background that marks "this
page is in edit mode". The header buttons changing and the inputs appearing is
the whole signal. A tinted page would fight every token the palette assigns to
meaning (`pos`, `neg`, `warn`) and would have to be re-derived for dark.

### G-6 — Motion (D7)

Everything below is within `docs/archive/BUILD-PLAN.md` → "Motion & interaction
standards": soft curve `cubic-bezier(0.22,1,0.36,1)`, 220 ms default, hover may
drop to 150 ms, reveals 300–400 ms, `active:scale-[.97]` on pressables. The
global `prefers-reduced-motion` kill-switch in `index.css` is the ultimate
fallback for every row and must stay.

### G-7 — Tokens

**No new token is minted by this phase.** Every surface below is drawable with
what `@theme` already carries. If the design session believes otherwise, it says
so in the extension's header comment and names the token in both themes rather
than reaching for a hex.

### G-8 — Hit area, not geometry (D66)

Every new control takes `TAP_44` (`src/components/ui/tap-target.ts`) for its
pressable region and keeps the radius D56 gives its drawn box. `Button` size
`md` is the one allowed to actually grow to 44 (radius recomputed to 11) and is
the right size for the header actions.

### G-9 — Ukrainian is the measuring language (D54/D58)

Every width below is checked in Ukrainian, which is the default and the longer
language on all five strings this brief introduces (`Редагувати` is 11 chars
against `Edit`'s 4). A row that fits in English and not in Ukrainian is a defect,
not a translation problem.

---

## S1 — The edit affordance

### 1. Purpose, parent, references

The one control that turns an analytics page from read-only into editable, and
the one place its state is shown. Hosted by `ScreenHeader` (G-1) on the routes
the rule table marks editable.

- Reference: `design/Investment Tracker.dc.html` lines 147–210 for the analytics
  screen header treatment; lines 55–146 for `/`'s header row, which this matches.
- `design/extensions/settings.dc.html` for the `Save targets` button and the
  typed-name dialog idiom it must NOT reuse (G-4).

### 2. Content inventory — exact copy, EN + UK

| Key | EN | UK |
|---|---|---|
| `nav.edit` / header action | `Edit` | `Редагувати` |
| batch, editing | `Cancel` | `Скасувати` |
| batch, editing | `Save` | `Зберегти` |
| per-entity, editing | `Done` | `Готово` |
| discard dialog title | `Discard changes?` | `Відхилити зміни?` |
| discard dialog body | `The changes on this page have not been saved. Leaving now discards them.` | `Зміни на цій сторінці не збережено. Якщо вийти зараз, їх буде відхилено.` |
| discard, keep | `Keep editing` | `Продовжити редагування` |
| discard, confirm | `Discard` | `Відхилити` |
| save failed toast | `Could not save — nothing was changed.` | `Не вдалося зберегти — нічого не змінено.` |

Per-page success toasts are the pages' own and already exist
(`t.targets.savedToast`); this surface adds none.

**Contract 0 (D58):** every string above enters `src/i18n/messages.ts`; none is
written in a component.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | `Button` variant ghost, size `md`, label `Edit`. Sits right of the subtitle line, pushed by `ml-auto`. |
| **hover** | Standard ghost hover — opacity 85 %, 150 ms. |
| **focus** | The app's existing focus ring; never removed, never restyled per surface. |
| **disabled** | **n/a — the control is absent instead.** A page with nothing to edit has no button (the rule above); a page whose data has not loaded has no button yet (see *loading*). There is no third case. |
| **loading** | Queries pending → **no control rendered.** Showing it early opens an editor over an empty list, which is the one failure that would make a user think their data is gone. |
| **error** | A failed save keeps edit mode, keeps every value, and reports by toast (G-4). The control itself has no error state. |
| **empty** | No assets → no control, matching `TargetsEditor`'s existing self-hiding (`if (assets.length === 0) return null`). |
| **stale** | n/a — nothing here reads the feed. |
| **demo-disabled** | **n/a, deliberately: editing works in the demo dataset.** Only the Inzhur fetch (D19) and the file mirror are demo-gated. Demo is a real dataset the user may rearrange; it is restored by "Reset demo data", not by being read-only. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Press `Edit` | header controls swap | crossfade 220 ms soft | instant swap |
| Enter edit mode | revealed inputs | `fade-in` + `slide-in-from-bottom-1`, 300 ms soft | instant |
| Exit edit mode | revealed inputs | symmetric `fade-out`, 220 ms | instant |
| Any press | `active:scale-[.97]` | 220 ms soft | no scale |
| Discard dialog | Dialog's own D7 spec | open 300 ms / close 220 ms | global kill-switch |

The exit is **symmetric** with the entrance and shorter, per D7's table — the
same relationship `Dialog` already uses (300 in, 220 out).

### 5. Tokens

`Button`'s existing ghost and primary variants; `ink`, `muted`, `panel`,
`panel-border`, `card`. Nothing minted (G-7). The destructive `neg` family
appears only inside S3's own delete confirm, which already owns it.

### 6. Layout

- Header row: `flex flex-wrap items-center gap-3`, actions `ml-auto` — the exact
  expression `/` already uses.
- `Button` size `md`: rendered height **44**, radius **11** (`round(44 × 0.26)`
  → 11), `border-[1.5px]` like every variant so heights stay isometric.
- Two buttons in the batch variant, `gap-2`. In Ukrainian these are
  `Скасувати` + `Зберегти`; both must fit beside a wrapped title at **360 px**
  or drop to their own line together — never one per line.
- The 360 px shell holds with no horizontal scroll. The sidebar is the D66
  drawer below `md`; the header row here is inside `main` and never interacts
  with `AppHeader`, which owns its own band.

### 7. Acceptance

- [ ] `ScreenHeader` takes an optional actions slot; the nine existing callers
      that pass nothing render **byte-identically** to today.
- [ ] No D5-pinned demo figure changes on any route.
- [ ] Edit state resets on reload and on navigation (G-3); nothing new appears
      in `quirenote-settings`.
- [ ] A dirty batch page cannot be left without the discard dialog — tested for
      `Cancel`, `Escape` and a sidebar navigation.
- [ ] A failed save leaves every entered value on screen.
- [ ] 44 × 44 pressable region on every new control, radius unchanged (G-8).
- [ ] Zero horizontal overflow at 360 in **both** languages and both themes.

---

## S2 — `/allocation` in edit mode: the targets

### 1. Purpose, parent, references

Move `TargetsEditor` out of Settings and into the card that already draws what it
edits. Parent: `/allocation`, the "Current vs target" card
(`src/screens/Allocation.tsx:66`).

- Reference: master file lines 496–552 (donut, legend, current-vs-target pills,
  rebalance plan).
- `design/extensions/settings.dc.html` S4 for the editor being moved — the
  %-input, the Σ pill, the live `ShareBar` preview. **Its anatomy is not being
  redesigned**, only rehoused.

### 2. Content inventory

Existing copy, moved unchanged: the `Targets` / `Цілі` microlabel, the Σ pill,
`Save targets` / `Зберегти цілі`, `t.targets.savedToast`, `t.targets.saveFailed`.

**One change:** with S1's header carrying `Save`, the card's own
`Save targets` button is **removed** — two saves on one page, one of which saves
a subset, is the ambiguity this phase exists to remove. The header's `Save` does
what `Save targets` did.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Read-only, exactly today's card: name, `share / target`, signed pp delta, bar with the target tick. |
| **hover** | Rows are not interactive in read-only — no hover. In edit mode, the %-input hovers as a field. |
| **focus** | Field focus ring; tab order follows the asset order on screen. |
| **disabled** | `Save` disabled while any input is unparseable — the existing rule (`invalid` in `TargetsEditor`), kept. Σ ≠ 100 is **not** a disable. |
| **loading** | No edit control until assets and snapshots resolve (S1). |
| **error** | Per-row invalid input marks the field; save failure per G-4. |
| **empty** | No assets → no edit control and no targets block, preserving today's `return null`. |
| **stale** | n/a. |
| **demo-disabled** | n/a — see S1. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Enter edit mode | target value → %-input | `fade-in` 300 ms soft | instant |
| Keystroke in a %-input | preview `ShareBar` widths | `transition-[width]` 500 ms soft — **the existing value on this bar**, not a new one | no transition |
| Keystroke | Σ pill tint `pos` ⇄ `warn` | 220 ms soft | instant |

### 5. Tokens

`pos-tint` / `pos-tint-text` and `warn-tint` / `warn-tint-text` for the Σ pill —
both already minted (settings extension, reminders extension). Bar colours stay
the per-asset `BAR_BG` map. Nothing new.

### 6. Layout

- The editor lives inside the existing card; the card's radius **24** is
  unchanged and the %-input nested against nothing keeps its standalone
  proportional radius.
- `%`-input: **72 px** wide, right-aligned, as drawn in the settings extension.
  Rendered height must be stated by the design session and its radius computed
  from it, not inherited.
- Below `lg` the page is already one column; the editor inherits that with no
  second rule.

### 7. Acceptance

- [ ] Settings no longer renders `TargetsEditor`; the "Portfolio" card is
      removed once S3 also lands (it holds nothing else).
- [ ] Save writes **only changed rows**, through the existing per-asset
      `useUpdateAsset` patches — no full rewrite of untouched assets.
- [ ] Σ ≠ 100 warns and never blocks; unparseable input blocks.
- [ ] The rebalance plan below re-derives from saved targets, not from drafts.
- [ ] `targets.test.ts` passes unchanged — the pure layer does not move.

---

## S3 — `/portfolio` in edit mode: the assets

### 1. Purpose, parent, references

Move `AssetManager` out of Settings onto the screen that lists the same assets.
Parent: `/portfolio`. **This is the per-entity variant (G-2): a `Done` control,
no Save, no Cancel.**

- Reference: master file lines 459–495 (positions table, Total row, highlight
  cards); `design/extensions/settings.dc.html` S2 for the manager rows being
  moved; `design/extensions/asset-form.dc.html` for the create/edit dialog,
  which is reused untouched.

### 2. Content inventory

Existing copy, moved unchanged: `Edit` / `Змінити` and `Delete` / `Видалити` per
row, `+ Add asset` / `+ Додати актив`, and the D17 typed-name delete dialog with
`assets.deleteBody(transactions, quoteDays)` — the cascade sentence that names
what goes with the asset.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Today's positions table (desktop) / record cards (below `md`), untouched. |
| **hover** | Row actions hover as buttons in edit mode only. |
| **focus** | Standard ring; the row actions join the tab order only in edit mode. |
| **disabled** | n/a — a row is either actionable or not rendered as one. |
| **loading** | No edit control until assets resolve (S1). |
| **error** | Delete/edit failures are the dialogs' own, already specified. |
| **empty** | No assets → `/portfolio` already shows `EmptyState`. The edit control is **still present**, because `+ Add asset` is exactly what an empty portfolio needs. **This is the one place the rule bends, and it bends toward the user.** |
| **stale** | n/a. |
| **demo-disabled** | n/a — see S1. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Enter edit mode | row actions + `+ Add asset` | `fade-in` + `slide-in-from-bottom-1` 300 ms soft | instant |
| Exit | same, symmetric | `fade-out` 220 ms | instant |
| Row action press | `active:scale-[.97]` | 220 ms soft | no scale |

### 5. Tokens

`neg` / `neg-tint` / `neg-tint-text` for the delete affordance and its dialog —
all already minted and already used by this exact control in Settings. Nothing
new.

### 6. Layout

- Desktop: the actions occupy the row's right edge, as they do in Settings today.
- Below `md`: `/portfolio` renders `RecordCard`s (A17/D66). The actions attach to
  the card's own anatomy — **the design session must draw this**, because a
  table row's right edge and a record card's footer are not the same place.
- Radii: the row buttons are standalone controls and take
  `round(min(w, h) × 0.26)` at their rendered height.

### 7. Acceptance

- [ ] Settings' "Portfolio" section is gone entirely — with S2 it holds nothing.
- [ ] `AssetForm` and the D17 delete dialog are reused with **no** change to
      their contracts.
- [ ] The delete cascade sentence still counts real transactions and quote days
      (`messages.test.ts` plural cases stay green).
- [ ] `/portfolio`'s Total row and three highlight cards are unaffected in both
      modes.
- [ ] Below `md` the actions are reachable without horizontal scroll at 360.

---

## S4 — The `Entry` group and the `/transactions` route

### 1. Purpose, parent, references

`Daily entry` becomes `Entry` and holds two routes instead of one. Parent: the
sidebar's first nav group + a new screen.

**This is not a rename.** `TransactionPanel` is rendered inside
`src/screens/DailyQuotes.tsx:326` today; the group gains a second item because
one screen becomes two.

- Reference: master file lines 55–146 — the Transaction panel and Recent
  transactions as drawn, which the new route rehouses.
- `design/extensions/daily-quotes-live.dc.html` for what stays on `/`.

### 2. Content inventory

| Key | EN | UK |
|---|---|---|
| `nav.groupDailyEntry` → renamed | `Entry` | `Ввід` |
| new nav item | `Transactions` | `Транзакції` |
| screen title | `Transactions` | `Транзакції` |
| screen subtitle | `Record a purchase, sale, coupon or dividend.` | `Запишіть купівлю, продаж, купон або дивіденд.` |
| empty list | `No transactions yet.` | `Транзакцій ще немає.` |

The panel's own copy moves unchanged.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Form + the transaction list. |
| **hover / focus** | The panel's existing field and button treatments, unchanged. |
| **disabled** | Submit disabled until the form validates — the panel's existing rule. |
| **loading** | List shows nothing until transactions resolve; the form is usable immediately. |
| **error** | The panel's existing validation and toast behaviour. |
| **empty** | `No transactions yet.` under the form. The **form is still shown** — an empty ledger is exactly when someone wants it. |
| **stale** | n/a. |
| **demo-disabled** | n/a — recording works in demo. |

### 4. Motion (D7)

Route transition uses the app's existing keyed route animation; the panel keeps
its own motion. No new spec.

### 5. Tokens

None beyond what `TransactionPanel` already uses.

### 6. Layout

- `/` keeps the quote rows, the coupon-due cards and the yield teaser, and loses
  the aside's `TransactionPanel`. **The design session must say what `/`'s
  two-column `@container` layout becomes when the aside holds only coupon cards
  — and what it becomes on the days there are none.** This is the one genuinely
  open layout question in S4.
- `/transactions` shows the **full** list, not the last three. A dedicated route
  can afford the history; the 3-row cap existed because the panel was a guest on
  someone else's screen. Long lists scroll inside their own `Scroller` (D65).
- `/` stays the index route. It is the daily ritual and the app opens on it.

### 7. Acceptance

- [ ] `navigation-map.md` gains `/transactions` with per-route expected seed
      values, and `/`'s row is updated to say the panel has left.
- [ ] The seed's **18 transactions** all render on the new route.
- [ ] Recording a transaction from `/transactions` invalidates the same queries
      it does today — every screen re-renders with no reload.
- [ ] `/` has no horizontal overflow at 360 with the aside reduced or absent.

---

## S5 — Collapsible sidebar groups

### 1. Purpose, parent, references

The three existing nav groups gain a collapse affordance. Parent:
`src/app/Sidebar.tsx` — `GroupLabel` at lines 209, 214, 223.

- Reference: master file lines 1–54 (sidebar, nav groups, group labels).
- `design/extensions/mobile.dc.html` for the drawer, which is the same
  composition (D66) and therefore the same groups.

### 2. Content inventory

| Key | EN | UK |
|---|---|---|
| `nav.collapseGroup` (aria) | `Collapse {group}` | `Згорнути {group}` |
| `nav.expandGroup` (aria) | `Expand {group}` | `Розгорнути {group}` |
| `nav.groupDailyEntry` | `Entry` (S4) | `Ввід` |

The visible labels do not change; the affordance is a chevron and its name is
read by assistive tech only.

### 3. State matrix

| State | Treatment |
|---|---|
| **default** | Expanded. Chevron on the group label, pointing down. |
| **hover** | The label row lifts to the nav pill's hover treatment — the whole row is the target, not the chevron alone. |
| **focus** | Standard ring on the row. |
| **disabled** | n/a. |
| **loading** | n/a — the nav is static. |
| **error** | n/a. |
| **empty** | n/a — every group has at least one item by construction. |
| **stale** | n/a. |
| **demo-disabled** | n/a. |
| **contains the active route** | **The group cannot be collapsed shut around the current page.** Collapsing a group that holds the active route either auto-expands it or leaves the active pill visible — the design session picks one and draws it. A user who cannot see where they are has lost the nav, not tidied it. |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced-motion |
|---|---|---|---|
| Toggle | group height | reveal 300 ms soft, collapse 220 ms | instant |
| Toggle | chevron rotation | 220 ms soft | instant |
| Hover | row background | 150 ms | instant |

### 5. Tokens

`sidebar`, `sidebar-nav`, `sidebar-muted`, `sidebar-inset` — the sidebar's own
family, all existing. On the inverted plane the chevron reads at the same weight
as the collapse control already there (D66), and no lighter.

### 6. Layout

- The chevron is a standalone control: radius `round(min(w, h) × 0.26)` at its
  rendered size, `TAP_44` for its pressable region — and the region must not
  overlap the first nav pill beneath it.
- **It must not be confused with the D66 collapse control** at
  `Sidebar.tsx:194`, which hides the entire sidebar. Two controls on one panel
  that both say "collapse" need to differ by more than position: the design
  session states how, and the two are drawn on the same sheet so the difference
  is visible rather than argued.
- Below `md` the drawer is the same composition, so the groups collapse there
  too, from the same state.

### 7. Acceptance

- [ ] Collapsed groups **persist** — a nav arrangement is a preference, unlike
      A21's currency glance. That means a new field in `PersistedSettings`,
      `PERSISTED_DEFAULTS`, `migrateSettings` **and `partialize`, in the same
      commit** (the standing invariant).
- [ ] One state serves both shells; collapsing in the drawer is collapsed in the
      rail.
- [ ] The active route is never hidden by a collapsed group.
- [ ] The sidebar's three-band grid (D66) still holds at 640 px of viewport
      height with every group expanded — collapsing must be a choice, not a
      requirement for the nav to fit.
- [ ] `mark.test.ts` and the lockup are untouched.

---

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

*(Filed as `PLAN-NOW.md` § Section J's resolution table as well. This section
exists so the correction reaches an implementer who opens the brief and never
opens the plan.)*
