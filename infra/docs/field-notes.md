# infra — field notes, and what the rename uncovered

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). Things only a real deploy revealed.

## Field notes — things only the first deploy revealed

Nine runs, eight failures. Recorded because none of these are in the docs that
were read beforehand, and each cost a cycle.

- **`sam build` cannot see sibling directories.** Both the builtin esbuild
  builder and the makefile builder copy `CodeUri` into a sandbox first, so the
  handler's `../../src/core` imports resolve to nothing. The workflow therefore
  runs esbuild itself and hands SAM a finished bundle (`CodeUri: dist/`, no
  `BuildMethod`).
- **Bundle as CJS, not ESM.** `pg` is CommonJS and requires node builtins; an
  ESM bundle dies at first invoke on `Dynamic require of "events"`.
- **Do not mark `@aws-sdk/*` external.** `dsql-signer` is recent and assuming the
  Lambda runtime ships it is an untested bet. Bundling costs ~800 KB.
- **DSQL rejects `DESC` in index keys** — *"specifying sort order not supported
  for index keys"*. Not in the documented compatibility differences.
- **DSQL needs a service-linked role** (`AWSServiceRoleForAuroraDsql`). Creating
  a cluster normally creates it, but only if the caller holds
  `iam:CreateServiceLinkedRole`. Created once in `bootstrap-account.sh` instead
  of widening the execution role.
- **Metric filters are their own permission family.** `logs:PutMetricFilter`, `DeleteMetricFilter` and `DescribeMetricFilters` are not covered by the log-group actions a Lambda needs; adding a metric filter failed on `DescribeMetricFilters` alone.
- **The DSQL CloudFormation handler calls more than the template uses** —
  `GetClusterPolicy`, `GetVpcEndpointServiceName` — regardless of whether the
  template sets those properties. Grant a handler its whole surface, not the
  minimum the property docs imply.
- **The SAM transform is expanded by the EXECUTION role**, so it needs
  `cloudformation:CreateChangeSet` on
  `arn:aws:cloudformation:<region>:aws:transform/Serverless-2016-10-31`.
  Granting it to the calling role is not enough.
- **A new AWS account cannot use `ReservedConcurrentExecutions`** — reserving any
  concurrency drops the unreserved pool below the required floor of 10.
- **A stack that fails its first create lands in `ROLLBACK_COMPLETE`** and cannot
  be updated; the next deploy fails with a misleading "cannot be updated".
  `bootstrap-account.sh` clears it.

### 2026-08-11 — the rename, and three things it uncovered

The stack moved from `kubushka-backend` to `quirenote-backend` by deploying the
new one **beside** the old and deleting the old only after verification. That
order is the whole reason the day was uneventful: the new stack ran alongside
for about an hour while two code defects were found and the alert channel was
rebuilt from nothing. Under a delete-first order each of those is an incident.

- **`DeletionPolicy: Retain` leaves a cluster behind when a stack CREATE rolls
  back.** Two orphaned DSQL clusters from the failed deploys of 2026-08-10 were
  sitting deletion-protected and owned by nothing. Nobody knew. If a deploy ever
  fails at cluster creation again, check `dsql list-clusters` afterwards.
- **The alerting was dead and every indicator said healthy.** Zero failed
  notifications means nothing was *attempted*, not that anything succeeded. SNS
  had deactivated the email subscription; three replacements died within seconds
  of confirmation, across two topic ARNs. Email is abandoned — delivery is now
  EventBridge → AWS User Notifications → Console Mobile App, and the capture
  reports its own channel count on every run (D44, D45, D47).
- **A subscription SNS has deactivated cannot be removed via CloudFormation.**
  CFN calls `Unsubscribe` with the ARN it stored, which SNS has replaced with
  the literal string `Deleted`, and the deploy fails with *"An ARN must have at
  least 6 elements, not 1"*. The only way out is deleting the topic.
- **CloudWatch publishes alarm state changes to EventBridge for every alarm,
  regardless of `AlarmActions`.** The stack now has six alarms and no SNS topic
  at all, and alerting works.
- **`role-to-assume` needs a full ARN, and a bare role name does not error** —
  `configure-aws-credentials` retries the STS call with backoff, so the step
  hangs for minutes and reads as a slow runner. A long
  `configure-aws-credentials` is itself the symptom.
- **The notifications API answers only in `us-east-1`** and refuses the call
  elsewhere by name.

Cost of the move, measured: two days of Inzhur captures (`as_of` 2026-08-09 and
2026-08-10). The NBU half regenerated in full from its public archive.

Verified live 2026-08-10: `{"ok":true,"asOf":"2026-08-09","entries":35}`, one row
in `price_capture`. **The alerting claim in that line was wrong** — see the
2026-08-11 notes below.
