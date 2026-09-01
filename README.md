# Handoff: Quirenote — Investment Portfolio Tracker

[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml/badge.svg?branch=main)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy-frontend.yml)

**Live:** https://quirenote.com — served from `main`. The `dev` branch deploys to `dev.quirenote.com`, which is password-protected on purpose. Deploy runbook: [`docs/reference/DEPLOYMENT.md`](docs/reference/DEPLOYMENT.md)

Implementation package for Claude Code. Recreate the design reference (`Investment Tracker.dc.html`) as a production React SPA using the stack in `package.json` (React 19 + Vite + TypeScript + Tailwind 4).

## 1. What this app is

A single-user personal investment tracker for a small Ukrainian portfolio (2 Inzhur funds + 2 OVDP government bonds). The core daily ritual is entering asset quotes — the **Daily quotes** tab is the landing view. Occasional transactions (buys, deposits, dividend accruals, reinvests) are recorded in a side panel; new assets are created inline inside the transaction form. Eight analytics views derive everything else. A sidebar toggle switches headline figures between ₴ UAH and $ USD.

## 2. About the design files

- `Investment Tracker.dc.html` — the master reference. Markup lives between `<x-dc>…</x-dc>` with **inline styles** (every color/size/spacing you need is literal in the markup); interaction logic (tab switching, currency toggle) is the `class Component` script at the bottom. `{{ name }}` holes are filled by that class's `renderVals()`. `<sc-if value="{{showX}}">` blocks = the eight tab panels. Ignore `support.js` and any `_ds/` references — prototype runtime scaffolding only.
- `Tracker Options.dc.html` — earlier design explorations; reference only if a detail is ambiguous.

**Fidelity: high.** Colors, typography, spacing, copy and layout are final — recreate faithfully. All *data* is a mix of the user's real positions and plausible mock history as of 27.07.2026 — in production every figure must be **computed** from stored snapshots/transactions/asset attributes, never hard-coded. Seed the DB with the mock data so the app looks like the reference on first run.

## 3. Stack mapping

Use the provided `package.json` as-is, with these notes:

- **Fonts**: the app ships **IBM Plex Sans** (headings, buttons, big numbers) and **JetBrains Mono** (everything else), via `@fontsource`. The *design reference* still shows Space Grotesk + Spline Sans Mono, and that divergence is deliberate: neither of those carries a single Cyrillic letter, so they could not render the app's default language (D54). The replacements were picked by measurement — JetBrains Mono keeps the identical `0.6em` advance, so every width in the reference still holds, and IBM Plex Sans is the only candidate whose **figures are tabular by default**, which keeps KPI columns aligned without any call site having to remember `font-variant-numeric`.
- **Routing**: `react-router` — one route per tab (`/`, `/transactions`, `/overview`, `/balances`, `/payouts`, `/yield`, `/attributes`, `/seasonality`, `/portfolio`, `/allocation`, `/settings`) — **eleven**. `/` = Daily quotes; `/transactions` is its own route since A32 and `/settings` since P2. Sidebar nav = `NavLink`s in three groups (`Ввід` / `Аналітика` / `Налаштування`), each collapsible since A33.
- **State**: `zustand` (persisted) for currency preference + draft quote entry; **all portfolio data** in a local store — recommend IndexedDB (or localStorage JSON to start) behind a small repository module, queried via `@tanstack/react-query`. `socket.io-client` is in deps but unused — omit it.
  > **Since 2026-08-11 this is no longer the whole picture.** A backend exists in `infra/` — a daily job archiving asset prices into Aurora DSQL — but the app does not read it: portfolio data is still local. See `infra/README.md`, and `docs/superpowers/specs/2026-08-04-*` for where it is going.
- **Forms**: `react-hook-form` + `zod` for the Transaction form (incl. conditional "New asset details" sub-form) and daily quote inputs.
- **Charts**: `recharts` — area chart (Balances), stacked bar (Payouts), multi-line (Yield), day-of-month and month-of-year bar (Seasonality), donut (Allocation). Match the reference's colors, grid lines (`#e8e7e4`), and rounded bar corners (rx≈6). No legends other than the small inline dot-legends shown.
- **UI primitives**: Radix for Select/Dialog; CVA + tailwind-merge for button/tag variants; `sonner` for "Snapshot saved" / "Transaction recorded" toasts; `react-day-picker` for date fields (dd.MM.yyyy display).
- **Tailwind 4**: define the palette below as `@theme` tokens; prefer utility classes over inline styles.

## 4. Design tokens

Palette (pastel monochrome + muted tints):

- Page bg `#f6f5f3` · ink `#26262a` · card `#fff` · card shadow `0 1px 3px rgba(38,38,42,.06)`
- Muted text `#696865` · faint `#b3b2ae` · hairline `#e8e7e4` · panel bg `#eceae7` / border `#dedcd8`
  - **`muted` diverges from the reference on purpose (D68)**, which draws `#8b8a86` — that value measured **2.88:1 on `panel`**, 3.17 on `page` and 3.46 on `card` across 258 rendered elements, all of them 9.5–13px body text that WCAG 1.4.3 holds to 4.5. Re-derived against `panel`, the surface it is worst on: 4.64 / 5.11 / 5.57. The **separate `label` token `#6f6e6a` is retired into it** — it failed the same surface and landed on the same luminance once solved, so there is no `text-label`. Dark is untouched (`muted` `#9b9a96`, 5.56–6.53).
- Sidebar: bg `#26262a`, text `#e9e8e6`, muted `#96959b`, inset surfaces `#333338`, hover `#3d3d42`
- Positive/green: text `#5c7355`, tint bg `#e3eadf`, tint text `#4c5a48`, delta on dark `#b9cdb4`, filled-input border `#c9d4c4`
- Negative: `#a8695a`
- Asset series colors: REIT `#8ba283` (tint `#e3eadf`/`#4c5a48`), Energy `#c2a189` (tint `#efe4e0`/`#6d5a53`), OVDP …8976 `#98a3ad` (tint `#e4e8eb`/`#525c64`), OVDP …6475 `#5f5e5a` (tint `#e8e7e4`/`#5f5e5a`)

Type: **IBM Plex Sans** 600 for h1–h4, buttons, KPI numbers; **JetBrains Mono** for body/labels/tables (was Space Grotesk + Spline Sans Mono until D54 — same sizes, same 0.6em mono advance). Section h2 26px; KPI value 26px; card micro-labels 10px uppercase letter-spacing .12em; body 13px; tables 12.5px.

Shape: cards radius 20–24px; standard inputs white bg; focus ring `2px solid #26262a offset 2px` — **except on a FILLED track (D114)**, where the ring would land on its own colour: `[data-filled-track] :focus-visible` paints it `--color-page` at offset 1, so a 2px ring fits the tightest such track's 3px inset; selection bg `#e3eadf`. Lucide icons, stroke-width 2.75. Buttons, pills and chips were radius 999px until D56 — the reference still draws them as capsules, and that divergence is deliberate.

**Radius rules (D56).** Two rules, and which applies depends on whether the box is nested against a parent's corner:
- **Concentric** — when a box sits inside another at a uniform gap, `outer = inner + gap`, so the two curves stay parallel. The sidebar is the worked example: header plate 14 + its 16px inset = shell 30.
- **A segmented control is both.** Its segment is an object (proportional); its track is a container (concentric). The gap is padding **plus any border**, because the segment's corner sits inside both — a 28px segment gives 7, so sidebar toggle `7+6` = 13 (borderless), Settings and dataset `7+4+1` = 12, asset form `7+3+1` = 11, and the price-mode toggle `4+3` = **7** — a 15px segment gives 4, which is why 7 appears here as a TRACK where the list above uses it for segments. Never give the track its own proportional value.
- **Proportional** — for a standalone control not adjacent to a parent's corner, `r = round(min(w, h) × 0.26)`, keyed to the SHORT side. Measure the RENDERED height: `text-[11px]` sets a font size, not a line height, so the classes alone cannot tell you how tall a control is. Gives 3 (bars, chart-legend swatches), 5 (micro badges), 6 (tags, status badges), 7 (segments, chips), 8 (`Button` sm), 9 (inputs, nav pills, day cells, menu rows), 10 (`Button` md/header). Surfaces are NOT proportional — cards, dialogs and popovers keep the reference's own 16 / 20 / 24.
- **Circles stay circles** — `AssetAvatar`, `ColorDot`, the logo circle, the decorative blob. One round thing among rounded rectangles reads as deliberate. Nothing else is a capsule: the `Switch` track (6) and its knob (4) follow the rule too.

Do **not** apply the proportional rule to a full-height panel: its short side is a layout width, not a designed size, and 0.26 of it produces a radius that cuts across the corners of what it contains.

**Circle in a block** — an avatar inside a row occupies **60–70%** of the row's height (quote row: 48px circle in a 76px row = 63%).

**44px is HIT AREA, never geometry (D66).** Below `md` every pressable gets a
44 × 44 region through `components/ui/tap-target.ts` — a transparent `::after`,
centred, never smaller than the control it sits in — and **the drawn box does not
move**. That is what protects the rule above: growing controls to 44 would take
the nav pill from 9 to 11, `Button` md from 10 to 11 and the currency track from
13 to 17, rewriting five radii as a side effect of an accessibility fix. Exactly
**two** controls are allowed to grow, both of the daily ritual — the quote input
and `Button` size `md`, each 36/40 → 44 with the radius **recomputed** as
`round(44 × 0.26) = 11`. Text fields are not among them, and cannot be: an
`<input>` is a replaced element and renders no pseudo-element at all. The class
also needs SPACING from its caller — two overlapping 44px regions hand the tap to
the wrong control — which is why the sidebar nav opens its column gap to 8 below
the breakpoint (36 + 8 = 44, and the regions tile exactly).

**Two full-bleed bars take square corners** — the mobile header and the sticky
action bar. The proportional rule reads two DESIGNED dimensions; a bar whose long
side runs edge to edge has only one, so `0.26 × 56` would be a radius taken from a
layout dimension. Their boundary is a `hairline`, not a curve.

**Overlays.** Popovers and dialogs are surfaces (16 / 20 / 24) *unless* a rounded child hugs their corners at a uniform gap, which makes them concentric instead — the `Select` popover is 14 (items 9 + 5 inset), while the `DatePicker` (16) and `Dialog` (24) are not, because their corner-adjacent children do not hug all four sides.

**Scrollbars.** Nothing scrolls with the platform's bar — every constrained box goes through `src/components/ui/Scroller.tsx` (D65). The rail is 12px, `2+2+4+2+2`, thumb r1 and rail r5, with a margin of **8 equal on all four sides** and a reserved gutter of `2m + 12` = 28 taken from the ScrollArea ROOT's padding — not the scrolling child's, which would slide out from under the rail. Dialogs are three bands (`DialogHeader` / `DialogBody` / `DialogFooter`) and only the middle one scrolls.

**Toasts.** `sonner` ships its own radius, font stack and shadow and ignores classes we add (it styles by attribute). The three are overridden as inline styles through `toastOptions` in `src/main.tsx`: radius 13, `var(--font-body)`, `0 4px 16px rgba(38,38,42,.12)`.

**Buttons are isometric.** Every `Button` variant carries the same `border-[1.5px]`; filled ones paint it `border-transparent`. Height is set **explicitly** per size — `md` 40, `header` 36 (to sit beside the 36px Date field), `sm` 30 — never as a padding sum, so `box-sizing: border-box` absorbs the ring instead of adding it. Padding compensation cannot work here: Chrome lays a 1.5px border out as 1px at DPR 1 and 1.5px at DPR 2, so no single padding restores the height on both. `inset: flushLeft` also drops the left border, or the transparent ring re-creates the very offset that variant exists to remove. The reference shares a padding between a bordered and an unbordered button, so it is not authoritative here.

## 5. Layout shell

`flex; min-height:100dvh` — `dvh`, never `vh`: on a mobile browser `100vh` is the
height the viewport has with the toolbars RETRACTED, so a `vh` shell is taller
than what is on screen and its bottom sits under the chrome.

**TWO SHELLS, ONE BREAKPOINT — `md`, 768px (D66).** Below it the sidebar is an
off-canvas 280px drawer over `--color-scrim` and a 56px header bar carries the
capital; at and above it, the layout below, plus a control that collapses the rail
and hands the header the same job. There is no third geometry: the 136px rail that
used to appear under `sm` is retired. The breakpoint is written twice — `max-md:`
in markup and `(min-width: 768px)` in `hooks/useIsDesktop.ts`, because a drawer
needs a focus trap and a focus trap has to know which shell is mounted — and the
two must stay one number.

**One composition, laid out two ways.** `SidebarPanel` is the whole navigation;
`variant` decides only what belongs to a shell rather than to the nav — the
collapse control, and the Total capital card, which below the breakpoint IS the
header. Both read the same `useCapitalCard`, so the headline is derived once.
Both shells are three bands (lockup / scrolling nav / pinned cluster) and only the
middle one scrolls — measured, the sidebar's content is 851px in a 740px viewport,
so an `mt-auto` cluster sits below the fold.

**Sidebar** — 244px fixed, bg `#26262a`, padding 16px, `border-radius: 0 30px 30px 0` (concentric: 14 + 16), sticky full-height, **internally scrollable** (footer cards must never clip on short viewports). Decorative 200px circle `#333338` @ .7 opacity overflowing bottom-right. Contents top→bottom:
1. Logo lockup card (`#333338`, radius 14, padding 10px 15px, `justify-content:flex-start`): 36px light circle containing **mark 04** — four bars, height is value and opacity is age — beside the wordmark "Quirenote" over "INVEST TRACKER" microlabel. The circle no longer carries the currency symbol; the toggle below is the only currency indicator. The DEMO badge is absolutely pinned to the card's top-right corner at the card's own 15/10 padding and scaled to .75 — out of flow, so it cannot stretch the row.
2. Group label "DAILY ENTRY" → nav pill "Daily quotes".
3. Group label "ANALYTICS" → 8 nav pills. Active pill: bg `#e9e8e6`, ink text, weight 700; inactive: transparent, `#cfcecb`; hover opacity .85.
4. `margin-top:auto` → currency segmented toggle (container `#333338`, radius **13** = segment 7 + 6 padding, padding 6px; active segment `#e9e8e6`, radius 7 — **and this one control keeps that orientation**, the single exception D114 makes when it fills every other segmented track, because in the rail a light lozenge already means SELECTED). The sliding thumb's width encodes the container geometry as `50% − (padding + gap/2)` — re-derive it whenever that padding moves.
5. "Total capital" card (`#333338`, radius **13** — matched to the toggle above it, so the two read as one bottom cluster): label, value (21px, white), delta line (`#b9cdb4`).

**Main** — `flex:1; min-width:0`, padding 32px 36px 48px (12px inline and 16px top below `md`). Every tab: h2 (26px) + one-line muted subtitle, then content. Grids use `repeat(auto-fit,minmax(200px,1fr))` style wrapping — **no horizontal scroll at any width, and since D66 that is measured rather than intended**: zero on all eleven routes at 360, in both themes and both languages.

**Platform (D66).** The viewport meta carries `viewport-fit=cover`, so the page
extends under a notch and every edge that a cutout can reach pays the inset back
explicitly: `env(safe-area-inset-left/right)` on the content column, `-top` on the
header, `-bottom` on the drawer and the sticky action bar. The two are one change
— without `viewport-fit=cover` every `env()` resolves to 0. The root also sets
`overscroll-behavior-y: contain`, so a pull-to-refresh cannot discard an unsaved
quote draft.

## 6. Screens

**Moved 2026-08-26 (D95)** — the nine per-screen sections are [`docs/spec/screens.md`](docs/spec/screens.md), verbatim. They are still §6 and they still bind; only the file changed, so this one stays under 200 lines.

| §6.1 `/` daily quotes · §6.2 Overview · §6.3 Balances · §6.4 Payouts · §6.5 Yield · §6.6 Attributes · §6.7 Seasonality · §6.8 Portfolio · §6.9 Allocation |
|---|

## 7. Data model & computations

```ts
Asset { id, name, code /*2 letters*/, colorKey, yieldType: 'fixed_coupon'|'dividends'|'capitalization'|'div_cap',
        expectedPct, targetPct, payoutSchedule: 'maturity'|'monthly'|'quarterly'|'semiannual',
        firstPurchase, maturity?, couponAmount?, nextCoupon?, reinvestPolicy? }
Snapshot { date, quotes: Record<assetId, number>, cash }   // one per day, partial until saved
Transaction { id, date, type: 'buy'|'sell'|'deposit'|'withdrawal'|'dividend_accrual'
                    |'interest_payout'|'reinvest'|'redemption'|'tax',
              assetId, amount, source: 'own'|'accrual'|'reinvest_reit'|'reinvest_6475',
              quantity?, unitPrice? }   // #31/D112 — units are Σ quantity, never a stored
                                        // total. Position-moving types only (buy/sell/
                                        // reinvest/redemption); both absent on every row
                                        // recorded before they existed.
Settings { currency: 'UAH'|'USD', usdRate: 44.83 }
```

Derived (never stored): total capital = latest complete snapshot Σ + cash; invested per asset = Σ buys + reinvests; P&L = value − invested; share % = value / total; yield since start = value/invested − 1; annualized = Δ × 365/daysHeld; allocation delta = share − targetPct; rebalance amounts = (target−share) × total. Currency toggle converts **display only** (headline KPIs + sidebar capital — the logo symbol went with D56) at the stored rate; detail tables stay in ₴ (matches reference).

Seed data (real user figures, 27.07.2026): REIT invested 65 800,00 → 68 702,10; Energy 59 208,00 → 60 086,09; OVDP …8976 15 390,00 → 15 846,30; OVDP …6475 4 158,00 → 4 374,12; cash ₴7,75; targets 40/40/17/3; income received ₴5,040.94 (div ₴3,641.44 / coupons ₴1,399.50), reinvested ₴1,387.38. Payout log rows are in the reference — seed them verbatim.

## 8. Formatting rules

- Currency: `₴68,629.36` in prose/KPIs; `68 702,10` (space thousands, comma decimals) in tables and inputs; USD `$3,324.03`.
- Dates: `dd.MM.yyyy` (27.07.2026), short `dd.MM` in compact rows; payout dates like "10 Aug".
- Deltas: explicit sign, green `#5c7355` positive / `#a8695a` negative; "pp" for percentage-point gaps.

## 9. Behavior checklist

- [ ] Quote entry: typing updates delta chip + "N of 4 filled" pill live; Save snapshot persists + toasts + updates "Last saved"; Copy yesterday prefills all.
- [ ] Snapshot for today upserts (re-saving replaces).
- [ ] Transaction form: New-asset sub-form appears only for "+ New asset…"; recording creates asset (with attributes) + transaction; recent-transactions list updates.
- [ ] Currency toggle persists across reloads; converts sidebar capital and Overview KPIs only. **It no longer converts a logo symbol** — D56 replaced the ₴/$ in the sidebar circle with the static mark, so the toggle at the bottom is the only currency indicator. A circle that does not change on toggle is correct, not a regression.
- [ ] All charts recompute from stored data.
- [ ] No horizontal scroll ≥360px wide; sidebar scrolls internally.
- [ ] Focus-visible rings, hover states, `aria-current` on active nav.

## 10. Suggested build order

1. Vite scaffold, Tailwind theme tokens, fonts, layout shell + sidebar nav (router).
2. Data layer: types, zod schemas, repository (IndexedDB/localStorage), seed data, react-query hooks.
3. Daily quotes screen (entry flow end-to-end).
4. Transaction form incl. new-asset sub-form.
5. Overview + Portfolio + Attributes (pure derivations).
6. Charts: Balances, Payouts, Yield, Seasonality, Allocation.
7. Currency toggle, toasts, polish, empty states (no snapshots yet / single asset).
