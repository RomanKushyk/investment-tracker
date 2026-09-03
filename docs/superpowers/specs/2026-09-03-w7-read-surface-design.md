# W7's read surface — the server derives, the client renders

Drafted 2026-09-03, on the owner's direction of the same day, which superseded a
drafted ruling that re-affirmed client-side derivation. **This spec exists
because `PLAN-OPEN.md` O28 may not be answered without one** — the owner ruled
"спершу специфікація, потім рішення".

> **RULED 2026-09-03 as [`D136`](../../decisions/D136.md)**, which cites this
> file as its working. The pinned row `Derivation | 100% client-side` in
> [`2026-08-04-cloud-stack-and-cost.md`](2026-08-04-cloud-stack-and-cost.md) is
> **superseded**, not merely questioned. This document is the design; D136 is
> what binds. A53's
> [`W7-API-CONTRACT.md`](../../reference/W7-API-CONTRACT.md) **§1 IS changed by
> this document, in one direction only**: its rows 1–3 (`listAssets`,
> `listSnapshots`, `listTransactions`) map to `GET /state`, and here they move to
> `/view` while `/state` narrows to export and import. **The `POST /mutations`
> op vocabulary — rows 4–12, 16, 17 — does not move at all.**

## The direction being specified

The owner's, 2026-09-03, in three notes:

1. per-screen endpoints, **but `/dashboard`, `/allocation`, `/payouts` combined**;
2. **minimum data on the client, ideally none**;
3. **porting the derivation to the server makes sense**.

## What makes this cheap, and it is not a port

`infra/src/capture.ts:19,23,27` already **imports** `src/core/dates`,
`src/core/inzhur/parse` and `src/core/nbu/fair-value`. The API Lambda imports
`src/core/derive.ts` the same way. **One implementation, one test suite, running
server-side** — so the strongest objection to server derivation (two answers for
one number, with nothing checking they agree) does not arise. It would arise the
moment anyone *reimplements* rather than imports, and that is the line this spec
draws.

The screens are already shaped for it. Every screen has a pure view-model module
— `overview.ts`, `allocation.ts`, `yield.ts`, `payouts.ts`, `portfolio.ts`,
`balances.ts`, `attributes.ts`, `seasonality.ts` — returning typed rows
(`TotalReturnKpi`, `AllocationRow`, `RebalancePlan`, `YieldTableRow`,
`PayoutRow`, `BalanceRow`, `YieldSeriesPoint`). **`/view`'s payload type is the
union of those interfaces**, not a new vocabulary.

## §1 — The split is by SHAPE, not by screen

Measured 2026-09-03, and it is what decides the endpoint count.

| Surface | Shape | Derived vs the raw rows |
|---|---|---|
| KPIs — `TotalReturnKpi`, `netResult`, XIRR, `RebalancePlan`, `ledgerDriftChip` | a handful of numbers | **collapses** |
| `AllocationRow`, `YieldTableRow`, `attributes`, `portfolio`, `seasonality` | one row per asset, or per day/month | ~20–31 rows |
| `YieldSeriesPoint` | `{ date, [assetId]: number }` — **one value per asset per date** | **same width as a snapshot** |
| `BalanceRow` | `{ date, cells[], cash, total }` — **one cell per asset per date** | **same width as a snapshot** |

**So "the server derives, so the response gets smaller" is true of the first two
rows and false of the last two.** At 20 assets × 3 650 snapshots the yield curve
is ~73 000 numbers; shipping it for all six periods is not viable. That single
measurement is what makes the read surface **three endpoints rather than one**
— `/view` plus the two snapshot-shaped ones below — and it is the correction to
this session's own earlier claim that the response uniformly shrinks.

| Endpoint | Carries | Parameters |
|---|---|---|
| `GET /view` | **everything that collapses** — every KPI and every per-asset row set, **for all 6 `PERIOD_OPTIONS` at once**, in ₴ plus `fx`, the live NBU rate the server fetches (§3 — **not** from the archive, which has none) | **none** |
| `GET /view/series` | the yield curve — snapshot-shaped, so one period at a time | `period` |
| `GET /view/balances` | the Balances table — already paged client-side at 6 rows (`paginateSnapshots`) | `page` |
| `GET /state` | raw rows, **for export/import and nothing else** (A53 row 15) | none |
| `POST /mutations` | **unchanged** — A53 §1's op vocabulary does not move | `If-Match` |

`/dashboard`, `/allocation` and `/payouts` are combined into `/view`, as the
owner asked. **The three reads are ETag'd on `app_user.data_version`**, which A53 already
pins as one column on one row; `POST /mutations` is the write and **sends
`If-Match`** rather than carrying an ETag — A53's own asymmetry, kept.

## §2 — Why no query parameters on `/view`, and what it buys

`PERIOD_OPTIONS` is **six** values (`src/core/period.ts:24`) and currency is
**one multiplication**. So `/view` ships all six period blocks in ₴ with the
rate beside them, and:

| Control | Cost after W7 |
|---|---|
| period (6 options) | **0 requests** — the client picks a block |
| currency ₴/$ | **0 requests** — the client multiplies |
| language, theme | presentation only |

This is what keeps the "fluid, soft motion on every interaction" requirement
intact, and it removes the cache-key combinatorics that the original four-tier
direction flagged: an endpoint with no parameters has one cache entry per user
per `data_version`.

The two parameterized endpoints pay a request on period change and page change
— both already read as a chart or table loading, not as the whole app stalling.

## §3 — What the client stores, and why it is not zero

«Мінімум даних, а краще нічого» — the minimum is **one field**, and it is
pre-network rather than a preference.

| Field | Stays client | Why |
|---|---|---|
| `theme` | **yes, and it is the only one** | `index.html:27` reads it in a `<script>` that runs **before the module bundle**, so the first paint is already correct. A round-trip here is a white flash on every load |

**`dataset` MOVES, and this spec's first draft was wrong to keep it.** The draft
argued it cannot: `src/lib/db.ts:64` resolves it synchronously at module init,
before React exists, because it **binds a Dexie database**. That reasoning holds
only while there are two local databases to bind — and
[`phase-w-i-ii-iii.md`](../../plans/phase-w-i-ii-iii.md) says W7 *"retires D2
(IndexedDB), D16/G4 (demo+live split) and the dataset guards"*. **The constraint
dies with the thing that created it**, so `dataset` is an ordinary preference
and goes to the server with the rest.

**This is about SETTINGS, and A53 §2 is untouched.** The three durable `meta`
keys — `inzhur:lastFetch`, `inzhur:lastParse`, `nbu:lastRate` — stay per-device
exactly as `W7-API-CONTRACT.md` §2 pins them (*"None of them becomes server
state"*). They are caches of provider payloads, not preferences, and nothing
here supersedes that.

Everything else durable in the settings object moves to the server, where it
becomes cross-browser — which is [D92](../../decisions/D92.md)'s stated priority
rather than a bonus:
`defaultCurrency`, `language`, `period`, `autoQuoteSuggest`, `couponSuggest`,
`remindersEnabled`, `reminderLeadDays`, `dismissedReminders`,
`collapsedNavGroups`. **`usdRate` is deliberately absent from that list** — it
goes nowhere, and the next block is why.

**`currency` moves nowhere** — it is session-only today by an explicit ruling
(A21: *flipping to `$` to read one KPI is not a preference and must not outlive
the tab*), and that is untouched.

**`usdRate` is stored NOWHERE — owner's ruling, 2026-09-03**: *"він потрібний
лише в момент показу і може тягнутись (і тягнеться) з API НБУ"*. It stops being
a setting.

**Two things the ruling collides with, both verified 2026-09-03, and neither is
a reason to refuse it — they are its cost.**

**1. `/view` CANNOT serve the rate from the archive.** This spec's first draft
said the backend already captures FX and cited D30. **D30 is superseded on
exactly that point by [D69](../../decisions/D69.md)** (`amends: [D30]`, *"the
provider's FX rate is not stored at all"*), and
`infra/migrations/001_price_capture.sql:101` says so in capitals — *"THERE IS
DELIBERATELY NO FX COLUMN HERE … Do not add it."* Worse, the rate recoverable
from `payload_gzip` by dividing `buyUAH / buyUSD` is **Inzhur's dealer
conversion**, not the NBU official rate this field displays; D69 records that it
is **not one rate** (funds 44.7579 against bonds 44.8305, re-measured 44.8086 /
44.8568) and **not exact** (jitter in the fourth decimal). Substituting it would
merge two bases, which `CLAUDE.md` and D26/D27 forbid outright. **So the rate is a live NBU fetch — and the owner ruled which side makes it,
2026-09-03: the SERVER.** `/view` carries `fx`, the backend fetches
bank.gov.ua and caches it for the day, so one request serves every viewer and
no browser depends on NBU's CORS policy. The cost is named rather than hidden:
**a new outbound call in the backend**, on a path that had none.

**2. It retires a pinned contract — put to the owner, and RULED: retire it.**
«Тягнеться з API НБУ» is true and is **manual-only and propose-only**.
`useNbuRate.ts:5`: *"Nothing here writes settings. A fetch produces a value in
memory; only the user's press in Settings ever stores it"*; `NbuRateFetch.tsx:3`
pins A5/G5: *"It PROPOSES … `usdRate` stays exactly what it was — a manual
override the user owns."*

So removing storage **removes the user's ability to pin a rate**. That was
raised as a product change rather than a cleanup, and the owner ruled it
anyway, 2026-09-03: **the rate is always the live NBU one.** A5/G5's
propose-only contract is retired, and the Fetch control goes with the field —
there is nothing left for it to propose to. **What is bought is that the
displayed rate can never be last year's**; what is given up is the override.

**The reach, stated accurately because it is what an implementer scopes
against.** Ten non-test files, not the five the first draft named:
`state/settings.ts` (store field, default, `migrateSettings` validation,
`partialize` — 12 references), `screens/Overview.tsx` (10),
`screens/Settings.tsx` (the editable ₴/$ input and `setUsdRate`),
`settings/NbuRateFetch.tsx`, `settings/import-labels.ts`,
`hooks/useCapitalCard.ts`, `hooks/useBackupDownload.ts`,
`settings/ImportDialog.tsx`, `core/types.ts` and `core/backup/json.ts:221`.

**The backup envelope is the one with a compatibility tail:** it carries
`usdRate` today, so it drops the field and **the importer must accept an old
backup that still has one and ignore the value** rather than restore it — a
backup should not be able to pin last year's rate onto today's screen.

## §4 — What the client does before the first response

Today a Dexie read is local and instant. After W7 the first paint waits on the
network, and **the app has almost no load state at all.** Measured 2026-09-03,
the six non-test files carrying `isPending` are `TransactionPanel.tsx`,
`AssetDialogs.tsx`, `useAssetDialogs.ts`, `DangerZone.tsx`,
`useBackupDownload.ts` and `Allocation.tsx` — and five are **mutation** states
(a disabled Save, a pending delete). Two qualifications, because the first draft
of this line got both wrong: `Allocation.tsx` carries the identifier only in a
comment explaining that it deliberately does **not** use `updateAsset.isPending`;
and `useBackupDownload.ts`'s `exportAll.isPending` is a **read** — the single
existing case of the app waiting on one, and the one precedent for what §4
proposes. Nothing renders a first-paint placeholder, because until W7 there is
no first read to wait on.

**The ruling this spec proposes: an explicit read-through CACHE of the last
`/view` response, rendered immediately and revalidated.** It is not client
state and must never be treated as one:

- it is keyed by `data_version` and replaced wholesale, never merged;
- it is never written by the app, only by a response;
- it is never read for a mutation, an export, or any figure that must be
  correct — those wait for the network;
- clearing it must be indistinguishable from a cold start.

That satisfies «нічого на клієнті» in the sense that matters — **nothing
authoritative** — while keeping a repeat visit instant. The alternative is a
skeleton on every load, which is a visible regression from what the app does
today.

## §5 — The demo lives on the server, and it is OWNED

**This spec's first draft said the demo stays entirely local. That was wrong,
and it was already ruled otherwise** — the correction is the owner's, and the
ruling it restores is
[`phase-w-i-ii-iii.md`](../../plans/phase-w-i-ii-iii.md)'s W8 section, owner
2026-09-01:

> **THE DEMO PORTFOLIO IS OWNED, AND ONLY THE SUPER-ADMIN OWNS IT.** The seeded
> demo lives in the database as ONE original. […] An ordinary user may play with
> it, and their changes never reach it.

So there is **no second repository implementation**. W7 *"retires D2
(IndexedDB), D16/G4 (demo+live split) and the dataset guards"* — one HTTP
repository, and the demo is a row set with an owner rather than a fixture the
client materialises.

**What this spec adds, and it is only the read surface:** the demo original is
readable **without an account** — issue
[#5](https://github.com/RomanKushyk/investment-tracker/issues/5) asks for a
public `/demo/...` route in place of today's toggle, *"always public (no need
for registration)"*. That makes the demo a **third auth policy**, beside A53's
two, and A53's own rule is that policies must not share a response:

| Read | Auth | Cacheable by an intermediary |
|---|---|---|
| archive prices | public, global | yes, long |
| **demo `/view`** | **public, one owner's rows** | **yes — it is one portfolio, not per-viewer** |
| a user's `/view` | private, per-user | **never** |

The demo's `/view` is the cheapest read in the system — one portfolio, the same
bytes for every visitor — and it must be served by a route that cannot be
confused with the private one.

**Three things this spec does NOT settle, because W8 already reserved them**:
the play copy's scope (device or session), how a reset back to the original is
offered, and whether the copy lives in the same store as `live` or beside it.
W8 says in terms that *what matters is the guarantee, not the storage* — two
visitors see the same starting portfolio, neither can move the other's, neither
can move the original.

## §6 — What this spec does NOT decide

- **O33, deletion.** `asset.delete` cascade semantics are still O33's, and
  nothing here picks one.
- **The `/view` payload's field-by-field schema.** §1 pins that it is the union
  of the existing view-model interfaces; the exact JSON, its versioning and its
  migration story belong to W7's implementation task.
- **Whether `src/core/derive.ts` stays in `src/`.** It is imported from
  `infra/` the way four modules already are, and moving it is a refactor no one
  has asked for. **But `CLAUDE.md`'s shared-files rule does NOT already cover
  this, and the first draft of this bullet said it did.** That rule enumerates
  exactly eight files — `core/types.ts`, `dates.ts`, `ovdp.ts`,
  `inzhur/{parse,dcf,ref}.ts`, `nbu/{date,fair-value}.ts` — and `derive.ts` is
  not among them, nor are `accrual.ts`, `period.ts`, `xirr.ts` or the eight
  `src/screens/*/` view-model modules the `/view` union needs. The
  `pnpm exec tsc --noEmit -p infra` gate is keyed to that enumeration, so
  **server derivation amends the rule by roughly a dozen files** — an amendment
  W7's implementation task owes, not one this spec makes.
- **W8's admin surface.** §5 cites W8's demo-ownership ruling because the read
  surface has to serve it; W8's own admin READS — the per-request aggregates —
  are untouched here, and so are the three implementation questions W8
  reserved about the play copy.
