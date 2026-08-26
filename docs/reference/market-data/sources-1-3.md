# Market data — sources 1 to 3

> Moved **verbatim** from [`../MARKET-DATA-SOURCES.md`](../MARKET-DATA-SOURCES.md) on 2026-08-26 (D95). SMIDA, stockmarket.gov.ua and UAIB: the regulator's agency, the frozen archive that answers `200`, and the only free NAV table. **One path was re-pointed on the move** — the `data-model.md` link in §1 gained a `../` and nothing else changed. **Egress is labelled per source, and nothing here was probed from `eu-north-1`** — read the scope note in the index before acting on a reachability claim.

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
> **D27** (`docs/decisions/D27.md`) and
> [`../../superpowers/specs/2026-08-04-data-model.md`](../../superpowers/specs/2026-08-04-data-model.md)
> (line 241) both carry *"SMIDA's open-data API was retired 2021-06-30
> (verified: 404)"*. The measurement above contradicts it, and **D82 records the
> correction**: the retirement was `stockmarket.gov.ua`'s, whose trader and
> exchange endpoints stop on exactly that date (§2). D27's *ruling* is untouched —
> Inzhur's daily quote is still voluntary commercial disclosure, still not a NAV.
> Only the availability sentence changed.

> ### Permission is SETTLED — D86: we do not fetch this. O25 closed 2026-08-24
>
> `smida.gov.ua/robots.txt` is `User-agent: *` / `Disallow: /` with **no
> carve-out for `/db/api/`**, while the same path is published as open data with
> a documented query grammar. **The rule does NOT predate the API** — the file
> was absent (`404`) from 2020-07 to 2021-11-06, the API launched inside that
> gap, and the file returned carrying a `/db/` rule. Rule 6 below says a stated
> `Disallow` is final, and it cannot be applied to other people's sites and read
> past here.
>
> **RULED: our code does not fetch it, categorically — D86.** The email was
> never owed: the Wayback history shows the file was rewritten into a targeted
> `/db/` rule AFTER the API shipped (2022–mid-2024) and then tightened back to
> blanket, so the "the rule predates the API" reading above is measurably wrong
> and is left standing only as the question that was asked. D86 carries the whole
> analysis — the statute licenses USE and not retrieval, RFC 9309's "not access
> authorization" is a warning to operators, there is no alternative licensed
> route, and the benefits are listed in full so the cost is not re-argued.
> **Reading a page by hand is not what this governs; our code fetching it is.**

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

