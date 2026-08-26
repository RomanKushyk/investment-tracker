# Inzhur — the provider's public read surface, measured 2026-08-24

> Moved **verbatim** from [`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md) on 2026-08-26 (D95), where it was a second `#`-level document under one filename. The fund price files stay there; this is what the provider serves publicly and how to read it without recording garbage.

Measured with no account. **Nothing here is a new price source and nothing here
changes a ruling.** It is written down because two cheap checks were missing and
one parsing trap is expensive to hit: what the provider serves publicly, how to
read it without recording garbage, and which cross-checks exist for free.

## What it is, and what it is not

```
GET https://www.inzhur.reit/api/funds        → 200, JSON, 10 funds, no key, no auth
GET https://www.inzhur.reit/api/funds/{id}   → 200, one fund
```

Strapi. Per-fund fields: `name`, `fundID`, `profitability`,
`projectedProfitabilityPercentage`, `profitabilityTitle`, `fundType`, `status`,
`openDate`, `monthsToClose`, `initialInvestmentValue`, `UkrainianStockExchange`,
`rank`, `licenses`, `shortDescription`. `updatedAt` moves the same day.

**No price, NAV or unit count in it**, and no quote endpoint exists —
`/api/quotes`, `/api/prices`, `/api/securities`, `/api/certificate-prices` all
404; `?populate=*` returns 500. Useful for the fund roster, useless for a series.

The offer pages (`/offer/inzhur-reit`, `/offer/inzhur-energy`) do carry a
`{"buy":…,"sell":…,"nav":…}` object. **This is the same dealer quote
`infra/src/capture.ts` already archives daily** (`capture.ts:447` hashes
`sellUAH:buyUAH:navUAH`; all three bases legal from row one, `capture.ts:654`),
so it is our existing source read through a second window — **not an independent
corroboration of anything.** The nav-relative ratios it shows are pinned in
[`../superpowers/specs/2026-08-04-data-model.md`](../superpowers/specs/2026-08-04-data-model.md)
line 122 (`sellUAH = navUAH × 1.009`, `buyUAH = navUAH × 1.010`). D27 pins a
different quantity — a *~0.1 % spread*, which is `buy` against `sell` — so it is
not the citation to check these numbers against. What was measured, and how to
avoid measuring the wrong fund, is the next section.

> **The sentence at the top of this file needs reading with this section.**
> "An API for clients is in their backlog" remains true for **per-account** data
> — positions, transactions, statements. It is not true that no public endpoint
> exists. The same sentence is a row in D72's availability table and in
> `CLAUDE.md`; neither is wrong about client APIs, and neither anticipated a
> public roster endpoint.

## THE PAYLOAD IS devalue-ENCODED, and there are ~35 quote objects on one page

Two traps stacked, and the second is the one that bites.

**First: the numbers in a quote object are indices.** The page ships
`<script id="__NUXT_DATA__">` holding a devalue array — 4 468 entries on
`/offer/inzhur-energy`. So `{"buy":1354,…}` means *entry 1354*, not ₴1354. It is
fully decodable, and the decode is three lines: parse that script's JSON, then
index into it.

**Second: one page carries a quote object per instrument card**, around 35 of
them. **Taking the first regex match gets you a different fund's quote** — this
document's first draft did exactly that and reported Energy as having no spread,
because the object it grabbed belongs to a `nav: 0` instrument. Identify the
right one by cross-checking `nav` against the rendered *ВЧА на сертифікат*.

Resolved this way, both funds are exact:

| | index | `buy` | `sell` | `nav` |
|---|---|---|---|---|
| `inzhur-reit` | 1590 | 11.1075 | 11.0965 | 10.9975 |
| `inzhur-energy` | 1767 | 6654.8999 | 6648.3109 | 6589.0098 |

| | `sell / nav` | `buy / nav` |
|---|---|---|
| `inzhur-reit` | 1.009002 | 1.010002 |
| `inzhur-energy` | **1.0090000** | **1.0100000** |

Energy is exact to seven decimals — `nav × 1.009 = 6648.3109` and
`nav × 1.010 = 6654.8999`, both to the last digit. REIT's last two digits are the
kopeck rounding. **So the spec's pinned `sellUAH = navUAH × 1.009` and
`buyUAH = navUAH × 1.010` hold on both funds on 2026-08-24**, which is all this
measurement claims: it re-reads the same feed `capture.ts` already archives, so
it confirms the pin rather than corroborating it from a second source.

**Beware the `nav: 0` objects.** Several quote objects on these pages carry
`nav: 0` with `buy == sell` — consistent with D31's finding that `nav` is 0 for
two of the four funds. One of those is not a broken record and not a spread of
zero; it is an instrument whose NAV is genuinely absent. A parser that averages
or ratios across all quote objects on a page will divide by it.

## Rendered figures, and one cross-check that does NOT work

| | ВЧА на сертифікат | Вартість активів фонду | Сертифікатів в обігу |
|---|---|---|---|
| `inzhur-reit` | 10.9975 ₴ | 6 349 854 721 ₴ | 565 596 561 |
| `inzhur-energy` | 6 589.0098 ₴ | 1 161 530 519 ₴ | — |

> **Do not divide assets by certificates to check NAV.** For REIT,
> 10.9975 × 565 596 561 = 6 220 148 180 ₴ against a stated 6 349 854 721 ₴ — a
> gap of **129 706 541 ₴**, which is **2.04 %** of the stated total or **2.09 %**
> of the derived one. Nothing is wrong: *ВЧА* is net of liabilities and *Вартість
> активів фонду* is gross. The trap is that either figure is the same order as the
> 0.9 % this file exists to pin, so the gap reads like a basis or parse error when
> it is a balance sheet. **Quote the ₴ and the base, never the bare percentage.**

## Free cross-checks that do exist

**Quarterly «Довідка ВЧА» PDFs**, linked from each offer page — the provider's
own attested quarter-end NAV:

| Fund | Quarters linked |
|---|---|
| `inzhur-reit` | 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |
| `inzhur-energy` | 30.09.2024 · 31.12.2024 · 31.03.2025 · 30.06.2025 · 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |

These are the anchor points a parse of the daily series must agree with at
quarter end — the cheapest validation available for W15, and it was not being
used. **Only the overlapping quarters can validate anything**: Energy's `.xlsx`
starts 2024-11-14, so its earliest PDF (30.09.2024) sits six weeks *before* the
series and has no rows to agree with. It is still worth reading — it is a NAV the
provider attests to for a period the files do not cover — but assert agreement
only where both exist.

**No exchange-priced series exists for any of the FUNDS.** Every one of the ten
returns `UkrainianStockExchange: false`, so none is listed and the ПФТС tables in
[`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md) §4 cannot price them. On the
funds, D72's "the dealer quote exists nowhere else" is confirmed.

**This says nothing about the bonds, which already have a second basis.** D72
records НБУ fair value for the ОВДП positions as captured, and `nbu_fv` is a live
source in the archive — so for those instruments a differently-based series
exists and is ours already. ПФТС's `eqnn-quotes.html` and `contract-period.html`
price exactly that class of instrument too, which makes a third reading
*possible* rather than needed. The negative result above is fund-only; do not
read it as "no second basis for the portfolio".

## A third file, not previously recorded

Dividend history per certificate, alongside the two price files:

```
Inzhur_REIT_dividendi_28_07_29bd9cd4a8.xlsx
```

## Fetching the files — D83 supersedes D72's by-hand rule

The files are linked from the **offer pages**, which `robots.txt` allows, and
served from `d2zk2gr3fhkmim.cloudfront.net`:

```
Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx
Enerdzhi_czina_06_07_2026_2c553a3277.xlsx
```

**D83 (owner's ruling 2026-08-24) allows fetching them automatically**, on the
evidence that D72's premise was incomplete rather than wrong: the links sit on an
allowed page, and the CDN is a separate origin that publishes **no `robots.txt`
at all** — the request returns S3's `404 NoSuchKey`. `/documents` is still
disallowed and is **not** the path used, so the reasoning that made an automated
fetch self-refuting does not reach this route. We still do not crawl what they
asked us not to crawl.

**Two mechanics the import must respect.**

The filename carries a **content hash**, so a new cut publishes at a different,
unguessable URL: **polling these two URLs signals nothing forever** — they return
the stale file or 404. Re-read the offer page for the current link. `Last-Modified`
then confirms the cut; the REIT file returns `Mon, 06 Jul 2026 14:08:47 GMT`,
agreeing with the date in its own name.

The naming is not uniform, so do not parse the date out of it as a rule: the
dividend file is `…_dividendi_28_07_…`, with no year.

**D74 is untouched** — the rows are still archived as published, still `nav`,
still read by no screen. D83 decides only how the bytes arrive.

## robots.txt, as measured

`https://www.inzhur.reit/robots.txt` allows `/` and disallows `/dashboard/`,
`/signin/`, `/signup/`, `/documents`, `/terms`, `/privacy-policy`,
`/fund_merger_report`, `/annual_report_2025`. Offer pages and `/api/` are not
disallowed. `/documents` is — consistent with D72.

The wider external source map is in
[`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md).
