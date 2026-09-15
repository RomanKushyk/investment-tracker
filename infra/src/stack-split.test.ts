import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from '../../src/repo-root';
import { NO_BACKUP_HOURS } from './backup-age';
import { FREE_TIER_USERS } from './pool-usage';

// The archive is provider data shared by every environment and user data is not
// (`docs/DECISIONS.md`, **Cloud target**), so the split is two templates: one archive
// stack, one user stack deployed once per environment. What this file guards is the
// half of that arrangement no test can reach from inside a handler — the templates
// themselves, and the workflow that chooses which stack a branch deploys.
//
// Parsed with `parseDocument`, and only `errors` is asserted. Every intrinsic tag is an
// unresolved tag to a YAML parser, so a healthy template warns once per
// `!GetAtt`/`!Sub`/`!If` — a count that moves whenever anyone edits either file, which
// is why no assertion names it and why none is written down here.
// `!GetAtt UserCluster.Endpoint` arrives here as the plain string
// 'UserCluster.Endpoint', which is what the endpoint assertions below match.

type Resource = {
  Type: string;
  Condition?: string;
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties?: {
    Handler?: string;
    DeletionProtectionEnabled?: boolean;
    Environment?: { Variables?: Record<string, string> };
    Tags?: { Key: string; Value: unknown }[];
    Policies?: unknown;
    Namespace?: string;
    MetricName?: string;
    Dimensions?: { Name: string; Value: unknown }[];
    FilterPattern?: string;
    MetricTransformations?: {
      MetricNamespace?: string;
      MetricName?: string;
      MetricValue?: string;
      Dimensions?: { Key: string; Value: unknown }[];
    }[];
    Threshold?: number;
    EvaluationPeriods?: number;
    Period?: number;
    Statistic?: string;
    ComparisonOperator?: string;
    TreatMissingData?: string;
    AlarmActions?: unknown;
    Target?: { Arn?: unknown };
    ScheduleExpression?: string;
    ScheduleExpressionTimezone?: string;
  };
};

type Template = {
  Parameters?: Record<string, { Type: string; AllowedValues?: string[] }>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, unknown>;
};

const templateDoc = (name: string) =>
  parseDocument(readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));

const archiveDoc = templateDoc('template.yaml');
const userDoc = templateDoc('template-user.yaml');
const userSource = readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8');

/** One resource's own slice of the template SOURCE, for the assertions that have to see an
 *  intrinsic tag — `toJS()` drops it and keeps the scalar, so a `!Ref` and a literal spelt
 *  the same way are indistinguishable after parsing.
 *
 *  SCOPED, BECAUSE AN UNSCOPED REGEX OVER THE WHOLE FILE IS THE BUG IT IS MEANT TO CATCH:
 *  `USER_POOL_ID: !Ref UserPool` appears three times here, so a pattern matching anywhere
 *  passes on another function's line whatever this one says. */
const resourceSource = (id: string) => {
  const start = userSource.search(new RegExp(`^ {2}${id}:\\r?$`, 'm'));
  if (start === -1) throw new Error(`no such resource in the template source: ${id}`);
  const rest = userSource.slice(start);
  const next = rest.slice(1).search(/^ {2}[A-Za-z][\w]*:\r?$/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

const archive = archiveDoc.toJS() as Template;
const user = userDoc.toJS() as Template;

const resources = (t: Template) => Object.entries(t.Resources);
const idsOfType = (t: Template, type: string) =>
  resources(t)
    .filter(([, r]) => r.Type === type)
    .map(([id]) => id);
const handlers = (t: Template) =>
  resources(t)
    .map(([, r]) => r.Properties?.Handler)
    .filter((h): h is string => h !== undefined);

const CLUSTER = 'AWS::DSQL::Cluster';

describe('the archive stack holds the archive and nothing else', () => {
  // An anchor, for the reason `src/github-landing-page.test.ts` opens with one: the
  // absence assertions below pass just as well against a file that failed to parse.
  //
  // ERRORS, NEVER WARNINGS. A CloudFormation template's intrinsic tags are unresolved
  // as far as a YAML parser is concerned, so it warns once per `!GetAtt`/`!Sub`/`!If`
  // — a healthy state, and a count that changes whenever anyone edits either template.
  it('parses as a template — errors only, because the intrinsics are all warnings', () => {
    expect(archiveDoc.errors).toEqual([]);
    // AND THAT IT HAS RESOURCES AT ALL. An empty file parses with no errors and no
    // warnings, so `errors` alone lets every absence assertion below pass against
    // nothing — the suite would still redden, but downstream on a TypeError rather
    // than here, which is the failure an anchor exists to prevent.
    expect(archive.Resources).toBeDefined();
  });

  it('declares exactly one cluster, and it is the archive', () => {
    expect(idsOfType(archive, CLUSTER)).toEqual(['PriceCluster']);
  });

  it('keeps that cluster retained and deletion-protected', () => {
    const cluster = archive.Resources.PriceCluster;
    expect(cluster.DeletionPolicy).toBe('Retain');
    expect(cluster.UpdateReplacePolicy).toBe('Retain');
    expect(cluster.Properties?.DeletionProtectionEnabled).toBe(true);
  });

  // The runner moved out with the data it applies. Left behind it would hold
  // `dsql:DbConnectAdmin` on the archive, which is the one cluster no migration of
  // ours may touch.
  it('no longer ships the migration handler, nor names it in an output', () => {
    expect(handlers(archive)).not.toContain('migrate.handler');
    expect(Object.keys(archive.Outputs ?? {})).not.toContain('MigrateFunctionName');
  });
});

describe('the user stack holds user data and nothing else', () => {
  it('parses as a template', () => {
    expect(userDoc.errors).toEqual([]);
  });

  it('declares exactly one cluster, retained and deletion-protected', () => {
    expect(idsOfType(user, CLUSTER)).toEqual(['UserCluster']);
    const cluster = user.Resources.UserCluster;
    expect(cluster.DeletionPolicy).toBe('Retain');
    expect(cluster.UpdateReplacePolicy).toBe('Retain');
    expect(cluster.Properties?.DeletionProtectionEnabled).toBe(true);
  });

  // An ALLOW-list, not a deny-list of the archive's types. A deny-list is a hole
  // where the next archive resource goes.
  //
  // It grew from three types to ten when the pool arrived and to eleven when the API
  // did, and the widening is the point rather than a concession: identity splits per
  // environment exactly as user data does (`docs/DECISIONS.md`, **Auth model**), so the
  // pool belongs beside the cluster it matches and the list has to say so out loud. The
  // API is here on the same argument — it is the door to those rows and to no others.
  //
  // A SCHEDULE, A ROLE FOR IT, A METRIC FILTER AND AN ALARM ARE NOW HERE TOO, and this
  // list used to name three of the four as the archive's half. They are not: monitoring follows the CLUSTER,
  // the same way the runner follows the schema it applies. Prod's user cluster is in the
  // locked vault and nothing reported whether it was still landing there, because both
  // existing checks read the ARCHIVE's ARN — correctly, so that neither cluster can make
  // the other look fresh. The cost of that correctness is a second check, and it belongs
  // beside the cluster it reads.
  //
  // WHAT THE LIST STILL REFUSES is a second CAPTURE: no DLQ, and the schedule assertion
  // further down names the function each schedule targets rather than counting them.
  //
  // ONE ENTRY FOR THE API, not four, because `Domain:` is SAM's sugar: the transform
  // generates the `AWS::ApiGatewayV2::DomainName`, `::ApiMapping` and `::Stage` beside
  // it, and this test reads the template's source rather than its transform output.
  it('uses only the resource types user data and its identity need', () => {
    const allowed = new Set([
      CLUSTER,
      'AWS::Serverless::Function',
      'AWS::Serverless::HttpApi',
      'AWS::Logs::LogGroup',
      'AWS::Cognito::UserPool',
      'AWS::Cognito::UserPoolClient',
      'AWS::Cognito::UserPoolDomain',
      'AWS::Cognito::UserPoolIdentityProvider',
      'AWS::Cognito::ManagedLoginBranding',
      'AWS::Lambda::Permission',
      'AWS::IAM::Policy',
      'AWS::IAM::Role',
      'AWS::Scheduler::Schedule',
      'AWS::Logs::MetricFilter',
      'AWS::CloudWatch::Alarm',
    ]);
    for (const [id, r] of resources(user)) expect([id, allowed.has(r.Type)]).toEqual([id, true]);
  });

  // NO DEAD-LETTER QUEUE ANYWHERE IN THIS STACK, stated separately from the allow-list
  // above because that list only says what MAY appear. A DLQ is the capture's, and it is
  // there for a reason that does not hold here: a missed price is unrecoverable, where a
  // missed freshness reading is republished by the next firing.
  it('carries no queue', () => {
    expect(idsOfType(user, 'AWS::SQS::Queue')).toEqual([]);
  });

  // SIX FUNCTIONS NOW, AND THEY ARE NAMED RATHER THAN COUNTED. A count was what this
  // asserted while there was one; a count passes just as well against the wrong set.
  it('holds the runner, the trigger, the application, the approval and its two watches', () => {
    expect(handlers(user).sort()).toEqual([
      'applications.handler',
      'approve.handler',
      'backup-freshness.handler',
      'migrate.handler',
      'pool-usage.handler',
      'pre-signup.handler',
    ]);
  });

  it('its runner is pointed at the USER cluster', () => {
    const fn = user.Resources.MigrateFunction;
    expect(fn.Properties?.Handler).toBe('migrate.handler');
    const vars = fn.Properties?.Environment?.Variables ?? {};
    expect(vars.DSQL_ENDPOINT).toBe('UserCluster.Endpoint');
    // AND THAT IT IS STILL A `!GetAtt`. `toJS()` discards an unknown tag and keeps the
    // value, so the assertion above cannot tell the intrinsic from a hard-coded string
    // spelt the same way — which is what a debugging session pinning one cluster would
    // leave behind, green. The raw source is the only place the tag survives.
    expect(userSource).toMatch(/DSQL_ENDPOINT:\s*!GetAtt\s/);
    // The two ways this stack could quietly become a second archive: a variable
    // still naming the archive cluster, or the capture function's feed.
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
    expect(vars.FEED_URL).toBeUndefined();
  });

  // THE BACKUP DECISION, AND IT IS ONE SWAPPED `!If` ARM FROM SHIPPING PROD'S PORTFOLIO
  // OUT OF A LOCKED VAULT. The AWS Backup selection matches `app=quirenote` and nothing
  // else, and `quirenote-backups` is Locked with a 35-day retention floor — so the tag
  // is not "gets backed up", it is "produces recovery points nobody can delete for 35
  // days". Prod's cluster is worth that; dev's, which is the `migrations/` files and a
  // dispatch, is not. Asserted on the parsed intrinsic: `!If [IsProd, a, b]` reaches
  // here as the three-element array, and `!Equals [!Ref Environment, prod]` as two.
  it('tags prod into the backup selection and dev out of it', () => {
    expect(user.Conditions?.IsProd).toEqual(['Environment', 'prod']);
    expect(user.Resources.UserCluster.Properties?.Tags).toEqual([
      { Key: 'app', Value: ['IsProd', 'quirenote', 'quirenote-dev'] },
    ]);
  });

  // NO DEFAULT, and it is the tag above that makes it matter rather than tidiness: the
  // parameter that picks the environment is the parameter that picks the tag, so a
  // deploy which forgot `--parameter-overrides` would resolve silently to whichever
  // value was written here — and one of the two is production.
  it('takes the environment as a parameter with no default', () => {
    const p = user.Parameters?.Environment;
    expect(p?.AllowedValues).toEqual(['dev', 'prod']);
    expect(p).not.toHaveProperty('Default');
  });
});

// The other half of the tag decision above. Carrying `app=quirenote` puts prod's cluster
// in the locked vault; nothing reported whether it was still LANDING there, because both
// existing checks filter recovery points by the ARCHIVE's ARN. That filter is right — it
// is what stops one cluster's backup making another look fresh — so the answer is a
// second check reading this cluster's own ARN, in the stack that owns the cluster.
describe('the user stack watches its own cluster’s backups', () => {
  const WATCH = [
    'BackupFreshnessFunction',
    'BackupFreshnessLogGroup',
    'BackupFreshnessSchedule',
    'BackupFreshnessSchedulerRole',
    'UserBackupAgeMetricFilter',
    'UserBackupAgeAlarm',
    'BackupFreshnessSilenceAlarm',
    'BackupFreshnessErrorAlarm',
  ];

  /** Types this stack holds for monitoring and nothing else, so every one of them must
   *  be prod's. `AWS::IAM::Role` is deliberately NOT here: the watch brought the only one
   *  today, but a role is not a monitoring resource, and the next unrelated one — an API
   *  logging role, a second scheduler — would fail a test named for this check with a
   *  message pointing at the wrong thing. `WATCH` names that role instead. */
  const MONITORING = [
    'AWS::CloudWatch::Alarm',
    'AWS::Logs::MetricFilter',
    'AWS::Scheduler::Schedule',
  ];

  // DEV GETS NONE OF IT, and the condition is the only thing that says so. Dev's cluster
  // carries `app=quirenote-dev` and is deliberately outside the vault, so an alarm there
  // would watch a backup nobody asked for and read "no recovery point" every night from
  // the day it deployed.
  //
  // BOTH HALVES, AND THE SECOND IS DERIVED. The named list catches a resource that lost
  // its condition; it cannot catch the NEXT alarm somebody adds without one, because an
  // id missing from a hand-kept list is missing silently — and the allow-list above now
  // permits alarms, schedules and metric filters unconditionally, so nothing else would.
  // Named alone is the shape this file argues against twice in its own comments.
  it('deploys the whole check on prod only', () => {
    for (const id of WATCH) {
      expect([id, user.Resources[id]?.Type]).not.toEqual([id, undefined]);
      expect([id, user.Resources[id]?.Condition]).toEqual([id, 'IsProd']);
    }
    for (const [id, r] of resources(user))
      if (MONITORING.includes(r.Type)) expect([id, r.Condition]).toEqual([id, 'IsProd']);
  });

  // THE CLUSTER IT READS IS THIS STACK'S OWN. Pointed at the archive it would report a
  // number that is already reported, twice, and prod's user data would still be watched
  // by nothing — green, and the exact state this resource exists to end.
  it('reads the USER cluster’s ARN, and never the archive’s', () => {
    const vars = user.Resources.BackupFreshnessFunction.Properties?.Environment?.Variables ?? {};
    expect(vars.DSQL_CLUSTER_ARN).toBe('UserCluster.ResourceArn');
    // Still the intrinsic: `toJS()` drops an unknown tag and keeps the value, so the
    // assertion above cannot tell a `!GetAtt` from a pinned literal spelt the same way.
    expect(userSource).toMatch(/DSQL_CLUSTER_ARN:\s*!GetAtt\s+UserCluster\.ResourceArn/);
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
  });

  // ONE `!GetAtt`, READ TWICE, which is what makes "the number and the alarm are about
  // the same cluster" true rather than remembered. The metric line carries the id the
  // function is given and the alarm selects on the id the template resolves; spelled
  // apart, a replaced cluster would publish under one value while the alarm watched the
  // other — and the alarm would then sit on a series that never gets another datapoint.
  it('dimensions the metric and the alarm by the same cluster', () => {
    const vars = user.Resources.BackupFreshnessFunction.Properties?.Environment?.Variables ?? {};
    expect(vars.DSQL_CLUSTER_ID).toBe('UserCluster.Identifier');
    expect(user.Resources.UserBackupAgeAlarm.Properties?.Dimensions).toEqual([
      { Name: 'cluster', Value: 'UserCluster.Identifier' },
    ]);
    const [transformation] =
      user.Resources.UserBackupAgeMetricFilter.Properties?.MetricTransformations ?? [];
    expect(transformation?.Dimensions).toEqual([{ Key: 'cluster', Value: '$.cluster' }]);
  });

  // IT READS A BACKUP VAULT AND NOTHING ELSE. The ARN above is a string to this function
  // — it never connects — so a `dsql:` grant would be reach it has no use for, on the one
  // cluster in this system that holds somebody's portfolio.
  it('grants a read of the vault and no access to any cluster', () => {
    const policies = JSON.stringify(user.Resources.BackupFreshnessFunction.Properties?.Policies);
    expect(policies).toContain('backup:ListRecoveryPointsByBackupVault');
    expect(policies).not.toContain('dsql:');
    expect(policies).not.toContain('cognito-idp:');
  });

  // 48, FOR THE ARCHIVE'S REASON: the plan has a 60-minute start window, so a single late
  // or skipped night is normal operation and an alarm that pages for it gets muted. And
  // `NO_BACKUP_HOURS` has to clear that threshold, or "no recovery point at all" would be
  // published as a number the alarm reads as healthy.
  it('alarms at 48 hours, above the value that means no backup exists', () => {
    const alarm = user.Resources.UserBackupAgeAlarm.Properties;
    expect(alarm?.Threshold).toBe(48);
    expect(alarm?.TreatMissingData).toBe('notBreaching');
    expect(NO_BACKUP_HOURS).toBeGreaterThan(alarm?.Threshold ?? 0);
    expect(NO_BACKUP_HOURS).toBeGreaterThan(
      archive.Resources.BackupAgeAlarm.Properties?.Threshold ?? 0,
    );
  });

  // WHAT MAKES THE `notBreaching` ABOVE HONEST. The freshness value is published BY this
  // function, so its absence means the CHECK did not publish — the schedule died, or the
  // function threw — rather than that the backups stopped. In the archive's stack the
  // first is already covered by `SilenceAlarm` over the capture's invocations; nothing
  // covered either here, so `notBreaching` would have parked a dead check in OK forever.
  // One way for the value to go absent is still uncovered and is named in the template:
  // a run that succeeds and emits a line the metric filter no longer matches.
  it('watches the publisher too, so a dead check is not a quiet one', () => {
    const silence = user.Resources.BackupFreshnessSilenceAlarm.Properties;
    expect(silence?.Namespace).toBe('AWS/Lambda');
    expect(silence?.MetricName).toBe('Invocations');
    expect(silence?.Dimensions).toEqual([
      { Name: 'FunctionName', Value: 'BackupFreshnessFunction' },
    ]);
    expect(silence?.TreatMissingData).toBe('breaching');
    // TWO DAILY PERIODS, NOT ONE. Not because one missed firing would page — it would
    // not: CloudWatch pulls more datapoints from the evaluation range than
    // `EvaluationPeriods` asks for and ignores the missing-data treatment where it finds
    // enough real ones. It is the BOUNDARY: the window ends at now rather than at
    // midnight, so two runs more than 24h apart — jitter around a once-daily cron — can
    // empty a one-period window although every day had a run. The template says it at
    // length; this pins it.
    expect(silence?.EvaluationPeriods).toBe(2);
    expect(silence?.Period).toBe(86400);
  });

  // THE THIRD FAULT, AND THE ONE THE OTHER TWO CANNOT SEE. `backup-freshness.ts` throws
  // where the capture's equivalent warns, so a read it cannot make — a revoked grant, a
  // renamed vault, a missing variable — is a FAILED invocation. `Invocations` counts a
  // failed one too, so the silence alarm stays OK; and no age is published, so the age
  // alarm stays OK on `notBreaching`. Without this the check could fail every night with
  // both of its own alarms green, which is the silent-green class this whole family of
  // checks exists to end. The archive pairs the same three.
  it('alarms when the check itself fails, which neither other alarm can see', () => {
    const errors = user.Resources.BackupFreshnessErrorAlarm.Properties;
    expect(errors?.Namespace).toBe('AWS/Lambda');
    expect(errors?.MetricName).toBe('Errors');
    expect(errors?.Dimensions).toEqual([
      { Name: 'FunctionName', Value: 'BackupFreshnessFunction' },
    ]);
    expect(errors?.TreatMissingData).toBe('notBreaching');
  });

  // NO `AlarmActions` AND NO TOPIC, here as everywhere: CloudWatch publishes every state
  // change to EventBridge regardless, and the SNS topic was removed deliberately
  // (`docs/DECISIONS.md`, **Alerting**).
  it('carries no alarm action and adds no topic', () => {
    for (const id of [
      'UserBackupAgeAlarm',
      'BackupFreshnessSilenceAlarm',
      'BackupFreshnessErrorAlarm',
    ])
      expect([id, user.Resources[id].Properties?.AlarmActions]).toEqual([id, undefined]);
    expect(idsOfType(user, 'AWS::SNS::Topic')).toEqual([]);
  });

  // THE HOUR IS DERIVED FROM ANOTHER FILE, so it is derived HERE rather than asserted in
  // a sentence. `bootstrap-backups.sh` owns the plan: its cron, its start window and its
  // completion window are what bound when a night's job can still be running, and a
  // check that ran before that bound would measure a job in flight and report yesterday.
  // Nothing coupled the two, so shortening `CompletionWindowMinutes` in the script would
  // have invalidated this schedule's reasoning silently.
  //
  // MINUTES PAST MIDNIGHT UTC ON BOTH SIDES, which is only comparable because both are
  // pinned to UTC — so BOTH timezones are read, the plan's out of the script and the
  // schedule's out of the template. That field is the one that makes the other three
  // comparable and the one most likely to be added later without thought: move the plan
  // to Europe/Kyiv and every number on its side shifts by two or three hours while this
  // test goes on passing. The plan's window crosses midnight (22:45 + 240 minutes), so
  // the worst case is taken modulo the day and the check has to sit after it. Sound while
  // it crosses: if the plan ever moved early enough not to, this would start demanding
  // "later the same day" and would fail a correct configuration.
  it('runs after the backup plan’s worst-case completion', () => {
    const script = readFileSync(join(REPO, 'infra/scripts/bootstrap-backups.sh'), 'utf8');
    expect(script).toContain('"ScheduleExpressionTimezone": "Etc/UTC"');
    const plan = /"ScheduleExpression": "cron\((\d+) (\d+)/.exec(script);
    const start = /"StartWindowMinutes": (\d+)/.exec(script);
    const completion = /"CompletionWindowMinutes": (\d+)/.exec(script);
    expect([plan, start, completion].every((m) => m !== null)).toBe(true);
    const completesAt =
      (Number(plan![2]) * 60 + Number(plan![1]) + Number(start![1]) + Number(completion![1])) %
      1440;

    const schedule = user.Resources.BackupFreshnessSchedule.Properties;
    expect(schedule?.ScheduleExpressionTimezone).toBe('Etc/UTC');
    const check = /^cron\((\d+) (\d+)/.exec(String(schedule?.ScheduleExpression));
    expect(check).not.toBeNull();
    expect(Number(check![2]) * 60 + Number(check![1])).toBeGreaterThan(completesAt);
  });

  // AND THE ARCHIVE IS UNTOUCHED BY ALL OF IT, which is the criterion the new check is
  // most able to break. Its alarm names NO dimensions, so it reads the undimensioned
  // series the capture publishes and not the per-cluster one added here — CloudWatch
  // does not roll a custom metric up across dimension sets. Its capture still filters by
  // the archive's own ARN.
  it('leaves the archive’s own check reading the archive alone', () => {
    expect(archive.Resources.BackupAgeAlarm.Properties?.Dimensions).toBeUndefined();
    expect(
      archive.Resources.CaptureFunction.Properties?.Environment?.Variables?.DSQL_CLUSTER_ARN,
    ).toBe('PriceCluster.ResourceArn');
    expect(
      archive.Resources.BackupAgeMetricFilter.Properties?.MetricTransformations?.[0]?.Dimensions,
    ).toBeUndefined();
  });
});

// Cognito Essentials bills nothing below 10,000 monthly actives and CloudWatch publishes
// no MAU metric, so the pool's total user count stands in for one — a strict upper bound,
// which is what makes an alarm on it fire early rather than late. It is watched from the
// stack that owns the pool, for the reason the backup check gives one describe block up:
// the capture is the archive's function in the archive's stack, and the pool is neither.
describe('the user stack watches its pool against the free tier', () => {
  const POOL_WATCH = [
    'PoolUsageFunction',
    'PoolUsageLogGroup',
    'PoolUsageSchedule',
    'PoolUsageSchedulerRole',
    'PoolUsersMetricFilter',
    'PoolUsersAlarm',
    'PoolUsageSilenceAlarm',
    'PoolUsageErrorAlarm',
  ];

  // DEV GETS NONE OF IT, and the generic loop in the backups block — every resource of a
  // monitoring type in this stack must carry `IsProd` — cannot see the function, its log
  // group or its role, because none of those is a monitoring type. Naming them is what
  // covers the half that loop cannot reach.
  it('deploys the whole watch on prod only', () => {
    for (const id of POOL_WATCH) {
      expect([id, user.Resources[id]?.Type]).not.toEqual([id, undefined]);
      expect([id, user.Resources[id]?.Condition]).toEqual([id, 'IsProd']);
    }
  });

  // THE THRESHOLD IS DERIVED, NOT REPEATED — and it is written as the derivation rather
  // than as its result, so moving `FREE_TIER_USERS` alone fails here. 80% is deliberately
  // below the 85% at which AWS's own Free Tier alert mails the root account: a guard that
  // fires with the bill is not a guard.
  //
  // AND THE DIRECTION IS PINNED, because nothing else in this repository holds it and the
  // whole argument for throwing on an unreadable count — zero is the healthy side — is an
  // argument about `GreaterThan`. Flipped, the alarm fires on a healthy pool and stays
  // silent on a breached one, with every gate green.
  it('alarms at 80% of the free tier, and in the direction the argument assumes', () => {
    const alarm = user.Resources.PoolUsersAlarm.Properties;
    expect(alarm?.Threshold).toBe(FREE_TIER_USERS * 0.8);
    expect(alarm?.Threshold ?? Infinity).toBeLessThan(FREE_TIER_USERS * 0.85);
    expect(alarm?.ComparisonOperator).toBe('GreaterThanThreshold');
    expect(alarm?.Statistic).toBe('Maximum');
    expect(alarm?.TreatMissingData).toBe('notBreaching');
  });

  // ONE CONTRACT, TWO FILES. The filter pattern and the handler's log line are the same
  // sentence written twice, and nothing at run time reconciles them: a function that ran,
  // succeeded and emitted a line this pattern no longer matched would leave the alarm on
  // an empty series, which `notBreaching` reads as OK. `pool-usage.test.ts` holds the
  // emitting half; this holds the reading half.
  it('reads the metric off the line the handler emits', () => {
    const filter = user.Resources.PoolUsersMetricFilter.Properties;
    expect(filter?.FilterPattern).toBe('{ $.metric = "poolUsers" }');
    const [transformation] = filter?.MetricTransformations ?? [];
    expect(transformation?.MetricNamespace).toBe('Quirenote');
    expect(transformation?.MetricName).toBe('PoolUsers');
    expect(transformation?.MetricValue).toBe('$.value');
    // UNDIMENSIONED, unlike `BackupAgeHours`, which is dimensioned only because two
    // stacks publish under one metric name. One stack publishes this one, in one
    // environment, so a dimension would key a series on a value nothing else supplies.
    expect(transformation?.Dimensions).toBeUndefined();
    expect(user.Resources.PoolUsersAlarm.Properties?.Dimensions).toBeUndefined();
  });

  // THE POOL IT DESCRIBES IS THIS STACK'S OWN, and the grant is what holds that true
  // rather than the environment variable: a wildcard here would let a dev deploy read the
  // prod pool, which is the reach `PreSignUpPolicy` exists to avoid one resource along.
  it('describes this stack’s pool and reads nothing else', () => {
    const policies = JSON.stringify(user.Resources.PoolUsageFunction.Properties?.Policies);
    expect(policies).toContain('cognito-idp:DescribeUserPool');
    expect(policies).toContain('UserPool.Arn');
    // The one call, and no second: nothing here may list, create, disable or read a USER.
    // That is the boundary that makes the pool's configuration readable without any user
    // datum becoming reachable.
    expect(policies).not.toContain('ListUsers');
    expect(policies).not.toContain('AdminGet');
    expect(policies).not.toContain('dsql:');
    expect(policies).not.toContain('backup:');
    // Still the intrinsic: `toJS()` drops an unknown tag and keeps the value, so the
    // assertion above cannot tell a `!GetAtt` from a pinned literal spelt the same way —
    // and a literal would deploy a policy whose resource matches no ARN at all, so every
    // nightly run would throw `AccessDenied` and only `PoolUsageErrorAlarm` would say so.
    //
    // ANCHORED ON THE ACTION, NOT ON `Resource:` ALONE. Three other grants in this
    // template name the same pool ARN on the same line, so an unanchored pattern matches
    // one of THEM and passes whatever this statement says — which it did: dropping the
    // tag here, the one failure this assertion exists for, left the suite green.
    //
    // It therefore expects `Action:` on the line above `Resource:`. A reorder or a
    // one-item sequence would fail it, which is the safe direction to be brittle in.
    expect(userSource).toMatch(
      /Action:\s*cognito-idp:DescribeUserPool\s*\r?\n\s*Resource:\s*!GetAtt\s+UserPool\.Arn/,
    );
    const vars = user.Resources.PoolUsageFunction.Properties?.Environment?.Variables ?? {};
    expect(vars.USER_POOL_ID).toBe('UserPool');
    // The same tag-drop hazard as the grant above, three lines on: `toJS()` keeps the
    // string either way, so without this the function would deploy asking Cognito about a
    // pool literally called `UserPool` and throw every night.
    //
    // AGAINST THIS RESOURCE'S OWN SLICE, not the whole file — the other two functions
    // carry the identical line, so a file-wide pattern passes on theirs.
    expect(resourceSource('PoolUsageFunction')).toMatch(/USER_POOL_ID:\s*!Ref\s+UserPool\b/);
  });

  // WHAT MAKES THE `notBreaching` ABOVE HONEST, exactly as it does for the backup check:
  // the count is published BY this function, so its absence means the function did not
  // publish — the schedule died, or it threw — and neither of those is "the pool is
  // fine". A `notBreaching` alarm with no silence alarm behind it reads OK forever.
  it('watches the publisher as well as the number', () => {
    const silence = user.Resources.PoolUsageSilenceAlarm.Properties;
    expect(silence?.Namespace).toBe('AWS/Lambda');
    expect(silence?.MetricName).toBe('Invocations');
    expect(silence?.Dimensions).toEqual([{ Name: 'FunctionName', Value: 'PoolUsageFunction' }]);
    expect(silence?.ComparisonOperator).toBe('LessThanThreshold');
    expect(silence?.TreatMissingData).toBe('breaching');
    // TWO PERIODS, for the reason the backup check's own silence alarm gives: a
    // once-daily cron with ordinary Scheduler jitter can leave a one-period window with
    // no run in it although every day had one.
    expect(silence?.EvaluationPeriods).toBe(2);

    const errors = user.Resources.PoolUsageErrorAlarm.Properties;
    expect(errors?.Namespace).toBe('AWS/Lambda');
    expect(errors?.MetricName).toBe('Errors');
    expect(errors?.Dimensions).toEqual([{ Name: 'FunctionName', Value: 'PoolUsageFunction' }]);
    expect(errors?.ComparisonOperator).toBe('GreaterThanOrEqualToThreshold');
    expect(errors?.TreatMissingData).toBe('notBreaching');
  });

  // NO `AlarmActions` AND NO TOPIC, here as everywhere (`docs/DECISIONS.md`, **Alerting**).
  it('carries no alarm action', () => {
    for (const id of ['PoolUsersAlarm', 'PoolUsageSilenceAlarm', 'PoolUsageErrorAlarm'])
      expect([id, user.Resources[id].Properties?.AlarmActions]).toEqual([id, undefined]);
  });

  // ONCE A DAY AND CLEAR OF THE BACKUP CHECK. A user count is not perishable — tomorrow's
  // firing republishes it — which is also why there is no queue and why the retry is cut
  // short. `Etc/UTC` rather than `Europe/Kyiv` for the reason the backup check states: a
  // Kyiv schedule drifts an hour twice a year against a job that does not move.
  it('fires once a day, on its own hour', () => {
    const schedule = user.Resources.PoolUsageSchedule.Properties;
    expect(schedule?.ScheduleExpression).toBe('cron(0 5 * * ? *)');
    expect(schedule?.ScheduleExpressionTimezone).toBe('Etc/UTC');
    expect(schedule?.Target?.Arn).toBe('PoolUsageFunction.Arn');
    expect(schedule?.ScheduleExpression).not.toBe(
      user.Resources.BackupFreshnessSchedule.Properties?.ScheduleExpression,
    );
  });
});

// The acceptance criterion "no archive row is duplicated", stated as the structural
// fact beneath it: there is one capture pipeline in existence, so there is one writer.
describe('the capture pipeline exists exactly once across both templates', () => {
  const both = [archive, user];

  it('has one capture handler, and it is the archive stack that has it', () => {
    expect(both.flatMap(handlers).filter((h) => h === 'capture.handler')).toHaveLength(1);
    expect(handlers(archive)).toContain('capture.handler');
  });

  // NAMED, NOT COUNTED, and the count is what had to go: it read 1 and meant "one
  // capture", which stopped being the same sentence the moment a second stack acquired a
  // schedule of its own. A count cannot tell a second capture from a backup check, so
  // each schedule is held to the function it targets instead — which is the property
  // that was actually wanted all along.
  it('schedules the capture once, and the user stack schedules only its own watches', () => {
    expect(idsOfType(archive, 'AWS::Scheduler::Schedule')).toEqual(['CaptureSchedule']);
    expect(archive.Resources.CaptureSchedule.Properties?.Target?.Arn).toBe('CaptureFunction.Arn');
    // Each one held to the function it targets. The list grows whenever the user stack
    // takes on another watch of its own — a pool count beside the backup age — and what
    // it must never acquire is a target that is a CAPTURE.
    const targets = idsOfType(user, 'AWS::Scheduler::Schedule').map((id) => [
      id,
      user.Resources[id].Properties?.Target?.Arn,
    ]);
    expect(targets).toEqual([
      ['BackupFreshnessSchedule', 'BackupFreshnessFunction.Arn'],
      ['PoolUsageSchedule', 'PoolUsageFunction.Arn'],
    ]);
  });

  // Two declarations, three clusters at run time — the user template is deployed once
  // per environment. It is the DECLARATIONS that can drift, so they are what is counted.
  it('declares one archive cluster and one user cluster, and no third', () => {
    expect(both.flatMap((t) => idsOfType(t, CLUSTER))).toEqual(['PriceCluster', 'UserCluster']);
  });
});

type Step = { name?: string; if?: string; run?: string; env?: Record<string, string> };
type Workflow = {
  on: {
    push?: { branches?: string[] };
    workflow_dispatch?: {
      inputs?: Record<string, { options?: string[]; required?: boolean; default?: string }>;
    };
  };
  concurrency?: { group?: string };
  jobs: Record<string, { environment?: { name?: string }; steps?: Step[] }>;
};

const workflow = (file: string) =>
  parseDocument(readFileSync(join(REPO, '.github/workflows', file), 'utf8')).toJS() as Workflow;

const REF_TO_ENV = "${{ github.ref_name == 'main' && 'prod' || 'dev' }}";

describe('deploy-backend.yml deploys one stack set per branch', () => {
  const wf = workflow('deploy-backend.yml');
  const steps = wf.jobs.deploy.steps ?? [];
  const deploys = steps.filter((s) => s.run?.includes('sam deploy'));

  it('fires on both branches', () => {
    expect(wf.on.push?.branches).toEqual(['dev', 'main']);
  });

  // THE WHOLE EXPRESSION, not three substrings of it. `main` && 'dev' || 'prod' contains
  // every one of them and points production at the dev stack — which is the class of
  // hole a `toContain` guard leaves, and the reason the `if` below is matched exactly
  // too.
  it('takes its environment from the ref rather than a literal', () => {
    expect(wf.jobs.deploy.environment?.name).toBe(REF_TO_ENV);
  });

  // Per-branch, so a release and a dev push do not serialize behind each other. Safe
  // only while the archive is dev-only: the day `main` deploys it too, two concurrent
  // `sam deploy` reach one stack and the second dies on UPDATE_IN_PROGRESS.
  it('keys concurrency per branch', () => {
    expect(wf.concurrency?.group).toContain('github.ref_name');
  });

  it('deploys the user stack FIRST, unconditionally, and the archive off main only', () => {
    expect(deploys).toHaveLength(2);
    // In document order, and that is the assertion. The archive deploy is what DELETES
    // the old migration function, so running it before the user stack exists opens a
    // window in which `migrate.yml` can resolve no function at all — and a user stack
    // that then failed to create would leave you inside it.
    const [userStack, archiveStack] = deploys;

    expect(userStack.run).toContain('--template-file template-user.yaml');
    expect(userStack.run).toContain('quirenote-backend-user-');
    expect(userStack.if).toBeUndefined();

    expect(archiveStack.run).not.toContain('template-user.yaml');
    expect(archiveStack.run).toContain('--stack-name quirenote-backend');
    // NOT a substring of the user stack's name, which shares that prefix.
    expect(archiveStack.run).not.toContain('quirenote-backend-user-');
    // The OPERATOR, not the operands. `== 'main'` names the same two and inverts the
    // rule: the archive would then deploy from `main` alone and never from `dev`, the
    // two branches would stop touching disjoint stacks, and the per-branch concurrency
    // group above would be unsafe — all three at once, silently.
    expect(archiveStack.if).toBe("github.ref_name != 'main'");
  });

  // EVERY HANDLER A TEMPLATE NAMES IS AN ENTRY POINT THE WORKFLOW BUNDLES, and the gap
  // between the two lists is silent in both directions: `sam deploy` packages `dist/`
  // as-is, so a handler left out of the loop deploys a function whose file does not
  // exist and fails on its first invocation, not on the deploy. Derived from the
  // templates rather than listed here, so the next handler cannot be added to one and
  // forgotten in the other.
  it('bundles an entry point for every handler the templates declare', () => {
    const bundle = steps.find((s) => s.run?.includes('esbuild'));
    const entries = [archive, user].flatMap(handlers).map((h) => h.replace(/\.handler$/, ''));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries)
      expect([entry, bundle?.run?.includes(entry)]).toEqual([entry, true]);
  });

  // AND EVERY BUNDLE IS SMOKE-TESTED, which the guard above looks like it covers and does
  // not. The bundle step's list is a shell loop the test reads; the smoke step's was a
  // HAND-KEPT `cp` line, so a fourth handler was bundled, deployed and never loaded once —
  // green, because the only derived assertion in this file stops at esbuild. A bundle that
  // is never `require`d is exactly the failure the step exists to catch: esbuild resolving
  // an import it cannot, or `infra/`'s `"type": "module"` meeting a cjs `require`.
  //
  // BOTH HALVES ARE ASSERTED. The copy alone would pass against a step that carries the
  // file into the directory and never opens it, which is the state a hand-kept list drifts
  // into first.
  it('smoke-tests every bundle it copies, and copies every one it bundles', () => {
    const smoke = steps.find((s) => s.run?.includes('bundle-check'));
    const entries = [archive, user].flatMap(handlers).map((h) => h.replace(/\.handler$/, ''));
    expect(smoke).toBeDefined();
    for (const entry of entries) {
      expect([entry, smoke?.run?.includes(`dist/${entry}.js`)]).toEqual([entry, true]);
      expect([entry, smoke?.run?.includes(`require('./${entry}.js')`)]).toEqual([entry, true]);
    }
  });

  // ONE RESOLUTION, USED TWICE. The job's environment decides which credentials the job
  // holds; the step's ENVIRONMENT decides which stack it writes. They are the same
  // expression and must stay so — diverged, the job assumes production's role and
  // deploys the dev stack, or the reverse.
  it('resolves the environment once, for both the credentials and the stack', () => {
    const [userStack] = deploys;
    expect(userStack.env?.ENVIRONMENT).toBe(wf.jobs.deploy.environment?.name);
    // The PAIRING is the assertion, not its adjacency to the flag: `--parameter-overrides`
    // grew three more values when the pool arrived and now spans several lines, so a match
    // that spanned the two would fail on formatting rather than on meaning. The flag itself
    // is still asserted, separately, so "spans several lines" cannot become "is not passed".
    expect(userStack.run).toContain('--parameter-overrides');
    expect(userStack.run).toContain('"Environment=${ENVIRONMENT}"');
    // AND `OpenRegistration` IS NAMED HERE RATHER THAN LEFT TO THE OPTIONAL GUARD BELOW,
    // which skips any parameter the step does not mention. Deleting its whole `if` block
    // would pass that guard by vanishing from it — and because `sam deploy` sends
    // `UsePreviousValue` for a parameter it is not given, the stack would then freeze on
    // whatever was last deployed. For a registration switch that is the one direction that
    // must not be silent.
    expect(userStack.run).toContain('"OpenRegistration=');
  });

  // EVERY PARAMETER THE TEMPLATE REQUIRES IS ONE THE WORKFLOW PASSES, derived from the
  // template rather than listed here. A required parameter dropped from the deploy line
  // fails only at deploy time, which is the same silence the bundle guard above exists for —
  // and `AuthCertificateArn` is the one whose absence leaves a retained, deletion-protected
  // orphan pool behind.
  it('passes every parameter the user template has no default for', () => {
    const [userStack] = deploys;
    const required = Object.entries(user.Parameters ?? {})
      .filter(([, p]) => !('Default' in p))
      .map(([name]) => name);
    expect(required).toContain('AuthCertificateArn');
    for (const name of required) {
      expect([name, userStack.run?.includes(`"${name}=`)]).toEqual([name, true]);
    }
  });

  // AND EVERY PARAMETER THAT DOES HAVE A DEFAULT IS PASSED ONLY WHEN IT HAS A VALUE.
  // `sam deploy` refuses an empty one — `GoogleClientId=` is "not a valid format" and the
  // command dies before making a single AWS call — so a template `Default: ''` does NOT
  // make an unset secret a supported state on its own. Measured on the first real deploy,
  // which failed there; nothing but the argument list can fix it, because the parser that
  // refuses is the CLI's rather than CloudFormation's.
  it('guards an optional parameter instead of passing it empty', () => {
    const [userStack] = deploys;
    const optional = Object.entries(user.Parameters ?? {})
      .filter(([, p]) => 'Default' in p)
      .map(([name]) => name);
    expect(optional.length).toBeGreaterThan(0);
    for (const name of optional) {
      if (!userStack.run?.includes(`"${name}=`)) continue;
      // Named in the deploy, so the step has to decide whether to pass it rather than
      // always doing so. The shell variable it reads is the assertion — `GoogleClientId`
      // is carried by `GOOGLE_CLIENT_ID`, the spelling the `env:` block below uses.
      const variable = name.replace(/(?!^)([A-Z])/g, '_$1').toUpperCase();
      expect([name, userStack.run.includes(`-n "$${variable}"`)]).toEqual([name, true]);
    }
  });
});

describe('migrate.yml names the stack its target chose', () => {
  const wf = workflow('migrate.yml');
  const steps = wf.jobs.migrate?.steps ?? [];

  // The runner no longer lives in `quirenote-backend`, so a lookup left pointing there
  // resolves nothing — and would say so only at dispatch time.
  it('resolves the function from a user stack, never the archive', () => {
    const resolve = steps.find((s) => s.run?.includes('--stack-name'));
    expect(resolve?.run).toContain('quirenote-backend-user-');
    expect(resolve?.run).toContain('inputs.target');
  });

  it('runs one target at a time without blocking the other', () => {
    expect(wf.concurrency?.group).toContain('inputs.target');
  });

  // THE LINE THE WHOLE GUARD RESTS ON. The environment is what refuses a `prod`
  // dispatch from any branch but `main`, before a credential exists — so putting a
  // literal back here does not fail anything at dispatch time, it just stops refusing.
  // Both runners are invokable by the one deploy role, so nothing downstream catches it.
  it('resolves its environment from the target, never a literal', () => {
    expect(wf.jobs.migrate?.environment?.name).toBe('${{ inputs.target }}');
  });

  // "MANUAL ONLY, and that is the whole design of this file" — its own first line. A
  // `push` trigger here would run DDL on a stack update nobody was watching.
  it('has no push trigger at all', () => {
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  // ORDER FIRST, ABSENCE SECOND, and that ranking is the finding rather than a style.
  // A `choice` with no `default` preselects its FIRST option, so `['dev', 'prod']` is
  // what an operator gets by dispatching without touching the dropdown — reorder these
  // and the safe-by-default target silently becomes production. The absent `default` is
  // pinned too, but only because a `default: prod` would override the order.
  it('offers dev before prod, and adds no default that would override the order', () => {
    const target = wf.on.workflow_dispatch?.inputs?.target;
    expect(target?.options).toEqual(['dev', 'prod']);
    expect(target).not.toHaveProperty('default');
    expect(target?.required).toBe(true);
  });

  // The fourth mode, and `rehearse` stays first for the reason the target's order
  // exists: a dropdown dispatched without being touched preselects its first option,
  // and `bootstrap` mints a real Cognito identity.
  it('offers the bootstrap mode without displacing the harmless default', () => {
    const mode = wf.on.workflow_dispatch?.inputs?.mode;
    expect(mode?.options).toEqual(['rehearse', 'dry-run', 'apply', 'bootstrap']);
    expect(mode?.default).toBe('rehearse');
  });

  // NOTHING REACHES THE INVOKE LINE BY SUBSTITUTION. The payload used to be a
  // single-quoted shell literal with the mode pasted into it, which was safe only because
  // `mode` is a `choice` GitHub validates. An operator-typed address pasted the same way is
  // shell injection on a `bash -e` line and JSON injection inside the literal at once — so
  // both values now travel through `env:` and are built in with `jq -n --arg`. This asserts
  // neither has drifted back, the mode included: an exception nothing pins is one that gets
  // taken.
  it('builds the payload around the address rather than substituting it in', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    expect(invoke?.run).not.toContain('inputs.email');
    expect(invoke?.run).not.toContain('inputs.mode');
    expect(invoke?.run).toContain('jq -n');
    expect(invoke?.run).toContain('--arg');
    // And the value it reads is an environment variable the step was given, rather than
    // a second expression spelled differently.
    expect(Object.values(invoke?.env ?? {})).toContain('${{ inputs.email }}');
    expect(Object.values(invoke?.env ?? {})).toContain('${{ inputs.mode }}');
  });

  // A REHEARSAL THAT LEFT ITS SCHEMA BEHIND COMES BACK 200 WITH NO
  // FunctionError — the statements are the finding and there was none — so the
  // `has("FunctionError")` check above cannot see it and the run would go
  // green over a schema still on the cluster. The workflow checking is the only
  // thing that makes it red, which is exactly the kind of exception that gets
  // taken back out if nothing pins it.
  it('fails the run on a teardown that left its schema behind, and names it', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    // THE WHOLE GUARD LINE, as one expression. `run:` is a block scalar, so the
    // paragraph above it is string content like any other — matching the key on
    // its own matched the sentence explaining it, and `out.json` was already in
    // this step twice before any of this. What has to hold is the polarity, the
    // file it reads and the name it prints.
    expect(invoke?.run).toMatch(/if jq -e '\.teardown\.dropped == false' out\.json/);
    expect(invoke?.run).toMatch(/jq -r '\.teardown\.schema' out\.json/);
    // AND THAT IT GOES RED. Printing the name while the run stays green is the
    // whole failure this check exists to stop, and the echo alone does not say
    // which of the two it does.
    expect(invoke?.run).toMatch(/drop it by hand[^\r\n]*[\r\n]\s*exit 1/);
  });

  // THE GUARD ABOVE IT, red for the same reason and pinned nowhere else. A
  // rehearsal that RAISED carries the orphaned schema's name in its message,
  // because a Lambda error payload has nowhere else to put it — and that name
  // reaches an operator only if the step fails.
  it('fails the run when the handler raised', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    expect(invoke?.run).toMatch(/if jq -e 'has\("FunctionError"\)' invoke\.json/);
    expect(invoke?.run).toMatch(/the migration handler raised[^\r\n]*[\r\n]\s*exit 1/);
  });
});
