# Section J — Phase 7 implementation (1 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds the three brief defects, A29, A30. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section J — Phase 7 implementation

Unblocked 2026-08-19: `design/extensions/where-things-live.dc.html` is merged, so
G7 no longer holds these. **The extension wins visual disputes; the brief wins
copy and behaviour disputes** (the pipeline's own rule).

**Order is forced by one dependency, not by taste.** A29 builds the header row
and the edit-mode primitive that A30 and A31 both consume; A31 follows A30
because the Settings Portfolio card can only be deleted once BOTH its halves
have a new home. A32 and A33 touch neither and can go in any order.

## The three brief defects the drawing found, resolved here so no task inherits them

**F1 — `Button` size `md` is 40 / r10 at ≥ `md` and 44 / r11 below it.** The
brief pinned only the second pair, as though it were one value.
`button-variants.ts:89` is the truth: `rounded-[10px] max-md:rounded-[11px] h-10
max-md:h-11`. **No decision needed — the brief was simply wrong and the code is
right.** Every header control in A29 uses both.

**F4 — two save-failure strings were minted for one action, and the new one is
retired.** The brief's § S1 introduced `Could not save — nothing was changed.`
while § S2 kept `t.targets.saveFailed` (*"Could not save targets — please try
again."*), which already ships. **The existing per-page string wins and the
generic one is never added.** A generic sentence sitting beside two specific
ones (`asset.saveFailed`, `targets.saveFailed`) is less informative and would
have no caller anyway: `/portfolio` is per-entity and has no Save to fail.

**F7 — three dictionary strings name a home that stops existing.** The drawing
found two; a re-check found the third. All three must change **in the commit
that moves what they point at**, or the app ships an instruction to a place that
is gone:

| Key | Today | After | Moves in |
|---|---|---|---|
| `screen.attributes.subtitle` | *"…edited in Settings → Portfolio"* | *"…edited on Portfolio"* | **A31** |
| `screen.allocation.subtitle` | *"Current mix vs targets set in Settings → Portfolio"* | *"Current mix vs your targets — edit them here"* | **A30** |
| `dailyQuotes.fetch.unlinked` | *"…link one in Settings → Portfolio."* | *"…link one on Portfolio."* | **A31** |

Its neighbour `dailyQuotes.fetch.demo` points at **Settings → Data**, which does
NOT move — do not "fix" it.

## A29 — `ScreenHeader` becomes a row; the edit-mode primitive — `feat/edit-affordance`

Brief § S1, extension § S1. Nothing user-visible changes on any screen until A30
lands: this task builds the slot and the state, and passes no actions.

- [x] `ScreenHeader` takes an optional actions slot. **Two branches, per the
      drawing's F2 resolution:** no actions → NO wrapper element is emitted and
      the DOM is untouched, which is what makes the brief's "byte-identically"
      literally true rather than approximately; actions → the row
      (`flex flex-wrap items-center gap-3`, slot `ml-auto`), copying `/`'s
      existing header rather than inventing one.
- [x] The edit-mode state: **ephemeral, one page at a time, never persisted**
      (brief G-3) — the same line A21 drew for the currency glance.
- [x] **Two variants (G-2), and the page declares which.** Batch = `Cancel` +
      `Save`; per-entity = `Done` alone. A per-entity page must NOT render a
      Save: there would be nothing for it to write, and a Cancel that cannot
      undo the deletion behind it is a worse lie than a Save that saves nothing.
- [x] The batch pair lives in **one flex wrapper inside the header row** —
      the extension's measured constraint, so the two buttons wrap as a pair and
      never one per line.
- [x] Discard dialog on a dirty Cancel / Escape / route change (G-4), using
      `Dialog`, not the D17 typed-name `AlertDialog` — nothing is destroyed,
      only abandoned.
- [x] Copy from the brief's inventory, EN + UK, into `i18n/messages.ts`
      (Contract 0). **Not** the retired F4 string.
- [x] **Verified by measurement, not by argument:** all NINE action-less callers
      render `<h2 class="mb-1 text-[26px]">` as a direct child with NO wrapper
      and a `<p>` next — the byte-identical claim, checked in the browser on
      every route. Zero horizontal overflow on all nine. 679 tests, lint and
      typecheck green.

**Two things worth knowing about this commit.**

**Branch B and the hook are NOT yet exercised** — nothing passes `actions`, by
design, so the code that renders the row and guards the exit has been
typechecked and linted but never run. **A30 is its first caller and its first
real test**, which is the argument for taking A30 next rather than banking A29
and moving to A32.

**`asking` is DERIVED, not mirrored.** The dialog has two sources — a
Cancel/Escape press and a blocked navigation — and the first draft copied the
blocker's state into a `useState` inside an effect. `react-hooks/set-state-in-effect`
rejected it, correctly: the blocker IS state already, so mirroring it would give
two answers to one question for a frame. `asking = askingExit || blocked`.

**No component test exists because the project has no renderer** — no
`@testing-library/react`, no jsdom; the suite is the pure layer. Adding one for
this would be a dependency decision, not part of A29, so the verification is the
browser measurement above.

## A30 — `/allocation` edits its targets — `feat/allocation-targets`

Brief § S2, extension § S2. Batch variant.

- [x] `TargetsEditor` moves out of Settings into the existing "Current vs
      target" card. Its anatomy is not redesigned — the %-input, the Σ pill and
      the live preview are rehoused.
- [x] **The card's own `Save targets` button is REMOVED**; the header's `Save`
      does its work. Two saves on one page, one of which saves a subset, is the
      ambiguity this phase exists to end.
- [x] **F5 — the keystroke preview is the TARGET TICK, not a `ShareBar`.** The
      brief specified `ShareBar` widths; there is no `ShareBar` on
      `/allocation`. The tick moves on the bar's own existing
      `transition-[width]` 500 ms and the pp delta re-derives against the draft.
      No duration is minted.
- [x] Σ ≠ 100 warns and never blocks; unparseable input blocks (both existing
      rules, kept).
- [x] Save writes only CHANGED rows through the existing per-asset
      `useUpdateAsset` patches.
- [x] **F7:** `screen.allocation.subtitle` is now *"Поточна структура проти ваших цілей — редагуйте їх тут"*.
- [x] **Verified in the browser, every claim measured.** At rest: one `Редагувати`,
      zero inputs, tick at 40 %. In edit: `Скасувати` + `Зберегти`, four inputs
      prefilled 40/40/17/3, `Σ 100 %`.
      **F5 exactly** — typing 45 moved the tick 40 % → **45 %** while the fill
      stayed **46,1037 %**, and Σ warned at 105 % with **Save still enabled**.
      Unparseable input: `aria-invalid`, `border-neg`, *"Введіть відсоток."*,
      **Save disabled** — and Σ returned to 100 %, because `effective` falls back
      to the STORED value rather than zeroing.
      Discard dialog on a dirty Cancel, with the page still in edit mode behind
      it; Discard dropped the drafts and the tick returned to 40 %.
      **The rebalance plan re-derives from SAVED targets:** at 45 % the REIT trim
      read **−1 645 ₴** against −9 096 ₴ at 40 %. Saved, checked, and restored —
      the D5 figures `+11 429 ₴` / `−9 096 ₴` are back.
      Zero horizontal overflow at 360 both at rest and in edit mode.
      **`targets.test.ts` moved with its module and not one assertion changed** —
      only its import path, which is what "the pure layer does not move" meant.

**A29's branch B and the hook ran for the first time here, and both held** on
the paths above — the header row, the two-variant swap, the dirty guard and the
derived `asking`.

**Then `/code-review` (D76) found three real bugs in them, and fixing one of
them took two attempts.** Recorded because the second attempt is the lesson:

1. **Escape could not close the discard dialog.** Radix's `DismissableLayer`
   listens on `document` in the CAPTURE phase and calls `preventDefault` but not
   `stopPropagation`, so the hook's own bubble listener ran afterwards, saw the
   page still dirty, and re-opened the dialog in the same React batch. Via a
   blocked navigation it was worse: the release had already happened, so the
   pending navigation was dropped and a later Discard pushed a no-op. Fixed by
   deferring to `event.defaultPrevented`.
2. **A blocked blocker was never released.** react-router's `getBlocker` only
   swaps the predicate; `state.blockers` keeps `blocked`. A save completing
   while a navigation was blocked left the dialog open over a page already saved
   and out of edit mode. **The obvious fix — `blocker.reset()` inside `exit()` —
   passed lint, typecheck and 679 tests and was still broken**, because `exit`
   runs from a promise callback and captured the blocker from the render where
   Save was PRESSED, when it was still `unblocked` and its `reset` was
   `undefined`. Reproduced in the browser after that "fix" landed. The working
   version is declarative: *a blocked blocker with no reason left to block is
   released*, as a condition in an effect, where there is no stale closure to be
   wrong about.
3. **Cancel was live during a save**, so discarding mid-save still persisted the
   values and then congratulated the user on a page they had abandoned. Cancel
   is disabled while the mutation is in flight — a save cannot be un-issued, so
   it cannot be abandoned either.

Four more from the same review, all fixed: the screen re-implemented the
off-target threshold as a bare `0.5` instead of the tested `NEAR_TARGET_PP`
(now one exported `severityOf`); Save was enabled with nothing changed and
toasted "Цілі збережено" for zero writes; `EditActions`' `onSave` was optional
for the batch variant, so a caller could render an enabled Save wired to
`undefined` (now a discriminated union, which matters because A31 adds the
second caller); and `core/schemas.ts` pointed at the deleted
`screens/settings/targets.ts`. Four dead dictionary entries went with the move,
and **`navigation-map.md` was updated** — the branch had moved a whole editor
between screens without touching the map, which is the repo's own rule.

**One finding declined, with the reason (D76).** The review asked for a
latest-value ref so the Escape listener attaches once instead of re-binding when
`dirty` flips. `react-hooks/immutability` refuses a ref built from hook
arguments, and adding and removing one keydown listener is not worth a pattern
the linter rejects. The churn is real and harmless.

**Re-verified after the fixes:** Escape opens the dialog and a second Escape
CLOSES it; a blocked navigation released by Discard goes through to `/overview`;
the save-then-navigate race no longer strands the dialog; Save is disabled with
nothing changed. D5 figures restored and confirmed — `+11 429 ₴` / `−9 096 ₴`,
targets 40/40/17/3.

