# Phase 6 brief — the mobile shell

> **IMPLEMENTED 2026-08-17 as A17 — the decision of record is D66.** Every box
> below is ticked against a measurement on the rendered page, not against the
> markup. Three of them are ticked with a qualification, and each says so where it
> stands rather than here. Where the drawing's arithmetic did not hold, D66 records
> what was kept (the intent) and what was not (the number) — the date sheet's 312,
> and the "four of five" chart count.

**Written 2026-08-13.** Input to a separate Claude design session, which produces
`design/extensions/mobile.dc.html`. Until that extension merges, **no mobile UI
task may start** — G7. Pure-logic tasks are never design-blocked.

Template and pipeline: `../archive/design-briefs/README.md`. Every surface
section below carries all seven required parts.

Shape is governed by **D56** throughout (`README.md` §4). This brief adds no
exception to it; where a control's size changes, its radius is **recomputed
here** rather than inherited, and the arithmetic is shown.

---

## Owner decisions, taken 2026-08-13

They set the whole shape, and each one closes a question the measurement raised.

1. **Full parity, not a phone subset.** All ten routes are first-class on a
   phone. The four tables become cards; nothing is hidden behind "open this on
   a desktop".
2. **The sidebar hides and shows by a button — and the drawer IS the sidebar.**
   Not a second navigation with its own geometry. One `<aside>`, one set of
   radii, one composition, laid out two ways.
3. **The header carries the capital.** The sidebar holds the number the app is
   opened for; hiding the sidebar behind a button would hide that too. So the
   header bar is the sidebar's stand-in and shows `Total capital` + delta
   whenever the sidebar is not on screen.
4. **Touch targets grow by hit area, not by geometry.** Redrawing every control
   at 44 px would silently rewrite the radius system (see G-2). The drawn sizes
   stay; the *pressable region* is expanded invisibly. Two controls of the daily
   ritual are the deliberate exception.

---

## Measured baseline

Chromium via Playwright, viewport 360 × 740, demo dataset, 2026-08-13. Every
number below is read off the rendered page, not estimated.

| Measurement | Today | With the sidebar out of flow |
|---|---|---|
| `main` width | **209 px** of 360 | **336 px** |
| Usable width inside a card | **129 px** | **321–336 px** |
| Share of the viewport that is chrome | **42 %** | 0 % (header is vertical) |

| Defect found | Measurement |
|---|---|
| Table content vs. its window | Yield **824**, Balances **684**, Payouts **604**, Portfolio **464** px, inside **185 px** |
| Sidebar content vs. viewport height | **851 px** in **740 px** — the currency toggle is already below the fold |
| Touch targets under 44 px | **27** on `/`, **33** on `/settings`; nav pills **101 × 36** |
| Focusable fields under 16 px | **5 of 5** (13 px and 11 px) |
| Horizontal page overflow | `/attributes` **+27 px**; offending box right edge at **372** |
| `env(safe-area-inset-*)`, `dvh` | used **nowhere**; `<meta name=viewport>` has no `viewport-fit=cover` |
| Smallest rendered font | **10 px** (uppercase microlabels) |

**One suspected defect was measured and cleared.** The Seasonality axis carries
31 days; recharts thins it to **seven** ticks (1 · 5 · 10 · 15 · 20 · 25 · 31)
with **zero collisions** at a chart width of 277 px. Narrowing charts is not a
vulnerability of this design and no surface below compensates for one.

---

## The long sections are in `phase-6/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. No `S` number changed and nothing was summarised.

| File | Holds |
|---|---|
| [`phase-6/constraints.md`](phase-6/constraints.md) | Global constraints |
| [`phase-6/s1-s2.md`](phase-6/s1-s2.md) | S1 — The sidebar, collapsible · S2 — The header bar |
| [`phase-6/s3-s4.md`](phase-6/s3-s4.md) | S3 — The record card · S4 — Daily quotes on a phone |
| [`phase-6/s5-s6.md`](phase-6/s5-s6.md) | S5 — Overlays on a phone · S6 — Charts without a pointer |
| [`phase-6/vulnerability-register.md`](phase-6/vulnerability-register.md) | Vulnerability register |
| [`phase-6/s7-scroll-surface.md`](phase-6/s7-scroll-surface.md) | S7 · The scroll surface — supersedes S5's scrollbar (added 2026-08-17) |

## Acceptance for Phase 6

- [x] `design/extensions/mobile.dc.html` merged, covering S1–S6, in the master
      reference's idiom: `<x-dc>`, all styles inline, every colour/size/spacing
      literal in the markup, no runtime script.
- [x] Every surface drawn at **360 px** and at **768 px**, and the drawer drawn
      open **and** closed.
- [x] The keyboard-open state of `/` is drawn (S4).
- [x] `--color-scrim` minted in the file's header comment with its dark value
      and its re-derived separation ratio (G-7).
- [x] No radius contradicts D56; the two recomputed values (11) are shown with
      their arithmetic.
- [x] Every width claim checked against **Ukrainian** copy (G-5).
- [x] No D5-pinned demo figure changes.
- [x] The four F4 stale references corrected.
- [x] `navigation-map.md` gains the mobile shell's checkpoints when the phase
      implements.

## Deliberately out of scope

- **A native app, a PWA manifest, offline install.** Nothing here asks for one
  and the app is already local-first.
- **Icons for the nav.** A desktop collapse-to-icon-rail would need ten new
  icons; G-1 retires the rail instead, which needs none.
- **Gesture navigation** — swipe-to-open, swipe-between-routes. B7 says the edge
  gesture is already contested; adding more is not a mobile requirement.
- **Re-binning or re-labelling any chart.** The measurement says they fit (S6).
- **Dark theme and Ukrainian strings.** Phase 5 owns both (A9, A10). This brief
  only requires that mobile be *measured* in Ukrainian and that the one new
  token carry a dark value.

---
