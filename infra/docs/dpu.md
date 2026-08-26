# infra — W2: a week of real DPU, and the 2026-08-25 re-measurement

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). **D91 lives here in measured form**: an aliased `ORDER BY` was disabling the index, and the headline figure fell from ~1,620 to ~173 DPU/month.

## W2 — a week of real DPU, measured 2026-08-17

> **The regime these numbers describe ended with the 01:00 run of 2026-08-19** — A20 shipped 2026-08-18 12:14, so the 08-18 capture still paid for the scan and 08-19..08-25 is the clean seven-day window every figure below uses. ** — read the
> re-measurement below before quoting anything here (D91) — it also settles the
> full-scan question this section leaves open.** The section is kept
> as the record of what the week actually cost; the headline ~1,620 DPU/month is
> now ~173, because A20 retired the query that dominated it.

The cost spec projected **~325 DPU/month at year 1** and said to measure anyway,
because background and system DPU (auto-ANALYZE, index maintenance) cannot be
modelled. Measured over the first full week of the current cluster
(`obt7…`, eu-north-1), from `AWS/AuroraDSQL` CloudWatch metrics.

**The unit costs, decomposed.**

| Event | TotalDPU | ReadDPU | BytesRead | WriteDPU | ComputeDPU |
|---|---|---|---|---|---|
| Capture with something new published | **69.0** | 65.8 | 34.2 MiB | 1.86 | 1.36 |
| Capture with nothing new | **3.1** | — | — | — | — |
| A no-op firing (the `alreadySettled` guard) | **0.484** | 0.244 | 117 KiB | 0 | 0.241 |

Cluster storage at the time of measurement: **34.9 MiB**. Zero Lambda errors
across the window; the cheap days are "nothing published", not failures.

**Extrapolated: ~1,620 DPU/month** — 22 weekday captures at 69, ~8 weekend ones
at 3.1, and 150 no-op firings at 0.484. That is **5× the ~325 projection** and
**1.6% of the 100,000 always-free allowance**, so the spec's conclusion holds
unchanged: no design decision differs across this spread. It is the *shape* of
the miss that is worth keeping, not the size.

**Two numbers that contradict what was written before.**

1. **D64 estimated the guard at "~6 DPU a month"; it costs ~73.** The estimate
   assumed a minimum-size read (2 KiB). The lookup actually reads **117 KiB** —
   57× the minimum — so five no-op firings a day cost 2.4 DPU/day, not 0.2.
   Twelve times the estimate, and still negligible in absolute terms: the
   six-firing retry schedule remains free in every sense that matters.
2. **A full capture reads 34.2 MiB while the entire cluster holds 34.9 MiB.**
   It reads approximately everything. Whether that is a genuine full scan or a
   large bounded read is NOT established by this measurement — two consecutive
   full captures were flat at 69.06 and 69.04, which a scan over a growing
   archive would not stay. **Answered 2026-08-25 by `EXPLAIN`, not by W6 — see
   the re-measurement below (D91). It WAS a full table scan**, and the flatness
   argument in the previous sentence is the error worth keeping: the archive
   grows ~2 rows in 6,664 a day, so a scan's cost moves ~0.02 DPU between
   consecutive days — far below the resolution of a 69.0 reading. **Two flat
   samples were never evidence against a scan.** The cause was an aliased
   `ORDER BY` disabling the index, so neither the year-20 projection nor D48's
   index is impeached.

**One-off, and worth knowing before anyone recreates a cluster casually:**
**2026-08-11 cost 34,956 DPU in a single day** — cluster creation, backfill and
the D49 restore test together. That is a third of a month's free allowance in
one day, and it is the reason the weekly total (~35,700) says nothing useful
until the creation day is excluded from it.

**The weekly shape is the provider's, not ours.** **[Refuted 2026-08-25 — D91: the cheap days were the `!isWeekend(asOf)` gate plus the pre-A19 one-day `as_of` shift, not provider cadence. `STALE_AFTER_DAYS` no longer exists either; A20 removed it.]** Captures that ran on Sunday
and Monday cost 3.1 DPU against 69 for the weekday ones. Inzhur refreshes prices
on Saturday *for* Monday, so the Monday 01:00 run finds nothing new — the
owner's note, confirmed by the numbers. This matters more for **W1's frozen-feed
detector** than for cost: a normal weekend already holds a value unchanged for
three days against `STALE_AFTER_DAYS=5`, leaving two days of margin. A public
holiday adjoining a weekend would spend it.

### Re-measured 2026-08-25 — an aliased ORDER BY was disabling the index (D91)

The section above left open whether the 34.2 MiB a capture read was a full scan
or a large bounded read, and named **W6 (2026-09-10)** as the decider. It needed
neither W6 nor inference: **`EXPLAIN (ANALYZE, VERBOSE)` prints a
`Statement DPU Estimate` block** — per-statement cost, on demand.

| Statement (`price_capture`, 6,664 rows, ~35 MiB) | Plan | Read DPU | Time |
|---|---|---|---|
| streak query, `source='inzhur'`, verbatim | Index Scan | **0.559** | 4.1 ms |
| streak query, `source='nbu_fv'`, verbatim | **Full Scan (btree-table)** | **64.989** | 826.5 ms |
| same, `ORDER BY price_capture.as_of` (column, not alias) | **Index Scan Backward** | **9.508** | 152.2 ms |
| `count(*)` — projects nothing | Index Only Scan, all 6,664 rows | **1.210** | 26.9 ms |

**The cause is an alias collision.** The query selects
`to_char(as_of, 'YYYY-MM-DD') AS as_of` and then orders by `as_of`. A bare name
in `ORDER BY` resolves to the *output* column first, so the sort key is the TEXT
expression (`Sort Key: (to_char(...)) DESC` in the plan). A sort on a computed
value cannot inherit index order, `LIMIT 60` bounds nothing, and every matching
row is materialised first. Row three changes only that clause and the plan flips
to `Index Scan Backward`, 6.8× cheaper.

**Why it was expensive is the storage layout.** `count(*)` walks all 6,664 rows
through `price_capture_source_as_of` for 1.210 DPU. The scanning branch walks
`B-Tree Scan on public.price_capture` — the table — whose rows carry
`payload_gzip`, 32 MB compressed across the table. Scanning the index is cheap;
scanning the table is not.

**What this means for D48, precisely.** Its claim that `payload_gzip` is never
read holds on index paths (6,664 rows for 1.210 DPU) and **fails on a table
scan**, where the payload is billed whatever the projection says — `Projections:`
names what comes back, not what was read. **A2's rejection of the payload split
stands for the queries it measured and is not a general licence.** D48's index,
meanwhile, was right: row three shows it can serve the ORDER BY backwards exactly
as designed. The query's own alias never let it.

**Not established:** why row three costs 9.508 rather than ~1. Its plan shows
`Filters: ok AND quotes_sha256 IS NOT NULL, Rows Removed by Filter: 360`, so the
predicates outside the index force heap fetches — read off the plan, not measured.

**Cost now that A20 has removed the call:** **~173 DPU/month = 0.17%** of the
100,000 tier — one capture at 3.26 DPU (mean of 7, range 2.91–3.44) plus five
no-op firings at 0.4832 (mean of 35), over 30.44 days. The ~325 year-1 projection
models a much larger archive; the two are not comparable and it is not refuted.
**The guard still costs ~73 DPU/month, so D90's correction to D64 stands.**

**Corrections to the table above.** The Sunday/Monday relabel is count-neutral —
5 costly + 2 cheap either way — so it moves the extrapolation by nothing; the
1,615 → 1,593 gap is dominated by the costly-day count (21.74 against 22), with
the measured mean 68.63 and 30.44 days second. And the cheap days were the
`!isWeekend(asOf)` gate plus the pre-A19 one-day `as_of` shift — a Sunday run
carried a Saturday `as_of` and skipped — **not** provider refresh cadence, which
is what the "weekly shape is the provider's" paragraph above concludes from the
same numbers.

**On the guard's own figures:** its read is 116.7–121.5 KiB (mean 120.0, n=35),
and W2's "57×" does not reproduce from any of them: 117 KiB binary gives 58.5,
the measured mean gives 60, and the only arithmetic yielding 57.1 needs 117,000
decimal bytes = 114.26 KiB, which is BELOW the measured minimum. **Left
unresolved** — either W2's sample predates this window or its unit label is
wrong, and nothing here distinguishes them. Reported `ReadDPU` sits ~0.024 DPU above
`max(BytesRead, 2048) × 0.00000183105` at that size; that is a small fixed offset
at ~120 KiB, **not** a multiplier — the large reads here track the formula
closely, so do not scale anything by 1.11.

**A50's re-plan (2026-08-26) is in [`replan-a50.md`](replan-a50.md)**, moved
there when this file crossed 200 lines. **It measures a DIFFERENT query** — the
section above is the streak query, which A20 deleted; A50's is
`NEWEST_CAPTURE_PER_DATE`, which `observeNbu` still runs. They share the defect
class and nothing else, and the `LIMIT 60` reasoning above does not carry across:
that query had a `LIMIT` for the fix to make effective, and A50's has no SQL
bound at all.
