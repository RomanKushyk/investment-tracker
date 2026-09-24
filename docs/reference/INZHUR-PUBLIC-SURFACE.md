# Inzhur — the provider's public read surface

What the provider serves publicly, how to read it without recording garbage, and which
cross-checks exist for free.

```
GET https://www.inzhur.reit/api/funds        → 200, JSON, 10 funds, no key, no auth
GET https://www.inzhur.reit/api/funds/{id}   → 200, one fund
```

Strapi, carrying each fund's name, ids, type, status, dates, projected profitability,
`UkrainianStockExchange` flag and licences. **No price, NAV or unit count in it**, and no quote
endpoint exists — `/api/quotes`, `/api/prices`, `/api/securities`, `/api/certificate-prices` all
404, and `?populate=*` returns 500. Useful for the fund roster, useless for a series.

The offer pages carry the dealer quote the asset feed served — every page the whole catalogue of it,
a second window on one quote rather than an independent corroboration. The capture reads
`/offer/ovdp` ([`DECISIONS.md`](../DECISIONS.md), *External sources*), and the page takes two
decoders.

## THE CATALOGUE IS devalue-ENCODED, and its schedules are empty

`<script class="it-astro-state" type="application/json+devalue">` holds the page's state as a
devalue-flattened `Map`: a number inside an object is an index into the flat array, not a value, so
the script is decoded with `devalue.unflatten` and never read by regex. Its key
`@inox-tools/request-nanostores:assets` is the catalogue, one entry per instrument —
`{id, status, type, details: {isin?, maturityDate?, prices, returnRates?, paymentSchedule}}`.

- **The site reduces URLs itself**, as `["URL", <index>]`, where devalue's built-in `URL` type reads
  a string — so the decode passes a `URL` reviver that returns the value untouched.
- **`paymentSchedule` is present on every entry and EMPTY on every entry.** A count of the key
  finds one per instrument and proves nothing.
- **Funds carry a core `id` and nothing else** — no slug, no title. The asset feed published each
  fund's `id` beside its `slug`, the only record pairing the two (`/api/funds` numbers funds in a
  `fundID` space of its own), and `FUND_SLUGS` in `packages/core/src/inzhur/offer-page.ts` holds
  those pairs. A fund's own offer page names its id too, as `assetId` in its island props.
- **Bonds carry `nav: 0`**, as they did in the feed, so a parser that ratios across the catalogue
  divides by it.

## The schedules sit in an island's props

The `OffersWelcome` island's `props` attribute carries each bond's schedule, under
`data.Sections[].bondSegments.data[].attributes`: the ISIN at `asset.data.attributes.isin`, beside
`paymentSchedule: [{id, date, amount}]` — amounts in kopecks as strings, dates as instants. The
encoding is Astro's, not devalue's: every value is a `[type, value]` pair (`PROP_TYPE` in astro's
`runtime/server/serialize.ts`), 0 for a value or an object of pairs and 1 for an array, inside an
HTML-escaped attribute. Read by the day in Kyiv time, as the feed's dates are, each schedule is the
one the feed served.

## Cross-checks

| | ВЧА на сертифікат | Вартість активів фонду | Сертифікатів в обігу |
|---|---|---|---|
| `inzhur-reit` | 10.9975 ₴ | 6 349 854 721 ₴ | 565 596 561 |
| `inzhur-energy` | 6 589.0098 ₴ | 1 161 530 519 ₴ | — |

**Do not divide assets by certificates to check NAV** — *ВЧА* is net of liabilities and *Вартість
активів фонду* is gross, so the ~2 % gap reads like a parse error when it is a balance sheet.
Quarterly «Довідка ВЧА» PDFs, linked from each offer page, are the anchor points a parse of the
daily series must agree with at quarter end — only where a published file overlaps one, which for
Energy means 2024-11-14 onward:

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

Fetching them automatically is allowed — the links sit on an allowed page and the CDN is a separate
origin with **no `robots.txt` at all** (`404 NoSuchKey`); `/documents` is not the path used. **The
filename carries a content hash, so polling these URLs signals nothing forever** — re-read the offer
page for the current link, and take the cut from `Last-Modified` rather than the name, which is not
uniformly formed (the dividend file is `…_dividendi_28_07_…`, no year). The importer
(`importFundHistory` in `infra/src/capture.ts`) takes the single `czina` link on each offer page and
never the `dividendi` one; two price links, or none, stop it.

`https://www.inzhur.reit/robots.txt` allows `/` and disallows `/dashboard/`, `/signin/`,
`/signup/`, `/documents`, `/terms`, `/privacy-policy`, `/fund_merger_report`,
`/annual_report_2025` — offer pages and `/api/` are not disallowed. The wider external source
map is in [`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md).

The asset feed the capture read, `GET /_api/assets`, answers `302 Found` with
`location: /dashboard/_api/assets` — a disallowed path, so the capture refuses the feed rather than
follow it ([`DECISIONS.md`](../DECISIONS.md), *External sources*).
The capture reads `/offer/ovdp` in its place. The API host the pages name, `api.inzhur.reit`,
publishes no `robots.txt`, but none of the conventional OpenAPI or versioned paths under its `/core`
answers.
