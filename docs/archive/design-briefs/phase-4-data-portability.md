# Design brief — Phase 4: Data portability (import, CSV, file mirror)

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/plans/NEXT-PHASE-PLAN.md` Phase 4 (+ G6 dependencies,
key fact #7 import/export); decisions: D12 (backup envelope v1 — the file
format every surface below reads and writes), D9 (Dexie `meta`, where the
mirror handle lives), D16 (demo guard `useDataset()`), D17 (the destructive
AlertDialog idiom this phase reuses), D5 (the demo figures a round-trip must
return unchanged).

**Suggested extension files:** `data-portability.dc.html` (S1, S2, S5, S6,
S7, S8 — the finished Settings → Data section and every row in it) and
`import-dialog.dc.html` (S3, S4 — the preview/diff dialog and the
rejected-file report). The design session may split differently; one surface
must never span two files.

## Global constraints (apply to every surface below)

- **Safety-first doctrine (binding — this phase's counterpart to G5):**
  every import is *validate fully → show a diff → the user confirms → ONE
  `rw` transaction*. Nothing is written from a parse, a preview or a drag;
  the Confirm press is the sole write path. A safety backup **downloads
  before** anything is replaced (plan acceptance criterion). IndexedDB stays
  the only system of record: an imported file is data the user pushed in, and
  the mirror file is a copy the app pushes out — **no file is ever read back
  on its own**. Every surface below must read as "the app owns the data; the
  file is a courier".
- **Empty cell ≠ 0 (standing invariant, D5#1):** a missing quote is
  *pending*, never zero. This is a copy obligation, not only a parser rule —
  the CSV surfaces (S5, S6) must say it in words, because a spreadsheet user
  will otherwise type `0`.
- **Demo-mode doctrine (G4/D16):** import **is allowed in demo** — it targets
  the ACTIVE dataset, and "Reset demo data…" is the escape hatch; every
  import surface says so where a user could be surprised. CSV export runs in
  both datasets. The **file mirror is disabled in demo** (D16) and **absent
  on non-Chromium browsers** (no placeholder, no apology). Every surface
  states its `demo-disabled` row.
- **Demo-figure invariant (binding):** additive only — a demo
  export → erase → import round-trip must return every D5-pinned figure
  byte-identical (`docs/decisions/README.md` D5, `navigation-map.md` checkpoints:
  4 assets / 174 snapshots / 18 transactions · ₴149,016.36 total ·
  +₴4,452.61/+3.08% · deposited ₴143,176.37 · income ₴5,040.94 · top-up
  ₴11,429.49 · …6475 annualized +10.9%). If a round-trip moves a pinned
  number, the serializer is wrong — never the checkpoint.
- **Tokens** (`src/index.css` `@theme`) — **this phase mints nothing.**
  Existing vocabulary: `page`, `ink`, `card`, `muted`, `faint`, `hairline`,
  `panel`, `panel-border`, `label`, sidebar family, `pos`, `pos-tint`,
  `pos-tint-text`, `pos-border`, `neg`, the P2-minted caution family
  (`warn` · `warn-tint` · `warn-tint-text` — every stale/caution/best-effort
  state in this phase reuses it), the P3-minted `neg-tint` / `neg-tint-text`,
  the 4 asset hues, `chart-*` aliases.
  **One documented widening:** the P3 reference reserved
  `neg-tint`/`neg-tint-text` for "the overdue reminder severity" only
  (`design/extensions/reminders.dc.html` header). Phase 4 widens that
  reservation to cover **irreversible-harm framing at block scale** — two
  sites and no more: the **S3 "Replaces everything" banner** (tint
  background, tint-text sentences) and the **S8 danger-zone panel** (tint
  border + tint-text microlabel). The reason is the one the family was
  minted for: raw `neg` #a8695a carries a 13 px sentence at only ~3.6:1 on
  `card`, while `neg-tint-text` is 6.08:1 on `neg-tint` and 8.89:1 on
  `card`. The widened rule, which the P4 extension header must restate
  verbatim: **`neg-tint`/`neg-tint-text` are block-level framing for overdue
  reminders and irreversible-harm surfaces — never for validation messages
  (those stay `neg` text on `card`), never for numbers, deltas or counts,
  never for a routine control or a pressable's own fill.** The implementing
  task records the widening in `docs/decisions/README.md`.
- **Dashed = proposed (P3's binding rule, extended not broken):**
  `design/extensions/daily-quotes-live.dc.html` pins 1 px dashed `faint` as
  the ONLY carrier of "proposed, not saved", crossed to solid only by a
  press. Phase 4 inherits it exactly: **the import preview's diff panel is
  dashed `faint`** (it shows data that is not written yet, and `Replace all
  data` is the press that crosses the line), while **controls are never
  dashed** — so the drop target (S2) is a SOLID `panel-border` frame on
  `panel`, not the conventional dashed rectangle. A dashed dropzone would
  make an affordance look like a machine's guess.
- **Layout:** cards radius 20–24 px; pills/badges/segments/chips radius 999;
  inputs radius 10; nested sub-panels radius 16; sidebar 232 px (136 px below
  `sm`); the shell holds at 360 px with no page-level horizontal scroll (wide
  content scrolls inside its own container).
- **Type:** `font-display` (Space Grotesk) for headings/buttons/KPI values;
  `font-body` (Spline Sans Mono) elsewhere; microlabels 10 px uppercase
  tracking .12em; body 13 px; helper 12 px; row sublines/microcopy 11 px;
  technical detail lines 11.5 px mono.
- **Motion (D7):** defaults 220 ms `cubic-bezier(0.22,1,0.36,1)`; hover may
  drop to 150 ms; reveals 300–400 ms; every pressable gets
  `active:scale-[.97]`; `prefers-reduced-motion` collapses everything
  (global kill-switch) — listed per surface below.
- **Numbers/dates — and the machine/display split:** the UI keeps the pinned
  formats (tables/inputs `68 702,10`; prose/KPIs `₴68,629.36`; dates
  `dd.MM.yyyy`; times `HH:MM` 24-hour local; signed values U+2212, D8).
  **Files carry the machine format** (`68702.10`, `2026-07-27`) and the UI
  never shows a machine-formatted number, nor writes a display-formatted one
  into a file. Where the two meet (S5, S6) the copy says which is which.
- **Structured returns (D8):** `core/backup/import.ts` and
  `core/backup/csv.ts` return **structured** diffs and issues (code +
  params), never assembled English — every sentence below lives in the
  component layer. The legacy `parseBackup` issue strings (D12, already
  English-ish) render only as mono **technical detail** lines, never as prose
  copy.
- **Filenames (pinned):** manual backup `kubushka-backup-<date>.json`
  (unchanged, D12) · automatic pre-import backup
  `kubushka-before-import-<date>.json` · CSV exports
  `kubushka-assets-<date>.csv` · `kubushka-snapshots-<date>.csv` ·
  `kubushka-transactions-<date>.csv` · the mirror keeps the user's own file
  name plus a sibling `<name>.bak`.
- Figures in this brief are illustrations (the demo seed, or a live dataset
  described in place) — the app always derives them.

---

## The surface sections

**Split 2026-08-26 (D95)** — the S-sections moved **verbatim** into [`phase-4/`](phase-4/) so no file exceeds 200 lines. Nothing was rewritten; this file keeps the constraints, the acceptance and the pointers.

| File | Holds |
|---|---|
| [`phase-4/s1-s2.md`](phase-4/s1-s2.md) | S1 Data section · S2 import row |
| [`phase-4/s3.md`](phase-4/s3.md) | S3 import preview & diff dialog |
| [`phase-4/s4-s5.md`](phase-4/s4-s5.md) | S4 rejected-file report · S5 CSV export |
| [`phase-4/s6-s7.md`](phase-4/s6-s7.md) | S6 CSV snapshot import · S7 file mirror |
| [`phase-4/s8.md`](phase-4/s8.md) | S8 danger zone |

## Phase-wide acceptance (the design session's definition of done)

- [ ] Every surface above has a corresponding region in a
      `design/extensions/*.dc.html` file, master-idiom inline styles, exact
      values literal; one surface never spans two files.
- [ ] **No new tokens.** The only novelty is the documented widening of
      `neg-tint`/`neg-tint-text` to block-level irreversible-harm framing —
      exactly two sites, the S3 replace banner and the S8 danger-zone panel —
      with the widened rule restated verbatim in the new extension's header
      comment (and recorded in `docs/decisions/README.md` by the implementing task).
- [ ] The P3 suggestion language is respected: the **import preview panel is
      dashed** `faint` (proposed data, crossed only by the confirm press) and
      **no control anywhere in this phase is dashed** — the drop target is
      solid `panel-border` on `panel`.
- [ ] The finished Data card is drawn once, complete, in both datasets:
      demo (Reset trigger, mirror disabled with the `DEMO` tag, import demo
      note) and live (Erase trigger, mirror enabled).
- [ ] The import dialog is drawn in its four meaningful states — preview with
      a diff, preview with warnings + settings opt-in, pending
      (`Replacing…`), and the rejected-file report with a row-error list —
      plus the CSV variant (scope strip, scoped banner, `Replace snapshots`).
- [ ] All seven mirror states are drawn or annotated, including the absent
      row on unsupported browsers.
- [ ] Every destructive statement names its dataset, and every one of them is
      reachable only behind a press: no surface in this phase writes,
      replaces or deletes on parse, hover, drag or mount.
- [ ] The CSV notes state the machine format and the empty-cell rule in
      words; no file-format string (`68702.10`, `date,cash,…`) is ever shown
      in a display context, and no display format (`68 702,10`, `₴`) is ever
      shown as file content.
- [ ] No D5-pinned demo figure appears altered anywhere in the extension
      mock copy (4 assets / 174 snapshots / 18 transactions · ₴149,016.36 ·
      +₴4,452.61/+3.08% · deposited ₴143,176.37 · income ₴5,040.94 · top-up
      ₴11,429.49 · …6475 annualized +10.9%).
- [ ] Every interactive element has all applicable states drawn or
      annotated; motion annotations may be comments in the markup; 360 px
      behavior noted for the dialog, the drop target, the CSV button group
      and the mirror row.
