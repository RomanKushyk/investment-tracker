# infra/ — the AWS backend

A daily job archives prices into Aurora DSQL. **The app does not read any of this yet** — nothing in
`src/` knows the backend exists. Design and rationale live in
`docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` (why this stack) and
`2026-08-04-data-model.md` (what is stored and why); the why for what changed since is
`docs/DECISIONS.md`, under **The price archive**, **External sources** and **Cloud target**.

## Layout

| Path | What |
|---|---|
| `template.yaml` | The ARCHIVE stack, `quirenote-backend`: DSQL cluster, capture Lambda, schedule, DLQ, alarms. One of it for every environment, deployed from `dev` alone |
| `template-user.yaml` | The USER stack: one DSQL cluster, the migration Lambda that fills it, the Cognito pool whose users own its rows, and the HTTP API the app reaches them through. Deployed twice, as `quirenote-backend-user-dev` and `quirenote-backend-user-prod`, from an `Environment` parameter with no default that the backup tag, the auth domain and the two prod-only watches all derive from. There is deliberately no `DefaultAuthorizer` — SAM renders an opted-out route against a scheme it never declares and `FailOnWarnings` is set — so what holds the line is `src/public-api.test.ts`, which derives the routes from this template and fails any that names no authorizer and is not on its written public list. **Three of the pool's properties cannot be changed after creation** — [`../docs/reference/COGNITO-POOL-PARAMS.md`](../docs/reference/COGNITO-POOL-PARAMS.md) |
| `src/capture.ts` | The capture handler. Imports the parser from `src/core` — never a second copy. Manual modes: `backfill`, `observe`, `diagnose`, `importFundHistory` |
| `src/migrate.ts` | The migration handler, and the only thing that applies a file from `migrations/`; dispatched from [`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml). One required mode — `rehearse`, `dry-run`, `apply`, or `bootstrap` (the FIRST super-admin, which applies no file, has no rehearsal, and asks the cluster what it already holds because it has no way to un-mint) — and an unrecognised one is refused rather than defaulted. A rehearsal's `DROP SCHEMA` retries a `40001` conflict and, **if the schema still will not go**, RESOLVES with a `teardown` key naming it rather than raising: a teardown that failed is not the finding a refused statement is, and `migrate.yml` fails the run on that key |
| `src/asset-delete.ts` | Deleting an asset: children before the parent, batched, each batch its own transaction, every predicate scoped by `user_id` — what the `ON DELETE RESTRICT` keys deliberately refuse to do |
| `src/pre-signup.ts` | The pre-sign-up trigger. Links a federated identity to the local account already holding the address — only when the provider asserts it verified, and only in one direction, so the account owning the portfolio is not the one absorbed. Its grant is a policy of its own in the template, because the pool names the function and nothing the pool depends on may name the pool |
| `src/authorize.ts` | The gate every authenticated route calls. Answers `status` and `role` from the `app_user` row — never `cognito:groups`, which is stamped at issue time and stays stamped until the token expires. Three distinguishable refusals and none of them a 401: a `pending` caller is signed in and may not act yet |
| `src/approve.ts` | `POST /admin/users/{id}/approve` and `/reject`. Approve calls `AdminCreateUser` and replaces the application row with one keyed by the returned `sub` — a DSQL primary key is immutable, so it is a delete and an insert in one transaction. Reject disables an identity only where one exists, disable first so a failure is retryable |
| `src/http.ts` | What a route on this API takes and answers — the payload 2.0 fields these handlers read, and the frozen response helper, shared so there is one answer |
| `src/applications.ts` | `POST /v1/applications` — the sign-up application. One insert, the same fixed `202` whether the row is new or already there, and the ASCII-only address rule below |
| `src/address.ts` | The one rule for an address this system will store — ASCII only, so the fold done in TypeScript and `app_user_email_lower_ck` on the cluster are the same operation. Two copies would be two answers to what the cluster accepts |
| `src/dsql.ts` | `connect()` — the IAM auth token and the one `ssl` policy, shared by every handler that talks to a cluster |
| `src/backup-freshness.ts` | Publishes how old prod's newest USER-data backup is, nightly, filtered by that cluster's own ARN. It never connects to the cluster: the ARN is a filter string, and the one grant is `backup:ListRecoveryPointsByBackupVault` on the vault. It THROWS where the capture's equivalent warns, a capture having a perishable price to write first |
| `src/backup-age.ts` | The one rule both freshness checks read: recovery points in, an age in hours out. Only `COMPLETED` counts — a `CREATING` or `PARTIAL` point carries a newer timestamp and nothing can be restored from it — and no point at all reports a large number, never zero, because the metric is an AGE |
| `src/pool-usage.ts` | Prod's Cognito pool user count, published daily. Its one grant is `cognito-idp:DescribeUserPool` on that pool — configuration, so no attribute, list or user datum becomes reachable |
| `src/xlsx.ts` | A minimal ZIP + SpreadsheetML reader, no package: numbers, shared strings and cached formula text; every other cell type is refused |
| `src/fund-history.ts` | The provider's fund price files to `nav` rows: columns by caption, the one text-formatted price read only as a string |
| `schema/user.ts` | Drizzle source for `migrations/003_user_schema.sql` — the SQL is generated from this file and a hand edit fails `src/schema-generated.test.ts` |
| `migrations/` | **Two kinds of file, and the difference decides who applies them.** The ARCHIVE's — `001` price_capture · `002` price_observation · `004` bond_terms — are reference copies of DDL held inline in `ensureSchema`, read by nothing. The USER schema's — `003` (generated) · `005` (the demo's identity) · `006` (one spelling per mailbox) — are applied by `src/migrate.ts`, which names them rather than globbing, and live on the USER clusters only. A user cluster is created EMPTY: the schema arrives when `migrate.yml` is dispatched against it, not when the stack deploys |
| `migrations/drafts/` | Schema written before anything may apply it — DSQL primary keys are immutable, so a key is decided on paper, reviewed, then promoted. [`migrations/drafts/README.md`](migrations/drafts/README.md) is the practice |
| `src/openapi.ts` | Builds the OpenAPI document from the two places that already know the API: `template-user.yaml` and the handlers' own frozen `json(…)` constants. Derived from THIS REPOSITORY rather than from `aws apigatewayv2 export-api`, whose document carries no responses and whose regeneration would need a deployed API and `apigateway:GET` the deploy role does not hold — so the drift test could not run. `src/openapi.test.ts` fails when the committed copy disagrees, and when a handler declares an answer the document does not describe |
| `scripts/generate-openapi.ts` | What `pnpm openapi` runs. Writes [`../docs/reference/openapi.json`](../docs/reference/openapi.json), an ARTIFACT — edit the handlers or the template, never the JSON. **Rendered at `https://dev.quirenote.com/api-docs.html`** by a second Vite build that `deploy-frontend.yml` skips on `main`, importing this file rather than fetching a copy so nothing between the generator and the page can drift. `npx @redocly/cli lint` is a second reader and deliberately not a gate: every gate here is offline and that one downloads a package per run, so what it caught is held by `src/openapi.test.ts` instead |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection, vault lock — deliberately outside the stack |

## Local rules

- **`pnpm typecheck` does NOT read this folder.** Run `pnpm exec tsc --noEmit -p infra` from the
  repository root after `npm ci` here — the root `tsconfig.json` includes only `src`,
  `vite.config.ts` and `scripts`, and this folder carries neither `typescript` nor `@types/node` of
  its own, nor the `pg` / `@aws-sdk/*` packages `capture.ts` imports.
- **Never add a VPC.** DSQL is a public IAM-authenticated endpoint and Lambda has internet egress by
  default; a NAT Gateway would cost roughly 1600× the rest of the stack.
- **Never enable provisioned concurrency or SnapStart.** Both void Lambda's always-free tier for
  this function. Fix cold starts with `Timeout`, not these.
- **The parser is imported from `src/core`, never reimplemented.** Two parsers eventually disagree
  about a price, and only one of them is tested.
- **One DDL statement per transaction, and DDL never shares a transaction with DML** — a DSQL
  constraint, not a style choice. Same for `CREATE INDEX ASYNC`.
- **`price_capture` rows are append-only.** A row is written on every run, failures included — this
  table, not the absence of a row, answers "did the job run".
- **Backups stay OUT of `template.yaml`.** A vault inside the stack it protects is destroyed by the
  accident it exists for; see `scripts/bootstrap-backups.sh`.
- **The backup selection matches on the `app=quirenote` TAG, never an ARN.** DSQL cluster IDs are
  generated, so a recreated cluster gets a new ARN; the tag is therefore the enrolment decision, and
  the vault it enrols into is LOCKED with a 35-day floor, so a recovery point that lands there
  cannot be removed early. The archive carries the tag and so does prod's user cluster; dev's
  carries `app=quirenote-dev` and stays out.
- **Each stack watches the backups of the cluster it owns, and only that one**, because the ARN
  filter that makes a check correct is also what stops it covering two clusters. So `BackupAgeHours`
  is published undimensioned from the capture and dimensioned by cluster from
  `src/backup-freshness.ts` — one metric name, two series, CloudWatch keying a custom metric on its
  exact dimension set and rolling nothing up across them. A vault-wide count replaces neither: with
  ONE vault and ONE selection, the archive's job would hold that number up while prod's user cluster
  had silently left the selection.
- **The pool's user count is a bound, not a measurement.** There is no CloudWatch metric for monthly
  actives, so prod's pool publishes `EstimatedNumberOfUsers` daily and the alarm sits at 8,000 — 80%
  of the 10,000 Essentials bills nothing for, deliberately ahead of the 85% at which AWS mails the
  root account, because a guard that fires with the bill is not a guard. It bounds prod's actives
  from ABOVE and the ACCOUNT's only in part, dev's pool spending the same allowance. An absent count
  THROWS rather than publishing zero: zero is the healthy side of a `GreaterThan`, the same
  inversion `backup-age.ts` refuses in the other direction. The usage budget and the dashboard
  beside it are console artefacts — `docs/reference/DEPLOYMENT.md` re-creates them.
- **Never let an output alias shadow the column you `ORDER BY`.** A bare name resolves to the
  aliased output column first, so the sort cannot inherit index order and the planner falls back to
  a full scan. Guarded by `src/order-by-alias.test.ts`.
- **Do not drop `price_capture_as_of` as dead weight.** `observeNbu`'s `WHERE as_of BETWEEN` depends
  on it to stay off a full table scan.
- **The vault lock stays GOVERNANCE, and its floor never EXCEEDS the plan's `DeleteAfterDays`.**
  Equal is fine. The script derives the floor from the live plan, but the floor can still be raised
  by hand ahead of the plan, so lower the floor first when the two must both move.

## Deploying

Region **`eu-north-1`**, the same as Amplify; Aurora DSQL is available there and is PostgreSQL 16
compatible. Deployed by GitHub Actions, never from a developer machine — there are no AWS
credentials locally and there should not be (`docs/reference/DEPLOYMENT.md`). The backend uses its
**own** OIDC role, separate from `quirenote-frontend-deploy`, so the frontend deploy role stays
unable to touch hosting config.

## infra/docs/

| File | Holds |
|---|---|
| [`docs/dsql-constraints.md`](docs/dsql-constraints.md) | Every DDL statement DSQL accepts or refuses, and the `ALTER TABLE` create-time-only matrix |
| [`docs/console-setup.md`](docs/console-setup.md) | One-time console setup, SES, the artifacts bucket |
| [`docs/role-deploy.md`](docs/role-deploy.md) | Role 1 — `quirenote-backend-deploy` |
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — `quirenote-backend-cfn-exec`, and the traps — one of them is why the user stacks are named as they are |
