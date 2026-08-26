# Cloud stack — risks, and what was rejected

> Moved **verbatim** from [`../2026-08-04-cloud-stack-and-cost.md`](../2026-08-04-cloud-stack-and-cost.md) on 2026-08-26 (D95). The decision and the staged plan stay in the spec; this is what it weighed against.

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
