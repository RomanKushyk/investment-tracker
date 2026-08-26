# Phase 2 — S7 to S9a

> Surface sections moved **verbatim** from `../phase-2-settings-real-data.md` on 2026-08-26 (D95). Holds S7, S8, S9a. Index, global constraints and acceptance: [`../phase-2-settings-real-data.md`](../phase-2-settings-real-data.md). **Shipped — a record, not a task list.**

## S7 — Relocated Backup button

**Purpose/parent/refs:** The P1 sidebar `Backup` pill (flagged pre-design
exception, D12) moves to its designed home in Settings→Data; the sidebar pill
is REMOVED. Parent: Data card (S2). Refs: button anatomy per README §4 pill
rules; current interim implementation `src/app/Sidebar.tsx` `BackupButton`.

**Content inventory (EN):**
- Button: `Download backup`
- Helper: `Full JSON backup of the active dataset — kubushka-backup-<date>.json. Restore arrives with import in a later release.`

**State matrix:**

| State | Treatment |
|---|---|
| default | outline button on light card (its native palette — no token remap needed once out of the sidebar) |
| hover | soft fill per outline variant |
| focus | ring |
| disabled | while export pending (opacity .5) |
| loading | pending = disabled; no spinner needed (sub-second) |
| error | toast `Could not build the backup — please try again.` |
| empty | still enabled on an empty live dataset (a valid empty envelope) |
| stale | n/a |
| demo-disabled | n/a — enabled in both datasets (backs up the ACTIVE one) |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| hover | bg fill | 150 ms | instant |
| press | scale .97 | 220 ms | none |

**Tokens:** existing button-variant tokens (`ink`, `sidebar-text` hover fill,
`hairline`); `muted` helper.
**Layout:** inline row with helper text, wrapping under 480 px.
**Acceptance:**
- [ ] Sidebar `Backup` pill removed (incl. its `ON_DARK_OUTLINE` token remap).
- [ ] Downloaded envelope identical in shape to D12 (dataset field = active dataset).

## S8 — Editable usdRate field

**Purpose/parent/refs:** Make the pinned 44.83 rate user-editable. Parent:
Settings→Appearance card (S2), next to the currency control. Persisted via
`kubushka-settings` (G3 partialize doctrine).

**Content inventory (EN):**
- Label: `₴/$ rate`
- Input: decimal, prefilled with the persisted rate (default `44.83`)
- Helper: `Used for the $ view of headline figures. Tables always stay in ₴.`
- Error: `Enter a rate above 0.`

**State matrix:**

| State | Treatment |
|---|---|
| default | input radius 10, bg `card`/`page` per surface, right-aligned numerals |
| hover | border `faint` |
| focus | ring |
| disabled | n/a |
| loading | n/a (synchronous store) |
| error | non-numeric or ≤ 0: border `neg` + message; last valid rate stays in effect |
| empty | empty input = error state on blur; store keeps previous value |
| stale | n/a |
| demo-disabled | n/a — rate applies to both datasets' display |

**D7 motion:** border-color 150 ms; error message fade/slide 220 ms;
reduced-motion → instant. Headline KPIs re-tween (~300 ms existing
`useTweenedNumber`) when a new valid rate commits.
**Tokens:** `hairline`, `faint`, `neg`, `label`, `muted`.
**Layout:** compact field (~110 px) in a label-left row.
**Acceptance:**
- [ ] Valid edit updates sidebar `$` sub-figure and Overview rate subtitle immediately.
- [ ] Persists across reload (partialize + migrate extended same commit).
- [ ] Invalid input can never write to the store.

## S9a — Overview KPI relabel + new metric placements

**Purpose/parent/refs:** Surface the audited dual metric families (D13,
FORMULA-AUDIT) without touching any pinned figure. Parent: Overview KPI grid +
right column, design lines 147–210.

**Content inventory (EN):**
- RELABEL: KPI card `Net result` → `Capital gain` (value/sub UNCHANGED:
  `+₴4,452.61`, `+3.08% since 03.02` on demo — capital-gain family, D5-pinned).
- NEW 5th KPI card `Total return (net)` — value: `totalNetProfit` (signed
  prose, pos/neg colored); sub: `<globalRoi> on net deposits` (demo:
  `+4.08% on net deposits`); null globalRoi renders `—`.
- `Income received` card: value stays gross total (`₴5,040.94` demo); sub
  gains a second line: `net of tax ₴5,040.94` (from `incomeReceivedNet.total`;
  equals gross on demo — no seeded tax rows).

**State matrix:**

| State | Treatment |
|---|---|
| default | 5 cards in the existing auto-fit grid (min 200 px) — grid absorbs the extra card |
| hover | n/a (KPI cards not interactive) |
| focus | n/a |
| disabled | n/a |
| loading | values `—` until queries resolve (existing pattern) |
| error | n/a |
| empty | no data: `—` values (existing pattern) |
| stale | n/a |
| demo-disabled | n/a — metrics live in both datasets |
| negative | Total return value + sub flip to `neg` when < 0 |

**D7 motion:** new card joins the staggered mount (fade + slide-from-bottom,
300 ms, next delay step); value changes tween via `useTweenedNumber`
(~300 ms); reduced-motion → instant.
**Tokens:** existing KPI tokens; `pos`/`neg` for signed values.
**Layout:** unchanged grid; 5th card must not break 360 px (single column
there).
**Acceptance:**
- [ ] No pinned figure changes; only the label `Net result` → `Capital gain`.
- [ ] Total return (net) and globalRoi derive from `core/derive`
      (`totalNetProfit`, `globalRoi`); `—` on null.
- [ ] Currency toggle converts the new card like its siblings.

