# Data model — sources

> Moved **verbatim** from [`../2026-08-04-data-model.md`](../2026-08-04-data-model.md) on 2026-08-26 (D95). **Contracts here are load-bearing** — the observation key is immutable on DSQL (D30): changing it is a DROP/CREATE of a live archive, not a migration.

## Sources

There is **no single source of truth**, and there cannot be — the two instrument
classes differ in kind. Established by research on 2026-08-11.

**No Ukrainian law requires machine-readable public prices.** For a closed-end
пайовий fund like Inzhur's, the floor under ЗУ «Про інститути спільного
інвестування» № 5080-VI and НКЦПФР rules is: NAV **calculated monthly**, filed to
the regulator in XML quarterly/annually, disclosed publicly in **human-readable**
form quarterly/annually. Daily publication is required only of **open-ended**
funds. НКЦПФР's 19 open datasets contain no NAV; SMIDA's open-data API was
retired 2021-06-30 (verified: all paths 404).

> **Corrected 2026-08-24 — D82.** The retirement was `stockmarket.gov.ua`'s,
> not SMIDA's: that date is exactly where its trader and exchange endpoints
> stop. SMIDA's feed at `/db/api/v1/feed-index.xml` is live and current
> (158 268 records, nine-minute freshness). The conclusion below is
> unaffected — the feed carries filings, not NAV. **Whether we may poll it is
> settled: no, categorically — D86 closed O25 on 2026-08-24.** Our code does not
> fetch SMIDA.

So Inzhur's daily JSON is **voluntary commercial disclosure**, not compliance.
Contractually it is «Базова ціна» — cl. 1.4 of their services agreement, *"the
price INZHUR offers to buy and/or sell securities at"* — i.e. a dealer quote on
their own secondary market, not a NAV. That is also why it carries a ~0.1%
spread (`buy = nav × 1.010`, `sell = nav × 1.009`) and moves daily while NAV is
struck monthly.

| | ОВДП (bonds) | Inzhur fund units |
|---|---|---|
| Official source | **NBU fair value, daily** | none |
| Archive | **back to 2016-01-04** | none |
| Backfillable | **yes, by URL** | **no** |
| What our archive is | convenience + cross-check | **the only copy that will ever exist** |

**The axis that matters is not "has an API" — it is "is backfillable".** Only
the two fund NAVs are genuinely perishable.

### NBU fair value

```
https://bank.gov.ua/files/Fair_value/{YYYYMM}/{YYYYMMDD}_fv.txt
```

Published under Постанова Правління НБУ № 732 (26.10.2015) for the NBU's own
collateral valuation — a stable government feed, not a market-transparency duty,
but far more durable than a marketing API. Carries `ETag` and `Last-Modified`,
which Inzhur does not.

Parsing traps, all verified against the live file:

- **cp1251, not UTF-8.** A UTF-8 read yields mojibake without erroring.
- **The header is malformed.** Its 18th semicolon field reads
  `g_spread,z_spread,cptype` — three comma-separated names — while data rows
  carry only `cptype` there. Zipping header to row mislabels the tail and
  invents two columns. **Parse by fixed index**: 0 `calc_date` · 1 `cpcode`
  (ISIN) · 2 `ccy` · 3 `fair_value` · 4 `ytm` · 5 `clean_rate` · 7 `maturity` ·
  17 `cptype`.
- **404 on weekends and holidays is normal**, not an error. Recorded as
  `not_published`; never alarmed on. No holiday calendar is encoded — the 404
  already carries that fact, and a hardcoded calendar would be one more thing to
  maintain and get wrong.

The two sources are **not substitutes**: measured ~0.9% apart on the same ISIN
the same day, because one is a dealer quote and the other a model valuation.
Both are stored, distinguished by `source`. In the future observation table,
`source` joins the natural key `(as_of, ref, basis, source)` for exactly this
reason — merging them would present one as the other.

### Stable identifiers

НДУ (csd.ua) issues real ISINs for the funds: **Inzhur REIT `UA5000014044`**,
**Inzhur Energy `UA5000012246`** (both CFI `CICJLU`). Worth adopting over the
provider slugs, because НКЦПФР approved a merger of five Inzhur funds into one
on 2025-08-29 and the feed still carries `ocean-plaza` as `completed` — slugs
demonstrably appear, change status and get absorbed. НДУ publishes **no
valuation**: its `price` field is the nominal issue value, not a market price.
