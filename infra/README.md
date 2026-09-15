# infra/ — the AWS backend

A daily job archives prices into Aurora DSQL. **The app does not read any of
this yet** — nothing in `src/` knows the backend exists. Design and rationale
live in `docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` (why this
stack) and `2026-08-04-data-model.md` (what is stored and why); the why for
what changed since is `docs/DECISIONS.md`, under **The price archive**,
**External sources** and **Cloud target**.

## Layout

| Path | What |
|---|---|
| `template.yaml` | The ARCHIVE stack, `quirenote-backend`: DSQL cluster, capture Lambda, schedule, DLQ, alarms. One of it, for every environment, deployed from `dev` alone |
| `template-user.yaml` | The USER stack: one DSQL cluster, the migration Lambda that fills it, the Cognito pool whose users own its rows, and the HTTP API the app reaches them through. Every route names the native Cognito JWT authorizer except `POST /v1/applications`, which carries none because it creates the row every other route is checked against. There is deliberately no `DefaultAuthorizer` — SAM renders an opted-out route against a scheme it never declares and `FailOnWarnings` is set — so what holds the line is `src/public-api.test.ts`, which derives the routes from this template and fails any that names no authorizer and is not on its written public list. Deployed twice, as `quirenote-backend-user-dev` and `quirenote-backend-user-prod`; the `Environment` parameter has no default, and the backup tag, the auth domain and the prod-only backup watch — a nightly check over THIS cluster's recovery points, with three alarms: one on the age, one on the check's silence, one on its errors — are all derived from it. **Three of the pool's properties cannot be changed after creation** — see [`../docs/reference/COGNITO-POOL-PARAMS.md`](../docs/reference/COGNITO-POOL-PARAMS.md) |
| `src/capture.ts` | The capture handler. Imports the parser from `src/core` — never a second copy. Manual modes: `backfill`, `observe`, `diagnose`, `importFundHistory` |
| `src/migrate.ts` | The migration handler, and the only thing that applies a file from `migrations/`. Manual: `workflow_dispatch` on [`.github/workflows/migrate.yml`](../.github/workflows/migrate.yml). One required mode — `rehearse` (throwaway schema, dropped `CASCADE`), `dry-run`, `apply`, or `bootstrap` (the FIRST super-admin: a Cognito user, its invitation, and a self-approved row, for an address named at invoke time — it applies no file and has no rehearsal, and it asks the cluster what it already holds before it mints anything, because it has no way to un-mint); an unrecognised one is refused rather than defaulted. A rehearsal's `DROP SCHEMA` retries a `40001` conflict and, if the schema still will not go, RESOLVES with a `teardown` key naming it rather than raising — a teardown that failed is not the finding a refused statement is, and `migrate.yml` fails the run on that key |
| `src/asset-delete.ts` | Deleting an asset: children before the parent, batched, each batch its own transaction, every predicate scoped by `user_id` — what the `ON DELETE RESTRICT` keys deliberately refuse to do |
| `src/pre-signup.ts` | The pre-sign-up trigger. Links a federated identity to the local account that already holds the address — only when the provider asserts it verified, and only in one direction: the local user is the destination, so the account owning the portfolio is not the one absorbed. Its narrow grant is a policy of its own in the template, because the pool names the function and nothing the pool depends on may name the pool |
| `src/authorize.ts` | The gate every authenticated route calls. Loads the `app_user` row by the token's `sub` or its address and answers `status` and `role` — never `cognito:groups`, which is stamped at issue time against a refresh token that lasts years. Three distinguishable refusals and none of them a 401: a `pending` caller is signed in and may not act yet. With open registration on it creates the row from the token's own claims — the ID token alone, and only where the provider asserts the address verified |
| `src/approve.ts` | `POST /admin/users/{id}/approve` and `/reject`. Approve calls `AdminCreateUser` and replaces the application row with one keyed by the `sub` it returns — a DSQL primary key is immutable, so it is a delete and an insert in one transaction. A `demo` row is refused before any Cognito call. Reject records the status and disables an identity only where one exists, disable first so a failure is retryable |
| `src/http.ts` | What a route on this API takes and answers — the payload 2.0 fields these handlers read, and the frozen response helper. Shared so there is one answer to what this API returns |
| `src/applications.ts` | `POST /v1/applications` — the sign-up application, and the FIRST HTTP handler here: it answers with a status code rather than a `throw`, which is the convention the rest of the API inherits. One insert, the same fixed `202` whether the row is new or already there, and an ASCII-only address rule so the fold it does and the `email = lower(email)` check on the cluster are one operation |
| `src/address.ts` | The one rule for an address this system will store — ASCII only, so the fold done in TypeScript and `app_user_email_lower_ck` on the cluster are the same operation. Shared by the applications endpoint and the runner's bootstrap, because two copies are two answers to what the cluster accepts |
| `src/dsql.ts` | `connect()` — the IAM auth token and the one `ssl` policy, shared by every handler that talks to a cluster |
| `src/backup-freshness.ts` | Publishes how old prod's newest USER-data backup is, nightly, filtered by that cluster's own ARN. Prod only, in the user stack, with three alarms beside it — one on the age it publishes, two on the function itself — because the archive's check reads the archive and must go on doing so, so the second cluster needs a second check rather than a taught one. It never connects to the cluster whose ARN it holds: that ARN is a filter string, and the one statement the template writes is `backup:ListRecoveryPointsByBackupVault` on the vault — SAM adds basic execution and, for `Tracing: Active`, X-Ray write. It THROWS where the capture's equivalent warns, because a capture has a perishable price to write first and this function has no other work to protect |
| `src/backup-age.ts` | The one rule both freshness checks read: recovery points in, an age in hours out. Only `COMPLETED` counts — a `CREATING` or `PARTIAL` point carries a newer timestamp and nothing can be restored from it — and no point at all reports a large number, never zero, because the metric is an AGE and "nothing" has to land on the bad side of the threshold |
| `src/xlsx.ts` | A minimal ZIP + SpreadsheetML reader, no package: numbers, shared strings and cached formula text; every other cell type is refused |
| `src/fund-history.ts` | The provider's fund price files to `nav` rows: columns by caption, the one text-formatted price read only as a string |
| `schema/user.ts` | Drizzle source for `migrations/003_user_schema.sql` — the SQL is generated from this file and a hand edit fails `src/schema-generated.test.ts` |
| `migrations/` | **Two kinds of file, and the difference decides who applies them.** The ARCHIVE's — `001` price_capture · `002` price_observation · `004` bond_terms — are reference copies of DDL held inline in `ensureSchema`, read by nothing. The USER schema's — `003` (generated) · `005` (the demo's identity) · `006` (one spelling per mailbox) — are applied by `src/migrate.ts`, which names them rather than globbing, and they live on the USER clusters only — never on the archive, which holds no user table. A user cluster is created EMPTY: the schema arrives when `migrate.yml` is dispatched against it, not when the stack deploys |
| `migrations/drafts/` | Schema written before anything may apply it — DSQL primary keys are immutable, so a key is decided on paper, reviewed, then promoted. Empty today: `003` was promoted out of it. [`migrations/drafts/README.md`](migrations/drafts/README.md) is the practice |
| `src/openapi.ts` | Builds the OpenAPI document from the two places that already know the API: the routes, the authorizer, the path parameter and the two hosts from `template-user.yaml`, and every response from the handlers' own frozen `json(…)` constants. Derived from THIS REPOSITORY rather than from `aws apigatewayv2 export-api`, whose document carries no responses at all and whose regeneration would need a deployed API, credentials and `apigateway:GET` — which the deploy role does not hold and CI cannot reach, so the drift test could not run. Regenerate with `pnpm openapi`; `src/openapi.test.ts` fails when the committed copy disagrees, and when a handler declares a `json(…)` answer the document does not describe |
| `scripts/generate-openapi.ts` | What `pnpm openapi` runs. Writes [`../docs/reference/openapi.json`](../docs/reference/openapi.json), which is an ARTIFACT — edit the handlers or the template, never the JSON. **Rendered at `https://dev.quirenote.com/api-docs.html`**, Swagger UI over these exact committed bytes — built by `pnpm build:api-docs` as a second Vite build that `deploy-frontend.yml` skips on `main`, so the page exists on the dev site only and behind its basic auth, and the API gains no route for it. It imports this file rather than fetching a copy, so there is nothing between the generator and the page that can drift. **Locally, `npx @redocly/cli preview-docs docs/reference/openapi.json`** needs no hosting and no route at all. **`npx @redocly/cli lint docs/reference/openapi.json`** is the second reader, and deliberately not a gate of any kind: the ones this repository runs are offline and this one downloads a package on every run. What it has caught — the missing hosts, and a public route whose posture was implied rather than stated — is held by `src/openapi.test.ts` instead, because a claim about an ungated tool is one nothing notices going stale |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection, vault lock — deliberately outside the stack |

## Local rules

- **`pnpm typecheck` does NOT read this folder.** Run `pnpm exec tsc --noEmit
  -p infra` from the repository root after `npm ci` in this folder first —
  root `tsconfig.json` includes only `src`, `vite.config.ts` and `scripts`,
  and this folder carries neither `typescript` nor `@types/node` of its own,
  nor the `pg` / `@aws-sdk/*` packages `capture.ts` imports. CI runs both
  before any credential exists; locally it is still yours.
- **Never add a VPC.** DSQL is a public IAM-authenticated endpoint and Lambda
  has internet egress by default; a NAT Gateway would cost roughly 1600× the
  rest of the stack.
- **Never enable provisioned concurrency or SnapStart.** Both void Lambda's
  always-free tier for this function. Fix cold starts with `Timeout`, not these.
- **The parser is imported from `src/core`, never reimplemented.** Two parsers
  eventually disagree about a price, and only one of them is tested.
- **One DDL statement per transaction, and DDL never shares a transaction with
  DML** — a DSQL constraint, not a style choice. Same for `CREATE INDEX ASYNC`.
- **`price_capture` rows are append-only.** A row is written on every run,
  including failures — this table, not the absence of a row, answers "did the
  job run".
- **Backups stay OUT of `template.yaml`.** A vault inside the stack it
  protects is destroyed by the accident it exists for; see
  `scripts/bootstrap-backups.sh`.
- **The backup selection matches on the `app=quirenote` TAG, never an ARN.**
  DSQL cluster IDs are generated, so a recreated cluster gets a new ARN. The tag
  is therefore the enrolment decision, and the vault it enrols into is LOCKED
  with a 35-day floor — a recovery point that lands there cannot be removed
  early. The archive carries the tag and so does prod's user cluster; dev's
  carries `app=quirenote-dev` and stays out, because it is the `migrations/`
  files and a dispatch. Note what this does NOT break: the capture's own
  check filters recovery points by the archive's cluster ARN before publishing the
  metric `BackupAgeAlarm` reads, so a second tagged cluster cannot make the
  archive look fresh.
- **Each stack watches the backups of the cluster it owns, and only that one.**
  The ARN filter above is why: it is correct, and its consequence is that one
  check cannot cover two clusters. So the archive publishes `BackupAgeHours`
  undimensioned from the capture, and the user stack publishes it dimensioned by
  cluster from `src/backup-freshness.ts` — one metric name, two series, because
  CloudWatch keys a custom metric on its exact dimension set and rolls nothing up
  across them. A vault-wide count cannot replace either: there is ONE vault and
  ONE selection, so the archive's nightly job would hold that number up while
  prod's user cluster had silently left the selection.
- **Never let an output alias shadow the column you `ORDER BY`.** A bare name
  in `ORDER BY` resolves to the aliased output column first, so the sort
  cannot inherit index order and the planner falls back to a full scan.
  Guarded by `src/order-by-alias.test.ts`.
- **Do not drop `price_capture_as_of` as dead weight.** `observeNbu`'s
  `WHERE as_of BETWEEN` depends on it to stay off a full table scan.
- **The vault lock stays GOVERNANCE, and its floor never EXCEEDS the plan's
  `DeleteAfterDays`.** Equal is fine — AWS accepts a job whose retention is
  equal to or longer than the floor. The script derives the floor from the
  live plan; the floor can still be raised by hand ahead of the plan, so
  lower the floor first when the two must both move.

## Deploying

Region: **`eu-north-1`** — same as Amplify. Aurora DSQL is available there
(`dsql.eu-north-1.api.aws`); DSQL is PostgreSQL 16 compatible.

Deployed by GitHub Actions, not from a developer machine — there are no AWS
credentials locally and there should not be. See
`docs/reference/DEPLOYMENT.md`. The backend uses its **own** OIDC role,
separate from `quirenote-frontend-deploy`, so the frontend deploy role stays
unable to touch hosting config.

## infra/docs/

| File | Holds |
|---|---|
| [`docs/dsql-constraints.md`](docs/dsql-constraints.md) | Every DDL statement DSQL accepts or refuses, and the `ALTER TABLE` create-time-only matrix |
| [`docs/console-setup.md`](docs/console-setup.md) | One-time console setup, SES, the artifacts bucket |
| [`docs/role-deploy.md`](docs/role-deploy.md) | Role 1 — `quirenote-backend-deploy` |
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — `quirenote-backend-cfn-exec`, and the three traps — the third is why the user stacks are named as they are |
