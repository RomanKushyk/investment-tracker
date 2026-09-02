# Screens — the per-screen content spec (README §6)

> Moved **verbatim** from [`../../README.md`](../../README.md) on 2026-08-26 (D95). It is still §6 of the spec and it still binds. The design tokens (§4), the layout shell (§5), the data model (§7), the formatting rules (§8), the behavior checklist (§9) and the build order (§10) stayed in the README.

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
2×2 grid of asset cards: avatar + h3 + yield-type tag; then a 2-col dl of ~5 facts (Expected return, Actual ann., Payout schedule, Target share, First purchase — bonds swap in YTM — **solved from the price paid since D120, and marked when it differs from the stored `expectedPct` the other screens compare against** — Coupon (**a per-payment figure DERIVED from the rate and the ledger since D119, not a stored amount**), Maturity, Next coupon). **Reinvest policy left this list in D118** — it was displayed here but editable only on a bond, which never reaches this branch. Read-only; edited via the New-asset flow.

### 6.7 Seasonality
Income-by-day-of-month bar chart: gray 3–5px stubs for no-income days, tall colored bars on days 10 (₴3,817, green), 3, 25 (labeled; `*` = expected). Footnote explaining stubs. **A41 added a second axis**: the same recorded income re-bucketed by MONTH of year, beside a per-month coupon FORECAST that is re-projected rather than re-bucketed — a bond contributes one bar to the day axis and one to every month it is scheduled to pay in, so the two axes do not sum alike. A segmented toggle on the chart card chooses between them; it is `useState`, so it returns to days whenever the route is left and re-entered. Below: 3 insight cards — "Income anchor" (day 10, green tint), "Coupon season" (Feb & Aug day 25), "Quiet stretch" (days 26–31).

### 6.8 Portfolio
Positions table: Asset | Yield type tag | Invested | of it reinvested | Value now | P&L ₴ | P&L % | Share, plus a bolded Total row ("Total + cash ₴7.75"). Below: 3 cards — Best performer (…6475 +5.20%), Laggard (Energy), Income engine (REIT, green tint).

### 6.9 Allocation
340px/1fr grid. Left: donut (SVG or recharts Pie, 30px ring, asset colors, center "₴149k / 4 assets + cash") + legend. Right: "Current vs target" card — per asset a labeled progress pill (current share fill, black 2px tick at target %, "+6.1"/"−6.4" deltas colored) — and a "Rebalance plan" panel card listing numbered actions with amounts.
