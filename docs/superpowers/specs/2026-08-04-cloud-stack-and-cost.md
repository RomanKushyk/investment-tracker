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
| PWA | **vite-plugin-pwa** — installable shell, network-required, no offline |
| Client | `src/lib/repository.ts` becomes an HTTP client behind its existing method signatures |
| API shape | `GET /state` (whole dataset + version) · `POST /mutations` (one op, `If-Match`) |
| Derivation | 100% client-side. `src/core/` untouched. Server ships raw rows, never aggregates |
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
| **Foreign keys** | **Not supported.** `REFERENCES` is absent from the grammar; integrity moves to app code | None | Yes |
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
client, PWA shell, test repair, cutover.

Accepted costs, both front-loaded rather than standing: **OCC retry handling** (DSQL uses
optimistic concurrency, so `If-Match` is `UPDATE … WHERE version = $2` + rowcount, and mutations
must retry on SQLSTATE 40001), and **no local emulator** — local Postgres for the inner loop with
the schema deliberately kept inside the DSQL subset so the two agree by construction, real DSQL
in CI.

## Risks

1. ~~**A1's DPU estimate is the weakest number in this document.**~~ **RESOLVED 2026-08-04.**
   The figure is documented, not estimated: `ReadDPU = max(BytesRead, 2048) × 0.00000183105`
   ([billing docs](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/billing-metering.html)),
   i.e. **1.92 DPU per MiB read**, and DSQL bills bytes **scanned**, not rows returned. The formula
   reproduces a published real bill to three significant figures. For the price archive: ~325
   DPU/month at year 1, ~6,506 at year 20 — **6.5% of the 100,000 always-free allowance**, and
   ~$0.09/month even with the free tier deleted. Storage takes ~657 years to reach 1 GB.
   **[D91, 2026-08-25: neither figure is refuted, and neither should be reused without a plan.
   One query was measured at 64.989 DPU because an `ORDER BY` bound to its own `to_char()` alias
   instead of the indexed column, forcing a table scan; naming the column drops it to 9.508. A
   table scan bills `payload_gzip`, an index path does not, so cost here depends on the PLAN and
   not on row count. **The one current datum: the nightly capture measures ~173 DPU/month = 0.17%
   of the tier at 6,664 rows** — a much smaller archive than either projection models, so it
   replaces neither. `EXPLAIN (ANALYZE, VERBOSE)` prints `Statement DPU Estimate` per statement —
   size from that.]**
   Note the earlier "0.5 DPU/s" calibration describes **ComputeDPU only**; read and write DPU have
   no time dimension at all. Still measure in week 1 — background/system DPU (auto-ANALYZE, index
   maintenance) is genuinely unmodellable — but no design decision differs across the $0–$2/month
   spread this could move.

2. **A missed cron day is permanently unrecoverable** — the provider publishes no price history.
   Monitoring must detect *silence*: CloudWatch alarm on `Invocations < 1` over 24 h with
   **`treatMissingData: BREACHING`** (the default parks a dead job in INSUFFICIENT_DATA and never
   alerts), or healthchecks.io in option B.

3. ~~**AWS account deadline.**~~ **RESOLVED 2026-08-10.** The account was created **2026-07-29**
   (not June, as first assumed) under the post-2025-07-15 Free plan, which closes the account at
   6 months — 2027-01-29. It was **upgraded to the Paid plan on 2026-08-10**, so no closure
   deadline remains. Credits: **$119.99**, expiring 2027-07-29 (12 months from creation);
   $100 initial + $20 earned for creating the cost budget. Burn to date: **$0.01 in ~2 weeks**,
   so credits were never going to be the binding constraint — only the 6-month clock was.

   Guardrail in place: a $5 monthly cost budget with **absolute** alert thresholds at $1 and $3
   (actual) and $5 (forecasted), all to the owner's email. Absolute rather than percentage
   because at a ~$0.02 baseline percentage thresholds fire on noise. No budget *actions* are
   attached — notification only, never automated shutdown.

4. **AWS standing "no" list.** At a $0.02 baseline only a fixed charge moves the bill: NAT Gateway
   **$33.58/mo** (`EUN1-NatGateway-Hours` $0.046/hr, confirmed), Aurora Serverless v2 at 0.5 ACU
   ~$51/mo, Amplify **WAF $15/mo** (one console toggle — the likeliest accident), public IPv4
   **$3.65/mo** even idle, Lambda provisioned concurrency ~$2.29/mo *and it voids Lambda's free
   tier*, customer-managed KMS key $1–3/mo, Route 53 zone $0.50/mo, Secrets Manager $0.40/mo. Set
   an AWS Budget with an **absolute $1** threshold — percentage alerts fire on noise here.

## Rejected

| Option | Why |
|---|---|
| **Aurora Serverless v2** | ~$8.56/mo of ACU-hours **plus** a $3.65–33.58/mo networking tax (public IPv4 or NAT Gateway) — it is a VPC resource, unlike DSQL. ~$12/mo realistic. |
| **RDS db.t4g.micro** | $14.08/mo. Its 750-hour free tier is the **legacy** program for accounts created before 2025-07-15 — confirmed unavailable here. AWS's free page now lists only "Short-term trial" and "Always free"; the 12-month category no longer exists. |
| **Amplify Gen 2** | See below — re-examined, still rejected, but on different grounds. |
| **Next.js** | Delivers none of PWA / sync / cron. Amplify does not support manual deploys for SSR and documents Next only through 15, so `output: 'export'` is forced — which disables Route Handlers and Server Actions, the one reason to migrate. |
| **Cloudflare Workers + D1** | Free-plan cron capped at **10 ms CPU**; parsing 165 KB through zod likely exceeds it → $5/mo. D1 has no `NUMERIC`. |
| **Sync engines** (Dexie Cloud, PowerSync, ElectricSQL, InstantDB, Zero) | Moot once offline is dropped and IndexedDB is removed. |
| **Clerk** | Free plan pins a 7-day session lifetime — fails "same everywhere". |
| **Self-hosted (PocketBase/Hetzner)** | ~€4–6/mo plus ops; the only non-free option considered. |

### Amplify Gen 2 — re-examined

The original objection was that `AmplifyBackendDeployFullAccess` chains via `sts:AssumeRole` to
the CDK bootstrap role (`AdministratorAccess` by default), surrendering the D15 posture that CI
cannot alter hosting config. **That objection is withdrawn** — it is solvable with a dedicated
OIDC role, a separate CDK bootstrap qualifier and a scoped cfn-exec policy, and rewriting CI/CD
is acceptable.

Two facts also came out in Gen 2's favour: `ampx pipeline-deploy --app-id --branch` demonstrably
works against a "Deploy without Git" manual-deploy app, and `ampx generate outputs --stack` lets
the backend deploy as a plain CDK stack with no Hosting app involvement at all. Cost is ~$0.03/mo.

**It is still the wrong fit, for a narrower reason:** `defineData` provisions AppSync + one
DynamoDB table per model, and there is no supported way to get the typed data client without
AppSync. This app fetches *the entire dataset* and derives every figure client-side — GraphQL's
selective-field model is unused, and its typed client duplicates zod schemas that already exist
and are tested. What is left is a CloudFormation pipeline where a one-line schema change is a
5–15 minute deploy that can roll back, plus sandbox stacks that do not auto-delete, plus
DynamoDB time-series modelling A1 does not need.

Take Gen 2 only if the typed end-to-end data client is wanted for its own sake, or if this
project is deliberate AWS practice.
