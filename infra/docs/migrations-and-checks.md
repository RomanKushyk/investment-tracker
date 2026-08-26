# infra — A19 the `as_of` migration, and A6 the nightly DCF check

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). Both ran 2026-08-18.

## A19 — the as_of migration, run 2026-08-18

**14 rows, one statement, one transaction.** `source='inzhur'`, `as_of + 1`, far
under DSQL's 3 000-mutated-rows cap. NBU was not touched: 6 636 rows back to
2016-01-04 unchanged, because for NBU the value is the request parameter and was
never wrong (D71).

**Three checks before the write, not after.**

- **Every row followed the automatic rule.** Compared `as_of` against
  `kyivDate(requested_at) - 1` on all 14: zero rows written with an explicit
  `asOf`, so the uniform shift was uniformly correct. A row with a hand-passed
  date would have been made wrong by the migration, and nothing in the table
  labels it as hand-passed.
- **A fresh recovery point, confirmed COMPLETED** — 36.6 MB at 12:51, taken
  before the write. There is no PITR here (whole-cluster recovery only), so the
  backup is the entire undo.
- **A payload fingerprint**, `md5(string_agg(payload_sha256))` over all 6 650
  rows, taken before and after. **Identical.** This moves labels and never
  bytes; a difference would have meant the migration touched something it had no
  business touching.

**Verified afterwards by the one instrument that answers independently.**
Re-running the DCF inversion over the stored payload for each migrated date:

| as_of | quote | DCF fits | residual ₴ | days stale |
|---|---|---|---|---|
| 2026-08-11 | 1063.55 | 2026-08-11 | 0.0013 | 0 |
| 2026-08-12 | 1063.97 | 2026-08-12 | 0.0026 | 0 |
| 2026-08-13 | 1064.39 | 2026-08-13 | 0.0040 | 0 |
| 2026-08-14 | 1064.82 | 2026-08-14 | −0.0045 | 0 |
| 2026-08-15 | 1065.24 | 2026-08-15 | −0.0027 | 0 |
| 2026-08-16 | 1065.66 | 2026-08-16 | −0.0008 | 0 |
| 2026-08-17 | 1066.08 | 2026-08-17 | 0.0012 | 0 |
| 2026-08-18 | 1066.50 | 2026-08-18 | 0.0035 | 0 |

**Eight of eight, every residual inside D31's 0.0007–0.0046 band, `daysStale` 0
throughout.** Before the migration every one of these fitted `as_of + 1`. The
DCF knows nothing about the provider's calendar or about our convention — it
discounts the remaining coupons — which is what makes it the check worth running
rather than a restatement of the change itself.

**The earliest Inzhur date is now 2026-08-11, not 08-10, and that is correct:**
the five rows previously filed under 08-10 were dev-time invokes run on the
evening of the 11th. Nothing was captured before then, so there is no 08-10 to
have.

**The deploy caught the rename, and the guard was guarding the wrong thing.**
`deploy-backend.yml` smoke-tests the bundle before it touches AWS, and one of its
assertions was `asOfFor(2026-08-11T22:00Z) === '2026-08-11'` — a check that
loaded the bundle, called the dating function, and confirmed **the very rule D71
had to repair**. It failed on the rename rather than on the arithmetic, which is
the only reason it looked like a chore. It now asserts both functions and that
they DIFFER, so a future collapse back into one date fails the deploy instead of
passing it. The step runs before `configure-aws-credentials`, so the failed run
deployed nothing and the stack was never in a half-applied state.

## A6 — the DCF check runs nightly now, 2026-08-18

**A20 created the need and this closes it.** Retiring `StalePricesAlarm` rested
on the argument that per-instrument staleness is the DCF inversion's job (D31).
That job only ran when someone opened the app, so a provider that quietly stopped
re-pricing was invisible on any day nobody looked. The capture now tallies
`checkQuote` over every live bond on the scheduled path.

**Measured over the eight days already in the archive before deciding what to
alarm on** — the same discipline A20 used, and it gave the same answer:

| verdict | per day |
|---|---|
| `consistent` | 18 |
| `not_applicable` | 7 — D31's `status: 'completed'` bonds exactly |
| `stale` | 3–4, **max 6 days**, every single day |
| `revised` | 1–2, with **UA4000236624 revised on all eight** |
| `inconclusive: insensitive` | 0–1 |
| **`inconclusive: unexplained`** | **0, across ~190 evaluations** |

**So staleness is graphed and never alarmed.** It is this feed's steady state,
not an event: an alarm on it fires nightly and is muted inside a month (D44).
`QuoteMaxStaleDays` per source is the graph, and a `quoteVerdicts` line carries
the four counts for anyone reading the log.

**One verdict alarms, and only because the measurement earned it.**
`unexplained` means no yield the model can produce explains the quote at all — a
schedule the parser mangled or a corrupt provider price. It has never happened.
It is also not a value check in D70's sense: it says the payload we are archiving
is internally incoherent, which is a structural fact, not a complaint that a
number failed to move.

**Nothing is stored.** The verdict is a conclusion whose premises — quote,
schedule, published yield — are all in `payload_gzip` forever, so any day can be
recomputed. A6's own plan pinned that, and it is the line D69 drew about the FX
rate.

**`tallyQuotes` lives in `infra/src/quotes.ts`, not in the handler**, for the
reason `dates.ts` does: a test for it must not reach the handler's `@aws-sdk/*`
imports, which the frontend CI job cannot resolve. Verified by walking both
tests' import graphs rather than by running them and trusting the result — that
is exactly the check that would have caught v1.6.2's failed deploy.
