# infra/ — the AWS backend

A daily job archives prices into Aurora DSQL, which the API alone reads. `src/` reads and writes the
portfolio over the user API through `src/lib/repository.ts`, applies for access, and calls the auth
relay for the session: asked once on every portfolio load, and to sign in and out. Design and rationale live in
`docs/superpowers/specs/2026-08-04-cloud-stack-and-cost.md` (why this stack) and
`2026-08-04-data-model.md` (what is stored and why); the why for what changed since is
`docs/DECISIONS.md`, under **The price archive**, **External sources** and **Cloud target**.

## Layout

| Path | What |
|---|---|
| `template.yaml` | The ARCHIVE stack, `quirenote-backend`: DSQL cluster, capture Lambda, schedule, DLQ, alarms, and the one way in from a user stack — the fixed-name reader role and the custom resource that maps it to `archive_reader`. One of it for every environment, deployed from `dev` alone |
| `template-user.yaml` | The USER stack: one DSQL cluster, the migration Lambda that fills it, the jobs that store NBU's official rate in it and collect the data its users cleared, the Cognito pool whose users own its rows, and the HTTP API the app reads and writes them through. Deployed twice, as `quirenote-backend-user-dev` and `quirenote-backend-user-prod`, from an `Environment` parameter with no default that the backup tag, the auth domain, the two prod-only watches, the prod-only wake before the backup and the rate job's, the sweep's and the view's prod-only watches all derive from. There is deliberately no `DefaultAuthorizer` — SAM renders an opted-out route against a scheme it never declares and `FailOnWarnings` is set — so what holds the line is `src/public-api.test.ts`, which derives the routes from this template and fails any that names no authorizer and is not on its written public list. **Three of the pool's properties cannot be changed after creation** — [`../docs/reference/COGNITO-POOL-PARAMS.md`](../docs/reference/COGNITO-POOL-PARAMS.md) |
| `src/capture.ts` | The capture handler. Imports the parser from `@quirenote/core` — never a second copy. Manual modes: `backfill`, `observe`, `diagnose`, `importFundHistory`, `importDerivedSell`, `importWaybackQuotes`, `importChartHistory`. Only the schedule's `{"scheduled":true}` writes the lines the capture's silence and error alarms read; a hand `{}` or `{asOf}` runs the same capture without them |
| `src/migrate.ts` | The migration handler, and the only thing that applies a file from `migrations/`. Two callers, one composite action between them — [`.github/actions/invoke-migration`](../.github/actions/invoke-migration/action.yml), which resolves the function, invokes it and reads the verdict: [`deploy-backend.yml`](../.github/workflows/deploy-backend.yml) plans after every stack update and, where anything is pending, rehearses and applies unattended, a failed apply opening an issue; [`migrate.yml`](../.github/workflows/migrate.yml) is the repair path and the bootstrap. One required mode — `rehearse`, `dry-run`, `apply`, or `bootstrap` (the FIRST super-admin, which applies no file, has no rehearsal, and asks the cluster what it already holds because it has no way to un-mint) — and an unrecognised one is refused rather than defaulted. A rehearsal's `DROP SCHEMA` retries a `40001` conflict and, **if the schema still will not go**, RESOLVES with a `teardown` key naming it rather than raising: a teardown that failed is not the finding a refused statement is, and the shared action fails the run on that key, for either caller |
| `src/asset-delete.ts` | Deleting an asset inside the caller's transaction: children before the parent, refused with the rows it needs when they pass the caller's budget, and a prune that takes as many as the budget leaves, prices first and then transactions newest first, every statement scoped through the caller's live dataset pointer — what the `ON DELETE RESTRICT` keys deliberately refuse to do |
| `src/pre-signup.ts` | The pre-sign-up trigger. Links a federated identity to the local account already holding the address — only when the provider asserts it verified, and only in one direction, so the account owning the portfolio is not the one absorbed. Its grant is a policy of its own in the template, because the pool names the function and nothing the pool depends on may name the pool |
| `src/authorize.ts` | The gate every authenticated route calls. Answers `status` and `role` from the `app_user` row — never `cognito:groups`, which is stamped at issue time and stays stamped until the token expires. Three distinguishable refusals and none of them a 401: a `pending` caller is signed in and may not act yet. The same read hands back the row's `settings` text, which `/view` serves and `settings.ts` merges onto |
| `src/approve.ts` | `POST /admin/users/{id}/approve` and `/reject`. Approve calls `AdminCreateUser` and replaces the application row with one keyed by the returned `sub` — a DSQL primary key is immutable, so it is a delete and an insert in one transaction. Reject disables an identity only where one exists, before the row changes. For an `active` account it then sets `rejected`, and a failure is retryable. For a `pending` application it deletes the row, then every identity under the address; a failed identity delete answers 500 and is left to an operator, the row being gone |
| `src/admin-users.ts` | `GET /admin/users`, the list a ruling starts from: every application but the demo, oldest first, each with the `id` approve and reject take. Filtered by `status`, paged by a keyset `cursor` with `limit` 1–100. Served by the admin function past the same gate |
| `src/archive-admin.ts` | `GET /admin/archive/diagnosis`, the super-admin's read of the archive's `diagnose`: past the gate it invokes the capture function synchronously with `{"diagnose":true}` and answers its body unchanged, 502 when the capture throws or cannot be invoked, 504 when it outruns the invoke's timeout. The function's name arrives as the `CaptureFunctionName` deploy parameter, read off the archive's `FunctionName` output; its own function, so the invoke grant sits on no other role |
| `src/archive-operations.ts` | `POST /admin/archive/operations`, `GET /admin/archive/operations` and `GET /admin/archive/operations/{id}`: the capture's `observe` and `importFundHistory` started as 202 operations for the super-admin. A start is checked against one schema built from the capture's own source and fund tables, recorded in `archive_operation`, and handed to the production state machine under the operation's id; the list (newest first, keyset-paged) and the read answer its state and the mode's own result, a run past its deadline as failed. In dev, which deploys no state machine, a start answers 405 |
| `src/archive-recorder.ts` | Invoked by the production state machine alone: writes how an operation ended, the capture's result or the message it failed with, and finishes only a run still going inside its deadline |
| `src/auth-relay.ts` | `POST /auth/start`, `/auth/respond`, `/auth/refresh`, `/auth/sign-out`, `/auth/sign-out/global`, `/auth/google/begin`, `/auth/google/complete` and `/auth/passkey/list`, `/start` and `/complete` — the relay on the CONFIDENTIAL client, and the only holder of its secret, read with `DescribeUserPoolClient` and cached per execution environment with the client's providers and callback. The refresh token goes into a `__Host-Http-` HttpOnly cookie on the API host and nowhere else, and the family's original into a second. A replay revokes the original, and a sign-out or the next sign-in revokes both cookies' tokens, which can belong to two families. The ID token goes back in the body. The access token, which also authorizes `DeleteUser`, goes into a cookie of its own, sealed with AES-256-GCM under a key HKDF draws from the secret, and the relay spends it on the three passkey calls alone, each for the account its tab names, the ID token's `sub`; the page never holds it. `/auth/passkey/list` answers every passkey, following `NextToken` to the end, each as the name Cognito generated for it (the authenticator's, such as Windows Hello) and its Kyiv creation day. A cookie this environment cannot open reads the secret again, at most once in five minutes, since a secret rotated in place leaves environments holding different ones: a cookie sealed under the secret Cognito now describes opens, and one sealed under the other is refused until a refresh on an environment holding the new secret re-seals it. Google leaves the page: begin answers the authorize URL on the managed-login domain (`AUTH_DOMAIN`) and binds a state and PKCE verifier to the browser in a fourth cookie; complete redeems the code only with both, at the token endpoint. A refresh names whether Google is on, and a sign-out names Cognito's logout while it is. `/auth/sign-out/global` ends every session the tab's account holds with `AdminUserGlobalSignOut`, which the relay calls by IAM on its own pool, and only when the sealed token's `auth_time` is under five minutes old and Cognito still takes the token (`GetUser` for an API sign-in's, `/oauth2/userInfo` for a Google one's); then it revokes and clears this browser's cookies, and clears them though a revoke fails, every token being dead by then. A token Cognito refuses clears this browser's cookies and ends nothing else, and so does a request with no refresh cookie and no access token that opens; both name Cognito's logout while Google is on. A begin naming the tab's account re-authenticates it with `prompt=login`, and complete refuses a code that comes back as another account, naming Cognito's logout. Every route refuses a request without `x-csrf: 1` or from another site before it reads anything, and admits only the challenges it lists — a plain password is not one. A start's Turnstile token is verified with siteverify (`src/bot-check.ts`, the secret read from SSM) before Cognito is asked, and one `403` answers a start whose token is missing or refused. On dev alone, a start whose `x-bot-check-bypass` header matches the SecureString `BOT_CHECK_BYPASS_PARAMETER` names passes without siteverify, and one that does not match is refused; production names no parameter |
| `src/http.ts` | What a route on this API takes and answers — the payload 2.0 fields these handlers read, request headers and cookies among them, and the two kinds of answer: the frozen `json()` constants, and the ones built per request from a frozen declaration, a derived body or a 304 with headers and no body key. A declared `set-cookie` leaves through payload 2.0's own `cookies` list. `weakMatch` and `strongMatch` are RFC 9110's two entity-tag comparisons, `If-None-Match`'s and `If-Match`'s. Shared so there is one answer |
| `src/view.ts` | `GET /view` — `buildView` for all six periods, the official rate, the rows the editors read (every asset and transaction, the quotes the user recorded on the caller's day, each asset's latest recorded one before it with its day, the latest witness time of any price the user recorded, each asset's delete counts) and the account's settings (the gate's read, core's `settingsOf`, NULL as the defaults), in one answer: the caller's rows (`ledger.ts`), the archive's sell rows and each linked bond's payment dates through `connectAsArchiveReader()`, and `served`'s rate, handed to core's `viewBody`. A WEAK tag composed from the read's inputs (*Cloud target* names them, the settings among them for `/view` alone) answers a matching `If-None-Match` with a 304; `If-Match` compares strongly, so the read's own tag answers 412. The 200 names its derivation in `derivation-id`, and its body carries the write's strong tag as `etag`; the body is sent brotli or gzip by the request's `Accept-Encoding`, plain otherwise, under `Vary: Accept-Encoding`, the weak tag the same whatever the coding, and the 304 carries that `Vary` too. `GET /view/series?period` (core's `seriesBody`), `GET /view/balances?page` (`balancesBody`) and `GET /view/day?date` (`dayBody`: what `GET /view` carries for the caller's day, for the day named) take the same gate and read, each tag adding the route and its parameter; a `period`, `page` or `date` the route cannot read is a 400 `invalid_query` naming it, answered once the gate admits the caller and before the ledger is read, and any other parameter is ignored |
| `src/mutations.ts` | `POST /mutations` and `GET /state`. A write is a list of ops applied in order in one transaction under a strong `If-Match` and an `Idempotency-Key`: the key is claimed in a transaction of its own, the effect and its stored response commit together, and a retry replays rather than applies twice. Ops are validated by core's schemas (`@quirenote/core/ops`); a snapshot is stored as per-unit prices. The export answers the live dataset's assets, transactions and stored per-unit prices, no ₴ quote, `private, no-store`. Its handler also serves `imports.ts`'s, `settings.ts`'s and `me.ts`'s routes, and each `POST /mutations` answering 200 and each successful import request collects one batch of the caller's dead generations, a commit as many as the function's time allows (`collect.ts`), a settings write none |
| `src/settings.ts` | `PATCH /me/settings` — a JSON merge patch (RFC 7396, `application/merge-patch+json`) of the account's settings, the fields and the rule for each being core's (`@quirenote/core/settings`). A type other than that is 415 naming the one it takes, a body that is no JSON object 400, a field the sanitiser refuses 422 `invalid_settings` naming it, a theme or any per-device field among them, and the whole patch is applied or none of it, every stored member the patch does not name written back as stored, a value its rule refuses and a member no field is for among them. The write is conditional on the text the merge was made from and made again from what the row holds when that has changed or on a serialization failure; a merge that changes nothing writes nothing, and the stored text may not pass the request's byte bound. It moves no `data_version` and takes no `Idempotency-Key`; the 200 answers every setting, defaults filled |
| `src/me.ts` | `GET /me` — the caller's own account, read by a screen that shows it and never on a load: the row's id, address and role, the Kyiv day of `decided_at`, whether a Google identity is linked (`AdminGetUser`'s `identities`, by the token's `cognito:username`), whether the account set a password of its own (`AdminGetUserAuthFactors` listing `PASSWORD` and the user `CONFIRMED`), the live dataset's asset and transaction counts and its first transaction day, omitted while there is none, and the settings as `/view` serves them. The four 403s are the gate's. Its weak tag is a digest of the body, revalidated under `private, no-cache` with a 304 |
| `src/imports.ts` | The staged import, shaped as S3's multipart upload: `POST /imports` opens a fresh generation under a manifest of row counts and a digest; `PUT /imports/{id}/parts/{part}` stages a part bounded in rows and bytes under a checked `Content-Digest`, each row through core's door and every whole-dataset rule a key, so a part breaking one stages nothing; `POST /imports/{id}/commit` checks the parts against the manifest and moves the live pointer in one row update under `If-Match`; `DELETE /imports/{id}` closes the staging. Every statement reaches the staged generation through `app_user.import_dataset_id` |
| `src/collect.ts` | Dead generations — datasets of the caller neither pointer names — removed one bounded batch per statement, children first, by a `POST /mutations` that answers 200 and an import request that succeeds, never by a settings write: one batch after each, as many as the function's time allows after a commit. An import idle past its limit loses its pointer first. Also daily, by `sweep.ts`, for a user who never writes again; never on a read |
| `src/ledger.ts` | The caller's `data_version`, assets, transactions and stored prices, read in one read-only transaction and turned into core's types: `dividend_payout` reads as `dividend_accrual`, a NULL asset as `''`, any other NULL as an absent key, and dates and numbers come back as text. Each price carries its own witness time where the store recorded one; `readRows` is the assets and transactions alone, read inside a write's transaction, `SCHEMA_TYPE`, `assetColumns` and `transactionColumns` the other way, a row's bind values for a write, and `dataTag` the strong tag of an account's `data_version`, the only place one is built |
| `src/applications.ts` | `POST /applications` — the sign-up application. The address rule, `@quirenote/core/address`, then the Turnstile token verified with siteverify (`src/bot-check.ts`, the secret read from SSM), then one insert: the same fixed `202` whether the row is new or already there, and one `403` for any token refused |
| `src/dsql.ts` | `connect()` — the IAM auth token and the one `ssl` policy, shared by every handler that talks to a cluster. `connectAsArchiveReader()` is the other door, which `view.ts` opens: the archive as `archive_reader`, with a `DbConnect` token signed by the reader role's session, kept until it nears its end; a `28000` is raised as `ArchiveReaderRefused` and logged as a metric line prod's `ArchiveReaderRefusedMetricFilter` counts |
| `src/archive-reader-grant.ts` | The archive's custom resource: creates `archive_reader` and grants it `SELECT` on every table in `public`, by default privileges for those created later. It then checks the role's effective privileges over every object type PostgreSQL keeps privileges on, and what it owns, and revokes every IAM mapping it holds; only when the check found nothing does it grant the reader role's again, since a mapping binds the role and only a revoke and a grant re-bind it (`docs/dsql-constraints.md`). It repairs nothing it did not grant. CloudFormation runs it on its creation and whenever a property changes: the role's ARN, the cluster, its timeout, or `Revision`, the hash of this file and of the `dsql.ts` it imports, which `src/stack-split.test.ts` holds. **A failed Update fails the rollback's Update too**, the rollback running the new code: for a stray privilege, remove it as admin and `aws cloudformation continue-update-rollback --stack-name quirenote-backend`; for anything else, add `--resources-to-skip ArchiveReaderGrant` |
| `src/sell-observations.ts` | The archive reads a portfolio needs, `GET /view`'s: the dealer's `sell` rows from `inzhur` for a set of refs between two dates, and each ref's payment dates from its latest `bond_terms` row between them, each date once. One statement per `observe-window.ts` window, and for each read a digest of exactly what it returns, for the view's validator. A ref is asked in its lower- and upper-case spellings, the two the archive stores, rather than through `lower()`, which would bypass the `(instrument_ref, as_of)` and `(ref, as_of)` indexes |
| `src/backup-freshness.ts` | Publishes how old prod's newest USER-data backup is, nightly, filtered by that cluster's own ARN. It never connects to the cluster: the ARN is a filter string, and the one grant is `backup:ListRecoveryPointsByBackupVault` on the vault. It THROWS where the capture's equivalent warns, a capture having a perishable price to write first |
| `src/backup-wake.ts` | Prod only: opens one read-only session on the USER cluster before the nightly backup plan, because AWS Backup refuses an Idle DSQL cluster and a connection is what wakes one. Its one grant is `dsql:DbConnectAdmin` on that cluster. It publishes nothing and THROWS on a failed wake, so Lambda retries it; a missed wake that costs a backup shows as `UserBackupAgeAlarm` |
| `src/backup-age.ts` | The one rule both freshness checks read: recovery points in, an age in hours out. Only `COMPLETED` counts — a `CREATING` or `PARTIAL` point carries a newer timestamp and nothing can be restored from it — and no point at all reports a large number, never zero, because the metric is an AGE |
| `src/pool-usage.ts` | Prod's Cognito pool user count, published daily. Its one grant is `cognito-idp:DescribeUserPool` on that pool — configuration, so no attribute, list or user datum becomes reachable |
| `src/official-rate.ts` | NBU's official USD rate in the user cluster. `ensure` fetches one day's rate and stores it in a transaction of its own, and `rate-ahead.ts` calls it. `served`, the read `GET /view` makes, answers today's stored row, else a fetch stored the same way, else the latest earlier row under its own date. A failed fetch is stored nowhere and not asked again by the same reader for five minutes |
| `src/rate-ahead.ts` | The scheduled job, in both environments: once NBU has set tomorrow's rate it stores it, and today's when missing, then publishes the served rate's age in days. A failed fetch does not throw; no stored rate at all does |
| `src/sweep.ts` | The daily job, in both environments, that collects what no write reaches, so data cleared with «Стерти дані» leaves the cluster within the bound *User schema and deletes* states, whether or not its owner writes again. It reads `dataset` and `app_user` alone for the users holding a dataset neither pointer names or a staging, and runs `collect.ts`'s batches for each while the function's time leaves its reserve; a run that stops for want of time throws nothing and leaves the rest for the next, and a lost write conflict is no failure. Its one grant is `dsql:DbConnectAdmin` on the user cluster. A scheduled run writes `sweepRun` when it finishes and `sweepRunFailed` when it throws or a collection failed, which prod's `SweepSilenceAlarm` and `SweepErrorAlarm` count; a hand run writes neither |
| `src/xlsx.ts` | A minimal ZIP + SpreadsheetML reader, no package: numbers, shared strings and cached formula text; every other cell type is refused |
| `src/fund-history.ts` | The provider's fund price files to `nav` rows: columns by caption, the one text-formatted price read only as a string |
| `src/chart-history.ts` | The provider's app chart to `buy` and `nav` rows for the days the archive lacks: a held key is never written and must agree to the digit unless the committed exclusions list it, a listed key that agrees refuses, and the run's own day is left to the capture |
| `schema/user.ts` | Drizzle source for `migrations/003_user_schema.sql` — the SQL is generated from this file and a hand edit fails `src/schema-generated.test.ts` |
| `migrations/` | **Two kinds of file, and the difference decides who applies them.** The ARCHIVE's — `001` price_capture · `002` price_observation · `004` bond_terms — record the archive's tables, indexes and keys with their reasoning in comments, and no runner applies them. The live DDL is `ensureSchema`'s in `src/capture.ts`, run on every invocation; columns outside a key are not compared, and `price_capture.quotes_sha256` is recorded nowhere. `src/archive-schema.test.ts` applies both to PGlite and fails on a table or index `ensureSchema` creates that no file records, and on a primary key the two disagree on. The USER schema's — `003` (generated) · `005` (the demo's identity) · `006` (one spelling per mailbox) · `007` (the asset's dropped reinvest policy) · `008` (the demo's account) · `009` (the official rate, one row per day) · `010` (the dataset and its two pointers) · `011` (the dataset backfill) · `012` (the data tables keyed by dataset) · `013` (the backfill again, for anyone provisioned before the switch) · `014` (the idempotency keys of `POST /mutations`) · `015` (an import's manifest and its staged parts) · `016` (the account's settings, one nullable text column on `app_user`) · `017` (the archive operations a super-admin starts) · `018` (the terms an account accepted: their version, a `date`, and when, on `app_user`, with the rule that pairs them) — are applied by `src/migrate.ts`, which names them rather than globbing, and live on the USER clusters only. A user cluster is created EMPTY, and the deploy that created it is what fills it: the stack update ships the SQL, the plan step counts what is pending, and the gated job applies it |
| `migrations/drafts/` | Schema written before anything may apply it — DSQL primary keys are immutable, so a key is decided on paper, reviewed, then promoted. [`migrations/drafts/README.md`](migrations/drafts/README.md) is the practice |
| `src/openapi.ts` | Builds the OpenAPI document from the two places that already know the API: `template-user.yaml` and the handlers' own answers — the frozen `json(…)` constants, and the declarations of those built per request, a 304 among them stated with headers and no `content`. Derived from THIS REPOSITORY rather than from `aws apigatewayv2 export-api`, whose document carries no responses and whose regeneration would need a deployed API and `apigateway:GET` the deploy role does not hold — so the drift test could not run. A route's request body and the headers it requires come from its handler too. `src/openapi.test.ts` fails when the committed copy disagrees, and when a handler declares an answer the document does not describe |
| `scripts/generate-openapi.ts` | What `pnpm openapi` runs. Writes [`../docs/reference/openapi.json`](../docs/reference/openapi.json), an ARTIFACT — edit the handlers or the template, never the JSON. **Rendered at `https://dev.quirenote.com/api-docs.html`** by a second Vite build that `deploy-frontend.yml` skips on `main`, importing this file rather than fetching a copy so nothing between the generator and the page can drift. `npx @redocly/cli lint` is a second reader and deliberately not a gate: every gate here is offline and that one downloads a package per run, so what it caught is held by `src/openapi.test.ts` instead |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection, vault lock — deliberately outside the stack |

## Local rules

- **`pnpm typecheck` does NOT read this folder.** Run `pnpm exec tsc --noEmit -p infra` from the
  repository root: the root `tsconfig.json` does not include this one, and the two sets of compiler
  options differ on purpose — no DOM and no `vite/client` here — so the shared domain package is
  checked twice and a browser-only type in it fails here alone. `pnpm exec` because `typescript`
  resolves from the root tree; the dependencies `capture.ts` imports come from the ordinary
  `pnpm install`, this folder being a workspace member.
- **A log line names an account by its sub, never its address, and a query's error never by its
  `detail`.** `src/log.ts` reduces a query's error for a `console` call and for a rethrow the runtime
  will print; `src/log-identifiers.test.ts` reads every console call in `src/` for a name that holds
  an address or a federated username.
- **Never add a VPC.** DSQL is a public IAM-authenticated endpoint and Lambda has internet egress by
  default; a NAT Gateway would cost roughly 1600× the rest of the stack.
- **Never enable provisioned concurrency or SnapStart.** Both void Lambda's always-free tier for
  this function. Fix cold starts with `Timeout`, not these.
- **The parser is imported from `@quirenote/core`, never reimplemented.** Two parsers eventually disagree
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
- **The pool's user count is a bound while no user is deleted, not a measurement.** There is no
  CloudWatch metric for monthly actives, so prod's pool publishes `EstimatedNumberOfUsers` daily
  and the alarm sits at 8,000 — 80% of the 10,000 Essentials bills nothing for, deliberately short
  of the allowance rather than at it, because a guard that fires with the bill is not a
  guard. It bounds prod's actives from ABOVE only while no user is deleted during the month: a user
  created or active in the month and then deleted stays among its actives but leaves the count. Only
  reject deletes one, the identity under an application it declines, and no page can: `DeleteUser`
  takes an access token, and an app sign-in's is one only the relay holds. Any other deletion is
  made by hand, by `AdminDeleteUser` or by `DeleteUser` with a token signed in for at the command
  line. It bounds the ACCOUNT's only in part, dev's pool
  spending the same allowance. An
  absent count THROWS rather than publishing zero: zero is the healthy side of a `GreaterThan`, the
  same inversion `backup-age.ts` refuses in the other direction. The usage budget, and the dashboard
  planned beside it, are in no template — each is made by hand from `docs/reference/DEPLOYMENT.md`
  §7.
- **Never let an output alias shadow the column you `ORDER BY`.** A bare name resolves to the
  aliased output column first, so the sort cannot inherit index order and the planner falls back to
  a full scan. Guarded by `src/order-by-alias.test.ts`.
- **Do not drop `price_capture_as_of` as dead weight.** `observeNbu`'s `WHERE as_of BETWEEN` depends
  on it to stay off a full table scan.
- **The vault lock stays GOVERNANCE, and its floor never EXCEEDS the plan's `DeleteAfterDays`.**
  Equal is fine. The script derives the floor from the live plan, but the floor can still be raised
  by hand ahead of the plan, so lower the floor first when the two must both move.

## An admin ID token from the command line

`POST /admin/*` takes a Cognito **ID** token: `authorize.ts` refuses an access token, which carries no
`email`. The app client is CONFIDENTIAL, so each sign-in call carries a `SECRET_HASH`, and reading
the secret takes `cognito-idp:DescribeUserPoolClient` — run this wherever an identity holding it is
signed in, **AWS CloudShell** among them. The two sign-in calls themselves need no credentials.

```bash
export AWS_DEFAULT_REGION=eu-north-1 STACK=quirenote-backend-user-dev USERNAME=owner@quirenote.com
out() { aws cloudformation describe-stacks --stack-name "$STACK" --output text \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue"; }
export POOL=$(out UserPoolId) CLIENT=$(out UserPoolClientId) && unset SESSION
export SECRET=$(aws cognito-idp describe-user-pool-client --user-pool-id "$POOL" \
  --client-id "$CLIENT" --query UserPoolClient.ClientSecret --output text)
read -rsp 'Password: ' PASSWORD && export PASSWORD && echo
# Each request is built from the environment, so the secret and the password are never typed.
call() { node -e '
  const e = process.env;
  const hash = require("crypto").createHmac("sha256", e.SECRET).update(e.USERNAME + e.CLIENT).digest("base64");
  process.stdout.write(JSON.stringify(e.SESSION
    ? { ClientId: e.CLIENT, ChallengeName: "SELECT_CHALLENGE", Session: e.SESSION,
        ChallengeResponses: { USERNAME: e.USERNAME, ANSWER: "PASSWORD", PASSWORD: e.PASSWORD, SECRET_HASH: hash } }
    : { ClientId: e.CLIENT, AuthFlow: "USER_AUTH", AuthParameters: { USERNAME: e.USERNAME, SECRET_HASH: hash } }));'; }
export SESSION=$(aws cognito-idp initiate-auth --cli-input-json "$(call)" --query Session --output text)
TOKEN=$(aws cognito-idp respond-to-auth-challenge --cli-input-json "$(call)" \
  --query AuthenticationResult.IdToken --output text)
```

Then `curl -H "authorization: Bearer $TOKEN" 'https://api.dev.quirenote.com/admin/users?status=pending'`
lists the pending applications with the `id` a ruling takes, and
`curl -X POST -H "authorization: Bearer $TOKEN" https://api.dev.quirenote.com/admin/users/<id>/approve`
approves one; `curl -H "authorization: Bearer $TOKEN" https://api.dev.quirenote.com/admin/archive/diagnosis`
answers the archive's `diagnose`. The session is single-use and short-lived, so a failed second call means starting over. Two dead
ends, each failing with a message that points elsewhere:

- `PREFERRED_CHALLENGE=PASSWORD` on the first call answers `Missing required parameter PASSWORD`:
  naming a preference means supplying its credential in the same call.
- `ChallengeName: PASSWORD` on the second answers `Challenge type not supported`: the session's
  challenge is `SELECT_CHALLENGE`, and the choice goes in `ANSWER`.

## Signing in from an automated browser

Turnstile fails in a remote-debugged Chrome, so the dev API holds a test bypass (*Auth model* in
`docs/DECISIONS.md`). To use it on the dev server:

1. Put the value of dev's GitHub environment secret `BOT_CHECK_BYPASS` in
   `~/.quirenote/bot-check-bypass.txt`, one line, readable by you alone. The deploy writes the same
   value to `/quirenote/dev/bot-check-bypass`.
2. Restart `pnpm dev`: `vite.config.ts` reads the file once, at startup, and the `/relay` proxy adds
   it as `x-bot-check-bypass`. With no file, the proxy adds nothing.
3. Open `http://localhost:3300/sign-in?botcheck=test`. The query renders Cloudflare's always-pass
   test widget, whose token dev's siteverify refuses; the header is what lets it through. Without
   the query, the page renders dev's real widget, but while the file is there every start is
   still admitted by the header; move the file away to sign in through siteverify locally.

To rotate the value, write a new one, no shorter than `BYPASS_FLOOR` in `src/bot-check.ts` and
without whitespace, to the secret and the file, restart `pnpm dev`, and run
`gh workflow run deploy-backend.yml --ref dev`: a secret alone starts no deploy. The relay keeps a
read for `BYPASS_TTL_MS`, so the old value stops working within that window of the deploy. A secret
unset, short or holding whitespace fails the dev deploy.

## Deploying

Region **`eu-north-1`**, the same as Amplify; Aurora DSQL is available there and is PostgreSQL 16
compatible. Deployed by GitHub Actions, never from a developer machine — there are no AWS
credentials locally and there should not be (`docs/reference/DEPLOYMENT.md`). The backend uses its
**own** OIDC roles, one per environment and separate from the frontend's, so the frontend deploy
roles stay unable to touch hosting config. CloudFormation runs each environment's stacks as that
environment's own execution role, and every role a stack creates carries that environment's
permissions boundary; the four policies are the files under [`iam/`](iam/), applied by hand
(`docs/role-cfn-exec.md`).

## infra/docs/

| File | Holds |
|---|---|
| [`docs/dsql-constraints.md`](docs/dsql-constraints.md) | Every DDL statement DSQL accepts or refuses, and the `ALTER TABLE` create-time-only matrix |
| [`docs/console-setup.md`](docs/console-setup.md) | One-time console setup, SES, the artifacts bucket |
| [`docs/role-deploy.md`](docs/role-deploy.md) | Roles 1 — `quirenote-backend-deploy-dev` and `-prod` |
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — `quirenote-backend-cfn-exec-dev` and `-prod`, the boundary each requires, what separates the environments, and the traps — one of them is why the user stacks are named as they are |
