# docs/design-briefs/ — briefs awaiting a design session

Live briefs only. A brief moves to `../archive/design-briefs/` once its phase
has shipped, so this folder answers one question: **what has been specified but
not yet drawn.**

The pipeline, the seven-part surface template and the rules are pinned in
[`../archive/design-briefs/README.md`](../archive/design-briefs/README.md) —
read that first; it governs this folder too. In short (G7, D14):

**brief → separate Claude design session → `design/extensions/<surface>.dc.html`
merged → implementation.** A phase's UI tasks may not start before its
extension reference is merged. Pure-logic tasks are never design-blocked.

| Brief | Phase | Status |
|---|---|---|
| [`phase-5-appearance-language.md`](phase-5-appearance-language.md) | 5 — dark theme + Ukrainian | **drawn** — `design/extensions/appearance-language.dc.html` merged 2026-08-12 (`f486121`), amended the same day to the D56 radius rule. **Amended again 2026-08-17 (D68):** Surface 3's LIGHT `muted` cell is superseded and its `label` row deleted — the light column was never measured against 1.4.3, and `design/extensions/muted-legibility.dc.html` is where the re-derivation lives. The dark column stands. A9/A10 are no longer design-gated; the brief stays here until they ship. |
| [`phase-6-mobile.md`](phase-6-mobile.md) | 6 — the mobile shell | **written 2026-08-13**; extension merged 2026-08-14. **§ S7 added 2026-08-17** supersedes S5's scrollbar → `design/extensions/scroll-surface.dc.html` (D65) |
| [`phase-7-where-things-live.md`](phase-7-where-things-live.md) | 7 — where things live | **DRAWN** — `design/extensions/where-things-live.dc.html` merged 2026-08-19, so Phase 7 UI is no longer design-blocked. Written 2026-08-18 (A22). Three idea-list lines that are one question — an edit mode on the analytics pages, the `Entry` group splitting `/` in two, and collapsible sidebar groups. **No Phase 7 UI task may start until `design/extensions/where-things-live.dc.html` merges.** |
| [`phase-8-period-and-analytics.md`](phase-8-period-and-analytics.md) | 8 — the period, and three screens | **written 2026-08-19 (A26)**; extension NOT drawn. Period selection as a cross-cutting concept, `/overview`'s time dimension, `/seasonality`'s month-of-year axis, a home for A25's portfolio XIRR, and the readability of all three — last, deliberately. **No Phase 8 UI task may start until `design/extensions/period-and-analytics.dc.html` merges**; its `core/` windowing helpers are pure logic and are not design-blocked. |
| [`asset-create-provider-first.md`](asset-create-provider-first.md) | — | **written 2026-08-19 (A23)**; extension NOT drawn. One flow, not a phase — provider-first asset creation. **Its central finding is that the request cannot be met uniformly:** the feed fills almost everything for a BOND and about half for a FUND, because `yieldType`, `expectedPct` and `payoutSchedule` are bonds-only. No UI from it may start until `design/extensions/asset-create.dc.html` merges. |
| [`screen-density-quotes-and-transactions.md`](screen-density-quotes-and-transactions.md) | — | **written 2026-08-20 (A34), rewritten the same day** after its own review returned fifteen findings, all of which held; extension NOT drawn. Now covers **`/` only**. Its most valuable content is a section that does not exist: `where-things-live.dc.html` § S4 has drawn `/transactions` as two columns since 2026-08-19 — form `flex:0 1 360px`, ledger `flex:1 1 560px` — and **A32 shipped a stacked single column instead**, which is the empty screen the owner reported. So A35 is not design-blocked, and the first draft had specified those columns REVERSED against a merged reference that wins visual disputes. On `/` the measured defect stands: a **440 px void, 52 % of the quote row**, between the asset's name and the field where its price is typed. **It also records an idea it killed** — a per-asset sparkline, withdrawn on 572 quotes showing 0,13–0,40 % weekly spread with zero down-days: accrual curves, not prices. No UI from S1 may start until `design/extensions/screen-density.dc.html` merges. |

## Rules

- Amend a brief in place, with a dated note, while it is still here. Once its
  extension has merged, never amend — supersede with a new brief section.
- Figures in a brief illustrate; the app always derives them (D5).
- When a brief's phase ships, move the file to `../archive/design-briefs/` and
  add its row to that folder's table.
