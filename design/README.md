# design/ — Reference package

Read-only handoff artifacts. **Never edit the original handoff files** (the three listed below) — they are immutable. New design references are ADDED under `extensions/` (see below; decision D14).

## Files

| File | Role |
|------|------|
| `Investment Tracker.dc.html` | **The master visual reference.** Colors, typography, spacing, copy, layout are final — recreate faithfully. |
| `Tracker Options.dc.html` | Earlier explorations — consult ONLY when a detail is ambiguous in the master file. |
| `support.js` | Prototype runtime scaffolding — **ignore** (as are any `_ds/` references inside the HTML). |

## How to read `Investment Tracker.dc.html`

- Markup lives between `<x-dc>…</x-dc>` with **inline styles** — every exact color/size/spacing is literal in the markup.
- `{{ name }}` holes are filled by the `class Component` script at the bottom of the file (`renderVals()`, ~line 560 onward) — read it for the exact mock values (headline strings per currency mode, e.g. `sbCap`, `ovNet`) and the tab/currency interaction logic.
- `<sc-if value="{{showX}}">` wraps each of the tab panels.

### Line map

| Lines | Content |
|-------|---------|
| 1–54 | Shell + sidebar: logo, nav groups, currency toggle, Total capital card |
| 55–146 | Daily quotes: entry rows, actions, yield teaser, Transaction panel, Recent transactions |
| 147–210 | Overview: KPI grid, Assets card + share bar, Next payouts / Rebalance / Income cards |
| 211–241 | Balances: area chart + snapshot table (6 visible rows: 27.07 partial, then 25.07 → 21.07 — **no 26.07**) |
| 242–302 | Payouts: stacked bars + side cards + payout log |
| 303–339 | Yield: 4-line chart + per-asset table (annualized footnote: 365 days **from 03.02.2026** for all assets) |
| 340–409 | Attributes: 2×2 asset fact cards (exact names, codes, attribute values) |
| 410–458 | Seasonality: day-of-month bars + 3 insight cards |
| 459–495 | Portfolio: positions table + Total row + 3 highlight cards |
| 496–552 | Allocation: donut + legend, Current-vs-target pills, Rebalance plan |
| 553–end | Closing markup + `class Component` / `renderVals()` script (script tag ~558) — exact headline strings per currency mode |

## Extensions (`design/extensions/`)

New UI surfaces (post-v1) get their visual reference here — one `<surface>.dc.html` per brief scope, produced by a **separate Claude design session** from a brief in `docs/design-briefs/` (pipeline + brief template: `docs/design-briefs/README.md`; decision `docs/DECISIONS.md` D14).

- Extensions use the master reference's idiom: inline styles, every exact color/size/spacing literal in the markup, same `.dc.html` format.
- Once merged, an extension is as binding as the master file for its surfaces: the reference wins visual disputes; its brief wins copy/behavior disputes.
- A phase's UI tasks may not start before that phase's extension reference is merged (G7).
- Extension files are the ONLY additions ever made under `design/`; the three original handoff files stay immutable.

## Caveats

- **Opening the file directly in a browser:** layout/colors/typography render correctly (inline styles) and the bottom script makes tabs/toggle interactive — but elements using the `.btn`, `.input`, `.field`, `.table`, `.tag` classes are styled by a missing `_ds/**/styles.css` and render as browser defaults. Approximate those controls from README §4 shape rules (pill radius 999px, white input bg, tables 12.5px…) — don't pixel-match unstyled controls.
- **The mock data is internally inconsistent** (e.g. the payout log sums ₴176,00 higher than the "Income received ₴5,040.94" card). `docs/DECISIONS.md` D5 pins every resolution — check it before treating a mismatch as a bug or "fixing" seed data.
