# Phase 6 brief — the mobile shell

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

## S1 — The sidebar, collapsible

### 1. Purpose, parent, references

The one navigation surface, laid out two ways. Hosts every route. Extends the
shell drawn at `design/Investment Tracker.dc.html` **lines 1–54** (logo lockup,
nav groups, currency toggle, Total capital card) and the composition pinned in
`README.md` §5.

### 2. Content inventory

No new navigation copy — the three groups and their eleven pills are unchanged.
New strings, EN canonical with the UK that A10's dictionary will carry:

| Where | EN | UK |
|---|---|---|
| Trigger, closed (`aria-label`) | `Open navigation` | `Відкрити навігацію` |
| Trigger, open (`aria-label`) | `Close navigation` | `Закрити навігацію` |
| Scrim (`aria-hidden`) | — | — |

### 3. State matrix

| State | Treatment |
|---|---|
| default (mobile) | Off-canvas, `translateX(-100%)`, `aria-hidden`, not focusable |
| default (desktop) | In flow, 244 px, exactly as today |
| open (mobile) | 280 px, `fixed`, over `--color-scrim`, focus trapped |
| hover | Pills keep `hover:opacity-85`; on touch this never fires and must not be the only affordance |
| focus | Ring is `sidebar-text` via `[data-dark-surface]` — the drawer keeps the attribute, so this is inherited, not re-specified |
| disabled | n/a — navigation is never disabled |
| loading | n/a — the drawer holds no async content; the capital figure lives in S2 |
| error | n/a — same reason |
| empty | n/a — the nav list is static |
| stale | n/a |
| demo-disabled | n/a — the DEMO badge is a sidebar ornament, unchanged; it must not move to the header |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Open | `transform` −100 % → 0 | 260 ms `ease-soft` | instant, no transform |
| Close | `transform` 0 → −100 % | 220 ms `ease-soft` | instant |
| Scrim in / out | `opacity` 0 ↔ 1 | 220 ms | instant |
| Trigger press | `scale(.97)` | 150 ms | none |
| Desktop collapse | `width` 244 → 0 | 260 ms `ease-soft` | instant |

### 5. Tokens

`sidebar`, `sidebar-text`, `sidebar-muted`, `sidebar-inset`, `sidebar-hover`,
`sidebar-nav`, `pos-on-dark`, `warn-tint`/`warn-tint-text` (DEMO badge), and the
new `--color-scrim`. Nothing else.

### 6. Layout

- Drawer **280 px**; content behind it is untouched at **336 px**.
- Radii are unchanged and stay **concentric**: lockup plate 14, sidebar padding
  16, shell `rounded-r-[30px]` (14 + 16 = 30). The left edge is off-screen, so
  only the right corners are drawn — the same `rounded-r-*` the sidebar uses
  today.
- Height **`100dvh`** (G-3), not `h-screen`.
- **The bottom cluster is pinned inside the drawer**, not pushed by `mt-auto`
  into a scroll region. Measured: sidebar content is 851 px in a 740 px
  viewport, so `mt-auto` puts the currency toggle below the fold *today*.
- **The Total capital card is absent below `md`** — it is the header (S2), and
  drawing it twice would be two truths about one number. At `≥ md` it stays
  exactly where the master reference puts it.
- Desktop collapse trigger sits at the sidebar's **top-right**, inside the
  sidebar's own 16 px padding and **outside** the lockup plate — the plate's
  14 px radius is the fixed inner term of the concentric chain and must not be
  disturbed by adding a control to it.

### 7. Acceptance

- [ ] One `<aside>` component serves both shells; no second nav tree exists.
- [ ] `rounded-r-[30px]` and the 14 px plate are byte-identical to today.
- [ ] The currency toggle is reachable without scrolling the drawer, at 740 px
      and at 640 px of viewport height.
- [ ] `Escape` closes; focus returns to the trigger.
- [ ] Focus is trapped while open and the background is `inert`.
- [ ] A route change closes the drawer.
- [ ] The hardware Back button closes the drawer instead of leaving the route.
- [ ] Body scroll is locked while open and the scroll position is restored on
      close.
- [ ] `aria-expanded` and `aria-controls` on the trigger; `aria-current` on the
      active pill is unchanged.
- [ ] No D5-pinned demo figure changes.

---

## S2 — The header bar

### 1. Purpose, parent, references

The sidebar's stand-in: it exists whenever the sidebar is not on screen, and
carries the number the sidebar would have shown. Extends the Total capital card
at `design/Investment Tracker.dc.html` **lines 1–54** (label, 21 px value,
`pos-on-dark` delta line) and the currency behaviour in `README.md` §7.

### 2. Content inventory

| Slot | EN | UK | Note |
|---|---|---|---|
| Trigger | icon only | — | `aria-label` per S1 |
| Value | `₴149,008` | same | `fmtProseWhole`, currency-aware, unchanged rules |
| Delta | `+3.08% · $3,324.03` | same | `fmtPct` + counter-currency, exactly as the sidebar card |
| Screen-reader label | `Total capital` | `Загальний капітал` | Existing sidebar copy, reused verbatim |

**No screen title in the header.** Every route already renders an `h2` plus a
subtitle (`ScreenHeader`); putting the title in the bar too would say it twice.

### 3. State matrix

| State | Treatment |
|---|---|
| default | Trigger, value, delta on `page` background |
| hover | Trigger only, `opacity .85` |
| focus | Ink ring, 2 px, offset 2 — the header is a **light** surface, so `[data-dark-surface]` deliberately does **not** apply |
| disabled | n/a |
| loading | Value renders `—`, same fallback the sidebar card uses when KPIs are absent |
| error | n/a — the figure is derived locally and cannot fail independently |
| empty | `—` for value and delta, per the existing `useCapitalCard` contract |
| stale | n/a |
| demo-disabled | n/a — DEMO stays a sidebar ornament (S1) |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Value changes (incl. currency toggle) | tweened number | ~300 ms, existing `useTweenedNumber` | jump to final value |
| Trigger press | `scale(.97)` | 150 ms | none |
| Header appears on desktop collapse | `opacity` + 4 px rise | 220 ms `ease-soft` | instant |

### 5. Tokens

`page`, `ink`, `muted`, `pos`, `neg`, `hairline` (bottom edge). The header is a
**light** surface: it must not reuse the `sidebar-*` family, which would make it
read as a detached piece of the drawer.

### 6. Layout

- Height **≥ 56 px** plus `env(safe-area-inset-top)`; sticky at `top: 0`.
- Trigger is left, value and delta follow; the trigger's pressable region is
  44 × 44 with its drawn icon box smaller (G-2).
- **Square corners, and no proportional radius.** The proportional rule is for a
  standalone control, keyed to a *designed* short side. This bar's short side is
  its height and its long side runs edge to edge, so `0.26 × 56` = 15 would be a
  radius derived from a layout dimension — the same objection `README.md` §4
  raises against applying the rule to a full-height panel, in the other axis.
  A full-bleed bar has square corners; its bottom edge is a `hairline`, not a
  curve.
- Below `md` it is always present. At `≥ md` it is absent while the sidebar is
  open and appears only when the sidebar is collapsed.
- On the currency toggle the value must change here; the toggle itself stays in
  the drawer (S1) because it is a rarely-touched display preference, while this
  number is glanced at constantly.

### 7. Acceptance

- [ ] The header reads its figure from `core/derive.headlineKpis` — the same
      selector as the sidebar, never a second derivation.
- [ ] Currency toggle updates the header value and delta, and the toggle remains
      the app's only currency control (§9 behaviour checklist).
- [ ] Contrast of value and delta on `page` measured, not assumed.
- [ ] The logo mark, if drawn here at all, **reuses the `Mark` component**. It
      must not become a fourth copy — the mark lives in `Sidebar.tsx`,
      `public/favicon.svg` and `public/apple-touch-icon.png`, and
      `src/app/mark.test.ts` pins only the first two.
- [ ] Safe-area top inset respected on a notched device.

---

## S3 — The record card

### 1. Purpose, parent, references

The single answer to all four tables. Hosts `/yield`, `/portfolio`, `/payouts`,
`/balances` below `md`. References: Yield **303–339**, Portfolio **459–495**,
Payouts **242–302**, Balances **211–241** — and, for the anatomy itself,
Attributes **340–409**.

**This surface invents nothing.** The record card *is* the Attributes asset
card: `Card radius={24}`, `p-[22px]`, a header row of `AssetAvatar` + `h3`
(17 px) + `Tag` pushed right, then `<dl class="grid grid-cols-2 gap-x-4.5
gap-y-2.5">` of `Fact` pairs (`dt` 10.5 px uppercase `muted`, `dd` 12.5 px bold).
A table row becomes a card whose **header is the row's identity** and whose
**body is a `dl` of the remaining columns**.

### 2. Content inventory

Every column header becomes a `dt`, **verbatim** — no re-wording, no
abbreviation. The units stay in the term where the table puts them.

| Screen | Card header | `dt` terms, in table order |
|---|---|---|
| Yield | avatar + asset name | `Invested, ₴` · `Value now, ₴` · `Δ total` · `Annualized` · `Total return` · `XIRR` · `vs expected` |
| Portfolio | avatar + name + yield-type `Tag` | `Invested, ₴` · `of it reinvested` · `Value now, ₴` · `Capital gain, ₴` · `Capital gain, %` · `Share` |
| Payouts | date + asset, type as `Tag` | `Amount, ₴` · `Destination` |
| Balances | snapshot date | one term per asset, then `Cash` · `Total, ₴` |

Portfolio's bolded **Total** row becomes a final card in the same list, with no
avatar and the existing total copy.

### 3. State matrix

| State | Treatment |
|---|---|
| default | As above |
| hover | n/a — a record card is not pressable |
| focus | n/a — no focusable child unless a screen already had one |
| disabled | n/a |
| loading | Existing screen-level loading is unchanged |
| error | n/a |
| empty | The existing `EmptyState` per screen, unchanged — the card list renders nothing of its own |
| stale | Balances only: today's partial row keeps `pending` in `faint` and `—` for the total, exactly as the table does |
| demo-disabled | n/a |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| List reveal | `fade-in`, staggered `60 ms × (i mod 4)` | 300 ms | no stagger, no fade |
| Layout swap at the breakpoint | none — a resize must not animate | — | — |

The stagger value is the one Attributes already uses; reuse it rather than mint
a second cadence.

### 5. Tokens

`card`, `ink`, `muted`, `faint`, `hairline`, `pos`, `neg`, and the four asset
tint families via `AssetAvatar` / `Tag`. No new token.

### 6. Layout

- One column below `md`; the existing grid at `≥ md`. `/attributes` already
  ships `max-md:grid-cols-1` — the same rule, the same breakpoint.
- Radius **24**, matching the Attributes card. It is a surface, so the
  proportional rule does not apply.
- **Balances is the reason this cannot be solved by scrolling.** Its width is
  `3 + N assets` columns and therefore grows with the portfolio: a horizontal
  scroll fixed at 684 px today is a different number next year. The card form
  is width-independent.
- The `<table>` markup is retained at `≥ md`. The two forms render the same
  derived values from the same selector; neither re-computes.

### 7. Acceptance

- [ ] No new component vocabulary — the card is `Card` + `AssetAvatar` + `Tag`
      + `dl`/`Fact` as `/attributes` uses them.
- [ ] Column header text is byte-identical between table and card.
- [ ] Number formatting is unchanged: tables and cards both use `68 702,10`
      (space thousands, comma decimals) per `README.md` §8. The card is not
      prose and must not switch to `₴68,702.10`.
- [ ] Balances' partial-row `pending` treatment survives the transformation.
- [ ] Portfolio's Total row is present and still bolded.
- [ ] Zero horizontal overflow at 360 px on all four routes.
- [ ] No D5-pinned demo figure changes.

---

## S4 — Daily quotes on a phone

### 1. Purpose, parent, references

The daily ritual, and the reason the app exists. `/`. References **55–146**, plus
the P3 extension `design/extensions/daily-quotes-live.dc.html` for the fetch
button, provenance chips and suggestion language, all of which stay binding.

### 2. Content inventory

No new copy. Every label, the `1 of 4 filled` pill, `Save snapshot`,
`Copy yesterday`, `Last saved …`, the yield teaser and the Transaction panel are
unchanged.

### 3. State matrix

| State | Treatment |
|---|---|
| default | Quote rows stacked full width; Transaction panel below them |
| hover | n/a on touch — no affordance may be hover-only |
| focus | Ink ring; the focused row must be scrolled clear of the keyboard |
| disabled | Unchanged (demo gating, fetch states) — see the P3 extension |
| loading | Unchanged |
| error | Unchanged; validation stays `neg` text on `card`, never a tint block (D25) |
| empty | Unchanged `EmptyState` |
| stale | Unchanged provenance chips |
| demo-disabled | Unchanged |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Delta chip appears on input | `fade-in` + `zoom-in-95` | 150 ms | instant |
| Row reveal | existing `fade-in slide-in-from-top-1` | 300 ms | instant |
| Save press | `scale(.97)` | 150 ms | none |

### 5. Tokens

Unchanged from the shipped screen.

### 6. Layout

- The two columns stack. **Quotes first, Transaction panel second** — the flex
  order already does this and must be preserved; the ritual outranks the
  occasional entry.
- Quote input: **44 px** tall, radius **11**, font **≥ 16 px** (G-2, G-4). The
  row's avatar is 48 px, which stays within the 60–70 % block rule
  (`README.md` §4) as long as the row's height does not shrink.
- **The actions must not be buried by the keyboard.** With a field focused the
  virtual keyboard covers roughly the lower half of the viewport; `Save snapshot`
  sits below the four rows. The design session decides between a sticky action
  bar below `md` and scrolling the focused row into a clear region — but the
  extension must draw the keyboard-open state explicitly, because it is the
  state this screen is in whenever it is being used.
- `inputMode="decimal"` stays. The decimal separator the keyboard offers follows
  the device locale and cannot be forced; the field must accept **both** `,`
  and `.` on input. State this in the drawing's annotation.

### 7. Acceptance

- [ ] The keyboard-open state is drawn, not left to implementation.
- [ ] `Save snapshot` and `Copy yesterday` are reachable with a field focused.
- [ ] Typing still updates the delta chip and the `N of 4 filled` pill live
      (§9 behaviour checklist).
- [ ] No iOS zoom on focus at any field on the route.
- [ ] The Transaction panel's `+ New asset…` sub-form fits 336 px with no
      horizontal scroll.
- [ ] No D5-pinned demo figure changes.

---

## S5 — Overlays on a phone

### 1. Purpose, parent, references

Every floating surface, re-checked at 360 px: `Dialog`, `Select` popover,
`DatePicker` popover, `sonner` toasts. References: the overlay rules in
`README.md` §4, `design/extensions/import-dialog.dc.html` (the widest dialog in
the app) and `design/extensions/settings.dc.html`.

### 2. Content inventory

No new copy.

### 3. State matrix

| State | Treatment |
|---|---|
| default | Each overlay keeps its shipped anatomy and radius |
| hover | n/a on touch |
| focus | Existing rings; Radix focus management unchanged |
| disabled | Unchanged |
| loading | Unchanged (`Replacing…` in the import dialog) |
| error | Unchanged |
| empty | Unchanged |
| stale | n/a |
| demo-disabled | Unchanged |

### 4. Motion (D7)

Unchanged from the shipped overlays: `fade-in` + `zoom-in-95`, 200–300 ms.

### 5. Tokens

Unchanged. `--color-scrim` is S1's; the `Dialog` keeps its own overlay treatment
unless the design session finds the two visibly disagree, in which case it says
so and picks one.

### 6. Layout

- **`Dialog`** is `w-[calc(100vw-32px)]` with `max-h-[85vh]`. `85vh` is wrong
  once the keyboard is open — it is 85 % of the *viewport*, not of what remains
  visible. Below `md` this becomes a `dvh`-based bound.
- **`Select` popover** keeps radius **14** — concentric, items 9 + 5 inset. Its
  width must be re-checked at 336 px of content.
- **`DatePicker` popover** keeps radius **16** and needs the most care: a seven-
  column month grid anchored to a right-aligned field is the likeliest overlay
  to leave the viewport at 360 px. Collision handling must be drawn.
- **Toasts** keep radius **13** and their `toastOptions` inline overrides —
  `sonner` styles by attribute and ignores classes, so this is the only lever
  (`README.md` §4). Below `md` their position must not sit under the sticky
  header or the safe-area inset.
- Every overlay respects `env(safe-area-inset-*)`.

### 7. Acceptance

- [ ] Each of the four overlays drawn at 360 px, inside the viewport, with no
      clipped corner or off-screen edge.
- [ ] The date-picker popover's collision behaviour is explicit.
- [ ] Toasts do not overlap the header bar.
- [ ] Dialog height is correct with the keyboard open.
- [ ] Radii unchanged: 24 dialog, 16 date picker, 14 select, 13 toast.

---

## S6 — Charts without a pointer

### 1. Purpose, parent, references

The five charts on a touch device. References: Balances **211–241**, Payouts
**242–302**, Yield **303–339**, Seasonality **410–458**, Allocation **496–552**.

### 2. Content inventory

No new copy. Existing value labels, dot legends and footnotes are unchanged.

### 3. State matrix

| State | Treatment |
|---|---|
| default | Chart with its existing labels |
| hover | **Does not exist on touch** — this is the whole surface |
| focus | Chart is not focusable today; if a tap target is added it takes the standard ink ring |
| disabled | n/a |
| loading | Unchanged |
| error | n/a |
| empty | Existing `EmptyState` |
| stale | n/a |
| demo-disabled | n/a |

### 4. Motion (D7)

| Trigger | Property | Duration / easing | Reduced motion |
|---|---|---|---|
| Tooltip appear | `fade-in` | 150 ms | instant |
| Series reveal | existing chart animation | unchanged | disabled |

### 5. Tokens

`--color-chart-*` only, per `src/core/colors.ts`. `CHART_TOOLTIP` keeps radius
**16** — a floating surface takes the surface value.

### 6. Layout

- Chart widths are **not** a problem and no surface may add compensation for
  one: measured, recharts thins the 31-day Seasonality axis to seven ticks with
  zero collisions at 277 px.
- **The real defect is the pointer.** Every chart's per-point value is reachable
  only by hovering. On a phone there is no hover, so those values are
  unreachable. The design session decides between a tap-to-pin tooltip and
  making the on-chart labels sufficient, and draws the chosen state.
- The Allocation donut is `max-w-[220px]` and already fits.

### 7. Acceptance

- [ ] Every value a desktop user can obtain by hovering is obtainable on a phone.
- [ ] The chosen mechanism is drawn, in its resting and active states.
- [ ] No chart is narrowed, re-binned or re-labelled to fit — the measurement
      says it does not need to be.

---

## Vulnerability register

Enumerated first as classes, then measured against the app. `[M]` measured in a
browser · `[C]` computed from source · `[S]` a risk this brief closes by
specification. "Surface" is where the answer lives.

### A — Space

| # | Vulnerability | Evidence | Surface |
|---|---|---|---|
| A1 | Permanent chrome takes 42 % of the width | `[M]` 209 of 360 | S1 |
| A2 | Four tables 464–824 px inside a 185 px window | `[M]` | S3 |
| A3 | `/attributes` overflows by 27 px — an `ml-auto` tag cannot share a row with a long asset name | `[M]` right edge 372; FOLLOW-UPS 10 | S3 |
| A4 | Overview asset rows carry fixed `w-[110px]` + `w-[60px]` columns | `[C]` FOLLOW-UPS 11 | S3 |
| A5 | Landscape leaves ~360 px of height against a 56 px header and a keyboard | `[S]` | S2, S4 |

### B — Touch and input

| # | Vulnerability | Evidence | Surface |
|---|---|---|---|
| B1 | 27 targets under 44 px on `/`, 33 on `/settings`; nav pills 101 × 36 | `[M]` | G-2 |
| B2 | All five focusable fields are under 16 px, so iOS Safari zooms on focus and does not restore | `[M]` 13 px, 11 px | G-4 |
| B3 | Chart values are reachable only by hovering | `[S]` | S6 |
| B4 | The virtual keyboard covers the quote input and `Save snapshot` together | `[S]` | S4 |
| B5 | The decimal separator follows the device locale and cannot be forced | `[C]` | S4 |
| B6 | A seven-column month grid anchored to a right-aligned field at 360 px | `[S]` | S5 |
| B7 | The edge-swipe Back gesture competes with a left-edge drawer | `[S]` | S1 |

### C — Platform

| # | Vulnerability | Evidence | Surface |
|---|---|---|---|
| C1 | `h-screen` is `100vh`; the drawer's bottom — the currency toggle — hides under the iOS toolbar | `[M]` no `dvh` anywhere | G-3, S1 |
| C2 | `env(safe-area-inset-*)` unused **and** `viewport-fit=cover` absent; neither works without the other | `[M]` | G-3 |
| C3 | Scroll-within-scroll: a horizontal table inside a vertical page | `[M]` | S3 (dissolved with A2) |
| C4 | Pull-to-refresh on overscroll can discard an unsaved draft | `[S]` | G-3 |
| C5 | `Dialog`'s `max-h-[85vh]` is not 85 % of what remains visible with a keyboard open | `[C]` | S5 |

### D — Drawer state

All `[S]` — this is a new surface, so every item is closed by specification in
S1's acceptance list rather than by measurement.

D1 a route change must close it · D2 hardware Back must close it, not leave the
route · D3 focus trap, `Escape`, `aria-expanded` / `aria-controls` · D4 body
scroll lock and scroll-position restore · D5 `prefers-reduced-motion` on the
slide · D6 the trigger sits on a **light** header, so the `[data-dark-surface]`
ring override deliberately does not reach it — correct, and easy to "fix"
wrongly later, so it is written down here.

### E — Legibility and language

| # | Vulnerability | Evidence | Surface |
|---|---|---|---|
| E1 | Ukrainian is wider; `котирування` will not break cleanly in the 136 px rail and wraps to three lines, 2 px short | `[C]` measured in the A8 brief | Dissolved — G-1 retires the rail |
| E2 | Smallest rendered type is 10 px | `[M]` | G-4 (fields only; microlabels are a reference constant) |
| E3 | Long asset names (`OVDP UA4000238976`) are the cause of A3 | `[M]` | S3 |

### F — Design-system integrity

The subtlest class, and the one a mobile pass usually damages.

| # | Vulnerability | Answer |
|---|---|---|
| F1 | **44 px moves every radius.** D56 keys `r` to the short side, so 36 → 44 turns 9 into 11, 40 → 44 turns 10 into 11, and the currency track goes 13 → 17. Enlarging targets "for accessibility" silently rewrites the system | G-2: hit area, not geometry; two named exceptions with the arithmetic shown |
| F2 | The concentric chain holds only while the drawer's padding stays 16 (plate 14 + 16 = shell 30) | S1 §6 pins all three terms |
| F3 | **The mark lives in three copies** — `Sidebar.tsx`, `public/favicon.svg`, `public/apple-touch-icon.png` — and `mark.test.ts` pins only the first two. A mark in the new header would be a fourth | S2 acceptance: reuse the `Mark` component |
| F4 | Four stale references in the rules themselves — see below | Fixed alongside this brief |
| F5 | `navigation-map.md` describes the desktop layout only; its checkpoints do not cover a shell that can be closed | Listed in acceptance |

**F4, itemised.** Each contradicts something already shipped:

1. `docs/archive/design-briefs/README.md` — the pinned brief template's part 6
   still requires "pills/badges radius 999, inputs radius 10, sub-panels radius
   16" and "sidebar is 232 px (136 px below `sm`)". That is the world before
   D56, and before the rail widened to 244.
2. `design/extensions/README.md` — no row for `appearance-language.dc.html`,
   though the file is merged and A9/A10 implement from it.
3. `design/README.md` — the same omission in its extensions table.
4. `src/components/ui/Tag.tsx` **and** `src/components/ui/Switch.tsx` — both
   comments still cited `radius 999` while the code ships `rounded-[6px]`
   (and `rounded-[4px]` for the switch thumb). **Corrected 2026-08-13**, with
   the measured heights written in so the values can be re-derived: tag 22.5 px
   → 6, switch track 22 → 6, thumb 16 → 4. The switch comment also records why
   the track is **not** concentric with its thumb — the thumb sits 3 px in, so
   that reading would give 7. `button-variants.ts` also names `999px`, but
   correctly and as history ("the D56 radius rule, *not* the old 999px pill"),
   so it is left alone.

---

## Acceptance for Phase 6

- [ ] `design/extensions/mobile.dc.html` merged, covering S1–S6, in the master
      reference's idiom: `<x-dc>`, all styles inline, every colour/size/spacing
      literal in the markup, no runtime script.
- [ ] Every surface drawn at **360 px** and at **768 px**, and the drawer drawn
      open **and** closed.
- [ ] The keyboard-open state of `/` is drawn (S4).
- [ ] `--color-scrim` minted in the file's header comment with its dark value
      and its re-derived separation ratio (G-7).
- [ ] No radius contradicts D56; the two recomputed values (11) are shown with
      their arithmetic.
- [ ] Every width claim checked against **Ukrainian** copy (G-5).
- [ ] No D5-pinned demo figure changes.
- [ ] The four F4 stale references corrected.
- [ ] `navigation-map.md` gains the mobile shell's checkpoints when the phase
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

## S7 · The scroll surface — supersedes S5's scrollbar (added 2026-08-15)

`design/extensions/mobile.dc.html` is merged, so per D14 it keeps saying what it
said and this section supersedes the part of it that is now wrong. The new
reference is **`design/extensions/scroll-surface.dc.html`**; the decision of
record is **D65**. S5's other three overlays — date picker, select, toast — are
untouched and the merged file remains their authority.

**What S5 got wrong, and it is one sentence:** it specified a bar that *overlays*
("takes no layout width — content does not reflow when it appears"). An overlay
bar puts a track across the last row of a table and across a value in a form. The
reflow it avoids is a one-time settle nobody sees; the obstruction it creates is
permanent and everybody sees it.

**What the surface is now.**

- **The bar reserves, it does not overlay.** A gutter of `2m + 12` = **28** is
  given up by the content, and it is the padding of the box *around* the
  scroller, never the scroller's own — padding inside a scroll box holds only at
  the ends of the scroll range, and at every other position the content slides
  straight under the bar.
- **One margin, 8, equal on all four sides.** The distance to the parent's edge
  and the distance to the text are one number. S5's `R − 2r` inset (14 in a
  dialog) and the `R − r` concentric inset before it (19) are both withdrawn:
  concentricity is invisible on a shape this thin, and a bar pushed that far off
  its own edge reads as floating in the gutter rather than belonging to it. The
  arc keeps a guard, not a rule — `R(1 − 1/√2)` is 7.03 at a 24 and 4.69 at a 16,
  both under 8.
- **A dialog is three bands and only the middle one scrolls.** Title and buttons
  are fixed. At 360 this matters more than anywhere: the form is longest exactly
  where the viewport is shortest, and a Save button that scrolls away is one the
  reader has to go looking for.
- **Both axes, always, where the content is not the caller's to predict.** The
  axis a scroller does not manage is `overflow: hidden`, so a field wider than
  its panel is not merely unreachable — it is gone, with no bar to say so.

**Acceptance (S7)** — replaces the S5 scrollbar bullets only:

- [ ] No platform scrollbar anywhere except `Select` (Radix owns that viewport)
      and the page itself; both dressed from the same tokens.
- [ ] Content sits 28 from the panel edge on both inline sides, at *every* scroll
      position, and the three dialog bands line up down that same edge.
- [ ] A dialog's title and buttons do not move while its body scrolls.
- [ ] A `w-full` control inside a scrollport keeps its full focus ring.
- [ ] A dialog body of non-interactive text is scrollable by keyboard alone.
- [ ] The thumb reaches `muted` while hovered or dragged (the 3:1 value 1.4.11
      wants of the state that identifies the control in use).
