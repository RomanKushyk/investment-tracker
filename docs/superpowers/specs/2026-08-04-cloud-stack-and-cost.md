# Cloud stack & cost — Quirenote backend

Which stack the cloud move uses and what it costs. Three options were costed from the AWS Price
List Bulk API rate cards rather than marketing pages; **all three land at ~$0.02/month, which is
Amplify Hosting alone, so cost does not decide this.** Schema and lifecycle rules are
[`2026-08-04-data-model.md`](2026-08-04-data-model.md).

## The decision: **A1-staged** — Aurora DSQL, delivered in phases

Chosen by the owner over a multi-vendor hybrid that scored higher overall — vendor surface was the
hybrid's one weak axis and the one where this stack most out-scores it — for single-vendor coherence
and one IAM model. The staging is what makes it defensible: pure A1 as a single big-bang project
scored 50% against A1-staged's 77%, because the only irreversible item on the list — a missed price
day — must not wait six weeks behind a rewrite. So raw capture ships first and the clock stops
there; the observation schema is finalised three weeks later **with evidence in hand**, and nothing
is lost meanwhile because raw payloads regenerate any schema retroactively. The gate on that phase:
if DPU or backup/PITR disappoints, price history moves to S3 + CloudFront, which is planned for and
costs nothing to keep live.

What stays unchanged is the frontend (React 19 + Vite 7 + TS + Tailwind 4) and Amplify Hosting;
`src/lib/repository.ts` becomes an HTTP client behind its existing method signatures, and every
provider payload is kept **forever** so any lifecycle question stays retroactively re-derivable.
Two rows of the original plan have since moved: the PWA shell is removed (*Cloud target* —
cross-browser beats offline, and install needs no service worker), and derivation is no longer
100% client-side but an IMPORT of `src/core/derive.ts` running server-side, designed in
[`2026-09-03-w7-read-surface-design.md`](2026-09-03-w7-read-surface-design.md).

## The DSQL limitations a schema has to be written inside

Free at this scale — 100,000 DPU and 1 GB of storage always free, Cognito Essentials 10,000 MAU,
Lambda arm64, EventBridge Scheduler, ten CloudWatch alarms — and **no VPC, so no NAT Gateway and
no public IPv4 charge**, which is the line that makes every other AWS SQL option expensive. The
price of that:

- **Optimistic concurrency.** `If-Match` is `UPDATE … WHERE version = $2` plus a rowcount check,
  and every mutation **must retry on SQLSTATE 40001 at COMMIT**.
- **No triggers**, no PL/pgSQL, no `TRUNCATE`, no temp tables, **one DDL per transaction**,
  REPEATABLE READ only, a 60-minute connection cap, IAM-token auth only.
- **`jsonb` cannot be indexed**, 1 MiB per value. No RLS: scoping is IAM plus app-level predicates.
- A transaction ceiling of 3,000 mutated rows / 10 MiB / 5 min, which `clearAll()` crosses around
  year 11.
- **No local emulator.** Local Postgres runs the inner loop with the schema deliberately kept
  inside the DSQL subset so the two agree by construction; real DSQL runs in CI.

Foreign keys were absent from the grammar when this was written and shipped on 2026-08-26 — a
composite `FOREIGN KEY … REFERENCES … ON DELETE RESTRICT` is accepted and enforced (*User schema
and deletes*). The row stands as the reason integrity moved into app code, which is still what
ships. The DSQL refusals that a migration meets are measured in `infra/docs/dsql-constraints.md`.

## The AWS standing "no" list

At a $0.02 baseline only a fixed charge moves the bill: **NAT Gateway $33.58/mo**, Aurora
Serverless v2 at 0.5 ACU ~$51/mo, Amplify **WAF $15/mo** (one console toggle — the likeliest
accident), public IPv4 **$3.65/mo even idle**, Lambda provisioned concurrency ~$2.29/mo *and it
voids Lambda's free tier*, a customer-managed KMS key $1–3/mo, a Route 53 zone $0.50/mo, Secrets
Manager $0.40/mo. The budget watching for them uses **absolute** thresholds, because at this
baseline a percentage alert fires on noise.

**A missed cron day is permanently unrecoverable** — the provider publishes no price history — so
monitoring must detect *silence*: an alarm on `Invocations < 1` over 24 h with
**`treatMissingData: BREACHING`**, the default parking a dead job in INSUFFICIENT_DATA where it
never alerts.

## Rejected

| Option | Why |
|---|---|
| **Aurora Serverless v2** | ~$8.56/mo of ACU-hours **plus** a $3.65–33.58/mo networking tax (public IPv4 or NAT Gateway) — it is a VPC resource, unlike DSQL. ~$12/mo realistic |
| **RDS db.t4g.micro** | $14.08/mo. Its 750-hour free tier is the **legacy** program for accounts created before 2025-07-15 — confirmed unavailable here |
| **DynamoDB** | No SQL, no foreign keys, no constraints of any kind, and a proprietary export as the exit. Viable at all only because `deleteAsset` and import were both dropped — the 174-item cascade and the 174-row atomic replace exceeded `TransactWriteItems` (100 actions, no two on the same item) |
| **Supabase** | Three vendors, and the instance **pauses after ~7 days idle** — the daily cron prevents it, so a dead cron compounds. Its GitHub Actions cron drifts, may drop queued jobs, and auto-disables after 60 days of repo inactivity |
| **Next.js** | Delivers none of PWA / sync / cron. Amplify does not support manual deploys for SSR and documents Next only through 15, so `output: 'export'` is forced — which disables Route Handlers and Server Actions, the one reason to migrate |
| **Cloudflare Workers + D1** | Free-plan cron capped at **10 ms CPU**; parsing 165 KB through zod likely exceeds it → $5/mo. **D1 has no `NUMERIC`** |
| **Sync engines** (Dexie Cloud, PowerSync, ElectricSQL, InstantDB, Zero) | Moot once offline is dropped and IndexedDB is removed |
| **Clerk** | Free plan pins a **7-day session lifetime** — fails "same everywhere" |
| **Self-hosted (PocketBase/Hetzner)** | ~€4–6/mo plus ops; the only non-free option considered |
| **Amplify Gen 2** | Below |

**Amplify Gen 2 is rejected on a narrower ground than the first objection.** That objection — that
`AmplifyBackendDeployFullAccess` chains via `sts:AssumeRole` to a CDK bootstrap role with
`AdministratorAccess`, surrendering the posture that CI cannot alter hosting config — is withdrawn:
a dedicated OIDC role, a separate bootstrap qualifier and a scoped cfn-exec policy solve it. What
rejects it is that `defineData` provisions AppSync plus one DynamoDB table per model, with no
supported way to get the typed data client without AppSync. This app fetches whole result sets, so
GraphQL's selective-field model is unused and its typed client duplicates zod schemas that already
exist and are tested. Take Gen 2 only if that typed client is wanted for its own sake.
