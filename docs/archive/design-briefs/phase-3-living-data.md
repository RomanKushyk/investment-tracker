# Design brief — Phase 3: Living data (Inzhur fetch, fixed yield, reminders)

Consumed by a separate Claude design session (pipeline in `README.md` here).
Produces `design/extensions/*.dc.html` in the master reference's idiom
(`design/Investment Tracker.dc.html` — inline styles, exact values literal in
markup). Plan source: `docs/plans/NEXT-PHASE-PLAN.md` Phase 3 (+ G5 suggest-only
doctrine, key fact #1 Inzhur endpoint); metric semantics:
`docs/reference/FORMULA-AUDIT.md`; decisions D13, D16 (demo guard `useDataset()`).

**Suggested extension files:** `daily-quotes-live.dc.html` (S1–S5),
`reminders.dc.html` (S6), `automation.dc.html` (S7–S8). The design session
may split differently; one surface must never span two files.

## Global constraints (apply to every surface below)

- **Suggest, never silently write (G5 — binding):** fetched and accrued
  values land ONLY in the draft store or a prefilled, editable confirm UI;
  the user's Save/Confirm press is the sole write path. Nothing in this
  phase auto-records, auto-overwrites a user-typed value, or rewrites
  history. Every surface below is a *suggestion* surface — its visual
  language must always read as "proposed, not saved".
- **Demo-figure invariant (binding):** additive only — no D5-pinned demo
  figure changes (`docs/decisions/README.md` D5, `navigation-map.md` checkpoints:
  ₴149,016.36 total · +₴4,452.61/+3.08% · deposited ₴143,176 · income
  ₴5,040.94 · top-up ₴11,429.49 · …6475 annualized +10.9%).
- **Demo-mode doctrine (G4/D16):** network surfaces disable in the demo
  dataset — the Fetch-quotes button (S1) and the live Inzhur picker (S7)
  read `useDataset()` and degrade as specced per surface. Pure derivations
  stay ACTIVE in demo: accrual ghosts (S4), the coupon-due card (S5) and
  reminders (S6) run on local data and demo editing is allowed ("Reset demo
  data" is the escape hatch). Every surface states its `demo-disabled` row.
- **Tokens** (`src/index.css` `@theme`) — existing vocabulary: `page`,
  `ink`, `card`, `muted`, `faint`, `hairline`, `panel`, `panel-border`,
  `label`, sidebar family, `pos`, `pos-tint`, `pos-tint-text`,
  `pos-on-dark`, `pos-border`, `neg`, the P2-minted warn family
  (`--color-warn: #8f6b33` · `--color-warn-tint: #f0e6cb` ·
  `--color-warn-tint-text: #6b5527` — every stale/caution state in this
  phase reuses it), the 4 asset hues + `-tint`/`-tint-text`, `chart-*`
  aliases. **New tokens this phase mints — values chosen by the design
  session (2026-08-04, `design/extensions/reminders.dc.html` header
  comment):** `--color-neg-tint: #f0cec7` · `--color-neg-tint-text:
  #693f35` — a soft tint family of the existing `--color-neg` (#a8695a
  terracotta) for the OVERDUE reminder severity (S6) and nothing else.
  Hue matches the parent exactly (neg hsl 11.5°/31%/51%; tint
  hsl 10°/58%/86%; tint-text hsl 11.5°/33%/31%), which keeps it distinct
  from the `energy` asset tint (#efe4e0 — hsl 16°/32%/91%, far less
  saturated) and from `warn-tint` (#f0e6cb — hsl 44°/55%/87%, same weight
  band, 34° away in hue). Computed contrast: tint-text on tint **6.08:1**
  ✓, tint-text on card 8.89:1, tint-text on page 8.16:1 (raw `neg` on the
  tint is only 2.97:1 — banner text is ALWAYS tint-text). Implementers copy
  these exact values into `src/index.css` `@theme`. No other new tokens; no
  ad-hoc hex.
- **Layout:** cards radius 20–24 px; pills/badges/segments/chips radius
  999; inputs radius 10; nested sub-panels radius 16; sidebar 232 px
  (136 px below `sm`); the shell holds at 360 px with no page-level
  horizontal scroll.
- **Type:** `font-display` (Space Grotesk) for headings/buttons/KPI values;
  `font-body` (Spline Sans Mono) elsewhere; microlabels 10 px uppercase
  tracking .12em; body 13 px; row sublines 11 px.
- **Motion (D7):** defaults 220 ms `cubic-bezier(0.22,1,0.36,1)`; hover may
  drop to 150 ms; reveals 300–400 ms; every pressable gets
  `active:scale-[.97]`; `prefers-reduced-motion` collapses everything
  (global kill-switch) — listed per surface below.
- **Numbers/dates:** tables/inputs `68 702,10`; prose/KPIs `₴68,629.36`;
  dates `dd.MM.yyyy`; times `HH:MM` 24-hour; signed values use U+2212 (D8).
  Figures in this brief are illustrations (demo seed, the trimmed live
  fixture `src/core/inzhur/__fixtures__/assets-sample.json`, or the user's
  real dashboard capture: 6 164 × 11.1389 = 68 660.18 ₴) — the app always
  derives them.
- **Structured returns (D8):** all copy below is component-layer English;
  pure modules (`core/inzhur/parse`, `core/accrual`, `core/reminders`)
  return tokens/keys only.

---

## The surface sections

**Split 2026-08-26 (D95)** — the S-sections moved **verbatim** into [`phase-3/`](phase-3/) so no file exceeds 200 lines. Nothing was rewritten; this file keeps the constraints, the acceptance and the pointers.

| File | Holds |
|---|---|
| [`phase-3/s1-s2.md`](phase-3/s1-s2.md) | S1 fetch button · S2 provenance chips |
| [`phase-3/s3-s4.md`](phase-3/s3-s4.md) | S3 "Use fetched?" · S4 ghost suggested state |
| [`phase-3/s5-s6.md`](phase-3/s5-s6.md) | S5 coupon-due card · S6 ReminderStrip |
| [`phase-3/s7-s8.md`](phase-3/s7-s8.md) | S7 Inzhur ref picker · S8 Automation section |

## Phase-wide acceptance (the design session's definition of done)

- [ ] Every surface above has a corresponding region in a
      `design/extensions/*.dc.html` file, master-idiom inline styles, exact
      values literal; one surface never spans two files.
- [ ] The minted `--color-neg-tint`/`--color-neg-tint-text` values are
      defined once in an extension header comment, used ONLY for the
      overdue reminder severity, distinct from `energy-tint` and
      `warn-tint`, tint-text ≥ 4.5:1 on tint.
- [ ] The suggestion visual language is coherent and unmistakable across
      S3/S4/S5: dashed borders + ghost/muted values = proposed; solid +
      ink = user's; `pos-border`/`pos-tint` = valid/saved (never used for
      suggestions).
- [ ] The 5 fetch-button states, 3 provenance chips, 4 input states
      (empty/ghost/typed/valid) and 3 reminder severities are each drawn or
      annotated; motion annotations may be comments in the markup.
- [ ] Demo-disabled treatments drawn where specced (S1 button + DEMO tag,
      S7 manual fallback + note); demo-active surfaces (S4/S5/S6) shown
      identical to live.
- [ ] No D5-pinned demo figure appears altered anywhere in the extension
      mock copy; Inzhur illustrations use the fixture/dashboard figures
      (sellUAH 11.1389 · 6 164 units · 68 660,18 · coupon 78,40 · maturities
      24.03.2027 / 27.09.2028).
