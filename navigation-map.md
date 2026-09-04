# Navigation map

Expected values on the demo seed, rendered in Ukrainian; English formatting is noted in parentheses where it differs.

Do not flag the deviations in the last section as bugs.

## Connecting & resetting

- App runs on http://localhost:3000 (vite.config). The dev server is usually already running — check before starting one. If :3000 is occupied, Vite falls back to :3001+.
- Checkpoints also run against the deployed site: production `https://quirenote.com` serves `main`, `https://dev.quirenote.com` serves `dev` and is behind HTTP basic auth (credentials not in this repo). Verify a change on dev, confirm a release on production. Use a fresh browser profile when verifying a deploy — the seed only loads into an empty IndexedDB.
- Two datasets, two Dexie DBs: `quirenote` = demo (reference seed, the app's default) and `quirenote-live` = live (starts and stays empty until the user writes into it — never auto-seeds). The active DB binds at boot from `localStorage['quirenote-settings'] → state.dataset`; flip it on `/settings` → Data (the app reloads). All seed-pinned checkpoints in this file run in DEMO mode — confirm the sidebar DEMO badge before testing.
- Reset to seed state (demo): `/settings` → Data → "Reset demo data…" (type `demo`, confirm), or DevTools → Application → delete IndexedDB `quirenote` and localStorage keys `quirenote-settings`, `quirenote-draft` → reload. The demo DB reseeds automatically.
- Reset live to empty: `/settings` → Data → "Erase live data…" while in live mode (type `live`, confirm), or delete IndexedDB `quirenote-live` → reload while in live mode (comes back empty, no reseed).
- Number formats follow the language, and the default is Ukrainian: `68 702,10` · `68 629,36 ₴` · `+3,08 %` · `12.08.2026` (NBSP thousands, comma decimals, space before %). English: `68,702.10` · `₴68,629.36` · `+3.08%` · `12 Aug 2026`. Tables stay in ₴ in both languages.
- UI copy below is quoted in ENGLISH, the dictionary's canonical side; the app shows the Ukrainian of the same key by default. A label whose wording differs but whose KEY matches is not a defect.

## Routes

| Route | Screen | Checkpoints |
|---|---|---|
| — | Shell + sidebar (all routes) | capital card, logo, ₴/$ toggle, nav, DEMO badge, version badge, reminder toast |
| `/` | Daily quotes (landing) | quote rows, fetch quotes, ghost accrual suggestions, coupon-due card, reminder strip, transaction entry |
| `/transactions` | Transactions | full ledger + entry form, deposit/withdrawal rows, units toggle |
| `/overview` | Overview | 5 KPIs, next payouts, rebalance hint, income received, period window |
| `/balances` | Balances | area chart, snapshot table, pagination |
| `/payouts` | Payouts | bars, received/upcoming/reinvested cards, payout log |
| `/yield` | Yield | per-asset yield table, total return, XIRR, period window |
| `/attributes` | Attributes | asset fact cards, derived coupon, YTM |
| `/seasonality` | Seasonality | day/month bar chart, insight cards, period window |
| `/portfolio` | Portfolio | positions table, edit mode, delete cascade |
| `/allocation` | Allocation | donut, current-vs-target, edit mode, rebalance plan |
| `/settings` | Settings | Data (dataset/backup/import/danger zone), Automation, Appearance |

## Shell

**At and above 768px** (`md`, the app's one breakpoint): dark **244px** sidebar, padding 16, right edge rounded **30** (concentric with the logo card's 14). The aside does not scroll with the page; it is three bands — lockup, scrolling nav, pinned cluster — so the currency toggle and capital card stay on screen at 740px and 640px of viewport height. On a short window a **12px rail** appears in the nav band, 8px in from its edge, narrowing the nav by 28.

**Below 768px there is no rail at all** — see Mobile shell below.

**Shapes:** nothing in the app is a capsule. Controls take `round(min(w,h) × 0.26)` — badges 5-6, segments 7, small buttons 8, inputs and nav pills 9, larger buttons and segmented boxes 10, plus 4 and 7 (the price-mode toggle's 15px segments round to 4, its track to 4+3=7). Only asset avatars, colour dots and the decorative blob stay round — the logo mark's arc is drawn, not a radius. A `rounded-full` capsule anywhere is a regression.

- **Logo lockup card** (`#333338`, radius 14): 36px Q-arrow mark — an open Q, gapped top-right, whose tail is a sand arrow — beside the wordmark "Quirenote" / "INVEST TRACKER". No disc behind it; the mark sets the card's height (36 + 20 padding = **56px**). Wordmark JetBrains Mono ExtraBold, −2%, **14px**; tagline IBM Plex Sans 9.5px. The arrow is `--color-brand-sand` and does not change with theme; the arc changes via `currentColor`. Neither part carries the currency symbol or changes on toggle. Same mark in the browser tab (`favicon.svg`, theme-aware) and as the iOS home-screen icon.
- **DEMO badge:** while demo is active, an amber `DEMO` badge (radius 5, scale .75) pins to the top-right corner of the logo card on every route — absolutely positioned, card stays 56px tall — `title` "Demo dataset — reference data. Switch in Settings → Data."; fades/zooms in on first paint; steps left when the desktop collapse control shares that corner. Absent in live mode.
- Nav: "DAILY ENTRY" group → "Daily quotes" pill; "ANALYTICS" group → 8 pills; "SETTINGS" group → "Settings" pill. Active pill = light bg + `aria-current="page"`; navigates without full reload.
- **Currency toggle** (₴/$ segmented control, radius 13, padding 6, segments 7) near the bottom — the only currency indicator in the sidebar. Borderless.
- **Total capital card** (radius 13): value `149 016 ₴` (whole ₴), sub-line `+3,08 % · 3 324,03 $`. Toggling to $: the logo does not change, only the toggle's thumb moves; value/sub-line flip to the USD form (`$…` main, `… · 149 016,36 ₴` sub). The choice does NOT survive a page reload.
- No sidebar Backup pill — the download lives on `/settings` → Data.
- **Version badge** at the very bottom: `v` + the `package.json` version — must match it exactly.
- **App-open reminder toast:** on every app OPEN, if at least one undismissed reminder exists, exactly ONE plain toast appears carrying the highest-severity banner sentence (+ ` · +N more` when others exist) — on the untouched demo seed that is "No quotes saved today yet." Never repeats on client-side navigation; `Reminders` OFF at boot means no toast.
- **No horizontal scroll at 360px on any route** — measure as `document.documentElement.scrollWidth − clientWidth`, in Ukrainian (the wider language).

## `/` — Daily quotes (landing)

On seed (Date field on 27.07.2026, the seed's last saved day):
- Progress pill **"1 of 4 filled"** (green tint) — REIT's quote for 27.07 is already saved. On any later date nothing is saved yet, so the pill reads "0 of 4 filled", every input is empty, and the two bonds show ghost suggestions (below).
- 4 asset rows, each: tinted 34px avatar with 2-letter code, name, subline like **"68 629,36 ₴ yesterday"** (REIT). REIT input pre-filled `68 702,10` with green border + delta chip **"+0,11 %"**; the other three empty with placeholders `60 086,09` / `15 846,30` / `4 374,12` and "—" chips.
- Buttons: dark pill **"Save snapshot"**, outline **"Copy yesterday"**; "Last saved 25.07, 21:14" sits at the foot of the rail (or in the row, below the wrap point).
- **Side rail** (permanent, same order on every day): coupon-due card (only on a day one is due) → pending-change block ("This snapshot changes", "Nothing entered yet" on an untouched draft, else the signed delta + "N of M assets"; its baseline is the previous day's quote, the same figure each row's subline shows) → yield card ("Yield since start", one row per asset, right-aligned figures tinted by sign, then "Yield chart →" to `/yield`) → "Last saved".
- **Two-column layout, matching `/payouts`:** `grid-cols-[1.6fr_1fr]`, `gap-3.5`, one column below `lg`. Measured at 1440: rows 683,1, gap 14, side column 426,9, horizontal overflow 0.
- **Header is identity and progress only:** title + "N of M filled" pill + subtitle. No date, no fetch button, no parse diagnostics.
- **Inputs sit bare at the top of the LEFT column**, above the rows: "Fetch quotes" with its freshness line on the left, "Date" with its picker on the right, parse diagnostics beneath both. No card/panel surface around them.
- **The side column holds no control**, only outcomes.
- **"Fetch quotes" button — DISABLED in demo**: outline pill with a refresh icon in the side column's fetch card, carrying a 10px amber `DEMO` micro-tag and the `title` "Fetching is disabled in the demo dataset — switch to Live in Settings → Data." No provenance chips render on demo rows — the 4 rows are otherwise unchanged. All fetch checkpoints run in live (recipe 0 below).
- **Ghost accrual suggestions — ACTIVE in demo** (pure local math): on any date with no saved quote, the two seed bonds show a ghost suggestion — 9px `SUGGESTED` micro-tag left of the input, the value as muted text inside a dashed `faint` input (never a placeholder, never green), delta stays "—", the row is NOT counted in "N of M filled", and a dashed **"Use suggested 15 914,25?"** pill + ✕ ("Dismiss suggestion") sits under the input. Value = last quote + ACT/365 coupon accrual × days, minus any coupon whose date fell in the gap, clamped at maturity (e.g. on 04.08.2026: …8976 15 846,30 + 10 × 6,79 = **15 914,25**, …6475 4 374,12 + 10 × 1,18 = **4 385,96**). REIT/Energy get no ghost. Accept → real draft (solid green border, ink text, counted); dismiss → plain empty input with yesterday's placeholder back. "Quote suggestions" OFF → no ghosts anywhere.
- **Coupon-due card — ACTIVE in demo**, the only thing in the aside besides the permanent blocks. On the untouched seed there is NO card (both bonds' next coupons are in the future — 25.08.2026 / 03.12.2026); to see one, edit a bond's "Next coupon" to a past date on `/portfolio`. The offered date is the next UNSETTLED occurrence on the asset's own coupon grid. Card = white, radius 20, dashed `faint` border, "COUPON DUE" microlabel + warn-tint date pill when overdue, title "OVDP UA4000238976 — coupon 1 240,00 ₴", body "Scheduled for dd.MM.yyyy. Confirm to record it — the amount is editable, history is never rewritten.", editable **Amount, ₴** (prefilled from the derived rate × units, else the legacy stored amount, else empty), checkbox "Also record a reinvest of this amount", dark **Record coupon** + ghost **Skip**. "Coupon suggestions" OFF → no cards.
- **ReminderStrip — ACTIVE in demo**, above the header row. On the untouched demo seed the strip here is EMPTY — the only reminder the seed fires is `quote-missing`, suppressed on `/` because the progress pill already says it. To see banners: widen Settings→Automation "Lead time, days" to 21 → info banner "OVDP UA4000238976 pays a coupon in 21 days (25.08.2026)."; edit a bond's "Next coupon" to a past date → overdue banner "OVDP UA4000236475 coupon was due 25.07.2026 — record it on Daily quotes." (no action link — the coupon card is right there). A maturity within 30 days adds an info banner.
- **Type select — 9 options in order:** Buy · Sell · Deposit · Withdrawal · Dividend accrual · Interest payout · Reinvest · Redemption · Tax.
- **Model note under a linked bond row** — nothing in demo (needs a fetched feed). In live, after "Fetch quotes" a linked bond may render one muted line under its row: nothing when the price fits the published yield; a note when the provider's quote is stale, when the price implies an off-schedule yield, or when it's too close to maturity to check. A `completed` bond renders nothing. Dated from when the payload was fetched, never from the date picker.
- **Parse diagnostics** — under the intro line. Renders nothing until a fetch has ever succeeded. After a clean fetch: "All 36 feed entries read cleanly · dd.MM, HH:MM" in `faint`. When entries were skipped: a `warn` toggle "N feed entries could not be read · M read fine · show/hide", expanding to one line per skip with the rejected field paths. Survives a reload; the same panel appears in Settings → Automation.

Interactions to verify:
1. Type into an empty input → its delta chip computes live vs yesterday's value; pill count increments. Comma and dot decimals both accepted. A pasted `4 214,24 грн.` (the issue's NBSP thousands separator is typed as a plain space here; currency suffix with a dot) reads as 4 214,24; so do `₴68,629.36` and `1234.56 UAH`.
2. Typed drafts survive a reload.
3. "Copy yesterday" fills all 4 inputs with yesterday's quotes.
4. "Save snapshot" → toast "Snapshot saved", "Last saved" updates, IndexedDB row is UPSERTED (re-saving the same day does not add a row); a snapshot with an empty `quotes` is never written.
5. Transaction form: selecting Asset = "+ New asset…" reveals the dashed New asset details sub-card. Submitting with a new asset creates asset + transaction atomically → toast "Transaction recorded", new asset appears as a 5th quote row. Fields: Name, Code (avatar preview, auto-derived from Name until edited), Yield type, Expected/Target, Payout schedule (never 'none'), plus the conditional Fixed-coupon group and "Link to Inzhur" toggle (off by default).
6. Accept/dismiss a suggestion: press "Use suggested …?" → real draft with that exact value, pill collapses and progress pill increments; survives a reload. Press ✕ → the ghost is gone for the selected date, plain empty input; picking another date re-offers it. Typing over a ghost clears it on the first keystroke.
7. Record a coupon — exactly one write, one roll: with a due coupon, press Record coupon → toast "Coupon recorded" ("Coupon + reinvest recorded" with the checkbox on — ticking it reveals a REQUIRED "Units" field, since the paired reinvest moves a position; leaving it empty writes nothing, not even the payout, with "Enter the number of units."; typing `0`, `-5` or `abc` shows "Units must be a positive number."). Card collapses; IndexedDB gains exactly one `interest_payout` row dated the coupon's date, plus the asset's `nextCoupon` advances once by the schedule (clamped onto maturity). Double-click the button — still one transaction and one roll. After a reload the card does not return (a recorded payout within ±7 days dedupes the occurrence); if the NEXT scheduled date is also past, its card appears immediately. Empty the amount → "Enter an amount." and nothing is written. No `tax` row is ever created.
8. Skip writes nothing, and the next date still suggests: press Skip → card collapses, transaction count unchanged, `nextCoupon` unchanged, the occurrence is dismissed. The NEXT coupon date suggests normally. Restore every dismissal via Settings→Automation → "Restore dismissed".
9. Dismiss a banner: press a banner ✕ → it fades out (~220ms) and stays hidden across a reload; ids expire by themselves as their date passes. Restore = Settings→Automation. Under reduced motion the banner disappears instantly.
10. Skipping a coupon card also silences its matching overdue banner. Dismissing the banner does not remove the card.
11. Save refuses what it cannot read: type `12abc` into a row → `neg` border, "Enter a number." beneath it, `aria-invalid="true"`, the pill does not count the row; "Save snapshot" → error toast "Not saved — check <asset name>.", no "Snapshot saved", the stored day unchanged. With every input empty, Save → "Nothing to save — enter at least one quote." and nothing is written.

## `/transactions`

On seed:
- Header "Транзакції" / "Transactions", subtitle "Запишіть купівлю, продаж, купон або дивіденд."
- **Two columns, matching `/payouts`'s grid**: `grid-cols-[1.6fr_1fr]`, `items-start`, `gap-3.5`, one column below `lg`, measured 676,7 / 14 / 423 at 1440 — ledger left, form right. Neither card carries a width cap inside the grid; each fills its track.
- The Transaction panel — same form, same 9 type options, same atomic create-asset-and-transaction path. Stacked below `lg` the form caps at **560**.
- Beside it the FULL ledger, newest first — **18 rows on the seed**. It scrolls inside its own box, height cap keyed to `lg`.
- **The form is FIRST in the DOM**, the ledger is placed left via grid columns — walking at 360, the form's first field is the first thing Tab reaches after the header.
- Collapsing the desktop rail widens the container by 244 and draws the 57px header.
- A hairline sits between rows, none above the first.
- **A row can be deleted, and it asks first**: the ✕ appears on hover (pointer) or is always visible (touch), reachable via `focus-visible`; pressing it turns the row into "Delete this entry?" with [Delete] [No]. Nothing is written until confirm. Toast "Transaction deleted"; every derived figure recomputes from what's left (deleting a recorded coupon can bring its due card back).
- No microlabel above the list.
- Empty ledger → "No transactions yet." with the form still shown.
- **Press "Record transaction" TWICE**: after a successful record the toast fires, the row appears at the top of the ledger AND "Amount" clears; typing a new amount and pressing again records a second row. Empty the amount and press: "Enter an amount." under the field, exactly one `aria-invalid` element on the page. Type `0`, `-500` or `abc`: "Amount must be a positive number." Asset = "+ New asset…" with the sub-form empty: 4 highlighted fields. Press three times fast: ONE row (the submit path is latched).
- **"Asset" is not asked on a row that has none.** Pick Deposit or Withdrawal and the picker slides away with "Units", leaving Date · Type · Amount · Source. Walk it: on Buy pick an asset, switch to Deposit (the picker goes), type an amount, record → the ledger's new row reads "Deposit · Portfolio", and the stored row has `assetId: ''`. Switch back to Buy and the asset is still selected — its VALUE is never cleared, only its error. With "+ New asset…" selected, switching to Deposit closes the quick-create panel too. What was typed into it survives switching back and forth, and survives a recorded row: the sub-form's typed name stays even after a Deposit is recorded with `assetId: ''` and no asset is created. Any `deposit`/`withdrawal` row reads "Portfolio" whatever its stored `assetId` says.
- **"Units" + the Σ/1 toggle** rides the amount field's own label row, right-aligned (track 40×22 radius 7, segments 15×16 radius 4). `Σ` for the whole transaction, `1` for one unit — both in hryvnia, each carrying its words in `title`/`aria-label`. **The row has two shapes:** with units, `[Units][Amount]` and "Source" full width beneath; without them, `[Amount][Source]` on one line. Both appear only on a type that moves a position — Buy, Sell, Reinvest, Redemption — and slide away on Deposit / Payout / Tax. Walk it: pick Buy, enter `5 000` units, leave the toggle on **Total** and type `55 694,50` → the row records `amount 55694.5`, `quantity 5000`, `unitPrice 11.1389`. Flip the toggle to **1**: the amount label becomes "Per unit, ₴" — type `11,1389` with the same 5 000 → the same three stored values. Empty the units in either mode: "Enter the number of units." plus the form summary, and nothing recorded — required for all four position-moving types, at all three doors (the form, the JSON backup, and the schema itself). Switch the type to Tax while units are filled: the field clears itself. After a successful record "Units" clears with "Amount" but the toggle does NOT.
- Units are derived from the ledger, not the asset form: `/` → "Fetch quotes" values a linked position as `Σ quantity × sell price`; until a position's rows carry quantities it falls back to the asset form's stored units.

## `/overview`

On seed:
- **ReminderStrip — ACTIVE in demo**, above the header. On the untouched demo seed (any day with no saved snapshot for today) at least ONE banner: warn "No quotes saved today yet." + bold action link "Enter quotes →" + ✕. Save all 4 quotes for today on `/` → the banner is gone; a partial day keeps it. When several fire the order is overdue → warn → info, by date inside a severity; beyond 3 they collapse behind "+N more reminders". Overdue coupon banners carry "Open Daily quotes →" here. Empty/all-dismissed/Reminders OFF → the strip renders nothing (zero height). The count is date-dependent: the seed's coupon dates are frozen (25.08.2026, 03.12.2026) while "today" moves, so within the 7-day default lead a second, info banner can join.
- Subtitle contains the current date and "rate 44.83 ₴/$".
- **5 KPI cards**, all currency-aware, mount order Total capital → Capital gain → Total return (net) → Deposited → Free cash:
  - **Total capital 149 016,36 ₴** (dark card; converts with currency toggle).
  - **Capital gain +4 452,61 ₴ / +3,08 % since 03.02** (green). The date is derived from the data — on an empty dataset the whole sub-line is absent.
  - **Total return (net) +5 839,99 ₴** with sub "+4,08 % on net deposits" (green; = totalCapital − netDeposits; sub "—" muted when netDeposits ≤ 0).
  - **Deposited 143 176 ₴** with sub "+ 1 387,38 ₴ reinvested".
  - **Free cash 7,75 ₴**, sub "0,01 % of account" — no ledger-drift chip on untouched demo (drift 0 by construction). After recording an unmatched Withdrawal 100 ₴, an amber "Ledger drift +100,00 ₴" pill appears under the sub; disappears once |stored − derived| ≤ 0,01 ₴ again.
- Assets card: 4 rows (color dot, name, meta like "div + cap · 46,1 %", value, green +%) + 12px stacked share bar.
- Right stack: "Next payouts" (bond rows from coupon attributes, REIT row estimated "~… ₴" — see deviations section). Every row is on or after TODAY — a projection that has fallen behind rolls forward by whole periods; "Rebalance hint" (top up ≈11 429 ₴ — see deviations section; "Open Allocation →" navigates), "Income received" 5 040,94 ₴ (dividends 3 641,44 ₴ / coupons 1 399,50 ₴, plus "net of tax 5 040,94 ₴" — equals gross on demo, no seeded tax rows).

**Under a period control** (header action slot): four figures move with the window, two stand still. Measured on the seed at 1440:

| card | Від початку (full history) | 3 місяці (3 months) |
|---|---|---|
| Total capital | 149 016,36 ₴ | 149 016,36 ₴ — stands |
| Free cash | 7,75 ₴ | 7,75 ₴ — stands |
| Capital gain | +4 452,61 ₴ · +3,08 % from 03.02 | +2 746,36 ₴ · +1,88 % from 27.04 |
| Total return (net) | +5 839,99 ₴ · +4,08 % · 03.02 | +4 133,74 ₴ · +2,85 % · 27.04 |
| Portfolio XIRR | +8,93 % (ann.) | +12,08 % (ann.) |
| Income received | 5 040,94 ₴ (div 3 641,44 · coup 1 399,50) | 2 069,04 ₴ (div 1 853,04 · coup 216,00) |
| Assets yield column | +4,41 / +1,48 / +2,96 / +5,20 % | +2,80 / +0,78 / +1,24 / +5,20 % |

- XIRR appears only on the net-return KPI: it is measured at the portfolio's external-capital boundary, while every `/yield` column is measured at the asset boundary.
- The "(ann.)" mark disappears once a window reaches 365 days.
- The assets card's yield column equals `/yield`'s Δ for the same asset and window.
- A window's opening position is valued the day BEFORE it opens (not ON the from-date) — the only boundary that counts each transaction once.

## `/balances`

On seed:
- Green area chart of total capital per complete snapshot (Feb→Jul, rising to ~149k).
- Snapshot table, newest first: 27.07 row shows `68 702,10` then "pending" ×3, cash `7,75`, total "—"; 25.07 row total `148 943,62`; rows continue 24.07 → 21.07 (no 26.07 row).
- Footer: "Showing last 6 snapshots · 174 total since 03.02.2026" + Prev/Next pagination over the full history.
- After saving all 4 quotes on `/` for today: the pending cells fill and the row total computes.
- A quote saved on `/` for a day before that asset's own first purchase is shown, not withheld: save `15 390,00` for …8976 on 04.02 and the last page's 04.02 row reads `64 648,47 · 59 214,04 · 15 390,00* · — · 7,75 · 139 260,26` — it adds up, and one footnote under the table explains the `*`. The footnote is absent on a page with no such cell.

## `/payouts`

On seed:
- Stacked monthly bars (dividends green, coupons blue-gray, value labels on top).
- Cards: **Received 5 040,94 ₴** (dark) · Upcoming (attribute-based) · **Reinvested 1 387,38 ₴ · 27,5 % of received income**.
- Payout log table: Date | Asset | Type tag | Amount | Destination — destinations show "reinvested (687,02 ₴)"-style when a same-date reinvest exists, else "account". The seed's three reinvest amounts are 687,02 · 484,36 · 216,00. One row is seeded as 472,13 on 10.05 (see deviations section).
- Recording a new dividend/interest transaction on `/` updates bars + log.

## `/yield`

On seed:
- 4 cumulative-% lines in asset colors with end dots.
- Table (8 columns): Asset | Invested | Value now | Δ total | Annualized | Total return | XIRR (ann.) | vs expected. …6475 annualized **+10,9 %** (global 03.02 basis — see deviations section); REIT Δ **+4,41 %**; negative "vs expected" gaps in terracotta with "pp".
- **Total return column** (net of taxes, incl. payouts; ÷ invested): REIT **+10,12 %** · Energy **+1,48 %** · …8976 **+10,65 %** · …6475 **+10,96 %**. May disagree with Δ total by design (illusion-of-loss).
- **XIRR column** (money-weighted, 1 dp): REIT **+23,0 %** · Energy **+3,1 %** · …8976 **+25,8 %** · …6475 **+99,4 %**. Header reads "XIRR (ann.)" while portfolio history < 365 days (demo: yes, 174 days); plain "XIRR" after a full year. Null/unquoted metrics render "—" muted.
- Table min-width 780px — it scrolls INSIDE the card; the page still has no horizontal scroll at 360px.
- Footnote: "Annualized = total Δ scaled to 365 days from first purchase (03.02.2026). Coupons count toward Δ on accrual. Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized." The date is derived from the data and reproduces 03.02.2026 exactly on the seed; on an empty dataset the footnote does not render.

**Under a period control** — a Select at 272px in the header, with the resolved window under it. Three of six options read "full history" on the seed instead of a date (they are clamped — history is 174 days). "Від початку" (full history) is not a special case: every column is computed by the same windowed builder with the widest window. Measured per window on the seed, …6475 (bought 02.06):

| window | Δ total | Annualized | Total return | XIRR | vs expected |
|---|---|---|---|---|---|
| Full history · 174 d | +5,20 % | +10,9 % | +10,96 % | +99,4 % | −4,3 pp |
| 3 months · 91 d | +5,20 % | +20,8 % | +10,96 % | +99,4 % | +5,6 pp |
| 1 month · 30 d | +2,76 % | +33,6 % | +2,76 % | +39,3 % | +18,4 pp |

- Rows 1 and 2 carry byte-identical flows — both windows open before the 02.06 purchase — so only the divisor changed: annualization is LINEAR, so the annualized figure triples while Δ stands still, and "vs expected" can flip sign on a fixed-coupon bond against its own contract.
- The curve rebases per window, not merely clips: full history spans 08.02→27.07, 1 month spans 29.06→27.07, and a window's first point opens near 0.
- The footnote names the window, not the first purchase: full history reads "from 03.02.2026", 3 months reads "from 27.04.2026".
- **A row that fell well short of the window's span renders GREY** (muted, not suppressed — the figure does not move): on the default window …6475's Annualized +10,9% and vs-expected −4,3pp render muted (bought 02.06.2026 into a basis opening 03.02.2026: 55 of 174 days). …8976 is NOT greyed despite being bought two days after the start (172 of 174, 1,15% short) — that pair fixes the threshold. Under 3 months …6475 is grey (55 of 91, 39,6% short); under 1 month it is NOT grey (lived through all 30 days). The legend appears only when a row is actually marked.

## `/attributes`

On seed:
- 2×2 grid of read-only asset cards: avatar + name + yield-type tag + a `<dl>` of 5 facts for a non-bond (Expected return, Actual, Payout schedule, Target share, First purchase) and 6 for a bond.
- **Coupon is derived** — `rate/100 ÷ payments/year × 1000 × units`, so it moves when the holding does. On the seed both bonds carry the legacy stored amount and no rate, so …8976 still reads **1 240 ₴ semi-annually** and …6475 **216 ₴**. Record a sell that closes a linked bond and the fact goes to "—".
- **YTM at purchase is solved and disclosed when it differs** — the yield implied by the price actually paid, against the bond's own schedule, on the purchase's own date. Needs a linked bond, a purchase carrying a unit price, and a feed in hand; missing any, the stored expected % shows instead. When the two differ at the precision SHOWN, a muted note renders below the figure naming the stored value. Visible text, not a tooltip.
- Check: targets 40/40/17/3; Energy shows "None (price only)" for payout schedule; bond cards swap in YTM at purchase / Coupon / Maturity / Next coupon.
- Check: YTM at purchase reads the stored expected % with NO second line — 16,4% on …8976 and 15,2% on …6475 — neither carries a live link, so nothing solves and nothing differs.
- Assets created via the transaction form appear here with their entered attributes.

## `/seasonality`

On seed:
- Day-of-month bar chart: gray 3–5px stubs on no-income days; tall bars on days 3, 10, 25 — three labelled bars, each `actual · expected*`: day 3 ₴216 · ₴216*, day 10 ₴3,641 · day 10 (see deviations section), day 25 ₴1,184 · ₴1,240*. The `*` marks the expected half, from coupon attributes.
- Footnote explaining stubs; 3 insight cards: "Income anchor" (day 10), "Coupon season" (February & August day 25 carry the big …8976 coupons; …6475 pays in early June), "Quiet stretch" (days 26–31).
- **Period control in the header**, same slot as `/overview` and `/yield`. Only the ACTUAL bars move with the window; under 3 months (27.04–27.07) day 10 reads 1 853 ₴ · day 10 against 3 641 ₴ at full history. The EXPECTED bars never move — day 25 becomes an expected-only 1 240 ₴* once …8976's February coupon drops out of the window. All three insight cards follow the window: "Income anchor" 580 ₴ → 700 ₴ at full history, 472 ₴ → 700 ₴ under 3 months, and under 1 month falls back to "No regular income yet." "Coupon season" reflects only the months inside the window (verb agrees with the count).
- **A segmented toggle on the chart card: "By day" / "By month".** It sits on the chart because it changes one chart; the period control that changes the whole screen sits in the screen header. The choice is EPHEMERAL — leaving `/seasonality` and coming back opens on days again.
- **Month axis, on seed:** twelve ticks Jan…Dec, all labelled. Eight labelled bars: Feb 1 764 ₴ · 1 240 ₴*, Mar 596 ₴, Apr 612 ₴, May 472 ₴ · 216 ₴*, Jun 897 ₴, Jul 700 ₴, Aug 1 240 ₴*, Dec 216 ₴*. Aug and Dec are expected-only.
- **Two months carry both series:** …8976's final coupon falls at its February maturity, so February has a real 2026 coupon AND a scheduled one. May is …6475's — 03.12.2026 + 6 months overshoots the 27.05.2027 maturity, so the schedule clamps to a final short coupon in May. Both pinned by test.
- **No value label leaves the plot** — labels are clamped to the plot rectangle; a truncated figure is worse than an absent one.
- **The tooltip names a month on the month axis** — the full word, where the ticks take the short form. The tooltip's series names (`actual`/`expected`) are untranslated on both axes.

## `/portfolio`

On seed:
- Positions table: Asset | Yield-type tag | Invested | of it reinvested (REIT 1 171,38 / …6475 216,00) | Value now | Capital gain, ₴ | Capital gain, % | Share; bold Total row "Total + cash 7,75 ₴" with value 149 016,36.
- Footnote: "Capital gain = value − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen."
- Cards: Best performer …6475 +5,20 % · Laggard Energy · Income engine REIT.
- **Edit mode — assets are managed here.** Header shows a ghost "Edit" at rest and a single filled "Done" while editing — no Save and no Cancel, because create/edit/delete each commit through their own dialog.
- **Desktop gains a ninth column, only in edit mode** — its `<th>` carries an `sr-only` "Actions", each row's first cell is a `<th scope="row">`, and both action buttons carry the asset in their accessible name. The Total row gets the cell and no buttons.
- Below `md` the record card grows a footer band after the facts — a hairline rule, then the two actions pushed right. The Total card gets no band.
- "+ Add asset" appears with edit mode in both shells; an empty portfolio keeps the header control, plus "No assets yet — add your first to start tracking."
- **Delete confirm:** `role="alertdialog"`, no typed-name arming, cascade sentence with real counts (REIT 9 transactions / 174 days, …6475 3 transactions / 54 days) and a "Download backup first" CTA. The counts are frozen when the dialog opens.

## `/allocation`

On seed:
- Donut (30px ring, asset colors) with center "149 ₴k / 4 assets + cash" + legend.
- "Current vs target" pills: fill = current share, black 2px tick at target. Deltas: REIT +6.1 (red — overweight), Energy +0.3 (green), …8976 −6.4 (red), …6475 −0.1 (green — near target). Color encodes off-target severity, not sign.
- Rebalance plan: numbered actions — top up …8976 ≈11 429 ₴ (see deviations section), trim REIT ≈9 096 ₴ (derived 9 095,56, prose-rounded).
- **Edit mode — targets are edited here.** At rest the header carries a single ghost "Edit". Pressing it swaps the header to ghost "Cancel" + filled "Save" — one filled button while editing, none at rest. Each row's `share / target` reading becomes `share` · `/` · a 72px right-aligned input (h 36, r 9) · `%`, a "TARGETS" microlabel appears at the card's top right, and a Σ pill appears under the rows.
- **A fractional target is written in the UI's own decimal mark.** The seed's 40/40/17/3 are all whole; entering **17,5** into a row, saving, and re-opening the field reads `17,5` in Ukrainian, `17.5` in English, from one stored 17.5. Reset it back to 40 afterward, or Σ warns at 100,5 and every delta and rebalance figure moves. The same formatter feeds `/portfolio`'s edit dialog fields "Target, %" and "Expected, %".
- A three-decimal percent is the case that bites: the number parser is locale-blind, so in Ukrainian it reads `6,164` as grouped `6164`. The input formatter verifies its own output against that parser and emits `6,1640` (the trailing zero is deliberate).
- The live preview is the TARGET TICK, not the fill: typing 45 for REIT moves the black tick from 40% to 45% and re-derives the pp delta against it; the coloured fill stays at 46,1037% — an entered target cannot change what you own.
- Σ ≠ 100 warns and never blocks (amber pill "Σ 105% — targets don't add up to 100%", Save still enabled). An unparseable entry is the one thing that DOES block: neg border, "Enter a percentage.", Save disabled, and Σ returns to its stored value. Save is also disabled when nothing has changed.
- Leaving with unsaved work asks first: Cancel, Escape or a sidebar navigation opens "Discard changes?" with "Keep editing" / "Discard". Escape closes THAT dialog rather than re-opening it. Cancel is disabled while a save is in flight.
- After a save the rebalance plan re-derives from the SAVED targets: at REIT 45% the trim reads −1 645 ₴ against −9 096 ₴ at 40%.

## `/settings`

On seed:
- Header "Settings" + subtitle "Preferences, data and automation".
- **3 stacked white cards** (radius 24) in order: Data → Automation → Appearance, each with a 10px uppercase microlabel.
- **Data — dataset switch:** "Dataset" row with a filled Demo/Live segmented control (Demo active on seed). Then **Backup row** — outline button "Download backup" downloads the export envelope (on seed 4 assets / 174 snapshots / 18 transactions + settings). Then **Import row** (below). Then **Danger zone row** — one neg-outline trigger per dataset: "Reset demo data…" in demo, "Erase live data…" in live, both opening a typed-name confirm dialog.
- **Data → Import:** drop target (solid `panel-border`, never dashed, radius 16), "Drop a .json or .csv file here" + outline "Choose file…" inside the panel. Import replaces everything in the active dataset after a reviewed summary and an automatic safety backup. In demo an 11px muted note warns that importing replaces the reference portfolio. CSV is named in the copy but currently rejected (see checkpoint 22).
- **Automation:** two switches ON by default, identical in demo and live — "Quote suggestions" (ghost values for unquoted fixed-coupon assets) and "Coupon suggestions" (one-tap recording when a coupon date arrives) — then "Reminders" (ON by default) with two sub-rows while on: "Lead time, days" (72px input, prefilled 7) and "Dismissed reminders" with "Restore dismissed" (disabled/count-free at 0, else "Restore dismissed (N)"). A read-only "Last feed parse" row mirrors the panel on `/`.
- **Appearance:** "Currency" row with a filled ₴ UAH / $ USD segmented control (helper: the sidebar toggle only shows another currency, it doesn't save the choice); "₴/$ rate" row with a 110px right-aligned decimal input prefilled **44.83**, and an outline "Fetch rate" button. In demo the button is disabled ("Demo data — no requests leave the app."). In live, pressing it queries the NBU rate for today's Kyiv date and shows "NBU <rate> for <dd.MM.yyyy>" + "Use it" — the input keeps the stored value until "Use it" is pressed. A failed fetch shows the last known rate or "No rate available". Typing accepts comma decimals and rejects junk without writing it.

Interactions to verify:
1. Sidebar "SETTINGS" group sits between Analytics and the currency toggle; the Settings pill activates on `/settings`.
2. **Currency control moves the sidebar, and the sidebar does not move it back.** Flip in Settings and the sidebar thumb plus every headline KPI follow immediately, written to `quirenote-settings.state.defaultCurrency`. Flip in the SIDEBAR and the KPIs follow but this control stays where it was and nothing is written; reload and the sidebar returns here. The logo does not follow either flip.
3. Editing the rate to a valid number (comma or dot decimals) updates the sidebar `$` sub-figure and the Overview subtitle rate immediately, and persists across reload.
4. Invalid input (`0`, `-1`, `abc`, or emptied on blur) → neg border + "Enter a rate above 0."; the store keeps the last valid rate.
5. "Download backup" disabled while pending; failure shows a toast.
6. 360px: cards stack, control rows wrap (label above control), no horizontal scroll; the AssetForm dialog fits unclipped — three bands, title and Save/Cancel row fixed while the middle scrolls, the rail keeps the same 8px margin on all four sides.
7. **Add asset** opens the AssetForm dialog: heading "+ New asset details", fields Name / Code (avatar preview, auto-derives from Name until edited) / Yield type / Expected+Target / Payout schedule (4 options, never 'none') + First purchase (prefilled today); Fixed-coupon group (Maturity, Next coupon, **Coupon rate, %** — the rate is fixed at issuance while the ₴ amount scales with the holding) revealed only for yield type = Fixed coupon; "Link to Inzhur" toggle reveals exactly one control (the ref field) + helper line. **Naming a bond fills four fields** — pick an ISIN and Maturity, Next coupon, Payout schedule and Coupon rate fill from the provider's own schedule; three of the four are written OR cleared, never left stale, when the link is re-pointed at a different bond. The fill needs a feed at the moment the ref is named — a ref typed while offline never auto-fills. Switching a linked asset's Yield type to/from Fixed coupon clears the ref and reopens the picker on the other list. Submit → toast "Asset added", row appears, new quote row on `/`, card on `/attributes`. In demo the ref field is a manual text input with a note that the live list is disabled; in live it is a picker ("Pick from Inzhur…") that fetches the feed on first open, with an "Enter manually" ↔ "Pick from the list" round-trip.
8. **Edit** opens the same dialog prefilled ("Edit asset" / "Save changes"): changing …8976's Maturity updates the Attributes card and Overview "Next payouts" after save (toast "Asset updated"). Editing Energy (payout schedule 'none') additionally offers "None (price only)" in the schedule select. …8976's Coupon rate opens BLANK (the seed carries the legacy amount and no rate) — correct, not a regression. A bond linked to the provider fills the rate from the feed instead. Percent fields format per language — …8976's Expected return reads `16,4` in Ukrainian and `16.4` in English.
9. **Delete** opens a confirm dialog stating the cascade: "This removes the asset and everything recorded for it — N transactions and quotes on M days." (on seed: REIT 9/174, Energy 1/173, …8976 2/171, …6475 3/54) with "Download backup first" + neg "Delete asset" → toast "Asset deleted", cascade removes its transactions and quote cells everywhere. `role="alertdialog"`, overlay does not dismiss, Esc cancels; no typed-name arming (reserved for erase/reset).
10. Validation: submitting an empty create form highlights fields with the pinned messages ("Name is required." · "Code is 1–2 letters." · "Enter a percentage." …) + summary "Check the highlighted fields and try again."; the linked-ref message follows the kind ("Enter the fund slug." / "Enter the bond ISIN.").
11-13. Targets editing lives on `/allocation` — see that section for the Σ recompute, the warn-vs-error pair and the save-patches-only-changed-assets checks.
14. **Dataset flip → live:** click Live → both segments briefly disable → the app reloads with the dataset set to live. After reload: no DEMO badge, every screen shows its empty state (sidebar total 0 ₴ / "+0,00 % · 0,00 $", Daily quotes "0 of 0 filled", Balances "No snapshots yet…", zero-value Overview KPIs), `/portfolio` shows "No assets yet…", the Danger zone row offers "Erase live data…". Reloading again stays empty — live never auto-seeds. IndexedDB now contains both `quirenote` and `quirenote-live`.
15. **Dataset flip → demo:** click Demo → reload → DEMO badge returns and every seed checkpoint above is intact.
16. **Reset demo data (typed confirm):** in demo, "Reset demo data…" opens a dialog — title "Reset demo data?", label "Type demo to confirm" with the input auto-focused; the danger button stays disabled until the input matches `demo` (case-insensitive, trimmed); "Download backup first" downloads without closing the dialog and flips to "Backup downloaded ✓"; ghost Cancel/Esc close without changes. Armed confirm → toast "Demo data reset" and all seed checkpoints (4/174/18 rows, 149 016,36 ₴ …) are restored after any demo edits.
17. **Erase live data (typed confirm):** flip to live and record something; Settings→Data shows "Erase live data…" → dialog "Erase live data?", label "Type live to confirm", same arming/backup mechanics as 16. Armed "Erase live data" → toast "Live data erased", every screen shows its empty state without a reload, the Daily-quotes draft is gone, and currency/rate/dataset settings are retained. Reload → still empty. Demo dataset untouched throughout.
18. **Automation switches:** flipping either switch takes effect on `/` without a reload (Quote suggestions off → every ghost/suggestion pill disappears; Coupon suggestions off → every coupon-due card disappears) and persists; a legacy payload without them hydrates to ON.
19. **Reminders switch + lead time + restore:** flipping Reminders off collapses both sub-rows and removes the strip and the app-open toast everywhere immediately, no reload. Lead time: typing `21` re-windows coupon banners instantly (the seed's 25.08 coupon, 21 days out, appears on `/` and `/overview`) and persists; an invalid entry (`0`, `31`, `45`, `7.5`, `abc`, or emptied on blur) shows "Enter 1–30 days." and never writes. Restore dismissed: the label counts current dismissals ("Restore dismissed (1)"); pressing it clears all dismissals, re-surfaces every banner still in window, and toasts "Dismissed reminders restored"; at 0 it is disabled and drops the count.
20. **Import — a rejected file:** a file that is not `.json` shows "That file type isn't supported — pick a .json backup." under the panel (other file-level messages: too large, more than one file, empty file). A `.json` that parses but fails validation opens a report dialog — "This file can't be imported", "Nothing was changed. Fix the file and try again.", an exact problem count, and a scrolling list of mono row-addressed items (e.g. "transactions.tx-0099 — unknown asset id", "snapshots — duplicate date (date is the primary key)"). A format-level failure names the reason: a NEWER format version than this app reads; an OLDER format version this app "can no longer import"; or an unreadable version number. The dataset is provably untouched after every rejection.
21. **Import — preview, diff and confirm:** a valid backup opens a preview — title "Import into demo"/"Import into live", subline with export date and source dataset, a non-dismissible replace-banner naming the dataset, a diff panel (Table/Added/Replaced/Removed), the result line ("After import: N assets · N snapshots · N transactions."), warnings when data would be removed or the file has no assets/snapshots or is from a different dataset, a default-OFF checkbox to also apply the file's settings, a safety-backup line, and ghost Cancel + neg "Replace all data". Initial focus is Cancel; the overlay never dismisses; Cancel/Esc leave the row counts byte-identical. Confirm → the safety backup downloads first, then one write, then a toast with the new counts and every screen re-renders with no reload. Warnings never block the confirm. At 360px each diff table becomes its own block and the two buttons stack full width.
22. **Import — CSV is announced but not yet accepted:** the copy and file picker name `.csv`, but a `.csv` currently gets the unsupported-file-type message.
23. **Two tabs:** open a second tab on `/overview`, import in the first → the second toasts exactly once "Data was replaced in another tab." and re-renders from the new data without a reload; erase/reset broadcast the same way. The acting tab never toasts at itself. Holding the write lock in the other tab makes the confirm sit at "Waiting for another tab…" with both buttons disabled and Esc inert.

## Mobile shell (below 768 px)

**One breakpoint, `md` = 768px, the only one.** Resize to 360×740 and run these; then to 768×800, where the desktop shell must be back byte-for-byte.

**Header bar**
- Sticky at the top, 56px tall plus safe-area inset, square corners and a hairline bottom edge.
- Left: a hamburger whose drawn glyph is 18×12 (three 2px bars, radius 1) inside a 44×44 pressable box with no fill and no edge of its own.
- Then "TOTAL CAPITAL" in 9.5px uppercase muted over **149 016 ₴** at 18px bold; right, stacked: **+3,08 %** in `pos` over **3 324,03 $** in muted. Toggling the currency in the drawer flips both — same source as the sidebar's card.
- With no KPIs at all the value and delta are both a faint "—".
- Light surface (page/ink/muted/pos/neg/hairline only); its focus ring is the ink one, not the sidebar's.
- At ≥768 the header is absent while the sidebar is in flow, appearing only when the sidebar is collapsed.

**Drawer**
- Tapping the hamburger slides a 280px drawer in from the left over a scrim. Same navigation as the desktop rail — same lockup, pills, currency toggle, rounded-right corner.
- The Total capital card is absent in the drawer — the header carries that number.
- The bottom cluster is PINNED: at 740px and at 640px of viewport height the currency toggle and version badge are both on screen without scrolling the drawer.
- Behaviour: Escape closes and focus returns to the trigger; background is inert and Tab cycles inside the drawer; tapping a nav pill closes it; the hardware Back button closes it and stays on the route; body scroll is locked while open and the scroll position is restored on close; under reduced motion it arrives instantly.
- Nav pills stay 36px tall at radius 9 — the pressable region grows to 44 around them with an 8px column gap so the regions don't overlap. A pill drawn at 44 (radius 11) is a regression.

**Record cards** (`/yield`, `/portfolio`, `/payouts`, `/balances`)
- Each table becomes a list of cards: radius 24, `p-[22px]`, avatar + 17px title + tag in the header, then a two-column `<dl>` — the same card shared with `/attributes`.
- Every `dt` is the table's own `<th>`, character for character; a re-worded or abbreviated term is a defect.
- Numbers keep the TABLE format (`68 702,10`, never `68 702,10 ₴`).
- Portfolio's bolded "Total + cash 7,75 ₴" row survives as a final card; Balances keeps "pending" in faint and "—" for a partial row's total.
- At ≥768 the `<table>` is back, unchanged, and the card list is gone.

**Daily quotes**
- Each row is TWO lines: `[48px avatar][name + "… ₴ yesterday"]`, then `[input][delta]`. The input is 44px tall at radius 11 with 16px type; at ≥768 it is 36/radius 9/13px.
- Once anything is filled, "Save snapshot" and "Copy yesterday" move into a sticky bar pinned to the bottom of the visual viewport — square corners, hairline top edge, both buttons 44px at radius 11 — not drawn in flow at the same time. With a field focused they stay above the keyboard.
- "+ New asset…" in the transaction panel opens its sub-form with no horizontal scroll.
- The side rail fills the row whenever the two columns are stacked (360, 500, 767, 900 all measure zero dead space to its right); beside the ritual column it is the `1fr` track with no width cap. It is the same permanent side rail described on `/` — coupon-due cards, pending-change block, yield teaser, last-saved line.

**Overlays**
- The `Dialog` is `calc(100vw − 32px)` wide, `max-h-[85dvh]`, three bands, title and buttons fixed while the body scrolls.
- The date picker opens as a centred 328px sheet at radius 16, day cells 42.3×44, month-nav buttons 44×44 (at ≥768 an anchored 269px popover with 32px day cells). Its caption is two buttons — month and year, 44 tall at 360 and 28 above the breakpoint; pressing either replaces the days with a grid (twelve months in three columns, or a page of years in four); pressing again goes back. The year range is ±20 years around the current one, never earlier than 2016, widened to reach the field's own year — it moves with the clock, and the last page can be short (12, 12, 12, 5).
- Every field and both value-showing triggers (`Select`, `DatePicker`) read at 16px — under that, iOS Safari zooms on focus and does not zoom back.
- Toasts sit at the bottom, 12px a side, clear of the safe-area inset, never under the header.

**Charts without a pointer**
- On `/balances`, `/payouts` and `/yield` a tap pins the tooltip to the nearest point; a tap elsewhere moves it, a tap outside releases it. `/seasonality` draws both its amounts on the bars instead; `/allocation` has no tooltip at all.
- The plot is focusable in both shells: Tab to it and the tooltip appears at the first point; ArrowRight walks it forward.
- Payouts' tooltip reads "Coupons : 0.00" / "Dividends : 472.13" — translated names and locale decimals.

**Settings → Portfolio**
- Each asset is a clear two-line block below the breakpoint: the name owns line 1, the yield-type label plus "Edit" / "Delete" share line 2, ending at the same right edge the name does. Rows are 6px apart.

**Hit areas** — every pressable is 44×44 below 768, with exactly two exceptions: the seven text fields, which stay 36px tall (an `<input>` renders no pseudo-element); and the reminder strip's action link, 133×37, because it is inline in a sentence. Anything else under 44 is a regression — watch for a control with no fill and no border carrying a growth overlay, which needs a real 44px box rather than a centred one that can reach past its own edges onto a neighbour.

## Cross-cutting recipes

0. **Fetch quotes end-to-end (live dataset — needs the internet):** flip to live, `/portfolio` → Edit → "Add asset" → yield type "Dividends + capitalization" → Link to Inzhur ON → Units `6164` → the Fund picker → pick "Inzhur REIT · inzhur-reit" → Add asset. On `/` press Fetch:
   - the row's draft fills with units × the live sell price (e.g. 6 164 × 11.0288 = `67 981,52` — a live figure that moves daily; invariant is `units × sellUAH` rounded to kopecks), chip "AUTO" + "fetched HH:MM", header microcopy "Inzhur HH:MM";
   - nothing is saved until "Save snapshot" is pressed;
   - type over the value → chip flips to "MANUAL"; press Fetch again → your value is untouched and a dashed "Use fetched 67 981,52?" pill + ✕ appears. Accept → value replaced, chip back to AUTO; dismiss → nothing changes. Typing exactly the fetched number produces no offer;
   - a second press while the payload is still fresh re-serves it with no new network request;
   - DevTools → Network → Offline, then press Fetch: "Fetching…" → back to idle + toast "Couldn't reach Inzhur — check your connection." with action "Use values from dd.MM"; pressing it applies the cached payload — typed rows are still only offered, filled rows get an amber "AS OF dd.MM" chip. Chips and drafts survive a reload;
   - a live asset with no linked instrument → button disabled with a title explaining why.
   Clean-up: delete the asset (or "Erase live data…"), then flip back to demo.
1. **Derivation integrity:** record a Buy of 1 000 ₴ on an asset → Portfolio Invested/P&L, Overview KPIs, Allocation shares and the sidebar total all shift consistently; no figure stays frozen.
2. **Currency scope:** toggle to $ → ONLY sidebar capital and Overview headline KPIs convert; every table (Balances, Payouts, Yield, Portfolio) stays in ₴. The logo does not convert.
3. **Upsert:** save today's snapshot twice with different values → one row per date in IndexedDB, latest values win.
4. **Reseed:** wipe storage (see top) → app returns exactly to the seed checkpoints above.
5. **A11y sweep:** Tab through a screen — visible 2px focus rings; active nav pill has `aria-current="page"`; hover states on pills/buttons/rows.
6. **Motion sweep:** every interaction animates softly — buttons scale down on press, hover states fade, route changes fade/slide the content in, chips/pills animate on value change, charts sweep in; dialogs close with a symmetric fade/zoom-out. With reduced motion emulated, all of it collapses to instant.
7. **Export → erase → import restores every checkpoint:** in demo, Settings→Data → "Download backup" (4/174/18 + settings). Flip to live → every screen shows its empty state. Settings→Data → "Choose file…" → pick that file → the preview reads "Added +4 / +174 / +18", "Removed 0", warning that the file is from the demo dataset → "Replace all data". Then, in the LIVE dataset: sidebar `149 016 ₴` `+3,08 % · 3 324,03 $`; `/overview` 149 016,36 ₴ · Capital gain +4 452,61 ₴ / +3,08 % · Total return (net) +5 839,99 ₴ / +4,08 % · Deposited 143 176 ₴ + 1 387,38 ₴ reinvested · Free cash 7,75 ₴ · Income 5 040,94 ₴ (div 3 641,44 · coupons 1 399,50) · rebalance "top up 11 429,50 ₴"; `/yield` …6475 annualized +10,9 % (and the derived columns +10.12/+1.48/+10.65/+10.96 · XIRR +23.0/+3.1/+25.8/+99.4); `/portfolio`, `/allocation`, `/balances`, `/payouts`, `/seasonality` identical to their demo checkpoints. If a round-trip moves a pinned number the serializer is wrong, never the checkpoint. A safety backup lands in Downloads holding the PRE-import (empty) live dataset. Clean up with "Erase live data…", then flip back to demo — the demo DB was never touched.

## Deliberate deviations from the design reference

Testing agents must NOT report these as bugs — every portfolio figure is derived from stored data, so the seed's real transactions do not always reproduce the reference's hand-picked numbers:

| Where | Reference shows | App shows (derived) |
|-------|-----------------|---------------------|
| Overview rebalance hint / Allocation plan | top up 11 413 ₴ | ≈11 429 ₴ |
| Seasonality day-10 label | 3 817 ₴ | 3 641 ₴ |
| Payout log, one dividend row | 648,13 on 12.05 | 472,13 on 10.05 |
| Payout log, 10.06 dividend destination | plain "reinvested" | reinvested (484,36 ₴) |
| Payout log, 03.06 coupon destination | plain "reinvested" | reinvested (216,00 ₴) |
| Overview "Next payouts" REIT estimate | ~715 ₴ | ~700 ₴ (latest dividend) |
| May payouts bar label | includes 648,13 | includes 472,13 |
