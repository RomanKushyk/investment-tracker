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
| A2 | ~~Payload split~~ → the index it actually needed | `infra/payload-split` | M | **done** (2026-08-11, D48) |
| A3 | DSQL durability gate: backup + PITR | `infra/verify-durability` | S | **done** (2026-08-11, D49) |
| A14 | The nightly backup gets a liveness signal | `infra/backup-liveness` | S | **done** (2026-08-11) |
| A4 | NBU observation schema | `infra/nbu-observation-schema` | M | **done** (2026-08-11, D50) |
| A15 | The daily run derives its own observation | `infra/observe-on-schedule` | S | todo |
| **Section C** | **App — pure, independent** | | | |
| A5 | Live NBU ₴/$ rate | `feat/nbu-rate` | S | todo |
| A6 | Bond price re-derivation (DCF) | `feat/bond-dcf` | M | todo |
| A7 | Parse errors become visible | `feat/parse-diagnostics` | S | todo |
| A11 | SES production access — lead-time insurance | `infra/ses-identity` | S | **denied on first pass, reply sent 2026-08-11, awaiting re-review** |
| A12 | Backfill stops flagging pre-issuance dates | `infra/backfill-tracked-isins` | S | **done** (2026-08-11) |
| A13 | The alert channel gets its own liveness signal | `infra/alert-liveness` | S | **done** (2026-08-11, D47) |
| **Section D** | **The one large sweep** | | | |
| A8 | Design brief: appearance + language | `docs/design-brief-phase-5` | M | todo |
| A9 | Dark theme | `feat/dark-theme` | L | design-gated |
| A10 | Ukrainian | `feat/i18n-uk` | L | design-gated |
| **Section E** | **Finish the rename (D42)** | | | |
| E1 | App-side renames | `chore/rename-quirenote-app` | M | **done** (2026-08-11, `98de0b0`) |
| E2 | New IAM roles (three) | console | S | **done** (2026-08-11) |
| E3 | Stack move — deploy new, then delete old | `infra/rename-stack` | M | **done** (2026-08-11, D46) |
| E4 | Last identifiers and docs | `docs/rename-cleanup` | S | **done** (2026-08-11) |

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

- [ ] Measure before touching anything: `EXPLAIN ANALYZE` both queries and record bytes read. If the planner already avoids the payload, say so and close the phase — the deviation would then be cosmetic.
- [ ] If it does not: `price_payload (capture_id, payload_gzip, payload_bytes, payload_sha256)`, one DDL per transaction, no DDL mixed with DML (DSQL rules).
- [ ] Backfill from the existing rows in batches under the 3,000-mutated-rows-per-transaction cap, retrying SQLSTATE 40001.
- [ ] Drop the inline columns only after the copy is verified row-for-row by hash. **`DeletionPolicy: Retain` and deletion protection stay on throughout.**
- [ ] Add the missing index the two queries actually want (`source`, `as_of`) — no `DESC` in index keys, DSQL rejects it outright.
- [ ] **Record the payload's implied FX rate on `price_capture`** (D30). It is one number per run — every entry in a payload converts at the same rate, proven in D31 — and it is not stored today. `buyUAH / buyUSD` on any entry recovers it; NBU's own rate for the same date identifies its vintage. Currently unrecoverable once the payload ages out of anyone's attention.

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

- [ ] Call `observeNbu` on the scheduled path, over a short trailing window rather than one date — a few days, so a night the job missed repairs itself on the next run without anyone noticing it had.
- [ ] Reuse the existing idempotency. `ON CONFLICT DO NOTHING` already makes a re-derivation free, and `written` already reports rows actually inserted (D50), so a healthy day logs `written: 2` and a repaired one logs more.
- [ ] Emit `written` as a metric on the same pattern as `backupAgeHours` and `alertChannels`, so "observations stopped being derived" is visible without anyone querying the table.
- [ ] Do **not** widen the scope here. The refs stay the held ISINs (D50); this task is about *when* the derivation runs, not *what* it covers.

**Verify:** the morning after deploy, `price_observation` has a row for the previous `as_of` with no manual invocation, and a second scheduled run inserts nothing.
**Risk:** low. Network-free, idempotent, and bounded by the same limit parameter the backfill uses.

## A5 — Live NBU ₴/$ rate — `feat/nbu-rate`

**Goal:** retire the hard-coded 44.83.

**Rationale — verified 2026-08-11, and it is not an automation.** `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=usd&date=YYYYMMDD&json` is public with `Access-Control-Allow-Origin: *` and returned `44.8305` today. A user-triggered fetch is the same shape as "Fetch quotes" — the "exactly one automation" ruling constrains **timers**, not requests. The stored 44.83 is already stale (NBU gave 44.7876 on 2026-08-04) and it silently mis-states every $ headline.

- [ ] `core/nbu/rate.ts` — tolerant pick-parse of `[{r030, txt, rate, cc, exchangedate, special}]`, same idiom as `core/inzhur/parse.ts`: per-entry skip, never all-or-nothing.
- [ ] **Always pass an explicit `date=`.** Without it the endpoint returns *tomorrow's* rate once published in the afternoon — a silent off-by-one on every value the user sees.
- [ ] Determine weekend/holiday behaviour with one request before writing the fallback — do not guess whether it 404s, returns empty, or carries the last published rate.
- [ ] Settings → Appearance: fetched rate with its date, `usdRate` stays a manual override, last-good cached in `meta`. Failure degrades to the stored value and says so.

**Contracts:** `usdRate` keeps its persisted shape; the fetched value is additive. **DECISIONS:** NBU rate policy — today's rate only, no archive (NBU history is backfillable at any time, so the asymmetry that makes the price archive urgent does not apply here).
**Verify:** fixture parse; explicit-date behaviour asserted; offline → stored value + stale note; the ₴ tables are untouched in every case (currency is a display unit for headline KPIs only).

## A6 — Bond price re-derivation — `feat/bond-dcf`

**Goal:** detect a silent yield revision, which the price alone cannot show.

**Rationale:** the feed's bond price is not a market quote but a discounted cash flow over `paymentSchedule` whose only free parameter is `returnRates.sell` — `P(D) = Σ CFᵢ × (1 + y)^(−ACT_days/365)`, verified out-of-sample 2026-07-28 → 2026-08-10 (predicted 1063.1288 vs quoted 1063.13). `returnRates` and `status` have been captured since `dee6b47`, so the inputs exist in every row from 2026-08-10 on.

- [ ] `core/inzhur/dcf.ts` — `derivePrice(schedule, yield, onIso)` and `impliedYield(price, schedule, onIso)` by bisection. The inverse is what catches a revision when only the price moved.
- [ ] Compare stored vs derived on fetch; a mismatch past a kopeck tolerance is a **surfaced anomaly**, never a silent correction (G5).
- [ ] **Ship the inverse as a staleness diagnostic, not only a revision check (D31).** Searching the pricing date that best explains the quote dated seven live bonds to 1–6 days stale on 2026-08-11 — the one thing a price alone can never tell you. Surface it beside the quote.
- [ ] **Skip `status: 'completed'` instruments (D31).** Their schedules lie entirely in the past, so the DCF correctly returns 0 and the model is undefined, not wrong. Seven of the 31 bonds are in this state. `status` is the discriminator — do not invent a residual threshold, and never filter the data on it (D19).
- [ ] Later, in an `infra/` commit, hand the same function to the capture Lambda so the check runs nightly rather than only when the app is open.
- [ ] Do not store the computed value. The spec is explicit: premises are captured forever, the conclusion never is — a stale provider value is stored as the observed fact.

**Verify:** the out-of-sample pair as a fixture; round-trip `impliedYield(derivePrice(s, y)) ≈ y`; the seventeen bonds that fit on 2026-08-11 reproduce at a residual under 0.005 ₴; a `completed` instrument returns "not applicable" rather than an anomaly. Expect ~0.1 ₴ residuals on a few bonds even at their best date — the published yield is rounded to two decimals, which is a caveat on the residual, not on the date.

## A7 — Parse errors become visible — `feat/parse-diagnostics`

**Goal:** a provider field rename stops being invisible.

**Rationale:** the owner asked for parsing to be controllable via super-admin settings **and** for parse errors to be visible. The control half needs the B3 user model (`PLAN-OPEN.md` O14); the visibility half needs nothing. `parse.ts` already returns `{entries, skipped}` and **every caller discards `skipped`** — today a renamed field silently drops an asset from the fetch and the UI shows only an unlinked row.

- [ ] Surface `skipped` in the Daily-quotes fetch result: count plus per-entry reason, expandable, non-blocking.
- [ ] Persist the last parse outcome in `meta` beside `inzhur:lastFetch` so the diagnosis survives a reload.
- [ ] Settings → Automation: a read-only "last parse" panel. Editable controls land with B3.

**Verify:** a fixture with one malformed entry yields exactly one skip with its reason **and** parses the rest — the tolerant-parse contract must not regress into all-or-nothing.

## A11 — SES production access, requested early — `infra/ses-identity`

**Goal:** the migration is never blocked waiting on a support queue.

**Rationale:** D39 moves email to SES, and new SES accounts sit in a **sandbox — 200 messages per 24 hours, 1 per second, and delivery only to verified addresses.** Until production access is granted, approving a stranger's application cannot work at all. The request is free, but its turnaround is unpredictable and it can come back asking for more detail. Nothing about it depends on the user pool existing, so it can be done months ahead — and doing it late means discovering it during the cutover, which is the one moment it must not appear.

Granted accounts default to 50,000 messages/day, which is four orders of magnitude beyond the two-messages-per-account-lifetime that passkey-first onboarding needs.

- [x] Sender identity chosen: **`quirenote.com`**, acquired 2026-08-11 (D40).
- [ ] **DNS stays off Route 53.** A hosted zone is $0.50/mo and on the standing "no" list, and nothing needs it — the registrar's free DNS serves every record below, and Amplify supports third-party DNS with its own free certificate. This is what keeps the domain from adding a standing AWS charge.
- [x] Verified in `eu-north-1` on 2026-08-11: DKIM `SUCCESS`, signing enabled. Custom MAIL FROM `mail.quirenote.com` still `PENDING` — the MX resolves publicly, SES just re-checks on its own schedule.
- [x] Six records live in Cloudflare and confirmed against a public resolver: 3 DKIM CNAMEs (**DNS-only, not proxied** — a proxied CNAME resolves to Cloudflare and DKIM never verifies), MX + SPF on `mail.`, and `_dmarc` at `p=none` with `rua=mailto:dmarc@quirenote.com`, forwarded to the owner by Cloudflare Email Routing.
- [x] Checked for the one conflict that matters: **exactly one SPF record per name**. Cloudflare's sits on the apex, ours on `mail.` — two on one name would be a permerror and neither would pass. Multiple DKIM keys cannot conflict at all, since DKIM is selector-addressed.
- [x] Requested 2026-08-11 via `PutAccountDetails`, stating the case that carries the most weight: **sign-up creates a request, not an account**, so every recipient is an address the owner explicitly approved and a typo is caught at approval rather than by a bounce.
- [x] **Denied on the first pass**, with a questionnaire rather than a refusal: identity, what is sent and how often, how recipient lists are maintained, bounce/complaint handling, unsubscribe, example content. `ReviewDetails: {Status: DENIED, CaseId: 178647479100146}` — this is SES's normal first move, not a verdict.
- [x] Replied 2026-08-11 with the six answers. The load-bearing one is structural rather than promissory: **sign-up creates a request, not an account**, so no message can be addressed to anyone the owner has not approved by hand.
- [ ] **Awaiting re-review.** Watch `ProductionAccessEnabled` flip to `true` and the quota move from 200/day to 50,000. Record the granted figure in `infra/README.md` field notes.
- [ ] If denied a second time, the fallback is not another appeal — it is to stay in the sandbox and verify the handful of recipient addresses by hand. At one user and two messages per account lifetime, 200/day is not a constraint; production access is convenience, and treating it as a blocker would invert that.

**Verify:** `GetSendQuota` reports a production quota rather than the 200/day sandbox one, and a test message reaches an address that was never verified.
**Risk:** none to the running system — SES is not wired into anything until W7. The only failure mode is leaving it too late.

---

# Section D — The one large sweep

Independent of persistence: it touches design tokens and strings, so the B3 migration cannot invalidate it. Doing it now means B3 lands on an already-themed, already-localised app rather than doubling the surface to re-verify. Phase 1's `var()`-emitting colors and the structured-returns rule exist to make both sweeps mechanical.

## A8 — Design brief — `docs/design-brief-phase-5`

**The G7 gate.** Nothing in A9/A10 starts before the design session merges `design/extensions/*.dc.html`.

- [ ] `docs/design-briefs/phase-5-appearance-language.md`: dark palette sheet (every token including the 4 asset hues at ≥4.5:1, shadows, chart grid and tooltip, sidebar-vs-page, focus and selection), theme + language segmented controls, UK reference copy (~20–30 % longer than EN).

## A9 — Dark theme — `feat/dark-theme`

- [ ] Split double-duty tokens into surface/on-surface pairs (`ink`, `sidebar-text`).
- [ ] Purge literal `bg-white` / `text-white` (TransactionPanel, AssetForm, Select, Sidebar, KpiCard, DatePicker, button-variants) and rgba shadows (Card, KpiCard, Select, DatePicker) into tokens.
- [ ] `[data-theme=dark]` block for all tokens including `--color-chart-*`; theme the recharts Tooltip and cursor.
- [ ] FOUC-free head script in `index.html` + `<meta name="color-scheme">`; store `theme` with `matchMedia` for `system`; chart `key`s stable across flips; toggle in Settings → Appearance.

## A10 — Ukrainian — `feat/i18n-uk`

- [ ] `src/i18n/messages.ts` (`en` canonical, `Dict` derived from it, `uk satisfies Dict`), `useT()` on `settings.language`.
- [ ] Sweep ~200 strings across ~26 files, one mechanical commit per screen; label maps return keys and their tests re-assert keys.
- [ ] `pnpm add date-fns` → DayPicker `locale={uk}` + `weekStartsOn`; `document.documentElement.lang`; MONTH_SHORT and ordinals into i18n; runtime key-parity test.
- [ ] **Pinned: `fmtTable` / `fmtProse` / `fmtDate` are byte-identical in both languages.** Formats never follow language.

**Contracts:** settings `theme` / `language`; the final token vocabulary; i18n namespace `screen.section.item`. **DECISIONS:** theme architecture (token redefinition, FOUC contract, persist key); i18n architecture (typed dict, keys-in-tests, formats-never-localize, `date-fns` dep — G6 entry).
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

- [ ] **Target changed by D45.** The channel is no longer SNS email, so the thing worth checking is not `SubscriptionsConfirmed` on a topic nobody listens to — it is that the **notification configuration is `ACTIVE` and holds at least one channel**. Same principle, different query.
- [ ] The 01:00 capture reads it and logs it as JSON, exactly as it already logs `unchangedDays`. No new schedule — the "exactly one automation" ruling holds. Note the API only answers in `us-east-1`.
- [ ] Metric filter → metric → alarm on `< 1`.
- [ ] **Accept that this alarm notifies through the channel it is checking.** Not solvable by cleverness; solved by the value being readable *without* push — on the dashboard and in the run journal (W8). The alarm is the backup, the visible number is the primary.
- [ ] **Remove the SNS `Subscription` block from `template.yaml`.** Left in, every deploy mints another subscription that dies on arrival — noise that looks like a configured channel. `CaptureAlertTopic` itself stays: free, already wired, and a second channel may want it.
- [ ] Exec role gains `notifications:GetNotificationConfiguration` / `ListChannels` and nothing else.

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

- [ ] Create `quirenote-backend-deploy` — same OIDC trust policy and repo/branch
      condition as its predecessor.
- [ ] Create `quirenote-backend-cfn-exec` — trusted by CloudFormation only.
- [ ] **Rewrite every `kubushka-backend-*` prefix**, and there are more than the
      stack name: the exec policy scopes **eight** ARN patterns —
      `cloudformation`, `lambda`, `iam`, `logs`, `sqs`, `sns`, `cloudwatch`,
      `scheduler`. Miss one and the deploy fails on a permission, which this
      project has already paid for eight times (`infra/README.md` field notes).
      The `iam:*` prefix scoping matters most: SAM creates the function's
      execution role named after the stack, so it becomes `quirenote-backend-*`.
- [ ] Add the new deploy-role ARN to GitHub. Keep the old secret value recorded —
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
- [ ] Confirm the bill returns to baseline — two clusters existed for a while and
      exactly one should remain.
- [ ] Delete the old IAM roles.

**Rollback at any point before the teardown:** switch the GitHub secret and the
workflow back. The old stack never stopped working.

## E4 — The last identifiers and the docs — **DONE 2026-08-11**

> `infra/README` now documents only the roles that exist, with the move's
> field notes appended; `DEPLOYMENT` §1.5/§1.5a describe the current role and
> keep only the two lessons the cutover taught; `CLAUDE.md` warns that the
> missing SNS topic is deliberate. The Amplify **app name** stays `kubushka`
> in the console — cosmetic, and the App ID it does not change is what the URL
> depends on.

- [x] `infra/src/capture.ts` — `USER_AGENT`. Its URL should become
      `https://quirenote.com` once A11 and the Amplify custom domain land; until
      then the Amplify URL stays, because a User-Agent that points nowhere is
      worse than one that points somewhere old.
- [x] `infra/README.md` — both role policies verbatim, every prefix, and a field
      note recording what the move actually cost.
- [x] `docs/reference/DEPLOYMENT.md`, `docs/README.md` backend table, `CLAUDE.md` key facts.
- [ ] Amplify app name in the console — cosmetic, unrelated to the custom domain
      in A11.
- [x] Update `PLAN-WAITING.md` W1/W3/W4 dates by the days actually lost, measured
      against the E3 baseline rather than estimated.

---

## Cross-phase rules

- Branches as named; plain conventional commits; squash-merge to `dev`; no AI attribution in any git artifact.
- `pnpm lint && pnpm typecheck && pnpm test` per merge; `pnpm build` + tag per section close.
- `infra/` phases deploy through `.github/workflows/deploy-backend.yml` only. CI drives one named stack and may not touch hosting config (D15).
- **Standing invariants:** no silent writes — fetched, derived and server-suggested values reach a draft or a prefill only (G5); empty cell ≠ 0; validate-fully-then-one-transaction; every new persisted settings field enters `partialize` in the same commit; D7 motion + reduced-motion on every new control.
- Every DDL change on DSQL: one statement per transaction, never mixed with DML, no `DESC` in index keys, retry SQLSTATE 40001, ≤3,000 mutated rows per transaction.

## Acceptance for Plan A

A1 makes the 2026-09-23 coupon land on the 23rd. A2–A4 leave a narrow journal, a proven restore and a queryable NBU history. A5–A7 retire the hard-coded rate, catch a yield revision and make a parse failure visible. A8–A10 leave every route themed and localised. At that point the only work left is dated (`PLAN-WAITING.md`) or undecided (`PLAN-OPEN.md`).
