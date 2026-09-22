# W7's read surface — the server derives, the client renders

The working behind the ruling in `docs/DECISIONS.md`, *Cloud target*, which is what binds; the pinned
row `Derivation | 100% client-side` in [`2026-08-04-cloud-stack-and-cost.md`](2026-08-04-cloud-stack-and-cost.md)
is **superseded**. [#48](https://github.com/RomanKushyk/investment-tracker/issues/48)'s API contract
changes in one direction only: its `listAssets` / `listSnapshots` / `listTransactions` rows move from
`GET /state` to `/view` while `/state` narrows to export and import, and **the `POST /mutations` op
vocabulary does not move at all.** The owner's direction was three notes: per-screen endpoints but
`/dashboard`, `/allocation` and `/payouts` combined; minimum data on the client, ideally none; and
porting the derivation to the server makes sense.

**It is an import, not a port.** `infra/src/capture.ts` already imports `@quirenote/core/dates`,
`@quirenote/core/inzhur/parse` and `@quirenote/core/nbu/fair-value`, and the API Lambda imports
`@quirenote/core/derive`
the same way — **one implementation, one test suite, running server-side** — so the strongest
objection to server derivation, two answers for one number with nothing checking they agree, does not
arise. It would arise the moment anyone *reimplements* rather than imports, and that is the line this
spec draws. The screens are already shaped for it: every screen has a pure view-model module returning
typed rows, and **`/view`'s payload type is the union of those interfaces**, not a new vocabulary.

## §1 — The split is by SHAPE, not by screen, and it decides the endpoint count

| Surface | Shape | Derived vs the raw rows |
|---|---|---|
| KPIs — `TotalReturnKpi`, `netResult`, XIRR, `RebalancePlan` | a handful of numbers | **collapses** |
| `AllocationRow`, `YieldTableRow`, `attributes`, `portfolio`, `seasonality` | one row per asset, or per day/month | collapses |
| `YieldSeriesPoint` | `{ date, [assetId]: number }` — **one value per asset per date** | **same width as a snapshot** |
| `BalanceRow` | `{ date, cells[], cash, total }` — **one cell per asset per date** | **same width as a snapshot** |

**So "the server derives, so the response gets smaller" is true of the first two rows and false of the
last two**: at 20 assets over ten years of snapshots the yield curve is tens of thousands of numbers,
and shipping it for all six periods is not viable. That single measurement is what makes the read
surface **three endpoints rather than one**.

| Endpoint | Carries | Parameters |
|---|---|---|
| `GET /view` | **everything that collapses** — every KPI and every per-asset row set, for all 6 `PERIOD_OPTIONS` at once | none |
| `GET /view/series` | the yield curve — snapshot-shaped, so one period at a time | `period` |
| `GET /view/balances` | the Balances table — already paged client-side at 6 rows (`paginateSnapshots`) | `page` |
| `GET /state` | raw rows, **for export/import and nothing else** | none |
| `POST /mutations` | **unchanged** | `If-Match` |

**The three reads are ETag'd on `app_user.data_version` AND on what moves without a write** — the
day's capture and the day's rate both change a response while that counter stands still, so it cannot
be the validator alone. `POST /mutations` is the write and sends `If-Match` rather than carrying an
ETag, keeping #48's own asymmetry.

## §2 — Why `/view` takes no parameters

`PERIOD_OPTIONS` is six values (`@quirenote/core/period`) and currency is one multiplication, so `/view`
ships all six period blocks in ₴ with the rate beside them: a period change and a currency flip both
cost **zero requests**, and language and theme are presentation only. That is what keeps the
fluid-motion requirement intact, and it removes the cache-key combinatorics — an endpoint with no
parameters has one cache entry per user per `data_version`. The two parameterized endpoints pay a
request on period change and page change, which read as a chart or a table loading rather than the
whole app stalling.

## §3 — What the client stores, and why it is not zero

«Мінімум даних, а краще нічого» — the minimum is **one field**, and it is pre-network rather than a
preference: `theme`, because `index.html` reads it in a `<script>` that runs **before the module
bundle**, so a server round trip would paint the wrong theme first.

**`dataset` is not a second one, because the thing that pinned it locally is being retired.**
`src/lib/db.ts` resolves it synchronously at module init, before React exists, because it binds a
Dexie database — a constraint that holds only while there are two local databases to bind, and W7
retires the split along with IndexedDB and the dataset guards. The constraint dies with the thing that
created it, so `dataset` is an ordinary preference, and with the demo a public route a signed-out
visitor reaches there is nothing left for it to select.

**This is about SETTINGS.** The three durable `meta` keys — `inzhur:lastFetch`, `inzhur:lastParse`,
`nbu:lastRate` — stay per-device exactly as #48 §2 pins them; they are caches of provider payloads,
not preferences. Everything else durable in the settings object moves to the server and becomes
cross-browser, which is *Cloud target*'s stated priority rather than a bonus. `currency` moves nowhere
— flipping to `$` to read one KPI is not a preference and must not outlive the tab. And **`usdRate` is
stored NOWHERE**, on the owner's ruling: *"він потрібний лише в момент показу і може тягнутись (і
тягнеться) з API НБУ"*. Two things that collides with, neither a reason to refuse it — they are its
cost:

**1. `/view` CANNOT serve the rate from the archive.** The capture stores no FX column at all
(*The price archive*, and `infra/migrations/001_price_capture.sql` says so in capitals), and the rate
recoverable from `payload_gzip` by dividing `buyUAH / buyUSD` is **Inzhur's dealer conversion**, not
the NBU official rate this field displays — it is not even one rate, funds and bonds disagreeing in
the second decimal and jittering in the fourth. Substituting it would merge two bases, which the
archive's own rule forbids outright. So the rate is a live NBU fetch, and the owner ruled which side
fetches: the **server**. `/view` carries `fx`, the backend fetches bank.gov.ua and caches it for the
day, so one request serves every viewer and no browser depends on NBU's CORS policy. The cost, named
rather than hidden: a new outbound call in the backend, on a path that had none.

**2. It retires the propose-only rate contract, and the owner ruled to retire it.** Fetching from NBU
is manual-only and propose-only today — `useNbuRate.ts` produces a value in memory and only a press in
Settings ever stores it — so removing storage removes the user's ability to pin a rate. Raised as a
product change rather than a cleanup and ruled anyway: the rate is always the live NBU one, the Fetch
control goes with the field, and what is bought is that the displayed rate can never be last year's.

**The reach, because it is what an implementer scopes against.** Ten non-test files:
`state/settings.ts` (store field, default, `migrateSettings` validation, `partialize`),
`screens/Overview.tsx`, `screens/Settings.tsx` (the editable ₴/$ input and `setUsdRate`),
`settings/NbuRateFetch.tsx`, `settings/import-labels.ts`, `hooks/useCapitalCard.ts`,
`hooks/useBackupDownload.ts`, `settings/ImportDialog.tsx`, `core/types.ts` and `core/backup/json.ts`.
**The backup envelope is the one with a compatibility tail:** it carries `usdRate` today, so it drops
the field and the importer must accept an old backup that still has one and **ignore** the value — a
backup must not be able to pin last year's rate onto today's screen.

## §4 — What the client does before the first response

Today a Dexie read is local and instant; after W7 the first paint waits on the network, and **the
app has almost no load state at all.** Of the six non-test files carrying `isPending`, four are
mutation states — a disabled Save, a pending delete — while `Allocation.tsx` carries the identifier
only in a comment saying it deliberately does NOT use it. The single read case is
`useBackupDownload.ts`'s `exportAll.isPending`, the one precedent for what this section proposes.
Nothing renders a first-paint placeholder, because until W7 there is no first read to wait on.

**The ruling proposed: an explicit read-through CACHE of the last `/view` response, rendered
immediately and revalidated.** It is not client state and must never be treated as one — keyed by
`data_version` and replaced wholesale, never merged; never written by the app, only by a response;
never read for a mutation, an export, or any figure that must be correct, which all wait for the
network; and clearing it must be indistinguishable from a cold start. That satisfies «нічого на
клієнті» in the sense that matters, **nothing authoritative**, while keeping a repeat visit instant.
The alternative is a skeleton on every load, a visible regression from what the app does today.

## §5 — The demo lives on the server, and it is OWNED

W8's issue ([#55](https://github.com/RomanKushyk/investment-tracker/issues/55)) already ruled it:
**the seeded demo lives in the database as ONE original and only the super-admin owns it** — an
ordinary user may play with it and their changes never reach it. So there is **no second repository
implementation**: one HTTP repository, and the demo is a row set with an owner rather than a fixture
the client materialises.

What this spec adds is only the read surface: the demo original is readable **without an account**
([#5](https://github.com/RomanKushyk/investment-tracker/issues/5) asks for a public `/demo/...` route
in place of today's toggle), which makes it a **third auth policy** beside #48's two — and policies
must not share a response.

| Read | Auth | Cacheable by an intermediary |
|---|---|---|
| archive prices | public, global | yes, long |
| **demo `/view`** | **public, one owner's rows** | **yes — it is one portfolio, not per-viewer** |
| a user's `/view` | private, per-user | **never** |

The demo's `/view` is the cheapest read in the system — one portfolio, the same bytes for every
visitor — and it must be served by a route that cannot be confused with the private one. Four things
this spec does not settle, because W8 reserved them: the play copy's scope, how a reset back to the
original is offered, whether the copy survives a sign-out on the same device, and whether it lives in
the same store as `live` or beside it.

## §6 — What this spec does NOT decide

- **Deletion.** `asset.delete` cascade semantics are *User schema and deletes*'; nothing here picks or
  depends on them.
- **The `/view` payload's field-by-field schema.** §1 pins that it is the union of the existing
  view-model interfaces; the exact JSON, its versioning and its migration story belong to W7's
  implementation task.
- **Where `derive.ts` lives.** Settled since: it and the eight view-model modules the `/view` union
  needs are in `packages/core`, the workspace package both sides import, and `CLAUDE.md`'s fifth gate
  names that directory rather than the eight files it used to enumerate (*Core is pure*).
- **W8's admin surface.** §5 cites W8's demo-ownership ruling because the read surface has to serve
  it; W8's own admin reads are untouched here.
