# Section F — Phase 6, the mobile shell

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A16, A17. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section F — Phase 6, the mobile shell

## A16 — Design brief: mobile — **DONE 2026-08-13**

**Brief:** `docs/design-briefs/phase-6-mobile.md`. Six surfaces, each with the pinned seven parts. **The design session ran 2026-08-14** and `design/extensions/mobile.dc.html` is merged, so **G7 is open and A17 may start.**

**The four questions the brief delegated, answered in the extension's header:**
- **S4** — a **sticky action bar** below the breakpoint, not scroll-into-view. `Save snapshot` sits below all four rows, so scrolling the focused row clear never lifts it out from under the keyboard; the user would have to dismiss the keyboard to reach the control that ends the ritual.
- **S6** — **tap to pin**. On four of the five charts the per-point value lives only in a hover tooltip, and hover does not exist on touch. Seasonality is exempt: it already draws its values on the bars.
- **S5** — the **date picker stops anchoring** below the breakpoint and becomes a centred sheet. Seven columns at 312 px give 44.6 px cells without touching the drawn day box.
- **S5** — the **Dialog keeps its own overlay**. In light it and `--color-scrim` agree to within 5% of alpha; in dark they must not be unified, because the Dialog's overlay is `sidebar`-based precisely because it is an inverted plane in both themes (D57).

**And one finding the session could not have had before D57/D61 shipped.** `--color-scrim` works in light exactly as the brief computed (5.23:1, reproducing its ~5.2). In **dark** it cannot work at all: the drawer is *darker* than the page, so a darkening scrim moves the background toward it and the boundary falls to **1.02:1**. `--color-surface-edge` (D61) is not enough either at 1.50:1. The drawer takes a **`sidebar-muted` edge at 5.51:1** in dark, and none in light. Measured, not asserted.

**A scroll artifact was caught and specified out** — and what shipped is **not** what this paragraph originally specified, so the difference is kept rather than overwritten. The problem was real: the Dialog scrolled with `overflow-y-auto` on the panel, so the platform drew a full-height square-cornered track inside a `rounded-3xl` panel. The answer specified here was shadcn's proportions — a 10 px bar, 1 px padding, an 8 px thumb, radius `round(8 × 0.26)` = 2, thumb in `muted` for 3:1 on `card`. That was drawn and rejected on sight: at 8 px with a square cap it reads as a stick of furniture, and it draws no rail at all, so nothing says the region scrolls until you are already scrolling it. **Shipped instead (A18, D65):** a 12 px rail, `2+2+4+2+2`, thumb r1 and rail r5, margin 8 equal on all four sides, gutter `2m + 12` = 28 taken from the ScrollArea root's padding, `orientation="both"` wherever the content is not the caller's to predict, and dialogs rebuilt as three bands so only the middle one scrolls. The resting thumb is `faint`, below 3:1 deliberately — see D65 for why 1.4.11 does not bind here.

**Owner decisions taken 2026-08-13:** full parity (the four tables become cards, nothing is desktop-only); the sidebar hides and shows by a button and **the drawer IS the sidebar**, not a second navigation; the header bar carries `Total capital` whenever the sidebar is off screen; and touch targets grow by **hit area, not geometry**.

**The measurement is what set the shape.** At 360 × 740 the content column is **209 px** of 360 — 42 % of the viewport is permanent chrome — and a card inside it has **129 px**. Taking the sidebar out of flow gives **336 px**, a 61 % gain. The four tables measure 464–824 px inside a 185 px window; Balances is `3 + N assets` columns wide, so its overflow grows with the portfolio and horizontal scroll could never settle it.

**One suspected defect was measured and cleared, and no surface compensates for it:** recharts thins the 31-day Seasonality axis to seven ticks (1 · 5 · 10 · 15 · 20 · 25 · 31) with **zero collisions** at a 277 px chart.

**Thirty vulnerabilities are enumerated in six classes** (space, touch/input, platform, drawer state, legibility/language, design-system integrity), each marked measured / computed / closed-by-specification and pointed at the surface that answers it. The sharpest is **F1**: 44 px targets would move five radii and one concentric track, because D56 keys `r` to the short side — an accessibility fix that silently rewrites the design system. Hence the hit-area decision, with two named exceptions (quote input and `Button` md at 44, radius recomputed to 11).

**Also fixed here**, since each contradicted something already shipped: the brief template's part 6 (still demanding `radius 999` and a 232 px sidebar), the missing `appearance-language.dc.html` rows in `design/README.md` and `design/extensions/README.md`, and the stale "awaiting the design session" in this file and in `docs/design-briefs/README.md`. One stale reference is **left as flagged, not edited** — `src/components/ui/Tag.tsx`'s comment cites "radius 999px" while the code ships `rounded-[6px]`; this task changes no code.

## A17 — Mobile shell + record cards — **DONE 2026-08-17 (D66)** — `feat/mobile-shell`

> **Measured at the close, not eyeballed:** zero horizontal overflow on all ten
> routes at 360 × 740, in **both themes and both languages** — forty
> measurements. The A10 sweep left five routes over (attributes 133, settings 82,
> daily quotes 57, overview and payouts 5 each). No focusable field under 16 px.
> Every pressable 44 × 44 except the seven text fields, which stay at 36 because
> an `<input>` renders no pseudo-element and G-2's own table forbids growing the
> box. Drawer: route change, hardware Back, `Escape` with focus returned, 18 Tab
> stops with none escaping, scroll 600 → locked → 600, reduced motion instant.
> Console clean, `pnpm build` green, 624 tests green, no D5-pinned figure moved.

- [x] S1 — one `<aside>`, two shells, breakpoint `md`; the 136 px rail is retired along with every `max-sm:` override that served it. The drawer is a Radix `Dialog`, so focus trap / Escape / scroll lock / focus return come from a dependency the app already ships; hardware Back is one synthetic history entry, pushed by a HANDLER because StrictMode double-fires an effect.
- [x] S2 — header bar, reading `headlineKpis` through the new `useCapitalCard` (never a second derivation); no mark is drawn there, so the F3 fourth-copy risk does not arise.
- [x] S3 — the record card, lifted out of `/attributes` into `components/ui/RecordCard` and applied to Yield, Portfolio, Payouts and Balances. Column header text byte-identical; table markup retained at `≥ md`. Closes A3/E3 and A4.
- [x] S4 — `/` with the keyboard open: 44 px quote input at radius 11, ≥16 px fields, and a sticky action bar on the VISUAL viewport (D-a). The quote row folds to two lines below `md` — the single wrapping row is a desktop shape and clipped the value at 360.
- [x] S5 — the four overlays re-checked at 360 px; radii unchanged (24 / 16 / 14 / 13). The date picker stops anchoring and becomes a 328 px centred sheet (D-c); the drawing's 312 misses its own ">44 px cell" target once the sheet's own padding is counted.
- [x] S6 — tap-to-pin on the three charts whose value is hover-only; recharts' `accessibilityLayer` already gives the keyboard path, verified in both shells.
- [x] `viewport-fit=cover` + `env(safe-area-inset-*)`; `100dvh` replaces `100vh`; `overscroll-behavior-y: contain`.
- [x] `--color-scrim` added to `@theme` with its dark value in the same commit.
- [x] `navigation-map.md` gains the mobile checkpoints.

**Two findings worth carrying forward, both browser-only.** The `Scroller`'s
colours were wrong on an inverted plane — 10.98:1 and 7.08:1 against the 1.37 and
2.12 they were chosen for, a pre-existing D65 gap the drawer made unavoidable —
and the 244 px lockup cannot hold a fifth element in flow, so the collapse control
and the DEMO badge both float over a full-width plate. Both are in D66.

**Risk (as written, and it held):** the sweep is wide and touches every screen —
freeze other UI branches while it runs, the same rule A9/A10 carry, and do not run
it concurrently with the i18n sweep.

