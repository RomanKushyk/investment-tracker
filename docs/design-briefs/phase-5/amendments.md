# Phase 5 — the three amendments

> Moved **verbatim** from [`../phase-5-appearance-language.md`](../phase-5-appearance-language.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first** — a surface section is written under constraints stated there.

## Amendment, 2026-08-12 — the fonts had to change first

**Written after the design session, before its extension is treated as binding.**

The first draft of this brief made Ukrainian the default without checking that
the app could draw it. It cannot: measured from the installed packages,
`Spline Sans Mono` and `Space Grotesk` cover **1 of the 67 characters Ukrainian
needs**, and that one is the apostrophe. Every Cyrillic glyph would have come
from a system fallback — different face, different metrics, on the *default*
language. That is a phase blocker the brief created and the design session
caught.

Ten OFL-1.1 replacements were measured (advance width, x-height, cap-height,
coverage) rather than compared by description. The owner chose:

| Role | Was | Now | Why, measured |
|---|---|---|---|
| Body / tables | Spline Sans Mono (x 0.5455, cap 0.727, **0.6em** advance) | **JetBrains Mono** (x 0.550, cap 0.730, **0.6em**) | Nearest of the five on both vertical proportions — differs in the third decimal — and the advance is *identical*, so no table, column or sidebar width moves by a pixel |
| Display / headings | Space Grotesk (x 0.486, cap 0.700) | **IBM Plex Sans** (x 0.516, cap 0.698) | **Its figures are tabular by default.** Cap-height is near-exact; the deciding property is that a column of KPI figures aligns with no CSS to remember |

**The display choice changed once, and the reason is worth keeping.** Rubik was
picked first, on cap-height matching Space Grotesk exactly (0.700). Then the
figures were measured: Rubik's digits are **proportional** (spread 0.208 em) and
align only when a call site sets `font-variant-numeric: tabular-nums`. IBM Plex
Sans needs nothing — `111111` and `000000` render at the identical width
straight away, verified in a browser.

For an app whose every screen is a column of money, "aligned unless someone
forgets a CSS line" is a worse contract than "aligned". That is the whole
difference, and it outweighed the 0.002 em of cap-height Rubik won on.

**Consequences for the surfaces below.**

- **Every measurement in Surface 2's growth table still holds.** It was computed
  at the 0.6em monospace advance, which JetBrains Mono preserves exactly.
- **The x-height rises** — 0.5455 → 0.550 in body, 0.486 → 0.516 in headings.
  Text will read slightly larger at the same `font-size`. No size token changes;
  the design session should check that the tightest rows (KPI sub-lines, the
  11px chips) still breathe.
- **Space Grotesk's low x-height was part of its character** and no
  Cyrillic-capable candidate reproduces it — every one measured between 0.516
  and 0.569. The app's voice changes slightly. Accepted knowingly: the
  alternative was keeping a font that cannot write the default language.
  (Source Sans 3 matches the 0.486 exactly and is also tabular, but its
  cap-height is 0.660 — headings would visibly shrink, which is a larger change
  than the one being avoided.)
- Both are `@fontsource` packages, installed the same way as their predecessors,
  with every subset behind its own `unicode-range`.

Recorded as **D54**.

---

---

## Amendment, 2026-08-12 — shapes changed under this brief

Every control drawn for this phase was drawn as a capsule, because that is what
the app was when the brief was written. It no longer is: **D56** replaced every
`rounded-full` in `src/` with a radius system, and `design/extensions/appearance-language.dc.html`
has been amended to match (231 capsules rewritten, 23 segmented tracks made
concentric).

Nothing this brief *decides* changes — theme, language, the dark palette and the
formatting split are untouched. What changes is the shape vocabulary A9/A10 will
implement in:

- **Segmented controls** (the theme and language controls, Surfaces 1-2) are the
  case worth reading twice: the segment is proportional (28px → 7), the track is
  concentric (`7 + its padding` → 11). Do not give the track its own proportional
  value; the segment sits in the track's corner.
- Everything else: `round(min(w, h) × 0.26)` for standalone controls, the
  reference's own 16 / 20 / 24 for surfaces, and only four things stay round
  (logo circle, asset avatars, colour dots, the decorative blob).

Full statement in README §4 and D56.

## Amendment, 2026-08-17 — the light `muted` step is superseded (D68)

Surface 3's sheet tabulates **both** columns, and the LIGHT one it copied out of
the master reference was never measured against WCAG 1.4.3 — this brief only
ever asked for the dark half to be computed. It has since been measured, on the
rendered app: `muted` `#8b8a86` reads **2.88 : 1 on `panel`**, 3.17 on `page`
and 3.46 on `card`, and `label` `#6f6e6a` reads **4.25 on `panel`**. All of it
is 9.5–13 px body text at weight 400, so 4.5 : 1 is the bar and none of it is
anywhere near the large-text exemption.

**D68 supersedes two cells of that table and nothing else in this brief.**

- `muted` light becomes **`#696865`** — 4.64 / 5.11 / 5.57 on panel / page /
  card — re-derived against `panel`, the surface it was worst on, rather than
  against `card`.
- The **`label` row goes away entirely**: the token is deleted and its thirteen
  call sites read `text-muted`. It failed the same surface and only that one,
  and solving both against `panel` landed them on the same luminance.

**The DARK column of both rows stands, and was re-measured rather than
assumed** — 6.04 and 7.06 were right, and the sheet's whole dark half came
through a 228-element sweep with zero failures. What the deletion costs in dark
is one step of quiet: the thirteen former `label` sites now read 6.04 instead of
7.06, which is still comfortably past the bar.

The acceptance line "all 57 tokens defined in dark" is a **phase-5 count, not an
invariant**. It reads 59 today — D61 added `surface-edge`, phase 6 added `scrim`
and `drawer-edge`, D68 removed `label` — and the live arithmetic is recorded in
`src/index.css` beside the dark block, which is the one place that cannot drift
from it.

Surface 3's table is left exactly as drawn: a brief is superseded, never
rewritten, and D14 gives the merged extension the visual dispute. Read the light
`muted` value from README §4 and D68, never from Surface 3.

