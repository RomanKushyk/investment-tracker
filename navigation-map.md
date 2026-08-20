# Navigation map — agentic manual testing

Route-by-route map of the app for manual/agentic verification. Every expected value below is what the app must show **on fresh seed data** (they mirror `docs/archive/BUILD-PLAN.md` fixtures and `docs/decisions/README.md` D5). Update the Status column and checkpoints whenever a task changes a screen or flow.

> **Next phase in progress** — see `docs/plans/NEXT-PHASE-PLAN.md`. Since Phase 2's dataset split (G4/D16), all seed-pinned checkpoints below run against the **demo** dataset; new routes (`/data`) get their own sections as they land.

> **Nothing here is affected by the backend (2026-08-11).** `infra/` archives asset prices into Aurora DSQL, but no screen reads it — the app is still entirely IndexedDB (D26). Every checkpoint below remains valid as written. When the planned migration lands, this file needs a rewrite: the seed will no longer load from a local reseed and the demo dataset is slated to disappear.

> **Walked end to end on 2026-08-19** — all ten routes, demo dataset, at 1440 and at a true 360 viewport, in Ukrainian and English, in both themes. **Every seed-pinned figure on every route matched**, and horizontal overflow measured **0 px on all ten routes in both languages**. English formatting matched Contract 0 exactly (`149,016.36` · `+3.08% since 3 Feb` · `19 Aug 2026`).
>
> The walk was run because three releases had shipped that day (A21 currency, A24 the derived basis, A27 the windowing delegation under `latestQuotes`/`latestCash`/`headlineTotal`, which every screen reads) and this file described a state that had been *asserted* rather than *observed*. **It found eight divergences, and all eight were in this file rather than in the app** — the corrections are marked inline with that date. Three of them were the same defect: a kopeck amount whose decimal comma had been dropped, so `687,02` · `484,36` · `216,00` were written as `68 702` · `48 436` · `21 600`, each a hundred times too large. `docs/decisions/README.md` D5#3 had them right the whole time.
>
> **One real behaviour finding came out of it — `docs/plans/PLAN-NOW.md` A28, fixed the same day.** The "Next payouts" card projected a payout and never rolled it past today, so on 2026-08-19 it offered `10.08` — nine days in the past, under a heading that promises the opposite. **Both halves were affected, not just the dividend one**: `couponProjection` reads `nextCoupon` verbatim and that pointer only moves through the S5 confirm, so an unrecorded coupon freezes exactly the same way; the seed hid it only because its stored 25.08.2026 was still in the future that day. Both now roll to the next occurrence on or after TODAY — the calendar, not `latestSnapshotDate`, because this card answers "what comes next" rather than "what is it worth". A missed occurrence still surfaces in the reminder strip and the S5 card, which read the grid (D23).

## Connecting & resetting

- App runs on **http://localhost:3000** (pinned in vite.config). The dev server is usually already running — check before starting one. If :3000 is occupied by another project, Vite falls back to :3001+ — read the dev-server output for the actual port.
- **Checkpoints also run against the deployed site — and there are two now** (D59): **production `https://quirenote.com`** serves the `main` branch, **`https://dev.quirenote.com`** serves `dev` and is **behind HTTP basic auth** (D60), so a checkpoint run against it needs the credentials — they are not in this repo, which is public. Verify a change on dev, confirm a release on production. See `docs/reference/DEPLOYMENT.md`. Use a **fresh browser profile** when verifying a deploy: the seed only loads into an empty IndexedDB, so an existing profile shows your own data instead of the pinned values.
- **Two datasets, two Dexie DBs (G4/D16):** `quirenote` = **demo** (the reference seed; the app's default) and `quirenote-live` = **live** (starts and stays empty until the user writes into it — it never auto-seeds). The active DB binds at boot from `localStorage['quirenote-settings']` → `state.dataset`; flip it on `/settings` → Data (the app reloads). **All seed-pinned checkpoints in this file run in DEMO mode** — confirm the sidebar DEMO badge before testing.
- **Reset to seed state (demo):** either `/settings` → Data → "Reset demo data…" (type `demo` in the dialog, then confirm), or DevTools → Application → delete IndexedDB database `quirenote` and localStorage keys `quirenote-settings`, `quirenote-draft` → reload. The demo DB reseeds automatically. Deleting the `quirenote-settings` key also resets the dataset flag to demo.
- **Reset live to empty:** either `/settings` → Data → "Erase live data…" while in live mode (type `live` in the dialog, then confirm — checkpoint 17), or DevTools → Application → delete IndexedDB database `quirenote-live` → reload while in live mode (it comes back empty — no reseed).
- **Number formats follow the LANGUAGE (Contract 0, D58), and the default language is Ukrainian** — so every figure quoted below is its Ukrainian rendering: `68 702,10` · `68 629,36 ₴` · `+3,08 %` · `12.08.2026` (NBSP thousands, comma decimals, a space before `%` per ДСТУ). Switch to English on `/settings` → Appearance and the same figures read `68,702.10` · `₴68,629.36` · `+3.08%` · `12 Aug 2026`. Tables stay in ₴ in both languages — that is a currency rule, not a locale one.
- **UI copy below is quoted in ENGLISH**, the dictionary's canonical side (`src/i18n/messages.ts`); the app shows the Ukrainian of the same key by default. A label whose wording differs from this file but whose KEY matches is not a defect — a missing or untranslated key is, and `src/i18n/messages.test.ts` is what pins that.
- **Do NOT flag D5 deviations as bugs** — see the last section.

## Route index

| Route | Screen | Built in | Status |
|-------|--------|----------|--------|
| — | Shell + sidebar (all routes) | Task 1 (data: Task 2) | done — capital card + logo + functional ₴/$ toggle (Task 7); third "Settings" nav group (P2); Backup button moved to Settings→Data (P2, was next-phase P1); **TWO SHELLS since A17/D66 — below 768px the sidebar is an off-canvas drawer and a header bar carries the capital; the old 136px rail is gone** |
| `/` | Daily quotes (landing) | Task 3 (form: Task 4) | done — quote entry flow + transaction panel live; type select incl. Withdrawal/Redemption (P2 `feat/metrics-exposure`, S10); **"Fetch quotes" button + provenance chips + "Use fetched?" offer (P3 `feat/fetch-quotes`, S1–S3); ghost accrual suggestions + coupon-due card (P3 `feat/fixed-yield`, S4–S5); ReminderStrip above the header (P3 `feat/reminders`, S6)** |
| `/overview` | Overview | Task 5 | done — 5 KPIs currency-aware (5th "Total return (net)" + "Capital gain" relabel + net-of-tax income line + drift chip, P2 `feat/metrics-exposure`); values tween ~300ms on toggle (Task 7); "Next payouts" projects user-created bonds too (P3 `feat/fixed-yield`); ReminderStrip above the ScreenHeader (P3 `feat/reminders`, S6) |
| `/balances` | Balances | Task 6 | done |
| `/payouts` | Payouts | Task 6 | done |
| `/yield` | Yield | Task 6 | done — + Total return & XIRR (ann.) columns (P2 `feat/metrics-exposure`, S9b) |
| `/attributes` | Attributes | Task 5 | done |
| `/seasonality` | Seasonality | Task 6 | done — expected coupon bars project user-created bonds too (P3 `feat/fixed-yield`) |
| `/portfolio` | Portfolio | Task 5 | done — P&L headers relabeled "Capital gain, ₴/%" + footnote, values unchanged (P2 `feat/metrics-exposure`, S9c) |
| `/allocation` | Allocation | Task 6 | done |
| `/settings` | Settings | next-phase P2 | done for P2 — **the targets editor LEFT for `/allocation` on 2026-08-19 (A30) and the asset manager LEFT for `/portfolio` on the same day (A31), taking the whole card with it — Settings now holds only what belongs to the BROWSER: Data, Automation, Appearance** — shell + Backup + Appearance + asset manager (create/edit/delete dialogs) + dataset switch (demo/live, reload-on-toggle) + typed-name erase/reset dialogs (S6, `feat/clear-data`); AssetForm Inzhur ref is a live picker in live / manual in demo (P3 `feat/fetch-quotes`, S7); Automation is complete (P3: the two suggestion switches plus the reminders switch, lead time and restore dismissed, S8); **Data→Import with its drop target, preview/diff dialog and rejected-file report (P4 `feat/backup-import`, S2–S4)**; **Appearance is COMPLETE — theme, language, currency and the rate all ship (A9/A10, D58, v1.5.0). The "placeholders (P5)" this row claimed was three phases stale, found by the 2026-08-19 walk.** |

## Global shell (visible on every route)

**AT AND ABOVE 768px** (`md` — the app's one breakpoint, D66) expect: dark **244px** sidebar, padding 16, right edge rounded **30** (concentric with the 14 of the logo card inside it — D56). Since D65 the aside itself no longer scrolls, and since D66 it is THREE BANDS — lockup, scrolling nav, pinned cluster — so the currency toggle and the capital card stay on screen at 740px of viewport height and at 640. On a short window a **12px rail** appears in the nav band, 8px in from its edge, and the nav narrows by 28; it must never be crossed by a bar or cut by the 30px corner. On the sidebar's inverted plane the rail reads `panel-border`/`faint` at their DARK-theme values (D66) — quiet furniture, not a white stick.

**BELOW 768px there is no rail at all** — see "Mobile shell" below.

**Shapes, since D56:** nothing in the app is a capsule any more. Controls take `round(min(w,h) × 0.26)` — badges 5-6, segments 7, small buttons 8, inputs and nav pills 9, larger buttons and segmented boxes 10. The only round things left are the logo circle, asset avatars, colour dots and the decorative blob. If you see a `rounded-full` capsule anywhere, that is a regression.

- **Logo lockup card** (`#333338`, radius 14, `justify-content:flex-start`): a 36px light circle holding the **Quirenote mark** — four bars, rising, the last one tallest — beside the wordmark "Quirenote" / "INVEST TRACKER". The circle **no longer carries the currency symbol**; it does not change when the currency is toggled. Same mark in the browser tab (`public/favicon.svg`, theme-aware) and as the iOS home-screen icon.
- **DEMO badge (S5/D16):** while the demo dataset is active, an amber `DEMO` badge (warn-tint tokens, radius 5, scaled to **.75**) is pinned to the **top-right corner of the logo card**, inset by the card's own 15/10 padding, on **every route**. It is absolutely positioned, so it must not stretch the card — the card stays ~57px tall, `title` tooltip "Demo dataset — reference data. Switch in Settings → Data."; it fades/zooms in on first paint (D7). **Since D66 it steps left to `right-[38px]` when the desktop collapse control shares that corner** (6 inset + 26 button + 6 gap), which is what leaves `Quirenote` 5.9px of clearance on line 1; in the drawer, where there is no collapse control, it sits at the plate's own 15px padding. In live mode the badge is absent and the microline always shows.
- Nav: "DAILY ENTRY" group → "Daily quotes" pill; "ANALYTICS" group → 8 pills; "SETTINGS" group → "Settings" pill (next-phase P2 — same pill anatomy/motion, no icon). Active pill = light bg + `aria-current="page"`; clicking navigates without full reload.
- Currency toggle (₴ / $ segmented control, radius **13**, padding 6, segments 7) near the bottom — **the only currency indicator in the sidebar**. 13 is concentric: segment 7 + the 6 padding around it. It is borderless; the bordered switches in Settings add the 1px border too and land on 12.
- **Total capital card** (radius **13** — matched to the toggle above it, so the two read as one bottom cluster)**:** value `149 016 ₴` (whole ₴), sub-line `+3,08 % · 3 324,03 $`. After toggling to $: the logo does **not** change (the mark is not the currency), only the toggle's own thumb moves; value/sub-line flip to the USD form (`$…` main, `… · 149 016,36 ₴` sub); the choice **does NOT survive a page reload** — since A21 this toggle is a glance, and a reload returns to the default set in Settings.
- **No sidebar Backup pill** (removed in next-phase P2 per S7) — the backup download lives on `/settings` → Data.
- **Version badge** at the very bottom (below the capital card, centered muted micro-label): `v` + the `package.json` version — must match it exactly (see `docs/reference/VERSIONING.md`).
- **App-open reminder toast (P3 `feat/reminders`, S6):** on every app OPEN (a full page load), if at least one undismissed reminder exists, exactly ONE plain sonner toast appears carrying the highest-severity banner sentence (+ ` · +N more` when others exist) — on the untouched demo seed that is **"No quotes saved today yet."**. It never repeats on client-side navigation (verified across four route changes) and never fires twice under StrictMode; `Reminders` OFF at boot means no toast at all.
- **No horizontal scroll at 360px on ANY route, and there are no exceptions left.** Re-measured 2026-08-17 after A17/D66 at 360×740, in **both themes and both languages** — forty measurements, every one `0`. The three that used to be listed here (FOLLOW-UPS 10 `/attributes` 133px, 13 `/settings` 82px, 14 `/` 57px, plus `/overview`'s 4px which D65 had already fixed) are all closed. **Any non-zero reading at 360 is now a regression** — measure it as `document.documentElement.scrollWidth − clientWidth`, in Ukrainian, which is the wider language.

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
- **The Transaction / Recent-transactions `<aside>` fills the row whenever the two
  columns are stacked** — 360, 500, 767 and 900 all measure zero dead space to its
  right. Its `max-w-[360px]` is a container query (`@min-[884px]`) and re-engages
  only when the two columns actually share a row: 340 at 1280, 360 at 1920.
  A fixed 360-wide panel under a 733-wide column is the regression this replaced.

**The overlays (S5)**
- The `Dialog` is `calc(100vw − 32px)` wide, `max-h-[85dvh]`, three bands, and its
  title and buttons do not move while the body scrolls.
- The **date picker stops anchoring**: it opens as a centred **328px** sheet at
  radius 16 over the dialog scrim, with day cells 42.3 × 44 and month-nav buttons
  44 × 44. At ≥768 it is an anchored popover again, 269px, with 32px day cells.
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


## `/` — Daily quotes (landing)

On seed:
- Progress pill **"1 of 4 filled"** (green tint) — REIT's quote for 27.07 is already saved. *These two bullets describe the screen with the **Date field on 27.07.2026** (the seed's last saved day — pick it in the Date picker). On any later date nothing is saved yet, so the pill reads **"0 of 4 filled"**, every input is empty, and the two bonds show S4 ghosts (below).*
- 4 asset rows, each: tinted 34px avatar with 2-letter code, name, subline like **"68 629,36 ₴ yesterday"** (REIT). REIT input pre-filled `68 702,10` with green border + delta chip **"+0,11 %"**; the other three empty with placeholders `60 086,09` / `15 846,30` / `4 374,12` and "—" chips.
- Buttons: dark pill **"Save snapshot"**, outline **"Copy yesterday"**; right text **"Last saved 25.07, 21:14"**.
- Yield teaser strip: "Yield since start: REIT **+4,41 %** · Energy **+1,48 %** · …8976 **+2,96 %** · …6475 **+5,20 %**" + ghost "Yield chart →" (navigates to `/yield`).
- Side panel: **Transaction** card (panel bg/border tokens, radius 24, "OCCASIONAL" microlabel) + **Recent transactions** card (last 3, "Type · Asset — amount — date"). *"Interest payout" renders with a "Coupon" label per the design reference; the new-asset appears-in-Attributes checkpoint becomes testable once Task 5 ships that screen.*
- **"Fetch quotes" button (P3 `feat/fetch-quotes`, S1) — in demo it is DISABLED**: outline pill with a refresh icon, sitting in the header row between the progress pill and the Date group, carrying a 10px amber `DEMO` micro-tag and the `title` "Fetching is disabled in the demo dataset — switch to Live in Settings → Data." No request can leave the app in demo, and **no provenance chips render on demo rows** (S2) — the 4 rows are byte-identical to the P2 state. The header microcopy ("Inzhur HH:MM") is absent until a fetch has succeeded in the LIVE dataset. All fetch checkpoints therefore run in live (**recipe 0** below).
- **Ghost accrual suggestions (P3 `feat/fixed-yield`, S4) — ACTIVE in demo** (pure local math): on any date with no saved quote, the two seed bonds show a *ghost* suggestion — 9px `SUGGESTED` micro-tag left of the input, the value as **muted text inside a DASHED `faint` input** (never a placeholder, never the green `pos-border`), delta stays `—`, the row is **NOT counted** in "N of M filled", and a dashed **"Use suggested 15 914,25?"** pill + `✕` ("Dismiss suggestion") sits under the input. Value = last quote + ACT/365 coupon accrual × days, **minus any coupon whose date fell in the gap**, clamped at maturity (e.g. on 04.08.2026: …8976 15 846,30 + 10 × 6,79 = **15 914,25**, …6475 4 374,12 + 10 × 1,18 = **4 385,96**; move …8976's next coupon into the gap and the ghost drops by the coupon to 14 674,25). REIT/Energy get no ghost (not fixed-coupon). Accept → real draft (solid green border, ink text, counted, provenance `accrual`); dismiss → plain empty input with yesterday's placeholder back. `Quote suggestions` OFF → no ghosts anywhere.
- **Coupon-due card (P3 `feat/fixed-yield`, S5) — ACTIVE in demo**, rendered in the aside **above** the Transaction panel (order: cards → Transaction → Recent transactions). On the untouched seed there is NO card (both bonds' next coupons are in the future — 25.08.2026 / 03.12.2026); to see one, edit a bond's "Next coupon" to a past date in Settings→Portfolio. The date offered is the next **UNSETTLED** occurrence on the asset's own coupon grid (D23): an occurrence recorded by hand in the Transaction panel — or skipped — hands over to the next one instead of silencing the asset, while the stored `nextCoupon` only ever moves through a confirm. Card = white, radius 20, **dashed `faint`** border, "COUPON DUE" microlabel + warn-tint date pill when overdue, title "OVDP UA4000238976 — coupon 1 240,00 ₴", body "Scheduled for dd.MM.yyyy. Confirm to record it — the amount is editable, history is never rewritten.", editable **Amount, ₴** (prefilled from the Inzhur `paymentSchedule` forecast when linked, else `couponAmount`, else empty), checkbox "Also record a reinvest of this amount", dark **Record coupon** + ghost **Skip**. `Coupon suggestions` OFF → no cards (aside identical to P2).
- **ReminderStrip (P3 `feat/reminders`, S6) — ACTIVE in demo**, rendered ABOVE the "Daily quotes" header row at full content width (banners radius 16, padding 12×16, severity icon left, ✕ right at opacity .85, 8px gaps, 22px below the last banner). **On the untouched demo seed the strip here is EMPTY** — the only reminder the seed fires is `quote-missing`, and that kind is SUPPRESSED on `/` (the progress pill already says it), so the screen is byte-identical to its P2 self. To see banners here: widen Settings→Automation "Lead time, days" to **21** → the info banner (`pos-tint`) **"OVDP UA4000238976 pays a coupon in 21 days (25.08.2026)."**; edit a bond's "Next coupon" to a past date → the overdue banner (minted `neg-tint` #f0cec7 / `neg-tint-text` #693f35, clock icon) **"OVDP UA4000236475 coupon was due 25.07.2026 — record it on Daily quotes."** — **with NO action link on `/`** (the S5 coupon card is right there). A maturity within 30 days adds an info banner "… matures in N days (dd.MM.yyyy)".
- **Type select (P2 `feat/metrics-exposure`, S10) — 9 options in the pinned order:** Buy · Sell · Deposit · **Withdrawal** · Dividend accrual · Interest payout · Reinvest · **Redemption** · Tax. Both new types record via the existing schema/`recordTransaction` path (demo seed contains neither — no pinned figure moves); a recorded withdrawal shifts `netDeposits` and surfaces the `/overview` ledger-drift chip until the snapshot cash is corrected.

- **Model note under a linked bond row (A6/D52) — NOTHING in demo**, because the check needs a fetched feed and demo makes no request. In **live**, after "Fetch quotes" a linked bond may render one muted line under its row: nothing at all when the price fits the published yield (the healthy case is silent on purpose); "Provider price is N days old — it still prices to dd.MM." when the provider's own quote is stale; "Price does not fit N% on any day of the last two weeks — it would imply X% if struck today." in `warn` when no date explains it; "This price matches no yield the schedule can produce…" in `neg` when the quote is off-scale entirely; "Too close to maturity to check the yield from the price." in `faint` for a bond days from maturity. A `completed` bond renders nothing. **The note is dated from when the PAYLOAD was fetched**, never from the date picker — moving the picker must not change it.

- **Parse diagnostics (A7) — under the intro line, non-blocking.** Renders **nothing at all** until a fetch has ever succeeded on this device (no invented verdict). After a clean fetch: `All 36 feed entries read cleanly · dd.MM, HH:MM` in `faint`. When entries were skipped: a `warn` toggle `N feed entries could not be read · M read fine · show/hide`, expanding to one line per skip — `<ref> — <reason>` plus the exact rejected field paths (`assetDetails.prices.sellUAH`). It **survives a reload** (meta row `inzhur:lastParse`), and the same panel appears in Settings → Automation.

Interactions to verify:
1. Type into an empty input → its delta chip computes live vs yesterday's value; pill count increments ("2 of 4 filled"). Comma and dot decimals both accepted.
2. Typed drafts survive a reload (persisted draft store).
3. "Copy yesterday" fills all 4 inputs with yesterday's quotes.
4. "Save snapshot" → toast **"Snapshot saved"**, "Last saved" updates, IndexedDB row for the date is UPSERTED (re-saving the same day must not add a row).
5. Transaction form: selecting Asset = "+ New asset…" reveals the dashed **New asset details** sub-card; any other asset hides it. Submitting with a new asset creates asset + transaction atomically → toast **"Transaction recorded"**, Recent list updates, new asset appears as a 5th quote row with a cycled avatar tint. *Since next-phase P2 the sub-card renders the shared AssetForm fields (create mode, no First purchase — still derived from the transaction date): Name, Code (avatar preview, auto-derived from Name until edited), Yield type, Expected/Target, Payout schedule (never 'none'), plus the conditional Fixed-coupon group (yield type = Fixed coupon) and the "Link to Inzhur" toggle (off by default). The atomic `recordTransaction(tx, newAsset)` path is unchanged.*
6. **Accept / dismiss a suggestion (S4):** press "Use suggested …?" → the input becomes a real draft with that exact value (green border, ink text), the pill collapses and the progress pill increments; the draft survives a reload with provenance `accrual` in `quirenote-draft`.origins (no chip renders in demo — S2 keeps chips to Inzhur-linked rows in live). Press `✕` instead → the ghost is gone for the selected date and the input is a plain empty one; picking another date re-offers it. Typing over a ghost clears it on the first keystroke.
7. **Record a coupon (S5) — exactly one write, one roll:** with a due coupon, press **Record coupon** → toast **"Coupon recorded"** ("Coupon + reinvest recorded" with the checkbox on), the card collapses, and IndexedDB gains **exactly one** `interest_payout` dated the COUPON's date (`source: 'accrual'`, "Coupon · …8976" in Recent transactions) plus the asset's `nextCoupon` advanced **once** by the schedule **from the occurrence just recorded** (clamped onto `maturity`; at maturity it is flagged and stops suggesting). **Double-click the button** — still one transaction and one roll (StrictMode-safe: the write lives in the click handler behind a ref latch). After a reload the card does not return: a recorded payout within ±7 days of the date dedupes the occurrence — and if the NEXT scheduled date is also already in the past, its card appears immediately (the grid walk, D23). Empty the amount → neg border + **"Enter an amount."** (wired to the input via `aria-describedby`) and nothing is written. NO `tax` row is ever created (G5/D13).
8. **Skip (S5) writes nothing, and the next date still suggests:** press **Skip** → the card collapses, the transaction count is unchanged, `nextCoupon` is unchanged, and `quirenote-settings.state.dismissedReminders` gains `coupon:<assetId>:<date>`. The NEXT coupon date suggests normally — to see it in one step, set a bond to **Monthly** with a "Next coupon" two months in the past: skipping the first card immediately raises a card (and an overdue banner) for the following month. Restore every dismissal via Settings→Automation → "Restore dismissed" (checkpoint 19).
9. **Dismiss a banner (S6):** press a banner ✕ ("Dismiss reminder") → it fades/slides out over ~220ms and the banners below move up; `quirenote-settings.state.dismissedReminders` gains the banner's DERIVED id (`quote-missing:<date>` / `coupon:<assetId>:<date>` / `coupon-overdue:<assetId>:<date>` / `maturity:<assetId>:<date>`) and it stays hidden **across a reload**. Ids expire by themselves: tomorrow's `quote-missing` is a new id, and so is the next coupon date. Restore = Settings→Automation. Under `prefers-reduced-motion` the banner disappears instantly (the write still happens).
10. **Skipping a coupon card also silences its overdue banner** (shared derived id, D21/D22): press **Skip** on an overdue coupon's S5 card → the matching `coupon-overdue` banner is gone too. Dismissing the BANNER does not remove the card.

## `/overview`

On seed:
- **ReminderStrip (P3 `feat/reminders`, S6) — ACTIVE in demo**, rendered ABOVE the "Overview" header. On the untouched demo seed (any day with no saved snapshot for today) at least ONE banner: warn (`warn-tint` #f0e6cb / `warn-tint-text` #6b5527, circle-alert icon) **"No quotes saved today yet."** + the bold action link **"Enter quotes →"** (navigates to `/`) + ✕. Save all 4 quotes for today on `/` → the banner is gone; a PARTIAL day (some assets still pending) keeps it. When several fire the order is overdue (`neg-tint`) → warn → info (`pos-tint`), by date inside a severity; beyond 3 they collapse behind a muted pressable **"+N more reminders"** that expands the strip in place. Overdue coupon banners carry **"Open Daily quotes →"** here. Empty / all-dismissed / `Reminders` OFF → the strip renders NOTHING (zero height, no placeholder, no layout shift).
  **THE COUNT IS DATE-DEPENDENT, AND THIS ROW USED TO SAY "exactly ONE" (corrected 2026-08-19).** The seed's coupon dates are FROZEN — 25.08.2026 and 03.12.2026 — while "today" moves, so inside the 7-day default lead a second, info banner joins it. On the 2026-08-19 walk the strip carried BOTH "No quotes saved today yet." and "OVDP UA4000238976 pays a coupon in 6 days (25 Aug 2026)." Both are correct, and a checkpoint that counts banners has to name the date it was counted on.
- Subtitle contains the current date and "курс 44,83 ₴/$" (English: "rate 44.83 ₴/$").
- KPIs — **5 cards since P2 `feat/metrics-exposure` (S9a)**, all currency-aware, staggered mount order Total capital → Capital gain → Total return (net) → Deposited → Free cash:
  - **Total capital 149 016,36 ₴** (dark card; converts with currency toggle).
  - **Capital gain +4 452,61 ₴ / +3,08 % since 03.02** (green) — *relabeled from "Net result" in P2; value/sub byte-identical (D5-pinned)*. **The date is DERIVED since A24, not a constant** — on the seed it still reads 03.02, and on an EMPTY dataset the whole sub-line is absent rather than naming a date nothing supports.
  - **Total return (net) +5 839,99 ₴** with sub **"+4,08 % on net deposits"** (green; new total-return-family KPI = totalCapital − netDeposits with globalRoi sub; tweens + converts like its siblings; sub "—" muted when netDeposits ≤ 0).
  - **Deposited 143 176 ₴** with sub "+ 1 387,38 ₴ reinvested".
  - **Free cash 7,75 ₴**, sub **"0,01 % від рахунку"** — **NO ledger-drift chip on untouched demo** (drift 0 by construction, S9d). After recording e.g. an unmatched Withdrawal 100 ₴ the amber warn-tint pill **"Ledger drift +100,00 ₴"** (U+2212 on negatives) appears under the sub with a `title` tooltip; it disappears once |stored − derived| ≤ 0,01 ₴ again.
- Assets card: 4 rows (color dot, name, meta like "div + cap · 46,1 %", value, green +%) + 12px stacked share bar.
- Right stack: "Next payouts" (green tint; bond rows from coupon attributes, REIT row estimated "~… ₴" — see D5#7). **Every row is on or after TODAY since A28** — a projection that has fallen behind rolls forward by whole periods, so the card's contents depend on the day it is read: on 2026-08-19 the order was Купон …8976 25.08 → Дивіденд REIT 10.09 → Купон …6475 03.12, "Rebalance hint" (**top up ≈11 429 ₴** — NOT the reference's 11 413, D5#4; "Open Allocation →" navigates), "Income received" **5 040,94 ₴** (dividends 3 641,44 ₴ / coupons 1 399,50 ₴, **plus the P2 second sub line "net of tax 5 040,94 ₴"** — equals gross on demo, no seeded tax rows).

## `/balances`

On seed:
- Green area chart of total capital per complete snapshot (Feb→Jul, rising to ~149k).
- Snapshot table, newest first: **27.07 row shows `68 702,10` then "pending" ×3, cash `7,75`, total "—"**; 25.07 row total **`148 943,62`**; rows continue 24.07 → 21.07 (**no 26.07 row**).
- Footer: **"Showing last 6 snapshots · 174 total since 03.02.2026"** + Prev/Next pagination over the full history.
- After saving all 4 quotes on `/` for today: the pending cells fill and the row total computes.

## `/payouts`

On seed:
- Stacked monthly bars (dividends green, coupons blue-gray, value labels on top).
- Cards: **Received 5 040,94 ₴** (dark) · Upcoming (green tint, attribute-based) · **Reinvested 1 387,38 ₴ · 27,5 % of received income**.
- Payout log table: Date | Asset | Type tag | Amount | Destination — destinations show **"reinvested (687,02 ₴)"**-style when a same-date reinvest exists, else "account". The seed's three are **687,02 · 484,36 · 216,00**. *(This example read "68 702 ₴" until the 2026-08-19 walk — REIT's quote, and 100x any reinvest that exists. D5#3 had it right; only this file was wrong.)* One row is seeded as **472,13 on 10.05** (adjusted per D5#3).
- Recording a new dividend/interest transaction on `/` updates bars + log.

## `/yield`

On seed:
- 4 cumulative-% lines in asset colors with end dots.
- Table (8 columns since P2 `feat/metrics-exposure`, S9b): Asset | Invested | Value now | Δ total | Annualized | **Total return** | **XIRR (ann.)** | vs expected. Existing-column checks unchanged: …6475 annualized **+10,9 %** (global 03.02 basis — D5#5; NOT +34,5 %), REIT Δ **+4,41 %**; negative "vs expected" gaps in terracotta with "pp".
- **Total return column** (signed bold, net of taxes, incl. payouts; ÷ investedOwn): REIT **+10,12 %** · Energy **+1,48 %** · …8976 **+10,65 %** · …6475 **+10,96 %**. May disagree with Δ total by design (illusion-of-loss, FORMULA-AUDIT §2).
- **XIRR column** (plain ink, 1 dp, money-weighted): REIT **+23,0 %** · Energy **+3,1 %** · …8976 **+25,8 %** · …6475 **+99,4 %** (D18: derived figures, not D5-pinned; the extension mock's +99,5 % was illustrative rounding). Header reads **"XIRR (ann.)"** while portfolio history < 365 days (demo: yes, 174 days); plain "XIRR" after a full year. Null/unquoted metrics render "—" muted.
- Table min-width grew (780px) — it scrolls INSIDE the card; the page still has no horizontal scroll at 360px.
- Footnote (extended in P2): "Annualized = total Δ scaled to 365 days from first purchase (03.02.2026). Coupons count toward Δ on accrual. Total return is net of taxes and includes payouts. XIRR is money-weighted and annualized — with under a year of history, treat it as an extrapolation." **The 03.02.2026 in it is derived from the data since A24** (earliest of: any transaction, any snapshot, any asset's first purchase) and reproduces the pinned date exactly on the seed. On an empty dataset the footnote does not render at all.

## `/attributes`

On seed:
- 2×2 grid of read-only asset cards: avatar + name + yield-type tag + ~6-fact `<dl>`.
- Check: targets 40/40/17/3; **Energy shows "None (price only)"** for payout schedule; bond cards swap in YTM at purchase / Coupon / Maturity / Next coupon.
- Assets created via the transaction form appear here with their entered attributes.

## `/seasonality`

On seed:
- Day-of-month bar chart: gray 3–5px stubs on no-income days; tall bars on days **3, 10, 25**; **THREE labelled bars, each `actual · expected*`** (measured 2026-08-19, EN rendering): day 3 `₴216 · ₴216*`, day 10 `₴3,641 · day 10` (NOT the reference's 3 817 ₴ — D5#3), day 25 `₴1,184 · ₴1,240*`. The `*` marks the expected half, from coupon attributes. *(This row named two of the three and gave neither the actual-versus-expected pairing.)*
- Footnote explaining stubs; 3 insight cards: "Income anchor" (day 10, green tint), "Coupon season" (**February & August (day 25)** carry the big …8976 coupons; …6475 pays in early **June** — full month name, not "Jun"), "Quiet stretch" (days 26–31).

## `/portfolio`

On seed:
- Positions table: Asset | Yield-type tag | Invested | of it reinvested (**REIT 1 171,38 / …6475 216,00**) | Value now | **Capital gain, ₴** | **Capital gain, %** | Share; bold Total row **"Total + cash 7,75 ₴"** with value **149 016,36**. *Headers relabeled from "P&L, ₴/%" in P2 `feat/metrics-exposure` (S9c) — every cell value identical to pre-P2 output (+2 902,10/+4,41 % … total +4 452,61/+3,08 %).*
- Footnote under the table (P2): "Capital gain = value − invested (incl. reinvested payouts). Payout income counts in Total return on the Yield screen."
- Cards: Best performer **…6475 +5,20 %** · Laggard **Energy** · Income engine **REIT** (green tint).
- **EDIT MODE (A31, brief S3) — assets are managed HERE since 2026-08-19**, not in Settings. This is the PER-ENTITY variant: the header shows a ghost **"Редагувати"** at rest and a single filled **"Готово"** while editing — **no Save and no Cancel**, because create / edit / delete each commit through their own dialog.
- **Desktop gains a NINTH COLUMN, and only in edit mode** — an always-present empty column would widen the table's min-width for a control that is not there. Its `<th>` carries an `sr-only` "Дії", each row's first cell is a `<th scope="row">`, and both action buttons carry the asset in their accessible name ("Змінити Inzhur REIT"): four identical Edit/Delete pairs otherwise tell a screen reader nothing on a control where one choice is destructive. **The Total row gets the cell and no buttons** — a sum is not an entity.
- **Below `md` the record card grows a FOOTER BAND** after the facts — a hairline rule, then the two actions pushed right. Not the card header: that is where A17/D66 closed a 360 px overflow. The Total card gets no band.
- **`+ Додати актив`** appears with edit mode in both shells, and an EMPTY portfolio keeps the header control for exactly that reason — plus the empty sentence "Активів ще немає — додайте перший, щоб почати облік."
- **Delete confirm, reused untouched:** `role="alertdialog"`, no typed-name arming, cascade sentence with real counts (REIT **9 транзакцій / 174 дні**, …6475 **3 транзакції / 54 дні**) and the "Download backup first" CTA. **The counts are frozen when the dialog opens** — recomputed live they flipped to zeros during the 220 ms exit, after the delete had already invalidated the queries.

## `/allocation`

On seed:
- Donut (30px ring, asset colors) with center **"149 ₴k / 4 assets + cash"** + legend.
- "Current vs target" pills: fill = current share, black 2px tick at target. Deltas: REIT **+6.1 (red — overweight)**, Energy **+0.3 (green)**, …8976 **−6.4 (red)**, …6475 **−0.1 (green — near target)**. Color encodes **off-target severity, not sign**.
- Rebalance plan: numbered actions — top up …8976 **≈11 429 ₴** (D5#4), trim REIT **≈9 096 ₴** (derived 9 095,56, prose-rounded).
- **EDIT MODE (A30, brief S2) — the targets are edited HERE since 2026-08-19**, not in Settings. At rest the header carries a single ghost **"Редагувати"** and the card is exactly as described above. Pressing it swaps the header to ghost **"Скасувати"** + filled **"Зберегти"** — one filled button while editing, none at rest, and that IS the whole "this page is in edit mode" signal (no wash, no border, no banner). Each row's `share / target` reading becomes `share` · `/` · a **72px right-aligned input** (h 36, r 9) · `%`, the "ЦІЛІ" microlabel appears at the card's top right, and the Σ pill appears under the rows.
- **The live preview is the TARGET TICK, not the fill.** Typing 45 for REIT moves the black tick from 40 % to 45 % and re-derives the pp delta against it; the coloured fill stays at **46,1037 %** — an entered target cannot change what you own.
- **Σ ≠ 100 warns and never blocks** (amber pill "Σ 105 % — цілі не дають у сумі 100 %", Save still enabled). **An unparseable entry is the one thing that does block**: neg border, right-aligned "Введіть відсоток.", Save disabled — and Σ returns to its stored value rather than zeroing. **Save is also disabled when nothing has changed**, so the "Цілі збережено" toast can never confirm zero writes.
- **Leaving with unsaved work asks first:** Cancel, Escape or a sidebar navigation opens **"Відхилити зміни?"** with "Продовжити редагування" / "Відхилити". Escape closes THAT dialog rather than re-opening it, and a discarded navigation still goes through. **Cancel is disabled while a save is in flight** — a save cannot be un-issued, so it cannot be abandoned either.
- After a save the rebalance plan re-derives from the SAVED targets: at REIT 45 % the trim reads **−1 645 ₴** against −9 096 ₴ at 40 %.

## `/settings` — Settings home (next-phase P2)

On seed:
- Header **"Settings"** + subtitle "Preferences, data and portfolio configuration".
- 4 stacked white cards (radius 24) in pinned order, staggered fade/slide on mount (D7): **Portfolio → Data → Automation → Appearance**, each with a 10px uppercase microlabel.
- **Portfolio (asset manager) — GONE from this screen since 2026-08-19 (A31).** The 4 asset rows, their Edit/Delete pills and the "+ Add asset" footer all live on `/portfolio` now, behind that screen's edit control; the AssetForm dialog and the D17 delete confirm are reused there unchanged. **Checkpoints 7 and 0 below still describe reaching them from Settings and are stale in that one respect** — the flows themselves are identical, only the route changed.
- **Portfolio (targets editor) — GONE from this screen since 2026-08-19 (A30).** It lives on `/allocation`, inside the "Current vs target" card, behind that screen's Edit control; its checkpoints moved with it. Settings keeps only the asset manager here, until A31 moves that too.
- **Data (dataset switch, `feat/dataset-split`, S5):** "Dataset" row — helper "Demo holds the built-in reference portfolio. Live starts empty and holds your real data. Switching reloads the app."; light-surface **Demo / Live** segmented control (track panel, white sliding thumb, active segment bold ink) — Demo active on seed. Then the **Backup row** — title "Backup", helper now ending "**Restore it with Import below.**" (P4 supersedes the P2 "later release" promise), outline button **"Download backup"** (right side; identical behavior to the removed sidebar pill: downloads the formatVersion-1 envelope, on seed 4 assets / 174 snapshots / 18 transactions + settings; the envelope's `dataset` field = the active dataset). Then the **Import row** (P4 `feat/backup-import`, S2) — see below. Then the **Danger zone row** (`feat/clear-data`, S6): helper "Both actions ask for a typed confirmation and offer a backup first." + one neg-outline trigger per dataset — **"Reset demo data…"** in demo, **"Erase live data…"** in live — both opening the typed-name AlertDialog (checkpoints 16–17).
- **Data → Import (P4 `feat/backup-import`, S2):** full-width label block (no right-hand control) — title **"Import"**, helper "Restore a JSON backup, or load a CSV of snapshots. Import replaces everything in the active dataset — you review a summary first, and a safety backup downloads automatically."; **in demo only** an 11px muted note "You're in the demo dataset — importing here replaces the reference portfolio. "Reset demo data…" brings it back."; then the drop target — bg `panel`, **SOLID** 1px `panel-border` (never dashed), radius 16, padding 20, centred: 16px download icon, "Drop a .json or .csv file here", muted "or use Choose file…", and the outline **"Choose file…"** button INSIDE the panel (the row's only tab stop — the panel is not focusable and drop is a pointer-only enhancement). Import is **never disabled**, in either dataset. CSV is named in the copy but rejected until `feat/csv-roundtrip` lands (checkpoint 22).
- **Automation (P3 `feat/fixed-yield`, S8):** two `SettingRow`s with the pinned switch anatomy (track 40×22, off `hairline`/`panel-border`, on `ink`, 16px white thumb), both **ON by default** and identical in demo and live — **"Quote suggestions"** ("Pre-fill ghost values for unquoted fixed-coupon assets from coupon accrual. Suggestions stay ghosts until you accept them.") and **"Coupon suggestions"** ("Offer one-tap recording when a coupon date arrives. Every entry is confirmed by you — amounts stay editable."), then (P3 `feat/reminders`) a third switch **"Reminders"** ("In-app banners for missing quotes, upcoming and overdue coupons, and maturities. Nothing leaves the app.", ON by default) with two sub-rows indented 12px behind a hairline left rule, present only while it is on: **"Lead time, days"** ("How many days ahead coupon reminders appear.") with a 72px right-aligned input prefilled **7**, and **"Dismissed reminders"** ("Dismissed banners stay hidden until their date passes.") with the outline button **"Restore dismissed"** — disabled and count-free at 0, otherwise **"Restore dismissed (N)"**. Fetching itself has no toggle — it is a manual click by construction. **A7 adds a read-only `"Last feed parse"` row** ("What the last Inzhur fetch could and could not read. Entries that fail are skipped, never guessed — the rest of the feed still loads.") carrying the same panel as `/`: `All N feed entries read cleanly · dd.MM, HH:MM`, or a `warn` expandable listing each skipped ref with its reason and the rejected field paths. Read-only on purpose — the controls that let the owner tune parsing need the B3 user model (PLAN-OPEN O14).
- **Appearance:** "Currency" row with a light-surface ₴ UAH / $ USD segmented control (sliding thumb like the sidebar toggle) — helper "Валюта, з якою відкривається застосунок. Перемикач у бічній панелі лише показує іншу, не зберігаючи вибір." (A21); "₴/$ rate" row with a 110px right-aligned decimal input prefilled **44.83**, and beneath it (A5/D51) an outline **"Fetch rate"** button, the whole block right-aligned to the row edge; "Theme and language settings are coming later." placeholder.
- **₴/$ rate — fetching the official rate (A5/D51):** in **demo** the button is **disabled** with "Demo data — no requests leave the app." beneath it — no request may leave the app (G4/D16). In **live**, pressing it queries the NBU statistics directory for **today's Kyiv date** and shows `NBU <rate> for <dd.MM.yyyy>` plus a **"Use it"** link; the input keeps the **stored** value until "Use it" is pressed (G5), after which field and store both read the new rate. A failed fetch shows the last known rate labelled "· last known, not refreshed", or "No rate available — the stored <rate> stays in effect." when nothing is cached; either way a toast reports the failure. Typing still accepts comma decimals (`41,5`) and rejects junk without writing it.

Interactions to verify:
1. Sidebar "SETTINGS" group sits between Analytics and the currency toggle; the Settings pill activates (light bg, bold, `aria-current="page"`) on `/settings`.
2. **Currency control moves the sidebar, and the sidebar does NOT move it back (A21).** Flip in Settings and the sidebar thumb plus every headline KPI follow immediately, and the choice is written to `quirenote-settings.state.defaultCurrency`. Flip in the SIDEBAR and the KPIs follow but this control stays where it was and nothing is written; reload and the sidebar returns here. Thumb slides ~300ms (D7) on both. The pre-A21 wording said they mirror each other both ways — they no longer do. It also said the logo symbol follows; it does not, and has not since the circle stopped carrying ₴/$.
3. Editing the rate to a valid number (comma or dot decimals) updates the sidebar `$` sub-figure and the Overview subtitle `rate … ₴/$` immediately, and **persists across reload** (`quirenote-settings.state.usdRate`).
4. Invalid input (`0`, `-1`, `abc`, or emptied on blur) → neg border + "Enter a rate above 0." message; the store keeps the last valid rate (headline figures unchanged).
5. "Download backup" disabled while pending; failure shows toast "Could not build the backup — please try again."
6. 360px: cards stack, control rows wrap (label above control), no horizontal scroll; the AssetForm dialog fits unclipped. **Since D65 it is three bands** — the title and the Cancel/Save row are FIXED and must not move while the middle scrolls (scroll it and watch them); text sits 28px from both panel edges at every scroll position, and the rail keeps the SAME 8px margin on all four sides — panel edge, text, top and bottom alike. A field that reaches the panel edge, or a bar drawn over a value, is a regression.
7. **Add asset** opens the AssetForm dialog (create): heading "＋ New asset details", fields Name / Code (avatar preview cycles the next free hue; auto-derives from Name until Code is edited) / Yield type / Expected+Target / Payout schedule (4 options, never 'none') + First purchase (prefilled today); Fixed-coupon group (Maturity, Next coupon, Coupon amount, Reinvest policy) revealed only for yield type = Fixed coupon; "Link to Inzhur" toggle reveals Units (emphasized, units-first) + Fund/Bond kind segment + the ref field + helper line. Submit "Add asset" → toast **"Asset added"**, row appears, new quote row on `/`, card on `/attributes`. **Ref field since P3 `feat/fetch-quotes` (S7):** in **demo** it is the P2 manual text input plus the note "Live list is disabled in demo — enter the slug or ISIN manually." and no mode link; in **live** it is a **picker** ("Pick from Inzhur…") that fetches the feed on first open — funds read "Inzhur REIT · inzhur-reit", bonds "UA4000238976 · matures 24.03.2027" (list capped ~240px, scrolls; the trigger shows the primary text alone) — with an always-available "Enter manually" ↔ "Pick from the list" round-trip (the ref string is preserved both ways, and it is the same slug/ISIN the manual field stored). Offline/error with no cache → the manual input plus the muted note "Couldn't load the list — enter it manually." (never `neg` — linking is never blocked); a last-good cache feeds the list with a warn footer "as of dd.MM". The group helper now reads "Linked assets are valued as units × the fetched sell price — use Fetch quotes on Daily quotes."
8. **Edit** opens the same dialog prefilled ("Edit asset" / "Save changes"): e.g. changing …8976's Maturity updates the Attributes card and Overview "Next payouts" after save (toast **"Asset updated"**). Editing Energy (payout schedule 'none') additionally offers "None (price only)" in the schedule select — no other asset gets that option. Amount prefills use the pinned input format: …8976's Coupon amount shows **`1 240,00`** (NBSP + comma, fmtTable); Inzhur units prefill grouped without forced decimals (`15`, `6 164`); percent fields stay dot-decimal (`16.4`).
9. **Delete** opens a confirm dialog stating the cascade: "This removes the asset and everything recorded for it — N transactions and quotes on M days." (on seed: REIT 9 transactions / 174 days, Energy 1/173, …8976 2/171, …6475 3/54) with **"Download backup first"** (flips to "Backup downloaded ✓") + neg **"Delete asset"** → toast **"Asset deleted"**, cascade removes its transactions and quote cells everywhere. Alert semantics like 16–17 (`role="alertdialog"`, clicking the overlay does NOT dismiss, Esc cancels) but no typed-name arming — that's reserved for erase/reset.
10. Validation: submitting an empty create form highlights fields with the pinned messages ("Name is required." · "Code is 1–2 letters." · "Enter a percentage." · "Enter the number of units." …) + summary "Check the highlighted fields and try again."; the linked-ref message follows the kind ("Enter the fund slug." / "Enter the bond ISIN.").
11–13. **Targets — MOVED to `/allocation` (A30, 2026-08-19).** The Σ recompute, the non-blocking-warn-versus-blocking-error pair and the save-patches-only-changed-assets checks all now run inside that screen's edit mode; see its section above. The numbering below is left alone on purpose — renumbering fourteen checkpoints to close a gap would invalidate every reference to them elsewhere.
14. **Dataset flip → live:** click **Live** → both segments briefly disable (pre-reload lockout) → the app reloads with `quirenote-settings.state.dataset = "live"`. After reload: **no DEMO badge**, every screen shows its v1 empty state (sidebar total **0 ₴** / "+0,00 % · 0,00 $", Daily quotes "0 of 0 filled", Balances "No snapshots yet…", zero-value Overview KPIs — no crash anywhere), Settings→Portfolio shows "No assets yet — add your first asset to start tracking.", the Danger zone row offers **"Erase live data…"** (never "Reset demo data…"). Reloading again stays empty — live NEVER auto-seeds (not even the `meta` seeded flag is written). IndexedDB now contains both `quirenote` and `quirenote-live`.
15. **Dataset flip → demo:** click **Demo** → reload → DEMO badge returns and every seed checkpoint above is intact (the demo DB was untouched by the excursion to live).
16. **Reset demo data (typed confirm, S6):** in demo, "Reset demo data…" opens the AlertDialog — title "Reset demo data?", body about replacing the demo dataset, label "Type demo to confirm" with the input **auto-focused**; the danger button **"Reset demo data" stays disabled until the input matches `demo`** (case-insensitive, trimmed — `" DEMO "` arms, `dem` doesn't); **"Download backup first"** downloads the active-dataset envelope WITHOUT closing the dialog and flips to a muted inert "Backup downloaded ✓"; ghost Cancel / Esc close without changes (clicking the overlay does NOT — alert semantics). Armed confirm → `clearAll({reseed:true})` → toast **"Demo data reset"** and all seed checkpoints (4/174/18 rows, 149 016,36 ₴ …) are restored after any demo edits.
17. **Erase live data (typed confirm, S6):** flip to live and record something (e.g. add an asset + save a snapshot + type a quote draft on `/`); Settings→Data shows **"Erase live data…"** → dialog "Erase live data?" (body mentions the quote draft being cleared and settings kept), label "Type live to confirm", same arming/backup mechanics as 16. Armed **"Erase live data"** → `clearAll({reseed:false})` → toast **"Live data erased"**, every screen shows its empty state without a reload (full query invalidation), the Daily-quotes draft is gone (`quirenote-draft` reset), and `quirenote-settings` (currency/rate/dataset) is retained. **Reload → still empty** (meta `seeded` flag; live never auto-seeds). Demo dataset untouched throughout — flip back to demo and every seed checkpoint holds.

18. **Automation switches (S8):** flipping either switch takes effect on `/` **without a reload** (Quote suggestions off → every ghost, `SUGGESTED` tag and "Use suggested …?" pill disappears; Coupon suggestions off → every coupon-due card disappears) and persists to `quirenote-settings.state.autoQuoteSuggest` / `.couponSuggest`; a legacy payload without them hydrates to ON. The thumb slides ~220ms (D7); both are keyboard-operable with a visible focus ring.

19. **Reminders switch + lead time + restore (S8, `feat/reminders`):** flipping **Reminders** off collapses both sub-rows (~300ms fade/slide, symmetric on re-enable) and removes the strip and the app-open toast everywhere immediately — no reload — persisting to `quirenote-settings.state.remindersEnabled` (the S5 coupon CARDS are governed by `couponSuggest`, not by this switch). **Lead time:** typing `21` re-windows coupon banners instantly (the seed's 25.08 coupon, 21 days out, appears on `/` and `/overview`) and persists to `.reminderLeadDays`; an invalid entry (`0`, `31`, `45`, `7.5`, `abc`, or emptied on blur) shows a neg border + **"Enter 1–30 days."** and **never writes** — the last valid lead time keeps windowing the banners. **Restore dismissed:** the label counts current dismissals ("Restore dismissed (1)"); pressing it clears `dismissedReminders` entirely, re-surfaces every banner still in window (including coupons skipped from an S5 card) and toasts **"Dismissed reminders restored"**; at 0 it is disabled and drops the count.

20. **Import — a rejected file (S4, P4 `feat/backup-import`):** "Choose file…" (or a drop) with a file that is not a `.json` shows the amber **"That file type isn't supported — pick a .json backup."** under the panel, opens nothing and clears itself after ~5s (the other three file-level messages: "That file is larger than 25 MB — it doesn't look like a Quirenote export." · "Drop one file at a time." · "That file is empty."). A `.json` that parses but fails validation opens the **report dialog** instead — title "This file can't be imported", mono file name, `neg` lead "Nothing was changed. Fix the file and try again.", an exact count microlabel ("3 problems found", "12 problems found — showing the first 10", singular "1 problem found") and a scrolling `panel` sub-panel of mono row-addressed items: `transactions.tx-0099 — unknown asset id "a-9"` · `snapshots.2026-02-08 — quote for an unknown asset "a-9"` · `snapshots — duplicate date 2026-02-03 (date is the primary key)` · `assets.2.createdAt — expected timezone-less yyyy-MM-ddTHH:mm:ss` (assets are addressed by INDEX, snapshots by date, transactions by id — D24) · `assets.0 — unexpected field "foo"`; closing hint "Rows are checked before anything is written — one bad row stops the whole import."; ghost **Close** + outline **"Choose another file…"** (re-opens the picker). A format-level failure is ONE sentence plus the D12 parser line in mono — e.g. formatVersion 2 → "This backup was written by a newer version of the app (format 2). Update the app, or export again from the version that wrote it." + "Unsupported formatVersion 2 — this app reads formatVersion 1 only." **The dataset is provably untouched after every rejection** (row counts and the sidebar total unchanged).
21. **Import — preview, diff and confirm (S3):** a valid backup opens the preview — title **"Import into demo"/"Import into live"** (the ACTIVE dataset), subline `<file> · exported dd.MM.yyyy HH:MM · from <dataset>`, the non-dismissible `neg-tint` **replace banner** naming the dataset (demo adds ""Reset demo data…" restores the reference portfolio afterwards."), the **dashed `faint` diff panel** ("WHAT CHANGES", columns Table/Added/Replaced/Removed — added `+n` in `pos`, replaced unsigned in `warn`, removed `−n` U+2212 in `neg`, a zero muted), the result line "After import: 4 assets · 174 snapshots · 18 transactions.", the `warn-tint` warnings block when any fire ("1 snapshot and 3 transactions in demo are missing from this file — they will be removed." · "This file has no assets — the dataset will be empty after import." · "This file has no snapshots — all 174 saved days in live would be removed." · "This file was exported from the demo dataset." · "Exported 12 days ago (23.07.2026)." · "The file comes from a newer database version (3 vs 2) — fields this app doesn't know are ignored."), the **default-OFF** settings checkbox ("Also apply the settings saved in this file" + "Replaces your default currency and ₴/$ rate (₴ UAH · 44.83). Dataset, automation and reminder preferences are never touched.") — replaced by "This file carries no settings." when the file carries none — the safety-backup line, and ghost **Cancel** + `neg` **"Replace all data"**. Initial focus is Cancel; the overlay never dismisses; **Cancel/Esc leave the row counts byte-identical**. Confirm → `quirenote-before-import-<today>.json` **downloads first** (the line flips to "Safety backup downloaded — …"), then one rw transaction, then toast **"Data imported — 4 assets, 174 snapshots, 18 transactions."** and every screen re-renders with no reload. Warnings never block the confirm. **360px:** each table becomes its own block (`ADDED 0 · REPLACED 173 · REMOVED −1` with 10px labels) and the two buttons stack full width with the destructive one last.
22. **Import — CSV is announced but not yet accepted:** the copy and the file picker name `.csv` (the finished S2 row), but until `feat/csv-roundtrip` lands a `.csv` gets the pinned file-type message. Re-verify this checkpoint when that task merges.
23. **Two tabs (P4 `feat/backup-import`, D24):** open a second tab on `/overview`, import in the first → the second toasts exactly once **"Data was replaced in another tab."** and re-renders from the new data **without a reload** (import yesterday's backup and its total moves 149 016,36 → 148 943,62 as the 27.07 partial snapshot disappears); "Erase live data…"/"Reset demo data…" broadcast the same way. The acting tab never toasts at itself. Holding the write lock in the other tab (`navigator.locks.request('quirenote-db', () => new Promise(() => {}))` in its console) makes the confirm sit at **"Waiting for another tab…"** with both buttons disabled and Esc inert — and the safety backup is already downloaded by then, which is the ordering guarantee made visible.

## Cross-cutting recipes

0. **Fetch quotes end-to-end (LIVE dataset, P3 `feat/fetch-quotes` S1–S3 — needs the internet):** flip to live (checkpoint 14), Settings→Portfolio → "Add asset" → yield type "Dividends + capitalization" → Link to Inzhur ON → Units `6164` → the **Fund picker** ("Pick from Inzhur…") → pick "Inzhur REIT · inzhur-reit" → Add asset. On `/` the button is enabled: press it →
   - the row's draft fills with **units × the live sell price** (e.g. 6 164 × 11.0288 = `67 981,52` — a live figure, so it moves daily; the invariant is `units × sellUAH` rounded to kopecks), chip **`AUTO` + "fetched HH:MM"** (Kyiv clock), the progress pill counts it, header microcopy **"Inzhur HH:MM"** (muted);
   - **nothing is saved** — IndexedDB `quirenote-live.snapshots` stays empty until you press "Save snapshot" (G5);
   - type over the value → chip flips to **`MANUAL`** on the first keystroke; press Fetch again → **your value is untouched** and a dashed **"Use fetched 67 981,52?"** pill + `✕` (aria-label "Keep my value") appears under the input. Accept → value replaced, chip back to `AUTO`; dismiss → nothing changes and the offer stays away until the next fetch resolve. Typing exactly the fetched number produces NO offer;
   - a second press while the payload is still fresh (before the feed's next ~13:00 Kyiv refresh) re-serves it with **no new network request**;
   - **DevTools → Network → Offline, then press Fetch:** label "Fetching…" → back to idle (never red) + toast **"Couldn't reach Inzhur — check your connection."** with the action **"Use values from dd.MM"**; pressing the action applies the cached payload — typed rows are still only OFFERED (warn variant "Use 67 981,52 (as of dd.MM)?"), filled rows get the amber **`AS OF dd.MM`** chip. Chips and drafts survive a reload (`quirenote-draft`.origins);
   - a live asset with NO Inzhur link → button disabled with the `title` "No Inzhur-linked assets yet — link one on Portfolio." *(the string named Settings until A31 moved the manager)*.
   Clean-up: delete the asset (or "Erase live data…"), then flip back to demo.
1. **Derivation integrity:** record a Buy of 1 000 ₴ on an asset → Portfolio Invested/P&L, Overview KPIs, Allocation shares and the sidebar total all shift consistently; no figure stays frozen (nothing is hard-coded).
2. **Currency scope:** toggle to $ → ONLY logo symbol, sidebar capital and Overview headline KPIs convert; every table (Balances, Payouts, Yield, Portfolio) stays in ₴.
3. **Upsert:** save today's snapshot twice with different values → one row per date in IndexedDB, latest values win.
4. **Reseed:** wipe storage (see top) → app returns exactly to the seed checkpoints above.
5. **A11y sweep:** Tab through a screen — visible 2px focus rings; active nav pill has `aria-current="page"`; hover states on pills/buttons/rows.
6. **Motion sweep (D7):** every interaction animates softly — buttons scale down on press, hover states fade (not snap), route changes fade/slide the content in, chips/pills animate on value change, charts sweep in; dialogs close with a symmetric 220ms fade/zoom-out (never vanish in-frame) and the AssetForm fixed-coupon/Inzhur groups slide OUT on hide (300ms) as well as in. With `prefers-reduced-motion: reduce` emulated, all of it collapses to instant.
7. **Export → erase → import restores every checkpoint (P4 `feat/backup-import`, D24 — the phase's headline invariant):** in **demo**, Settings→Data → **"Download backup"** (`quirenote-backup-<today>.json`, 4/174/18 + settings). Flip to **live** (checkpoint 14) → every screen shows its empty state. Settings→Data → **"Choose file…"** → pick that file → the S3 preview reads `Added +4 / +174 / +18`, `Removed 0`, warning "This file was exported from the demo dataset." → **"Replace all data"**. Then, in the LIVE dataset: sidebar `149 016 ₴` `+3,08 % · 3 324,03 $`; `/overview` 149 016,36 ₴ · Capital gain **+4 452,61 ₴ / +3,08 %** · Total return (net) **+5 839,99 ₴ / +4,08 %** · Deposited **143 176 ₴** + 1 387,38 ₴ reinvested · Free cash 7,75 ₴ · Income **5 040,94 ₴** (div 3 641,44 · coupons 1 399,50) · rebalance "top up 11 429,50 ₴"; `/yield` …6475 annualized **+10,9 %** (and the D18 derived columns +10.12/+1.48/+10.65/+10.96 · XIRR +23.0/+3.1/+25.8/+99.4); `/portfolio`, `/allocation`, `/balances`, `/payouts`, `/seasonality` identical to their demo checkpoints. **If a round-trip moves a pinned number the serializer is wrong, never the checkpoint.** A safety backup `quirenote-before-import-<today>.json` lands in Downloads holding the PRE-import (empty) live dataset — proof of the ordering. Clean up with "Erase live data…" (checkpoint 17), then flip back to demo (checkpoint 15): the demo DB was never touched.

## Known intentional deviations from the design reference (D5)

Testing agents must NOT report these as bugs (full rationale in `docs/decisions/README.md` D5):

| Where | Reference shows | App shows (derived) |
|-------|-----------------|---------------------|
| Overview rebalance hint / Allocation plan | top up 11 413 ₴ | ≈11 429 ₴ |
| Seasonality day-10 label | 3 817 ₴ | 3 641 ₴ |
| Payout log, one dividend row | 648,13 on 12.05 | 472,13 on 10.05 |
| Payout log, 10.06 dividend destination | plain "reinvested" | reinvested (484,36 ₴) |
| Payout log, 03.06 coupon destination | plain "reinvested" | reinvested (216,00 ₴) |
| Overview "Next payouts" REIT estimate | ~715 ₴ | ~700 ₴ (latest dividend) |
| May payouts bar label | includes 648,13 | includes 472,13 |
