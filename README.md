# Handoff: Kubushka — Investment Portfolio Tracker

[![Deploy](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml/badge.svg?branch=dev)](https://github.com/RomanKushyk/investment-tracker/actions/workflows/deploy.yml)

**Live:** https://dev.d17m4jf400my6.amplifyapp.com · deploy runbook: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

Implementation package for Claude Code. Recreate the design reference (`Investment Tracker.dc.html`) as a production React SPA using the stack in `package.json` (React 19 + Vite + TypeScript + Tailwind 4).

## 1. What this app is

A single-user personal investment tracker for a small Ukrainian portfolio (2 Inzhur funds + 2 OVDP government bonds). The core daily ritual is entering asset quotes — the **Daily quotes** tab is the landing view. Occasional transactions (buys, deposits, dividend accruals, reinvests) are recorded in a side panel; new assets are created inline inside the transaction form. Eight analytics views derive everything else. A sidebar toggle switches headline figures between ₴ UAH and $ USD.

## 2. About the design files

- `Investment Tracker.dc.html` — the master reference. Markup lives between `<x-dc>…</x-dc>` with **inline styles** (every color/size/spacing you need is literal in the markup); interaction logic (tab switching, currency toggle) is the `class Component` script at the bottom. `{{ name }}` holes are filled by that class's `renderVals()`. `<sc-if value="{{showX}}">` blocks = the eight tab panels. Ignore `support.js` and any `_ds/` references — prototype runtime scaffolding only.
- `Tracker Options.dc.html` — earlier design explorations; reference only if a detail is ambiguous.

**Fidelity: high.** Colors, typography, spacing, copy and layout are final — recreate faithfully. All *data* is a mix of the user's real positions and plausible mock history as of 27.07.2026 — in production every figure must be **computed** from stored snapshots/transactions/asset attributes, never hard-coded. Seed the DB with the mock data so the app looks like the reference on first run.

## 3. Stack mapping

Use the provided `package.json` as-is, with these notes:

- **Fonts**: the design uses **Space Grotesk** (headings, buttons, big numbers) and **Spline Sans Mono** (everything else) — NOT Roboto Mono. Swap `@fontsource-variable/roboto-mono` for `@fontsource/space-grotesk` + `@fontsource/spline-sans-mono` (or Google Fonts link).
- **Routing**: `react-router` — one route per tab (`/`, `/overview`, `/balances`, `/payouts`, `/yield`, `/attributes`, `/seasonality`, `/portfolio`, `/allocation`). `/` = Daily quotes. Sidebar nav = `NavLink`s.
- **State**: `zustand` (persisted) for currency preference + draft quote entry; **all portfolio data** in a local store — recommend IndexedDB (or localStorage JSON to start) behind a small repository module, queried via `@tanstack/react-query`. `socket.io-client` is in deps but unused — omit it.
  > **Since 2026-08-11 this is no longer the whole picture.** A backend exists in `infra/` — a daily job archiving asset prices into Aurora DSQL — but the app does not read it: portfolio data is still local. See `infra/README.md`, and `docs/superpowers/specs/2026-08-04-*` for where it is going.
- **Forms**: `react-hook-form` + `zod` for the Transaction form (incl. conditional "New asset details" sub-form) and daily quote inputs.
- **Charts**: `recharts` — area chart (Balances), stacked bar (Payouts), multi-line (Yield), day-of-month bar (Seasonality), donut (Allocation). Match the reference's colors, grid lines (`#e8e7e4`), and rounded bar corners (rx≈6). No legends other than the small inline dot-legends shown.
- **UI primitives**: Radix for Select/Dialog; CVA + tailwind-merge for button/tag variants; `sonner` for "Snapshot saved" / "Transaction recorded" toasts; `react-day-picker` for date fields (dd.MM.yyyy display).
- **Tailwind 4**: define the palette below as `@theme` tokens; prefer utility classes over inline styles.

## 4. Design tokens

Palette (pastel monochrome + muted tints):

- Page bg `#f6f5f3` · ink `#26262a` · card `#fff` · card shadow `0 1px 3px rgba(38,38,42,.06)`
- Muted text `#8b8a86` · faint `#b3b2ae` · hairline `#e8e7e4` · panel bg `#eceae7` / border `#dedcd8`
- Sidebar: bg `#26262a`, text `#e9e8e6`, muted `#96959b`, inset surfaces `#333338`, hover `#3d3d42`
- Positive/green: text `#5c7355`, tint bg `#e3eadf`, tint text `#4c5a48`, delta on dark `#b9cdb4`, filled-input border `#c9d4c4`
- Negative: `#a8695a`
- Asset series colors: REIT `#8ba283` (tint `#e3eadf`/`#4c5a48`), Energy `#c2a189` (tint `#efe4e0`/`#6d5a53`), OVDP …8976 `#98a3ad` (tint `#e4e8eb`/`#525c64`), OVDP …6475 `#5f5e5a` (tint `#e8e7e4`/`#5f5e5a`)

Type: Space Grotesk 600 for h1–h4, buttons, KPI numbers; Spline Sans Mono for body/labels/tables. Section h2 26px; KPI value 26px; card micro-labels 10px uppercase letter-spacing .12em; body 13px; tables 12.5px.

Shape: cards radius 20–24px; pills/buttons/inputs radius 999px on buttons, standard inputs white bg; focus ring `2px solid #26262a offset 2px`; selection bg `#e3eadf`. Lucide icons, stroke-width 2.75.

## 5. Layout shell

`flex; min-height:100vh`.

**Sidebar** — 232px fixed, bg `#26262a`, padding 26px 16px, `border-radius: 0 32px 32px 0`, sticky full-height, **internally scrollable** (footer cards must never clip on short viewports). Decorative 200px circle `#333338` @ .7 opacity overflowing bottom-right. Contents top→bottom:
1. Logo: 36px light circle containing the current currency symbol (₴/$), wordmark "Kubushka" over "INVEST TRACKER" microlabel.
2. Group label "DAILY ENTRY" → nav pill "Daily quotes".
3. Group label "ANALYTICS" → 8 nav pills. Active pill: bg `#e9e8e6`, ink text, weight 700; inactive: transparent, `#cfcecb`; hover opacity .85.
4. `margin-top:auto` → currency segmented toggle (container `#333338` pill, padding 4px; active segment `#e9e8e6`).
5. "Total capital" card (`#333338`, radius 20px): label, value (21px, white), delta line (`#b9cdb4`).

**Main** — `flex:1; min-width:0`, padding 32px 36px 48px. Every tab: h2 (26px) + one-line muted subtitle, then content. Grids use `repeat(auto-fit,minmax(200px,1fr))` style wrapping — no horizontal scroll at any width.

## 6. Screens

### 6.1 Daily quotes (landing, `/`)
Two columns (main `flex:1 1 560px`, side `flex:1 1 300px; max-width:360px`, wrap).

Main column:
- Header: h2 + progress pill "1 of 4 filled" (green tint, updates live as inputs fill) + date field pushed right.
- Subtitle: "The everyday ritual — nothing else competes with it."
- One white card **row per asset**: 34px tinted avatar circle with 2-letter code, name + "₴68,629.36 yesterday" subline, right-aligned numeric input (flex 90–160px; filled state gets green border + computed delta chip like "+0.11%" in green 700wt; empty shows placeholder = yesterday's value and "—" chip).
- Actions: primary dark pill "Save snapshot", outline pill "Copy yesterday" (fills all inputs with yesterday's values), right "Last saved 25.07, 21:14".
- Yield teaser strip: white card, trend icon, "**Yield since start:** REIT +4.41% · Energy +1.48% · …8976 +2.96% · …6475 +5.20%", ghost button "Yield chart →" linking to `/yield`.

Side panel:
- **Transaction card** (bg `#eceae7`, border `#dedcd8`, radius 24): title "Transaction" + "OCCASIONAL" microlabel; subtitle "Deposits, buys, accruals, reinvests — opened only when something happened."
  - Date + Type (2-col). Types: Buy, Sell, Deposit, Dividend accrual, Interest payout, Reinvest, Tax.
  - Asset select: first option "+ New asset…", then existing assets.
  - **New asset details** sub-card — visible ONLY when Asset = "+ New asset…": white bg, dashed `#b3b2ae` border, radius 16. Fields: Name; Yield type (Fixed coupon / Dividends / Capitalization / Dividends + capitalization); Expected % + Target % (2-col); Payout schedule (At maturity / Monthly / Quarterly / Semi-annual). Inputs inside use bg `#f6f5f3`. Recording the transaction also creates the asset.
  - Amount ₴ + Source of funds (Own funds / Accrual / Reinvest (REIT) / Reinvest (…6475)).
  - Primary pill "Record transaction".
- **Recent transactions** white card: last 3, each "Type · Asset — amount — date".

### 6.2 Overview
Subtitle "Portfolio at a glance · {date} · rate 44.83 ₴/$". KPI grid (auto-fit, 4 cards): Total capital (dark card, currency-aware), Net result (green, "+₴4,452.61", "+3.08% since 03.02"), Deposited / Reinvested, Free cash. Below, 1.5fr/1fr grid:
- Assets card: row per asset (color dot, name, "div + cap · 46.1%" meta, value, +% green) + horizontal stacked share bar (12px pill).
- Right stack: "Next payouts" (green tint card), "Rebalance hint" card (OVDP …8976 −6.4% under target → top up ₴11,413, "Open Allocation →" ghost), "Income received" card (₴5,040.94; dividends/coupons split).

### 6.3 Balances
Area chart of total capital by snapshot (Feb–Jul, green line `#5c7355`, fill `#e3eadf`) + snapshot table: date | value per asset | cash | total. Today's partially-filled row shows "pending" (`#b3b2ae`) for missing quotes and "—" total. Footer "Showing last 6 snapshots · 174 total since 03.02.2026" (paginate in production).

### 6.4 Payouts
Stacked monthly bar chart (dividends `#8ba283`, coupons `#98a3ad`, value labels on top) + right stack: Received total (dark card), Upcoming (green tint), Reinvested (₴1,387.38 · 27.5% of income). Below: payout log table (Date, Asset, Type tag, Amount, Destination — "reinvested (₴687,02)" / "account").

### 6.5 Yield
4-line cumulative-%-return chart (asset series colors, dot at line end) + table: Asset | Invested | Value now | Δ total | Annualized | vs expected (negative pp in `#a8695a`). Footnote: annualized = Δ scaled to 365 days from first purchase; coupons count on accrual.

### 6.6 Attributes
2×2 grid of asset cards: avatar + h3 + yield-type tag; then a 2-col dl of ~6 facts (Expected return, Actual ann., Payout schedule, Target share, First purchase, Reinvest policy — bonds swap in YTM, Coupon amount, Maturity, Next coupon). Read-only; edited via the New-asset flow.

### 6.7 Seasonality
Income-by-day-of-month bar chart: gray 3–5px stubs for no-income days, tall colored bars on days 10 (₴3,817, green), 3, 25 (labeled; `*` = expected). Footnote explaining stubs. Below: 3 insight cards — "Income anchor" (day 10, green tint), "Coupon season" (Feb & Aug day 25), "Quiet stretch" (days 26–31).

### 6.8 Portfolio
Positions table: Asset | Yield type tag | Invested | of it reinvested | Value now | P&L ₴ | P&L % | Share, plus a bolded Total row ("Total + cash ₴7.75"). Below: 3 cards — Best performer (…6475 +5.20%), Laggard (Energy), Income engine (REIT, green tint).

### 6.9 Allocation
340px/1fr grid. Left: donut (SVG or recharts Pie, 30px ring, asset colors, center "₴149k / 4 assets + cash") + legend. Right: "Current vs target" card — per asset a labeled progress pill (current share fill, black 2px tick at target %, "+6.1"/"−6.4" deltas colored) — and a "Rebalance plan" panel card listing numbered actions with amounts.

## 7. Data model & computations

```ts
Asset { id, name, code /*2 letters*/, colorKey, yieldType: 'fixed_coupon'|'dividends'|'capitalization'|'div_cap',
        expectedPct, targetPct, payoutSchedule: 'maturity'|'monthly'|'quarterly'|'semiannual',
        firstPurchase, maturity?, couponAmount?, nextCoupon?, reinvestPolicy? }
Snapshot { date, quotes: Record<assetId, number>, cash }   // one per day, partial until saved
Transaction { id, date, type: 'buy'|'sell'|'deposit'|'dividend_accrual'|'interest_payout'|'reinvest'|'tax',
              assetId, amount, source: 'own'|'accrual'|'reinvest_reit'|'reinvest_6475' }
Settings { currency: 'UAH'|'USD', usdRate: 44.83 }
```

Derived (never stored): total capital = latest complete snapshot Σ + cash; invested per asset = Σ buys + reinvests; P&L = value − invested; share % = value / total; yield since start = value/invested − 1; annualized = Δ × 365/daysHeld; allocation delta = share − targetPct; rebalance amounts = (target−share) × total. Currency toggle converts **display only** (headline KPIs + sidebar + logo symbol) at the stored rate; detail tables stay in ₴ (matches reference).

Seed data (real user figures, 27.07.2026): REIT invested 65 800,00 → 68 702,10; Energy 59 208,00 → 60 086,09; OVDP …8976 15 390,00 → 15 846,30; OVDP …6475 4 158,00 → 4 374,12; cash ₴7,75; targets 40/40/17/3; income received ₴5,040.94 (div ₴3,641.44 / coupons ₴1,399.50), reinvested ₴1,387.38. Payout log rows are in the reference — seed them verbatim.

## 8. Formatting rules

- Currency: `₴68,629.36` in prose/KPIs; `68 702,10` (space thousands, comma decimals) in tables and inputs; USD `$3,324.03`.
- Dates: `dd.MM.yyyy` (27.07.2026), short `dd.MM` in compact rows; payout dates like "10 Aug".
- Deltas: explicit sign, green `#5c7355` positive / `#a8695a` negative; "pp" for percentage-point gaps.

## 9. Behavior checklist

- [ ] Quote entry: typing updates delta chip + "N of 4 filled" pill live; Save snapshot persists + toasts + updates "Last saved"; Copy yesterday prefills all.
- [ ] Snapshot for today upserts (re-saving replaces).
- [ ] Transaction form: New-asset sub-form appears only for "+ New asset…"; recording creates asset (with attributes) + transaction; recent-transactions list updates.
- [ ] Currency toggle persists across reloads; converts logo symbol, sidebar capital, Overview KPIs only.
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
