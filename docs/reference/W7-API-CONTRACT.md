# W7 — the API contract, on paper

> **A53.** Written before W7 so its design session starts from an inventory
> rather than an excavation. Nothing here is built yet, and **one column of it
> is deliberately undecided** — see O28 at the bottom.
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
> stays binding until a decision says otherwise, exactly as the Derivation row
> does for O28. **Annotated, not superseded.**

**Reads collapse into ONE request, writes into one op vocabulary.** Three list
calls that today hit three Dexie tables become a single `GET /state`, because
every screen needs all three and three round-trips would buy nothing but
latency and a torn read — assets, snapshots and transactions must agree with
each other or `derive.ts` produces a figure from mismatched halves.

| # | `repo` method | Becomes | Mutation op | Notes |
|---|---|---|---|---|
| 1 | `listAssets` | `GET /state` | — | one response, one `version` |
| 2 | `listSnapshots` | `GET /state` | — | with the above |
| 3 | `listTransactions` | `GET /state` | — | with the above |
| 4 | `saveSnapshot` | `POST /mutations` | `snapshot.put` | upsert by date |
| 5 | `recordTransaction` | `POST /mutations` | `transaction.add` **+ optional `asset.add`** | ONE op list, not two requests — the quick-create path creates the asset and the row that needs it together, and half of that landing is a transaction naming an asset that does not exist |
| 6 | `addAsset` | `POST /mutations` | `asset.add` | |
| 7 | `updateAsset` | `POST /mutations` | `asset.patch` | patch, not put — `assetPatchFromForm` already sends a subset |
| 8 | `deleteAsset` | `POST /mutations` | `asset.delete` | **cascade is O33's, not this document's.** The client hand-cascades today — **and that cascade is a live data-loss bug (issue #34):** it deletes by `assetId` rather than by type, so a pre-2026-09-02 deposit that borrowed an asset's id is destroyed with it. Do not port the semantics under O33's cover |
| 9 | `updateTransaction` | `POST /mutations` | `transaction.patch` | **THE ONLY UNVALIDATED WRITE PATH — put `transactionSchema` in front of it.** It takes a bare `Partial<Transaction>` with no schema, and D128's *every door is closed* table omits it only because the HOOK has no caller. Building this op without D124's rule reopens the count-less position-moving row |
| 10 | `deleteTransaction` | `POST /mutations` | `transaction.delete` | |
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

## 2. The `meta` keys, sorted — three stay local, one dies

`meta` is a key-value table today with four keys in use. **None of them becomes
server state**, and the reasoning differs per key.

| Key | Written by | Fate |
|---|---|---|
| `inzhur:lastFetch` | `useInzhurAssets.ts` | **stays local.** A cache of the last provider payload, per device. Two devices fetching at different times is correct, not a conflict to resolve |
| `inzhur:lastParse` | `useInzhurAssets.ts` | **stays local**, same reason |
| `nbu:lastRate` | `useNbuRate.ts` | **stays local.** The rate is a display convenience; a stale one on one device costs nothing and syncing it would put a provider read in the mutation path |
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
| `POST /admin/users/{id}/approve` · `/reject` · `DELETE` | `role = super_admin` | **approve is a COGNITO WRITE, not a status flip (D39):** it calls `AdminCreateUser`, which is where the MAU is spent and where the invitation — the only email in the flow — reaches the address's owner. An approve that only updates `status` leaves the user with no way to sign in. Delete is scoped to `pending`/`rejected` only; an `active` user owns a ledger, and that cascade is O33's |
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

- **O28 — the server-side derivation boundary.** Every read above is drawn as
  "the server ships rows, the client derives", which is what the cloud-stack
  spec still pins. **That row is annotated, not superseded.** If O28 rules that
  user-data derivations may materialize server-side on mutation, `GET /state`
  gains a sibling and the ETag covers more — the op vocabulary in §1 does not
  change. Marked here, decided at W7 design, with a number.
- **O33 — deletion.** `asset.delete` and `transaction.delete` appear above with
  no cascade semantics on purpose. The client hand-cascades today; whether the
  server keeps that, adds tombstones, or adopts foreign keys is O33's, and an
  API document that quietly picked one would be the implicit resolution Plan C
  forbids.
- **O31 — the seed's row count.** `dataset.replace` and `dataset.clear` carry
  whatever the seed produces. W7's Seed bullet needs O31 first.
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
