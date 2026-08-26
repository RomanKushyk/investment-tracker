# Data model — operating the capture

> Moved **verbatim** from [`../2026-08-04-data-model.md`](../2026-08-04-data-model.md) on 2026-08-26 (D95). **Contracts here are load-bearing** — the observation key is immutable on DSQL (D30): changing it is a DROP/CREATE of a live archive, not a migration.

## Operating the capture — what the super-admin sees and controls

Every capture writes a row whether it succeeded or not, so the run journal is
the operational surface. Nothing here needs new storage; it is a read over
`price_capture` plus a small number of settings.

**Visible per run:** `as_of` · `source` · `ok` · `http_status` · `error` ·
`entry_count` · `skipped_refs` · `payload_bytes` · `parser_version` ·
`requested_at`.

**The four states that must be distinguishable**, because conflating them is how
a broken pipeline looks healthy:

| State | How it reads | Alarm? |
|---|---|---|
| captured | `ok = true` | no |
| not published | `http_status = 404`, `error = not_published` | **no** — weekend/holiday |
| parse failure | `error` set, payload still stored | **yes** |
| never ran | **no row for that (as_of, source)** | **yes** — the silence alarm |

**Controls worth having**, in rough priority: enable/disable a source without a
deploy · re-run one date (`{ asOf }`) to repair a bad capture · run a backfill
range · view the last N runs with their errors · view which tracked refs were
missing from a published file.

**Parse errors are never silent and never destructive.** A payload that fails to
parse is still stored — the raw bytes are what a later parser fix reads — and
the row records why. `parser_version` on every row is what makes "which rows did
the broken parser produce" answerable rather than archaeological.

Deferred until the app can read this: the actual admin UI, per-source
enable/disable as stored settings rather than code, and alert routing per
source. The data to build all of it is being recorded now.

### Sequencing — raw payloads first

**Run the cron for ~3 weeks writing only timestamped raw payloads before finalising the archive
schema.** At ~165 KB/day this settles every remaining question with no schema decision as a
prerequisite: whether the feed refreshes on Saturdays, how holidays behave, whether the yield is
stable, fund NAV cadence, payload byte-stability, and the outage shape.

Land the two `parse.ts` fields (`returnRates`, `status`) *first* so parsed rows are complete when the
real archive starts.

One free observation is already scheduled: **2026-09-23**, the cum/ex boundary on UA4000238976 —
≈1081.82 cum vs ≈1003.42 ex. Unmissable, and it settles the convention.

Detection quality, for the record: **bonds yes, funds no.** Inverting the DCF recovers the date the
provider priced for at ~140:1 discrimination (0.42 ₴/day step against a 0.003 ₴ residual) — an
observation, not an inference. The fund FX-date channel rests on **one** informative observation and
conflates "the date the rate was converted with" with "the date the NAV was struck"; those are
independent operations. Do not ship a fund T-1 dedup rule on that evidence.

### Negative rulings — do not re-litigate

- **`interpolated` is rejected.** Nothing in this portfolio requires interpolation.
- **`kubushka-snapshots-2026-08-04.csv` is seed-generated output**, not a recording — emitted by
  `seed.ts::pathQuote()` (linear ramp + sine). No weekday or provider inference may be drawn from it.
- **Never encode a holiday calendar in a stored row.** Derive from `as_of`.

### Deferred (derivations, revisable with zero migration)

The `provenance` enum and its assignment rule · volatility / max-drawdown / best-worst-day rules
(none of these metrics exists yet) · fund valuation basis, deferred for free by keeping `basis` in
the key · `value_changed_at`, `modelResidual`, `identical_to_prev` and every other derived diagnostic
· UI treatment of carried and computed days · the 6 short-dated bonds that miss the DCF model
(neither holding is among them — handle by residual threshold plus alert).
