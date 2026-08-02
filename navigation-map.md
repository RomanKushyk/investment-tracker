# Navigation map — agentic manual testing

Route-by-route map of the app for manual/agentic verification. Every expected value below is what the app must show **on fresh seed data** (they mirror `docs/BUILD-PLAN.md` fixtures and `docs/DECISIONS.md` D5). Update the Status column and checkpoints whenever a task changes a screen or flow.

> **Next phase in progress** — see `docs/NEXT-PHASE-PLAN.md`. From its Phase 2 (dataset split) on, all seed-pinned checkpoints below run against the **demo** dataset; new routes (`/settings`, `/data`) get their own sections as they land.

## Connecting & resetting

- App runs on **http://localhost:3000** (pinned in vite.config). The dev server is usually already running — check before starting one. If :3000 is occupied by another project, Vite falls back to :3001+ — read the dev-server output for the actual port.
- **Checkpoints also run against the deployed site** — `https://dev.d17m4jf400my6.amplifyapp.com` (see `docs/DEPLOYMENT.md`). Use a **fresh browser profile** when verifying a deploy: the seed only loads into an empty IndexedDB, so an existing profile shows your own data instead of the pinned values.
- **Reset to seed state:** DevTools → Application → delete IndexedDB database `kubushka` and localStorage keys `kubushka-settings`, `kubushka-draft` → reload. The app reseeds automatically.
- Number formats: tables/inputs `68 702,10` (NBSP thousands, comma decimals); prose/KPIs `₴68,629.36`; dates `dd.MM.yyyy`.
- **Do NOT flag D5 deviations as bugs** — see the last section.

## Route index

| Route | Screen | Built in | Status |
|-------|--------|----------|--------|
| — | Shell + sidebar (all routes) | Task 1 (data: Task 2) | done — capital card + logo + functional ₴/$ toggle (Task 7); sidebar narrows to a rail below 640px; third "Settings" nav group (P2); Backup button moved to Settings→Data (P2, was next-phase P1) |
| `/` | Daily quotes (landing) | Task 3 (form: Task 4) | done — quote entry flow + transaction panel live |
| `/overview` | Overview | Task 5 | done — all 4 KPIs currency-aware; values tween ~300ms on toggle (Task 7) |
| `/balances` | Balances | Task 6 | done |
| `/payouts` | Payouts | Task 6 | done |
| `/yield` | Yield | Task 6 | done |
| `/attributes` | Attributes | Task 5 | done |
| `/seasonality` | Seasonality | Task 6 | done |
| `/portfolio` | Portfolio | Task 5 | done |
| `/allocation` | Allocation | Task 6 | done |
| `/settings` | Settings | next-phase P2 | in progress — shell + Backup + Appearance + asset manager (create/edit/delete dialogs) + targets editor (Σ pill, share preview, per-asset save) live; dataset switch and erase/reset land in the remaining P2 tasks |

## Global shell (visible on every route)

Expect: dark 232px sidebar, rounded right edge, internally scrollable (test on a short window — footer cards must never clip).

- Logo circle shows the **current currency symbol** (₴ default), wordmark "Kubushka" / "INVEST TRACKER".
- Nav: "DAILY ENTRY" group → "Daily quotes" pill; "ANALYTICS" group → 8 pills; "SETTINGS" group → "Settings" pill (next-phase P2 — same pill anatomy/motion, no icon). Active pill = light bg + `aria-current="page"`; clicking navigates without full reload.
- Currency toggle (₴ / $ segmented pill) near the bottom.
- **Total capital card:** value `₴149,016` (whole ₴), sub-line `+3.08% · $3,324.03`. After toggling to $: logo symbol becomes `$`, value/sub-line flip to the USD form (`$…` main, `… · ₴149,016.36` sub); choice **survives a page reload**.
- **No sidebar Backup pill** (removed in next-phase P2 per S7) — the backup download lives on `/settings` → Data.
- **Version badge** at the very bottom (below the capital card, centered muted micro-label): `v` + the `package.json` version — must match it exactly (see `docs/VERSIONING.md`).
- No horizontal scroll at 360px viewport width on any route.

## `/` — Daily quotes (landing)

On seed:
- Progress pill **"1 of 4 filled"** (green tint) — REIT's quote for 27.07 is already saved.
- 4 asset rows, each: tinted 34px avatar with 2-letter code, name, subline like **"₴68,629.36 yesterday"** (REIT). REIT input pre-filled `68 702,10` with green border + delta chip **"+0.11%"**; the other three empty with placeholders `60 086,09` / `15 846,30` / `4 374,12` and "—" chips.
- Buttons: dark pill **"Save snapshot"**, outline **"Copy yesterday"**; right text **"Last saved 25.07, 21:14"**.
- Yield teaser strip: "Yield since start: REIT **+4.41%** · Energy **+1.48%** · …8976 **+2.96%** · …6475 **+5.20%**" + ghost "Yield chart →" (navigates to `/yield`).
- Side panel: **Transaction** card (panel bg/border tokens, radius 24, "OCCASIONAL" microlabel) + **Recent transactions** card (last 3, "Type · Asset — amount — date"). *"Interest payout" renders with a "Coupon" label per the design reference; the new-asset appears-in-Attributes checkpoint becomes testable once Task 5 ships that screen.*

Interactions to verify:
1. Type into an empty input → its delta chip computes live vs yesterday's value; pill count increments ("2 of 4 filled"). Comma and dot decimals both accepted.
2. Typed drafts survive a reload (persisted draft store).
3. "Copy yesterday" fills all 4 inputs with yesterday's quotes.
4. "Save snapshot" → toast **"Snapshot saved"**, "Last saved" updates, IndexedDB row for the date is UPSERTED (re-saving the same day must not add a row).
5. Transaction form: selecting Asset = "+ New asset…" reveals the dashed **New asset details** sub-card; any other asset hides it. Submitting with a new asset creates asset + transaction atomically → toast **"Transaction recorded"**, Recent list updates, new asset appears as a 5th quote row with a cycled avatar tint. *Since next-phase P2 the sub-card renders the shared AssetForm fields (create mode, no First purchase — still derived from the transaction date): Name, Code (avatar preview, auto-derived from Name until edited), Yield type, Expected/Target, Payout schedule (never 'none'), plus the conditional Fixed-coupon group (yield type = Fixed coupon) and the "Link to Inzhur" toggle (off by default). The atomic `recordTransaction(tx, newAsset)` path is unchanged.*

## `/overview`

On seed:
- Subtitle contains the current date and "rate 44.83 ₴/$".
- KPIs: **Total capital ₴149,016.36** (dark card; converts with currency toggle) · **Net result +₴4,452.61 / +3.08% since 03.02** (green) · **Deposited ₴143,176** with sub "+ ₴1,387.38 reinvested" · **Free cash ₴7.75**.
- Assets card: 4 rows (color dot, name, meta like "div + cap · 46.1%", value, green +%) + 12px stacked share bar.
- Right stack: "Next payouts" (green tint; bond rows from coupon attributes, REIT row estimated "~₴…" — see D5#7), "Rebalance hint" (**top up ≈₴11,429** — NOT the reference's 11,413, D5#4; "Open Allocation →" navigates), "Income received" **₴5,040.94** (dividends ₴3,641.44 / coupons ₴1,399.50).

## `/balances`

On seed:
- Green area chart of total capital per complete snapshot (Feb→Jul, rising to ~149k).
- Snapshot table, newest first: **27.07 row shows `68 702,10` then "pending" ×3, cash `7,75`, total "—"**; 25.07 row total **`148 943,62`**; rows continue 24.07 → 21.07 (**no 26.07 row**).
- Footer: **"Showing last 6 snapshots · 174 total since 03.02.2026"** + Prev/Next pagination over the full history.
- After saving all 4 quotes on `/` for today: the pending cells fill and the row total computes.

## `/payouts`

On seed:
- Stacked monthly bars (dividends green, coupons blue-gray, value labels on top).
- Cards: **Received ₴5,040.94** (dark) · Upcoming (green tint, attribute-based) · **Reinvested ₴1,387.38 · 27.5% of income**.
- Payout log table: Date | Asset | Type tag | Amount | Destination — destinations show **"reinvested (₴687,02)"**-style when a same-date reinvest exists, else "account". One row is seeded as **472,13 on 10.05** (adjusted per D5#3).
- Recording a new dividend/interest transaction on `/` updates bars + log.

## `/yield`

On seed:
- 4 cumulative-% lines in asset colors with end dots.
- Table: Asset | Invested | Value now | Δ total | Annualized | vs expected. Check: …6475 annualized **+10.9%** (global 03.02 basis — D5#5; NOT +34.5%), REIT Δ **+4.41%**; negative "vs expected" gaps in terracotta with "pp".
- Footnote about 365-day scaling from first purchase (03.02.2026).

## `/attributes`

On seed:
- 2×2 grid of read-only asset cards: avatar + name + yield-type tag + ~6-fact `<dl>`.
- Check: targets 40/40/17/3; **Energy shows "None (price only)"** for payout schedule; bond cards swap in YTM / Coupon amount / Maturity / Next coupon.
- Assets created via the transaction form appear here with their entered attributes.

## `/seasonality`

On seed:
- Day-of-month bar chart: gray 3–5px stubs on no-income days; tall bars on days **3, 10, 25**; **day-10 label ₴3,641** (NOT the reference's ₴3,817 — D5#3); **₴1,240\*** expected bar on day 25 (`*` = expected, from coupon attributes).
- Footnote explaining stubs; 3 insight cards: "Income anchor" (day 10, green tint), "Coupon season" (**February & August (day 25)** carry the big …8976 coupons; …6475 pays in early **June** — full month name, not "Jun"), "Quiet stretch" (days 26–31).

## `/portfolio`

On seed:
- Positions table: Asset | Yield-type tag | Invested | of it reinvested (**REIT 1 171,38 / …6475 216,00**) | Value now | P&L ₴ | P&L % | Share; bold Total row **"Total + cash ₴7.75"** with value **149 016,36**.
- Cards: Best performer **…6475 +5.20%** · Laggard **Energy** · Income engine **REIT** (green tint).

## `/allocation`

On seed:
- Donut (30px ring, asset colors) with center **"₴149k / 4 assets + cash"** + legend.
- "Current vs target" pills: fill = current share, black 2px tick at target. Deltas: REIT **+6.1 (red — overweight)**, …8976 **−6.4 (red)**, …6475 **−0.1 (green — near target)**. Color encodes **off-target severity, not sign**.
- Rebalance plan: numbered actions — top up …8976 **≈₴11,429** (D5#4), trim REIT **≈₴9,095**.

## `/settings` — Settings home (next-phase P2, in progress)

On seed:
- Header **"Settings"** + subtitle "Preferences, data and portfolio configuration".
- 4 stacked white cards (radius 24) in pinned order, staggered fade/slide on mount (D7): **Portfolio → Data → Automation → Appearance**, each with a 10px uppercase microlabel.
- **Portfolio (asset manager, `feat/asset-form`):** the 4 demo assets as rows — color dot · name · short yield label (`div + cap` / `cap` / `coupon` / `coupon`) · outline **Edit** pill · neg-outline **Delete** pill; row hover = soft page tint; footer outline button **"+ Add asset"**.
- **Portfolio (targets editor, `feat/targets-editor`, S4):** after the divider, "TARGETS" microlabel + one row per asset — color dot · name · muted current share (**now 46.1% / 40.3% / 10.6% / 2.9%** on seed) · 72px right-aligned decimal input (prefilled **40 / 40 / 17 / 3**) · muted `%` suffix; below the rows a 12px share-preview bar re-rendering the ENTERED targets (ShareBar; a Σ<100 entry leaves it short of full width); footer: **Σ pill** — on seed green tint **"Σ 100%"** — and dark primary **"Save targets"** on the right. No assets → the whole sub-section (divider + label included) is hidden behind the Portfolio empty state.
- **Data:** dataset-switch placeholder line; **Backup row** — title "Backup", helper mentioning `kubushka-backup-<date>.json`, outline button **"Download backup"** (right side; identical behavior to the removed sidebar pill: downloads the formatVersion-1 envelope, on seed 4 assets / 174 snapshots / 18 transactions + settings); erase/reset placeholder line.
- **Automation:** placeholder copy "Nothing to configure yet — Inzhur quote fetching, coupon suggestions and reminders arrive in the next release."
- **Appearance:** "Currency" row with a light-surface ₴ UAH / $ USD segmented control (sliding thumb like the sidebar toggle); "₴/$ rate" row with a 110px right-aligned decimal input prefilled **44.83**; "Theme and language settings are coming later." placeholder.

Interactions to verify:
1. Sidebar "SETTINGS" group sits between Analytics and the currency toggle; the Settings pill activates (light bg, bold, `aria-current="page"`) on `/settings`.
2. Currency control mirrors the sidebar toggle both ways (flip in Settings → sidebar thumb + logo symbol follow, and vice versa); thumb slides ~300ms (D7).
3. Editing the rate to a valid number (comma or dot decimals) updates the sidebar `$` sub-figure and the Overview subtitle `rate … ₴/$` immediately, and **persists across reload** (`kubushka-settings.state.usdRate`).
4. Invalid input (`0`, `-1`, `abc`, or emptied on blur) → neg border + "Enter a rate above 0." message; the store keeps the last valid rate (headline figures unchanged).
5. "Download backup" disabled while pending; failure shows toast "Could not build the backup — please try again."
6. 360px: cards stack, control rows wrap (label above control), no horizontal scroll; the AssetForm dialog fits unclipped (scrolls internally when tall).
7. **Add asset** opens the AssetForm dialog (create): heading "＋ New asset details", fields Name / Code (avatar preview cycles the next free hue; auto-derives from Name until Code is edited) / Yield type / Expected+Target / Payout schedule (4 options, never 'none') + First purchase (prefilled today); Fixed-coupon group (Maturity, Next coupon, Coupon amount, Reinvest policy) revealed only for yield type = Fixed coupon; "Link to Inzhur" toggle reveals Units (emphasized, units-first) + Fund/Bond kind segment + slug/ISIN text ref + helper line. Submit "Add asset" → toast **"Asset added"**, row appears, new quote row on `/`, card on `/attributes`.
8. **Edit** opens the same dialog prefilled ("Edit asset" / "Save changes"): e.g. changing …8976's Maturity updates the Attributes card and Overview "Next payouts" after save (toast **"Asset updated"**). Editing Energy (payout schedule 'none') additionally offers "None (price only)" in the schedule select — no other asset gets that option.
9. **Delete** opens a confirm dialog stating the cascade: "This removes the asset and everything recorded for it — N transactions and quotes on M days." (on seed: REIT 9 transactions / 174 days, Energy 1/173, …8976 2/171, …6475 3/54) with **"Download backup first"** (flips to "Backup downloaded ✓") + neg **"Delete asset"** → toast **"Asset deleted"**, cascade removes its transactions and quote cells everywhere (no typed-name arming here — that's reserved for erase/reset).
10. Validation: submitting an empty create form highlights fields with the pinned messages ("Name is required." · "Code is 1–2 letters." · "Enter a percentage." · "Enter the number of units." …) + summary "Check the highlighted fields and try again."; the linked-ref message follows the kind ("Enter the fund slug." / "Enter the bond ISIN.").
11. **Targets — Σ recompute:** every keystroke recomputes the Σ pill: exactly 100 → green tint `Σ 100%`; anything else → amber (warn tokens) **"Σ 92% — targets don't add up to 100%"**-style (e.g. …8976 17→9); the pill re-animates on each value change and the preview bar segments re-tween (D7). Comma and dot decimals both accepted (`17,5` = `17.5`).
12. **Targets — non-blocking warn vs blocking error:** Σ≠100 never disables "Save targets" (saving at Σ 92 works); an unparseable/out-of-range entry (`3%`, `abc`, `101`) shows a neg border + right-aligned "Enter a percentage." under the row and DOES disable Save; the preview bar/Σ keep using that row's stored value meanwhile.
13. **Targets — save:** "Save targets" patches only the changed assets via `updateAsset` → toast **"Targets saved"**; …8976 17→9 then `/allocation` shows **"10.6% / 9%"** delta **+1.6** (red, now overweight) and the plan flips to "Trim OVDP …8976 −₴2,435"; Attributes targets follow. Restoring 17 returns the pinned seed checkpoints (−6.4, top up ≈₴11,429). Unsaved drafts are ephemeral (reload discards them).

## Cross-cutting recipes

1. **Derivation integrity:** record a Buy of ₴1,000 on an asset → Portfolio Invested/P&L, Overview KPIs, Allocation shares and the sidebar total all shift consistently; no figure stays frozen (nothing is hard-coded).
2. **Currency scope:** toggle to $ → ONLY logo symbol, sidebar capital and Overview headline KPIs convert; every table (Balances, Payouts, Yield, Portfolio) stays in ₴.
3. **Upsert:** save today's snapshot twice with different values → one row per date in IndexedDB, latest values win.
4. **Reseed:** wipe storage (see top) → app returns exactly to the seed checkpoints above.
5. **A11y sweep:** Tab through a screen — visible 2px focus rings; active nav pill has `aria-current="page"`; hover states on pills/buttons/rows.
6. **Motion sweep (D7):** every interaction animates softly — buttons scale down on press, hover states fade (not snap), route changes fade/slide the content in, chips/pills animate on value change, charts sweep in. With `prefers-reduced-motion: reduce` emulated, all of it collapses to instant.

## Known intentional deviations from the design reference (D5)

Testing agents must NOT report these as bugs (full rationale in `docs/DECISIONS.md` D5):

| Where | Reference shows | App shows (derived) |
|-------|-----------------|---------------------|
| Overview rebalance hint / Allocation plan | top up ₴11,413 | ≈₴11,429 |
| Seasonality day-10 label | ₴3,817 | ₴3,641 |
| Payout log, one dividend row | 648,13 on 12.05 | 472,13 on 10.05 |
| Payout log, 10.06 dividend destination | plain "reinvested" | reinvested (₴484,36) |
| Payout log, 03.06 coupon destination | plain "reinvested" | reinvested (₴216,00) |
| Overview "Next payouts" REIT estimate | ~₴715 | ~₴700 (latest dividend) |
| May payouts bar label | includes 648,13 | includes 472,13 |
