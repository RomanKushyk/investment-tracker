# infra — W1: the frozen-feed detector on real data

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). Includes A20's deploy failure, which nothing local could have caught.

## W1 — the frozen-feed detector on real data, measured 2026-08-18

**Read, not invoked.** `unchangedDays` is derived from stored hashes
(`capture.ts` → `unchangedStreak`)  **[Both the function and the `Quirenote/UnchangedDays` metric were removed by A20 on 2026-08-18 — the rest of this sentence describes what was true then.]**, so the number needs no fresh capture: it is
already published to `Quirenote/UnchangedDays` by every business-day run, and the
underlying digests are in `price_capture`. W1's own instruction said to invoke the
Lambda with `{}`; that would have made a second same-day request to the provider,
on the day we were waiting for their answer about request frequency. Do not.

**The reading: `1` on every business day, both sources.** Five business-day
datapoints, which is exactly the gate — as_of 08-11, 08-12, 08-13, 08-14, 08-17
for `inzhur` and `nbu_fv` alike, all `1`. Nothing is stale and no alarm is due.
The as_of 08-15/08-16 gap is correct: the streak is skipped on weekend dates.

**But `1` turns out to be structural for `inzhur`, not evidence of health.**
Reading the stored payloads day by day:

| transition | live bonds moved | funds moved | median bond step |
|---|---|---|---|
| Wed → Thu | 24 / 31 | 3 / 5 | +0.43 |
| Thu → Fri | 24 / 31 | 3 / 5 | +0.43 |
| **Fri → Sat** | **24 / 31** | **0 / 5** | +0.43 |
| **Sat → Sun** | **24 / 31** | **0 / 5** | +0.43 |
| Sun → Mon | 24 / 31 | 3 / 5 | +0.43 |

The 24 live bonds tick up by a near-constant ~0.43 **every calendar day,
weekends included** — that is daily accrued interest in the published dirty
price, not a re-quote. The 7 that never move are D31's `status: 'completed'`
bonds serving a frozen last price.

**The consequence for the detector.** `quotes_sha256` is ONE hash over all 36
entries, so a single daily mover keeps the digest fresh. With 24 bonds accruing
daily, an `inzhur` digest can never repeat while the feed is alive — the streak
is pinned at 1 by construction. **`StalePricesAlarm` can therefore only catch a
TOTAL feed freeze, never a single stale instrument.** That is not a defect: D31
already established that per-instrument staleness is measured by inverting the
DCF (which dated seven bonds 1–6 days stale on 2026-08-11), and the two
mechanisms answer different questions. It does mean the alarm is worth less than
its name suggests, and that `STALE_AFTER_DAYS=5` is not the number protecting us.

**IT LOOKED LIKE THE PROVIDER WAS WRONG. THEY WERE RIGHT AND OUR LABELS WERE
NOT — and finding that is what this reading is actually worth.** Asked whether
prices are flat Saturday to Monday, Inzhur replied on 2026-08-18: *"так,
вартість цінних паперів в суботу, неділю та понеділок однакова."* Our archive
appeared to disagree: the funds were flat on three days, but on **Friday,
Saturday and Sunday**.

    as_of   dow   inzhur-reit   inzhur-energy
    08-14   Fri   11.0898       6660.7998
    08-15   Sat   11.0898       6660.7998
    08-16   Sun   11.0898       6660.7998
    08-17   Mon   11.0953       6661.8711

Shift that run one day later and it is exactly Saturday, Sunday, Monday. So the
disagreement was never about the prices; it was about the **date we write next
to them**.

**Confirmed independently of the provider, by inverting the DCF.** The owner's
cabinet on 2026-08-18 showed UA4000238976 at 15 997.50 for 15 bonds — 1066.50
each — against a published yield of 15.55 %. `bestValuationDate` prices that
quote from the coupon schedule alone:

| DCF says the price is for | value | our archive filed it as |
|---|---|---|
| 08-15 | 1065.2373 | **08-14** (1065.24) |
| 08-16 | 1065.6592 | **08-15** (1065.66) |
| 08-17 | 1066.0812 | **08-16** (1066.08) |
| **08-18** | **1066.5035** | **08-17** (1066.50) |

Four consecutive days, a one-day offset every time, residual **0.0035 ₴** —
inside the 0.0007–0.0046 band D31 recorded for a fresh, correctly-dated bond.
The DCF knows nothing about the provider's calendar; it discounts the remaining
coupons. Two independent lines — the support answer and the model — land on the
same conclusion.

**The cause is `asOfFor` (`capture.ts`), and one function is serving two
different meanings.** It subtracts a day from the Kyiv date because "the feed
refreshes ~13:00, so the 01:00 run reads the price settled the previous day".
That premise is false for Inzhur: at 01:00 the live endpoint already serves the
price struck FOR that calendar day. But the same value is also the NBU
**request parameter** — `nbuFairValueUrl(asOf)` fetches the file for a named
date, and the file for D-1 genuinely is D-1's. **NBU is labelled correctly and
must not be touched.** The fix is to separate the two meanings, not to change
the function.

**Consequences, not yet acted on.** Every Inzhur row in the archive is one day
early and needs `as_of + 1`; the convention pinned in
`migrations/001_price_capture.sql` — pinned precisely because "a silent
redefinition later poisons the archive with no way to tell which rows used which
rule" — has to be superseded by a decision first. The poisoning is uniform and
now detectable, which is the only reason it is repairable. **Repaired the same
day — see the section below.** The `unchangedDays` reading above is
unaffected: the streak walk skips weekend dates, so shifting the run to
Sat–Sun–Mon still leaves Monday comparing against Friday, and still reads 1.

**The detector this section measured no longer exists.** The reading above is
the last one it produced: the owner's ruling the same day retired the value
check outright (**D70**, shipped as A20). Checks are now structural — did the
capture run, does the feed still list the refs it must — and the two shape
numbers, `EntryCount` and `SkippedRefs`, are graphed per source with no alarm on
either. `quotes_sha256` is still computed and stored, so this whole reading can
be reproduced from the archive at any time; it simply is not judged on a
schedule any more.

### A20's deploy failed first, and nothing local could have caught it

`SkippedRefsMetricFilter` shipped with both `DefaultValue` and `Dimensions` on
one metric transformation. CloudWatch Logs rejects that pair —
`"metric transformation: dimensions and default value are mutually exclusive
properties"`, a 400 raised while CREATING the resource. The stack rolled back
cleanly and the Lambda went back with it, so nothing was left half-applied; the
cost was one CI cycle.

**Checked rather than assumed: `cfn-lint` does not catch it.** Linting the
broken template and the fixed one against `eu-north-1` both return **zero**
findings, so adding cfn-lint to the backend workflow would have bought nothing
here and is not being added on the strength of a guess. The constraint is
service-side and appears only when the resource is created — no local validation
sees it.

So the real protection is the two things that already worked: the update rolls
back as one unit, and the deploy fails loudly instead of half-succeeding. What
this note buys is the next person adding a metric filter **with dimensions**
knowing not to reach for `DefaultValue` at the same time. It was not wanted
anyway — `skippedRefs` is emitted on every scheduled run and carries 0 when
nothing was skipped, so a default would only invent datapoints for runs that
never happened.
