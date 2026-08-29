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
| `schema/user.ts` | Drizzle source for `migrations/drafts/003_user_schema.sql` — the SQL is generated from this file and a hand edit fails `src/schema-generated.test.ts` |
| `migrations/` | **Reference DDL — nothing reads it.** The applied archive DDL is inline in `ensureSchema`; these files are the pinned contracts and are cited from comments in `capture.ts`. Keeping them in step with `ensureSchema` is manual (A51 found the README claiming otherwise) |
| `migrations/drafts/` | **W7's user schema (`003_user_schema.sql`), applied by nothing.** Generated from [`schema/user.ts`](schema/user.ts) — the pinned choices live there, beside the code they govern; DSQL facts and the promotion rule (including how this stops being a draft) are [`migrations/drafts/README.md`](migrations/drafts/README.md); the migration data problems are [`../docs/reference/w7-migration-translations.md`](../docs/reference/w7-migration-translations.md). Executed by `src/user-schema.test.ts` against real Postgres in WASM — 42 tests, every constraint exercised |
| `scripts/bootstrap-backups.sh` | AWS Backup vault, role, plan, selection, vault lock — deliberately outside the stack |

## Local rules

- **`pnpm typecheck` does NOT read this folder — run `pnpm exec tsc --noEmit -p infra`**
  (from the repository root, after `npm ci` here — see below). **Run it for a
  change to the six SHARED files this program compiles as well** —
  `src/core/types.ts`, `dates.ts`, `inzhur/{parse,dcf}.ts`,
  `nbu/{date,fair-value}.ts` (`--listFiles` names them). The two tsconfigs
  differ, so a DOM type added there passes every root gate and reddens CI after
  the merge, on work that never touched this folder.
  Root `tsconfig.json` includes only `src`, `vite.config.ts` and `scripts`, so a
  type error here passes all four local gates and esbuild strips it on the way
  out. **CI now catches it** — `deploy-backend.yml` runs `pnpm exec tsc --noEmit -p
  infra` and `pnpm lint` before any credential exists (issue #30) — but CI runs
  after the merge, so locally it is still yours. **Two prerequisites, both easy to
  miss:** `pnpm exec`, never bare `npx`, because this folder declares neither
  `typescript` nor `@types/node` and both come from the root tree; and
  **`npm ci` in this folder first**, because `capture.ts` imports `pg` and three
  `@aws-sdk/*` packages that live in `infra/node_modules`, which a root
  `pnpm install` never creates. On a fresh clone, skipping it fails with TS2307
  on four modules and reads as a broken instruction rather than a missing step.
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
  9.508** for the same query naming the column (D91). **A50 (2026-08-26) removed
  the shape from both remaining queries** — `observeNbu` and the `diagnose`
  sample on `price_observation` — and the two sort clauses had to move together,
  because Postgres requires the `DISTINCT ON` expressions to match the leading
  `ORDER BY` ones. Guarded from here on by `src/order-by-alias.test.ts`.
- **What A50 did NOT do, and must not be read as having done.** It did not close
  the **64.979 DPU** exposure of a manual `{observe:{}}`. That figure comes from
  the OPEN RANGE — `from` defaults to `NBU_ARCHIVE_START` — and
  `NEWEST_CAPTURE_PER_DATE` carries no SQL `LIMIT`: `ObserveRequest.limit` is
  applied in JS after every row is already fetched, and `DISTINCT ON` must
  consider the whole window regardless. D91 said it plainly: *Only the window
  stands between it and the same scan.* Its 6.8x win was measured on the streak
  query, which ends in `LIMIT 60` — naming the column let the planner stop
  early, and there is no early stop to unlock here. **A plain `LIMIT` is ruled
  out** — the recorded plan puts a `Sort` above the `Full Scan`, and a `Sort`
  consumes its whole input before it yields a row. A per-invocation **date-range**
  cap is still viable and now has a measured ceiling (~1500 days, below);
  `PLAN-OPEN.md` O32 carries what is undecided.
- **Re-planned twice on 2026-08-26 — the plan moved, the cost did not (D97).**
  Full working in [`docs/replan-a50.md`](docs/replan-a50.md). The window branch now plans as
  **`Incremental Sort` with `Presorted Key: as_of`** where the aliased form
  planned a full `Sort` on the text expression, so DSQL *can* serve the
  mixed-direction order (`as_of` ASC, `requested_at` DESC) from an ASC/ASC
  index — that question is closed. But warmed and alternated over four runs the
  two forms are **indistinguishable**: median total **0.25594 aliased against
  0.25599 qualified**, the qualified one marginally slower, per-run ranges fully
  overlapping. Read is **99.3%** of the total and identical to five digits in
  every run, because both scan the same 15 rows.
- **The first round said compute fell 9.1×. That was warmup**, caught in review:
  planning time fell 10.754 → 0.217 ms between two near-identical statements,
  which is a first parse, not a sort-key effect. **One `EXPLAIN (ANALYZE)` is
  not a measurement** — warm both forms, alternate the order, repeat, report the
  median, or report a plan shape and no numbers. **D91's 0.356 is UNREPRODUCED**
  — 0.26528 warm on D91's own window, identical for both forms, and neither
  warmup (0.55% of Read), window content nor query form accounts for the gap. Its
  cause is unknown, which is weaker than "superseded" and is what the evidence
  supports. **64.979 has never been re-measured**, being one cold sample from the
  same session, and it is load-bearing for keeping `price_capture_as_of`.
- **And the same holds at every width tested.** Planned at nine ranges, both
  forms take `Index Scan using price_capture_as_of` out to **1500 days** and both
  fall to `Full Scan (btree-table)` from **2000 days**. **The alias never changed
  the access path** — only the sort node — so there is no window width at which
  this fix starts paying. That also sizes O32: a date-range bound up to ~1500
  days keeps the plan on the index.
- **The open range is unchanged, and now recorded rather than argued.** Both
  forms plan identically: `Unique` over `Sort` over `Full Scan (btree-table)`,
  `payload_gzip` in `Projections`, every predicate a `Filters` entry on the
  `Storage Scan`, `cost=3077.01..3081.10` in each — two decimals, and planner
  cost is in arbitrary units — with `rows=6628` on the B-Tree Scan, a planner
  ESTIMATE matching neither the 6,666 rows in the table nor the 3,867 the filter
  selects. Nothing measured says why; `ANALYZE`-ing the table would.
- **A plain SQL `LIMIT` would NOT fix it**, which corrects what A50 first filed.
  The recorded plan puts a `Sort` above the `Full Scan`, and a `Sort` consumes
  its whole input before yielding a row; D91's `LIMIT 60` paid off only because
  its input arrived index-ordered. Bounding the **date range** per invocation
  could — but `observeNbu` derives `complete`/`nextFrom` from
  `captures.length > dates`, so capping the range in SQL makes a truncated fetch
  look complete and stops the caller early. `PLAN-OPEN.md` **O32**, unanswered.
- **Read a plan, never infer one.** `{diagnose:true}` returns
  `plans.observeNbu` (the 7-day branch, with `ANALYZE`, so its DPU is real) and
  `plans.observeNbuOpenRange` (the open range, plan only). Verified while
  re-planning: DSQL accepts `EXPLAIN (VERBOSE)` without `ANALYZE` and prints no
  `Statement DPU Estimate` in that form, so the second says whether the scan is
  bounded and never what it costs — which is what keeps a diagnosis from costing
  what the defect costs.
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

**Split 2026-08-26 (D95)** — moved **verbatim** into [`docs/`](docs/) so no file exceeds 200 lines. Nothing was summarised, and every measured figure is where it was written. **`docs/console-setup.md`, `docs/role-deploy.md` and `docs/role-cfn-exec.md` are `### ` sections of the Deploying chapter below** and read as part of it. `docs/dsql-ddl-first-contact.md` and `docs/dsql-alter-limits.md` were **written there on 2026-08-27 and 2026-08-28, not moved** — the folder is where working notes live now, not only where the old README's halves landed.

| File | Holds |
|---|---|
| [`docs/durability.md`](docs/durability.md) | Durability — measured 2026-08-11, not assumed · First scheduled night, measured 2026-08-12 · Vault Lock, applied 2026-08-25 (D89) |
| [`docs/console-setup.md`](docs/console-setup.md) | Is reading the Inzhur feed sanctioned? — checked 2026-08-14 · SES, created by hand and outside the stack (2026-08-14) · One-time console setup · The artifacts bucket, if the account is ever rebuilt |
| [`docs/role-deploy.md`](docs/role-deploy.md) | Role 1 — quirenote-backend-deploy |
| [`docs/role-cfn-exec.md`](docs/role-cfn-exec.md) | Role 2 — quirenote-backend-cfn-exec · The two traps, restated because they cost eight CI cycles last time |
| [`docs/field-notes.md`](docs/field-notes.md) | Field notes — things only the first deploy revealed · 2026-08-11 — the rename, and three things it uncovered |
| [`docs/dpu.md`](docs/dpu.md) | W2 — a week of real DPU, measured 2026-08-17 · Re-measured 2026-08-25 — an aliased ORDER BY was disabling the index (D91) |
| [`docs/replan-a50.md`](docs/replan-a50.md) | A50's re-plan, 2026-08-26 — the plan moved and the cost did not, why round 1 was warmup, and why a SQL `LIMIT` cannot bound the open range (D97) |
| [`docs/dsql-ddl-first-contact.md`](docs/dsql-ddl-first-contact.md) | `003_user_schema.sql` against the real cluster, 2026-08-27 — `USING btree` refused and `ASYNC` mandatory, so promotion rewrites an index line twice; the CHECKs/UNIQUEs/DEFAULT enforced; an accepted async index is not a built one; and DSQL's foreign keys, which this repo said it had none of (D99) |
| [`docs/dsql-alter-limits.md`](docs/dsql-alter-limits.md) | What `ALTER TABLE` can and cannot do, 2026-08-28 — a constraint can be added later as `NOT VALID` but never validated; only `NOT NULL`, `DEFAULT`, column type and a `UNIQUE` constraint are create-time-only; drizzle emits foreign keys as post-hoc `ALTER TABLE`, so promotion would need a third rewrite rule (D100) |
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
