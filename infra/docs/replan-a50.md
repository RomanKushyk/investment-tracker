# infra — A50's re-plan of the newest-capture-per-date query, 2026-08-26

> The working behind **D97**. Split out of [`dpu.md`](dpu.md) when that file
> crossed the 200-line cap; the section is unchanged from the commit that wrote
> it there, but this branch squash-merges, so `dev`'s history shows it arriving
> here rather than moving.
>
> **This is a DIFFERENT query from `dpu.md`'s 2026-08-25 section.** That one
> measured the streak query, which A20 deleted. This one is
> `NEWEST_CAPTURE_PER_DATE`, which `observeNbu` runs on every capture. They share
> only the defect class — an output alias shadowing the sorted column — and the
> `LIMIT` reasoning does **not** carry across: the streak query had `LIMIT 60`
> for the fix to make effective, and this one has no SQL bound at all.

`price_capture` at the time: **6,666 rows, 3,867 of them `source='nbu_fv' AND
ok`**.

## Round 1 — one run of each form, aliased first. Discarded.

`EXPLAIN (ANALYZE, VERBOSE)`, window `2026-08-19 .. 2026-08-26`.

| Form | Node | Compute | Read | Total | Exec | Planning |
|---|---|---|---|---|---|---|
| aliased | `Sort` | 0.01473 | 0.25558 | 0.27031 | 3.660 ms | 10.754 ms |
| qualified | `Incremental Sort` | 0.00162 | 0.25418 | 0.25580 | 1.221 ms | 0.217 ms |

Written up as compute falling 9.1×. **The tell was in the table:** two
near-identical statements cannot differ 50× in PLANNING time from a sort-key
change — that is a first parse, and the aliased form ran cold and first.

## Round 2 — warmed, then four runs with the order alternated

```
r0 OLD Sort             compute=0.00168 read=0.25418 total=0.25586 exec=1.334ms
r0 NEW IncrementalSort  compute=0.00171 read=0.25418 total=0.25588 exec=1.353ms
r1 NEW IncrementalSort  compute=0.00180 read=0.25418 total=0.25598 exec=1.448ms
r1 OLD Sort             compute=0.00181 read=0.25418 total=0.25599 exec=1.464ms
r2 OLD Sort             compute=0.00180 read=0.25418 total=0.25598 exec=1.443ms
r2 NEW IncrementalSort  compute=0.00182 read=0.25418 total=0.25600 exec=1.459ms
r3 NEW IncrementalSort  compute=0.00189 read=0.25418 total=0.25607 exec=1.511ms
r3 OLD Sort             compute=0.00174 read=0.25418 total=0.25591 exec=1.386ms
```

| Form | Node | Compute | Read | **Total** | Exec |
|---|---|---|---|---|---|
| aliased | `Sort` | 0.00177 | 0.25418 | **0.25594** | 1.414 ms |
| qualified | `Incremental Sort` | 0.00181 | 0.25418 | **0.25599** | 1.454 ms |

**Indistinguishable, the qualified form marginally the slower.** Compute spans
0.00168–0.00189 aliased and 0.00171–0.00189 qualified — fully overlapping. Read
is identical to five digits in all eight runs: both scan 15 rows, filter to 5,
and Read is **99.3%** of the total.

Round 2 then attributed D91's 0.356 to the same warmup. Its own numbers refute
that — see round 4.

## Round 3 — the widths round 2 declared out of scope

`EXPLAIN (VERBOSE)`, no `ANALYZE`, so shape only and no cost. **Both forms, ten
ranges** (round 3 swept nine; the table
below is round 4's ten, and D97's "nine" counted the earlier sweep):

| Range | aliased | qualified |
|---|---|---|
| 7d, 30d, 90d, 180d, 365d, 730d, 1500d | `Sort` over **Index Scan `price_capture_as_of`** | `Incremental Sort` over the **same Index Scan** |
| 2000d, 3000d, 3900d | `Sort` over **Full Scan (btree-table)** | `Sort` over the **same Full Scan** |

**The alias never changed the access path.** Both forms take the index out to
1500 days and both abandon it between 1500 and 2000 days. So there is no window
width at which the fix starts paying — which inverts the question round 1 and 2
were asking. It was never "how much cheaper" but "does the scan path ever
differ", and it does not.

It also gives O32 a measured ceiling: **a date-range bound up to ~1500 days keeps
the plan on `price_capture_as_of`.**

## Round 4 — D91's own window, and the 0.356 that will not reproduce

`EXPLAIN (ANALYZE, VERBOSE)` over `2026-08-18 .. 2026-08-25`, warm, three runs
per form: **read 0.26343, total 0.26528 — identical for both forms**, against
D91's recorded **0.356**.

Three candidate explanations, all measured and all insufficient:

- **Warmup** moves Read by 0.55% (0.25558 cold against 0.25418 warm), and Read is
  99.3% of the total. It cannot produce a 34% gap.
- **Window content** — D91's window holds 6 rows / 27.2 KiB against the 7-day
  window's 5 / 22.7 KiB. Measured directly on D91's window anyway, above.
- **Query form** — both forms return the same figure.

**So 0.356 is unreproduced and the cause is unknown.** Recorded as that, not as
superseded-because-warmup. **64.979**, the open-range figure from the same D91
session, has not been re-measured either — executing that branch is what it
costs — so it is one cold sample too, and it is load-bearing for keeping
`price_capture_as_of`.

## The open range, recorded not inferred

`EXPLAIN (VERBOSE)`, `2016-01-04 .. today`. The load-bearing node is the `Sort`:

```
Unique  (cost=3077.01..3081.10 rows=813 width=5094)
  ->  Sort  (cost=3077.01..3079.05 rows=818 width=5094)
        Sort Key: (to_char((price_capture.as_of)…)), price_capture.requested_at DESC
        ->  Full Scan (btree-table) on public.price_capture  (cost=928.53..3037.43 …)
              -> Storage Scan on public.price_capture
                  Projections: requested_at, as_of, payload_gzip, parser_version
                  Filters: (ok AND as_of >= '2016-01-04' AND as_of <= '2026-08-26'
                            AND source = 'nbu_fv')
                  -> B-Tree Scan on public.price_capture  (… rows=6628 …)
```

The qualified form differs only in `Sort Key: price_capture.as_of,
price_capture.requested_at DESC` and `width=5098`. Costs match at
`3077.01..3081.10` — two decimals, and planner cost is in arbitrary units.
`rows=6628` is a planner **estimate**; nothing here establishes why it differs
from either the 6,666 rows in the table or the 3,867 the filter selects, and
`ANALYZE`-ing the table would have been the way to find out.

**A plain SQL `LIMIT` cannot bound this**, which corrects what A50 filed as its
own remedy: a `Sort` consumes its whole input before yielding a row, and D91's
`LIMIT 60` paid off only because its input arrived index-ordered. A date-range
cap could — round 3 sized it — but `observeNbu` derives `complete`/`nextFrom`
from `captures.length > dates`, so capping the range in SQL makes a truncated
fetch look complete and stops the caller early. `PLAN-OPEN.md` **O32**.

**Verified in passing:** DSQL accepts `EXPLAIN (VERBOSE)` without `ANALYZE`, and
prints no `Statement DPU Estimate` in that form — only `ANALYZE` does.

## Post-deploy — the same plans, read off the deployed function

A50's last deliverable was to read the plans from the shipped Lambda rather than
from a laptop, so the instrument is proved and not just the SQL. Run
`32990066258` deployed `773f483`; `{diagnose:true}` then returned all three plan
keys:

| Key | Node | Scan | Total DPU |
|---|---|---|---|
| `observeNbu` | `Incremental Sort` | `Index Scan using price_capture_as_of` | **0.26928** |
| `observeNbuOpenRange` | `Sort` | `Full Scan (btree-table)` | none — no `ANALYZE` |

0.26928 sits above the 0.25599 warm median measured here, which is expected and
not a contradiction: a Lambda cold start, and a window that by then included the
day's own capture. The point of the check was the plan shape and the absence of a
DPU line on the second key, both as designed — and that the two added `EXPLAIN`
statements did not break the mode they were added to.
