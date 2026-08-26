# Section C — app work that needed nothing else

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A15, A5, A6, A7. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section C — App, pure and independent

## A15 — The daily run derives its own observation — `infra/observe-on-schedule`

**Goal:** the observation table stops falling one day further behind every day.

**Rationale — found 2026-08-12 while checking the first night after A4.** `observeNbu` runs only when something invokes it with `{observe: …}`. The scheduled path captures both sources, reports the alert channel and reports backup age — and then stops. So the payload for `as_of 2026-08-11` is archived, and no observation row exists for it. The table is frozen at the backfill's last date and will stay frozen until a human remembers.

Nothing is broken **today**, because the read API of B2 does not exist yet and nothing reads observations. That is exactly what makes it worth fixing now rather than later: the failure is invisible until the moment something depends on it, and then it looks like data loss rather than a missing call.

- [x] `observeAndReport()` runs on the scheduled path over a **7-day trailing window**, not the single date. A hole left by a missed night is invisible — the payload is still safely archived and every indicator stays green — so the window makes the run self-repairing rather than relying on someone noticing.
- [x] Reuses the existing idempotency: `ON CONFLICT DO NOTHING`, and `written` is `rowCount` (D50).
- [x] Publishes `observationsWritten` every night, including the nights it writes zero.
- [x] **No alarm on it, deliberately.** Zero is the healthy reading at weekends (NBU publishes nothing) and on any already-derived window, so alarming on zero would page every Saturday — and an alarm that pages for nothing gets muted. That is the D44 lesson applied *before* making the mistake. The graph is the signal: a spike each business day, flat across weekends; flat through a working week means the derivation stopped.
- [x] Scope unchanged — the held ISINs (D50). This task was about *when* the derivation runs, not what it covers.

**Verify — passed 2026-08-12:**
- first run filled exactly the missing day: `from 2026-08-04, dates 6, seen 12, written 2, mismatched 0` — the other ten offered rows were already present;
- second run: `written 0`. A no-op shown, not assumed;
- the table advanced to `as_of 2026-08-11` with gaps still zero — 275/275/275 and 135/135/135;
- the derived row matches the provider's file for 2026-08-11 exactly: `1110.47 / 15.751833 / 104.603`.

**Risk:** low. Network-free, idempotent, bounded by the same limit the backfill uses.

## A5 — Live NBU ₴/$ rate — `feat/nbu-rate`

**Goal:** retire the hard-coded 44.83.

**Rationale — verified 2026-08-11, and it is not an automation.** `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&date=YYYYMMDD&json` is public with `Access-Control-Allow-Origin: *` and returned `44.8305` today. A user-triggered fetch is the same shape as "Fetch quotes" — the "exactly one automation" ruling constrains **timers**, not requests. The stored 44.83 is already stale (NBU gave 44.7876 on 2026-08-04) and it silently mis-states every $ headline.

- [x] `core/nbu/rate.ts` — tolerant pick-parse, per-entry skip, same idiom as `core/inzhur/parse.ts`. It takes the response **TEXT**, not parsed JSON: every failure this endpoint has arrives as an HTTP 200, and one of them (`[{ Wrong date format }]`) is not JSON at all — `response.json()` would throw before any tolerance ran. `core/nbu/date.ts` now holds the one `dd.MM.yyyy` reader both NBU parsers share.
- [x] **Always passes an explicit `date=`.** Without it the endpoint returns *tomorrow's* rate once published in the afternoon — a silent off-by-one on every value the user sees.
- [x] Weekend/holiday behaviour **measured, and the guess would have been wrong**: no 404, not empty — NBU carries the previous banking day forward (2026-08-07/08/09 all `44.7626`) and `exchangedate` echoes the *requested* date, so the response never admits the value was carried. Reported as the date it applies to, with no freshness claim.
- [x] Settings → Appearance: fetched rate with its date, `usdRate` stays a manual override, last-good cached in `meta` (`nbu:lastRate`). Failure degrades to the stored value and labels it "last known, not refreshed". Disabled in demo (G4/D16).

**Contracts:** `usdRate` keeps its persisted shape; the fetched value is additive. **Recorded as D51.**

**Verify — done 2026-08-12:** 11 parser tests over verbatim live bodies including the two 200-that-is-an-error shapes; 537 green. Browser (`:3000` was another project, so the dev server ran on `:3007`): demo disables the request and says why; live fetches `44.866 for 12.08.2026` and **offers** it; the stored `44.83` is untouched until "Use it".

**Two defects the browser caught that the gates could not:**
- applying the rate updated the store and left the input showing the old number — `UsdRateField` seeds its draft once, so an outside write never reached it. Fixed by giving the field ownership (`onApply`) rather than synchronising two owners;
- the control wrapped onto its own line flush **left**, while every neighbouring control sits right. `ml-auto` + a shorter label; verified by bounding box (control now ends at the row's right edge, same as `Restore dismissed`) and 360px still has **zero** horizontal overflow.

## A6 — Bond price re-derivation — `feat/bond-dcf`

**Goal:** detect a silent yield revision, which the price alone cannot show.

**Rationale:** the feed's bond price is not a market quote but a discounted cash flow over `paymentSchedule` whose only free parameter is `returnRates.sell` — `P(D) = Σ CFᵢ × (1 + y)^(−ACT_days/365)`, verified out-of-sample 2026-07-28 → 2026-08-10 (predicted 1063.1288 vs quoted 1063.13). `returnRates` and `status` have been captured since `dee6b47`, so the inputs exist in every row from 2026-08-10 on.

- [x] `core/inzhur/dcf.ts` — `derivePrice(schedule, yield, onIso)` and `impliedYield(price, schedule, onIso)` by bisection. The inverse is what catches a revision when only the price moved.
- [x] Compare stored vs derived on fetch; a mismatch past a kopeck tolerance is a **surfaced anomaly**, never a silent correction (G5).
- [x] **Ship the inverse as a staleness diagnostic, not only a revision check (D31).** Searching the pricing date that best explains the quote dated seven live bonds to 1–6 days stale on 2026-08-11 — the one thing a price alone can never tell you. Surface it beside the quote.
- [x] **Skip `status: 'completed'` instruments (D31).** `checkQuote` answers `not_applicable` for them and the tally simply does not count it, so no residual threshold was invented and the data is never filtered on `status`. Their schedules lie entirely in the past, so the DCF correctly returns 0 and the model is undefined, not wrong. Seven of the 31 bonds are in this state. `status` is the discriminator — do not invent a residual threshold, and never filter the data on it (D19).
- [x] **Done 2026-08-18** — the capture runs it nightly. `infra/src/quotes.ts` tallies `checkQuote` over every live bond and the scheduled handler publishes the result; the module is separate from `capture.ts` so its test needs no AWS, the same boundary `dates.ts` drew.
      **Measured before choosing what to alarm on, over the eight days in the archive:** 18 `consistent`, 7 `not_applicable`, 3–4 `stale` capped at 6 days, and 1–2 `revised` — with UA4000236624 revised on **all eight**. Staleness is this feed's steady state, not an event, so it is **graphed and never alarmed**: `QuoteMaxStaleDays` per source, plus a `quoteVerdicts` line carrying the four counts.
      **One verdict does alarm**, and only because it was measured first: `unexplained` — no yield the model can produce explains the quote at all, which the type's own docs call the loudest thing it can say — occurred **zero times in ~190 evaluations**. It is a structural claim about the payload's coherence rather than a "the value did not move" claim, which is why it survives D70.
- [x] Do not store the computed value. The spec is explicit: premises are captured forever, the conclusion never is — a stale provider value is stored as the observed fact. **Nothing is written**: the verdict reaches a log line and a metric, and its premises (quote, schedule, published yield) are all in `payload_gzip`, so any day can be recomputed. Same line D69 drew about the FX rate.

**Verify:** the out-of-sample pair as a fixture; round-trip `impliedYield(derivePrice(s, y)) ≈ y`; the seventeen bonds that fit on 2026-08-11 reproduce at a residual under 0.005 ₴; a `completed` instrument returns "not applicable" rather than an anomaly. Expect ~0.1 ₴ residuals on a few bonds even at their best date — the published yield is rounded to two decimals, which is a caveat on the residual, not on the date.

## A7 — Parse errors become visible — `feat/parse-diagnostics`

**Goal:** a provider field rename stops being invisible.

**Rationale:** the owner asked for parsing to be controllable via super-admin settings **and** for parse errors to be visible. The control half needs the B3 user model (`PLAN-OPEN.md` O14); the visibility half needs nothing. `parse.ts` already returns `{entries, skipped}` and **every caller discards `skipped`** — today a renamed field silently drops an asset from the fetch and the UI shows only an unlinked row.

- [x] `skipped` became `SkippedEntry[]` — **ref + reason + the rejected field paths**. A bare ref list says an asset vanished; it cannot say `assetDetails.prices.sellUAH` was renamed, which is the likeliest way this feed breaks and the whole difference between a five-minute fix and an afternoon. Surfaced under the Daily-quotes intro line, expandable, non-blocking.
- [x] Persisted as `inzhur:lastParse` beside the payload, written on **every** successful fetch including the clean ones — a record that appears only on failure cannot tell "the feed is fine" from "nobody has looked since it broke" (D53).
- [x] Settings → Automation carries the same panel, read-only. Editable controls still need the B3 user model (`PLAN-OPEN.md` O14).
- [x] `infra/` records `ref:reason` per skip in `price_capture.skipped_refs`, so the archive keeps the diagnosis too.

**Verify — passed 2026-08-12.** Unit: a renamed `sellUAH` yields exactly one skip naming `assetDetails.prices.sellUAH` while the other entry still parses — the tolerant-parse contract holds. Browser, against the live feed with one entry mangled in flight: **"1 feed entry could not be read · 35 read fine"**, expanding to `ocean-plaza — unreadable fields assetDetails.prices.sellUAH`; it survived a reload and appeared identically in Settings. A clean fetch reports `All 36 feed entries read cleanly`, and before any fetch the panel renders **nothing** rather than inventing a verdict.

