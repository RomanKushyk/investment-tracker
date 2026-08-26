# Section G — what W1 found

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds A20, A19. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

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

