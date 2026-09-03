# Cloud stack & cost — Kubushka backend

Scope: which stack to use for the cloud move (cloud system of record, auth, one daily price
cron, PWA) and what it costs. Three viable options. Schema and lifecycle rules are specified
separately.

Drafted 2026-08-04. D2 (IndexedDB) and D16 (dual datasets) are retired by the move itself.

> **Verification status.** eu-north-1 figures come from the AWS Price List Bulk API rate cards
> (`AuroraDSQL/20260714190804`, `AmazonRDS/20260804175057`, `AmazonEC2/current`), not marketing
> pages. The adversarial cost-review pass did **not** complete (session limit), so option A1's
> DPU estimate in particular is single-source — see Risks.

## Common to all options

| Layer | Choice |
|---|---|
| Frontend | **Unchanged** — React 19 + Vite 7 + TS + Tailwind 4. No Next.js (see Rejected) |
| Hosting | AWS Amplify Hosting, kept as-is (~$0.02/mo — no free tier on this account) |
| PWA | ~~**vite-plugin-pwa** — installable shell, network-required, no offline~~ **[D92, 2026-08-25: removed from W7 — cross-browser beats offline, and install needs no service worker; installability alone is `PLAN-OPEN.md` O29]** |
| Client | `src/lib/repository.ts` becomes an HTTP client behind its existing method signatures |
| API shape | `GET /state` (whole dataset + version) · `POST /mutations` (one op, `If-Match`) |
| Derivation | ~~100% client-side. `src/core/` untouched. Server ships raw rows, never aggregates~~ **SUPERSEDED 2026-09-03 by [D136](../../decisions/D136.md)** — derivation moves to the server at W7, as an IMPORT of `src/core/derive.ts` rather than a port. `GET /view` (no parameters, all 6 periods, ₴ + `fx`) plus `/view/series?period` and `/view/balances?page`; `/state` narrows to export and import. The design is [`2026-09-03-w7-read-surface-design.md`](2026-09-03-w7-read-surface-design.md) |
| Raw payloads | Every provider payload kept **forever** (~8 MB/yr gzipped), so any lifecycle question stays retroactively re-derivable |

All three land at **~$0.02/month**, which is Amplify Hosting alone. Cost does not decide this.

## A1 — AWS-only, **Aurora DSQL** (Postgres-compatible)

| Layer | Choice | $/mo |
|---|---|---|
| Store | Aurora DSQL — 100,000 DPU + 1 GB storage **always** free, recurring monthly | 0.00 |
| Auth | Cognito (Essentials) — 10,000 MAU **always** free | 0.00 |
| Compute | Lambda arm64 256 MB — 1M req + 400k GB-s **always** free | 0.00 |
| Cron | **EventBridge Scheduler**, `Europe/Kyiv`, 14M invocations free | 0.00 |
| Monitoring | CloudWatch alarms (10 free) + SNS email | 0.00 |
| Config | SSM Parameter Store Standard | 0.00 |

Rate card: `EUN1-DSQL-DistributedProcessingUnits` **$9.50/M DPU**, `EUN1-DSQL-Storage-ByteHrs`
**$0.36/GB-mo**. (The marketing page's $8.00/$0.33 are US East figures.) No VPC → **no NAT
Gateway, no public IPv4 charge** — the line that makes every other AWS SQL option expensive.

Estimated **60,000–120,000 DPU/month** for this workload, straddling the free line. At 3× that
estimate the bill is $1.90; at 10× it is $8.55.

## A2 — AWS-only, **DynamoDB**

Identical to A1 except the store is a single on-demand DynamoDB table (25 GB storage always
free; on-demand requests ~$0.003/mo at this volume). Viable only because `deleteAsset` and
import are both dropped — the 174-item cascade and the 174-row atomic replace were what
exceeded `TransactWriteItems` (100 actions, no two on the same item).

## B — Supabase (Postgres)

| Layer | Choice | $/mo |
|---|---|---|
| Store | Supabase Postgres — 500 MB, 5 GB egress | 0.00 |
| Auth | Supabase Auth (magic link) — 50k MAU | 0.00 |
| Compute | Supabase Edge Functions — 500k invocations | 0.00 |
| Cron | **GitHub Actions** `schedule:` + `timezone: Europe/Kyiv` → Edge Function | 0.00 |
| Monitoring | **healthchecks.io** free (20 checks) | 0.00 |

## The differences that decide it

| | A1 — Aurora DSQL | A2 — DynamoDB | B — Supabase |
|---|---|---|---|
| **SQL** | Postgres wire + syntax | None — key-value access patterns | Full Postgres |
| **Foreign keys** | ~~**Not supported.** `REFERENCES` is absent from the grammar~~ — **false since 2026-08-26**, the day DSQL shipped them (D100 dates it from the release notes): measured that day (**D99**), a composite `FOREIGN KEY … REFERENCES … ON DELETE RESTRICT` is accepted and enforced. The row stands as the reason integrity moved to app code, and app-code integrity is still what ships; whether to adopt them is `docs/plans/PLAN-OPEN.md` **O34** | None | Yes |
| **Other constraints** | `CHECK`, `UNIQUE`, `PRIMARY KEY`, `GENERATED` all supported | None | All |
| **RLS** | No (IAM-scoped, app-level predicates) | No | **Yes** |
| **jsonb** | Supported, 1 MiB/value — but **cannot be indexed** | Native maps | Supported + indexable |
| **Concurrency** | **Optimistic (OCC).** `If-Match` is `UPDATE … WHERE version = $2` + rowcount; **must retry on SQLSTATE 40001 at COMMIT** | Native conditional write | `SELECT … FOR UPDATE` |
| **Txn ceiling** | 3,000 mutated rows / 10 MiB / 5 min. `clearAll()` crosses it ~year 11 | 100 actions | None at this scale |
| **Also missing** | No triggers, no PL/pgSQL, no `TRUNCATE`, no temp tables, 1 DDL per txn, REPEATABLE READ only, 60-min connection cap, IAM-token auth only | n/a | n/a |
| **Cron reliability** | **EventBridge Scheduler** — 60 s precision, IANA timezone, no auto-disable | same | GitHub Actions: drift, *"queued jobs may be dropped"*, auto-disables after 60 days repo inactivity |
| **Idle risk** | None | None | **Pauses after ~7 days idle** — the daily cron prevents it, so a dead cron compounds |
| **Vendors** | 1 | 1 | 3 |
| **Auth effort** | Cognito ~2–4 h (non-standard logout endpoint) | same | ~1 h |
| **Local dev** | DSQL has no local emulator | DynamoDB Local | `supabase start` |
| **Exit cost** | `pg_dump`-compatible wire, but DSQL-specific DDL | Proprietary export | Portable Postgres |
| **Cost risk** | DPU estimate unverified (see Risks) | Effectively none | None |

## Rating

Scored 1–5 per dimension, weighted for this project's stated priorities (a missed price day is
permanently unrecoverable; the codebase's whole history is pinned invariants; solo evenings).

| Dimension | Wt | A1 DSQL | A2 Dynamo | B Supabase | **C Hybrid** |
|---|---|---|---|---|---|
| Cron reliability | ×3 | 5 | 5 | 2 | **5** |
| Data-integrity guarantees | ×3 | 3 | 1 | 5 | **5** |
| Implementation effort & risk | ×2.5 | 2 | 3 | 5 | **4** |
| Maturity / evidence quality | ×2 | 2 | 5 | 5 | **5** |
| Operational risk (idle/pause) | ×2 | 5 | 5 | 2 | **4** |
| Cost certainty | ×1.5 | 2 | 5 | 5 | **5** |
| Local dev loop | ×1.5 | 1 | 3 | 5 | **5** |
| Reversibility / exit | ×1.5 | 3 | 2 | 5 | **5** |
| Vendor surface | ×1 | 5 | 5 | 2 | **2** |
| Access-pattern fit | ×1 | 4 | 4 | 4 | **4** |
| **Weighted / 95** | | 61 (64%) | 69.5 (73%) | 76 (80%) | **86.5 (91%)** |

## Decision: **A1-staged** — Aurora DSQL, delivered in phases

Chosen by the owner 2026-08-04 over the higher-scoring hybrid, for single-vendor coherence and
one IAM model. The staging is what makes it defensible: pure A1 as a single big-bang project
scored 50%, A1-staged 77%, because the only irreversible item on the list — a missed price day —
must not wait six weeks behind a rewrite.

**Phase 1 (~2–3 days) — raw capture only.** DSQL cluster + a `price_capture` table holding
timestamped **raw payloads** and run outcomes. Cron Lambda + EventBridge Scheduler + DLQ + alarms.
SAM/CDK stack and a GitHub Actions deploy job with its own OIDC role. **Zero app changes.** The cron
Lambda authenticates to DSQL with IAM and needs no Cognito, so nothing blocks it. The clock stops here.

Prerequisite, one commit: `parse.ts` must pick `returnRates` and `status` — both are currently
discarded, both are unreconstructable after the fact, and `returnRates` is the only way a yield
revision is ever detectable.

**Phase 2 (~3 weeks elapsed, ~1 day work).** The raw archive answers what a schema decision would
otherwise have to guess: weekend and holiday refresh behaviour, yield stability, fund NAV cadence,
payload byte-stability, outage shape. Then finalise the observation schema and backfill it from the
stored payloads. Measure real DPU. Verify DSQL backup/PITR. Gate: if either disappoints, price history
moves to S3 + CloudFront — planned for, costs nothing to keep live.

Deliberate: the archive schema is decided **with evidence in hand**, and nothing is lost meanwhile
because raw payloads regenerate any schema retroactively.

**Phase 3 (~10–12 days).** User schema, Cognito, API Gateway + API Lambda, `repository.ts` → HTTP
client, ~~PWA shell~~ **[removed by D92, 2026-08-25]**, test repair, cutover.

Accepted costs, both front-loaded rather than standing: **OCC retry handling** (DSQL uses
optimistic concurrency, so `If-Match` is `UPDATE … WHERE version = $2` + rowcount, and mutations
must retry on SQLSTATE 40001), and **no local emulator** — local Postgres for the inner loop with
the schema deliberately kept inside the DSQL subset so the two agree by construction, real DSQL
in CI.

## The rest of it is in `cloud-stack/`

**Split 2026-08-26 (D95)** — moved **verbatim** so no file exceeds 200 lines. Nothing was summarised.

| File | Holds |
|---|---|
| [`cloud-stack/risks-and-rejected.md`](cloud-stack/risks-and-rejected.md) | Risks · Rejected |
