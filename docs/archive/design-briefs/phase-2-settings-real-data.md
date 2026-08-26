# Design brief — Phase 2: Settings home & the real-data era

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/plans/NEXT-PHASE-PLAN.md` Phase 2; formulas:
`docs/reference/FORMULA-AUDIT.md` + D13.

**Suggested extension files:** `settings.dc.html` (S1–S8),
`metrics-exposure.dc.html` (S9–S10). The design session may split differently;
one surface must never span two files.

## Global constraints (apply to every surface below)

- **Demo-figure invariant (binding):** every change is ADDITIVE — no D5-pinned
  demo figure may change (`docs/decisions/README.md` D5, `navigation-map.md`
  checkpoints: ₴149,016.36 total · +₴4,452.61/+3.08% · deposited ₴143,176 ·
  reinvested ₴1,387.38 · income ₴5,040.94 · top-up ₴11,429.49 · …6475
  annualized +10.9%). Relabeling a metric is allowed; changing its value is not.
- **Tokens** (`src/index.css` `@theme`) — the full existing vocabulary: `page`,
  `ink`, `card`, `muted`, `faint`, `hairline`, `panel`, `panel-border`,
  `label`, `sidebar`, `sidebar-text`, `sidebar-muted`, `sidebar-inset`,
  `sidebar-hover`, `sidebar-nav`, `pos`, `pos-tint`, `pos-tint-text`,
  `pos-on-dark`, `pos-border`, `neg`, the 4 asset hues (`reit`, `energy`,
  `ovdp8976`, `ovdp6475` + `-tint`/`-tint-text`) and `chart-*` aliases.
  **New tokens this phase mints — values chosen by the design session
  (2026-08-01, `design/extensions/settings.dc.html` header comment):**
  `--color-warn: #8f6b33` · `--color-warn-tint: #f0e6cb` ·
  `--color-warn-tint-text: #6b5527` — a warm muted amber (~hue 38°) family
  for caution states (Σ≠100, ledger drift, DEMO badge, stale), visually
  distinct from the `energy` asset hue and from `neg`; contrast warn on
  card ≈ 4.9:1 / on page ≈ 4.5:1, warn-tint-text on warn-tint ≈ 5.7:1.
  Implementers copy these exact values into `src/index.css` `@theme`.
  No other new tokens; no ad-hoc hex anywhere.
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

## The surface sections

**Split 2026-08-26 (D95)** — the S-sections moved **verbatim** into [`phase-2/`](phase-2/) so no file exceeds 200 lines. Nothing was rewritten; this file keeps the constraints, the acceptance and the pointers.

| File | Holds |
|---|---|
| [`phase-2/s1-s3.md`](phase-2/s1-s3.md) | S1 nav pill · S2 `/settings` layout · S3 AssetForm |
| [`phase-2/s4-s6.md`](phase-2/s4-s6.md) | S4 targets editor · S5 dataset switch · S6 typed-name confirm |
| [`phase-2/s7-s9a.md`](phase-2/s7-s9a.md) | S7 Backup button · S8 editable usdRate · S9a Overview KPIs |
| [`phase-2/s9b-s10.md`](phase-2/s9b-s10.md) | S9b Yield columns · S9c P&L · S9d cash chip · S10 type list |

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

---

## Superseding sections (2026-08-02 — added after the extension merged)

Per the pipeline rule (`README.md` here): a brief is never amended in place
once its extension is merged — changes land as new sections, and the merged
extension is never reworked in place either. Two implementation-time pins
from the Phase 2 review:

### S6 — superseded erase body copy (D17 erase scope)

The Erase variant body is now (supersedes the S6 inventory above; DECISIONS
D17 pins the erase scope and that the dialog copy documents it):

`This permanently deletes every asset, snapshot and transaction in the live dataset. The unsaved quote draft is cleared too — settings are kept. This cannot be undone.`

The middle sentence is the addition. The extension's erase fragment
(`design/extensions/settings.dc.html`, erase dialog body) still shows the
original two-sentence copy — copy authority is the brief (D14), so this
section wins; the reference stays untouched.

### S2 — addendum: per-row Delete on the asset manager

The plan's Phase 2 verify line requires an in-app delete path ("delete last
live asset → NO reseed"), so each asset-manager row also renders a
neg-outline `Delete` pill (sm, same danger-trigger idiom as the S6 triggers)
after `Edit`. It opens a destructive confirm on the D17 AlertDialog idiom
(outside click inert, Esc cancels, focus trapped) WITHOUT typed-name arming —
that stays reserved for the whole-dataset erase/reset — showing the cascade
impact and the standing one-click backup CTA:

- Title: `Delete <asset name>?`
- Body: `This removes the asset and everything recorded for it — <N> transaction(s) and quotes on <M> day(s). This cannot be undone.`
- Secondary: `Download backup first` (flips to `Backup downloaded ✓`);
  ghost `Cancel`; destructive: `Delete asset`.
- Toasts: `Asset deleted` / `Could not complete — nothing was deleted.`
- Motion: the shared dialog idiom (open 300 ms, symmetric close 220 ms).

The extension's S2 rows predate this and draw only `Edit`; the Delete pill
follows the existing danger-trigger visuals rather than a new drawn
reference.
