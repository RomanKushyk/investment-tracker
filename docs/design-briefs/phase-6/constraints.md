# Phase 6 — global constraints

> Moved **verbatim** from [`../phase-6-mobile.md`](../phase-6-mobile.md) on 2026-08-26 (D95). The brief keeps its title, its owner decisions and its acceptance; only the long sections moved. **Read the brief first** — a surface section is written under constraints stated there.

## Global constraints

These bind every surface. A surface section may add to them, never relax them.

### G-1 — Two shells, one breakpoint

The app has exactly **two** layouts, and the switch is **`md` (768 px)**:

- **below 768** — mobile shell: the sidebar is out of flow, the header bar is
  present, content is full-bleed;
- **768 and above** — desktop shell: today's layout, unchanged, plus a collapse
  control.

**The 136 px rail is retired.** It exists only to avoid a drawer; with a drawer
it has no job, and keeping it would mean maintaining three geometries instead of
two. Every `max-sm:` override that serves the rail goes with it — the rail's own
radius (`rounded-r-[24px]` = 14 + 10) included.

Why 768 and not the current 640: the chrome costs 244 px of sidebar plus 72 px
of `main` padding, so content only reaches 360 px at a **676 px** viewport. At
`sm` the shell technically holds but leaves 324 px; at `md` it leaves 452 px.
768 is also iPad portrait, which lands on the desktop shell exactly.

### G-2 — Touch targets, and what they would have cost

Every interactive element gets a pressable region of at least **44 × 44 px**
below `md`, achieved by expanding the hit area — padding, or a pseudo-element
overlay — **without changing the drawn box**.

This is the decision that protects D56. Growing the boxes instead would move
every radius, because `r = round(min(w, h) × 0.26)` is keyed to the short side:

| Control | Drawn today | r today | If it grew to 44 | r would become |
|---|---|---|---|---|
| Nav pill | 36 | 9 | 44 | **11** |
| `Button` md | 40 | 10 | 44 | **11** |
| `Button` sm | 30 | 8 | 44 | **11** |
| Input / Date field | 36 | 9 | 44 | **11** |
| Currency segment | ~26 | 7 | 44 | **11**, and its track 7+6=13 → **17** |

Five radii and one concentric track, changed as a side effect of an
accessibility fix. That is how a design system stops being a system.

(Two rows of that table are then taken up deliberately as the exceptions below —
the quote input and `Button` size `md`. The table's point is the cost of doing
it to *everything*, not that no control may ever grow.)

WCAG
**2.5.8** (AA) asks 24 × 24 and today's 36 px controls already pass it; 44 × 44
is the platform guidance, and it is satisfiable without redrawing anything.

**The two deliberate exceptions** are the controls of the daily ritual, where a
bigger target is the *design*, not a concession:

| Control | Height below the breakpoint | Radius, recomputed |
|---|---|---|
| Quote input (`QuoteRow`) | 36 → **44** | `round(44 × 0.26)` = **11** |
| `Button` at size `md` | 40 → **44** | `round(44 × 0.26)` = **11** |

Read the second row precisely: it is the **size variant**, not two call sites.
`Button` size `md` renders 44 px below the breakpoint *everywhere it is used* —
it is the primary-action size, and there is no instance of it for which 44 px is
wrong. Giving two individual buttons a different height from their own size
variant would mean a third size that exists only on two screens.

Sizes `header` (36) and `sm` (30) do **not** change: `header` is 36 precisely
so it sits beside the 36 px Date field (`README.md` §4), and moving one without
the other would break that pairing. Both reach 44 px by hit area.

No other control changes size, so no other radius moves.

> Naming collision, to read this brief safely: `md` is both a Tailwind
> breakpoint (768 px) and a `Button` size (40 px). This document says
> "the breakpoint" or "size `md`" and never bare `md` for either.

### G-3 — Viewport and platform

- `<meta name="viewport">` gains **`viewport-fit=cover`**. Without it every
  `env(safe-area-inset-*)` resolves to `0` and the insets below do nothing —
  the two are only useful together.
- Any full-height box uses **`100dvh`**, never `100vh`. The sidebar is
  `h-screen` today; on iOS Safari that extends under the dynamic toolbar and
  buries the bottom of the drawer — which is exactly where the currency toggle
  lives.
- The drawer and the header respect `env(safe-area-inset-left/right/top/bottom)`.
- The scroll container sets **`overscroll-behavior-y: contain`** so pull-to-
  refresh cannot discard an unsaved quote draft on an overscroll.

### G-4 — Fields are 16 px below `md`

Every focusable text or number field renders at **≥ 16 px** below `md`. Under
that, iOS Safari zooms the page on focus and does not zoom back out — on the
one screen the user touches daily.

**This changes no radius.** Heights are explicit (`h-9` = 36, and 44 for the
quote input per G-2), so a larger font sets type inside an unchanged box.
Field radii stay at 9, and 11 for the quote input.

### G-5 — Measured in Ukrainian

Ukrainian is the default language (Phase 5). Every width claim in the extension
must be checked against **Ukrainian** copy, not English — a mobile layout built
on English widths gets rebuilt when A10 lands.

Body/table type is `JetBrains Mono` at a **0.6 em advance**, so a string's width
is `characters × 0.6 × font-size` and can be computed rather than guessed. Worked
example: `Щоденні котирування` at 13.5 px is `19 × 0.6 × 13.5` = **153.9 px**,
which fits the 280 px drawer's 220 px text box with 66 px to spare.

Display type (`IBM Plex Sans`) is proportional — measure it, do not compute it.

### G-6 — Motion (D7)

Standards in `docs/archive/BUILD-PLAN.md` → "Motion & interaction standards".
Soft curve `cubic-bezier(0.22, 1, 0.36, 1)`, 220 ms default, `active:scale-[.97]`
on pressables, and the global `prefers-reduced-motion` kill-switch as the
ultimate fallback for every entry in every surface's motion table.

### G-7 — Tokens

No surface may introduce an ad-hoc hex. Phase 6 mints **exactly one** token:

| Token | Value | Why it is new |
|---|---|---|
| `--color-scrim` | `rgba(38, 38, 42, .45)` | Nothing in the palette is a translucent veil. It is `ink` at 45 %, so it mints an alpha, not a hue. |

**Its separation is computed, not asserted.** Over the page (`#f6f5f3`) the
scrim composites to ≈ `#989899`; against the drawer's `sidebar` (`#26262a`) that
is **≈ 5.2 : 1**, well past the 3 : 1 WCAG 1.4.11 asks of a non-text boundary.
The design session must re-derive this if it moves the alpha — a dark drawer on
a dark scrim is the failure mode.

Phase 5 gives every token a dark value; `--color-scrim` needs one too, and the
design session states it.

---

