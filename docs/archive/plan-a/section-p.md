# Section P — W7 preparation, startable ahead of the gate

> Closed Plan A work, moved **verbatim** from `../../plans/A51-A60.md` (renamed
> `../../plans/section-p.md` the next day — D98). Holds A51, with its boxes
> ticked as they were closed. Index: [`README.md`](README.md).
> **Not a task list — nothing here is executed.**
>
> A51's substance is not in this body. The draft it produced carries its own
> pinned contracts, and the reasoning that survived review is in
> `../../../infra/migrations/drafts/001_user_schema.sql`.

## A51 — User-schema DDL draft, green on local Postgres — `infra/user-schema-ddl-draft`

The W7 body says it: "the DDL is no longer blocked on a decision." Write it
now, so W7 starts from a reviewed draft instead of a blank file.

- [x] **Five tables, not four:** `app_user`, `account`, `asset`, `transaction`,
      `user_price` as draft DDL in `infra/migrations/drafts/`. `asset` is
      per-user, joins the archive by provider ref (fund slug or bond ISIN), is
      what `transaction.asset_id` and `user_price` point at, and carries the
      spec's one explicit DDL rule — **no CHECK constraint may enumerate a
      value naming a specific holding** (`TxSource`'s `reinvest_reit` /
      `reinvest_6475` go; `colorKey` becomes a palette slot). The header states
      NOTHING applies it; W7 does, and `ensureSchema` never learns these tables.
- [x] The old→new `Transaction` mapping written into the draft's header:
      today's `{id, date, type, assetId, amount, source}` against the spec's
      `id, user_id, account_id, date, type, amount, asset_id, quantity,
      unit_price, settles_payout_id, created_at` — `quantity` required on
      position-moving rows, `settles_payout_id` on `tax` rows only, never
      backfillable.
- [x] **`version` is ONE column on ONE dataset row, not one per table.** The
      spec pins `GET /state` as "whole dataset + version" and `If-Match` as
      `UPDATE … WHERE version = $2` **+ rowcount** — rowcount is the conflict
      detector, the SQLSTATE 40001 retry is serialization, and they are two
      mechanisms. Per-table versions cannot implement a dataset-level
      `If-Match`, and DSQL keys are immutable, so it is right on paper or not
      at all.
- [x] Inside the DSQL subset: **PLAN-NOW's cross-phase DDL rule applies whole**
      and is not restated here — a restatement that keeps three clauses of
      five and drops two ("never mixed with DML" and the 3,000-row ceiling)
      still reads as the complete list.
- [x] Runs green on local Postgres — the accepted no-emulator inner loop.
- [x] **Name the promotion path.** Nothing reads `infra/migrations/*.sql`: the
      applied DDL is inline in `ensureSchema` (`capture.ts:273`) and the two
      existing files are cited only from comments. Without a stated path
      `drafts/` is a third copy of the schema.
- [x] **Merging this fires a backend deploy.** `deploy-backend.yml` triggers on
      `paths: infra/**`, so SQL that nothing applies still runs `sam deploy`
      against the live capture stack and takes a `deploy-backend` concurrency
      slot. Accept the no-op run knowingly, or exclude the path with a **negated
      pattern inside the existing `paths:` list** (`- '!infra/migrations/drafts/**'`)
      — `paths` and `paths-ignore` cannot both filter one event, so adding a
      `paths-ignore` block beside `paths` would silently do nothing.
- [x] **Correct `infra/README.md` in the same commit.** Its Layout table says
      "`migrations/` | Reference DDL. The handler applies it idempotently on cold
      start" — which this task establishes is false, and CLAUDE.md requires the
      folder README to be current. Fix that row and give `migrations/drafts/`
      one of its own, the duty A53 and A54 take for `docs/README.md`.
- [x] NOT gated on O5: the Inzhur non-key columns live in `price_observation`,
      which this schema does not touch.

## A53 — The W7 API contract on paper — `docs/w7-api-contract`

One reference file, `docs/reference/W7-API-CONTRACT.md` (under the 200-line
cap), so W7's design session starts from an inventory, not an excavation.

- [x] All 17 `repo` methods mapped onto `GET /state` / `POST /mutations` — the
      mutation op per method, where `If-Match`/`version` sits, what retries.
      Keep A51's split: rowcount detects the conflict, 40001 is serialization.
- [x] The `meta` keys sorted: `inzhur:lastFetch`, `inzhur:lastParse`,
      `nbu:lastRate` are client caches and stay local; `seeded` dies with D2.
- [x] The endpoint inventory: the four already specified (`GET /state`,
      `POST /mutations`, `POST /v1/applications`, public
      `GET /v1/prices/{YYYY}.ndjson`) plus the W8 admin surface nothing has
      planned — users approve/reject/delete, the last-N-runs journal, missing
      tracked refs (A12's data), the source toggle, and HTTP wrappers for the
      Lambda's existing `{asOf}`/`{backfill}` ops. Auth column throughout: the
      `role` field, never `cognito:groups`; prices and user data never share a
      response, an auth policy or a cache policy.
- [x] O28 is marked, never decided: reads that COULD materialize on mutation
      are flagged O28-dependent and the doc takes no side (Plan C's rule).
- [x] **Its row joins `docs/README.md`'s Reference table in the same commit** —
      that table lists every reference file one by one, and an index that does
      not list a file is how a body becomes unreachable (`README.md`, this
      folder).
