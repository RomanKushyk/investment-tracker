# W3 — the Inzhur observation window, read

Read 2026-08-31 against the live archive, covering **`as_of` 2026-08-11 → 2026-08-31
for `inzhur` and 2026-08-10 → 2026-08-30 for `nbu_fv`** — 21 consecutive days each,
**no missing day in either source**. W3's gate said 2026-09-02; the answers below
rest on 18 day-over-day transitions, and the two captures still to land before that
date cannot move any of them. **W4 has no date of its own** — its gate is W3 plus
`PLAN-NOW.md` A4, which closed 2026-08-11 (D50) — so this reading opens it rather
than waiting for the calendar.

Method: `price_capture` only, read-only, via the same `DsqlSigner` + `pg` path
`capture.ts` uses. `payload_bytes` and `payload_sha256` are columns, so byte
stability needed no decompression; for the content answers the payloads were
decompressed and compared pairwise.

**The pairwise series is `as_of` 2026-08-13 → 2026-08-31 — 18 transitions.** Both
manual-invoke days are excluded, and the rule is applied to both: 2026-08-11 carries
five hand-triggered runs and 2026-08-12 carries three, so either as a term would
compare a hand-triggered capture against a scheduled one. **A first pass dropped
only 08-11 and kept 08-12, and that inconsistency manufactured the single anomaly
it then reported** — a Thursday on which 2 of 5 funds moved rather than 3. Dropping
both leaves 18 clean transitions with **no anomaly at all**, and the fund result
below is exact rather than approximate.

**The cron is not a single daily firing.** `infra/template.yaml` schedules
`cron(0 1,3,5,7,9,11 * * ? *)` in `Europe/Kyiv` — six attempts two hours apart, a
retry ladder for a provider under maintenance, with the later five no-oping via
`alreadySettled` before any fetch. What this window measures is that **the 01:00
attempt settled on every one of the 21 days**, so the ladder was never needed — not
that the cron fires once.

> **A methodological trap that produced a false alarm, recorded so the next reader
> does not repeat it.** The `pg` driver returns `DATE` as a JS `Date` at LOCAL
> midnight. `toISOString()` and `JSON.stringify` then convert to UTC, which in Kyiv
> (+3) shifts every date back one day. The first pass of this reading concluded that
> `nbu_fv.as_of` was off by one against D71 and that NBU 404s on Fridays — both
> artefacts of that shift. **Select dates as text** and the archive is exactly what
> D71 documents. The error was caught by decompressing a payload and reading the
> file's own `calc_date`, which is the check to reach for whenever a date looks
> wrong.
>
> **`to_char(as_of,'YYYY-MM-DD')` — but never `… AS as_of` with an `ORDER BY as_of`.**
> That alias shadowing its own column is this repository's most expensive measured
> defect: **64.989 DPU against 9.508** once the index was disabled by it (D91, A50),
> and `../README.md` states the rule as "Never let an output alias shadow the column
> you `ORDER BY`". Alias it to something else, or do not alias it.

## Liveness and the as_of rule, confirmed

| source | `as_of` vs the run's Kyiv date | measured |
|---|---|---|
| `inzhur` | same day (D71) | **Δ = 0 on all 21 days** |
| `nbu_fv` | run − 1 (D71) | **Δ = 1 on all 21 days** |

Same-day repeat rows exist only for the manual invokes of the first two days, and
the `as_of` that identifies them differs per source because the rules above do:
**`inzhur` 2026-08-11 (5 runs) and 2026-08-12 (3); `nbu_fv` 2026-08-10 (6) and
2026-08-11 (3)**. Naming a bare date here without its source is the same conflation
the box above warns about.

## The six questions

### 1. Does the feed refresh on Saturdays and Sundays?

**Split by instrument class, and this is the window's most useful answer.**

| | into Sun | into Mon | every other transition |
|---|---|---|---|
| bonds (of 32) | 23–24 move | 23–24 move | 23–24 move |
| funds (of 5) | **0 move** | **0 move** | **3 move** |

**Bond prices move every calendar day**, weekends included — consistent with a dirty
price that accrues daily rather than a market that trades.

**Fund NAV does not move into Sunday or into Monday.** Three Sundays (08-16, 08-23,
08-30) and three Mondays (08-17, 08-24, 08-31) in the series, and each of the three
active funds — `inzhur-reit`, `inzhur-miltech`, `inzhur-energy` — moved on **exactly
12 of 18** transitions. 18 − 6 = 12, with no residue: there is no transition where an
active fund stood still for any other reason. `ocean-plaza` and `zhytniy` never moved
at all in the window.

> **This supersedes W1's table in [`frozen-feed.md`](frozen-feed.md)**, which reads
> `Fri→Sat 0/5`, `Sat→Sun 0/5`, `Sun→Mon 3/5`. Its Sunday figure AGREES
> with this file; **its Monday figure is the exact opposite**, and that is the one
> that would mislead a completeness check. That table was written before the D71 `+1` migration, so its `as_of` labels
> are one day early; the counts are the same measurements shifted. Read this file for
> fund cadence, that one for the detector.

### 2. How does a public holiday read?

**2026-08-24 was Independence Day. `nbu_fv` published normally** — HTTP 200, 185
entries, 22 101 bytes, sitting between Friday's 22 103 and Tuesday's 22 099. No
holiday effect at all.

**For `inzhur` the window cannot answer it, and no future window will answer it this
way.** 2026-08-24 was a **Monday**, the one weekday on which fund NAV is already
static, so the holiday effect and the Monday effect are inseparable in this
observation. Bonds moved into that date exactly as on any other.

**And the question is largely moot: public holidays are suspended in Ukraine under
martial law** (owner's ruling, 2026-08-31 — [`D111`](../../docs/decisions/D111.md)).
NBU's normal publication on 24 August is consistent with that.

### 3. Is `returnRates` stable, and does it move without the price moving?

**Three changes in 18 transitions — and the question as written asks about the wrong
half.** `returnRates.sell` moved **once**; `returnRates.buy` moved **three times**.
Comparing only `sell`, as the question does, makes the field look an order of
magnitude more stable than it is.

| transition | instrument | rates buy → | rates sell → | price spread → |
|---|---|---|---|---|
| 08-20 | UA4000239016 | 15.71 → 15.5 | 16 → **15.5** | 2.24 → **0.00** |
| 08-26 | UA4000237804 | 16.05 → 16 | 16.3 (unchanged) | 3.20 → 3.83 |
| 08-27 | UA4000239008 | 16.1 → 16.21 | 16.5 (unchanged) | 5.66 → 4.09 |

The price moved on all three transitions, so **the window contains no instance of a
rate moving while the price stood still**.

**The first row is not a rate change, it is a regime change.** UA4000239016's
two-sided quote collapsed: buy and sell rates became equal, buy and sell prices
became equal, and it **stayed collapsed for the remaining twelve days**. That is not
an anomaly either — **5 to 6 of the 30–32 bonds carry a zero price spread on any
given day**, so single-priced is an existing class of instrument and this bond joined
it. A schema that stores only one price per instrument-day would lose the distinction
entirely, and `price_observation`'s `basis` column is what carries it.

Inzhur marks these on its own site as **спецпропозиція** (owner, 2026-08-31), but
**that marker is nowhere in `/_api/assets`** — a leaf-by-leaf diff of the two groups
finds nothing separating them but the prices, and the payload contains no string
matching `спец`. So equality of `buy` and `sell` is the only available signal.
Membership is stable: five bonds held it on all 19 days with zero flips,
`UA4000239016` joined and never left, and **no bond has ever left the class**.
Surfacing it in the app is [issue #32](https://github.com/RomanKushyk/investment-tracker/issues/32).

Store `return_rate_buy` and `return_rate_sell` per observation. `price_observation`
already **declares** both, though nothing writes them yet — those columns were added
for Inzhur from row one and the parser currently discards them; NBU writes `ytm` and
`clean_rate` and never these.

### 4. What cadence do fund NAVs follow relative to bond prices?

They are on **different clocks**: bonds seven days a week, funds five.

**This does NOT decide itself in the schema, and the reading must not pretend it
does.** The funds are present in every Sunday and Monday payload with an unchanged
NAV — that is how "0 of 5 moved" was measured at all. So the open decision for W4 is
whether the Inzhur observer **writes what the payload served** (the NBU half's
behaviour, and what `002_price_observation.sql` describes as "exactly what the
provider served, per instrument per day") or **writes only on change**:

- **Write-every-day** — a fund gets seven rows a week, five of which repeat. Nothing
  reads as missing; the archive grows by ~260 redundant fund rows a year.
- **Write-on-change** — no row for a day a fund did not move, and every completeness
  check must then know that five funds are legitimately absent on Sundays and
  Mondays, for ever.

The key `(as_of, instrument_ref, basis, source)` supports both. Pick one deliberately in W4.

### 5. Are payload bytes stable enough that `payload_sha256` means anything?

**No for `inzhur`, yes for `nbu_fv` — the two sources are opposites.**

**The proof is the SAME-DAY repeat runs, not the daily uniqueness.** Distinct bytes
across days is equally consistent with "the bytes changed because the quotes did",
and shows nothing. The first two days carry repeated runs within one `as_of`, where
the quotes cannot have changed:

| source | same-day runs | distinct hashes among them |
|---|---|---|
| `inzhur` | 5 on `as_of` 08-11, 3 on 08-12 | **5 and 3** — every run differs |
| `nbu_fv` | 6 on `as_of` 08-10, 3 on 08-11 | **1 and 1** — every run identical |

So `payload_sha256` changes for `inzhur` when nothing has, and holds for `nbu_fv`
when nothing has. **That is D28 confirmed by measurement rather than assumed**: only
`quotes_sha256` is informative for `inzhur`. Across days the counts are 27 ok rows /
27 distinct hashes for `inzhur` and 22 / 15 for `nbu_fv`, and every distinct `as_of`
has a distinct payload in both — `nbu_fv`'s repeats are the same-day runs above, not
cross-day republication.

### 6. What does an outage actually look like?

**One shape observed, and it is not an outage.** `nbu_fv` returns **HTTP 404** on
exactly two `as_of` days a week — Saturday and Sunday — three weeks running:
08-15/08-16, 08-22/08-23, 08-29/08-30. The row is written with `ok = false`,
`payload_bytes = 0`, `entry_count` null, and `payload_sha256` =
`e3b0c44298fc1c14…`, the SHA-256 of the empty string. That is NBU's publication
calendar, not a failure.

**`inzhur` had no failure of any kind in 21 days.** So the window shows **no timeout,
no truncated body, and no stale-but-valid payload** — the three shapes the question
anticipated. This one stays open, and the honest reading is that a 21-day window on a
healthy feed cannot close it.

## What this means for W4

- The natural key `(as_of, instrument_ref, basis, source)` that A4 pinned for NBU
  (D50) survives everything above. Nothing here argues for a different key, and
  `basis` is doing real work — see the zero-spread class in §3.
- **Decide write-every-day against write-on-change for the Inzhur observer** (§4).
  It is not implied by the key and this reading does not settle it.
- Store `return_rate_buy` and `return_rate_sell`; `buy` is the moving half.
- `status` predicts movement **over the window, not on any given day**: 25 of the 32
  bonds moved at least once and 7 never did, and all 7 are `completed`. Per transition
  the count is 23–24, so an `active` bond standing still on one day is ordinary.
- The instrument set grew during the window — **payloads carry 35 entries (30 bonds +
  5 funds) on 2026-08-12 and 37 (32 + 5) on 2026-08-31** — so
  `instrument.listed_from` / `last_seen_on` have real work to do.

  > **UNRECONCILED, and W4 should resolve it before trusting any count.** Three
  > existing figures disagree with those: `field-notes.md` measured 35 entries live on
  > 2026-08-10, `002_price_observation.sql` pins "all 31 bonds" on 2026-08-11, and
  > `frozen-feed.md` reads 36 entries as 31 bonds + 5 funds over 08-12→08-17. The
  > journal's own `entry_count` also disagrees with the payload's array length on the
  > manual-invoke days — 08-12 has three rows reading 34, 35, 35 — so `entry_count` is
  > a post-parse figure and the two must not be compared casually.
