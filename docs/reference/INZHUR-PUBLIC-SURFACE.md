# Inzhur — the provider's public read surface

Not a new price source and no ruling changes here — what the provider serves publicly, how to
read it without recording garbage, and which cross-checks exist for free.

```
GET https://www.inzhur.reit/api/funds        → 200, JSON, 10 funds, no key, no auth
GET https://www.inzhur.reit/api/funds/{id}   → 200, one fund
```

Strapi. Per-fund fields: `name`, `fundID`, `profitability`, `projectedProfitabilityPercentage`,
`profitabilityTitle`, `fundType`, `status`, `openDate`, `monthsToClose`,
`initialInvestmentValue`, `UkrainianStockExchange`, `rank`, `licenses`, `shortDescription`.
`updatedAt` moves the same day. **No price, NAV or unit count in it**, and no quote endpoint
exists — `/api/quotes`, `/api/prices`, `/api/securities`, `/api/certificate-prices` all 404;
`?populate=*` returns 500. Useful for the fund roster, useless for a series.

The offer pages (`/offer/inzhur-reit`, `/offer/inzhur-energy`) do carry a
`{"buy":…,"sell":…,"nav":…}` object — the same dealer quote `infra/src/capture.ts` already
archives daily (`capture.ts:447` hashes `sellUAH:buyUAH:navUAH`), read through a second window,
not an independent corroboration. Pinned ratios: `sellUAH = navUAH ×
1.009`, `buyUAH = navUAH × 1.010` ([`data-model.md`](../superpowers/specs/2026-08-04-data-model.md)).

## THE PAYLOAD IS devalue-ENCODED, and there are ~35 quote objects on one page

Two traps stacked, and the second is the one that bites.

**First: the numbers in a quote object are indices.** The page ships `<script
id="__NUXT_DATA__">` holding a devalue array — 4 468 entries on `/offer/inzhur-energy`. So
`{"buy":1354,…}` means *entry 1354*, not ₴1354 — fully decodable in three lines: parse that
script's JSON, then index into it.

**Second: one page carries a quote object per instrument card**, around 35 of them, and
**taking the first regex match gets you a different fund's quote** — an object can belong to a
`nav: 0` instrument. Identify the right one by cross-checking `nav` against the rendered *ВЧА
на сертифікат*. Resolved this way, both funds are exact:

| | index | `buy` | `sell` | `nav` |
|---|---|---|---|---|
| `inzhur-reit` | 1590 | 11.1075 | 11.0965 | 10.9975 |
| `inzhur-energy` | 1767 | 6654.8999 | 6648.3109 | 6589.0098 |

| | `sell / nav` | `buy / nav` |
|---|---|---|
| `inzhur-reit` | 1.009002 | 1.010002 |
| `inzhur-energy` | **1.0090000** | **1.0100000** |

Energy is exact to seven decimals (`nav × 1.009 = 6648.3109`, `nav × 1.010 = 6654.8999`, both
to the last digit); REIT's last two digits are kopeck rounding — the pinned `sellUAH = navUAH ×
1.009` / `buyUAH = navUAH × 1.010` hold on both funds.

**Beware the `nav: 0` objects** — several quote objects on these pages carry `nav: 0` with `buy
== sell`, genuinely, for two of the four funds, not a broken record or a zero spread. A parser
that averages or ratios across all quote objects on a page will divide by it.

## Cross-checks

| | ВЧА на сертифікат | Вартість активів фонду | Сертифікатів в обігу |
|---|---|---|---|
| `inzhur-reit` | 10.9975 ₴ | 6 349 854 721 ₴ | 565 596 561 |
| `inzhur-energy` | 6 589.0098 ₴ | 1 161 530 519 ₴ | — |

**Do not divide assets by certificates to check NAV** — *ВЧА* is net of liabilities, *Вартість
активів фонду* is gross, and the ~2 % gap reads like a parse error when it is a balance sheet;
quote the ₴ and the base, never the bare percentage. Quarterly «Довідка ВЧА» PDFs, linked from
each offer page, are the anchor points a parse of the daily series must agree with at quarter
end — only where Energy's `.xlsx` (starts 2024-11-14) overlaps a PDF:

| Fund | Quarters linked |
|---|---|
| `inzhur-reit` | 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |
| `inzhur-energy` | 30.09.2024 · 31.12.2024 · 31.03.2025 · 30.06.2025 · 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |

**No exchange-priced series exists for any of the FUNDS** — all ten return
`UkrainianStockExchange: false`, so the ПФТС tables in
[`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md) §4 cannot price them; НБУ fair value
(`nbu_fv`) remains the bonds' separate basis.

## Fetching the files

Linked from the **offer pages**, which `robots.txt` allows, served from
`d2zk2gr3fhkmim.cloudfront.net`, plus a dividend file:

```
Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx
Enerdzhi_czina_06_07_2026_2c553a3277.xlsx
Inzhur_REIT_dividendi_28_07_29bd9cd4a8.xlsx
```

Fetching them automatically is allowed — the links sit on an allowed page, and the CDN is a
separate origin with **no `robots.txt` at all** (`404 NoSuchKey`); `/documents` is not the path
used. The filename carries a **content hash**, so polling these URLs signals nothing forever —
re-read the offer page for the current link. `Last-Modified` confirms the cut (`Mon, 06 Jul
2026 14:08:47 GMT` for the REIT file); naming is not uniform, so do not parse the date out of
it — the dividend file is `…_dividendi_28_07_…`, no year.

`https://www.inzhur.reit/robots.txt` allows `/` and disallows `/dashboard/`, `/signin/`,
`/signup/`, `/documents`, `/terms`, `/privacy-policy`, `/fund_merger_report`,
`/annual_report_2025` — offer pages and `/api/` are not disallowed. The wider external source
map is in [`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md).
