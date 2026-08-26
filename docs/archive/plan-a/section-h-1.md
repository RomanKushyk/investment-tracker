# Section H — groomed from the idea list of 2026-08-18 (1 of 2)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A21, A22. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section H — Groomed from the owner's idea list (2026-08-18)

`USER-FEATURES-DRAFT.md` held seven lines and was wiped in the same commit that
created this section, per its own cycle. **The mapping is recorded here because
the source page no longer exists:**

| Draft line | Where it went | Why there |
|---|---|---|
| currency in settings sets the default; the sidebar toggle is a quick preview | **A21**, below | pure state; no new pixel |
| analytics pages editable (targets → allocation, settings›portfolio → portfolio) | **A22** brief | new interaction, G7 |
| `daily entry` becomes `entry`, holding `Daily quotes` + `transactions` | **A22** brief | splits a screen in two; G7 |
| sidebar groups can be collapsed | **A22** brief | new affordance on an existing group; G7 |
| provider-first `new asset` form | **A23** brief | new flow, and it overlaps B3's catalog |
| user profile page | **`PLAN-WAITING.md` W16** | there is no user until W7 |
| settings toggle to auto-save daily quotes | **`PLAN-OPEN.md` O22** | it asks G5 to stop being binding |

**Three of the seven are design briefs and not implementations, and that is the
pipeline (G7), not caution.** A brief is startable today — A8 and A16 were both
PLAN-NOW tasks — and the implementation rows come out of the design session that
follows it. Only A21 is buildable now, because it changes no pixel.

## A21 — Currency: Settings sets the default, the sidebar toggle is a session preview — `feat/currency-session`

**The defect, stated plainly.** There is ONE persisted field, `currency`, and
**two controls write it** — the sidebar toggle (`app/Sidebar.tsx`) and the
Settings segmented control (`screens/Settings.tsx`, `t.settings.currency`). So
flipping to `$` to glance at one KPI is remembered forever, and the Settings
control is not a default at all: it is a second remote for the same switch.

**Wanted:**
- The **persisted** value is the DEFAULT, applied at app open. Settings writes it.
- The **sidebar toggle changes the session only** and is never persisted. A
  reload returns to the default.

- [x] Split the store. **Named the other way round from this box, on purpose:**
      `currency` is the LIVE value and `defaultCurrency` is the preference.
      Almost every reader wants "what is on screen now" — the KPIs, the sidebar,
      `useCapitalCard` — and only three sites want the preference, so the short
      name went to the common meaning and all the readers stayed untouched.
- [x] `partialize` carries `defaultCurrency` and not `currency`, with a comment
      at the removal site saying why — this is the first field to LEAVE that
      object, and the standing invariant only ever pointed one way.
- [x] Restore writes the default — `setDefaultCurrency(sane.defaultCurrency)`.
      **And the export end needed the same fix, which this plan missed:**
      `screens/settings/useBackupDownload.ts` was writing whatever the user was
      glancing at into the file. Both ends now read the preference.
- [x] Every reader takes the session value, and none of them changed a line —
      that is what the naming above bought. `mergeSettings` is the single place
      the two are joined: on every rehydrate the session starts as a copy of the
      preference.
- [x] Tests: **644 passing, +8.** A sidebar flip does not survive a rehydrate; a
      Settings change does; a rehydrate overrides a session value the store
      already held (the assertion that catches a naive spread order); the legacy
      key is read, preferred against, and never written back.

**Not in scope:** `usdRate` (44.83) is unrelated and stays exactly as it is.

**Two things this task turned up that were not in its brief.**

**The persisted key was renamed, and it needed no `version` bump — but the
fallback that made that true is PERMANENT.** `migrateSettings` reads
`p.defaultCurrency ?? p.currency`, and `merge` routes every hydrate through it,
so both shapes work on every path. The reason it can never be deleted is not the
old localStorage payloads: **the backup FILE format still carries `currency`**
(`core/backup/json.ts`), deliberately unchanged so existing backups stay
readable, and every restore therefore lands on that fallback. Removing it would
break restore silently — the value would just read UAH.

**Three user-facing strings were lying and are fixed in both languages.** The
Settings helper said *"Mirrors the sidebar toggle"*, which was an accurate
description of the defect; the import dialog's opt-in helper said it replaces
"your currency" where it now replaces the default. `navigation-map.md` carried
the same two claims as checkpoints, plus "choice survives a page reload" on the
sidebar toggle — the exact behaviour this task inverts.

**Verified in the browser** at `localhost:3001`, dark theme, Ukrainian and
English: a genuine pre-A21 payload (`{"currency":"USD"}`) hydrates to USD on both
controls, proving the compatibility claim on real data rather than in a unit
test; a sidebar flip moves the capital card to `3 324,03 $` while the Settings
control stays put and localStorage is untouched; a reload returns to the
preference; a Settings change moves both and writes `defaultCurrency`. Zero
console errors, and zero horizontal overflow at 1440 and at a true 360 viewport
in both languages — the new helper is longer than the one it replaced, and
`/settings` rows have a history of overflowing at 360 (FOLLOW-UPS 13).

## A22 — Design brief: where things live — `docs/design-brief-phase-7`

**Three draft lines, one question: where does each control live and how is it
reached.** They are one brief because answering any of them separately would
re-decide the other two.

- [x] **Editable analytics pages.** Put to the owner and settled 2026-08-18: an
      edit **MODE** behind a button, and a **general pattern for every** analytics
      page rather than a one-off on the two named. The second answer asked a
      question of its own — what the control does where there is nothing to edit
      — and the brief answers it with a rule: **a page is editable where it
      shows STORED data; a derived-only page gets no control, not a disabled
      one.** Five of eight routes qualify; Phase 7 builds two.
- [x] **`Daily entry` → `Entry`, holding `Daily quotes` and `Transactions`.**
      Brief § S4. `/` stays the index and keeps the quote rows, coupon cards and
      yield teaser; `/transactions` takes the panel and shows the FULL ledger
      rather than the last three, which was only a cap because the panel was a
      guest on someone else's screen. **One layout question is left open on
      purpose** — what `/`'s two-column `@container` becomes on a day with no
      coupon cards — and is flagged for the design session rather than guessed.
- [x] **Collapsible sidebar groups.** Brief § S5. One state serves both shells
      (the drawer IS the sidebar, D66). Two findings the section had to carry:
      the collapsed set **is persisted** — a nav arrangement is a preference,
      which is the opposite of the call A21 made for the currency glance three
      days earlier — and **a group may not close around the active route**, or
      the user loses the one pill that says where they are.
- [x] Output per G7/D14: `design/extensions/where-things-live.dc.html`, drawn by
      a separate session and merged 2026-08-19. **Phase 7 UI is no longer
      design-blocked**; its implementation rows are still to be filed here.
      The drawing closed all four delegated decisions and returned **seven
      places the brief could not be drawn as written (F1–F7)** — see the
      extension's header. Three matter before any implementation starts: the
      brief pinned `Button md` at 44/r11, which is the below-`md` value only
      (shipped it is 40/r10 at ≥ md); it minted two different save-failure
      strings for one action; and **three dictionary strings name
      "Settings → Portfolio" and go stale the moment S2/S3 land** — the
      `/attributes` and `/allocation` subtitles the drawing found, plus the
      Inzhur empty state it did not.

**Constraint to carry into the session:** the sidebar is ONE composition with two
layouts (D66) and shape is a system (D56) — a collapsed group's chevron takes
`round(min(w,h) × 0.26)` like anything else, and 44 × 44 is hit area, never
geometry.

**What writing it turned up, none of which was in the brief's own scope.**

**`ScreenHeader` is a FRAGMENT, not a box** — `<h2>` + `<p>`, no container — so
"a button top right" has nothing to attach to on nine of the ten routes. The
component becomes a row before any of this exists, and `/`'s existing header
(`DailyQuotes.tsx:227`) is the precedent it copies rather than a new invention.

**The two named pages need DIFFERENT edit modes, and drawing them as one would
have been wrong.** Targets are a batch — Σ = 100 only means something whole — so
`/allocation` gets `Cancel` + `Save`. Asset CRUD already commits through its own
dialogs, including a D17 typed-name delete, so `/portfolio` gets `Done` and **no
Save**: a Save with nothing to write is a lie, and a Cancel that cannot undo the
deletion behind it is a worse one. The brief pins this as G-2 so the design
session does not have to discover it.

**`/allocation` loses a button rather than gaining one.** With the header
carrying `Save`, the card's own `Save targets` is removed — two saves on one
page, one of which saves a subset, is exactly the ambiguity this phase exists to
end.

