# Ukrainian market data sources — what is machine-readable, and on what terms

Measured **2026-08-24**, no account used anywhere. Written because finding out
which of these exist at all was the expensive part, and because the most
authoritative host is misleading in two directions at once: `stockmarket.gov.ua`
answers `200` over five-year-old data, and answers `521` while being perfectly
healthy, depending on where you ask from.

**Egress matters here and is labelled per source.** Measurements were taken from
a non-Ukrainian network (Cloudflare edge `VIE`, Vienna) and, where that
disagreed, re-taken through a browser in Kyiv. **Nothing here was probed from
`eu-north-1`**, where our backend runs (`infra/README.md`) — so where this file
reasons about the daily job it is inferring from one non-Ukrainian egress to
another, and says so. Probe from the Lambda before depending on either result.

**Scope.** The *external* map only — what the market publishes about itself. Not
our archive (`infra/README.md`), and not the provider we already capture:
Inzhur's own public surface is in
[`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md).

## The one-line summary

**No Ukrainian investment company publishes a documented data API.** Of 47
companies surveyed, one serves an open working REST endpoint and it is
undocumented. Everything machine-readable sits one floor up — the regulator's
agency, the industry association, the exchange.

---

## 1. SMIDA — the live regulated-disclosure feed

Run by ДУ «Агентство з розвитку інфраструктури фондового ринку України»
(АРІФРУ), which is where НКЦПФР disclosure actually lands. `stockmarket.gov.ua`
says so on its own landing page.

```
GET https://smida.gov.ua/db/api/v1/feed-index.xml
```

Published **as open data under art. 10¹ of the Law on Access to Public
Information**, query grammar documented at `/db/api/v1`.

| Measured 2026-08-24 | |
|---|---|
| `size` | 158 264 → 158 268 over ~30 min (it advances) |
| coverage | `2019-02-21T13:51:02` → `2026-08-24T15:00:01` |
| freshness at read | **9 minutes** |
| page size | 1 000 (`limit`) |
| reachable from non-UA egress | **yes** — `200`, verified by curl and by browser |

Modifiers: `limit` (**`limit=0` returns the header only**, i.e. `time_max`
without a body — what a change-check would use *if* polling were cleared, which
it is not; see the box below), `idlast` (pagination, newest → oldest). Filters:
`edrpou`, `period` (`d` daily · `m` monthly · `q` quarterly · `y` yearly ·
`i` irregular), `date` (publication), `sdate` / `fdate` (report-period bounds).
Dates take one value or a comma range, `YYYY-MM-DD`. Verified: `?period=d&limit=3`
is honoured — the response echoes `limit="3"`.

Each `<item>` carries `id`, `timestamp`, `href` and `param` children `D_EDRPOU` /
`D_NAME`, plus `<signatures>` with **two `.p7s` qualified e-signatures**. `href`
points at the filing: `https://smida.gov.ua/files/feed/YYYY/MM/DD/<uuid>/report.xml`
(or `.pdf`).

Scale, from the SMIDA landing page: 8 472 registered subjects — 5 994 legal
entities and **2 478 funds** — 890 125 filings submitted, 158 435 published.

> ### D82 corrects a pinned decision here
>
> **D27** (`docs/decisions/D21-D40.md:416`) and
> [`../superpowers/specs/2026-08-04-data-model.md`](../superpowers/specs/2026-08-04-data-model.md)
> (line 241) both carry *"SMIDA's open-data API was retired 2021-06-30
> (verified: 404)"*. The measurement above contradicts it, and **D82 records the
> correction**: the retirement was `stockmarket.gov.ua`'s, whose trader and
> exchange endpoints stop on exactly that date (§2). D27's *ruling* is untouched —
> Inzhur's daily quote is still voluntary commercial disclosure, still not a NAV.
> Only the availability sentence changed.

> ### Permission is unresolved — O25, and it is deliberately not closed
>
> `smida.gov.ua/robots.txt` is `User-agent: *` / `Disallow: /` with **no
> carve-out for `/db/api/`**, while the same path is published as open data with
> a documented query grammar. The likely reading is that the blanket rule
> predates the API — but rule 6 below says a stated `Disallow` is final, and that
> rule cannot be applied to other people's sites and read past here.
>
> **Open as `PLAN-OPEN.md` O25**, answerable by one email to
> `help@smida.gov.ua`; the owner's note is that it is unlikely to be pursued.
> Nothing depends on it: the feed carries filings, not prices, so it would not
> shorten W15. **Until answered — read by hand when a question needs it, never on
> a schedule.**

## 2. stockmarket.gov.ua — a healthy host serving a frozen archive

Five endpoints, CC-BY via data.gov.ua. **All five answer `200` with a current
`timestamp` while the data behind them has stopped.** The status code tells you
nothing here; `time_max` does.

| Endpoint (`/api/v1/…`) | Coverage | Records |
|---|---|---|
| `issuer-report-index.xml` | 2013-02-19 → **2019-04-05** | 119 058 |
| `trader-report-index.xml` | 2013-01-10 → **2021-06-30** | 92 307 |
| `exchange-report-index.xml` | 2013-01-10 → **2021-06-30** | 11 871 |
| `agency-report-index.xml` | 2015-01-05 → **2021-06-22** | 1 338 |
| `mortgage-report-index.xml` | same order of magnitude | — |

Schema: `<index>` with `id_min` / `id_max` / `time_min` / `time_max` / `size` /
`idlast` / `limit=1000`, then `<item>` rows; detail at `<unit>-report-id<N>.xml`,
nesting `report → table → row → param`. The namespace URI
(`report-index.xsd`) 404s — it is not a fetchable schema.

Together with §1 the coverage is continuous: this archive runs to 2019/2021, the
SMIDA feed starts 2019-02-21.

> **Unreachable from our backend, so treat it as a manual-only source.** From a
> non-Ukrainian egress every request returns `HTTP 521`, including with full
> browser headers; from Kyiv it is fine. `521` is Cloudflare reporting that *the
> origin refused its edge* — not a bot block, which would be `403` or a
> challenge. Our daily job runs in `eu-north-1` — also non-Ukrainian, so **it
> should be expected to see 521 as well, though that was not probed from the
> Lambda**. Treat this archive as manual-only until it is: pull it from a
> Ukrainian network and commit the result rather than fetching at runtime.

## 3. UAIB — the only free NAV and unit-price table

Association of asset-management companies. The daily page is a plain GET; the
form POSTs and redirects straight back to it. Reachable from a non-UA egress.

```
GET https://www.uaib.com.ua/analituaib/daily-data?date=YYYY-MM-DD
GET https://www.uaib.com.ua/analituaib/publ-ici-week?date=YYYY-MM-DD
GET https://www.uaib.com.ua/api/company/funds?kua[]=<amc-id>      → JSON
GET https://www.uaib.com.ua/analituaib/fdynamic?kua[]=&funds[]=   → series, max 5 funds
```

Columns: Тікер · Назва фонду · Назва КУА · Поточна ВЧА фонду · Поточна кількість
ІС в обігу · **Поточна вартість сертифіката, грн** · Попередня вартість
сертифіката · Зміна за добу, %.

**The catch is coverage, not access.** On 2026-08-10 — the latest date the
datepicker offered, so roughly a two-week lag — exactly **two funds** had filed
daily: `ALBL` ВДПІФ «Альтус-збалансований» at 8 631,45 ₴ and `ALDP` ВДПІФ
«Альтус-Депозит» at 5 888,82 ₴, both under ТОВ «КУА „Альтус Ассетс Актівітіс“».
Most Ukrainian funds are closed or interval and file monthly or quarterly, so a
market-wide daily series does not exist to be built. This is consistent with D27:
daily publication is required only of open-ended funds.

**Terms:** reuse permitted, a link to `uaib.com.ua` mandatory — a hyperlink open
to indexing for online publications.

## 4. ПФТС — exchange prices, on a separate data host

`pfts.ua` is mostly prose; its "Підсумки торгів" and "Хід торгів" pages render no
server-side tables. The machine-readable layer is the host the ОВДП page pulls
into an iframe.

| `pfts.org.ua/tabdata/bs/…` | Columns |
|---|---|
| `list-pfts.html` | №, Тікер, **Код ISIN**, Вид ЦП, Список активів, **ЄДРПОУ / ЄДРІСІ**, Назва, Номінал, Дата включення, Ознака РР |
| `ex-course.html` | Код, Назва, **Середній курс**, Дата останнього розрахунку, Ринкова капіталізація, Ознака РР |
| `contract-period.html` | Дата, Ідентифікатор контракту, Код (тікер), **Ціна**, Валюта, Дохідність %, Обсяг шт., Обсяг |
| `eqnn-quotes.html` | Код паперу, Ринок, Bid і Offer as ціна без НКД + дохідність % річних, НКД, Погашення, Номінал, Валюта розрахунків, Останнє котирування |
| `canc-contract-period.html` · `pfts-members.html` | cancelled contracts; members with ЄДРПОУ and market-maker flag |

`list-pfts.html` hands over the **ЄДРІСІ code** — the fund identifier the
register itself only sells — and for a listed fund there is a price. It covers
**listed securities only**, a handful out of 2 478 funds.

**It cannot price our funds, and that is worth knowing.** All ten Inzhur funds
report `UkrainianStockExchange: false`, so none is listed. On the funds this
confirms D72's "the dealer quote exists nowhere else".

**The bonds are a different matter.** `eqnn-quotes.html` and
`contract-period.html` price ОВДП, which we hold — and those positions already
have a second basis in the archive's `nbu_fv` source. So for bonds this is a
possible *third* reading, not a missing first one.

> **Two open questions, deliberately not answered here.** The endpoint set was
> discovered because an unknown path under `/tabdata/bs/` returns a fallback page
> enumerating it, while `/tabdata/` itself returns `403` — i.e. the list came out
> of an error page, not a published index. And there is **no `robots.txt` on
> `pfts.org.ua` at all**, which by rule 6 below leaves permission neither granted
> nor restricted. So: **this section documents what exists, and does not endorse
> repeated fetching of it.** If ПФТС ever becomes a source we depend on, the
> permission question gets settled first, in writing, the same way SMIDA's does.

## 5. data.gov.ua — the CKAN catalogue

```
GET https://data.gov.ua/api/3/action/package_search?q=<term>&rows=<n>
```

Everything inspected carries `license_title: Creative Commons Attribution`
(`opendefinition.org/licenses/cc-by`) — the cleanest legal footing here. НБУ
datasets come as JSON and XML.

On 2026-08-24, `q=НКЦПФР` returned **13** datasets, including a `stockmarket_list`
XLSX dump and the Держреєстр випусків ЦП as CSV. The data-model spec records
**19** for the same publisher; the queries were not necessarily equivalent and no
attempt is made here to say which is right — count it again before relying on
either.

**Nothing for funds.** `q=ЄДРІСІ` and `q=спільного інвестування` both return
zero datasets.

## 6. Minfin — a paid FX API, and schema.org on the catalogue

`api.minfin.com.ua` is **currency rates only** — interbank, НБУ, banks, exchange
offices, card rates, auctions, current and historical by date — key in the URL
path, paid tariff. No investment or fund data, so not a source here beyond FX.

Separately: catalogue pages under `minfin.com.ua/ua/invest/company/` embed
schema.org JSON-LD of type `OnlineBusiness` with `aggregateRating` and full
review bodies, so the directory is harvestable without an API. Terms allow
copying **with a hyperlink** to `www.minfin.com.ua`. Treat it as untrusted input:
it contains a live test record (`invest-test`, "Інвестиція", carrying Minfin's
own address and phone) that has accumulated ratings.

---

## Closed, and why

| Source | State |
|---|---|
| **ЄДРІСІ** — register of collective investment institutions | Extract issued only on written application with proof of payment. **Zero datasets on data.gov.ua.** The fund register is not open data |
| **csd.ua** — Національний депозитарій | `robots.txt`: `User-agent: *` / `Disallow: /`, no exceptions. Its announced "API для емітентів" is a filing cabinet for issuers describing themselves, not a read channel |
| **ux.ua** — Українська біржа | Cloudflare bot protection: `403` from outside, and from Kyiv the challenge resolves into an error page. Unusable automatically, and the signal is unambiguous — **do not automate it** |
| **smida.gov.ua** HTML pages | `Disallow: /`; Googlebot permitted only `/db/prof/`. The API in §1 is a separate question, and an open one |
| **api.firekit.space** | No docs, no open endpoint; `robots.txt` disallows `/api/` |
| **binaryx.com** | `robots.txt` allows GPTBot on content and disallows `/api/` — a deliberate split worth copying |

## What companies say about reuse, machine-readably

A minority answered in `robots.txt` directly, and the answers point opposite
ways. **Read it first: one request, and for some of them it is the only place
they state a position at all.**

| Signal | Who |
|---|---|
| `search=yes, ai-input=yes, ai-train=yes` | `deniz-estate.com` — full permission |
| `search=yes, ai-train=no, use=reference` **plus named `Disallow` for ClaudeBot, CCBot, Bytespider, Amazonbot, Applebot-Extended** | `toloka.vc`, `ribasinvest.com` — explicit refusal |
| Cloudflare boilerplate comment only, no active directive | `bond.ua`, `btc-broker.com` — neither granted nor restricted, per the policy's own wording |

## Rules this leaves us with

1. **Prefer the regulator's agency over company sites** — SMIDA's feed and the
   CC-BY datasets pair a stated licence with a stable schema, which no company
   site here does. UAIB and Minfin state terms too (rule 5); what they lack is
   the schema stability, being HTML pages rather than a published contract.
   **SMIDA is not cleared for polling**: O25 has to be answered first. Its being
   alive (D82) and our being allowed to poll it are two different facts.
2. **Monitor `time_max`, not the status code.** stockmarket.gov.ua answers `200`
   with data from 2019–2021. Freshness is a field in the payload; assert on it.
3. **Probe from the network the code runs on.** A `521` from `eu-north-1` was a
   working service from Kyiv — and stockmarket.gov.ua is therefore manual-only
   for us, while SMIDA is reachable from both.
4. **Never merge bases.** Fund NAV, a dealer's buy/sell quote and НБУ fair value
   are three different definitions of "price" (D26, D27, and D74 for why the
   conversion is refused). Same-day divergence around 0.9 % looks like noise and
   is not.
5. **Attribution is a licence condition, not a courtesy.** stockmarket.gov.ua and
   everything in the CKAN catalogue are **CC-BY**; SMIDA's footer and UAIB and
   Minfin all require a link. Every source in this file that permits reuse
   requires naming it — there is no exception to carve out.
6. **Read `robots.txt` before the first fetch.** A named `Disallow` or
   `ai-train=no` is final. **Silence is not consent** — under the Content Signals
   wording an operator who states nothing "neither grants nor restricts", which
   leaves the question open rather than settled in the collector's favour, and
   that applies to `pfts.org.ua` as much as to anyone.

## What this does NOT give

**A NAV or unit-price series for Ukrainian funds.** Structural, not accidental:
disclosure is retrievable as *documents* through SMIDA, the fund register is sold
per extract, UAIB's daily table covers two funds, and the exchange prices only
what is listed — which excludes every fund we hold. Any per-fund series still has
to be assembled provider by provider, which is why this project runs its own
archive (D72) and why
[`INZHUR-FUND-HISTORY.md`](INZHUR-FUND-HISTORY.md) had to derive what it derived.
