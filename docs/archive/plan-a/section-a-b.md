# Sections A and B — time-critical, and the backend before the archive grew

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A1, A2, A3, A14, A4. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

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

- [x] Measure before touching anything: `EXPLAIN ANALYZE` both queries and record bytes read. If the planner already avoids the payload, say so and close the phase — the deviation would then be cosmetic. **Measured, and it did: D48** — **but on ONE branch (D91):** the same call on `source='nbu_fv'` was a table scan at 64.989 DPU, and the cause was the query's own `to_char(as_of,…) AS as_of` alias, not `quotes_sha256` being outside the index.
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

