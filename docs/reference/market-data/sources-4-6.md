# Market data — sources 4 to 6

> Moved **verbatim** from [`../MARKET-DATA-SOURCES.md`](../MARKET-DATA-SOURCES.md) on 2026-08-26 (D95). ПФТС, data.gov.ua and Minfin: the exchange's data host, the CKAN catalogue, and a paid FX API. **Egress is labelled per source, and nothing here was probed from `eu-north-1`** — read the scope note in the index before acting on a reachability claim.

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

