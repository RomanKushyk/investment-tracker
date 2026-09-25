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
Quarterly «Довідка ВЧА» PDFs, listed with the price files in each fund's document category, give the
ВЧА per certificate struck at each quarter end (Таблиця 2, row 13), and **it is not the daily
series' value that day**: no price file carries it on its quarter end, and Energy's carried it once,
the day after. Close as the two stay, a report bounds a parse of the daily series coarsely and
never checks its digits (`infra/src/fund-history.local.test.ts` pins every report the files span).
They are scans under an unreadable text layer, so reading one takes rendering the page:

| Fund | Quarters linked |
|---|---|
| `inzhur-reit` | 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |
| `inzhur-energy` | 30.09.2024 · 31.12.2024 · 31.03.2025 · 30.06.2025 · 30.09.2025 · 31.12.2025 · 31.03.2026 · 30.06.2026 |

**No exchange-priced series exists for any of the FUNDS** — all ten return
`UkrainianStockExchange: false`, so the ПФТС tables in
[`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md) §4 cannot price them; НБУ fair value
(`nbu_fv`) remains the bonds' separate basis.

## Fetching the files

**Listed by the provider's CMS, not in the offer pages' HTML.** Each fund page's `Documents`
section, a Vue component inside the `DynamicZone` island, requests one document category from
`https://api.inzhur.reit/cms` (Strapi 4) once mounted: the first its `data` prop's `categoriesList`
names, `19` on `inzhur-reit`'s page and `18` on `inzhur-energy`'s. The list names other categories
too, the other fund's among them, fetched only when their tab is clicked:

```
GET https://api.inzhur.reit/cms/api/general-document-categories?filters[id]=19&populate[documents][populate][documents][fields][0]=date&populate[documents][populate][documents][populate][file][populate]=%2A&populate[documents][populate][documents][sort][0]=date%3ADESC&populate[fund][fields][0]=licenses
```

That is the component's own query, serialized by `qs` with `encodeValuesOnly`, so its brackets
travel raw. The answer is one category at `data[0]`; its documents are
`attributes.documents.data[]`, each with a `name` and its files newest first in
`attributes.documents[]` — the page's card and sub-cards, a signed copy's `.p7s` among them — each
file's URL at `file.data.attributes.url` on `d2zk2gr3fhkmim.cloudfront.net`. Among the fund's other
documents the category lists its price file, and REIT's a dividend file too:

```
Inzhur_REIT_czina_06_07_2026_346a256fc9.xlsx
Enerdzhi_czina_06_07_2026_2c553a3277.xlsx
Inzhur_REIT_dividendi_28_07_29bd9cd4a8.xlsx
```

Fetching them automatically is allowed — `api.inzhur.reit` and the CDN both answer `404` for
`robots.txt` (the CDN's is `NoSuchKey`), which RFC 9309 reads as no rule; `/documents` is not the
path used. **A cut uploaded anew lands at a new URL** — Strapi's `generateFileName` suffixes each
upload's name at random — **so polling an old URL does not find it**: re-read the category for the
current link, and take the cut from `Last-Modified` rather than the name, which is not uniformly
formed (the dividend file is `…_dividendi_28_07_…`, no year). The importer (`importFundHistory` in
`infra/src/capture.ts`) takes the single `czina` .xlsx in each category and never the `dividendi`
one; two price files, or none, stop it, and so does an answer that is not the one category it asked
for.

`https://www.inzhur.reit/robots.txt` allows `/` and disallows `/dashboard/`, `/signin/`,
`/signup/`, `/documents`, `/terms`, `/privacy-policy`, `/fund_merger_report`,
`/annual_report_2025` — offer pages and `/api/` are not disallowed. The wider external source
map is in [`MARKET-DATA-SOURCES.md`](MARKET-DATA-SOURCES.md).

The asset feed the capture read, `GET /_api/assets`, answers `302 Found` with
`location: /dashboard/_api/assets` — a disallowed path, so the capture refuses the feed rather than
follow it ([`DECISIONS.md`](../DECISIONS.md), *External sources*).
The capture reads `/offer/ovdp` in its place. The API host the pages name, `api.inzhur.reit`,
publishes no `robots.txt`, but none of the conventional OpenAPI or versioned paths under its `/core`
answers; its `/cms` is read only for the document lists above.
