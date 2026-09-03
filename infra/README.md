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
| `template.yaml` | SAM stack: DSQL cluster, capture Lambda, schedule, DLQ, alarms |
| `src/capture.ts` | The handler. Imports the parser from `src/core` — never a second copy |
| `schema/user.ts` | Drizzle source for `migrations/drafts/003_user_schema.sql` — the SQL is generated from this file and a hand edit fails `src/schema-generated.test.ts` |
| `migrations/` | **Reference DDL — nothing reads it.** The applied archive DDL is inline in `ensureSchema`; these files are the pinned contracts, cited from comments in `capture.ts`. `001` price_capture · `002` price_observation · `004` bond_terms — `003` is reserved for W7's user-schema draft |
| `migrations/drafts/` | **W7's user schema (`003_user_schema.sql`), applied by nothing.** Generated from [`schema/user.ts`](schema/user.ts); DSQL facts and the promotion rule are [`migrations/drafts/README.md`](migrations/drafts/README.md). Executed by `src/user-schema.test.ts` against real Postgres in WASM |
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
  DSQL cluster IDs are generated, so a recreated cluster gets a new ARN.
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
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — `quirenote-backend-cfn-exec`, and the two traps that cost eight CI cycles |
