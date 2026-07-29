# Design brief — Phase 2: Settings home & the real-data era

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/NEXT-PHASE-PLAN.md` Phase 2; formulas:
`docs/FORMULA-AUDIT.md` + D13.

**Suggested extension files:** `settings.dc.html` (S1–S8),
`metrics-exposure.dc.html` (S9–S10). The design session may split differently;
one surface must never span two files.

## Global constraints (apply to every surface below)

- **Demo-figure invariant (binding):** every change is ADDITIVE — no D5-pinned
  demo figure may change (`docs/DECISIONS.md` D5, `navigation-map.md`
  checkpoints: ₴149,016.36 total · +₴4,452.61/+3.08% · deposited ₴143,176 ·
  reinvested ₴1,387.38 · income ₴5,040.94 · top-up ₴11,429.49 · …6475
  annualized +10.9%). Relabeling a metric is allowed; changing its value is not.
- **Tokens** (`src/index.css` `@theme`) — the full existing vocabulary: `page`,
  `ink`, `card`, `muted`, `faint`, `hairline`, `panel`, `panel-border`,
  `label`, `sidebar`, `sidebar-text`, `sidebar-muted`, `sidebar-inset`,
  `sidebar-hover`, `sidebar-nav`, `pos`, `pos-tint`, `pos-tint-text`,
  `pos-on-dark`, `pos-border`, `neg`, the 4 asset hues (`reit`, `energy`,
  `ovdp8976`, `ovdp6475` + `-tint`/`-tint-text`) and `chart-*` aliases.
  **New tokens this phase mints (values = design session's choice):**
  `--color-warn`, `--color-warn-tint`, `--color-warn-tint-text` — a warm amber
  family for caution states (Σ≠100, ledger drift, DEMO badge, stale), visually
  distinct from the `energy` asset hue and from `neg`. No other new tokens; no
  ad-hoc hex anywhere.
- **Layout:** cards radius 20–24 px; pills/badges/segments radius 999; inputs
  radius 10; nested sub-panels radius 16; sidebar 232 px (136 px below `sm`);
  the shell holds at 360 px with no page-level horizontal scroll (wide tables
  scroll inside their card).
- **Type:** `font-display` (Space Grotesk) for headings/buttons/KPI values;
  `font-body` (Spline Sans Mono) elsewhere; microlabels 10 px uppercase
  tracking .12em; body 13 px.
- **Motion (D7):** defaults 220 ms `cubic-bezier(0.22,1,0.36,1)`; hover may
  drop to 150 ms; reveals 300–400 ms; every pressable gets
  `active:scale-[.97]`; `prefers-reduced-motion` collapses everything
  (global kill-switch) — listed per surface below.
- **Numbers/dates:** tables `68 702,10`; prose/KPI `₴68,629.36`; dates
  `dd.MM.yyyy`; signed values use U+2212 (D8). Figures in this brief are demo
  illustrations — the app derives everything.

---

## S1 — Settings nav pill + third sidebar group

**Purpose/parent/refs:** Entry point to `/settings`. Parent: sidebar shell,
design lines 1–54 (nav groups "Daily entry" / "Analytics", group-label and
pill anatomy). A third group appears after "Analytics", before the bottom
(currency toggle) block.

**Content inventory (EN):**
- Group label: `Settings` (rendered uppercase by style, like `Analytics`).
- Nav pill: `Settings` → route `/settings`.

**State matrix:**

| State | Treatment |
|---|---|
| default | transparent pill, text `sidebar-nav`, normal weight — identical to inactive Analytics pills |
| hover | opacity .85 (transition) |
| focus | global `:focus-visible` 2 px `ink` outline, offset 2 |
| disabled | n/a — navigation is never disabled |
| loading | n/a — route is eager |
| error | n/a |
| empty | n/a |
| stale | n/a |
| demo-disabled | n/a — Settings is available in both datasets |
| active route | pill `bg sidebar-text`, bold, text `ink` (same as other active pills) |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| hover | opacity | 150 ms soft | instant |
| press | scale → .97 | 220 ms soft | none |
| route activate | bg/color of pill | 220 ms soft | instant |

**Tokens:** `sidebar-nav`, `sidebar-text`, `sidebar-muted`, `ink` only.
**Layout:** pill radius 999, px 14 / py 8, full sidebar width — clone of the
existing pills.
**Acceptance:**
- [ ] Group renders between Analytics and the currency toggle at 232 px and 136 px widths.
- [ ] Active state matches the other pills pixel-for-pixel.

## S2 — `/settings` screen layout

**Purpose/parent/refs:** The settings home: four stacked section cards.
Parent: new flat route in the main content area. Match the screen-header
pattern (title 26 px + muted subtitle) and card anatomy of Overview, design
lines 147–210; microlabel style per the "Assets"/"Next payouts" card labels.

**Content inventory (EN):**
- Header title: `Settings`; subtitle: `Preferences, data and portfolio configuration`
- Card 1 microlabel: `Portfolio` — hosts the asset manager (list of assets:
  color dot, name, yield-type short label, per-row `Edit` button; footer
  button `+ Add asset` opening S3) and the targets editor (S4).
  Empty state (live dataset, no assets): `No assets yet — add your first asset to start tracking.`
- Card 2 microlabel: `Data` — hosts S5 (dataset switch), S7 (backup), and the
  destructive actions: button `Erase live data…` (visible in live), button
  `Reset demo data…` (visible in demo) — both open S6.
- Card 3 microlabel: `Automation` — placeholder body:
  `Nothing to configure yet — Inzhur quote fetching, coupon suggestions and reminders arrive in the next release.`
- Card 4 microlabel: `Appearance` — currency segmented control `₴ UAH` / `$ USD`
  (mirrors the sidebar toggle, light-surface styling), S8 (usdRate), and
  placeholder line: `Theme and language settings are coming later.`

**State matrix:**

| State | Treatment |
|---|---|
| default | 4 `card` cards radius 24, single column, gap 14, staggered entry |
| hover | row hover on asset-manager rows: `page`/60 bg (like table rows) |
| focus | global focus ring on every control |
| disabled | live-only controls disabled in demo (see S5/S6/S7 rows) |
| loading | queries pending → asset list shows nothing yet; controls render immediately (settings are local) |
| error | n/a at screen level (per-control errors below) |
| empty | Portfolio card empty state copy above; other cards never empty |
| stale | n/a |
| demo-disabled | `Erase live data…` hidden (demo shows `Reset demo data…` instead); everything else enabled |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| route mount | fade + slide-from-bottom per card, stagger 75 ms | 300 ms soft | instant |
| row hover | background | 150 ms | instant |
| section content changes (e.g. dataset flip pre-reload) | color/bg transitions | 220 ms | instant |

**Tokens:** `card`, `ink`, `muted`, `hairline`, `page`, `pos-tint(-text)` for
positive accents; `warn`* family only inside S4/S5/S9d.
**Layout:** single column of full-width cards (radius 24, padding 22); inner
control rows are label-left / control-right, wrapping to stacked below ~480 px;
holds at 360 px.
**Acceptance:**
- [ ] All four cards present in the pinned order Portfolio → Data → Automation → Appearance.
- [ ] Asset manager lists the 4 demo assets with dots + short yield labels.
- [ ] 360 px: no horizontal scroll.

## S3 — AssetForm (create + edit, full field set)

**Purpose/parent/refs:** Standalone form covering EVERY `Asset` field —
replaces the transaction-welded `NewAssetFields` as the single asset form.
Hosts: Settings→Portfolio (`+ Add asset`, and per-row `Edit`); the
TransactionPanel quick-create keeps rendering this same form inline. Refs:
new-asset sub-form design lines 116–124 (dashed reveal panel, field anatomy);
field-label style lines 110–146; the Attributes fact cards lines 340–409 pin
the field vocabulary (Maturity, Coupon, Next coupon, Reinvest policy).

**Content inventory (EN):**
- Panel heading: create `New asset details` (keeps the existing sub-form
  heading + plus icon); edit `Edit asset`.
- `Name` — text, placeholder `OVDP UA4000241234`
- `Code` — text (2 letters, avatar circle), auto-derived from the first two
  letters of Name while untouched, editable; placeholder `GB`
- `Yield type` — select: `Fixed coupon` / `Dividends` / `Capitalization` /
  `Dividends + capitalization`
- `Expected, %` — decimal, placeholder `16.5`
- `Target, %` — decimal, placeholder `10`
- `Payout schedule` — select: `At maturity` / `Monthly` / `Quarterly` /
  `Semi-annual`; edit mode of an asset already holding the seed-only `none`
  additionally shows `None (price only)` (create never offers it)
- `First purchase` — date; create: prefilled today (quick-create keeps
  deriving it from the transaction date); edit: editable date
- **Fixed-coupon group** — revealed when Yield type = Fixed coupon:
  - `Maturity` — date
  - `Coupon amount, ₴` — decimal, placeholder `1 240,00`
  - `Next coupon` — date
  - `Reinvest policy` — text, placeholder `Auto (dividends)`
- **Inzhur group** — toggle row `Link to Inzhur` (off by default; on = reveal):
  - Kind segmented control: `Fund` / `Bond`
  - Ref field — label `Fund slug` placeholder `inzhur-reit` when Fund;
    label `Bond ISIN` placeholder `UA4000238976` when Bond (manual text this
    phase; live picker in Phase 3)
  - `Units` — decimal, placeholder `6 164`
  - Helper line: `Linked assets are valued as units × the fetched sell price. Fetching arrives in the next release — the link and units are stored now.`
  - **Units-first framing:** while the link toggle is ON, the Units field takes
    the visual position/weight the value-centric fields had — quantity is the
    input, value is derived.
- Submit: create `Add asset`; edit `Save changes`. Secondary: `Cancel`.
- Validation summary (below submit): `Check the highlighted fields and try again.`
- Per-field messages: `Name is required.` · `Code is 1–2 letters.` ·
  `Enter a percentage.` · `Enter an amount.` · `Pick a date.` ·
  `Enter the fund slug.` / `Enter the bond ISIN.` · `Enter the number of units.`

**State matrix:**

| State | Treatment |
|---|---|
| default | inputs bg `page` (inside white panel) / bg `card` (on panel bg), border `hairline`, radius 10, h 36 |
| hover | border → `faint` (transition) |
| focus | global ring; border `faint` |
| disabled | submit disabled while mutation pending (opacity .5) |
| loading | edit mode before asset loads: form not rendered (dialog opens with data) |
| error | invalid field: border `neg`, message 11 px `neg` under field; summary line appears |
| empty | n/a (form always has fields) |
| stale | n/a |
| demo-disabled | n/a — asset editing IS allowed in demo (Reset demo is the escape hatch) |
| reveal states | fixed-coupon group and Inzhur group animate in/out per motion table |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| group reveal (yield type / Inzhur toggle) | fade + slide-from-top, height | 300 ms soft | instant show |
| group hide | symmetric fade/slide out | 300 ms soft | instant hide |
| kind segment flip | sliding thumb transform (clone of currency toggle) | 300 ms soft | jump |
| field error appears | message fade + slide-from-top 1 | 220 ms | instant |
| submit press | scale .97 | 220 ms | none |
| border color changes | border-color | 150 ms | instant |

**Tokens:** `page`, `card`, `hairline`, `faint`, `label`, `ink`, `neg`,
`pos-tint-text` (group headings), `muted`.
**Layout:** panel radius 16 (nested) or dialog card radius 24; two-column
grid for paired fields (Expected/Target, Maturity/Next coupon), stacking at
narrow widths; the form fits 360 px unclipped.
**Acceptance:**
- [ ] Every `Asset` field reachable in edit mode, incl. the four fixed-coupon fields and `inzhur {kind, ref, units}`.
- [ ] Create-vs-edit copy differs exactly as pinned (`Add asset` / `Save changes`).
- [ ] TransactionPanel quick-create renders the same form inline with unchanged atomic `recordTransaction(tx, newAsset)`.
- [ ] `none` schedule never offered on create.
- [ ] Validation styling matches the existing form-error idiom.

## S4 — Targets editor rows + Σ indicator

**Purpose/parent/refs:** Set `targetPct` per asset with a live sum check.
Parent: Settings→Portfolio card (S2). Refs: Allocation current-vs-target
pills, design lines 496–552 (target framing vocabulary); share-bar anatomy
lines 147–210.

**Content inventory (EN):**
- Sub-heading (microlabel): `Targets`
- Row: color dot · asset name · muted current share `now 46.1%` · input
  (decimal, suffix `%`)
- Σ pill (=100): `Σ 100%`
- Σ pill (≠100): `Σ 92% — targets don't add up to 100%` (non-blocking)
- Live preview: share bar re-rendering the entered targets
- Submit: `Save targets`; toast on success: `Targets saved`

**State matrix:**

| State | Treatment |
|---|---|
| default | rows like the Overview Assets list; inputs w ~72 px right-aligned |
| hover | row bg `page`/60 |
| focus | ring on input |
| disabled | `Save targets` disabled while pending |
| loading | rows absent until assets load |
| error | non-numeric input: border `neg` + message `Enter a percentage.` |
| empty | no assets: editor hidden behind the S2 Portfolio empty state |
| stale | n/a |
| demo-disabled | n/a — allowed in demo |
| Σ = 100 | pill bg `pos-tint`, text `pos-tint-text` |
| Σ ≠ 100 | pill bg `warn-tint`, text `warn-tint-text` — saving still allowed |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| Σ value change | re-keyed pill: fade + zoom-in-95 | 150 ms | instant |
| Σ tint flip (100 ↔ not) | bg/color | 220 ms soft | instant |
| preview bar update | segment widths | 300 ms soft | instant |
| row hover | background | 150 ms | instant |

**Tokens:** `pos-tint(-text)`, `warn-tint(-text)`, `hairline`, `page`,
`muted`, `neg`, asset hues via existing dot component.
**Layout:** rows within the Portfolio card; pill radius 999; inputs radius 10.
**Acceptance:**
- [ ] Σ recomputes on every keystroke; 100 exactly → green tint, else amber.
- [ ] ≠100 never blocks saving.
- [ ] Demo targets 40/40/17/3 render Σ 100% on first paint.

## S5 — Dataset switch + DEMO sidebar badge

**Purpose/parent/refs:** Flip between the `demo` (reference seed) and `live`
(real, starts empty) datasets (G4: two Dexie DBs, reload on toggle). Control
parent: Settings→Data card. Badge parent: sidebar logo lockup, design lines
1–54. Segmented-control anatomy: the sidebar currency toggle (sliding thumb).

**Content inventory (EN):**
- Control label: `Dataset`; segments: `Demo` / `Live`
- Helper: `Demo holds the built-in reference portfolio. Live starts empty and holds your real data. Switching reloads the app.`
- Sidebar badge: `DEMO` (pill, uppercase); `title` tooltip:
  `Demo dataset — reference data. Switch in Settings → Data.`

**State matrix:**

| State | Treatment |
|---|---|
| default | light-surface segmented control (track `panel`, thumb `card`, border `panel-border`), active segment bold `ink` |
| hover | inactive segment opacity .85 |
| focus | ring on segment buttons |
| disabled | brief pre-reload lockout after click (both segments disabled) |
| loading | n/a (synchronous localStorage write, then reload) |
| error | n/a |
| empty | n/a |
| stale | n/a |
| demo-disabled | n/a — the switch itself is always available |
| badge visible | dataset = demo → `DEMO` pill bg `warn-tint` text `warn-tint-text`, always rendered (persistent) |
| badge hidden | dataset = live → absent |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| segment flip | thumb transform | 300 ms soft | jump |
| press | scale .97 | 220 ms | none |
| badge first paint | fade + zoom-in-95 | 200 ms | instant |

**Tokens:** `panel`, `panel-border`, `card`, `ink`, `muted`,
`warn-tint(-text)` for the badge. Badge must NOT reuse `pos`/`neg`/asset hues.
**Layout:** badge radius 999, ~10 px uppercase, sits inside the logo block
without pushing the nav down at 136 px sidebar width.
**Acceptance:**
- [ ] Flip writes `dataset` top-level into `kubushka-settings` state, then reloads (D11 head-script contract).
- [ ] Badge visible on every route while in demo; absent in live.
- [ ] Demo default on first run.

## S6 — Typed-name destructive confirm dialog (erase / reset)

**Purpose/parent/refs:** The only path to `clearAll` — a modal that requires
typing the dataset name and always offers a one-click backup first (standing
integrity invariant). Parent: buttons in Settings→Data (S2). No design-file
precedent for dialogs — the extension defines the app's dialog idiom (card
radius 24, dimmed overlay); danger-zone final look iterates in the Phase 4
brief.

**Content inventory (EN):**
- Erase variant — title: `Erase live data?`; body:
  `This permanently deletes every asset, snapshot and transaction in the live dataset. This cannot be undone.`
  Input label: `Type live to confirm`; destructive button: `Erase live data`.
- Reset variant — title: `Reset demo data?`; body:
  `This replaces everything in the demo dataset with the built-in reference portfolio. Any changes you made in demo mode are lost.`
  Input label: `Type demo to confirm`; destructive button: `Reset demo data`.
- Shared: secondary CTA `Download backup first` (outline, triggers the S7
  download without closing the dialog; label flips to `Backup downloaded ✓`
  muted after success); `Cancel` (ghost).
- Success toasts: `Live data erased` / `Demo data reset`.

**State matrix:**

| State | Treatment |
|---|---|
| default | destructive button DISABLED (opacity .5) until input === dataset name (case-insensitive, trimmed) |
| hover | destructive (armed): darken via opacity; outline/ghost per existing button variants |
| focus | ring; input auto-focused on open |
| disabled | destructive while unarmed or mutation pending |
| loading | destructive shows pending state (disabled) during clear |
| error | clear failure → toast `Could not complete — nothing was deleted.`; dialog stays open |
| empty | input empty = unarmed (no error styling — arming is progressive) |
| stale | n/a |
| demo-disabled | Erase variant never rendered in demo; Reset never rendered in live |
| armed | typed match → destructive button enables: bg `neg`, text `card` |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| dialog open | overlay fade + panel fade/zoom-in-95 | 300 ms soft | instant |
| dialog close | symmetric exit | 220 ms | instant |
| arm (match reached) | button bg/opacity | 220 ms soft | instant |
| backup CTA success | label crossfade | 220 ms | instant |
| press | scale .97 | 220 ms | none |

**Tokens:** overlay from `ink` at low alpha (token-derived, no raw rgba
hex), `card`, `neg` (destructive bg) + `card` text, `hairline`, `label`,
`muted`.
**Layout:** dialog card radius 24, max-w ~420 px, fits 360 px with margins;
buttons stack on narrow widths.
**Acceptance:**
- [ ] Destructive action impossible without the exact typed name.
- [ ] `Download backup first` present and functional in BOTH variants.
- [ ] Erase = `clearAll({reseed:false})` → still empty after reload; Reset reseeds demo.
- [ ] Focus trapped in dialog; Esc cancels.

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

## S9b — Yield table: Total return + XIRR columns

**Purpose/parent/refs:** Parent: Yield table card, design lines 303–339
(column + footnote anatomy). Existing columns stay byte-identical.

**Content inventory (EN):**
- New headers after `Annualized`: `Total return` · `XIRR (ann.)`
  (the `(ann.)` clarity label shows while portfolio history < 1 year; after a
  full year the header is plain `XIRR`).
- Cells: `totalReturnPct` / `xirr` per asset via `fmtPct`; null → `—`.
- Footnote extended (after the existing annualized sentence):
  `Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized — with under a year of history, treat it as an extrapolation.`
- Demo illustration (audit-pinned example, real …6475 shape): capital gain
  −2.6% can coexist with total return +5.30% — the two columns may disagree
  by design.

**State matrix:**

| State | Treatment |
|---|---|
| default | two extra right-aligned columns; table min-width grows, scrolls inside the card |
| hover | existing row hover |
| focus | n/a |
| disabled | n/a |
| loading | `—` cells |
| error | n/a |
| empty | existing empty state unchanged |
| stale | n/a |
| demo-disabled | n/a |
| null metric | `—` in `muted` (zero-denominator / non-converged xirr) |

**D7 motion:** row hover bg 150 ms; no new interactions; reduced-motion n/a.
**Tokens:** `pos`/`neg` for signed cells, `muted` for `—` and footnote.
**Layout:** widened min-width table inside `overflow-x-auto` card; page never
scrolls horizontally at 360 px.
**Acceptance:**
- [ ] Existing 6 columns and their demo values unchanged.
- [ ] `(ann.)` label logic tied to portfolio age < 365 days.
- [ ] Footnote copy exactly as pinned.

## S9c — Portfolio P&L column disambiguation

**Purpose/parent/refs:** Parent: Portfolio positions table, design lines
459–495. Relabel only — values stay the capital-gain family.

**Content inventory (EN):**
- Headers: `P&L, ₴` → `Capital gain, ₴`; `P&L, %` → `Capital gain, %`.
- New footnote under the table:
  `Capital gain = value − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen.`

**State matrix:** identical to the existing table (default/hover/loading/empty
per current implementation); no new states — mark all others n/a.
**D7 motion:** unchanged (row hover 150 ms).
**Tokens:** unchanged; footnote `muted`.
**Layout:** unchanged.
**Acceptance:**
- [ ] Every cell value identical to pre-P2 demo output; only header text + footnote added.

## S9d — Cash-reconciliation warning chip

**Purpose/parent/refs:** Surface `ledgerCashDrift` (D13: stored observed cash
vs `freeCashFromLedger`) as a caution chip. Parent: Overview `Free cash` KPI
card (lines 147–210); chip idiom: the "N of 4 filled" pill on Daily quotes
(lines 55–146).

**Content inventory (EN):**
- Chip: `Ledger drift <signed ₴amount>` (e.g. `Ledger drift −₴123.45`,
  U+2212).
- Tooltip/`title`: `Stored cash differs from the transaction ledger. Record a missing deposit or withdrawal, or correct the snapshot's cash.`

**State matrix:**

| State | Treatment |
|---|---|
| default (in drift) | pill bg `warn-tint`, text `warn-tint-text`, under the Free-cash sub line |
| hover | reveals tooltip (native `title` acceptable this phase) |
| focus | n/a (non-interactive) |
| disabled | n/a |
| loading | hidden until both queries resolve |
| error | n/a |
| empty | no snapshots → hidden |
| stale | n/a |
| demo-disabled | n/a — but demo drift is 0 by construction (`freeCashFromLedger(seed)` = 7.75 = stored cash), so the chip is naturally hidden on demo |
| hidden | \|drift\| ≤ ε (ε = 0.01 ₴) → not rendered |

**D7 motion:**

| Trigger | Property | Duration/easing | Reduced-motion |
|---|---|---|---|
| chip appears | fade + zoom-in-95 | 200 ms soft | instant |
| drift value changes | re-keyed by value: re-run entry animation | 150 ms | instant |

**Tokens:** `warn-tint`, `warn-tint-text` ONLY (never `neg` — drift is a
reconciliation nudge, not an error).
**Layout:** pill radius 999, fits inside the KPI card without growing it.
**Acceptance:**
- [ ] Chip absent on untouched demo; appears after recording e.g. an unmatched `withdrawal`.
- [ ] Threshold ε = 0.01; amount formatted `signedProse`.

## S10 — TransactionPanel type list: Withdrawal + Redemption

**Purpose/parent/refs:** Expose the P1 domain types (D13) in the Type select.
Parent: Transaction panel, design lines 110–146. The recent-row label map
already contains both.

**Content inventory (EN):**
- Type select options (pinned order): `Buy` · `Sell` · `Deposit` ·
  `Withdrawal` · `Dividend accrual` · `Interest payout` · `Reinvest` ·
  `Redemption` · `Tax`.
- Recent-row labels (existing, unchanged): `Withdrawal`, `Redemption`.

**State matrix:** inherits the existing Select in full
(default/hover/focus/disabled/loading n/a/error via form validation);
no new states — `Withdrawal` behaves like `Deposit` (portfolio-level,
assetId may be empty), `Redemption` targets an asset. demo-disabled: n/a.
**D7 motion:** existing Select open/close + press motion; no additions.
**Tokens:** unchanged.
**Layout:** unchanged (two more options in the dropdown).
**Acceptance:**
- [ ] Both options record via the existing schema/`recordTransaction` path.
- [ ] Recording a withdrawal reduces `netDeposits`/ledger cash (visible via S9d after drift).
- [ ] Demo seed contains neither type; no pinned figure moves.

---

## Phase-wide acceptance (the design session's definition of done)

- [ ] Every surface above has a corresponding region in a
      `design/extensions/*.dc.html` file, master-idiom inline styles, exact
      values literal.
- [ ] The three `--color-warn*` token values are defined once and used for
      every caution state (S4 Σ≠100, S5 badge, S9d chip).
- [ ] No pinned demo figure appears altered anywhere in the extension mock
      copy (use the D5 figures verbatim where shown).
- [ ] Every interactive element has all applicable states drawn or annotated;
      motion annotations may be comments in the markup.
