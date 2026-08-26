# infra/ — the AWS backend

Phase 1 only: a daily job that captures the Inzhur price feed into Aurora DSQL.
Design and rationale live in `docs/superpowers/specs/` —
`2026-08-04-cloud-stack-and-cost.md` (why this stack) and
`2026-08-04-data-model.md` (what is stored and why).

**The app does not read any of this yet.** Nothing in `src/` knows the backend
exists. Phase 1 buys one thing: prices stop being lost on days the app is not
opened. **D72 narrows what that means:** what is unrecoverable is the Inzhur
DEALER QUOTE, which exists nowhere else. The funds' own history is published as
Excel on the site through June 2026, and bond history at NBU fair value is
already held here from each bond's issuance — a different basis, never a
substitute (~0.9% same-day divergence, D26/D27).

## Layout

| Path | What |
|---|---|
| `template.yaml` | SAM stack: DSQL cluster, capture Lambda, schedule, DLQ, alarms |
| `src/capture.ts` | The handler. Imports the parser from `src/core` — never a second copy |
| `migrations/` | Reference DDL. The handler applies it idempotently on cold start |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection, vault lock — deliberately outside the stack |

## Local rules

- **Never add a VPC.** A NAT Gateway is ~$33/month — roughly 1600× the rest of
  the stack. DSQL is a public IAM-authenticated endpoint and Lambda has internet
  egress by default, so nothing here needs one.
- **Never enable provisioned concurrency or SnapStart.** Both void Lambda's
  always-free tier for that function. Fix cold starts with `Timeout`, not these.
- **The parser is imported from `src/core`, never reimplemented.** Two parsers
  eventually disagree about a price, and only one of them is tested.
- **One DDL statement per transaction, and DDL never shares a transaction with
  DML** — a DSQL constraint, not a style choice. Same for `CREATE INDEX ASYNC`.
- **`price_capture` rows are append-only.** A row is written on every run,
  including failures: this table, not the absence of a price row, is what
  answers "did the job run".
- **Backups stay OUT of `template.yaml`.** A vault inside the stack it protects
  is destroyed by the accident it exists for. See `scripts/bootstrap-backups.sh`.
- **The backup selection matches on the `app=quirenote` TAG, never an ARN.**
  DSQL cluster IDs are generated, so a recreated cluster gets a new ARN and an
  ARN-pinned selection would back up nothing without saying so.
- **Never let an output alias shadow the column you `ORDER BY`.** `to_char(as_of,
  …) AS as_of` plus `ORDER BY as_of` binds the sort to the TEXT output, not the
  indexed date; the sort cannot inherit index order, `LIMIT` stops bounding
  anything and the planner scans the table — measured at **64.989 DPU against
  9.508** for the same query naming the column (D91). `observeNbu` still has this
  shape and is bounded only by its `BETWEEN` window: **0.356 DPU over 7 days,
  64.979 if the range is opened** (a manual `{observe:{}}`).
- **A query that runs per source is not verified until every branch is planned.**
  D48 recorded one figure for a two-branch call; the branch it did not plan
  matched 58% of the table instead of 0.3% and scanned nightly for a week.
- **Do NOT drop `price_capture_as_of` as dead weight.** D48 called it that
  because no query led with it; `observeNbu`'s `WHERE as_of BETWEEN` does, and it
  is the only thing keeping that query off a full scan.
- **The vault lock stays GOVERNANCE, and its floor never EXCEEDS the plan's
  `DeleteAfterDays`.** Equal is fine and is what ships (35/35) — AWS accepts a
  job whose retention is equal to *or longer than* the floor. What is never safe
  is a floor **above** live retention, and it can arise from either side: raising
  the floor before the plan moves, or shortening the plan below a floor already
  standing. The script derives the floor from the live plan, so the first cannot
  happen through the script — the second still can, by editing the plan directly,
  so **lower the floor first**. Why governance, and why no maximum: **D89**.

## Where the rest of this README is

**Split 2026-08-26 (D95)** — moved **verbatim** into [`docs/`](docs/) so no file exceeds 200 lines. Nothing was summarised, and every measured figure is where it was written. **`docs/console-setup.md`, `docs/role-deploy.md` and `docs/role-cfn-exec.md` are `### ` sections of the Deploying chapter below** and read as part of it.

| File | Holds |
|---|---|
| [`docs/durability.md`](docs/durability.md) | Durability — measured 2026-08-11, not assumed · First scheduled night, measured 2026-08-12 · Vault Lock, applied 2026-08-25 (D89) |
| [`docs/console-setup.md`](docs/console-setup.md) | Is reading the Inzhur feed sanctioned? — checked 2026-08-14 · SES, created by hand and outside the stack (2026-08-14) · One-time console setup · The artifacts bucket, if the account is ever rebuilt |
| [`docs/role-deploy.md`](docs/role-deploy.md) | Role 1 — quirenote-backend-deploy |
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — quirenote-backend-cfn-exec · The two traps, restated because they cost eight CI cycles last time |
| [`docs/field-notes.md`](docs/field-notes.md) | Field notes — things only the first deploy revealed · 2026-08-11 — the rename, and three things it uncovered |
| [`docs/dpu.md`](docs/dpu.md) | W2 — a week of real DPU, measured 2026-08-17 · Re-measured 2026-08-25 — an aliased ORDER BY was disabling the index (D91) |
| [`docs/frozen-feed.md`](docs/frozen-feed.md) | W1 — the frozen-feed detector on real data, measured 2026-08-18 · A20's deploy failed first, and nothing local could have caught it |
| [`docs/migrations-and-checks.md`](docs/migrations-and-checks.md) | A19 — the as_of migration, run 2026-08-18 · A6 — the DCF check runs nightly now, 2026-08-18 |

## Deploying

Region: **`eu-north-1`** — same as Amplify. Aurora DSQL is available there
(`dsql.eu-north-1.api.aws`); DSQL is PostgreSQL 16 compatible.

Deployed by GitHub Actions, not from a developer machine — there are no AWS
credentials locally and there should not be. See `docs/reference/DEPLOYMENT.md`.

The backend uses its **own** OIDC role, separate from `quirenote-frontend-deploy`,
so the existing frontend deploy role stays unable to touch hosting config
(D15).

## Phase 2 gate

After ~3 weeks of captures, the raw archive answers what a schema decision would
otherwise guess: weekend and holiday refresh behaviour, yield stability, fund
NAV cadence, payload byte-stability, outage shape. Only then is the observation
schema written, and backfilled from the payloads already stored.

Free observation already scheduled: **2026-09-23**, the cum/ex boundary on
UA4000238976 (≈1081.82 cum vs ≈1003.42 ex).
