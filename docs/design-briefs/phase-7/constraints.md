# Phase 7 — global constraints

> Moved **verbatim** from [`../phase-7-where-things-live.md`](../phase-7-where-things-live.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first** — a surface section is written under constraints stated there.

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

