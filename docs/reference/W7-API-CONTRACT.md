# W7 — the API contract, on paper

> **A53.** Written before W7 so its design session starts from an inventory
> rather than an excavation. Nothing here is built yet. **The column it left
> undecided — O28, the derivation boundary — was ruled on 2026-09-03 by
> [D136](../decisions/D136.md), and rows 1–3 of §1 moved with it**: the three
> list reads become `GET /view`, not `GET /state`. The `POST /mutations` op
> vocabulary did not move. **O33 closed the same day as [D137](../decisions/D137.md) + [D138](../decisions/D138.md)** — D137 the shape, D138 the action; see §4, which now pins `asset.delete`'s semantics.
>
> Pinned elsewhere and assumed here: the auth shape (D32/D36/D38/D39), the
> user schema and its OCC rule ([`../../infra/schema/user.ts`](../../infra/schema/user.ts),
> A51), and the derivation boundary the spec still fixes client-side.

## 1. `repo`'s 17 methods, mapped

`src/lib/repository.ts` is the whole persistence surface the app has. It
becomes an HTTP client at W7, and this is what each method turns into.

> **THIS WIDENS A PINNED SPEC ROW, and says so rather than doing it quietly.**
> `2026-08-04-cloud-stack-and-cost.md` pins `POST /mutations` as **one op** with
> `If-Match`; the table below makes it an op LIST. The reason is in rows 5 and
> 12 — two operations are not decomposable without a torn write — but the row
> stays binding until a decision says otherwise. The Derivation row was the
> other such annotation and is no longer one — [D136](../decisions/D136.md)
> **superseded** it. **This row is still annotated, not superseded.**

**Reads collapse into ONE request, writes into one op vocabulary.** Three list
calls that today hit three Dexie tables become a single read, because
every screen needs all three and three round-trips would buy nothing but
latency and a torn read — assets, snapshots and transactions must agree with
each other or `derive.ts` produces a figure from mismatched halves.

> **WHICH read changed on 2026-09-03 ([D136](../decisions/D136.md)).** The
> torn-read argument above is untouched and is in fact what the ruling leans
> on; what moved is the endpoint. Rows 1-3 are now **`GET /view`** — the
> server derives and ships the view model — with `/view/series?period` and
> `/view/balances?page` beside it for the two surfaces that do not collapse.
> **`GET /state` survives as export and import only.** The rows below are
> left as written so the change is visible rather than silent; read this
> block as amending their `Becomes` column.

| # | `repo` method | Becomes | Mutation op | Notes |
|---|---|---|---|---|
| 1 | `listAssets` | `GET /state` | — | one response, one `version` |
| 2 | `listSnapshots` | `GET /state` | — | with the above |
| 3 | `listTransactions` | `GET /state` | — | with the above |
| 4 | `saveSnapshot` | `POST /mutations` | `snapshot.put` | upsert by date |
| 5 | `recordTransaction` | `POST /mutations` | `transaction.add` **+ optional `asset.add`** | ONE op list, not two requests — the quick-create path creates the asset and the row that needs it together, and half of that landing is a transaction naming an asset that does not exist |
| 6 | `addAsset` | `POST /mutations` | `asset.add` | |
| 7 | `updateAsset` | `POST /mutations` | `asset.patch` | patch, not put — `assetPatchFromForm` already sends a subset |
| 8 | `deleteAsset` | `POST /mutations` | `asset.delete` | **This op carries the PORTFOLIO dialog across and creates no new surface** — `NEXT-PHASE-PLAN.md`'s pinned `deleteAsset` row keeps the method and forbids only a NEW dependent, and a delete control on W14's assets tab would be one (owner, 2026-09-03; [D138](../decisions/D138.md)). **cascade was O33's and is now [D137](../decisions/D137.md)'s** — batched, and **step 1 NULLS every settlement link into the asset** (an `UPDATE`, not a delete) before the transactions, then `user_price`, and the asset LAST — with **`ON DELETE RESTRICT`** keys beneath it ([D138](../decisions/D138.md) supersedes D137's action: the order is what makes it safe, and `RESTRICT` is the action D99 measured — **though only INLINE, never on the late `NOT VALID` key W7 emits, so D138 downgrades its own tiebreaker to *measured in a neighbouring shape against measured nowhere at all* and leaves W7 a probe**). The client hand-cascades today — **and that cascade is a live data-loss bug (issue #34):** it deletes by `assetId` rather than by type, so a pre-2026-09-02 deposit that borrowed an asset's id is destroyed with it. Do not port the semantics under O33's cover |
| 9 | `updateTransaction` | `POST /mutations` | `transaction.patch` | **THE ONLY UNVALIDATED WRITE PATH — put `transactionSchema` in front of it.** It takes a bare `Partial<Transaction>` with no schema, and D128's *every door is closed* table omits it only because the HOOK has no caller. Building this op without D124's rule reopens the count-less position-moving row |
| 10 | `deleteTransaction` | `POST /mutations` | `transaction.delete` | **The self-referential key reaches this op too, and D138 does not rule it — registered as `PLAN-OPEN.md` O36.** Deleting a payout that a `tax` row settles refuses `23503` under `RESTRICT` — a safe default, not an answer. Same class as the `account.delete` gap D138 names |
| 11 | `deleteSnapshot` | `POST /mutations` | `snapshot.delete` | by date |
| 12 | `moveSnapshotDate` | `POST /mutations` | `snapshot.move` | ONE op, not delete+put: the pair is not idempotent under retry, and a retried half leaves the day gone. **Keep the precondition** — the client throws if `to` already holds a snapshot (and if `from` holds none), so a server op without it silently overwrites a day's quotes |
| 13 | `getMeta` | — | — | **stays local, §2** |
| 14 | `setMeta` | — | — | **stays local, §2** |
| 15 | `exportAll` | `GET /state` | — | the same read; the backup envelope is assembled client-side, as it is now |
| 16 | `replaceAll` | `POST /mutations` | `dataset.replace` | one op carrying the whole envelope. It is the import, and the only op that REPLACES rather than adds or removes — the four deletes above remove, which is a different thing |
| 17 | `clearAll` | `POST /mutations` | `dataset.clear` | `{ reseed }` becomes a field, not a second endpoint |

### The concurrency rule, and it is A51's rather than a new one

**`data_version` is ONE column on ONE row per user** (`app_user`), not one per
table. A per-table version cannot implement a dataset-level `If-Match`, and
that row is already read on every request to resolve `user_id` and `role`, so
the check is free.

- `GET /state` returns `data_version` and sets `ETag`.
- `POST /mutations` sends `If-Match`. The server runs
  `UPDATE app_user SET data_version = data_version + 1 WHERE user_id = $1 AND data_version = $2`
  and **the ROWCOUNT is the conflict detector** — 0 rows means someone else
  wrote first, and the response is `409` with the current state so the client
  can re-derive rather than guess.
- **Retry on SQLSTATE 40001 is a DIFFERENT mechanism and must stay separate.**
  Serialization failure is DSQL telling us to run the same transaction again;
  a rowcount of 0 is the user being told their write is stale. Conflating them
  either retries a genuine conflict into a lost update, or surfaces a
  transient as a user-facing error.

### The dataset split is NOT modelled here, and that is a gap

`src/lib/db.ts` gives one Dexie database per dataset — `quirenote` and
`quirenote-live` (G4/D16) — and every `repo` method operates on whichever is
ambiently selected. **Nothing in the table above carries that**: `GET /state`
and the single `data_version` on `app_user` describe ONE dataset per user.

An implementer building only from this table drops the shipped `DatasetSwitch`,
or worse points `dataset.replace` / `dataset.clear` at the wrong one — and the
op names collide with the product's own `Dataset = 'demo' | 'live'` type, which
would make that confusion hard to see.

**It is left open rather than designed here**, because W8 already rules on what
the demo becomes after auth: the seeded demo is ONE original owned by the
super-admin, and an ordinary user gets a device- or session-scoped play copy.
Whether that makes a second dataset a server concept at all is W8's, not this
document's — but W7 cannot ship `GET /state` without answering it.

## 2. The `meta` keys, sorted — two stay local, two die

`meta` is a key-value table today with four keys in use. **None of them becomes
server state**, and the reasoning differs per key. **Two die rather than two:**
`seeded` with D2, and `nbu:lastRate` with [D136](../decisions/D136.md) — the
heading said three-stay-one-dies until 2026-09-03.

| Key | Written by | Fate |
|---|---|---|
| `inzhur:lastFetch` | `useInzhurAssets.ts` | **stays local.** A cache of the last provider payload, per device. Two devices fetching at different times is correct, not a conflict to resolve |
| `inzhur:lastParse` | `useInzhurAssets.ts` | **stays local**, same reason |
| `nbu:lastRate` | `useNbuRate.ts` | ~~**stays local.** The rate is a display convenience; a stale one on one device costs nothing and syncing it would put a provider read in the mutation path~~ **DIES 2026-09-03 ([D136](../decisions/D136.md)).** `usdRate` is stored nowhere, the SERVER fetches NBU, and `/view` carries `fx` — so this cache has nothing left to cache and `useNbuRate.ts` goes with it. **The old reasoning was not wrong and is kept struck through**: it argued against putting a provider read in the MUTATION path, and the ruling puts it on a READ instead |
| `seeded` | `db.ts`, `repository.ts` | **dies with D2.** It exists to stop the Dexie store re-seeding itself. After W7 there is no local store to seed, and the demo is a server-side row set with an owner (W8) |

So `getMeta`/`setMeta` do not become endpoints. They keep a local
implementation over whatever the client uses for per-device state, and the
methods stay on `repo` rather than being deleted — the callers do not care
where the value lives, which is the point of the interface.

## 3. The endpoint inventory

**Four are already specified elsewhere.** The admin surface is not, and that is
this section's real contribution: W8 is described as a screen and has never
been given an API.

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /state` | JWT, any `active` user | the whole dataset + `data_version`. `pending` gets a distinct response, not 401 |
| `POST /mutations` | JWT, `active` only | `If-Match`; the op list above |
| `POST /v1/applications` | **none** | sign-up as an application (D38/D39). Route throttling, unique index on email, no email on submission |
| `GET /v1/prices/{YYYY}.ndjson` | **none, ever** | the public archive. Sealed years serve `immutable` — **and therefore VERSION BY FILENAME** (`2026.v1.ndjson` behind a short-TTL manifest, W9). `immutable` cannot be retracted: a wrong price cached under it persists on every device forever, and a filename bump is the only escape. The path above is the shape, not the whole rule |
| `GET /admin/users` | `role = super_admin` | W8's table |
| `POST /admin/users/{id}/approve` · `/reject` · `DELETE` | `role = super_admin` | **approve is a COGNITO WRITE, not a status flip (D39):** it calls `AdminCreateUser`, which is where the MAU is spent and where the invitation — the only email in the flow — reaches the address's owner. An approve that only updates `status` leaves the user with no way to sign in. Delete is scoped to `pending`/`rejected` only; an `active` user owns a ledger, and that cascade is **NOT D137's** — D137 rules the ASSET cascade; deleting a USER has no holder and W8 owes it |
| `GET /admin/runs?limit=N` | `role = super_admin` | the capture journal, last N runs with errors |
| `GET /admin/missing-refs` | `role = super_admin` | A12's data — tracked refs absent from a published file |
| `POST /admin/sources/{source}/enabled` | `role = super_admin` | the source toggle. D35: a toggle is a setting, a field mapping is code |
| `POST /admin/capture/{asOf}` · `POST /admin/backfill` | `role = super_admin` | HTTP wrappers over the Lambda ops that exist today (`{asOf}`, `{backfill}`, `{observe}`) |

### Three rules that hold across every row above

- **The DATABASE COLUMNS are the authorization source, never `cognito:groups`.**
  Two of them, and conflating them gates the wrong thing: **`status`**
  (`pending | active | rejected`) decides whether a caller may act at all, and
  **`role`** (`user | super_admin`) decides whether they may reach `/admin/*`.
  Group membership is stamped into a token at issue time, so removing someone
  from a group would not take effect until the token refreshes; both columns are
  read on every request anyway.
- **Prices and user data never share a response, an auth policy, or a cache
  policy.** The archive is public, global and cacheable for a year; user data
  is private, per-user and must never be cached by an intermediary. One
  endpoint serving both is one misconfiguration away from serving one as the
  other.
- **The admin ops wrap the Lambda; they do not reimplement it.** `{asOf}`,
  `{backfill}` and `{observe}` already exist and are already the tested path.

## 4. What this document deliberately does not decide

- **~~O28 — the server-side derivation boundary.~~ CLOSED 2026-09-03 as
  [D136](../decisions/D136.md), and it went the OTHER way from how §1 draws it.**
  Every read above is written as "the server ships rows, the client derives";
  the ruling moves the derivation to the server. **`GET /state` gained two
  siblings rather than one** — `/view` (no parameters, all 6 periods) plus
  `/view/series?period` and `/view/balances?page`, because `YieldSeriesPoint`
  and `BalanceRow` are one value per asset per date and do not collapse. **Rows
  1–3 above therefore point at the wrong endpoint now**; §1's `POST /mutations`
  vocabulary is untouched, exactly as this section predicted it would be either
  way. Design:
  [`../superpowers/specs/2026-09-03-w7-read-surface-design.md`](../superpowers/specs/2026-09-03-w7-read-surface-design.md).
- **~~O33 — deletion.~~ CLOSED 2026-09-03 as [D137](../decisions/D137.md) + [D138](../decisions/D138.md)** — D137 ruled the shape, D138 the action.
  `asset.delete` and `transaction.delete` appear above with no cascade semantics
  because the ruling had not been made; it now has. The server performs an
  application cascade **in batches, children first and the parent last**, and the
  schema is RULED to take foreign keys with **`ON DELETE RESTRICT`** — which amends D101. **It declares none yet**: `infra/schema/user.ts` holds the ruling in comments and no key, so the generated SQL carries no `ADD CONSTRAINT` until W7 writes them.
  **[D138](../decisions/D138.md) settled the action after D137 got it wrong:**
  the self-referential `settles_payout_id` key is handled by ORDER, not by the
  action. **Step 1 NULLS the settlement link rather than
  deleting the settling row** — an `UPDATE` nulling every settlement link that
  points INTO this asset. **[D138](../decisions/D138.md) carries the exact SQL
  and this document does not copy it**, because three properties travel with it
  and not with a paraphrase: every predicate is user-scoped, each step batches
  through a key-set sub-select (Postgres takes no `LIMIT` on `UPDATE`/`DELETE`),
  and each batch is its own transaction. It also
  selects by what a row SETTLES, not by its own `asset_id`, because nothing ties
  the two and a `tax` on asset B may settle asset A's payout. An
  `UPDATE` removes references without removing rows, so a batched step cannot
  strand a chain (a `tax` settling a `tax` is schema-legal) and no other asset
  loses a transaction — deleting one would be issue #34's shape. **No CHECK is
  owed**;
  D137's proposed *CHECK mirroring `targetsAsset`* could not have worked, since
  `targetsAsset('tax')` is `true` and forces some asset, never the same one.
  D137 had switched to `NO ACTION` on an end-of-*statement* rescue that batching
  defeats, and `NO ACTION` has never been probed against DSQL while `RESTRICT`
  has (D99 round 3). **`no action` is drizzle's default emission**, so every
  key must set the action explicitly. **Four of the
  SIX are composite** — contract 3 leads every per-user PK with `user_id` — so
  they need the table-level
  `foreignKey({ columns, foreignColumns }).onDelete('restrict')`. **Two are
  single-column** and take the SAME table-level builder, because the column-level
  `references()` carries no `name` and would break the schema's naming rule: `account.user_id → app_user.user_id` and
  `asset.user_id → app_user.user_id`, the second of which anchors `asset`, whose
  `user_id` otherwise reaches `app_user` by no path at all.

  `CASCADE` was rejected on a measurement: AWS's guidance says cascading actions
  count towards the transaction modification limit, DSQL's is 3 000 mutated rows,
  and `user_price` holds one row per asset per date. **The `asset.delete` op's
  semantics are therefore pinned now**, and #34's field-based cascade must still
  not be ported — on the target schema it is unreachable anyway, since
  `asset_id` is NULL on every portfolio-level row.
- **~~O31 — the seed's row count.~~ CLOSED 2026-09-02 as D133**: all three
  figures may move and the checkpoints are re-derived from the new seed.
  `dataset.replace` and `dataset.clear` still carry whatever the seed produces,
  which is now a seed that may differ from today's.
- **`transaction.patch` is the only unvalidated write path, and that is a
  hazard rather than a curiosity.** `repo.updateTransaction` IS called — by
  `useUpdateTransaction` in `hooks/queries.ts` — but that HOOK has no caller, so
  D128's *every door is closed* table omits it. It takes a bare
  `Partial<Transaction>` with no schema in front. Build the server op without
  D124's rule and a count-less position-moving row becomes storable again, with
  the export guard the only thing between that and an unrestorable backup.
  The transaction-edit affordance IS planned — `NEXT-PHASE-PLAN.md`'s Phase 7
  `/data` route, and open issue #6 — and **two** of the three bug issues (#35
  and #36) name it as where their fix lands. #34 does not: its own directions
  are a `targetsAsset` predicate or a one-time normalization. So this op will
  acquire its first caller soon, but the evidence is two issues rather than
  three.
