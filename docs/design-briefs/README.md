# docs/design-briefs/ — Design-brief pipeline

Design briefs per decision G7 (`docs/NEXT-PHASE-PLAN.md`) and `docs/DECISIONS.md`
D14. Every new UI surface gets a brief BEFORE any implementation; the brief is
the contract between the planning/engineering sessions and a **separate Claude
design session** that extends the visual reference.

## The pipeline (G7 — pinned)

1. **Brief** — the last task of phase N writes `phase-N+1-<name>.md` here,
   covering EVERY new/changed UI surface of phase N+1 per the template below.
2. **Design session** — a separate Claude session consumes the brief plus
   `design/Investment Tracker.dc.html` and produces
   `design/extensions/<surface>.dc.html` — same inline-style `.dc.html` idiom
   as the master reference (every exact color/size/spacing literal in the
   markup). Original handoff files stay immutable (D14); extensions are the
   only files ever added under `design/`.
3. **Implementation** — a phase's UI tasks may not start before its extension
   reference is merged. Pure-logic tasks are never design-blocked.

## Brief template (pinned — every surface section follows it)

Each brief is one file per phase; inside it, one section per surface. A surface
section MUST contain all seven parts:

1. **Purpose + parent screen + reference line refs** — what the surface is for,
   which screen/route hosts it, and the exact line refs into
   `design/Investment Tracker.dc.html` (per the line map in `design/README.md`)
   for every existing pattern it extends or must match.
2. **Content inventory with exact EN copy** — every label, heading, placeholder,
   button caption, empty-state message, toast and error string, verbatim
   (EN; +UK from Phase 5). Copy in the brief is the copy in the app.
3. **Full state matrix** — a row for each of
   `default / hover / focus / disabled / loading / error / empty / stale /
   demo-disabled`, stating the visual treatment or explicitly `n/a — <why>`.
4. **D7 motion spec** — a table `trigger → property → duration/easing →
   reduced-motion fallback` for every interaction, within the standards of
   `docs/BUILD-PLAN.md` → "Motion & interaction standards" (soft curve
   `cubic-bezier(0.22,1,0.36,1)`, 220 ms default, hover may drop to 150 ms,
   reveals 300–400 ms, `active:scale-[.97]` on pressables; the global
   `prefers-reduced-motion` kill-switch is always the ultimate fallback).
5. **Token constraints** — which `src/index.css` `@theme` tokens the surface
   may use; no ad-hoc hex ever. If a genuinely new hue is required, the brief
   names the new token(s) and the extension + implementation add them to
   `@theme` (both themes from Phase 5).
6. **Layout constraints** — cards radius 20–24 px, pills/badges radius 999,
   inputs radius 10, sub-panels radius 16; the shell must hold at 360 px
   viewport width with no horizontal scroll; sidebar is 232 px (136 px below
   `sm`); wide content scrolls inside its own container.
7. **Acceptance checklist** — checkboxes the implementing task must satisfy,
   including the phase's data invariants (e.g. "no D5-pinned demo figure
   changes").

## Rules

- Briefs are inputs to design sessions — once the extension reference is
  merged, the **reference** wins visual disputes; the brief wins copy and
  behavior disputes.
- Figures shown in a brief are illustrations from the demo seed (D5) or the
  formula audit (`docs/FORMULA-AUDIT.md`) — the app always derives them.
- Keep one brief per phase; amend it in place (with a dated note) if scope
  shifts before the design session runs; never amend after the extension
  merged — supersede with a new brief section instead.
