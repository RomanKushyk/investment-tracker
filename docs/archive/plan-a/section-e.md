# Section E — finishing the rename (D42)

> Closed Plan A work, moved **verbatim** from `../../plans/PLAN-NOW.md` on 2026-08-26. Holds E1, E2, E3, E4. Index: [`README.md`](README.md). **Not a task list — nothing here is executed.**

# Section E — Finish the rename (D42)

D41 renamed what a person reads. This finishes the job on every addressed
identifier. **Read the order before starting any step** — it is what makes the
whole thing reversible.

**The governing rule: deploy the new stack, verify it, only then delete the
old.** Never the reverse. At no point is there no working backend, and rollback
at every step is "keep the old stack". Two clusters and two schedules coexist
briefly; both write, last-write-wins on the per-date key, and the duplicate cost
at this scale is not measurable.

**Accepted costs, ruled on by the owner (D42):** two or three days of Inzhur
archive, covered by the spreadsheet that continues alongside. The NBU half
regenerates in full. `PLAN-WAITING.md` W1, W3 and W4 each slip by those same two
days, because the streak history and the observation window are per-cluster.

## E1 — App-side renames — `chore/rename-quirenote-app`

No AWS, fully reversible, and nothing here depends on E2–E4. Do it first so the
destructive phase starts from a clean tree.

- [x] `src/lib/sync.ts` — `DB_LOCK` and `SYNC_CHANNEL` to `quirenote-db` /
      `quirenote-sync`. **These persist nothing** — the only effect is that a tab
      left open across the deploy will not hear a tab opened after it, for one
      session.
- [x] `src/lib/db.ts` — `class KubushkaDB` → `QuirenoteDB`, and the Dexie names
      to `quirenote` / `quirenote-live`. **No IndexedDB migration is written**:
      live is empty and demo reseeds itself, which is the migration. The old
      databases are left on disk rather than deleted — a rename that also
      destroys data is two operations pretending to be one.
- [x] `src/state/settings.ts` and `src/state/draft.ts` — keys to
      `quirenote-settings` / `quirenote-draft`, **with a real migration**: on
      boot, if the new key is absent and the old one present, copy it across and
      then remove the old. Here the key *is* the data, so a bare rename silently
      discards currency, ₴/$ rate and every dismissed reminder. The settings
      store already has the `migrate` hook (G3) this belongs in.
- [x] `src/core/backup/json.ts` — the marker becomes `quirenote-backup`, full
      stop. Dual acceptance was written and then removed on the owner's
      correction: one user, no real data, so keeping the old marker readable was
      flexibility nobody asked for. The D41 mismatch message goes with it.
- [x] `package.json` `name`.
- [x] `navigation-map.md` — the DB names and localStorage keys appear in roughly
      fifteen checkpoints; all of them move.

**Done 2026-08-11.** Verified in the browser, not only in tests: an old-key
profile with currency USD, rate 41.5, lead time 14, a dismissal and a quote
draft all survived the reload under the new keys, with the old keys gone;
demo reseeded under `quirenote` to 4/174/18 with every D5-pinned figure
intact; and a fresh export carries the new marker. Six tests cover the migration paths. 512 tests green.

**Verify (browser, not just tests):** set a non-default currency and ₴/$ rate and
dismiss a reminder → reload → **all three survive** under the new key. Demo
reseeds under `quirenote` and every D5-pinned figure holds. A backup file
exported before this branch still imports. A fresh export carries the new marker.
Gates green.

## E2 — New IAM roles — console, owner-driven

Additive. The old roles stay until E3 is finished, so this step cannot break a
deploy.

**Three roles are manual, not two.** The account holds five `kubushka-*` roles
and they are two different things:

| Role | Owner | Action |
|---|---|---|
| `kubushka-backend-CaptureFunctionRole-*` | **the stack** | none — SAM recreates it as `quirenote-backend-CaptureFunctionRole-*` on the E3 deploy |
| `kubushka-backend-SchedulerRole-*` | **the stack** | none — same |
| `kubushka-backend-deploy` | manual | recreate |
| `kubushka-backend-cfn-exec` | manual | recreate |
| `kubushka-github-deploy` | manual | recreate — **the frontend role, missed when this section was written** |

The two stack-owned roles carry a generated suffix because CloudFormation
names them `<stack>-<LogicalId>-<hash>`. They vanish with the old stack and
reappear under the new name by themselves; creating them by hand would
collide with the stack.

**Naming is fixed at the same time, because the old scheme was inconsistent.**
`kubushka-github-deploy` was named for its mechanism while
`kubushka-backend-deploy` was named for its target — and both are assumed by
GitHub Actions, so "github" distinguished nothing. The scheme becomes
`quirenote-<target>-<function>`.

- [x] Create `quirenote-backend-deploy` — same OIDC trust policy and repo/branch
      condition as its predecessor.
- [x] Create `quirenote-backend-cfn-exec` — trusted by CloudFormation only. **Verified 2026-08-18:** both roles exist, created 2026-08-11.
- [x] **Rewrite every `kubushka-backend-*` prefix**, and there are more than the
      stack name: the exec policy scopes **eight** ARN patterns —
      `cloudformation`, `lambda`, `iam`, `logs`, `sqs`, `sns`, `cloudwatch`,
      `scheduler`. Miss one and the deploy fails on a permission, which this
      project has already paid for eight times (`infra/README.md` field notes).
      The `iam:*` prefix scoping matters most: SAM creates the function's
      execution role named after the stack, so it becomes `quirenote-backend-*`.
- [x] Add the new deploy-role ARN to GitHub. Keep the old secret value recorded —
      switching back is the rollback.
- [x] **`quirenote-frontend-deploy`** (was `kubushka-github-deploy`) — **done 2026-08-11**, verified end to end: run `31512461483` green through `configure-aws-credentials` and the Amplify deploy, and the live site serves `<title>Quirenote — Invest Tracker</title>` with `/overview` still rewriting to 200. — trust
      policy byte-identical, permission policy in `docs/reference/DEPLOYMENT.md` §1.5a.
      Independent of E3 and carrying no data risk: it touches Amplify only, the
      site keeps serving its last successful build, and it can be verified
      immediately by re-running the frontend workflow. Do it now rather than
      waiting for the stack.

## E3 — The stack move — the only destructive phase — **DONE 2026-08-11 (D46)**

> Verified after the fact: one stack, one cluster, one schedule, five alarms
> in OK, no `kubushka-*` role, one bucket, and the NBU archive closed
> 2016-01-04 → 2026-08-10. Cost was two days of Inzhur, exactly as ruled.
> Three defects nobody was looking for surfaced on the way — two orphaned
> clusters, a dead alert channel, and a backfill that failed every historical
> date — all of them predating the move.

> **FIRST: re-enable the backend workflow.** It was disabled on 2026-08-11
> (`gh workflow disable deploy-backend.yml`) so that pushing the E1–E3 commits
> would not create the new stack as a side effect — `deploy-backend.yml`
> triggers on `infra/**`, and those commits touch it. Until
> `gh workflow enable deploy-backend.yml` runs, **a deploy will silently not
> happen**, which is the worst failure mode available: no error, no stack, and
> a schedule everyone assumes is armed.

**Timing:** start in the Kyiv morning. The 01:00 capture then has a full day of
margin, and if anything goes wrong the old stack is still running and still
capturing.

- [ ] **Record the baseline first**: row count per source, `min(as_of)`,
      `max(as_of)`. Loss should be measurable afterwards, not assumed.
- [ ] Point the workflow at the new names — `--stack-name quirenote-backend`,
      `--role-arn …/quirenote-backend-cfn-exec` — and switch
      `AWS_BACKEND_ROLE_ARN` to the new deploy role.
- [ ] Deploy. **The new stack comes up beside the old one.** Both schedules now
      exist; if one 01:00 fires before teardown, both write and the per-date key
      absorbs it.
- [ ] Verify the new stack before touching the old: manual invoke returns `ok`
      for **both** sources, the five alarms and two metric filters exist, the
      schedule is armed with `Europe/Kyiv`.
- [ ] Re-run the NBU backfill from `2016-01-04` on the new cluster. Verified
      idempotent; re-run until it reports `complete: true`.
- [ ] **Only now tear down the old.** In this order: disable the old schedule so
      it stops writing → clear `DeletionProtectionEnabled` on the old cluster →
      delete the old stack (the cluster is retained by policy) → delete the
      orphaned old cluster by hand.
- [x] Confirm the bill returns to baseline — two clusters existed for a while and
      exactly one should remain. **Verified 2026-08-14:** `dsql list-clusters`
      returns exactly one, and August month-to-date across the whole account is
      **$0.0000050** — Lambda, S3 and CloudShell only. DSQL and AWS Backup bill
      nothing at this size, so the double-cluster window cost nothing either.
- [x] Delete the old IAM roles. **Verified 2026-08-14:** no role matching
      `kubushka` exists; the six that remain are all `quirenote-*`.

**Rollback at any point before the teardown:** switch the GitHub secret and the
workflow back. The old stack never stopped working.

## E4 — The last identifiers and the docs — **DONE 2026-08-11**

> `infra/README` now documents only the roles that exist, with the move's
> field notes appended; `DEPLOYMENT` §1.5/§1.5a describe the current role and
> keep only the two lessons the cutover taught; `CLAUDE.md` warns that the
> missing SNS topic is deliberate. The Amplify **app name** stays `kubushka`
> in the console — cosmetic, and the App ID it does not change is what the URL
> depends on.

- [x] `infra/src/capture.ts` — `USER_AGENT`. **Done 2026-08-14:** the custom
      domain is live, so the URL is now `https://quirenote.com`. It pointed at
      the Amplify URL until then, because a User-Agent that points nowhere is
      worse than one that points somewhere old.
- [x] `infra/README.md` — both role policies verbatim, every prefix, and a field
      note recording what the move actually cost.
- [x] `docs/reference/DEPLOYMENT.md`, `docs/README.md` backend table, `CLAUDE.md` key facts.
- [x] Amplify app name in the console — **renamed `kubushka` -> `quirenote`
      2026-08-14.** Cosmetic, as predicted: the App ID `d17m4jf400my6` is what the
      URLs and every IAM ARN reference, and it does not change with the name.
- [x] Update `PLAN-WAITING.md` W1/W3/W4 dates by the days actually lost, measured
      against the E3 baseline rather than estimated.

---

