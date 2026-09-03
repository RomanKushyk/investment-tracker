# Ukrainian market data sources — what is machine-readable, and on what terms

**No Ukrainian investment company publishes a documented data API.** Everything
machine-readable sits one floor up — the regulator's agency, the industry association, the
exchange. Not covered here: our own archive (`infra/README.md`), Inzhur's public surface
([`INZHUR-PUBLIC-SURFACE.md`](INZHUR-PUBLIC-SURFACE.md)), and its price files
([`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md)).

**Egress matters and is labelled per source** — reachability differs between a non-Ukrainian
network and a Ukrainian one. Nothing here has been probed from `eu-north-1`; probe from the
Lambda before depending on a reachability claim.

## 1. SMIDA — the live regulated-disclosure feed

```
GET https://smida.gov.ua/db/api/v1/feed-index.xml
```

Run by ДУ «Агентство з розвитку інфраструктури фондового ринку України» (АРІФРУ). Documented
query grammar at `/db/api/v1` — filters include `edrpou`, `period` (`d`/`m`/`q`/`y`/`i`) and
`date`/`sdate`/`fdate` ranges; modifiers `limit` (`limit=0` returns the header only) and
`idlast` (pagination) — `?period=d&limit=3` is honoured, echoing `limit="3"`. Each `<item>`
carries `id`, `timestamp`, `href`, `D_EDRPOU`, `D_NAME` and `<signatures>` with `.p7s`
signatures; `href` points at `https://smida.gov.ua/files/feed/YYYY/MM/DD/<uuid>/report.xml`.

**Our code does not fetch this feed, categorically, per the External sources decision.**
`smida.gov.ua/robots.txt` is `User-agent: *` / `Disallow: /` with no carve-out for `/db/api/`,
and a stated `Disallow` is final even where a statute licenses the use.

## 2. stockmarket.gov.ua — a healthy host serving a frozen archive

CC-BY via data.gov.ua.

| Endpoint (`/api/v1/…`) | Holds |
|---|---|
| `issuer-report-index.xml` | issuer disclosures |
| `trader-report-index.xml` | trader reports |
| `exchange-report-index.xml` | exchange reports |
| `agency-report-index.xml` | agency reports |
| `mortgage-report-index.xml` | mortgage reports |

Schema: `<index>` with `id_min` / `id_max` / `time_min` / `time_max` / `size` / `idlast` /
`limit=1000`, then `<item>` rows; detail at `<unit>-report-id<N>.xml`, nesting `report → table
→ row → param` (the namespace `report-index.xsd` 404s).

**All five endpoints answer `200` with a current `timestamp` while the underlying data has
stopped advancing — monitor `time_max`, not the status code.** Unreachable from our backend: a
non-Ukrainian egress gets `HTTP 521` (Cloudflare reporting the origin refused its edge, not a
bot block) while a Ukrainian one is fine. Treat this archive as manual-only: pull it from a
Ukrainian network and commit the result rather than fetching at runtime.

## 3. UAIB — the only free NAV and unit-price table

Association of asset-management companies. The daily page is a plain GET, reachable from a
non-UA egress.

```
GET https://www.uaib.com.ua/analituaib/daily-data?date=YYYY-MM-DD
GET https://www.uaib.com.ua/analituaib/publ-ici-week?date=YYYY-MM-DD
GET https://www.uaib.com.ua/api/company/funds?kua[]=<amc-id>      → JSON
GET https://www.uaib.com.ua/analituaib/fdynamic?kua[]=&funds[]=   → series, max 5 funds
```

Columns: Тікер · Назва фонду · Назва КУА · Поточна ВЧА фонду · Поточна кількість ІС в обігу ·
**Поточна вартість сертифіката, грн** · Попередня вартість сертифіката · Зміна за добу, %.

**The catch is coverage, not access** — most funds are closed or interval and file monthly or
quarterly, not daily, so no market-wide daily series exists.

**Terms:** reuse permitted, a link to `uaib.com.ua` mandatory.

## 4. ПФТС — exchange prices, on a separate data host

`pfts.ua` renders no server-side tables; the machine-readable layer is a separate host.

| `pfts.org.ua/tabdata/bs/…` | Columns |
|---|---|
| `list-pfts.html` | №, Тікер, **Код ISIN**, Вид ЦП, Список активів, **ЄДРПОУ / ЄДРІСІ**, Назва, Номінал, Дата включення, Ознака РР |
| `ex-course.html` | Код, Назва, **Середній курс**, Дата останнього розрахунку, Ринкова капіталізація, Ознака РР |
| `contract-period.html` | Дата, Ідентифікатор контракту, Код (тікер), **Ціна**, Валюта, Дохідність %, Обсяг шт., Обсяг |
| `eqnn-quotes.html` | Код паперу, Ринок, Bid і Offer as ціна без НКД + дохідність % річних, НКД, Погашення, Номінал, Валюта розрахунків, Останнє котирування |
| `canc-contract-period.html` · `pfts-members.html` | cancelled contracts; members with ЄДРПОУ and market-maker flag |

Covers **listed securities only** — none of our funds are listed, confirming the dealer quote
exists nowhere else. `eqnn-quotes.html` / `contract-period.html` price ОВДП, a third possible
reading alongside the archive's NBU-fair-value basis. **No `robots.txt` exists on
`pfts.org.ua`** — permission neither granted nor restricted.

## 5. data.gov.ua — the CKAN catalogue

```
GET https://data.gov.ua/api/3/action/package_search?q=<term>&rows=<n>
```

Everything inspected carries `license_title: Creative Commons Attribution`
(`opendefinition.org/licenses/cc-by`); НБУ datasets come as JSON and XML. **Nothing for funds**
— `q=ЄДРІСІ` returns zero datasets.

## 6. Minfin — a paid FX API, and schema.org on the catalogue

`api.minfin.com.ua` is **currency rates only** — interbank, НБУ, banks and exchange rates, key
in the URL path, paid tariff. No investment or fund data.

Catalogue pages under `minfin.com.ua/ua/invest/company/` embed schema.org JSON-LD of type
`OnlineBusiness` with `aggregateRating`, harvestable without an API. Terms allow copying **with
a hyperlink** to `www.minfin.com.ua`. Treat it as untrusted input — it carries at least one
live test record.

## Closed, and why

| Source | State |
|---|---|
| **ЄДРІСІ** — register of collective investment institutions | Extract issued only on written application with proof of payment. Zero datasets on data.gov.ua |
| **csd.ua** — Національний депозитарій | `robots.txt`: `User-agent: *` / `Disallow: /`, no exceptions |
| **ux.ua** — Українська біржа | Cloudflare bot protection: `403` from outside; do not automate it |
| **smida.gov.ua** HTML pages | `Disallow: /`; Googlebot permitted only `/db/prof/` |
| **api.firekit.space** | No docs, no open endpoint; `robots.txt` disallows `/api/` |
| **binaryx.com** | `robots.txt` allows GPTBot on content and disallows `/api/` |

## What companies say about reuse, machine-readably

| Signal | Who |
|---|---|
| `search=yes, ai-input=yes, ai-train=yes` | `deniz-estate.com` — full permission |
| `search=yes, ai-train=no, use=reference` plus named `Disallow` for ClaudeBot, CCBot, Bytespider, Amazonbot, Applebot-Extended | `toloka.vc`, `ribasinvest.com` — explicit refusal |
| Cloudflare boilerplate comment only, no active directive | `bond.ua`, `btc-broker.com` — neither granted nor restricted |

## Rules this leaves us with

1. **Prefer the regulator's agency over company sites** — SMIDA's feed and the
   CC-BY datasets pair a stated licence with a stable schema; SMIDA itself is not polled, by
   ruling (External sources decision).
2. **Monitor `time_max`, not the status code.**
3. **Probe from the network the code runs on** — reachability differs by egress.
4. **Never merge bases** — fund NAV, a dealer's quote and НБУ fair value are
   three different definitions of "price" (The price archive decision).
5. **Attribution is a licence condition, not a courtesy** — every source here
   that permits reuse requires naming it.
6. **Read `robots.txt` before the first fetch** — a named `Disallow` or
   `ai-train=no` is final; silence "neither grants nor restricts" under the Content Signals
   wording.

## What this does NOT give

**A NAV or unit-price series for Ukrainian funds.** Disclosure is retrievable as *documents*
through SMIDA, the fund register is sold per extract, UAIB's daily table covers few funds, and
the exchange prices only what is listed — which excludes every fund we hold. Any per-fund
series has to be assembled provider by provider, which is why this project runs its own archive
(The price archive decision) and why [`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md) had to
derive what it derived.
