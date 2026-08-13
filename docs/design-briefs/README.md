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
| [`phase-5-appearance-language.md`](phase-5-appearance-language.md) | 5 — dark theme + Ukrainian | **drawn** — `design/extensions/appearance-language.dc.html` merged 2026-08-12 (`f486121`), amended the same day to the D56 radius rule. A9/A10 are no longer design-gated; the brief stays here until they ship. |
| [`phase-6-mobile.md`](phase-6-mobile.md) | 6 — the mobile shell | **written 2026-08-13, awaiting the design session** |

## Rules

- Amend a brief in place, with a dated note, while it is still here. Once its
  extension has merged, never amend — supersede with a new brief section.
- Figures in a brief illustrate; the app always derives them (D5).
- When a brief's phase ships, move the file to `../archive/design-briefs/` and
  add its row to that folder's table.
