# Design brief — Phase 4: Data portability (import, CSV, file mirror)

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/NEXT-PHASE-PLAN.md` Phase 4 (+ G6 dependencies,
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
  byte-identical (`docs/DECISIONS.md` D5, `navigation-map.md` checkpoints:
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
  task records the widening in `docs/DECISIONS.md`.
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

## S1 — Settings → Data: the finished section

**Purpose/parent/refs:** Phase 4 completes the Data section: it now holds
*which data* (dataset), *save it* (backup), *bring it back* (import), *take
it elsewhere* (CSV), *keep it mirrored* (file mirror) and *destroy it*
(danger zone). Parent: Settings → Data card, `/settings`. Refs:
`design/extensions/settings.dc.html` lines 104–305 (the `/settings` card
stack) and **208–261** (the Data card as it stands: `Dataset` row, `Backup`
row, `Danger zone` row, `Divider` rhythm, the label-left/control-right
`SettingRow`); live-mode fragment lines 354–383; master reference lines
147–210 for card/microlabel anatomy. The P2 four-card order (Portfolio →
Data → Automation → Appearance) is **unchanged** — this phase adds rows, not
cards.

**Content inventory (EN):**
- Card microlabel: `Data` (unchanged).
- Row order (pinned):
  1. `Dataset` — unchanged (P2 S5).
  2. `Backup` — helper **superseded** (the P2 text promised import "in a
     later release"): `Full JSON backup of the active dataset — kubushka-backup-<date>.json. Restore it with Import below.`
     Button `Download backup` unchanged.
  3. `Import` — S2.
  4. `Spreadsheet export (CSV)` — S5.
  5. `Keep a file in sync` — S7 (absent on non-Chromium).
  6. Danger zone — S8, a nested sub-panel, not a row.
- No new sub-headings inside the card: each row's title already names its
  job, and a second hierarchy level would add structure without information.

**State matrix:**

| State | Treatment |
|---|---|
| default | one `card` radius 24, padding 22; five `SettingRow`s separated by the existing 1 px `hairline` `Divider` (my 16 px), then the S8 sub-panel with 18 px of air above it |
| hover | per-control only — the card and its rows have no hover state (there is nothing to click in the label column) |
| focus | global `:focus-visible` 2 px `ink` ring, offset 2, on every control |
| disabled | per-control (S7 in demo); no row is ever hidden by disablement except the two visibility switches (S7 non-Chromium, S8 dataset variant) |
| loading | rows render immediately — every control is local; only counts inside them wait for their query (see S3/S5) |
| error | n/a at section level — errors belong to the row that caused them |
| empty | an empty active dataset changes nothing here: Backup and the CSV buttons stay enabled (a valid empty file is a valid export), Import is the way in |
| stale | n/a — nothing here caches |
| demo-disabled | S7's control is disabled with a `DEMO` micro-tag; S8 shows `Reset demo data…` instead of `Erase live data…`; Import/Backup/CSV are fully enabled in demo |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| route mount | the card joins the existing staggered entry (fade + slide-from-bottom-1, delay 75 ms step) | 300 ms soft | instant |
| a row appears/disappears (S7 on an unsupported browser is absent from first paint, never animated away) | n/a | n/a | n/a |
| row content height changes (S3 result lines, S7 status) | height + fade | 220 ms soft | instant |

**Tokens:** `card`, `ink`, `muted`, `label`, `hairline`, `panel`,
`panel-border`; accents only where a row's own section specifies them.
**Layout:** the card holds six blocks; at 360 px every row stacks
(label block above its control, the control left-aligned under it) and no
control may force horizontal scroll. The card grows tall — that is accepted;
the page scrolls vertically.
**Acceptance:**
- [ ] Row order exactly as pinned; the P2 card order (Portfolio → Data → Automation → Appearance) is untouched, and no fifth top-level card appears.
- [ ] The P2 `Backup` helper sentence "Restore arrives with import in a later release." is gone (superseded copy above).
- [ ] Every row holds at 360 px with no page-level horizontal scroll.
- [ ] Nothing in the section is dashed except the S3 preview panel (P3 rule).

## S2 — Import row: file field + drop target

**Purpose/parent/refs:** The single way data comes into the app. One entry
point accepts a JSON backup (full restore) and a CSV of snapshots (S6
scope). Parent: Settings → Data row 3 (S1). Refs: the `SettingRow` anatomy
in `design/extensions/settings.dc.html` 208–261; the sub-panel idiom of the
master reference's dashed "New asset details" reveal, lines 116–125 — **the
geometry, not the dash** (see the Global constraints: this panel is solid).

**Content inventory (EN):**
- Row title: `Import`
- Row helper: `Restore a JSON backup, or load a CSV of snapshots. Import replaces everything in the active dataset — you review a summary first, and a safety backup downloads automatically.`
- Primary control: outline button `Choose file…` (opens the file dialog;
  `accept=".json,.csv"`).
- Drop target (a panel under the row, always visible): first line 13 px
  `Drop a .json or .csv file here`; second line 11 px `muted`
  `or use Choose file…`
- Drag-over line (replaces the first line while a file hovers):
  `Release to read the file`
- Reading state (replaces the panel body): `Reading kubushka-backup-2026-08-04.json…`
- Rejected type (inline message under the panel, `warn`, clears on the next
  attempt or after ~5 s): `That file type isn't supported — pick a .json backup or a .csv table.`
- Too large: `That file is larger than 25 MB — it doesn't look like a Kubushka export.`
- More than one file dropped: `Drop one file at a time.`
- Empty file: `That file is empty.`
- Demo note (11 px `muted`, rendered under the row only while the demo
  dataset is active): `You're in the demo dataset — importing here replaces the reference portfolio. "Reset demo data…" brings it back.`

**State matrix:**

| State | Treatment |
|---|---|
| default | panel: bg `panel`, **solid** 1 px `panel-border`, radius 16, padding 18–20, centered two-line copy with a 16 px download/file icon above it; the `Choose file…` button sits inside the panel under the copy (one tab stop — the panel itself is NOT focusable and drop is a pointer-only enhancement) |
| hover (over the panel) | border → `faint`, 150 ms; the copy stays put (no lift, no scale — the panel is a container, not a pressable) |
| focus | ring on `Choose file…` only; the visually hidden `<input type="file">` is label-bound so keyboard users never meet the drag path |
| disabled | n/a — import is never disabled (it is the recovery path in every dataset); a mutation in flight is the S3 dialog's business |
| loading | reading a file: panel body swaps to the `Reading <name>…` line with a 1.2 s opacity pulse; the button is disabled meanwhile |
| error | file-level rejections (type/size/count/empty) show the pinned `warn` message under the panel and leave the panel in its default state — the DB is untouched and nothing opens; parse-level rejections open S4 instead |
| empty | n/a — the panel is its own empty state |
| stale | n/a |
| demo-disabled | ACTIVE in demo (import targets the active dataset); the demo note above is the only difference |

Behavior notes for the design session: dragging anything over the panel
must not scroll the page or open the file in the browser tab; a drag that
leaves the panel returns it to default with no message. Reading resolves
into exactly one of two outcomes — the S3 preview (parsed) or the S4 report
(rejected) — never a silent no-op.

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| drag enters panel | bg `panel` → `hairline`-level fill + border `panel-border` → `ink` | 150 ms | instant |
| drag leaves | symmetric back | 150 ms | instant |
| reading | label opacity pulse | 1.2 s ease-in-out loop | static text |
| rejection message appears | fade + slide-from-top-1 | 220 ms soft | instant |
| rejection message clears | fade out | 220 ms soft | instant |
| press (`Choose file…`) | scale → .97 | 220 ms | none |

**Tokens:** `panel`, `panel-border`, `hairline`, `faint`, `ink`, `muted`,
`warn` (file-level rejection copy). Never `neg` here — picking the wrong
file is not an error worth alarming about; never dashed (P3 rule).
**Layout:** the panel spans the row's full width under the label/control
line; at 360 px the copy wraps to three lines and the button sits under it,
full-width-capped at ~200 px. Long file names truncate with an ellipsis in
the middle (`kubushka-back…-08-04.json`) — never wrap the reading line.
**Acceptance:**
- [ ] A dropped file and a picked file take the identical code path and produce the identical outcome (S3 or S4).
- [ ] Drop target is solid-bordered (never dashed) and adds no second tab stop.
- [ ] All five file-level rejections show their pinned copy and leave the dataset untouched.
- [ ] The demo note renders in demo only.
- [ ] Reading a 5 MB file never freezes the row silently — the pulse state is visible.

## S3 — Import preview & diff dialog

**Purpose/parent/refs:** The review step that makes a whole-dataset replace
safe: what the file is, what it will change, what to worry about, what will
be backed up — then one deliberate destructive press. Parent: a modal opened
from S2, in the app's dialog idiom. Refs:
`design/extensions/settings.dc.html` **402–460** (the D17 AlertDialog shell:
`ink`/40 overlay, radius-24 card, fade/zoom-in-95 300 ms enter, symmetric
220 ms exit, outside click inert, Esc cancels, focus trapped);
`design/extensions/asset-form.dc.html` 55–148 (the tall dialog that scrolls
internally, max-width band 460–520 px); master reference 211–241 (the
snapshot table — the numeric-column rhythm the diff block borrows) and
303–339 (footnote idiom).

**Content inventory (EN):**
- Title: `Import into live` — dataset name interpolated (`Import into demo`).
- Subline (11 px `muted`, mono for the file name):
  `kubushka-backup-2026-08-03.json · exported 03.08.2026 21:14 · from live`
- **Replace warning banner** (always visible, never dismissible, alert icon
  16 px):
  `Replaces everything in the live dataset. Every asset, snapshot and transaction is deleted and rebuilt from this file. This cannot be undone.`
  Demo variant appends one sentence:
  `"Reset demo data…" restores the reference portfolio afterwards.`
- Diff microlabel: `What changes`
- Diff column headers: `Table` · `Added` · `Replaced` · `Removed`
- Diff rows: `Assets` · `Snapshots` · `Transactions`. Worked illustration —
  yesterday's live backup imported over today's live data (the case that
  makes the diff worth reading, since it silently drops today's work):

  | Table | Added | Replaced | Removed |
  |---|---|---|---|
  | Assets | 0 | 4 | 0 |
  | Snapshots | 0 | 173 | −1 |
  | Transactions | 0 | 18 | −1 |

- Diff cell formatting: added `+4`, replaced plain `173`, removed `−1`
  (U+2212, D8); a zero renders as `muted` `0` with no accent.
- Result line under the diff (13 px): `After import: 4 assets · 173 snapshots · 18 transactions.`
- Warnings microlabel (only when at least one fires):
  `Check before you continue`
- Warning items (each 12 px with a `!` glyph; all non-blocking):
  - `1 snapshot and 1 transaction in live are missing from this file — they will be removed.`
  - `This file was exported from the demo dataset.`
  - `Exported 12 days ago (23.07.2026).`
  - `This file has no snapshots — all 174 saved days in live would be removed.`
  - `This file has no assets — the dataset will be empty after import.`
  - `The file comes from a newer database version (3 vs 2) — fields this app doesn't know are ignored.`
- Settings opt-in (checkbox, default **OFF**):
  label `Also apply the settings saved in this file`; helper 11 px:
  `Replaces your currency and ₴/$ rate (₴ UAH · 44.83). Dataset, automation and reminder preferences are never touched.`
  When the file carries no settings block, the checkbox is replaced by an
  11 px `muted` line: `This file carries no settings.`
- Safety-backup line (11 px `muted`, download icon, directly above the
  buttons):
  `A backup of your current live data downloads automatically before anything is replaced — kubushka-before-import-2026-08-04.json.`
- Buttons: ghost `Cancel` · danger `Replace all data`
  (CSV variant: `Replace snapshots` — S6).
- Pending label: `Replacing…`
- Waiting on another tab's write lock: `Waiting for another tab…`
- Success toast: `Data imported — 4 assets, 173 snapshots, 18 transactions.`
  (CSV variant: `Snapshots imported — 174 days.`)
- Failure toast (dialog stays open): `Could not import — nothing was changed.`
- Safety-backup failure toast (import never starts):
  `Could not create the safety backup — nothing was imported.`
- Other-tab notice (the ONLY cross-tab visible element, one plain toast in
  every other open tab): `Data was replaced in another tab.`

**No typed-name arming here — pinned, with the reason.** P2/D17 reserved
typed-name arming for the whole-dataset erase/reset, and this dialog earns
the exemption honestly: the user chose a specific file, is reading an
itemized diff, and a safety backup is *automatic* rather than merely offered
(the erase dialog's backup is a CTA the user can skip — that asymmetry is
exactly what the typed name compensates for there). Deliberateness here is
carried by the non-dismissible `neg-tint` banner and the `danger`-variant
`Replace all data` label. Adding a typed name would be friction without
added safety.

**State matrix:**

| State | Treatment |
|---|---|
| default | dialog card `card`, radius 24, max-w ~480 px, padding 22–24; sections in the pinned order title → subline → banner → diff panel → warnings → settings opt-in → safety-backup line → buttons; the **diff panel is dashed 1 px `faint`, radius 16** (proposed data — P3 rule), everything else solid |
| hover | `Replace all data` darkens via opacity (danger variant); `Cancel` per ghost; checkbox row highlights `page`/60 |
| focus | ring on the checkbox, both buttons; initial focus lands on `Cancel` (Radix default — the destructive control is never pre-focused), focus trapped, Esc cancels while idle |
| disabled | both buttons while the write is pending; the checkbox too (its value is already committed to the run) |
| loading | pending: `Replace all data` → `Replacing…`, disabled, 1.2 s label pulse; Esc and outside click inert; **no percentage bar** — the write is one atomic transaction and a progress number would be fiction; lock contention shows `Waiting for another tab…` in the same slot |
| error | failure toast + dialog stays open in its default state, buttons re-enabled, diff unchanged (nothing was written — `replaceAll` is all-or-nothing); a safety-backup failure shows its own toast and never reaches the write |
| empty | n/a — a parsed file always has a diff; a file with zero rows is a *warning*, not an empty state |
| stale | n/a — a file is a point in time; its age is a warning line, not a stale treatment |
| demo-disabled | ACTIVE in demo: the title reads `Import into demo`, the banner gains its reset sentence; nothing is disabled |
| resolved (success) | dialog closes on the same 220 ms symmetric exit, success toast, every screen re-renders from the new data (full query invalidation) |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| dialog open | overlay fade + panel fade/zoom-in-95 | 300 ms soft | instant |
| dialog close (cancel or success) | symmetric exit | 220 ms soft | instant |
| diff rows appear | fade + slide-from-top-1, stagger 40 ms per table row | 220 ms soft | instant |
| warnings block appears | height reveal + fade | 300 ms soft | instant |
| checkbox toggle | check draw/fill | 150 ms | instant |
| confirm → pending | label crossfade + 1.2 s opacity pulse | 220 ms soft / loop | instant swap, no pulse |
| press (any button) | scale → .97 | 220 ms | none |
| toasts | sonner defaults | library | library |

**Tokens:** `card`, `faint` (dashed diff panel), `ink`, `muted`, `label`,
`hairline`; `neg-tint` + `neg-tint-text` for the replace banner (the
widening — see Global constraints); the warnings list is ONE
`warn-tint` block with `warn-tint-text` glyphs and sentences (a list of
cautions reads as one object; raw `warn` stays for inline microcopy);
`pos` / `warn` / `neg` as plain text accents for the three diff counts
(numbers keep the app's existing raw-accent treatment — never tinted pills,
so the tint families keep meaning "block", not "number"); `neg` bg + `card`
text for the armed danger button (D17 idiom); overlay from `ink` at low
alpha, no raw rgba hex.
**Layout:** dialog max-w ~480 px, max-h ~calc(100dvh − 48 px) with internal
scroll; the diff is a 4-column grid down to ~420 px, **below which each
table becomes its own block** (name line, then the three counts inline as
`+4 · 173 · −1` with their column words as 10 px labels); at 360 px the
buttons stack full-width with `Replace all data` last.
**Acceptance:**
- [ ] Confirm is the only write; cancel/Esc/close leave the dataset byte-identical (verify row counts before and after).
- [ ] The safety backup is built and handed to the browser BEFORE `replaceAll`; a failure to build it blocks the import with the pinned toast.
- [ ] Diff counts are per table and correct for added/replaced/removed (assets by id, snapshots by date, transactions by id); the result line equals added + replaced.
- [ ] The replace banner is present, non-dismissible, `neg-tint`-family, and names the target dataset.
- [ ] Settings apply ONLY with the checkbox on, and only through the store's setters/`migrateSettings` sanitizer (G3/D11) — never a direct localStorage write; unchecked leaves every persisted field untouched.
- [ ] Pending state blocks Esc/outside-close and shows no fake progress percentage.
- [ ] A second tab open on the app shows exactly one `Data was replaced in another tab.` toast and re-renders with the new data.
- [ ] Demo import allowed, banner adapted, `Reset demo data…` still restores the seed afterwards.

## S4 — Rejected-file report

**Purpose/parent/refs:** When a file cannot be imported, the app explains
why in the same dialog shell — precisely enough to fix the file, and without
ever suggesting something was written. Parent: the same modal as S3 (S2 is
the entry). Refs: the D17 dialog shell
(`design/extensions/settings.dc.html` 402–460); the validation-message idiom
(`design/extensions/asset-form.dc.html` error fragments, 11 px `neg` under
the offending field); master reference 303–339 for the muted footnote voice.

**Content inventory (EN):**
- Title: `This file can't be imported`
- Subline (mono 11 px `muted`): the file name.
- Lead line (13 px): `Nothing was changed. Fix the file and try again.`
- **Single-reason forms** (a format-level rejection is one sentence, never a
  list — the row list would be noise):
  - `That file isn't valid JSON.`
  - `This isn't a Kubushka backup — it has no "kubushka-backup" marker.`
  - `This backup was written by a newer version of the app (format 2). Update the app, or export again from the version that wrote it.`
  - `Couldn't read the header row.` (CSV — see S6 for the expected shapes)
  Each single reason may carry ONE mono 11.5 px `muted` technical detail
  line underneath, quoted verbatim from the parser (D12 strings live here
  and nowhere else), e.g.
  `Unsupported formatVersion 2 — this app reads formatVersion 1 only.`
- **Row-error list** (schema/integrity rejections):
  - Microlabel: `12 problems found — showing the first 10`
    (exact count; singular `1 problem found`; no cap line when ≤ 10).
  - Items, mono 11.5 px, one per line, location first:
    - `transactions.tx-0007 — unknown asset id "a-9"`
    - `snapshots.2026-07-25 — quote for an unknown asset "a-9"`
    - `snapshots — duplicate date 2026-07-25 (date is the primary key)`
    - `assets.2.createdAt — expected timezone-less yyyy-MM-ddTHH:mm:ss`
    - `transactions.tx-0012.amount — expected a positive number`
    - `Row 5 — "31.07.2026" is not a yyyy-MM-dd date` (CSV)
    - `Header column 3 — "OVDP" doesn't match any asset in live` (CSV, S6)
  - Closing hint (12 px `muted`, always): `Rows are checked before anything is written — one bad row stops the whole import.`
- Buttons: ghost `Close` · outline `Choose another file…` (re-opens the file
  dialog directly from here).
- No toast: the dialog *is* the message.

**State matrix:**

| State | Treatment |
|---|---|
| default | same dialog shell as S3 (radius 24, max-w ~480 px); lead line in `neg`, list in a `panel` sub-panel radius 16 with internal scroll (max-h ~200 px) |
| hover | scrollbar only; list items are inert text (selectable, so a user can copy a line — no copy button needed) |
| focus | ring on both buttons; initial focus on `Close`; Esc closes |
| disabled | n/a — nothing here mutates |
| loading | n/a — the report renders after parsing finished |
| error | n/a — this surface IS the error surface |
| empty | n/a — it never opens without at least one reason |
| stale | n/a |
| demo-disabled | identical in both datasets |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| dialog open | overlay fade + panel fade/zoom-in-95 | 300 ms soft | instant |
| list items appear | fade only (no stagger — a wall of staggered errors reads as an animation, not a report) | 220 ms soft | instant |
| dialog close | symmetric exit | 220 ms soft | instant |
| press | scale → .97 | 220 ms | none |

**Tokens:** `card`, `panel` (list sub-panel), `hairline`, `neg` (lead line
only), `muted` (details, hint, count), `ink` (item text). Never `neg-tint`
(nothing was destroyed — that family stays for irreversible-harm banners and
overdue reminders), never dashed (nothing is proposed here).
**Layout:** the list scrolls inside its sub-panel; long ids/paths wrap at
character boundaries rather than overflowing; at 360 px the two buttons
stack.
**Acceptance:**
- [ ] Format-level rejections render as one sentence (+ optional mono detail), never as a list.
- [ ] Row errors are location-prefixed, capped at 10 with an exact total count, and the container scrolls instead of the page.
- [ ] The dataset is provably untouched after a rejection (row counts unchanged).
- [ ] `Choose another file…` returns to the file dialog without closing back to a dead end.
- [ ] Every item's wording comes from structured issue tokens in the component layer; only the D12 parser strings appear as mono detail (D8).

## S5 — Spreadsheet export (CSV) row

**Purpose/parent/refs:** Per-table CSV export — the "spreadsheet view" half
of the user's "spreadsheet as DB" intent. Parent: Settings → Data row 4
(S1). Refs: the `Backup` row it sits under
(`design/extensions/settings.dc.html` 234–247 — same label-left/buttons-right
rhythm, same outline pill); master reference 211–241 (the snapshot table
whose *wide* shape and `pending` cells this export mirrors) and 303–339
(footnote voice for the format note).

**Content inventory (EN):**
- Row title: `Spreadsheet export (CSV)`
- Row helper: `One file per table, ready for a spreadsheet. Snapshots export wide — one row per date, one column per asset; an empty cell means no quote was saved that day, never zero.`
- Buttons (outline, `sm`, 13 px, download icon 13 px, in this order):
  `Assets` · `Snapshots` · `Transactions`
- Format note (11 px `muted`, under the buttons):
  `Machine format: dot decimals, comma separators, UTF-8, CRLF. The app's own 68 702,10 display formatting never goes into a file.`
- Column note (11 px `muted`, second line):
  `Snapshot columns are named "Asset name (id)" — the id in brackets is what a re-import matches on.`
- Failure toast: `Could not build the CSV — please try again.`
- No success toast: the browser's own download indication is the feedback
  (same as `Download backup`, D12).

**Save-picker parity (pinned — no user-visible divergence):** where
`showSaveFilePicker` exists (Chromium) an export opens the browser's Save-as
dialog; elsewhere the file lands in the Downloads folder via `<a download>`.
**The UI never mentions the difference**, never branches its copy, and
**cancelling the Save-as dialog is not an error** — no toast, no message,
the row returns to default (`AbortError` swallowed). The same rule covers
the JSON `Download backup`. The **one exception, and it is a hard rule:** the
S3 automatic pre-import safety backup always uses `<a download>` — a modal
Save-as dialog in front of a safety guarantee is a dialog the user can
cancel, and the guarantee must not be cancellable.

**State matrix:**

| State | Treatment |
|---|---|
| default | three outline `sm` pills in a right-aligned wrap group; helper + two `muted` note lines under the row |
| hover | soft fill per the outline variant, 150 ms |
| focus | global ring per button |
| disabled | the pressed button only, while its file is being built (opacity .5) — the other two stay live |
| loading | building = the pressed button disabled; no spinner (sub-second at seed scale: 174 rows × 4 columns) |
| error | failure toast; buttons return to default |
| empty | an empty table exports a header-only file and the button stays ENABLED (a valid empty export is the honest answer; disabling it would look like a bug) |
| stale | n/a |
| demo-disabled | ACTIVE in demo — exports the ACTIVE dataset, exactly like `Download backup` |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| hover | bg fill | 150 ms | instant |
| press | scale → .97 | 220 ms | none |
| disabled flip while building | opacity | 220 ms soft | instant |

**Tokens:** existing button-variant tokens (`ink` outline, `sidebar-text`
hover fill), `muted` (helper + notes), `neg` only inside the failure toast's
sonner styling (existing idiom).
**Layout:** buttons wrap to their own line under the label block below
~480 px and stack to full width at 360 px; note lines wrap freely.
**Acceptance:**
- [ ] Three buttons, one per table, pinned order and filenames.
- [ ] Snapshots export WIDE with `date`, `cash`, then one column per asset headed `Asset name (id)`; a pending quote is an EMPTY cell — never `0`, never `pending` text.
- [ ] Files are dot-decimal, comma-separated, UTF-8 with BOM, CRLF; no thousands grouping and no `₴` anywhere in a file.
- [ ] Chromium Save-as and the fallback anchor produce the same bytes and the same file name; a cancelled Save-as produces no message.
- [ ] The empty-table export is a header-only file and does not error.
- [ ] A demo snapshots export re-imported into demo returns every D5-pinned figure unchanged.

## S6 — CSV snapshot import: the deltas

**Purpose/parent/refs:** CSV import covers **snapshots only** (plan flagged
scope cut — assets/transactions restore is JSON-only), auto-detecting the
wide and long layouts, and it runs through the *same* S2 → S3 → S4 pipeline.
This section pins only what differs. Parent: the S3 dialog and the S4 report.
Refs: master reference 211–241 (wide snapshot table, `pending` cells); the
S3/S4 shells.

**Content inventory (EN) — additions and replacements:**
- Scope strip (a `panel` block with an `i` glyph, first thing under the S3
  subline, above the replace banner):
  `CSV import covers snapshots only — assets and transactions stay exactly as they are. Restore those from a JSON backup.`
- Replace banner (replaces the S3 wording, scoped honestly):
  `Replaces every saved day in the live dataset. Snapshots are deleted and rebuilt from this file. This cannot be undone.`
- Detection line (11 px `muted`, in the subline row):
  `Detected wide layout — 174 dates × 4 asset columns.` /
  `Detected long layout — 696 quote rows over 174 dates.`
- Empty-cell restatement (12 px `muted`, under the diff):
  `Empty cells stay empty — those days keep no quote for that asset, and no figure treats them as zero.`
- Diff rows: `Snapshots` carries the counts; `Assets` and `Transactions`
  read `muted` `unchanged` across all three columns.
- Confirm button: `Replace snapshots`
- Success toast: `Snapshots imported — 174 days.`
- Column matching (behavior, and the source of its error copy): a wide
  header cell resolves to an asset by the **id in its trailing brackets**
  first (`Inzhur REIT (reit)` → `reit`; the LAST bracketed group wins, so an
  asset name may contain brackets), then by an exact trimmed
  case-insensitive **name** match when that name is unique in the dataset.
  Anything else is a row error:
  `Header column 3 — "OVDP" doesn't match any asset in live`
  (ambiguous name variant: `Header column 3 — "OVDP" matches 2 assets in live — use the "Asset name (id)" form`).
- Detection failure (S4 single reason + detail):
  `Couldn't read the header row.` + mono detail
  `expected date,cash,<Asset name (id)>… (wide) or date,assetId,quote (long)`
- Other CSV row errors (S4 list): `Row 5 — "31.07.2026" is not a yyyy-MM-dd date` ·
  `Row 12 — "68 702,10" is not a machine number (use 68702.10)` ·
  `Row 18 — duplicate date 2026-07-25` ·
  `Row 3 — cash is missing`

**State matrix:** identical to S3/S4 except:

| State | Treatment |
|---|---|
| default | the scope strip is present and the banner/confirm carry the snapshot-scoped copy |
| loading | detection happens during S2's `Reading…` state — the dialog never opens in an undetected state |
| error | a layout that cannot be detected never opens S3; it opens S4 with the single-reason form |
| empty | a CSV with a header and no data rows: diff shows `−174` removed / `0` added, warning `This file has no rows — all 174 saved days would be removed.`; still confirmable (deliberate wipes are allowed) |
| demo-disabled | ACTIVE in demo (same as S3) |

All other rows inherit S3/S4 verbatim.

**D7 motion:** inherits S3/S4 entirely; the scope strip joins the dialog's
content reveal (fade + slide-from-top-1, 220 ms, no separate stagger).
**Tokens:** `panel` + `label` (scope strip — information, not caution, so
NOT the warn family), everything else per S3/S4.
**Layout:** the scope strip is full dialog width, radius 16, padding 12×14;
it must not push the replace banner below the fold at 360 px — banner first
in the tab/reading order after it.
**Acceptance:**
- [ ] Both layouts auto-detect from the header row; the detected shape is stated in the dialog.
- [ ] Assets and transactions are provably untouched by a CSV import (counts and rows identical before/after).
- [ ] An empty cell imports as *no quote* and a `0` imports as zero — the two never collapse.
- [ ] Column headers resolve by bracketed id first, then unique name; both mismatch forms produce their pinned error copy.
- [ ] The confirm button and success toast use the snapshot-scoped copy, never S3's whole-dataset wording.

## S7 — File mirror row ("Keep a file in sync")

**Purpose/parent/refs:** The "spreadsheet as DB" durability wish, closed
honestly: a Chromium-only, write-only mirror of the full JSON into a
user-picked file, rewritten (debounced ~2 s) after every repository write, so
a synced folder carries the data to another device. Parent: Settings → Data
row 5 (S1). Refs: the `SettingRow` + status-chip idioms
(`design/extensions/settings.dc.html` 208–261; the progress pill, master
line 60); `pos-tint` status idiom from the "Next payouts" card (master
147–210); the P3 `DEMO` micro-tag inside a disabled control
(`design/extensions/daily-quotes-live.dc.html` 390–397).

**Content inventory (EN):**
- Row title: `Keep a file in sync`
- Helper (unlinked): `Kubushka rewrites one JSON file after every change. Put it in a synced folder and another device gets a copy. The app's database stays the source of truth — the file is written, never read back.`
- Helper (linked, replaces the sentence about picking):
  `Written after every change. The previous contents are kept beside it as <name>.bak.`
- Buttons: unlinked `Choose file…` · linked `Sync now` (outline `sm`) +
  `Unlink` (ghost `sm`) · needs-permission `Re-allow access` (outline).
- File line (linked, mono 11 px `muted`): `kubushka-mirror.json`
- Status chips (10 px uppercase micro-pill, radius 999):
  - `Synced 13:42` — written today (`pos-tint` / `pos-tint-text`);
    older: `Synced 25.07 13:42`.
  - `Syncing…` — a write in flight (`panel` / `muted`).
  - `Permission needed` (`warn-tint` / `warn-tint-text`).
  - `Last write failed` (`warn-tint` / `warn-tint-text`).
- Permission line: `Your browser needs permission to write this file again — that happens after a restart.`
- Write-failure line: `Couldn't write the file at 13:42 — the folder may be offline. Your data is safe in the app.`
- Demo tooltip (`title`, control disabled): `Mirroring is disabled in the demo dataset — switch to Live in Settings → Data.`
- In-button demo tag: `DEMO` (10 px uppercase micro-pill, warn-tint family —
  the P3 S1 idiom, same family as the sidebar badge).
- Toasts: `File mirror linked` · `File mirror unlinked` ·
  `Mirror write failed — your data is safe in the app.` (once per failure
  burst, dismissible) · `Permission denied — the file wasn't written.`
- Times are the **local** clock (`HH:MM`), not Kyiv — a file write happens on
  the user's machine (contrast: P3's Inzhur times are Kyiv because the prices
  are stamped there).

**State matrix (the seven states, plus the shared ones):**

| State | Treatment |
|---|---|
| default / **unlinked** | title + helper + `Choose file…`; no chip, no file line |
| **linking** | the OS picker is open: `Choose file…` disabled with its label unchanged (the picker is the feedback); a cancelled picker (`AbortError`) returns to unlinked **silently** — no toast, no error |
| **linked** | chip `Synced HH:MM` (`pos-tint`), file line, `Sync now` + `Unlink`; linking writes once immediately, so the chip never sits in a "linked but never written" limbo |
| **syncing** | chip `Syncing…` with a 1.2 s opacity pulse; buttons stay live (a queued write coalesces — the debounce is the queue) |
| **permission-needs-rearm** | chip `Permission needed` (`warn-tint`) + the permission line + `Re-allow access` (must be a user gesture); granting writes immediately and flips to `Synced HH:MM`; denial keeps the state and toasts `Permission denied — the file wasn't written.` |
| **write-failed** | chip `Last write failed` (`warn-tint`) + the failure line + `Sync now`; the chip persists until the next successful write (it is status, not a message), and the failure toast is dismissible — a mirror failure NEVER blocks or rolls back the app's own write |
| **unsupported browser** | the whole row is ABSENT from first paint (no placeholder, no "your browser doesn't support this" apology); Backup + CSV are the portability story there |
| **demo-disabled** | the row renders in full with `Choose file…` disabled at opacity .5, the in-button `DEMO` micro-tag and the `title` tooltip — the section keeps its shape in both datasets (P3 S1 precedent) |
| hover | buttons per their variants, 150 ms; chips are inert (native `title` only) |
| focus | ring per button |
| disabled | n/a as a state of its own — the row's controls are only ever disabled by **linking** (the OS picker is open) and **demo-disabled** above; there is no other gate, so nothing else greys them. Note for both: a disabled button is not hit-testable (`disabled:pointer-events-none`), so a `title` on the button alone never shows — carry it on a hit-testable wrapper, per P3 S1 (D23) |
| loading | `Syncing…` is the only loading treatment — there is no blocking state |
| error | covered by write-failed / permission rows above; never `neg` — the mirror is best-effort by design (plan risk note: "show last-synced, never promise more") |
| empty | linked to a file while the dataset is empty: still writes (a valid empty envelope), chip normal |
| stale | n/a — the chip's timestamp IS the freshness statement; nothing here degrades silently |

Behavior notes: unlinking needs no confirmation (the file stays on disk and
nothing is destroyed) and toasts `File mirror unlinked`. The handle lives in
Dexie `meta` (D9, key `mirrorHandle`) — never localStorage — and a handle
whose permission cannot be verified resolves to permission-needs-rearm, not
to unlinked (losing the user's chosen file silently would be worse than
asking).

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| chip appears / label changes | re-keyed: fade + zoom-in-95 | 150 ms | instant |
| chip state flip (synced ↔ syncing ↔ warn) | bg/color crossfade on the re-keyed chip | 220 ms soft | instant |
| `Syncing…` pulse | opacity oscillation | 1.2 s ease-in-out loop | static |
| status/permission line reveal | height + fade + slide-from-top-1 | 300 ms soft | instant |
| link / unlink | row content crossfade + height | 220 ms soft | instant |
| hover | bg fill | 150 ms | instant |
| press | scale → .97 | 220 ms | none |

**Tokens:** `pos-tint(-text)` (synced), `panel` + `muted` (syncing, file
line), `warn-tint(-text)` (permission needed, last write failed),
`warn-tint(-text)` again for the `DEMO` tag, `ink`/`muted` for text, button
variants as they are. **Never `neg`** anywhere in this row — a mirror is
best-effort and its failure is a caution, not a data error. Never
`pos-border` (that means a parsed, valid quote).
**Layout:** chip sits right of the title on the label line (wrapping under
it at 360 px); the file line is the third line of the label block; buttons
wrap to their own line below ~480 px. Long file names truncate in the middle
and expose the full path-free name via `title`.
**Acceptance:**
- [ ] All seven states reachable and visually distinct; the unsupported-browser case renders nothing at all.
- [ ] A mirror write never blocks, delays or rolls back the repository write that triggered it; a failure is a chip + one dismissible toast.
- [ ] The previous file contents survive as `<name>.bak` before each write.
- [ ] Permission re-arm happens behind a user gesture and writes immediately on grant.
- [ ] Demo: control disabled with the `DEMO` tag + tooltip; no file handle can be created there.
- [ ] Cancelling the file picker is silent (no error styling, no toast).
- [ ] The row's copy never claims sync guarantees — only "last written" facts.

## S8 — Danger zone: the final look

**Purpose/parent/refs:** With import, CSV and the mirror sharing the Data
section, "Danger zone" can no longer be one row among six that happens to
have a terracotta button — it becomes a visually separated sub-panel at the
foot of the card, and its copy points at the fact that Import replaces data
too. Parent: Settings → Data, last block (S1). Refs: the current row
(`design/extensions/settings.dc.html` 249–260) and the S6 typed-name dialogs
it opens (402–460, unchanged); the nested-sub-panel geometry of the master
reference's "New asset details" panel (116–125) — geometry only, solid
border here.

**Content inventory (EN):**
- Sub-panel microlabel: `Danger zone` (10 px uppercase tracking .12em, in
  `neg-tint-text`).
- Helper: `These actions delete data outright. Both ask you to type the dataset name and offer a backup first. Import also replaces everything — it lives above, with its own automatic backup.`
  (Supersedes the P2 helper "Both actions ask for a typed confirmation and
  offer a backup first.")
- Trigger (visibility by dataset, D17 — unchanged): live `Erase live data…`
  · demo `Reset demo data…`
- Dialogs, their typed-name arming, backup CTA, toasts and body copy:
  **unchanged from P2 S6 / D17** (including the superseded erase body from
  the P2 brief's "Superseding sections"). Phase 4 changes the *frame*, not
  the dialogs.

**State matrix:**

| State | Treatment |
|---|---|
| default | nested sub-panel: bg `card`, **solid** 1 px `neg-tint` border, radius 16, padding 16, 18 px of air above it and no `Divider` before it (the border is the separation); microlabel, helper, trigger right-aligned (stacked at narrow widths) |
| hover | trigger per the `outlineDanger` variant (neg fill at 8 %), 150 ms; the panel itself is inert |
| focus | ring on the trigger |
| disabled | n/a — the trigger is always live; the *dialog* does the arming |
| loading | n/a — the pending state lives in the dialog |
| error | n/a here (the dialog keeps its `Could not complete — nothing was deleted.` toast) |
| empty | an already-empty live dataset still shows `Erase live data…` (idempotent, and hiding it would read as a missing feature) |
| stale | n/a |
| demo-disabled | visibility, not disablement (D17): `Erase live data…` renders only in live, `Reset demo data…` only in demo — never both, never a disabled one |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| hover | bg fill on the trigger | 150 ms | instant |
| press | scale → .97 | 220 ms | none |
| dialog open/close | the D17 shell (300 ms open, symmetric 220 ms exit) | soft | instant |

**Tokens:** `card` (panel bg), `neg-tint` (panel border only — block-level,
per the widened rule), `neg-tint-text` (microlabel only), `muted` (helper),
`neg` (the `outlineDanger` trigger's border/text and the armed dialog fill,
unchanged). The panel border is a *tint*, not raw `neg`: the routine rows are
hairline, so a tint border already reads as "different"; a full-strength
terracotta frame would shout over the trigger it contains.
**Layout:** full card width, radius 16, inside the existing 22 px card
padding; at 360 px microlabel → helper → trigger stack with the trigger
full-width-capped at ~220 px.
**Acceptance:**
- [ ] The danger zone is a bordered sub-panel, not a `SettingRow`, and is the last block in the Data card.
- [ ] Its helper carries the Import cross-reference (pinned copy above).
- [ ] Exactly one trigger renders per dataset; the P2/D17 dialogs, arming and toasts are untouched.
- [ ] `neg-tint` appears here only as a border/microlabel — no tinted background block, no tinted numbers.

---

## Phase-wide acceptance (the design session's definition of done)

- [ ] Every surface above has a corresponding region in a
      `design/extensions/*.dc.html` file, master-idiom inline styles, exact
      values literal; one surface never spans two files.
- [ ] **No new tokens.** The only novelty is the documented widening of
      `neg-tint`/`neg-tint-text` to block-level irreversible-harm framing —
      exactly two sites, the S3 replace banner and the S8 danger-zone panel —
      with the widened rule restated verbatim in the new extension's header
      comment (and recorded in `docs/DECISIONS.md` by the implementing task).
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
