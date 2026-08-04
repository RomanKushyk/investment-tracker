# Navigation map — agentic manual testing

Route-by-route map of the app for manual/agentic verification. Every expected value below is what the app must show **on fresh seed data** (they mirror `docs/BUILD-PLAN.md` fixtures and `docs/DECISIONS.md` D5). Update the Status column and checkpoints whenever a task changes a screen or flow.

> **Next phase in progress** — see `docs/NEXT-PHASE-PLAN.md`. Since Phase 2's dataset split (G4/D16), all seed-pinned checkpoints below run against the **demo** dataset; new routes (`/data`) get their own sections as they land.

## Connecting & resetting

- App runs on **http://localhost:3000** (pinned in vite.config). The dev server is usually already running — check before starting one. If :3000 is occupied by another project, Vite falls back to :3001+ — read the dev-server output for the actual port.
- **Checkpoints also run against the deployed site** — `https://dev.d17m4jf400my6.amplifyapp.com` (see `docs/DEPLOYMENT.md`). Use a **fresh browser profile** when verifying a deploy: the seed only loads into an empty IndexedDB, so an existing profile shows your own data instead of the pinned values.
- **Two datasets, two Dexie DBs (G4/D16):** `kubushka` = **demo** (the reference seed; the app's default) and `kubushka-live` = **live** (starts and stays empty until the user writes into it — it never auto-seeds). The active DB binds at boot from `localStorage['kubushka-settings']` → `state.dataset`; flip it on `/settings` → Data (the app reloads). **All seed-pinned checkpoints in this file run in DEMO mode** — confirm the sidebar DEMO badge before testing.
- **Reset to seed state (demo):** either `/settings` → Data → "Reset demo data…" (type `demo` in the dialog, then confirm), or DevTools → Application → delete IndexedDB database `kubushka` and localStorage keys `kubushka-settings`, `kubushka-draft` → reload. The demo DB reseeds automatically. Deleting the `kubushka-settings` key also resets the dataset flag to demo.
- **Reset live to empty:** either `/settings` → Data → "Erase live data…" while in live mode (type `live` in the dialog, then confirm — checkpoint 17), or DevTools → Application → delete IndexedDB database `kubushka-live` → reload while in live mode (it comes back empty — no reseed).
- Number formats: tables/inputs `68 702,10` (NBSP thousands, comma decimals); prose/KPIs `₴68,629.36`; dates `dd.MM.yyyy`.
- **Do NOT flag D5 deviations as bugs** — see the last section.

## Route index

| Route | Screen | Built in | Status |
|-------|--------|----------|--------|
| — | Shell + sidebar (all routes) | Task 1 (data: Task 2) | done — capital card + logo + functional ₴/$ toggle (Task 7); sidebar narrows to a rail below 640px; third "Settings" nav group (P2); Backup button moved to Settings→Data (P2, was next-phase P1) |
| `/` | Daily quotes (landing) | Task 3 (form: Task 4) | done — quote entry flow + transaction panel live; type select incl. Withdrawal/Redemption (P2 `feat/metrics-exposure`, S10); **"Fetch quotes" button + provenance chips + "Use fetched?" offer (P3 `feat/fetch-quotes`, S1–S3); ghost accrual suggestions + coupon-due card (P3 `feat/fixed-yield`, S4–S5); ReminderStrip above the header (P3 `feat/reminders`, S6)** |
| `/overview` | Overview | Task 5 | done — 5 KPIs currency-aware (5th "Total return (net)" + "Capital gain" relabel + net-of-tax income line + drift chip, P2 `feat/metrics-exposure`); values tween ~300ms on toggle (Task 7); "Next payouts" projects user-created bonds too (P3 `feat/fixed-yield`); ReminderStrip above the ScreenHeader (P3 `feat/reminders`, S6) |
| `/balances` | Balances | Task 6 | done |
| `/payouts` | Payouts | Task 6 | done |
| `/yield` | Yield | Task 6 | done — + Total return & XIRR (ann.) columns (P2 `feat/metrics-exposure`, S9b) |
| `/attributes` | Attributes | Task 5 | done |
| `/seasonality` | Seasonality | Task 6 | done — expected coupon bars project user-created bonds too (P3 `feat/fixed-yield`) |
| `/portfolio` | Portfolio | Task 5 | done — P&L headers relabeled "Capital gain, ₴/%" + footnote, values unchanged (P2 `feat/metrics-exposure`, S9c) |
| `/allocation` | Allocation | Task 6 | done |
| `/settings` | Settings | next-phase P2 | done for P2 — shell + Backup + Appearance + asset manager (create/edit/delete dialogs) + targets editor (Σ pill, share preview, per-asset save) + dataset switch (demo/live, reload-on-toggle) + typed-name erase/reset dialogs (S6, `feat/clear-data`); AssetForm Inzhur ref is a live picker in live / manual in demo (P3 `feat/fetch-quotes`, S7); Automation is complete (P3: the two suggestion switches plus the reminders switch, lead time and restore dismissed, S8); theme/language stay placeholders (P5) |

## Global shell (visible on every route)

Expect: dark 232px sidebar, rounded right edge, internally scrollable (test on a short window — footer cards must never clip).

- Logo circle shows the **current currency symbol** (₴ default), wordmark "Kubushka" / "INVEST TRACKER".
- **DEMO badge (S5/D16):** while the demo dataset is active, an amber `DEMO` pill (warn-tint tokens, radius 999) sits at the right of the logo block on **every route**, `title` tooltip "Demo dataset — reference data. Switch in Settings → Data."; it fades/zooms in on first paint (D7). Below 640px it replaces the "INVEST TRACKER" microline (nav never pushed down). In live mode the badge is absent and the microline always shows.
- Nav: "DAILY ENTRY" group → "Daily quotes" pill; "ANALYTICS" group → 8 pills; "SETTINGS" group → "Settings" pill (next-phase P2 — same pill anatomy/motion, no icon). Active pill = light bg + `aria-current="page"`; clicking navigates without full reload.
- Currency toggle (₴ / $ segmented pill) near the bottom.
- **Total capital card:** value `₴149,016` (whole ₴), sub-line `+3.08% · $3,324.03`. After toggling to $: logo symbol becomes `$`, value/sub-line flip to the USD form (`$…` main, `… · ₴149,016.36` sub); choice **survives a page reload**.
- **No sidebar Backup pill** (removed in next-phase P2 per S7) — the backup download lives on `/settings` → Data.
- **Version badge** at the very bottom (below the capital card, centered muted micro-label): `v` + the `package.json` version — must match it exactly (see `docs/VERSIONING.md`).
- **App-open reminder toast (P3 `feat/reminders`, S6):** on every app OPEN (a full page load), if at least one undismissed reminder exists, exactly ONE plain sonner toast appears carrying the highest-severity banner sentence (+ ` · +N more` when others exist) — on the untouched demo seed that is **"No quotes saved today yet."**. It never repeats on client-side navigation (verified across four route changes) and never fires twice under StrictMode; `Reminders` OFF at boot means no toast at all.
- No horizontal scroll at 360px viewport width on any route.

## `/` — Daily quotes (landing)

On seed:
- Progress pill **"1 of 4 filled"** (green tint) — REIT's quote for 27.07 is already saved.
- 4 asset rows, each: tinted 34px avatar with 2-letter code, name, subline like **"₴68,629.36 yesterday"** (REIT). REIT input pre-filled `68 702,10` with green border + delta chip **"+0.11%"**; the other three empty with placeholders `60 086,09` / `15 846,30` / `4 374,12` and "—" chips.
- Buttons: dark pill **"Save snapshot"**, outline **"Copy yesterday"**; right text **"Last saved 25.07, 21:14"**.
- Yield teaser strip: "Yield since start: REIT **+4.41%** · Energy **+1.48%** · …8976 **+2.96%** · …6475 **+5.20%**" + ghost "Yield chart →" (navigates to `/yield`).
- Side panel: **Transaction** card (panel bg/border tokens, radius 24, "OCCASIONAL" microlabel) + **Recent transactions** card (last 3, "Type · Asset — amount — date"). *"Interest payout" renders with a "Coupon" label per the design reference; the new-asset appears-in-Attributes checkpoint becomes testable once Task 5 ships that screen.*
- **"Fetch quotes" button (P3 `feat/fetch-quotes`, S1) — in demo it is DISABLED**: outline pill with a refresh icon, sitting in the header row between the progress pill and the Date group, carrying a 10px amber `DEMO` micro-tag and the `title` "Fetching is disabled in the demo dataset — switch to Live in Settings → Data." No request can leave the app in demo, and **no provenance chips render on demo rows** (S2) — the 4 rows are byte-identical to the P2 state. The header microcopy ("Inzhur HH:MM") is absent until a fetch has succeeded in the LIVE dataset. All fetch checkpoints therefore run in live (**recipe 0** below).
- **Ghost accrual suggestions (P3 `feat/fixed-yield`, S4) — ACTIVE in demo** (pure local math): on any date with no saved quote, the two seed bonds show a *ghost* suggestion — 9px `SUGGESTED` micro-tag left of the input, the value as **muted text inside a DASHED `faint` input** (never a placeholder, never the green `pos-border`), delta stays `—`, the row is **NOT counted** in "N of M filled", and a dashed **"Use suggested 15 914,25?"** pill + `✕` ("Dismiss suggestion") sits under the input. Value = last quote + ACT/365 coupon accrual × days, **minus any coupon whose date fell in the gap**, clamped at maturity (e.g. on 04.08.2026: …8976 15 846,30 + 10 × 6,79 = **15 914,25**, …6475 4 374,12 + 10 × 1,18 = **4 385,96**; move …8976's next coupon into the gap and the ghost drops by the coupon to 14 674,25). REIT/Energy get no ghost (not fixed-coupon). Accept → real draft (solid green border, ink text, counted, provenance `accrual`); dismiss → plain empty input with yesterday's placeholder back. `Quote suggestions` OFF → no ghosts anywhere.
- **Coupon-due card (P3 `feat/fixed-yield`, S5) — ACTIVE in demo**, rendered in the aside **above** the Transaction panel (order: cards → Transaction → Recent transactions). On the untouched seed there is NO card (both bonds' next coupons are in the future — 25.08.2026 / 03.12.2026); to see one, edit a bond's "Next coupon" to a past date in Settings→Portfolio. The date offered is the next **UNSETTLED** occurrence on the asset's own coupon grid (D23): an occurrence recorded by hand in the Transaction panel — or skipped — hands over to the next one instead of silencing the asset, while the stored `nextCoupon` only ever moves through a confirm. Card = white, radius 20, **dashed `faint`** border, "COUPON DUE" microlabel + warn-tint date pill when overdue, title "OVDP UA4000238976 — coupon ₴1,240.00", body "Scheduled for dd.MM.yyyy. Confirm to record it — the amount is editable, history is never rewritten.", editable **Amount, ₴** (prefilled from the Inzhur `paymentSchedule` forecast when linked, else `couponAmount`, else empty), checkbox "Also record a reinvest of this amount", dark **Record coupon** + ghost **Skip**. `Coupon suggestions` OFF → no cards (aside identical to P2).
- **ReminderStrip (P3 `feat/reminders`, S6) — ACTIVE in demo**, rendered ABOVE the "Daily quotes" header row at full content width (banners radius 16, padding 12×16, severity icon left, ✕ right at opacity .85, 8px gaps, 22px below the last banner). **On the untouched demo seed the strip here is EMPTY** — the only reminder the seed fires is `quote-missing`, and that kind is SUPPRESSED on `/` (the progress pill already says it), so the screen is byte-identical to its P2 self. To see banners here: widen Settings→Automation "Lead time, days" to **21** → the info banner (`pos-tint`) **"OVDP UA4000238976 pays a coupon in 21 days (25.08.2026)."**; edit a bond's "Next coupon" to a past date → the overdue banner (minted `neg-tint` #f0cec7 / `neg-tint-text` #693f35, clock icon) **"OVDP UA4000236475 coupon was due 25.07.2026 — record it on Daily quotes."** — **with NO action link on `/`** (the S5 coupon card is right there). A maturity within 30 days adds an info banner "… matures in N days (dd.MM.yyyy)".
- **Type select (P2 `feat/metrics-exposure`, S10) — 9 options in the pinned order:** Buy · Sell · Deposit · **Withdrawal** · Dividend accrual · Interest payout · Reinvest · **Redemption** · Tax. Both new types record via the existing schema/`recordTransaction` path (demo seed contains neither — no pinned figure moves); a recorded withdrawal shifts `netDeposits` and surfaces the `/overview` ledger-drift chip until the snapshot cash is corrected.

Interactions to verify:
1. Type into an empty input → its delta chip computes live vs yesterday's value; pill count increments ("2 of 4 filled"). Comma and dot decimals both accepted.
2. Typed drafts survive a reload (persisted draft store).
3. "Copy yesterday" fills all 4 inputs with yesterday's quotes.
4. "Save snapshot" → toast **"Snapshot saved"**, "Last saved" updates, IndexedDB row for the date is UPSERTED (re-saving the same day must not add a row).
5. Transaction form: selecting Asset = "+ New asset…" reveals the dashed **New asset details** sub-card; any other asset hides it. Submitting with a new asset creates asset + transaction atomically → toast **"Transaction recorded"**, Recent list updates, new asset appears as a 5th quote row with a cycled avatar tint. *Since next-phase P2 the sub-card renders the shared AssetForm fields (create mode, no First purchase — still derived from the transaction date): Name, Code (avatar preview, auto-derived from Name until edited), Yield type, Expected/Target, Payout schedule (never 'none'), plus the conditional Fixed-coupon group (yield type = Fixed coupon) and the "Link to Inzhur" toggle (off by default). The atomic `recordTransaction(tx, newAsset)` path is unchanged.*
6. **Accept / dismiss a suggestion (S4):** press "Use suggested …?" → the input becomes a real draft with that exact value (green border, ink text), the pill collapses and the progress pill increments; the draft survives a reload with provenance `accrual` in `kubushka-draft`.origins (no chip renders in demo — S2 keeps chips to Inzhur-linked rows in live). Press `✕` instead → the ghost is gone for the selected date and the input is a plain empty one; picking another date re-offers it. Typing over a ghost clears it on the first keystroke.
7. **Record a coupon (S5) — exactly one write, one roll:** with a due coupon, press **Record coupon** → toast **"Coupon recorded"** ("Coupon + reinvest recorded" with the checkbox on), the card collapses, and IndexedDB gains **exactly one** `interest_payout` dated the COUPON's date (`source: 'accrual'`, "Coupon · …8976" in Recent transactions) plus the asset's `nextCoupon` advanced **once** by the schedule **from the occurrence just recorded** (clamped onto `maturity`; at maturity it is flagged and stops suggesting). **Double-click the button** — still one transaction and one roll (StrictMode-safe: the write lives in the click handler behind a ref latch). After a reload the card does not return: a recorded payout within ±7 days of the date dedupes the occurrence — and if the NEXT scheduled date is also already in the past, its card appears immediately (the grid walk, D23). Empty the amount → neg border + **"Enter an amount."** (wired to the input via `aria-describedby`) and nothing is written. NO `tax` row is ever created (G5/D13).
8. **Skip (S5) writes nothing, and the next date still suggests:** press **Skip** → the card collapses, the transaction count is unchanged, `nextCoupon` is unchanged, and `kubushka-settings.state.dismissedReminders` gains `coupon:<assetId>:<date>`. The NEXT coupon date suggests normally — to see it in one step, set a bond to **Monthly** with a "Next coupon" two months in the past: skipping the first card immediately raises a card (and an overdue banner) for the following month. Restore every dismissal via Settings→Automation → "Restore dismissed" (checkpoint 19).
9. **Dismiss a banner (S6):** press a banner ✕ ("Dismiss reminder") → it fades/slides out over ~220ms and the banners below move up; `kubushka-settings.state.dismissedReminders` gains the banner's DERIVED id (`quote-missing:<date>` / `coupon:<assetId>:<date>` / `coupon-overdue:<assetId>:<date>` / `maturity:<assetId>:<date>`) and it stays hidden **across a reload**. Ids expire by themselves: tomorrow's `quote-missing` is a new id, and so is the next coupon date. Restore = Settings→Automation. Under `prefers-reduced-motion` the banner disappears instantly (the write still happens).
10. **Skipping a coupon card also silences its overdue banner** (shared derived id, D21/D22): press **Skip** on an overdue coupon's S5 card → the matching `coupon-overdue` banner is gone too. Dismissing the BANNER does not remove the card.

## `/overview`

On seed:
- **ReminderStrip (P3 `feat/reminders`, S6) — ACTIVE in demo**, rendered ABOVE the "Overview" header. On the untouched demo seed (any day with no saved snapshot for today) exactly ONE banner: warn (`warn-tint` #f0e6cb / `warn-tint-text` #6b5527, circle-alert icon) **"No quotes saved today yet."** + the bold action link **"Enter quotes →"** (navigates to `/`) + ✕. Save all 4 quotes for today on `/` → the banner is gone; a PARTIAL day (some assets still pending) keeps it. When several fire the order is overdue (`neg-tint`) → warn → info (`pos-tint`), by date inside a severity; beyond 3 they collapse behind a muted pressable **"+N more reminders"** that expands the strip in place. Overdue coupon banners carry **"Open Daily quotes →"** here. Empty / all-dismissed / `Reminders` OFF → the strip renders NOTHING (zero height, no placeholder, no layout shift).
- Subtitle contains the current date and "rate 44.83 ₴/$".
- KPIs — **5 cards since P2 `feat/metrics-exposure` (S9a)**, all currency-aware, staggered mount order Total capital → Capital gain → Total return (net) → Deposited → Free cash:
  - **Total capital ₴149,016.36** (dark card; converts with currency toggle).
  - **Capital gain +₴4,452.61 / +3.08% since 03.02** (green) — *relabeled from "Net result" in P2; value/sub byte-identical (D5-pinned)*.
  - **Total return (net) +₴5,839.99** with sub **"+4.08% on net deposits"** (green; new total-return-family KPI = totalCapital − netDeposits with globalRoi sub; tweens + converts like its siblings; sub "—" muted when netDeposits ≤ 0).
  - **Deposited ₴143,176** with sub "+ ₴1,387.38 reinvested".
  - **Free cash ₴7.75** — **NO ledger-drift chip on untouched demo** (drift 0 by construction, S9d). After recording e.g. an unmatched Withdrawal ₴100 the amber warn-tint pill **"Ledger drift +₴100.00"** (U+2212 on negatives) appears under the sub with a `title` tooltip; it disappears once |stored − derived| ≤ ₴0.01 again.
- Assets card: 4 rows (color dot, name, meta like "div + cap · 46.1%", value, green +%) + 12px stacked share bar.
- Right stack: "Next payouts" (green tint; bond rows from coupon attributes, REIT row estimated "~₴…" — see D5#7), "Rebalance hint" (**top up ≈₴11,429** — NOT the reference's 11,413, D5#4; "Open Allocation →" navigates), "Income received" **₴5,040.94** (dividends ₴3,641.44 / coupons ₴1,399.50, **plus the P2 second sub line "net of tax ₴5,040.94"** — equals gross on demo, no seeded tax rows).

## `/balances`

On seed:
- Green area chart of total capital per complete snapshot (Feb→Jul, rising to ~149k).
- Snapshot table, newest first: **27.07 row shows `68 702,10` then "pending" ×3, cash `7,75`, total "—"**; 25.07 row total **`148 943,62`**; rows continue 24.07 → 21.07 (**no 26.07 row**).
- Footer: **"Showing last 6 snapshots · 174 total since 03.02.2026"** + Prev/Next pagination over the full history.
- After saving all 4 quotes on `/` for today: the pending cells fill and the row total computes.

## `/payouts`

On seed:
- Stacked monthly bars (dividends green, coupons blue-gray, value labels on top).
- Cards: **Received ₴5,040.94** (dark) · Upcoming (green tint, attribute-based) · **Reinvested ₴1,387.38 · 27.5% of received income**.
- Payout log table: Date | Asset | Type tag | Amount | Destination — destinations show **"reinvested (₴687,02)"**-style when a same-date reinvest exists, else "account". One row is seeded as **472,13 on 10.05** (adjusted per D5#3).
- Recording a new dividend/interest transaction on `/` updates bars + log.

## `/yield`

On seed:
- 4 cumulative-% lines in asset colors with end dots.
- Table (8 columns since P2 `feat/metrics-exposure`, S9b): Asset | Invested | Value now | Δ total | Annualized | **Total return** | **XIRR (ann.)** | vs expected. Existing-column checks unchanged: …6475 annualized **+10.9%** (global 03.02 basis — D5#5; NOT +34.5%), REIT Δ **+4.41%**; negative "vs expected" gaps in terracotta with "pp".
- **Total return column** (signed bold, net of taxes, incl. payouts; ÷ investedOwn): REIT **+10.12%** · Energy **+1.48%** · …8976 **+10.65%** · …6475 **+10.96%**. May disagree with Δ total by design (illusion-of-loss, FORMULA-AUDIT §2).
- **XIRR column** (plain ink, 1 dp, money-weighted): REIT **+23.0%** · Energy **+3.1%** · …8976 **+25.8%** · …6475 **+99.4%** (D18: derived figures, not D5-pinned; the extension mock's +99.5% was illustrative rounding). Header reads **"XIRR (ann.)"** while portfolio history < 365 days (demo: yes, 174 days); plain "XIRR" after a full year. Null/unquoted metrics render "—" muted.
- Table min-width grew (780px) — it scrolls INSIDE the card; the page still has no horizontal scroll at 360px.
- Footnote (extended in P2): "Annualized = total Δ scaled to 365 days from first purchase (03.02.2026). Coupons count toward Δ on accrual. Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized — with under a year of history, treat it as an extrapolation."

## `/attributes`

On seed:
- 2×2 grid of read-only asset cards: avatar + name + yield-type tag + ~6-fact `<dl>`.
- Check: targets 40/40/17/3; **Energy shows "None (price only)"** for payout schedule; bond cards swap in YTM at purchase / Coupon / Maturity / Next coupon.
- Assets created via the transaction form appear here with their entered attributes.

## `/seasonality`

On seed:
- Day-of-month bar chart: gray 3–5px stubs on no-income days; tall bars on days **3, 10, 25**; **day-10 label ₴3,641** (NOT the reference's ₴3,817 — D5#3); **₴1,240\*** expected bar on day 25 (`*` = expected, from coupon attributes).
- Footnote explaining stubs; 3 insight cards: "Income anchor" (day 10, green tint), "Coupon season" (**February & August (day 25)** carry the big …8976 coupons; …6475 pays in early **June** — full month name, not "Jun"), "Quiet stretch" (days 26–31).

## `/portfolio`

On seed:
- Positions table: Asset | Yield-type tag | Invested | of it reinvested (**REIT 1 171,38 / …6475 216,00**) | Value now | **Capital gain, ₴** | **Capital gain, %** | Share; bold Total row **"Total + cash ₴7.75"** with value **149 016,36**. *Headers relabeled from "P&L, ₴/%" in P2 `feat/metrics-exposure` (S9c) — every cell value identical to pre-P2 output (+2 902,10/+4.41% … total +4 452,61/+3.08%).*
- Footnote under the table (P2): "Capital gain = value − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen."
- Cards: Best performer **…6475 +5.20%** · Laggard **Energy** · Income engine **REIT** (green tint).

## `/allocation`

On seed:
- Donut (30px ring, asset colors) with center **"₴149k / 4 assets + cash"** + legend.
- "Current vs target" pills: fill = current share, black 2px tick at target. Deltas: REIT **+6.1 (red — overweight)**, …8976 **−6.4 (red)**, …6475 **−0.1 (green — near target)**. Color encodes **off-target severity, not sign**.
- Rebalance plan: numbered actions — top up …8976 **≈₴11,429** (D5#4), trim REIT **≈₴9,096** (derived 9 095,56, prose-rounded).

## `/settings` — Settings home (next-phase P2)

On seed:
- Header **"Settings"** + subtitle "Preferences, data and portfolio configuration".
- 4 stacked white cards (radius 24) in pinned order, staggered fade/slide on mount (D7): **Portfolio → Data → Automation → Appearance**, each with a 10px uppercase microlabel.
- **Portfolio (asset manager, `feat/asset-form`):** the 4 demo assets as rows — color dot · name · short yield label (`div + cap` / `cap` / `coupon` / `coupon`) · outline **Edit** pill · neg-outline **Delete** pill; row hover = soft page tint; footer outline button **"+ Add asset"**.
- **Portfolio (targets editor, `feat/targets-editor`, S4):** after the divider, "TARGETS" microlabel + one row per asset — color dot · name · muted current share (**now 46.1% / 40.3% / 10.6% / 2.9%** on seed) · 72px right-aligned decimal input (prefilled **40 / 40 / 17 / 3**) · muted `%` suffix; below the rows a 12px share-preview bar re-rendering the ENTERED targets (ShareBar; a Σ<100 entry leaves it short of full width); footer: **Σ pill** — on seed green tint **"Σ 100%"** — and dark primary **"Save targets"** on the right. No assets → the whole sub-section (divider + label included) is hidden behind the Portfolio empty state.
- **Data (dataset switch, `feat/dataset-split`, S5):** "Dataset" row — helper "Demo holds the built-in reference portfolio. Live starts empty and holds your real data. Switching reloads the app."; light-surface **Demo / Live** segmented control (track panel, white sliding thumb, active segment bold ink) — Demo active on seed. Then the **Backup row** — title "Backup", helper mentioning `kubushka-backup-<date>.json`, outline button **"Download backup"** (right side; identical behavior to the removed sidebar pill: downloads the formatVersion-1 envelope, on seed 4 assets / 174 snapshots / 18 transactions + settings; the envelope's `dataset` field = the active dataset). Then the **Danger zone row** (`feat/clear-data`, S6): helper "Both actions ask for a typed confirmation and offer a backup first." + one neg-outline trigger per dataset — **"Reset demo data…"** in demo, **"Erase live data…"** in live — both opening the typed-name AlertDialog (checkpoints 16–17).
- **Automation (P3 `feat/fixed-yield`, S8):** two `SettingRow`s with the pinned switch anatomy (track 40×22, off `hairline`/`panel-border`, on `ink`, 16px white thumb), both **ON by default** and identical in demo and live — **"Quote suggestions"** ("Pre-fill ghost values for unquoted fixed-coupon assets from coupon accrual. Suggestions stay ghosts until you accept them.") and **"Coupon suggestions"** ("Offer one-tap recording when a coupon date arrives. Every entry is confirmed by you — amounts stay editable."), then (P3 `feat/reminders`) a third switch **"Reminders"** ("In-app banners for missing quotes, upcoming and overdue coupons, and maturities. Nothing leaves the app.", ON by default) with two sub-rows indented 12px behind a hairline left rule, present only while it is on: **"Lead time, days"** ("How many days ahead coupon reminders appear.") with a 72px right-aligned input prefilled **7**, and **"Dismissed reminders"** ("Dismissed banners stay hidden until their date passes.") with the outline button **"Restore dismissed"** — disabled and count-free at 0, otherwise **"Restore dismissed (N)"**. Fetching itself has no toggle — it is a manual click by construction.
- **Appearance:** "Currency" row with a light-surface ₴ UAH / $ USD segmented control (sliding thumb like the sidebar toggle); "₴/$ rate" row with a 110px right-aligned decimal input prefilled **44.83**; "Theme and language settings are coming later." placeholder.

Interactions to verify:
1. Sidebar "SETTINGS" group sits between Analytics and the currency toggle; the Settings pill activates (light bg, bold, `aria-current="page"`) on `/settings`.
2. Currency control mirrors the sidebar toggle both ways (flip in Settings → sidebar thumb + logo symbol follow, and vice versa); thumb slides ~300ms (D7).
3. Editing the rate to a valid number (comma or dot decimals) updates the sidebar `$` sub-figure and the Overview subtitle `rate … ₴/$` immediately, and **persists across reload** (`kubushka-settings.state.usdRate`).
4. Invalid input (`0`, `-1`, `abc`, or emptied on blur) → neg border + "Enter a rate above 0." message; the store keeps the last valid rate (headline figures unchanged).
5. "Download backup" disabled while pending; failure shows toast "Could not build the backup — please try again."
6. 360px: cards stack, control rows wrap (label above control), no horizontal scroll; the AssetForm dialog fits unclipped (scrolls internally when tall).
7. **Add asset** opens the AssetForm dialog (create): heading "＋ New asset details", fields Name / Code (avatar preview cycles the next free hue; auto-derives from Name until Code is edited) / Yield type / Expected+Target / Payout schedule (4 options, never 'none') + First purchase (prefilled today); Fixed-coupon group (Maturity, Next coupon, Coupon amount, Reinvest policy) revealed only for yield type = Fixed coupon; "Link to Inzhur" toggle reveals Units (emphasized, units-first) + Fund/Bond kind segment + the ref field + helper line. Submit "Add asset" → toast **"Asset added"**, row appears, new quote row on `/`, card on `/attributes`. **Ref field since P3 `feat/fetch-quotes` (S7):** in **demo** it is the P2 manual text input plus the note "Live list is disabled in demo — enter the slug or ISIN manually." and no mode link; in **live** it is a **picker** ("Pick from Inzhur…") that fetches the feed on first open — funds read "Inzhur REIT · inzhur-reit", bonds "UA4000238976 · matures 24.03.2027" (list capped ~240px, scrolls; the trigger shows the primary text alone) — with an always-available "Enter manually" ↔ "Pick from the list" round-trip (the ref string is preserved both ways, and it is the same slug/ISIN the manual field stored). Offline/error with no cache → the manual input plus the muted note "Couldn't load the list — enter it manually." (never `neg` — linking is never blocked); a last-good cache feeds the list with a warn footer "as of dd.MM". The group helper now reads "Linked assets are valued as units × the fetched sell price — use Fetch quotes on Daily quotes."
8. **Edit** opens the same dialog prefilled ("Edit asset" / "Save changes"): e.g. changing …8976's Maturity updates the Attributes card and Overview "Next payouts" after save (toast **"Asset updated"**). Editing Energy (payout schedule 'none') additionally offers "None (price only)" in the schedule select — no other asset gets that option. Amount prefills use the pinned input format: …8976's Coupon amount shows **`1 240,00`** (NBSP + comma, fmtTable); Inzhur units prefill grouped without forced decimals (`15`, `6 164`); percent fields stay dot-decimal (`16.4`).
9. **Delete** opens a confirm dialog stating the cascade: "This removes the asset and everything recorded for it — N transactions and quotes on M days." (on seed: REIT 9 transactions / 174 days, Energy 1/173, …8976 2/171, …6475 3/54) with **"Download backup first"** (flips to "Backup downloaded ✓") + neg **"Delete asset"** → toast **"Asset deleted"**, cascade removes its transactions and quote cells everywhere. Alert semantics like 16–17 (`role="alertdialog"`, clicking the overlay does NOT dismiss, Esc cancels) but no typed-name arming — that's reserved for erase/reset.
10. Validation: submitting an empty create form highlights fields with the pinned messages ("Name is required." · "Code is 1–2 letters." · "Enter a percentage." · "Enter the number of units." …) + summary "Check the highlighted fields and try again."; the linked-ref message follows the kind ("Enter the fund slug." / "Enter the bond ISIN.").
11. **Targets — Σ recompute:** every keystroke recomputes the Σ pill: exactly 100 → green tint `Σ 100%`; anything else → amber (warn tokens) **"Σ 92% — targets don't add up to 100%"**-style (e.g. …8976 17→9); the pill re-animates on each value change and the preview bar segments re-tween (D7). Comma and dot decimals both accepted (`17,5` = `17.5`).
12. **Targets — non-blocking warn vs blocking error:** Σ≠100 never disables "Save targets" (saving at Σ 92 works); an unparseable/out-of-range entry (`3%`, `abc`, `101`) shows a neg border + right-aligned "Enter a percentage." under the row and DOES disable Save; the preview bar/Σ keep using that row's stored value meanwhile.
13. **Targets — save:** "Save targets" patches only the changed assets via `updateAsset` → toast **"Targets saved"**; …8976 17→9 then `/allocation` shows **"10.6% / 9%"** delta **+1.6** (red, now overweight) and the plan flips to "Trim OVDP …8976 −₴2,435"; Attributes targets follow. Restoring 17 returns the pinned seed checkpoints (−6.4, top up ≈₴11,429). Unsaved drafts are ephemeral (reload discards them).
14. **Dataset flip → live:** click **Live** → both segments briefly disable (pre-reload lockout) → the app reloads with `kubushka-settings.state.dataset = "live"`. After reload: **no DEMO badge**, every screen shows its v1 empty state (sidebar total **₴0** / "+0.00% · $0.00", Daily quotes "0 of 0 filled", Balances "No snapshots yet…", zero-value Overview KPIs — no crash anywhere), Settings→Portfolio shows "No assets yet — add your first asset to start tracking.", the Danger zone row offers **"Erase live data…"** (never "Reset demo data…"). Reloading again stays empty — live NEVER auto-seeds (not even the `meta` seeded flag is written). IndexedDB now contains both `kubushka` and `kubushka-live`.
15. **Dataset flip → demo:** click **Demo** → reload → DEMO badge returns and every seed checkpoint above is intact (the demo DB was untouched by the excursion to live).
16. **Reset demo data (typed confirm, S6):** in demo, "Reset demo data…" opens the AlertDialog — title "Reset demo data?", body about replacing the demo dataset, label "Type demo to confirm" with the input **auto-focused**; the danger button **"Reset demo data" stays disabled until the input matches `demo`** (case-insensitive, trimmed — `" DEMO "` arms, `dem` doesn't); **"Download backup first"** downloads the active-dataset envelope WITHOUT closing the dialog and flips to a muted inert "Backup downloaded ✓"; ghost Cancel / Esc close without changes (clicking the overlay does NOT — alert semantics). Armed confirm → `clearAll({reseed:true})` → toast **"Demo data reset"** and all seed checkpoints (4/174/18 rows, ₴149,016.36 …) are restored after any demo edits.
17. **Erase live data (typed confirm, S6):** flip to live and record something (e.g. add an asset + save a snapshot + type a quote draft on `/`); Settings→Data shows **"Erase live data…"** → dialog "Erase live data?" (body mentions the quote draft being cleared and settings kept), label "Type live to confirm", same arming/backup mechanics as 16. Armed **"Erase live data"** → `clearAll({reseed:false})` → toast **"Live data erased"**, every screen shows its empty state without a reload (full query invalidation), the Daily-quotes draft is gone (`kubushka-draft` reset), and `kubushka-settings` (currency/rate/dataset) is retained. **Reload → still empty** (meta `seeded` flag; live never auto-seeds). Demo dataset untouched throughout — flip back to demo and every seed checkpoint holds.

18. **Automation switches (S8):** flipping either switch takes effect on `/` **without a reload** (Quote suggestions off → every ghost, `SUGGESTED` tag and "Use suggested …?" pill disappears; Coupon suggestions off → every coupon-due card disappears) and persists to `kubushka-settings.state.autoQuoteSuggest` / `.couponSuggest`; a legacy payload without them hydrates to ON. The thumb slides ~220ms (D7); both are keyboard-operable with a visible focus ring.

19. **Reminders switch + lead time + restore (S8, `feat/reminders`):** flipping **Reminders** off collapses both sub-rows (~300ms fade/slide, symmetric on re-enable) and removes the strip and the app-open toast everywhere immediately — no reload — persisting to `kubushka-settings.state.remindersEnabled` (the S5 coupon CARDS are governed by `couponSuggest`, not by this switch). **Lead time:** typing `21` re-windows coupon banners instantly (the seed's 25.08 coupon, 21 days out, appears on `/` and `/overview`) and persists to `.reminderLeadDays`; an invalid entry (`0`, `31`, `45`, `7.5`, `abc`, or emptied on blur) shows a neg border + **"Enter 1–30 days."** and **never writes** — the last valid lead time keeps windowing the banners. **Restore dismissed:** the label counts current dismissals ("Restore dismissed (1)"); pressing it clears `dismissedReminders` entirely, re-surfaces every banner still in window (including coupons skipped from an S5 card) and toasts **"Dismissed reminders restored"**; at 0 it is disabled and drops the count.

## Cross-cutting recipes

0. **Fetch quotes end-to-end (LIVE dataset, P3 `feat/fetch-quotes` S1–S3 — needs the internet):** flip to live (checkpoint 14), Settings→Portfolio → "Add asset" → yield type "Dividends + capitalization" → Link to Inzhur ON → Units `6164` → the **Fund picker** ("Pick from Inzhur…") → pick "Inzhur REIT · inzhur-reit" → Add asset. On `/` the button is enabled: press it →
   - the row's draft fills with **units × the live sell price** (e.g. 6 164 × 11.0288 = `67 981,52` — a live figure, so it moves daily; the invariant is `units × sellUAH` rounded to kopecks), chip **`AUTO` + "fetched HH:MM"** (Kyiv clock), the progress pill counts it, header microcopy **"Inzhur HH:MM"** (muted);
   - **nothing is saved** — IndexedDB `kubushka-live.snapshots` stays empty until you press "Save snapshot" (G5);
   - type over the value → chip flips to **`MANUAL`** on the first keystroke; press Fetch again → **your value is untouched** and a dashed **"Use fetched 67 981,52?"** pill + `✕` (aria-label "Keep my value") appears under the input. Accept → value replaced, chip back to `AUTO`; dismiss → nothing changes and the offer stays away until the next fetch resolve. Typing exactly the fetched number produces NO offer;
   - a second press while the payload is still fresh (before the feed's next ~13:00 Kyiv refresh) re-serves it with **no new network request**;
   - **DevTools → Network → Offline, then press Fetch:** label "Fetching…" → back to idle (never red) + toast **"Couldn't reach Inzhur — check your connection."** with the action **"Use values from dd.MM"**; pressing the action applies the cached payload — typed rows are still only OFFERED (warn variant "Use 67 981,52 (as of dd.MM)?"), filled rows get the amber **`AS OF dd.MM`** chip. Chips and drafts survive a reload (`kubushka-draft`.origins);
   - a live asset with NO Inzhur link → button disabled with the `title` "No Inzhur-linked assets yet — link one in Settings → Portfolio.".
   Clean-up: delete the asset (or "Erase live data…"), then flip back to demo.
1. **Derivation integrity:** record a Buy of ₴1,000 on an asset → Portfolio Invested/P&L, Overview KPIs, Allocation shares and the sidebar total all shift consistently; no figure stays frozen (nothing is hard-coded).
2. **Currency scope:** toggle to $ → ONLY logo symbol, sidebar capital and Overview headline KPIs convert; every table (Balances, Payouts, Yield, Portfolio) stays in ₴.
3. **Upsert:** save today's snapshot twice with different values → one row per date in IndexedDB, latest values win.
4. **Reseed:** wipe storage (see top) → app returns exactly to the seed checkpoints above.
5. **A11y sweep:** Tab through a screen — visible 2px focus rings; active nav pill has `aria-current="page"`; hover states on pills/buttons/rows.
6. **Motion sweep (D7):** every interaction animates softly — buttons scale down on press, hover states fade (not snap), route changes fade/slide the content in, chips/pills animate on value change, charts sweep in; dialogs close with a symmetric 220ms fade/zoom-out (never vanish in-frame) and the AssetForm fixed-coupon/Inzhur groups slide OUT on hide (300ms) as well as in. With `prefers-reduced-motion: reduce` emulated, all of it collapses to instant.

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
