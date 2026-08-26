# Navigation map — the mobile shell below 768px

> Moved **verbatim** from [`../../navigation-map.md`](../../navigation-map.md) on 2026-08-26 (D95). **Connect and reset the way the map says before running any of this** — the expected figures are the D5 seed, and a stale dataset makes every checkpoint lie.

## Mobile shell — below 768px (A17 / D66)

**One breakpoint, `md` = 768px, and it is the only one.** Resize to **360 × 740**
and run these; then to **768 × 800**, where the desktop shell must be back
byte-for-byte. There is no third geometry — the old 136px rail is gone, and a
`max-sm:` override anywhere in the shell is a regression.

**The header bar (S2)**
- Sticky at the top, **56px** tall plus `env(safe-area-inset-top)`, **square
  corners** and a `hairline` bottom edge — a full-bleed bar has no designed short
  side, so no proportional radius (README §4).
- Left: a hamburger whose DRAWN glyph is 18 × 12 (three 2px bars, radius 1) inside
  a **44 × 44** pressable box that has no fill and no edge of its own.
- Then `TOTAL CAPITAL` in 9.5px uppercase `muted` over **`149 016 ₴`** at 18px
  IBM Plex Sans bold; right, stacked: **`+3,08 %`** in `pos` over **`3 324,03 $`**
  in `muted`. Toggling the currency in the drawer flips both. Both figures come
  from the same `useCapitalCard` as the sidebar's card — a discrepancy between the
  two is a defect, not a rounding difference.
- With no KPIs at all the value and the delta are both a `faint` `—`.
- It is a **light** surface: `page`/`ink`/`muted`/`pos`/`neg`/`hairline` only.
  The focus ring on its trigger must be the ink one, NOT the sidebar's light ring
  — `[data-dark-surface]` deliberately does not reach here.
- At **≥ 768** the header is ABSENT while the sidebar is in flow, and appears only
  when the sidebar is collapsed (fade + 4px rise, 220ms).

**The drawer (S1)**
- Tapping the hamburger slides a **280px** drawer in from the left over
  `--color-scrim` (260ms in, 220ms out). It is the SAME navigation as the desktop
  rail — same lockup, same pills, same currency toggle, same `rounded-r-[30px]`.
- **The Total capital card is absent in the drawer.** The header carries that
  number; drawing it twice would be two truths about one figure.
- The bottom cluster is PINNED, not pushed by `mt-auto`: at 740px of viewport
  height and at **640** the currency toggle and `v…` must both be on screen
  without scrolling the drawer.
- In **dark** the drawer takes a 1px `sidebar-muted` right edge; in light it draws
  none, because the scrim already separates it (5.23:1 against 1.02:1 — D66).
- Behaviour, all six: `Escape` closes and focus returns to the trigger · the
  background is inert and Tab cycles inside the drawer · tapping a nav pill closes
  it · the **hardware Back button closes it and stays on the route** · body scroll
  is locked while open and the scroll POSITION is restored on close · under
  `prefers-reduced-motion` it arrives instantly.
- Nav pills stay 36px tall at radius 9 — the pressable region grows to 44 around
  them and the column gap opens to 8, so the regions tile without overlapping. A
  pill drawn at 44 (radius 11) is a regression: G-2 forbids it.

**The record cards (S3)** — `/yield`, `/portfolio`, `/payouts`, `/balances`
- Each table becomes a list of cards: `Card` radius 24, `p-[22px]`, avatar +
  17px title + tag in the header, then a **two-column `<dl>`**. This is the
  `/attributes` card, shared from `components/ui/RecordCard`.
- **Every `dt` is the table's own `th`, character for character.** `Вкладено, ₴`
  and `Вартість зараз, ₴` on Yield; `з них реінвестовано` and `Частка` on
  Portfolio; `Сума, ₴` and `Призначення` on Payouts. A re-worded or abbreviated
  term is a defect.
- Numbers keep the TABLE format — `68 702,10`, never `68 702,10 ₴`. A card is not
  prose (README §8).
- Portfolio's bolded **Разом + готівка 7,75 ₴** row survives as a final card with
  its `border-t-2`; Balances keeps `очікується` in `faint` and `—` for a partial
  row's total.
- At **≥ 768** the `<table>` is back, unchanged, and the card list is gone.

**Daily quotes (S4)**
- Each row is TWO lines: `[48px avatar][name + "… ₴ учора"]`, then
  `[input][delta]`. The input is **44px tall at radius 11 with 16px type**; at
  ≥768 it is back to 36 / radius 9 / 13px.
- Once anything is filled, `Зберегти зріз` and `Скопіювати вчорашні` move into a
  **sticky bar pinned to the bottom of the VISUAL viewport** — square corners,
  `hairline` top edge, both buttons 44px at radius 11 — and they are NOT drawn in
  flow at the same time. With a field focused they must stay above the keyboard.
- `+ Новий актив…` in the transaction panel opens its sub-form with no horizontal
  scroll.
- **The `<aside>` fills the row whenever the two columns are stacked** — 360, 500,
  767 and 900 all measure zero dead space to its right. Beside the ritual column
  it is the `1fr` track of D88's grid — **no width cap and no container query
  since D88** (the old `max-w-[360px]` under `@min-[884px]` went with the flex
  row; measured 426,9 at 1440 — the `/` composition bullet BELOW carries the
  measurement). **The aside is the PERMANENT side rail (A44, D88), rendered on
  every day**: the coupon-due cards when a coupon is due, plus the
  pending-change block, the yield teaser and the last-saved line — the
  Transaction and Recent-transactions cards this bullet used to name left for
  `/transactions` at A32.
  A fixed 360-wide panel under a 733-wide column is the regression this replaced.

**The overlays (S5)**
- The `Dialog` is `calc(100vw − 32px)` wide, `max-h-[85dvh]`, three bands, and its
  title and buttons do not move while the body scrolls.
- The **date picker stops anchoring**: it opens as a centred **328px** sheet at
  radius 16 over the dialog scrim, with day cells 42.3 × 44 and month-nav buttons
  44 × 44. At ≥768 it is an anchored popover again, 269px, with 32px day cells.
  **Its caption is two buttons** — the month word and the year, 44 tall at 360
  and 28 above the breakpoint. Pressing either REPLACES the days with a grid:
  the twelve months in three columns, or a page of years in four. Pressing it
  again goes back, and the popover measures 269.1 in all three views.
  **Do not check the year range against a literal**: it is ±20 years around the
  CURRENT one, never later than 2016 at the near end, and widened to reach the
  field's own year — so it moves with the clock. The last page is short by
  design (41 years page as 12, 12, 12 and 5), so a page of five is correct.
- Every field and both value-showing triggers (`Select`, `DatePicker`) read at
  **16px** — under that iOS Safari zooms on focus and does not zoom back.
- Toasts sit at the bottom, 12px a side, clear of `env(safe-area-inset-bottom)`,
  and never under the header.

**Charts without a pointer (S6)**
- On `/balances`, `/payouts` and `/yield` a **tap pins the tooltip** to the nearest
  point; a tap elsewhere moves it, a tap outside releases it. `/seasonality` is
  deliberately NOT wired — it draws both its amounts on the bars — and
  `/allocation` has no tooltip at all.
- The plot is focusable in both shells: Tab to it and the tooltip appears at the
  first point; ArrowRight walks it forward.
- Payouts' tooltip reads `Купони : 0,00` / `Дивіденди : 472,13` — Ukrainian names
  and comma decimals. `coupons : 472.13` is the pre-D66 defect.

**Settings → Портфель**
- Each asset is a clear two-line block below the breakpoint: the name owns line 1,
  and the yield-type label plus `Змінити` / `Видалити` share line 2, ending at the
  same right edge the name does. Rows are 6px apart, not 2. The zig-zag it
  replaced — name left, type right, buttons left — is the regression to watch for.

**Hit areas** — every pressable is 44 × 44 below 768, with exactly two documented
exceptions (D66):
- the **seven text fields**, which stay 36px tall on purpose — an `<input>` is a
  replaced element and renders no pseudo-element at all, and growing the box would
  move its radius from 9 to 11;
- the **reminder strip's action link**, 133 × 37, because it is inline in a
  sentence: a pseudo-element resolves against an inline element's first line box,
  so the overlay lands unpredictably, and WCAG 2.5.8 exempts that case by name.

Anything else under 44 is a regression. Watch in particular for a control with NO
fill and NO border (an icon button, a ghost text button) carrying `TAP_44` — those
take a REAL 44px box (`TAP_44_BOX`), because a centred overlay on a small control
reaches `(44 − w) / 2` past its own edges and lands on the neighbour. That is how
the offer row's ✕ took 4.5px of the accept button beside it.
