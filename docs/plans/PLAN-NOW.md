# Plan A — Startable now

> **For agentic workers:** every task here is unblocked *today* — no evidence, no decision and no other phase gates it. Pick the first non-done task in section order, branch as named, tick the checkbox, keep the Status table current, gates green per merge (`pnpm lint && pnpm typecheck && pnpm test`; `infra/` tasks additionally deploy through `.github/workflows/deploy-backend.yml`).
>
> **Companion plans:** `PLAN-WAITING.md` (dated, gated on evidence or elapsed time) · `PLAN-OPEN.md` (questions with no answer yet). Parent: `NEXT-PHASE-PLAN.md`. Decisions: `DECISIONS.md`.

Written 2026-08-11. Section order is deadline pressure first, then irreversibility, then value per hour, then size.

## Status

| # | Phase | Branch | Size | Status |
|---|-------|--------|------|--------|
| **Section A** | **Time-critical** | | | |
| A1 | Coupon dates walk the published schedule | `fix/coupon-schedule-grid` | S | **done** (2026-08-11) |
| **Section B** | **Backend — cheaper before the archive grows** | | | |
| A2 | ~~Payload split~~ → the index it actually needed | `infra/payload-split` | M | **done** (2026-08-11, D48; last box closed 2026-08-17 by D69, as *not done*) |
| A3 | DSQL durability gate: backup + PITR | `infra/verify-durability` | S | **done** (2026-08-11, D49) |
| A14 | The nightly backup gets a liveness signal | `infra/backup-liveness` | S | **done** (2026-08-11) |
| A4 | NBU observation schema | `infra/nbu-observation-schema` | M | **done** (2026-08-11, D50) |
| A15 | The daily run derives its own observation | `infra/observe-on-schedule` | S | **done** (2026-08-12) |
| A20 | Capture checks become structural — did it run, is the shape right — never "did the value change" | `infra/structural-checks` | S | **done** (2026-08-18, D70) |
| A19 | **`as_of` is one day early on every Inzhur row** — split the two meanings, then migrate 14 rows | `infra/asof-alignment` | S | **done** (2026-08-18, D71) — two weeks inside the W4 deadline |
| **Section C** | **App — pure, independent** | | | |
| A5 | Live NBU ₴/$ rate | `feat/nbu-rate` | S | **done** (2026-08-12, D51) |
| A6 | Bond price re-derivation (DCF) | `feat/bond-dcf` | M | **done** (2026-08-12, D52; last box closed 2026-08-18 — the check now runs nightly in the capture) |
| A7 | Parse errors become visible | `feat/parse-diagnostics` | S | **done** (2026-08-12) |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied; audited 2026-08-14, resubmission gated on W7** |
| A12 | Backfill stops flagging pre-issuance dates | `infra/backfill-tracked-isins` | S | **done** (2026-08-11) |
| A13 | The alert channel gets its own liveness signal | `infra/alert-liveness` | S | **done** (2026-08-11, D47) |
| **Section D** | **The one large sweep** | | | |
| A8 | Design brief: appearance + language | `docs/design-brief-phase-5` | M | **done** (2026-08-12) — extension merged `f486121` |
| A9 | Dark theme | `feat/dark-theme` | L | **done** (2026-08-13) |
| A10 | Ukrainian | `feat/i18n-uk` | L | **done** (2026-08-14, D58) — shipped as **v1.5.0** |
| **Section F** | **Phase 6 — the mobile shell** | | | |
| A16 | Design brief: mobile | `docs/design-brief-phase-6` | M | **done** (2026-08-13) — extension merged 2026-08-14 |
| A17 | Mobile shell + record cards | `feat/mobile-shell` | L | **done** (2026-08-17, D66) — zero horizontal overflow on all ten routes at 360, both themes, both languages |
| A18 | One scroll surface (`Scroller`) + three-band dialogs | `feat/scroll-surface` | M | **done** (2026-08-17, D65) — new reference `design/extensions/scroll-surface.dc.html` + brief § S7 supersede S5's scrollbar; closes FOLLOW-UPS 11 |
| **Section E** | **Finish the rename (D42)** | | | |
| E1 | App-side renames | `chore/rename-quirenote-app` | M | **done** (2026-08-11, `98de0b0`) |
| E2 | New IAM roles (three) | console | S | **done** (2026-08-11) |
| E3 | Stack move — deploy new, then delete old | `infra/rename-stack` | M | **done** (2026-08-11, D46) |
| E4 | Last identifiers and docs | `docs/rename-cleanup` | S | **done** (2026-08-11; last checkbox 2026-08-14) — but it missed `design/`: every reference still says `Kubushka`, recorded 2026-08-18 in `design/extensions/README.md` as a divergence rather than edited, since D14 makes a merged drawing immutable. It also left one comment in `core/backup/import.ts` naming the retired `kubushka-backup` marker, now fixed. |
| **Section H** | **Groomed from the owner's idea list (2026-08-18)** | | | |
| A21 | Currency: Settings sets the default, the sidebar toggle is a session preview | `feat/currency-session` | S | **done** (2026-08-18) |
| A22 | Design brief: where things live — editable analytics, the `Entry` group, collapsible groups | `docs/design-brief-phase-7` | M | **done** (2026-08-18) — `docs/design-briefs/phase-7-where-things-live.md`; **extension NOT drawn**, so every Phase 7 UI task stays design-blocked (G7) |
| A23 | Design brief: provider-first asset creation | `docs/design-brief-asset-create` | M | **todo** |
| **Section I** | **From the 2026-08-18 brainstorm — three analytics screens** | | | |
| A24 | The portfolio start derives from the data instead of being a literal | `feat/derive-portfolio-start` | S | **done** (2026-08-18) |
| A25 | Portfolio-level XIRR | `feat/portfolio-xirr` | S | **done** (2026-08-18) — computed and tested; **not displayed**, that is A26's question |
| A26 | Design brief: period selection + the three screens' content and layout | `docs/design-brief-phase-8` | L | **todo** — blocked on A24 (done) |

---

# Section A — Time-critical

## A1 — Coupon dates walk the published schedule — **DONE 2026-08-11**

> Verified against the live feed, not only in tests. The published dates are
> `2026-03-25`, `2026-09-23`, `2027-03-24` **twice** (coupon and principal
> share the maturity date, deduped), period exactly **182 days**. In the
> 20–23.09 window the coupon now counts as **78,40**; the month grid returns
> **0** — it misses the September coupon entirely, which is the defect. The
> grid still runs for an asset with no linked schedule.

**Goal:** the app proposes a coupon on the date the provider actually pays it.

**Rationale — this one has a date.** `couponsInGap` and `rollNextCoupon` walk an `addMonths(·, 6)` grid. The real bonds pay every **182 days, always a Wednesday**. Measured drift from the 25.03.2026 anchor:

| Real payment | Grid says | Drift |
|---|---|---|
| 2026-09-23 | 2026-09-25 | +2 d |
| 2027-03-24 | 2027-03-25 | +1 d |
| 2027-09-22 | 2027-09-25 | +3 d |
| 2028-03-22 | 2028-03-25 | +3 d |
| 2028-09-20 | 2028-09-25 | +5 d |

The next real coupon on UA4000238976 is **2026-09-23**, and the grid would offer it on the 25th. That is the same date `PLAN-WAITING.md` W5 needs clean for the cum/ex observation, and it is a money value the user confirms with one press. `dailyAccrual` was fixed on 2026-08-11 (commit `290b26f`) to take the real period length; the date grid is the untouched half of the same defect.

- [x] `core/accrual.ts` — `couponsInGap` and `rollNextCoupon` accept the provider's payment dates and walk **those**, not a month grid. Reuse the existing `couponPeriodDays` bracketing rather than inventing a second traversal.
- [x] Keep the `addMonths` grid as the fallback for an asset with no linked schedule — an unlinked bond has nothing better, exactly as `dailyAccrual` keeps its approximation. Do not delete it.
- [x] Thread the feed to the callers. `DailyQuotes.tsx` already holds `fetch.feed`; audit every `dueCoupons` call site and pass it where it exists.
- [x] `rollNextCoupon` must still clamp at maturity and still return `{kind:'matured'}` past it — the schedule ends there too, so the clamp is now expressible from the data rather than asserted.

**Contracts:** `couponsInGap` / `rollNextCoupon` signatures gain an optional schedule argument — additive, so no caller breaks. **DECISIONS:** amend the D-Inzhur family: published schedule beats derived grid wherever the provider supplies one.
**Verify:** the drift table above becomes fixtures (real date accepted, grid date rejected). A gap spanning 2026-09-23 subtracts exactly one coupon, not zero and not two. An unlinked bond keeps its current behaviour byte-for-byte — that is the non-regression, and it protects the ~97 seed-coupled test blocks. Browser: with the feed loaded, the coupon card appears on the 23rd.
**Risk:** the schedule's final row carries coupon **and** principal on the maturity date (7840 + 100000 kopecks). `couponForecast` already tie-breaks by taking the smaller row; the traversal must not double-count that date.

---

# Section B — Backend, cheaper before the archive grows

## A2 — ~~Raw payloads out of `price_capture`~~ → the index it actually needed — **DONE 2026-08-11 (D48)**

> **The split was cancelled by its own first step.** DSQL projects only the
> columns a query asks for, so `payload_gzip` is never read and moving 31.9 MiB
> of live archive would have bought nothing. What the measurement did find:
> both queries full-scanning 6,628 rows to return 3, at ~730 ms. One index
> leading with `source` took them to **2.26 ms** and **32.8 ms**, the latter
> now an Index Only Scan.
>
> Note for next time: `CREATE INDEX ASYNC` finishes after the deploy reports
> success — the first measurement still showed the old plan.

**Goal:** the capture journal is narrow enough that scanning it is free.

**Rationale — a known deviation from the spec, and it gets more expensive every day.** `2026-08-04-data-model.md` § *Raw payloads* rules that payloads live in a **separate table**, because DSQL primary keys are index-organized and carry every column, so a wide row inflates every range scan proportionally — and DSQL bills bytes **scanned**, not returned. The deployed table (`infra/src/capture.ts:253`) holds `payload_gzip BYTEA NOT NULL` inline. Two queries already range-scan it:

- `unchangedStreak` — `SELECT quotes_sha256, as_of … ORDER BY as_of DESC LIMIT 60`. `quotes_sha256` is not in the `(as_of, requested_at)` index, so the scan must reach the row.
- the backfill-completeness check — `SELECT DISTINCT as_of … WHERE source = $1 AND as_of BETWEEN …` over the NBU rows, of which there are already ~2,600 from the 2016 backfill.

At ~12 kB/row that is a real and growing multiplier on the one cost DSQL charges for. **State the cost, do not assert it:** measure first (this phase's first task), then move.

- [x] Measure before touching anything: `EXPLAIN ANALYZE` both queries and record bytes read. If the planner already avoids the payload, say so and close the phase — the deviation would then be cosmetic. **Measured, and it did: D48.**
- [ ] ~~If it does not: `price_payload (capture_id, payload_gzip, payload_bytes, payload_sha256)`, one DDL per transaction, no DDL mixed with DML (DSQL rules).~~ **Not done, by D48** — the planner already avoids the payload, so the split buys nothing.
- [ ] ~~Backfill from the existing rows in batches under the 3,000-mutated-rows-per-transaction cap, retrying SQLSTATE 40001.~~ **Moot with the split.**
- [ ] ~~Drop the inline columns only after the copy is verified row-for-row by hash. **`DeletionPolicy: Retain` and deletion protection stay on throughout.**~~ **Moot with the split.**
- [x] Add the missing index the two queries actually want — shipped as `price_capture_source_as_of (source, as_of, requested_at)`; `source` leads because an index is only usable from its leading column. **The reference DDL in `migrations/001_price_capture.sql` did not carry it until 2026-08-14** — the handler created it while the file that documents the schema did not mention it.
- [ ] ~~**Record the payload's implied FX rate on `price_capture`** (D30). It is one number per run — every entry in a payload converts at the same rate, proven in D31 — and it is not stored today. `buyUAH / buyUSD` on any entry recovers it; NBU's own rate for the same date identifies its vintage. Currently unrecoverable once the payload ages out of anyone's attention.~~ **Not done, by D69 — and the sentence above is wrong twice.** It is not one number: D31, cited here as the proof, measured the funds at 44.7579 and the bonds at 44.8305 *inside one payload*, and a re-measure on 2026-08-17 reproduced the split (44.8086 / 44.8568). Nor is it unrecoverable — `payload_gzip` stays inline on the row (D48), so both premises of the division are archived forever and only the attention was ever missing. Storing it would write a conclusion into an append-only archive, which A6's last box below forbids in as many words.

**Verify:** re-run `EXPLAIN ANALYZE` and record the before/after bytes in `infra/README.md` field notes. Row count and every `payload_sha256` identical before and after. A scheduled run and a `{backfill:…}` run both still succeed.
**Risk:** this is the only phase here that rewrites live archived data. It is sequenced first *because* the archive is ~2 days of Inzhur plus a settled NBU backfill — the cheapest it will ever be. Every day of delay adds rows.

## A3 — DSQL durability gate: backup + PITR — `infra/verify-durability`

**Goal:** prove the archive can be restored **before** anything irreplaceable depends on it.

**Rationale:** `2026-08-04-cloud-stack-and-cost.md` names this an explicit gate on Phase 2 — *"Verify DSQL backup/PITR. Gate: if either disappoints, price history moves to S3 + CloudFront."* It needs no evidence and no elapsed time, and the whole archive exists because a missed day is unrecoverable. Verifying restore *after* user data arrives inverts the risk for no reason.

- [x] Confirm what the cluster actually has: **nothing.** No PITR field on `GetCluster` at all, and zero vaults / plans / jobs — the archive was not backed up in any way. DSQL recovery points are **full** backups via AWS Backup only; no continuous backup, no table-level granularity.
- [x] Perform a real restore to a throwaway cluster and diff row counts + hashes against the source. Restored 6 628 rows against production's 6 630; the −1 per source is the capture that ran after the snapshot point, confirmed by byte deltas matching one mean row each.
- [x] Record the measured RPO/RTO in `infra/README.md` (backup 3 min 48 s, restore 2 min 19 s, RTO <10 min, RPO one capture); throwaway cluster deleted, `ListClusters` back to one.
- [x] Neither disappointed → **gate passes, DSQL stays** (D49). Daily plan at `cron(45 22 * * ? *)`, tag-selected, 35-day retention, created by `infra/scripts/bootstrap-backups.sh` deliberately outside the stack.

**Verify:** a restored cluster answers the same `SELECT count(*), min(as_of), max(as_of)` per source as production. — done via the Lambda's `diagnose` mode against a temporarily repointed endpoint.
**Risk:** a throwaway cluster is a billable resource. Delete it in the same session; the $5 budget with $1/$3 absolute alerts is the backstop.
**Left open on purpose:** nothing checks that the nightly backup actually ran → **A14**.

## A14 — The nightly backup gets a liveness signal — `infra/backup-liveness`

**Goal:** find out that the backup stopped running from a signal, not from needing it.

**Rationale — this is the third instance of one defect in one day.** The alert channel was dead and every indicator read healthy (D44). The backfill filled a range with `ok: false` under defective logic and nobody read the result (D43). The archive had no backup at all while deletion protection made it look protected (D49). Each time the green came from nothing having been *attempted*. A backup plan is exactly this shape: it fails silently, and the moment it is wanted is the worst moment to discover it.

- [x] The capture already reports its own alert-channel count on every run (D47). Same idea: `reportBackupFreshness()` emits the **age in hours** of the newest `COMPLETED` recovery point. An age, not a healthy/unhealthy flag — for the reason `unchangedDays` publishes the streak rather than only the breach: a number can be watched drifting toward the threshold, a boolean can only be watched flipping after it is too late. No recovery point emits `9999`, never `0`, so "nothing" lands on the bad side of any threshold instead of reading as "backed up seconds ago".
- [x] Filtered by the cluster's **own ARN**, not just the vault. Recovery points outlive their source for the full 35-day retention, so a recreated cluster with a broken selection would otherwise keep the metric comfortably fresh for over a month while nothing was being backed up.
- [x] 48 h, not 24 h — a daily plan with a 60-minute start window plus one skipped night must not page. The signal wanted is "the plan has stopped", not "one night was late".
- [x] `backup:ListRecoveryPointsByBackupVault` is the one permission added, read-only and scoped to the `quirenote-backups` vault by constructed ARN (the vault is outside the stack, so it cannot be `!Ref`'d).
- [x] ~~Alarm `TreatMissingData: breaching`, same as `SilenceAlarm`.~~ **Wrong when written — shipped as `notBreaching`.** This metric is published *by* the capture, so its absence means the capture stopped, which `SilenceAlarm` already reports. `breaching` here would raise two alarms for one fault, and that is how alarms get muted. `AlertChannelAlarm` had already settled the same question the same way; the plan simply did not check its own precedent.

**Verify:** the capture logs `backupAgeHours` with a plausible value on a scheduled-path invoke; the metric filter turns it into a datapoint; then set the alarm state by hand (`SetAlarmState`) and confirm it reaches the Console Mobile App, the way D45's channel was proven.
**Risk:** low. Read-only, one metric, one alarm, no new resource.

## A4 — NBU observation schema — `infra/nbu-observation-schema`

**Goal:** turn the NBU half of the archive from raw captures into queryable observations.

**Rationale:** B2 of the staged plan wants the schema decided **with evidence in hand**, and for NBU the evidence is complete: the backfill to 2016-01-04 re-runs clean (`captured: 0, complete: true`), weekend behaviour is characterised (404, recorded as `not_published`, correctly not an alarm), `calc_date` matched the filename date on 14/14 sampled dates across 2016–2026, and the malformed header is understood (field 17 declares `g_spread,z_spread,cptype`, the data carries `cptype` alone). The Inzhur half is **not** ready and is in `PLAN-WAITING.md` W1 — do not let it drag this one.

- [x] `price_observation` created with all of it. Key **ORDER** is pinned, not just membership: `as_of` leads, because the read contract serves whole years and the key is index-organized. Per-instrument access is served by `price_observation_ref_as_of` instead — the leading-column lesson measured in A2/D48.
- [x] **`basis` vocabulary pinned by D30: `buy | sell | nav | fair`** — all four legal from row one, NBU writes only `fair`. **No currency dimension**: the USD figures are a serve-time conversion (D31).
- [x] `instrument` with `listed_from` + **`last_seen_on`**, not `retired_at` — a considered deviation recorded in D50: "retired" is a judgment, "last seen on" is what the cron witnessed, and the pair answers the same question. Neither is in a key, so storing the judgment later costs one `ALTER TABLE`. `instrument_ref` = ISIN for bonds, per D30.
- [x] Backfilled from stored payloads with **no network access**: 2 684 dates scanned, **408 observations**, 0 `calc_date` mismatches.
- [x] `observation_kind` not stored — derived at read time.

**Contracts:** six of them, pinned in `infra/migrations/002_price_observation.sql` before the first row — including the key ORDER and the rule that a row whose `calc_date` disagrees with the capture's `as_of` is skipped and counted, never coerced.

**Verify — all three passed:**
- reconciliation per ref over **its own** listed span: `UA4000236475` 274 observations / 274 distinct dates / 274 published days; `UA4000238976` 134/134/134. **Zero gaps, zero duplicates.** A single shared span would have measured the younger bond against days predating its issuance and reported a false gap — the D43 mistake one level up;
- the provider's file for 2026-08-10 gives `1111.05 / 15.691488 / 104.71` and `1063.63 / 15.456906 / 100.418`, matching the stored rows exactly. Its maturity `24.03.2027` independently confirms A1's coupon schedule;
- re-run reports `seen: 408, written: 0` — a no-op demonstrated rather than assumed, which needed `rowCount` instead of a counter of insert attempts.

**Scope, deliberately narrow:** observations cover the held ISINs, not all ~185 instruments per file (~400 000 rows). Widening is a parameter and is free — more rows under the same immutable key, re-derived from payloads already stored locally. Narrowing is not. Cost is not the constraint either way: all of August, including two ten-year backfills, metered **5.86 DPU**.
**Risk:** DSQL keys are immutable — a wrong key is a DROP/CREATE, not a migration. `basis` in the key is the one hedge that makes a later valuation-basis decision free (`PLAN-OPEN.md` O6).

---

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

## A11 — SES production access, requested early — `infra/ses-identity`

**Goal:** the migration is never blocked waiting on a support queue.

**Rationale:** D39 moves email to SES, and new SES accounts sit in a **sandbox — 200 messages per 24 hours, 1 per second, and delivery only to verified addresses.** Until production access is granted, approving a stranger's application cannot work at all. The request is free, but its turnaround is unpredictable and it can come back asking for more detail. Nothing about it depends on the user pool existing, so it can be done months ahead — and doing it late means discovering it during the cutover, which is the one moment it must not appear.

Granted accounts default to 50,000 messages/day, which is four orders of magnitude beyond the two-messages-per-account-lifetime that passkey-first onboarding needs.

- [x] Sender identity chosen: **`quirenote.com`**, acquired 2026-08-11 (D40).
- [x] **DNS stays off Route 53.** A hosted zone is $0.50/mo and on the standing "no" list, and nothing needs it — Cloudflare's free DNS serves every record below, and Amplify supports third-party DNS with its own free certificate. This is what keeps the domain from adding a standing AWS charge. **Held: 2026-08-14 the Amplify custom domain went on the same Cloudflare zone, with no hosted zone created.**
- [x] Verified in `eu-north-1` on 2026-08-11: DKIM `SUCCESS`, signing enabled. Custom MAIL FROM `mail.quirenote.com` was `PENDING` then and is **`SUCCESS` as of 2026-08-14** — it did resolve itself on SES's own schedule, as expected.
- [x] Six records live in Cloudflare and confirmed against a public resolver: 3 DKIM CNAMEs (**DNS-only, not proxied** — a proxied CNAME resolves to Cloudflare and DKIM never verifies), MX + SPF on `mail.`, and `_dmarc` at `p=none` with `rua=mailto:dmarc@quirenote.com`, forwarded to the owner by Cloudflare Email Routing.
- [x] Checked for the one conflict that matters: **exactly one SPF record per name**. Cloudflare's sits on the apex, ours on `mail.` — two on one name would be a permerror and neither would pass. Multiple DKIM keys cannot conflict at all, since DKIM is selector-addressed.
- [x] Requested 2026-08-11 via `PutAccountDetails`, stating the case that carries the most weight: **sign-up creates a request, not an account**, so every recipient is an address the owner explicitly approved and a typo is caught at approval rather than by a bounce.
- [x] **Denied on the first pass**, with a questionnaire rather than a refusal: identity, what is sent and how often, how recipient lists are maintained, bounce/complaint handling, unsubscribe, example content. `ReviewDetails: {Status: DENIED, CaseId: 178647479100146}` — this is SES's normal first move, not a verdict.
- [x] Replied 2026-08-11 with the six answers. The load-bearing one is structural rather than promissory: **sign-up creates a request, not an account**, so no message can be addressed to anyone the owner has not approved by hand.
- [ ] **Awaiting re-review.** Watch `ProductionAccessEnabled` flip to `true` and the quota move from 200/day to 50,000. Record the granted figure in `infra/README.md` field notes.
      **Checked 2026-08-14, three days after the reply:** `ProductionAccessEnabled: false`, quota still 200/day at 1/s, and `ReviewDetails` still reads `{Status: DENIED, CaseId: 178647479100146}` — the SAME case id, so this is the original denial still standing rather than a second one. Account is otherwise `SendingEnabled: true`, `EnforcementStatus: HEALTHY`. Nothing is blocked: SES is not wired into anything until W7.
- [ ] If denied a second time, the fallback is not another appeal — it is to stay in the sandbox and verify the handful of recipient addresses by hand. At one user and two messages per account lifetime, 200/day is not a constraint; production access is convenience, and treating it as a blocker would invert that.

### Why it was denied — audited 2026-08-14, and what changed

**The case text cannot be read from here.** `sesv2 get-account` returns only
`{Status: DENIED, CaseId: 178647479100146}`, and the Support API needs a paid
support plan (`SubscriptionRequiredException` on Basic). Everything below is
therefore either a fact about the account or an inference clearly labelled as one.

**Fact — the website in the request did not load when the request was reviewed.**
`WebsiteURL` is `https://quirenote.com`. The domain was registered 2026-08-11
(D40) and the Cloudflare zone carried **only mail records** — three DKIM CNAMEs,
MX, SPF, DMARC — until 2026-08-14, when the apex, `www` and `dev` CNAMEs were
created (D59). So from submission until that day the URL in the request answered
nothing. A reviewer who opens the stated site is a standard part of this review,
and this is the single most likely cause of the denial. **Now fixed by
circumstance:** the site is live, on its own domain, behind a real certificate.

**Fact — the flow the request describes does not exist in the app.** The request
says sign-up creates a request that the owner approves by hand, and that approval
sends the only two messages. There is no auth, no sign-up and no email in the
codebase at all — a reviewer visiting quirenote.com today finds a portfolio
tracker with no account system. The description is true of the app that W7 will
build, and cannot be verified against the app that exists.

**Fixed 2026-08-14 — bounce and complaint handling was asserted, not built.** The
reply told AWS that "the account-level suppression list is enabled and used" and
that every bounce is seen individually. That was thin: the suppression list is an
account default, and there was **no configuration set at all**, so no event went
anywhere. Now there is one — `quirenote-mail`, reputation metrics on, with an
event destination `problems-to-eventbridge` for BOUNCE, COMPLAINT, REJECT,
DELIVERY_DELAY and RENDERING_FAILURE on the default bus, which is the project's
own alert channel (SNS stays absent, D45/D47). It is set as the identity's
DEFAULT configuration set, so a future caller cannot forget to attach it.

- [ ] **Do not resubmit yet — resubmit when the sign-up flow is reachable (W7).**
      `PutAccountDetails` is the resubmission mechanism, so calling it is the act;
      it is deliberately not being called. Two of the three findings above are
      already fixed, but the central claim of the request — that an approval step
      gates every recipient — is exactly the one a reviewer cannot see today.
      Resubmitting into that gap risks a second denial on a case that already
      carries one, and buys nothing: **0 messages have ever been sent**, the
      sandbox's 200/day is four orders of magnitude above the need, and its only
      real limit (verified recipients) is satisfied by verifying the handful of
      addresses by hand. Nothing downstream is blocked until W7.

**Verify:** `GetSendQuota` reports a production quota rather than the 200/day sandbox one, and a test message reaches an address that was never verified.
**Risk:** none to the running system — SES is not wired into anything until W7. The only failure mode is leaving it too late.

---

# Section D — The one large sweep

Independent of persistence: it touches design tokens and strings, so the B3 migration cannot invalidate it. Doing it now means B3 lands on an already-themed, already-localised app rather than doubling the surface to re-verify. Phase 1's `var()`-emitting colors and the structured-returns rule exist to make both sweeps mechanical.

## A8 — Design brief — `docs/design-brief-phase-5`

**The G7 gate — and it is now OPEN.** `design/extensions/appearance-language.dc.html` merged 2026-08-12 in `f486121`, so **A9 and A10 are no longer design-gated**. This section header said "awaiting the design session" until 2026-08-13, three commits after the session had in fact run and its own amendment (D56) had been applied to the file.

> **The gate artifact was amended 2026-08-12 (D56).** `design/extensions/appearance-language.dc.html` drew every control as a capsule; the app no longer has a single one. All 231 capsules in it were rewritten to the radius rule and its 23 segmented tracks made concentric with their segments — measured off the file's own rendered boxes, nothing else touched. **A9/A10 must read shape from README §4, not from the drawing's original capsules.** The brief carries the same amendment at its head.

- [x] **Written 2026-08-12** — five surfaces, each with the pinned seven parts: theme control, language control, the dark palette sheet, charts in dark, Ukrainian copy.
- [x] All 57 tokens given dark values with **measured** WCAG ratios (23 checks, 0 failures) — not estimated.
- [x] Owner decisions taken and pinned: theme is **Light/Dark/System** with System default and OS-reactive; **Ukrainian is default**, English stays; and formatting **separates completely per language, no exceptions** — which is a bigger contract than it looks, because table figures now change in EN too.

**Two findings from the measurement, both recorded in the brief:**
- the ≥4.5:1 bar is the bar for TEXT, and the four asset hues are **never** text — verified across the codebase, they appear only as `bg-*` fills. The correct requirement is WCAG 1.4.11 (3:1, non-text); the dark values clear 4.5 anyway, so the sheet meets both readings;
- **the light theme does not meet even 3:1 today** — `reit` 2.77, `energy` 2.40, `ovdp8976` 2.57 on white. Inherited from the immutable master reference, out of scope here, and written down so the dark sheet is never misread as a regression against a light theme that was the weaker of the two.

**No longer open — the design session answered it, and re-measuring on 2026-08-12 confirms the answer.** The brief's premise (232 px will not hold `Щоденні котирування` on one line) is simply wrong: the nav runs in a monospace face at 0.6em, so 19 characters are 153.9 px in a 172 px text box — it fitted **before** the rail widened. At today's 244 px the text box is 184 px and the spare is **30.1 px**. The extension had already worked this out and **rejected** the shortened `Котирування` for buying nothing.

**What is actually tight is the rail, and by 1.1 px.** At 136 px the pill's text box is 88 px and the longest single word, `котирування`, measures **89.1 px** — so it cannot break cleanly and wraps to *three* lines, not the two the session drew. **2 px** closes it (1 px off each side of the rail pill's `px-3.5`, or 2 px more rail width). Left for A10 rather than pre-empted here: Ukrainian is not shipped yet and A10 is G7-gated. Start it with this number.

**Brief:** `docs/design-briefs/phase-5-appearance-language.md`. **Next step is not code** — it is the design session that turns it into `design/extensions/appearance-language.dc.html`.

## A9 — Dark theme — **DONE 2026-08-13** — `feat/dark-theme`

- [x] ~~Split double-duty tokens into surface/on-surface pairs.~~ **Superseded by the merged extension**, which wins visual disputes (D14). Its FINDING 3 solves the same problem with no new token and no component branching on theme: filled emphasis keeps `bg-ink` and swaps `text-white`→`text-page`; inverted planes keep white and swap `bg-ink`→`bg-sidebar`. Both are no-ops in light — `sidebar` and `ink` are both #26262a. A split would have added names the design deliberately avoided.
- [x] Purge literal colours and the nine rgba shadows into tokens. `text-white` survives at exactly two sites (sidebar capital, `KpiCard` dark) because both are inverted planes in *both* themes, and the reasoning is written in beside them.
- [x] `[data-theme=dark]` for the 38 palette tokens; the 19 `--color-chart-*` aliases are `var()` references and follow, verified at runtime. recharts Tooltip and cursor themed — the tooltip is `panel` (not `card`, so it lifts off what it covers) and the cursor replaces recharts' hard-coded `rgba(204,204,204,.5)`.
- [x] FOUC-free head script + `color-scheme`; `theme` through the full persist contract; `matchMedia` only while the preference is `system`; Light/Dark/System control in Settings → Appearance.

**Three things the plan did not know, all recorded in the commits:**

1. **Tailwind 4 inlines shadows but not colours.** `.bg-page` emits `var(--color-page)`; `.shadow-card` emits the literal, so redefining a shadow token in the dark block does nothing. Components call `shadow-(--shadow-card)` instead. Found by reading the emitted CSS.
2. **A third double-duty family the reference missed** — `bg-sidebar-text` + `text-ink`, a light chip on a dark rail. The active nav pill, the active currency segment and the logo circle rendered as empty white lozenges in dark. Fixed as FINDING 3 fixes its own cases: `text-sidebar`.
3. **FINDING 2 is wider than its own description.** The prescribed `panel-border` edge is needed by the `Switch` knob too, measured at 1.19:1 on its off track in dark — against 1.24:1 in *light*, i.e. the light theme was already leaning on the shadow. One `--shadow-thumb` token, four call sites.

**One light-theme change, deliberate and flagged:** the chart tooltip goes from recharts' default `#ffffff` to `panel`. The app never specified a tooltip background, so the white was a library default rather than a designed value.

**Verification note worth keeping.** `getComputedStyle` / `getBoundingClientRect` in the Playwright evaluation context returned **stale** values after React updates — at one point reporting a white background on a segment whose `className` did not carry `bg-card`. Several hours went into chasing defects that did not exist. For anything the DOM has just re-rendered, screenshot it.

## A10 — Ukrainian — `feat/i18n-uk`

- [x] `src/i18n/messages.ts` (`en` canonical, `Dict` derived from it, `uk satisfies Dict`), `useT()` on `settings.language`.
- [x] Sweep the strings — **~260 across ~40 files, not the ~200 estimated here**, and it took three passes: JSX text nodes, then string literals, then TEMPLATE literals, where most of the remainder lived. The three context-split formatters (`date-labels`, `yield-labels`, `schedule-labels`) were retired rather than translated.
- [x] `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT and ordinals into i18n; runtime key-parity test.
- [x] Contract 0 end to end: `makeFormat(lang)` behind `useFormat()`, every figure re-rendering on the switch. Verified in production builds in both directions.

> **Done 2026-08-14.** Verified in the browser, both languages, all ten routes:
> no Latin prose left in Ukrainian and no Cyrillic in English; `<html lang>`
> flips; the calendar reads `пн…нд` / `серпень 2026` and starts Monday against
> English's Sunday. Decision recorded as **D58**; `navigation-map.md` figures
> restated in the default (Ukrainian) rendering.
>
> **Two things this phase found rather than translated.** The English
> placeholder `10,000.00` was REJECTED by the form that offered it — the parser
> read every comma as a decimal mark — so `normalizeNumberInput` now takes the
> last of the two marks as the decimal. And the dark theme's filled-button
> hover, the rail, the dialog and the toast had no edge or an inverted one; that
> is D57's tail, fixed with `--color-ink-hover` and `--color-surface-edge`.
>
> **The 360px sweep is Phase 6's, and here are the numbers.** At 360 the app
> overflows in ENGLISH already, on four of ten routes — attributes 107px,
> settings 48px, overview and payouts 4px each. Ukrainian widens the same four
> (133 / 82 / 5 / 5) and adds ONE of its own: daily quotes, 57px, where English
> is 0. That one is the 136px rail eating a third of a 360px viewport, leaving
> 200px for a control whose Ukrainian label needs 254px. It cannot be fixed by
> letting the label wrap — `size` pins an EXPLICIT button height, so a second
> line spills out of the box. The narrow-width rule for that row belongs to the
> mobile brief (A16/A17), not to a guess made here.
- [ ] ~~**Pinned: `fmtTable` / `fmtProse` / `fmtDate` are byte-identical in both languages.** Formats never follow language.~~ **REVERSED, 2026-08-13.** This line predates the phase-5 design session and its owner ruling, and the brief's **Contract 0** says the opposite: *"formatting separates completely per language, with no exceptions"*. D14 gives the brief copy and behaviour disputes, so the brief wins and this plan was stale, not the brief. Contract 0 is also the phase's widest-reaching item, so it is stated in full below rather than left as a cross-reference.

**Contract 0 — what A10 must actually implement.** Today the app mixes conventions: tables are already Ukrainian (`68 702,10`), prose and KPIs are English (`₴68,629.36`). From Phase 5 each language owns ONE coherent set, applied everywhere:

| | Ukrainian (default) | English |
|---|---|---|
| Number | `68 702,10` | `68,702.10` |
| Money, ₴ | `68 629,36 ₴` | `₴68,629.36` |
| Money, $ | `3 324,03 $` | `$3,324.03` |
| Percent | `+3,08 %` | `+3.08%` |
| Date | `12.08.2026` | `12 Aug 2026` |
| Date, short | `12.08` | `12 Aug` |

Three details that are decisions, not lookups: the Ukrainian thousands separator is **U+00A0**, never a plain space, or a figure wraps mid-number; Ukrainian puts a **space before `%`** per ДСТУ and English does not; English dates are `12 Aug 2026` rather than a slashed form, which is ambiguous between British and American reading.

**The cost, stated rather than discovered:** switching to English now changes **table** figures too, which it never did. That reaches `core/money.ts`, its tests, and every `navigation-map.md` checkpoint quoting a formatted string. What does NOT change: stored data, every D5-pinned *value*, and the ₴/$ toggle's scope — tables stay in ₴ in both languages, because that is a currency rule, not a locale one. Language changes how a number is written, never which number it is.

**Contracts:** settings `theme` / `language`; the final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist key); i18n architecture (typed dict, keys-in-tests, **formats-DO-localize per Contract 0**, `date-fns` dep — G6 entry).
**Verify:** unit — key parity compile-time and runtime, formatter invariance under `uk`. Browser — every route in dark, system and reduced-motion; hard-reload in dark with no white flash; UK with localised calendar, `<html lang>`, unchanged numbers and dates, 360 px overflow sweep; contrast spot-checks. Gates + build; tag.
**Risk:** the i18n sweep is wide though mechanical — freeze other UI branches while it runs.

## A12 — Backfill stops flagging pre-issuance dates — `infra/backfill-tracked-isins`

**Goal:** a backfilled date reads as the success it is.

**Rationale (D43, as corrected).** Every historical date came back `ok: false`. The cause is not the file layout — `parseNbu` reads fields 0–4 and those five are identical across all four generations of the file. It is this:

```js
const TRACKED_ISINS = ['UA4000238976', 'UA4000236475'];
if (parsed.missing.length > 0) error = `tracked ISIN absent: ${skipped}`;
```

Both bonds were issued in 2025–2026, so no file from 2020 can contain them. The check is right for a daily capture — an instrument vanishing from *today's* file means it matured, was renamed, or the file changed shape — and wrong for a backfill, where absence is the calendar.

**The stored data was never wrong.** `entry_count` and `quotes_sha256` are correct on all ~1,200 rows already written; only `ok` and `error` are, plus `unchangedDays` was skipped because it is gated on `error === null`.

- [x] `captureOne` takes `expectTracked`, defaulting true; the backfill passes false. Committed 2026-08-11.
- [x] Deploy it.
- [x] **Then** run the backfill to completion, in one pass. Not before: the completeness check keys on a row *existing*, so dates filled by the broken run are skipped forever by a re-run.
- [x] Repair the ~1,200 rows already written — reprocess from stored payloads and recompute `ok`/`error`, or delete and re-fetch. Reprocessing is preferred: the bytes are already held and NBU is spared the requests.
- [ ] Long term this belongs to `listed_from` / `retired_at` on `instrument`, which the data model specifies for exactly this distinction. The flag is the stopgap.

**Verify:** a 2020 date returns `published: 1`; a date after both issuances still flags a genuinely missing tracked ISIN; the full backfill reports `complete: true` with `published` close to the business-day count rather than zero.
**Risk:** none to stored bytes — the change only decides whether an error string is set.

## A13 — The alert channel gets its own liveness signal — **DONE 2026-08-11 (D47)**

> Verified in production: `{"metric":"alertChannels","status":"ACTIVE","value":1}`,
> six alarms in OK, and **zero SNS topics** — the topic was deleted once it
> turned out to deliver nothing and to block the deploy. CloudWatch publishes
> alarm state changes to EventBridge regardless of `AlarmActions`, so alarms
> with no action still alert.

**Goal:** a dead notification channel is visible, instead of looking exactly like a healthy one.

**Rationale (D44).** SNS deleted the email subscription after a spam complaint, and three notifications — including a real `SilenceAlarm` firing — went nowhere. Every indicator read healthy: `NumberOfNotificationsFailed: 0` (which means nothing was *attempted*, not that anything succeeded), the alarm history saying `Successfully executed action`, all five alarms in `OK`. **A silence alarm that cannot deliver is worse than no alarm**, because it turns an unmonitored system into one everyone believes is monitored.

This is the `unchangedDays` principle (D28) one level up: a signal that exists only on failure cannot tell "healthy" from "the check stopped running".

- [x] **Target changed by D45.** The channel is no longer SNS email, so the thing worth checking is not `SubscriptionsConfirmed` on a topic nobody listens to — it is that the **notification configuration is `ACTIVE` and holds at least one channel**. Same principle, different query.
- [x] The 01:00 capture reads it and logs it as JSON, exactly as it already logs `unchangedDays`. No new schedule — the "exactly one automation" ruling holds. Note the API only answers in `us-east-1`.
- [x] Metric filter → metric → alarm on `< 1`. **Verified live 2026-08-14:** `AlertChannelsMetricFilter` → `Quirenote/AlertChannels`, alarm `LessThanThreshold 1.0`, state `OK`, and the 14.08 run logged `{"metric":"alertChannels","status":"ACTIVE","value":1}`.
- [ ] **Accept that this alarm notifies through the channel it is checking.** Not solvable by cleverness; solved by the value being readable *without* push — on the dashboard and in the run journal (W8). The alarm is the backup, the visible number is the primary.
- [x] **Remove the SNS `Subscription` block from `template.yaml`.** Done, and D47 went further than this line expected: `CaptureAlertTopic` is gone too — `grep` finds no SNS in the template at all. The note that "the topic itself stays" is superseded.
- [x] Exec role gains the notifications read actions and nothing else. Shipped as `notifications:ListNotificationConfigurations` + `notifications:ListChannels` (List, not Get — the handler enumerates rather than fetches one by name).

**Verify:** delete the subscription in a test, confirm the logged value drops to 0 and the alarm fires; re-subscribe and confirm it returns to 1.
**Risk:** none — a read of topic metadata.

---

# Section E — Finish the rename (D42)

D41 renamed what a person reads. This finishes the job on every addressed
identifier. **Read the order before starting any step** — it is what makes the
whole thing reversible.

**The governing rule: deploy the new stack, verify it, only then delete the
old.** Never the reverse. At no point is there no working backend, and rollback
at every step is "keep the old stack". Two clusters and two schedules coexist
briefly; both write, last-write-wins on the per-date key, and the duplicate cost
at this scale is not measurable.

**Accepted costs, ruled on by the owner (D42):** two or three days of Inzhur
archive, covered by the spreadsheet that continues alongside. The NBU half
regenerates in full. `PLAN-WAITING.md` W1, W3 and W4 each slip by those same two
days, because the streak history and the observation window are per-cluster.

## E1 — App-side renames — `chore/rename-quirenote-app`

No AWS, fully reversible, and nothing here depends on E2–E4. Do it first so the
destructive phase starts from a clean tree.

- [x] `src/lib/sync.ts` — `DB_LOCK` and `SYNC_CHANNEL` to `quirenote-db` /
      `quirenote-sync`. **These persist nothing** — the only effect is that a tab
      left open across the deploy will not hear a tab opened after it, for one
      session.
- [x] `src/lib/db.ts` — `class KubushkaDB` → `QuirenoteDB`, and the Dexie names
      to `quirenote` / `quirenote-live`. **No IndexedDB migration is written**:
      live is empty and demo reseeds itself, which is the migration. The old
      databases are left on disk rather than deleted — a rename that also
      destroys data is two operations pretending to be one.
- [x] `src/state/settings.ts` and `src/state/draft.ts` — keys to
      `quirenote-settings` / `quirenote-draft`, **with a real migration**: on
      boot, if the new key is absent and the old one present, copy it across and
      then remove the old. Here the key *is* the data, so a bare rename silently
      discards currency, ₴/$ rate and every dismissed reminder. The settings
      store already has the `migrate` hook (G3) this belongs in.
- [x] `src/core/backup/json.ts` — the marker becomes `quirenote-backup`, full
      stop. Dual acceptance was written and then removed on the owner's
      correction: one user, no real data, so keeping the old marker readable was
      flexibility nobody asked for. The D41 mismatch message goes with it.
- [x] `package.json` `name`.
- [x] `navigation-map.md` — the DB names and localStorage keys appear in roughly
      fifteen checkpoints; all of them move.

**Done 2026-08-11.** Verified in the browser, not only in tests: an old-key
profile with currency USD, rate 41.5, lead time 14, a dismissal and a quote
draft all survived the reload under the new keys, with the old keys gone;
demo reseeded under `quirenote` to 4/174/18 with every D5-pinned figure
intact; and a fresh export carries the new marker. Six tests cover the migration paths. 512 tests green.

**Verify (browser, not just tests):** set a non-default currency and ₴/$ rate and
dismiss a reminder → reload → **all three survive** under the new key. Demo
reseeds under `quirenote` and every D5-pinned figure holds. A backup file
exported before this branch still imports. A fresh export carries the new marker.
Gates green.

## E2 — New IAM roles — console, owner-driven

Additive. The old roles stay until E3 is finished, so this step cannot break a
deploy.

**Three roles are manual, not two.** The account holds five `kubushka-*` roles
and they are two different things:

| Role | Owner | Action |
|---|---|---|
| `kubushka-backend-CaptureFunctionRole-*` | **the stack** | none — SAM recreates it as `quirenote-backend-CaptureFunctionRole-*` on the E3 deploy |
| `kubushka-backend-SchedulerRole-*` | **the stack** | none — same |
| `kubushka-backend-deploy` | manual | recreate |
| `kubushka-backend-cfn-exec` | manual | recreate |
| `kubushka-github-deploy` | manual | recreate — **the frontend role, missed when this section was written** |

The two stack-owned roles carry a generated suffix because CloudFormation
names them `<stack>-<LogicalId>-<hash>`. They vanish with the old stack and
reappear under the new name by themselves; creating them by hand would
collide with the stack.

**Naming is fixed at the same time, because the old scheme was inconsistent.**
`kubushka-github-deploy` was named for its mechanism while
`kubushka-backend-deploy` was named for its target — and both are assumed by
GitHub Actions, so "github" distinguished nothing. The scheme becomes
`quirenote-<target>-<function>`.

- [x] Create `quirenote-backend-deploy` — same OIDC trust policy and repo/branch
      condition as its predecessor.
- [x] Create `quirenote-backend-cfn-exec` — trusted by CloudFormation only. **Verified 2026-08-18:** both roles exist, created 2026-08-11.
- [x] **Rewrite every `kubushka-backend-*` prefix**, and there are more than the
      stack name: the exec policy scopes **eight** ARN patterns —
      `cloudformation`, `lambda`, `iam`, `logs`, `sqs`, `sns`, `cloudwatch`,
      `scheduler`. Miss one and the deploy fails on a permission, which this
      project has already paid for eight times (`infra/README.md` field notes).
      The `iam:*` prefix scoping matters most: SAM creates the function's
      execution role named after the stack, so it becomes `quirenote-backend-*`.
- [x] Add the new deploy-role ARN to GitHub. Keep the old secret value recorded —
      switching back is the rollback.
- [x] **`quirenote-frontend-deploy`** (was `kubushka-github-deploy`) — **done 2026-08-11**, verified end to end: run `31512461483` green through `configure-aws-credentials` and the Amplify deploy, and the live site serves `<title>Quirenote — Invest Tracker</title>` with `/overview` still rewriting to 200. — trust
      policy byte-identical, permission policy in `docs/reference/DEPLOYMENT.md` §1.5a.
      Independent of E3 and carrying no data risk: it touches Amplify only, the
      site keeps serving its last successful build, and it can be verified
      immediately by re-running the frontend workflow. Do it now rather than
      waiting for the stack.

## E3 — The stack move — the only destructive phase — **DONE 2026-08-11 (D46)**

> Verified after the fact: one stack, one cluster, one schedule, five alarms
> in OK, no `kubushka-*` role, one bucket, and the NBU archive closed
> 2016-01-04 → 2026-08-10. Cost was two days of Inzhur, exactly as ruled.
> Three defects nobody was looking for surfaced on the way — two orphaned
> clusters, a dead alert channel, and a backfill that failed every historical
> date — all of them predating the move.

> **FIRST: re-enable the backend workflow.** It was disabled on 2026-08-11
> (`gh workflow disable deploy-backend.yml`) so that pushing the E1–E3 commits
> would not create the new stack as a side effect — `deploy-backend.yml`
> triggers on `infra/**`, and those commits touch it. Until
> `gh workflow enable deploy-backend.yml` runs, **a deploy will silently not
> happen**, which is the worst failure mode available: no error, no stack, and
> a schedule everyone assumes is armed.

**Timing:** start in the Kyiv morning. The 01:00 capture then has a full day of
margin, and if anything goes wrong the old stack is still running and still
capturing.

- [ ] **Record the baseline first**: row count per source, `min(as_of)`,
      `max(as_of)`. Loss should be measurable afterwards, not assumed.
- [ ] Point the workflow at the new names — `--stack-name quirenote-backend`,
      `--role-arn …/quirenote-backend-cfn-exec` — and switch
      `AWS_BACKEND_ROLE_ARN` to the new deploy role.
- [ ] Deploy. **The new stack comes up beside the old one.** Both schedules now
      exist; if one 01:00 fires before teardown, both write and the per-date key
      absorbs it.
- [ ] Verify the new stack before touching the old: manual invoke returns `ok`
      for **both** sources, the five alarms and two metric filters exist, the
      schedule is armed with `Europe/Kyiv`.
- [ ] Re-run the NBU backfill from `2016-01-04` on the new cluster. Verified
      idempotent; re-run until it reports `complete: true`.
- [ ] **Only now tear down the old.** In this order: disable the old schedule so
      it stops writing → clear `DeletionProtectionEnabled` on the old cluster →
      delete the old stack (the cluster is retained by policy) → delete the
      orphaned old cluster by hand.
- [x] Confirm the bill returns to baseline — two clusters existed for a while and
      exactly one should remain. **Verified 2026-08-14:** `dsql list-clusters`
      returns exactly one, and August month-to-date across the whole account is
      **$0.0000050** — Lambda, S3 and CloudShell only. DSQL and AWS Backup bill
      nothing at this size, so the double-cluster window cost nothing either.
- [x] Delete the old IAM roles. **Verified 2026-08-14:** no role matching
      `kubushka` exists; the six that remain are all `quirenote-*`.

**Rollback at any point before the teardown:** switch the GitHub secret and the
workflow back. The old stack never stopped working.

## E4 — The last identifiers and the docs — **DONE 2026-08-11**

> `infra/README` now documents only the roles that exist, with the move's
> field notes appended; `DEPLOYMENT` §1.5/§1.5a describe the current role and
> keep only the two lessons the cutover taught; `CLAUDE.md` warns that the
> missing SNS topic is deliberate. The Amplify **app name** stays `kubushka`
> in the console — cosmetic, and the App ID it does not change is what the URL
> depends on.

- [x] `infra/src/capture.ts` — `USER_AGENT`. **Done 2026-08-14:** the custom
      domain is live, so the URL is now `https://quirenote.com`. It pointed at
      the Amplify URL until then, because a User-Agent that points nowhere is
      worse than one that points somewhere old.
- [x] `infra/README.md` — both role policies verbatim, every prefix, and a field
      note recording what the move actually cost.
- [x] `docs/reference/DEPLOYMENT.md`, `docs/README.md` backend table, `CLAUDE.md` key facts.
- [x] Amplify app name in the console — **renamed `kubushka` -> `quirenote`
      2026-08-14.** Cosmetic, as predicted: the App ID `d17m4jf400my6` is what the
      URLs and every IAM ARN reference, and it does not change with the name.
- [x] Update `PLAN-WAITING.md` W1/W3/W4 dates by the days actually lost, measured
      against the E3 baseline rather than estimated.

---

# Section F — Phase 6, the mobile shell

## A16 — Design brief: mobile — **DONE 2026-08-13**

**Brief:** `docs/design-briefs/phase-6-mobile.md`. Six surfaces, each with the pinned seven parts. **The design session ran 2026-08-14** and `design/extensions/mobile.dc.html` is merged, so **G7 is open and A17 may start.**

**The four questions the brief delegated, answered in the extension's header:**
- **S4** — a **sticky action bar** below the breakpoint, not scroll-into-view. `Save snapshot` sits below all four rows, so scrolling the focused row clear never lifts it out from under the keyboard; the user would have to dismiss the keyboard to reach the control that ends the ritual.
- **S6** — **tap to pin**. On four of the five charts the per-point value lives only in a hover tooltip, and hover does not exist on touch. Seasonality is exempt: it already draws its values on the bars.
- **S5** — the **date picker stops anchoring** below the breakpoint and becomes a centred sheet. Seven columns at 312 px give 44.6 px cells without touching the drawn day box.
- **S5** — the **Dialog keeps its own overlay**. In light it and `--color-scrim` agree to within 5% of alpha; in dark they must not be unified, because the Dialog's overlay is `sidebar`-based precisely because it is an inverted plane in both themes (D57).

**And one finding the session could not have had before D57/D61 shipped.** `--color-scrim` works in light exactly as the brief computed (5.23:1, reproducing its ~5.2). In **dark** it cannot work at all: the drawer is *darker* than the page, so a darkening scrim moves the background toward it and the boundary falls to **1.02:1**. `--color-surface-edge` (D61) is not enough either at 1.50:1. The drawer takes a **`sidebar-muted` edge at 5.51:1** in dark, and none in light. Measured, not asserted.

**A scroll artifact was caught and specified out** — and what shipped is **not** what this paragraph originally specified, so the difference is kept rather than overwritten. The problem was real: the Dialog scrolled with `overflow-y-auto` on the panel, so the platform drew a full-height square-cornered track inside a `rounded-3xl` panel. The answer specified here was shadcn's proportions — a 10 px bar, 1 px padding, an 8 px thumb, radius `round(8 × 0.26)` = 2, thumb in `muted` for 3:1 on `card`. That was drawn and rejected on sight: at 8 px with a square cap it reads as a stick of furniture, and it draws no rail at all, so nothing says the region scrolls until you are already scrolling it. **Shipped instead (A18, D65):** a 12 px rail, `2+2+4+2+2`, thumb r1 and rail r5, margin 8 equal on all four sides, gutter `2m + 12` = 28 taken from the ScrollArea root's padding, `orientation="both"` wherever the content is not the caller's to predict, and dialogs rebuilt as three bands so only the middle one scrolls. The resting thumb is `faint`, below 3:1 deliberately — see D65 for why 1.4.11 does not bind here.

**Owner decisions taken 2026-08-13:** full parity (the four tables become cards, nothing is desktop-only); the sidebar hides and shows by a button and **the drawer IS the sidebar**, not a second navigation; the header bar carries `Total capital` whenever the sidebar is off screen; and touch targets grow by **hit area, not geometry**.

**The measurement is what set the shape.** At 360 × 740 the content column is **209 px** of 360 — 42 % of the viewport is permanent chrome — and a card inside it has **129 px**. Taking the sidebar out of flow gives **336 px**, a 61 % gain. The four tables measure 464–824 px inside a 185 px window; Balances is `3 + N assets` columns wide, so its overflow grows with the portfolio and horizontal scroll could never settle it.

**One suspected defect was measured and cleared, and no surface compensates for it:** recharts thins the 31-day Seasonality axis to seven ticks (1 · 5 · 10 · 15 · 20 · 25 · 31) with **zero collisions** at a 277 px chart.

**Thirty vulnerabilities are enumerated in six classes** (space, touch/input, platform, drawer state, legibility/language, design-system integrity), each marked measured / computed / closed-by-specification and pointed at the surface that answers it. The sharpest is **F1**: 44 px targets would move five radii and one concentric track, because D56 keys `r` to the short side — an accessibility fix that silently rewrites the design system. Hence the hit-area decision, with two named exceptions (quote input and `Button` md at 44, radius recomputed to 11).

**Also fixed here**, since each contradicted something already shipped: the brief template's part 6 (still demanding `radius 999` and a 232 px sidebar), the missing `appearance-language.dc.html` rows in `design/README.md` and `design/extensions/README.md`, and the stale "awaiting the design session" in this file and in `docs/design-briefs/README.md`. One stale reference is **left as flagged, not edited** — `src/components/ui/Tag.tsx`'s comment cites "radius 999px" while the code ships `rounded-[6px]`; this task changes no code.

## A17 — Mobile shell + record cards — **DONE 2026-08-17 (D66)** — `feat/mobile-shell`

> **Measured at the close, not eyeballed:** zero horizontal overflow on all ten
> routes at 360 × 740, in **both themes and both languages** — forty
> measurements. The A10 sweep left five routes over (attributes 133, settings 82,
> daily quotes 57, overview and payouts 5 each). No focusable field under 16 px.
> Every pressable 44 × 44 except the seven text fields, which stay at 36 because
> an `<input>` renders no pseudo-element and G-2's own table forbids growing the
> box. Drawer: route change, hardware Back, `Escape` with focus returned, 18 Tab
> stops with none escaping, scroll 600 → locked → 600, reduced motion instant.
> Console clean, `pnpm build` green, 624 tests green, no D5-pinned figure moved.

- [x] S1 — one `<aside>`, two shells, breakpoint `md`; the 136 px rail is retired along with every `max-sm:` override that served it. The drawer is a Radix `Dialog`, so focus trap / Escape / scroll lock / focus return come from a dependency the app already ships; hardware Back is one synthetic history entry, pushed by a HANDLER because StrictMode double-fires an effect.
- [x] S2 — header bar, reading `headlineKpis` through the new `useCapitalCard` (never a second derivation); no mark is drawn there, so the F3 fourth-copy risk does not arise.
- [x] S3 — the record card, lifted out of `/attributes` into `components/ui/RecordCard` and applied to Yield, Portfolio, Payouts and Balances. Column header text byte-identical; table markup retained at `≥ md`. Closes A3/E3 and A4.
- [x] S4 — `/` with the keyboard open: 44 px quote input at radius 11, ≥16 px fields, and a sticky action bar on the VISUAL viewport (D-a). The quote row folds to two lines below `md` — the single wrapping row is a desktop shape and clipped the value at 360.
- [x] S5 — the four overlays re-checked at 360 px; radii unchanged (24 / 16 / 14 / 13). The date picker stops anchoring and becomes a 328 px centred sheet (D-c); the drawing's 312 misses its own ">44 px cell" target once the sheet's own padding is counted.
- [x] S6 — tap-to-pin on the three charts whose value is hover-only; recharts' `accessibilityLayer` already gives the keyboard path, verified in both shells.
- [x] `viewport-fit=cover` + `env(safe-area-inset-*)`; `100dvh` replaces `100vh`; `overscroll-behavior-y: contain`.
- [x] `--color-scrim` added to `@theme` with its dark value in the same commit.
- [x] `navigation-map.md` gains the mobile checkpoints.

**Two findings worth carrying forward, both browser-only.** The `Scroller`'s
colours were wrong on an inverted plane — 10.98:1 and 7.08:1 against the 1.37 and
2.12 they were chosen for, a pre-existing D65 gap the drawer made unavoidable —
and the 244 px lockup cannot hold a fifth element in flow, so the collapse control
and the DEMO badge both float over a full-width plate. Both are in D66.

**Risk (as written, and it held):** the sweep is wide and touches every screen —
freeze other UI branches while it runs, the same rule A9/A10 carry, and do not run
it concurrently with the i18n sweep.

## Cross-phase rules

- Branches as named; plain conventional commits; squash-merge to `dev`; no AI attribution in any git artifact.
- `pnpm lint && pnpm typecheck && pnpm test` per merge; `pnpm build` + tag per section close.
- `infra/` phases deploy through `.github/workflows/deploy-backend.yml` only. CI drives one named stack and may not touch hosting config (D15).
- **Standing invariants:** no silent writes — fetched, derived and server-suggested values reach a draft or a prefill only (G5); empty cell ≠ 0; validate-fully-then-one-transaction; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- Every DDL change on DSQL: one statement per transaction, never mixed with DML, no `DESC` in index keys, retry SQLSTATE 40001, ≤3,000 mutated rows per transaction.

## Acceptance for Plan A

A1 makes the 2026-09-23 coupon land on the 23rd. A2–A4 leave a narrow journal, a proven restore and a queryable NBU history. A5–A7 retire the hard-coded rate, catch a yield revision and make a parse failure visible. A8–A10 leave every route themed and localised. A16–A17 leave every route usable on a phone, with the sidebar collapsible at every width. At that point the only work left is dated (`PLAN-WAITING.md`) or undecided (`PLAN-OPEN.md`). **That state was reached on 2026-08-18 and lasted one afternoon:** Section H then refilled this file from the owner's idea list, so read the Status table rather than this paragraph for what is open.


---

# Section G — What W1 found (2026-08-18)

Both tasks come out of one afternoon's measurement and both edit `capture.ts`.
**Do A20 first**: it deletes a consumer of `as_of`, which shrinks what A19 has to
verify. If only one gets done, do A19 — it is the one with a deadline.

## A20 — Capture checks become structural, never value-based — `infra/structural-checks`

**Goal:** the capture reports whether it RAN and whether the payload has the
SHAPE it should. It stops reporting whether the numbers moved.

**Owner ruling, 2026-08-18.** A price may change or not change for reasons that
are none of the app's business — maintenance, a weekend, a public holiday, a
holiday moved to the Monday after. Alarming on that manufactures work where there
is no fault, and *"an alarm that pages for nothing gets muted"* is already this
project's most expensive lesson (D44, D45, D47).

**W1 measured that the value check was worthless anyway.** For `inzhur` the
digest can never repeat while the feed is alive: 24 of the 31 live bonds carry
daily accrued interest, so one hash over all 36 entries is fresh every day by
construction. `unchangedDays` is pinned at 1 — a flat line carrying no
information, bought with a 60-row query per source per run. For `nbu_fv` the
weekend and the holiday are already answered by the 404 path (`NOT_PUBLISHED`),
which is exempt from the failure throw on purpose.

**What goes:**

- [x] `StalePricesAlarm` and `StalePricesMetricFilter` — the value check itself.
- [x] `UnchangedDaysMetricFilter` and the `unchangedStreak` query behind it.
- [x] `StreakCheckLivenessAlarm`, which existed only to prove the streak check
      was running. It went with what it was watching.
- [x] `STALE_AFTER_DAYS`, and the `trackStreak` option. **`isWeekend` STAYS** —
      the check the plan asked for found a third caller, the backfill loop, which
      skips weekend dates because NBU publishes no file on them.
- [x] **`quotes_sha256` stays, and that distinction is the point.** D28's hashing
      half is not retired: the premise is still captured on every row and only the
      scheduled conclusion drawn from it is gone. W1 read the streak out of those
      stored hashes, which is exactly why they are worth keeping.

**What stays, and it is already most of the answer.** `SilenceAlarm`
(`Invocations < 1`, missing = breaching) says the job stopped. A fetch failure, a
parse failure, zero entries, or a tracked ISIN absent all set `error` and the
handler throws, so `ErrorAlarm` fires — with the NBU weekend 404 exempted by
name. `DlqAlarm` catches exhausted retries. `BackupAgeAlarm` and
`AlertChannelAlarm` are about mechanisms running, not values.

**What is missing, and is the positive half of this task:**

- [x] **Shipped as a NAMED-REF check rather than the count check planned here.**
      `TRACKED_INZHUR_REFS` mirrors NBU's `TRACKED_ISINS` one source over: the
      Inzhur capture asserts the refs it must still see, sets `error` when one is
      absent, and reaches `ErrorAlarm` through the handler's existing throw. Refs
      and not a count, because D30 fixed `isin` for bonds and `slug` for funds
      and one feed carries both kinds.
- [x] ~~A floor under `entry_count`.~~ **Deliberately not done, and measuring
      first is why.** `entry_count` has only ever GROWN for inzhur (34 → 35 →
      36), so a floor would be a threshold guessed from one week that the first
      delisting invalidates — the exact failure that retired `STALE_AFTER_DAYS`.
      `skipped_refs` measured the same way: empty on all 14 inzhur captures, but
      non-empty on **6 133 of 6 636** NBU rows, where it is the backfill
      correctly reporting bonds that did not exist yet (D43). No single rule is
      right for both sources, so neither number gets a rule.
- [x] **Both are published and never alarmed** — `EntryCount` and `SkippedRefs`
      per source, the pattern `ObservationsWritten` already uses. Emitted from the
      scheduled handler rather than from `captureOne`, which is what let
      `trackStreak` be deleted outright: the backfill never reaches the line, so
      it cannot scatter points across ten years of graph. Structural separation
      instead of a boolean someone can forget to pass.

**Verified:** `infra` typechecks, and re-parsing the template gives **five
alarms, every one structural** — `SilenceAlarm`, `ErrorAlarm`, `DlqAlarm`,
`BackupAgeAlarm`, `AlertChannelAlarm`, not one of which reads a price — beside
five metric filters. Remaining: the deploy, then the next 01:00 run publishing
`EntryCount` and `SkippedRefs` for both sources.
**Risk:** low, and no data or schema was touched. The trap named when this was
planned — deleting an alarm and leaving its filter, so an alarm watches a metric
nobody publishes and reads healthy forever — was avoided by removing both halves
of each pair and re-parsing the template to confirm the inventory.

## A19 — `as_of` is one day early on every Inzhur row — `infra/asof-alignment`

**Goal:** the date beside a price is the date the price is FOR. Then fix the 14
rows already filed under the wrong one.

**Established by measurement, twice over, on 2026-08-18** — the write-up is
`infra/README.md` § "W1 — the frozen-feed detector on real data". Inverting the
DCF dates the cabinet's quote of 1066.50 (published yield 15.55 %) to **18
August**; our archive filed it as **17 August**, and the same one-day offset
holds for the three days before it at a 0.0035 ₴ residual — inside D31's band for
a fresh bond. Independently, the provider's answer that prices are flat
Saturday–Monday matches our Friday–Sunday plateau shifted by exactly one day.

**The cause is one function serving two meanings.** `asOfFor` subtracts a day
because "the 01:00 run reads the price settled the previous day". False for
Inzhur: the live endpoint at 01:00 already serves the price struck for that
calendar day. **True for NBU**, where the same value is a *request parameter* —
`nbuFairValueUrl(asOf)` fetches a named date's file, and the file for D-1 is
D-1's. **NBU is labelled correctly across 6 636 rows back to 2016-01-04 and must
not be touched.**

- [x] **D71 written first**, and the DDL comment now carries the per-source rule
      with the decision cited beside it — redefinition with a citation rather
      than the silent kind it was pinned against.
- [x] Split into `inzhurAsOf` (the Kyiv date of the run) and `nbuAsOf` (that date
      minus one, which is also the NBU request parameter). `asOfFor` is gone
      rather than kept under one of the two names — a survivor would have been
      the same trap with fewer callers. The handler computes one per source; the
      run's own date is what it logs and returns, because a single top-level
      `as_of` was the conflation itself.
- [x] **Five tests where there were none** (`infra/src/dates.test.ts`), including
      the Kyiv-vs-UTC case the old comment warned about and one that simply
      asserts the two dates never agree.
- [x] **Migrated 14 rows** in one transaction. Checked FIRST that all 14 followed
      the automatic rule — `as_of = kyivDate(requested_at) - 1`, zero exceptions —
      because a row written with a hand-passed `asOf` would have been made wrong
      by a uniform shift and nothing in the table labels one.
- [x] Recovery point taken and confirmed **COMPLETED** (36.6 MB, 12:51) before
      the write. A payload fingerprint over all 6 650 rows was identical before
      and after: labels moved, bytes did not.
- [x] **Verified by DCF inversion, 8 of 8 dates**, residuals 0.0008–0.0045 ₴ and
      `daysStale` 0 throughout. Before the migration each fitted `as_of + 1`.
- [x] Consumers re-checked: the observation window now takes the NBU date
      explicitly (the table is NBU-only until W3/W4), the backfill completeness
      check is NBU-only and unaffected, and the streak walk was deleted by A20
      before this task ran — which is why A20 went first.

**Deadline: before W4 (2026-09-02).** W4 designs the Inzhur observation schema,
whose natural key is `(as_of, ref, basis, source)`. A wrong date is survivable in
a journal table; in a key it is not, and DSQL primary keys are immutable — a
wrong key is a DROP/CREATE, not a migration. Every day also adds one more row to
correct, which is the same argument A2 was sequenced on.

**Verified:** all of it, and the full working is in `infra/README.md` § "A19 —
the as_of migration". Inzhur now spans 2026-08-11 to 2026-08-18 (the earliest
moved off 08-10 correctly — those five rows were dev invokes run on the evening
of the 11th, so there is no 08-10 to have). NBU is untouched at 6 636 rows from
2016-01-04. Row counts per source unchanged, payload fingerprint identical, and
the DCF dates every stored payload to its own `as_of`.
**Risk, as run:** the highest on this board despite 14 rows, because it rewrote
archived rows in a store with no point-in-time recovery. Handled by taking the
recovery point first and by proving the shift uniform before applying it rather
than after.

---

# Section H — Groomed from the owner's idea list (2026-08-18)

`USER-FEATURES-DRAFT.md` held seven lines and was wiped in the same commit that
created this section, per its own cycle. **The mapping is recorded here because
the source page no longer exists:**

| Draft line | Where it went | Why there |
|---|---|---|
| currency in settings sets the default; the sidebar toggle is a quick preview | **A21**, below | pure state; no new pixel |
| analytics pages editable (targets → allocation, settings›portfolio → portfolio) | **A22** brief | new interaction, G7 |
| `daily entry` becomes `entry`, holding `Daily quotes` + `transactions` | **A22** brief | splits a screen in two; G7 |
| sidebar groups can be collapsed | **A22** brief | new affordance on an existing group; G7 |
| provider-first `new asset` form | **A23** brief | new flow, and it overlaps B3's catalog |
| user profile page | **`PLAN-WAITING.md` W16** | there is no user until W7 |
| settings toggle to auto-save daily quotes | **`PLAN-OPEN.md` O22** | it asks G5 to stop being binding |

**Three of the seven are design briefs and not implementations, and that is the
pipeline (G7), not caution.** A brief is startable today — A8 and A16 were both
PLAN-NOW tasks — and the implementation rows come out of the design session that
follows it. Only A21 is buildable now, because it changes no pixel.

## A21 — Currency: Settings sets the default, the sidebar toggle is a session preview — `feat/currency-session`

**The defect, stated plainly.** There is ONE persisted field, `currency`, and
**two controls write it** — the sidebar toggle (`app/Sidebar.tsx`) and the
Settings segmented control (`screens/Settings.tsx`, `t.settings.currency`). So
flipping to `$` to glance at one KPI is remembered forever, and the Settings
control is not a default at all: it is a second remote for the same switch.

**Wanted:**
- The **persisted** value is the DEFAULT, applied at app open. Settings writes it.
- The **sidebar toggle changes the session only** and is never persisted. A
  reload returns to the default.

- [x] Split the store. **Named the other way round from this box, on purpose:**
      `currency` is the LIVE value and `defaultCurrency` is the preference.
      Almost every reader wants "what is on screen now" — the KPIs, the sidebar,
      `useCapitalCard` — and only three sites want the preference, so the short
      name went to the common meaning and all the readers stayed untouched.
- [x] `partialize` carries `defaultCurrency` and not `currency`, with a comment
      at the removal site saying why — this is the first field to LEAVE that
      object, and the standing invariant only ever pointed one way.
- [x] Restore writes the default — `setDefaultCurrency(sane.defaultCurrency)`.
      **And the export end needed the same fix, which this plan missed:**
      `screens/settings/useBackupDownload.ts` was writing whatever the user was
      glancing at into the file. Both ends now read the preference.
- [x] Every reader takes the session value, and none of them changed a line —
      that is what the naming above bought. `mergeSettings` is the single place
      the two are joined: on every rehydrate the session starts as a copy of the
      preference.
- [x] Tests: **644 passing, +8.** A sidebar flip does not survive a rehydrate; a
      Settings change does; a rehydrate overrides a session value the store
      already held (the assertion that catches a naive spread order); the legacy
      key is read, preferred against, and never written back.

**Not in scope:** `usdRate` (44.83) is unrelated and stays exactly as it is.

**Two things this task turned up that were not in its brief.**

**The persisted key was renamed, and it needed no `version` bump — but the
fallback that made that true is PERMANENT.** `migrateSettings` reads
`p.defaultCurrency ?? p.currency`, and `merge` routes every hydrate through it,
so both shapes work on every path. The reason it can never be deleted is not the
old localStorage payloads: **the backup FILE format still carries `currency`**
(`core/backup/json.ts`), deliberately unchanged so existing backups stay
readable, and every restore therefore lands on that fallback. Removing it would
break restore silently — the value would just read UAH.

**Three user-facing strings were lying and are fixed in both languages.** The
Settings helper said *"Mirrors the sidebar toggle"*, which was an accurate
description of the defect; the import dialog's opt-in helper said it replaces
"your currency" where it now replaces the default. `navigation-map.md` carried
the same two claims as checkpoints, plus "choice survives a page reload" on the
sidebar toggle — the exact behaviour this task inverts.

**Verified in the browser** at `localhost:3001`, dark theme, Ukrainian and
English: a genuine pre-A21 payload (`{"currency":"USD"}`) hydrates to USD on both
controls, proving the compatibility claim on real data rather than in a unit
test; a sidebar flip moves the capital card to `3 324,03 $` while the Settings
control stays put and localStorage is untouched; a reload returns to the
preference; a Settings change moves both and writes `defaultCurrency`. Zero
console errors, and zero horizontal overflow at 1440 and at a true 360 viewport
in both languages — the new helper is longer than the one it replaced, and
`/settings` rows have a history of overflowing at 360 (FOLLOW-UPS 13).

## A22 — Design brief: where things live — `docs/design-brief-phase-7`

**Three draft lines, one question: where does each control live and how is it
reached.** They are one brief because answering any of them separately would
re-decide the other two.

- [x] **Editable analytics pages.** Put to the owner and settled 2026-08-18: an
      edit **MODE** behind a button, and a **general pattern for every** analytics
      page rather than a one-off on the two named. The second answer asked a
      question of its own — what the control does where there is nothing to edit
      — and the brief answers it with a rule: **a page is editable where it
      shows STORED data; a derived-only page gets no control, not a disabled
      one.** Five of eight routes qualify; Phase 7 builds two.
- [x] **`Daily entry` → `Entry`, holding `Daily quotes` and `Transactions`.**
      Brief § S4. `/` stays the index and keeps the quote rows, coupon cards and
      yield teaser; `/transactions` takes the panel and shows the FULL ledger
      rather than the last three, which was only a cap because the panel was a
      guest on someone else's screen. **One layout question is left open on
      purpose** — what `/`'s two-column `@container` becomes on a day with no
      coupon cards — and is flagged for the design session rather than guessed.
- [x] **Collapsible sidebar groups.** Brief § S5. One state serves both shells
      (the drawer IS the sidebar, D66). Two findings the section had to carry:
      the collapsed set **is persisted** — a nav arrangement is a preference,
      which is the opposite of the call A21 made for the currency glance three
      days earlier — and **a group may not close around the active route**, or
      the user loses the one pill that says where they are.
- [ ] Output per G7/D14: a merged `design/extensions/where-things-live.dc.html`,
      and the implementation rows filed back here. **Not done and not this
      task's** — the design session is a separate Claude session, and until it
      merges no Phase 7 UI may start.

**Constraint to carry into the session:** the sidebar is ONE composition with two
layouts (D66) and shape is a system (D56) — a collapsed group's chevron takes
`round(min(w,h) × 0.26)` like anything else, and 44 × 44 is hit area, never
geometry.

**What writing it turned up, none of which was in the brief's own scope.**

**`ScreenHeader` is a FRAGMENT, not a box** — `<h2>` + `<p>`, no container — so
"a button top right" has nothing to attach to on nine of the ten routes. The
component becomes a row before any of this exists, and `/`'s existing header
(`DailyQuotes.tsx:227`) is the precedent it copies rather than a new invention.

**The two named pages need DIFFERENT edit modes, and drawing them as one would
have been wrong.** Targets are a batch — Σ = 100 only means something whole — so
`/allocation` gets `Cancel` + `Save`. Asset CRUD already commits through its own
dialogs, including a D17 typed-name delete, so `/portfolio` gets `Done` and **no
Save**: a Save with nothing to write is a lie, and a Cancel that cannot undo the
deletion behind it is a worse one. The brief pins this as G-2 so the design
session does not have to discover it.

**`/allocation` loses a button rather than gaining one.** With the header
carrying `Save`, the card's own `Save targets` is removed — two saves on one
page, one of which saves a subset, is exactly the ambiguity this phase exists to
end.

## A23 — Design brief: provider-first asset creation — `docs/design-brief-asset-create`

**The draft's own words for the goal are the best statement of it:** *"the user
should input minimum data, especially minimum sensitive data"* — pick a provider,
pick from the assets it lists, type a name only for `custom`, and let everything
else fill itself.

- [ ] Read what exists first. `components/forms/AssetForm.tsx` already has an
      `InzhurGroup` with a live ref picker and a manual fallback, and
      `hooks/useInzhurAssets.ts` is the manual-only fetch behind it (D19). This
      is a re-ordering of an existing form, not a new capability.
- [ ] **`NEXT-PHASE-PLAN.md` already flags the overlap: B3's catalog registers
      newly listed provider assets and never puts them in a portfolio.** The
      brief must not design a provider list that the backend will re-decide at
      W7 — say explicitly which half is the app's and which is the catalog's.
- [ ] The quick-create path inside `TransactionPanel` reuses `AssetFormFields`,
      so whatever the flow becomes has to work in both hosts or the brief has to
      say why it does not.

---

# Section I — From the 2026-08-18 brainstorm

The owner asked how `/overview`, `/yield` and `/seasonality` could be improved
and what they might make editable. **The answer to the second half turned out to
be "nothing":** every candidate for editing was declined in favour of deriving,
so the A22 brief's rule — a page is editable where it shows STORED data — holds
for all three, now as a tested conclusion rather than an assumption.

Eight items came out of it, sequenced by dependency rather than taste, and the
owner approved the sequence:

**A24 (done) → A26's brief (period selection, and the content it adds) →
A25 → the readability work, last.**

**Why readability is last and that is not procrastination.** Period selection
adds a control to `/yield`, sparkline-style comparison to `/overview` and a
second axis to `/seasonality`. Designing the hierarchy of `/yield`'s eight
columns and then adding a ninth element is drawing the same screen twice.

## A24 — The portfolio start derives from the data — **DONE 2026-08-18** — `feat/derive-portfolio-start`

**What was wrong.** `core/derive.ts` carried
`export const PORTFOLIO_START = '2026-02-03'` — a literal that every annualized
figure divides by. True of the demo seed, false of every other dataset, and
therefore wrong on `/yield`'s whole annualized column, `/overview`'s
"+3,08 % since 03.02" and `/attributes`' days-held for anyone whose portfolio
did not start on that Tuesday. `src/README.md` already said no portfolio figure
may be hard-coded; **a date that divides all the other figures is one.**

- [x] `portfolioStart(assets, snapshots, transactions)` — the **earliest of
      three signals**, not any single one. The value answers "on what day is
      there evidence this portfolio existed", and a transaction, a snapshot or
      an asset's `firstPurchase` each carry that evidence independently.
- [x] **The direction is the argument.** A start that lands too LATE divides a
      long return by a short span and prints a rate nobody earned; too early
      only understates. The case that decides it: an asset carrying
      `firstPurchase: '2020-01-01'` added without back-filling the ledger —
      believing the transactions alone turns six years into six months.
- [x] `undefined` on an empty dataset; both consumers keep the existing
      zero-basis branch, and the two copy sites drop rather than render a date
      nothing supports.
- [x] `xirrIsExtrapolated` takes all three tables now, matching
      `yieldTableRows` — asking it for snapshots alone would answer a different
      question than the header asks.

**Verified.** 651 tests (+7), lint and typecheck green. Browser, demo dataset:
`/yield` reproduces every pinned figure (REIT +4,41 % / +9,3 % / −4,7 в.п.;
…6475 +5,20 % / +10,9 %), the footnote still reads 03.02.2026, `/overview` still
reads "+3,08 % від 03.02", `/attributes` unchanged. Browser, **empty live
dataset**: no footnote, no sub-line, and no `NaN`/`Infinity`/"від —" anywhere —
which is a visible improvement on the empty state, not merely a non-regression.

**Two things worth recording.**

**The seed made the choice of rule risk-free, and that is checkable rather than
lucky.** Its earliest transaction, earliest snapshot and earliest
`firstPurchase` are all `2026-02-03`, so no D5-pinned figure could move under
any of the three candidate rules. `lib/seed.test.ts` now asserts exactly that,
in two tests.

**The seed assertion could not live in `core/derive.test.ts`, and the linter was
right to say so.** `src/core` may not import `src/lib` (G1). The claim is about
the SEED's rows, not about core, so it belongs in `lib/seed.test.ts` — and core's
own tests keep inline fixtures. The old
`expect(PORTFOLIO_START).toBe('2026-02-03')` was a literal asserting a literal;
what replaces it asserts a derivation, in the file allowed to see both halves.

**Out of scope and filed as `PLAN-OPEN.md` O23:** both consumers still apply ONE
span to every asset, so a bond bought in June is annualized over the portfolio's
174 days rather than its own 53. Pinned by D5#5 as a deliberate v1
simplification; changing it moves pinned figures and needs a decision.

## A25 — Portfolio-level XIRR — **DONE 2026-08-18** — `feat/portfolio-xirr`

`core/xirr.ts` already solved the money-weighted rate per asset; there was no
portfolio-level one anywhere — `/overview`'s "Total return (net)" is a different
measure (unannualized, and against net deposits).

- [x] `portfolioXirr(txs, terminalValue, terminalDate)` in `core/derive.ts`.
      `xirr.ts` stays generic math with no domain types; the domain-shaped
      companion belongs beside `netDeposits`, which already draws the same line.
- [x] Pure logic, unit-tested against the seed's real flows.

**THE BOUNDARY IS EXTERNAL CAPITAL, and that is the whole design.** `deposit`
and `withdrawal` are the only rows that cross the portfolio's edge — the line
`netDeposits` already draws, citing doc §5.1. Buys, sells, reinvests, payouts
and taxes move money WITHIN it, between the cash pot and the assets or between
assets, and whatever they did is already inside `terminalValue`. Feeding them in
as flows would count them twice.

**It is the exact mirror of the per-asset XIRR** in `screens/yield/yield.ts`,
which takes the buys, sells and payouts and SKIPS deposits and withdrawals —
because at an asset's boundary those are the internal ones. Neither is more
correct; they answer about different boundaries, and the two comments now say so
to each other.

**Verified — and the pinned figure is not left hanging on its own.** The seed
gives **+8.93 %**, and the test proves it means something rather than just
reproducing itself: `globalRoi` is **+4.08 %** over a **174**-day span, which
stretched linearly reads **+8.56 %**. The XIRR must come out ABOVE that (it
compounds where the stretch is linear, and it weights the February money — which
had the whole span — over the June deposit that had eight weeks) and within a
percentage point of it (same measurement, different weighting). A portfolio XIRR
that ever fell BELOW the linear stretch on a purely-growing seed would mean the
flows are being signed or dated wrong, and that is what the assertion catches.
A third test drops the seed's 15 internal rows and asserts the rate is
byte-identical — the boundary claim, on real data rather than in a fixture.

**Not browser-verified, because there is nothing to see:** the figure is
computed and tested but rendered nowhere. Where it belongs on screen is a design
question and stays with A26's brief (G7). Tested, not dead — `core/derive.ts`
says so at the function.

**659 tests (+8)**, lint and typecheck green.

## A26 — Design brief: period selection and the three screens — `docs/design-brief-phase-8`

**Phase 8, deliberately not folded into the Phase 7 brief** — that one is written
and not yet drawn, and handing a design session two unrelated jobs in one file
is how both get done badly.

- [ ] **Period selection is a cross-cutting concept, not a filter on one
      screen.** Where the selected window lives, whether it persists, and what
      each chart and table does with it. Today everything is "since start":
      `/yield`'s annualized column and its four-line chart are both locked to
      one window, with no YTD, no 12m, no custom range.
- [ ] **`/overview` has no time dimension at all** — five KPIs and four cards,
      all "now". "Versus last period" is the same concept applied to KPIs, so it
      belongs in this brief rather than a separate one.
- [ ] **`/seasonality` knows only day-of-month** (31 buckets). A month-of-year
      axis is the more useful cut for a portfolio holding semiannual bonds, and
      the data is already there. Independent of the period window — it is a
      grouping axis, not a filter — but it lands on the same screen.
- [ ] **Readability, last:** `/yield`'s eight columns have no hierarchy (XIRR
      weighs the same as Invested, on desktop and in the eight-`Fact` mobile
      card); `/overview`'s five KPIs and four cards have a fixed order in which
      the rebalance hint and the income card compete; `/seasonality`'s three
      insight cards are prose, which scales badly past four assets.

