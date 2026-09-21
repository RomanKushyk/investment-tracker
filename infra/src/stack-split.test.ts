import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from '../../src/repo-root';
import { NO_BACKUP_HOURS } from './backup-age';
import { FREE_TIER_USERS } from './pool-usage';
import { envVars, grantAt, intrinsicAt } from './template-intrinsic';

// The archive is provider data shared by every environment and user data is not, so the
// split is two templates: one archive stack, one user stack deployed once per
// environment. What this file guards is the half no test can reach from inside a handler
// — the templates themselves, and the workflow that chooses which stack a branch
// deploys. [*Cloud target*]
//
// Only `errors` is asserted, never `warnings`: every intrinsic tag is unresolved to a
// YAML parser, so a healthy template warns once per `!GetAtt`/`!Sub`/`!If`.
// `!GetAtt UserCluster.Endpoint` arrives through `toJS()` as the plain string
// 'UserCluster.Endpoint' — a pinned literal reads identically — so where the tag is what
// matters the assertion goes through `intrinsicAt`, which reads the document node.

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
    Metrics?: unknown;
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

/** What one IAM role carries ON ITSELF — the shape all three schedulers share.
 *
 *  A grant found by its action says which function a role may invoke; it cannot say nothing was
 *  added beside it. EVERY POLICY AND THE MANAGED ONES, not `Policies[0]`.
 *
 *  ON ITSELF IS THE LIMIT, and two doors are outside it: a standalone `AWS::IAM::Policy` naming
 *  the role in `Roles` grants it from another resource entirely, and `AssumeRolePolicyDocument`
 *  says who may assume it rather than what it reaches. Neither is read anywhere in this suite. */
const roleGrants = (t: Template, id: string) => {
  const properties = t.Resources[id].Properties as {
    Policies?: { PolicyDocument: { Statement: { Action?: unknown }[] } }[];
    ManagedPolicyArns?: unknown[];
  };
  return {
    statements: (properties.Policies ?? []).flatMap((p) => p.PolicyDocument.Statement),
    managed: properties.ManagedPolicyArns ?? [],
  };
};

/** Every statement of one FUNCTION's inline policies — the other shape, with no `PolicyDocument`
 *  between the policy and its statements.
 *
 *  COUNTED WHERE A TEST CLAIMS COMPLETENESS: a grant is found by its action, and an action nobody
 *  asserts is invisible to every assertion in the file. */
const inlineStatements = (t: Template, id: string) =>
  (t.Resources[id].Properties?.Policies as { Statement: { Action?: unknown }[] }[]).flatMap(
    (p) => p.Statement,
  );

const CLUSTER = 'AWS::DSQL::Cluster';

describe('the archive stack holds the archive and nothing else', () => {
  it('parses as a template — errors only, because the intrinsics are all warnings', () => {
    expect(archiveDoc.errors).toEqual([]);
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

  it('no longer ships the migration handler, nor names it in an output', () => {
    expect(handlers(archive)).not.toContain('migrate.handler');
    expect(Object.keys(archive.Outputs ?? {})).not.toContain('MigrateFunctionName');
  });

  it('lets its capture reach the archive, the vault and the alert channel, as themselves', () => {
    const capture = ['Resources', 'CaptureFunction', 'Properties', 'Policies', 0, 'Statement'];
    expect(inlineStatements(archive, 'CaptureFunction')).toHaveLength(3);
    expect(grantAt(archiveDoc, capture, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'PriceCluster.ResourceArn',
    });
    expect(grantAt(archiveDoc, capture, 'backup:ListRecoveryPointsByBackupVault')).toEqual({
      tag: '!Sub',
      value:
        'arn:${AWS::Partition}:backup:${AWS::Region}:${AWS::AccountId}:backup-vault:quirenote-backups',
    });
    expect(grantAt(archiveDoc, capture, 'notifications:ListChannels')).toEqual({
      tag: undefined,
      value: '*',
    });
  });

  it('lets its scheduler invoke that capture and nothing else', () => {
    expect(
      grantAt(
        archiveDoc,
        ['Resources', 'SchedulerRole', 'Properties', 'Policies', 0, 'PolicyDocument', 'Statement'],
        'lambda:InvokeFunction',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'CaptureFunction.Arn' });
    expect(roleGrants(archive, 'SchedulerRole')).toEqual({
      statements: [expect.objectContaining({ Action: 'lambda:InvokeFunction' })],
      managed: [],
    });
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

  // An ALLOW-list, not a deny-list of the archive's types: a deny-list is a hole where the
  // next archive resource goes. Identity and monitoring both follow the CLUSTER, the way
  // the runner follows the schema it applies. [*Auth model*]
  //
  // ONE ENTRY FOR THE API, not four, because `Domain:` is SAM's sugar: the transform
  // generates the `DomainName`, `ApiMapping` and `Stage` beside it, and this test reads
  // the template's source rather than its transform output.
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

  it('carries no queue', () => {
    expect(idsOfType(user, 'AWS::SQS::Queue')).toEqual([]);
  });

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
    expect(intrinsicAt(userDoc, ...envVars('MigrateFunction'), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
    expect(vars.FEED_URL).toBeUndefined();
  });

  it('may rewrite the USER cluster and no other', () => {
    expect(
      grantAt(
        userDoc,
        ['Resources', 'MigrateFunction', 'Properties', 'Policies', 0, 'Statement'],
        'dsql:DbConnectAdmin',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserCluster.ResourceArn' });
    const policies = user.Resources.MigrateFunction.Properties?.Policies;
    expect(JSON.stringify(policies)).not.toContain('PriceCluster');
    expect(inlineStatements(user, 'MigrateFunction')).toHaveLength(2);
  });

  // THE BACKUP DECISION, AND IT IS ONE SWAPPED `!If` ARM FROM SHIPPING PROD'S PORTFOLIO
  // OUT OF A LOCKED VAULT. The selection matches `app=quirenote` and nothing else, and
  // the vault is Locked — so the tag is not "gets backed up", it is "produces recovery
  // points nobody can delete". Prod's cluster is worth that; dev's is not. Asserted on
  // the PARSED intrinsic, which is the only place the tag survives.
  it('tags prod into the backup selection and dev out of it', () => {
    expect(user.Conditions?.IsProd).toEqual(['Environment', 'prod']);
    expect(user.Resources.UserCluster.Properties?.Tags).toEqual([
      { Key: 'app', Value: ['IsProd', 'quirenote', 'quirenote-dev'] },
    ]);
  });

  // NO DEFAULT, and the tag above is what makes it matter: a deploy that forgot
  // `--parameter-overrides` would resolve silently to whichever value was written here,
  // and one of the two is production.
  it('takes the environment as a parameter with no default', () => {
    const p = user.Parameters?.Environment;
    expect(p?.AllowedValues).toEqual(['dev', 'prod']);
    expect(p).not.toHaveProperty('Default');
  });
});

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

  /** Types this stack holds for monitoring and nothing else, so every one must be prod's.
   *  `AWS::IAM::Role` is deliberately NOT here: the next unrelated one would fail a test
   *  named for this check with a message pointing at the wrong thing. */
  const MONITORING = [
    'AWS::CloudWatch::Alarm',
    'AWS::Logs::MetricFilter',
    'AWS::Scheduler::Schedule',
  ];

  it('deploys the whole check on prod only', () => {
    for (const id of WATCH) {
      expect([id, user.Resources[id]?.Type]).not.toEqual([id, undefined]);
      expect([id, user.Resources[id]?.Condition]).toEqual([id, 'IsProd']);
    }
    for (const [id, r] of resources(user))
      if (MONITORING.includes(r.Type)) expect([id, r.Condition]).toEqual([id, 'IsProd']);
  });

  it('reads the USER cluster’s ARN, and never the archive’s', () => {
    const vars = user.Resources.BackupFreshnessFunction.Properties?.Environment?.Variables ?? {};
    expect(intrinsicAt(userDoc, ...envVars('BackupFreshnessFunction'), 'DSQL_CLUSTER_ARN')).toEqual(
      { tag: '!GetAtt', value: 'UserCluster.ResourceArn' },
    );
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
  });

  it('dimensions the metric and the alarm by the same cluster', () => {
    const cluster = { tag: '!GetAtt', value: 'UserCluster.Identifier' };
    expect(intrinsicAt(userDoc, ...envVars('BackupFreshnessFunction'), 'DSQL_CLUSTER_ID')).toEqual(
      cluster,
    );
    expect(user.Resources.UserBackupAgeAlarm.Properties?.Dimensions).toEqual([
      { Name: 'cluster', Value: 'UserCluster.Identifier' },
    ]);
    expect(
      intrinsicAt(
        userDoc,
        'Resources',
        'UserBackupAgeAlarm',
        'Properties',
        'Dimensions',
        0,
        'Value',
      ),
    ).toEqual(cluster);
    const [transformation] =
      user.Resources.UserBackupAgeMetricFilter.Properties?.MetricTransformations ?? [];
    expect(transformation?.Dimensions).toEqual([{ Key: 'cluster', Value: '$.cluster' }]);
  });

  it('grants a read of the vault and no access to any cluster', () => {
    const policies = JSON.stringify(user.Resources.BackupFreshnessFunction.Properties?.Policies);
    expect(policies).toContain('backup:ListRecoveryPointsByBackupVault');
    expect(policies).not.toContain('dsql:');
    expect(policies).not.toContain('cognito-idp:');
    expect(inlineStatements(user, 'BackupFreshnessFunction')).toHaveLength(1);
    expect(
      grantAt(
        userDoc,
        ['Resources', 'BackupFreshnessFunction', 'Properties', 'Policies', 0, 'Statement'],
        'backup:ListRecoveryPointsByBackupVault',
      ),
    ).toEqual({
      tag: '!Sub',
      value:
        'arn:${AWS::Partition}:backup:${AWS::Region}:${AWS::AccountId}:backup-vault:quirenote-backups',
    });
  });

  it('lets its scheduler invoke that check and nothing else', () => {
    expect(
      grantAt(
        userDoc,
        [
          'Resources',
          'BackupFreshnessSchedulerRole',
          'Properties',
          'Policies',
          0,
          'PolicyDocument',
          'Statement',
        ],
        'lambda:InvokeFunction',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'BackupFreshnessFunction.Arn' });
    expect(roleGrants(user, 'BackupFreshnessSchedulerRole')).toEqual({
      statements: [expect.objectContaining({ Action: 'lambda:InvokeFunction' })],
      managed: [],
    });
  });

  it('alarms at 48 hours, above the value that means no backup exists', () => {
    const alarm = user.Resources.UserBackupAgeAlarm.Properties;
    expect(alarm?.Threshold).toBe(48);
    expect(alarm?.TreatMissingData).toBe('notBreaching');
    expect(NO_BACKUP_HOURS).toBeGreaterThan(alarm?.Threshold ?? 0);
    expect(NO_BACKUP_HOURS).toBeGreaterThan(
      archive.Resources.BackupAgeAlarm.Properties?.Threshold ?? 0,
    );
  });

  it('watches the publisher too, so a dead check is not a quiet one', () => {
    const silence = user.Resources.BackupFreshnessSilenceAlarm.Properties;
    expect(silence?.Namespace).toBe('AWS/Lambda');
    expect(silence?.MetricName).toBe('Invocations');
    expect(silence?.Dimensions).toEqual([
      { Name: 'FunctionName', Value: 'BackupFreshnessFunction' },
    ]);
    expect(silence?.TreatMissingData).toBe('breaching');
    expect(silence?.EvaluationPeriods).toBe(2);
    expect(silence?.Period).toBe(86400);
  });

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
  // change to EventBridge regardless, and the topic was removed deliberately. [*Alerting*]
  it('carries no alarm action and adds no topic', () => {
    for (const id of [
      'UserBackupAgeAlarm',
      'BackupFreshnessSilenceAlarm',
      'BackupFreshnessErrorAlarm',
    ])
      expect([id, user.Resources[id].Properties?.AlarmActions]).toEqual([id, undefined]);
    expect(idsOfType(user, 'AWS::SNS::Topic')).toEqual([]);
  });

  // THE HOUR IS DERIVED FROM ANOTHER FILE rather than asserted in a sentence.
  // `bootstrap-backups.sh` owns the plan, and its completion window bounds when a night's
  // job can still be running: a check that ran before that bound would measure a job in
  // flight and report yesterday. Nothing coupled the two, so shortening the window in the
  // script would have invalidated this schedule's reasoning silently.
  //
  // MINUTES PAST MIDNIGHT UTC ON BOTH SIDES, comparable only because both are pinned to
  // UTC — which is why BOTH timezones are asserted below rather than assumed: unread,
  // moving the plan to Europe/Kyiv would shift every number on its side while this test
  // went on passing. The plan's window crosses midnight, so the worst case is taken
  // modulo the day; were it ever to stop crossing, this would start demanding "later the
  // same day" and fail a correct configuration.
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

  it('leaves the archive’s own check reading the archive alone', () => {
    expect(archive.Resources.BackupAgeAlarm.Properties?.Dimensions).toBeUndefined();
    expect(intrinsicAt(archiveDoc, ...envVars('CaptureFunction'), 'DSQL_CLUSTER_ARN')).toEqual({
      tag: '!GetAtt',
      value: 'PriceCluster.ResourceArn',
    });
    expect(
      archive.Resources.BackupAgeMetricFilter.Properties?.MetricTransformations?.[0]?.Dimensions,
    ).toBeUndefined();
  });
});

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

  it('deploys the whole watch on prod only', () => {
    for (const id of POOL_WATCH) {
      expect([id, user.Resources[id]?.Type]).not.toEqual([id, undefined]);
      expect([id, user.Resources[id]?.Condition]).toEqual([id, 'IsProd']);
    }
  });

  it('alarms at 80% of the free tier, and in the direction the argument assumes', () => {
    const alarm = user.Resources.PoolUsersAlarm.Properties;
    expect(alarm?.Threshold).toBe(FREE_TIER_USERS * 0.8);
    expect(alarm?.Threshold ?? Infinity).toBeLessThan(FREE_TIER_USERS * 0.85);
    expect(alarm?.ComparisonOperator).toBe('GreaterThanThreshold');
    expect(alarm?.Statistic).toBe('Maximum');
    expect(alarm?.TreatMissingData).toBe('notBreaching');
  });

  it('reads the metric off the line the handler emits', () => {
    const filter = user.Resources.PoolUsersMetricFilter.Properties;
    expect(filter?.FilterPattern).toBe('{ $.metric = "poolUsers" }');
    const [transformation] = filter?.MetricTransformations ?? [];
    expect(transformation?.MetricNamespace).toBe('Quirenote');
    expect(transformation?.MetricName).toBe('PoolUsers');
    expect(transformation?.MetricValue).toBe('$.value');
    expect(transformation?.Dimensions).toBeUndefined();
    expect(user.Resources.PoolUsersAlarm.Properties?.Dimensions).toBeUndefined();
  });

  it('describes this stack’s pool and reads nothing else', () => {
    const policies = JSON.stringify(user.Resources.PoolUsageFunction.Properties?.Policies);
    expect(policies).toContain('cognito-idp:DescribeUserPool');
    expect(policies).toContain('UserPool.Arn');
    expect(policies).not.toContain('ListUsers');
    expect(policies).not.toContain('AdminGet');
    expect(policies).not.toContain('dsql:');
    expect(policies).not.toContain('backup:');
    expect(inlineStatements(user, 'PoolUsageFunction')).toHaveLength(1);
    expect(
      grantAt(
        userDoc,
        ['Resources', 'PoolUsageFunction', 'Properties', 'Policies', 0, 'Statement'],
        'cognito-idp:DescribeUserPool',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
    expect(intrinsicAt(userDoc, ...envVars('PoolUsageFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
  });

  it('lets its scheduler invoke that count and nothing else', () => {
    expect(
      grantAt(
        userDoc,
        [
          'Resources',
          'PoolUsageSchedulerRole',
          'Properties',
          'Policies',
          0,
          'PolicyDocument',
          'Statement',
        ],
        'lambda:InvokeFunction',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'PoolUsageFunction.Arn' });
    expect(roleGrants(user, 'PoolUsageSchedulerRole')).toEqual({
      statements: [expect.objectContaining({ Action: 'lambda:InvokeFunction' })],
      managed: [],
    });
  });

  it('watches the publisher as well as the number', () => {
    const silence = user.Resources.PoolUsageSilenceAlarm.Properties;
    expect(silence?.Namespace).toBe('AWS/Lambda');
    expect(silence?.MetricName).toBe('Invocations');
    expect(silence?.Dimensions).toEqual([{ Name: 'FunctionName', Value: 'PoolUsageFunction' }]);
    expect(silence?.ComparisonOperator).toBe('LessThanThreshold');
    expect(silence?.TreatMissingData).toBe('breaching');
    expect(silence?.EvaluationPeriods).toBe(2);

    const errors = user.Resources.PoolUsageErrorAlarm.Properties;
    expect(errors?.Namespace).toBe('AWS/Lambda');
    expect(errors?.MetricName).toBe('Errors');
    expect(errors?.Dimensions).toEqual([{ Name: 'FunctionName', Value: 'PoolUsageFunction' }]);
    expect(errors?.ComparisonOperator).toBe('GreaterThanOrEqualToThreshold');
    expect(errors?.TreatMissingData).toBe('notBreaching');
  });

  // NO `AlarmActions` AND NO TOPIC, here as everywhere. [*Alerting*]
  it('carries no alarm action', () => {
    for (const id of ['PoolUsersAlarm', 'PoolUsageSilenceAlarm', 'PoolUsageErrorAlarm'])
      expect([id, user.Resources[id].Properties?.AlarmActions]).toEqual([id, undefined]);
  });

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

describe('the capture pipeline exists exactly once across both templates', () => {
  const both = [archive, user];

  it('has one capture handler, and it is the archive stack that has it', () => {
    expect(both.flatMap(handlers).filter((h) => h === 'capture.handler')).toHaveLength(1);
    expect(handlers(archive)).toContain('capture.handler');
  });

  it('schedules the capture once, and the user stack schedules only its own watches', () => {
    expect(idsOfType(archive, 'AWS::Scheduler::Schedule')).toEqual(['CaptureSchedule']);
    expect(archive.Resources.CaptureSchedule.Properties?.Target?.Arn).toBe('CaptureFunction.Arn');
    const targets = idsOfType(user, 'AWS::Scheduler::Schedule').map((id) => [
      id,
      user.Resources[id].Properties?.Target?.Arn,
    ]);
    expect(targets).toEqual([
      ['BackupFreshnessSchedule', 'BackupFreshnessFunction.Arn'],
      ['PoolUsageSchedule', 'PoolUsageFunction.Arn'],
    ]);
  });

  it('declares one archive cluster and one user cluster, and no third', () => {
    expect(both.flatMap((t) => idsOfType(t, CLUSTER))).toEqual(['PriceCluster', 'UserCluster']);
  });
});

describe('the account’s alarms are counted against what CloudWatch bills nothing for', () => {
  const ALARM = 'AWS::CloudWatch::Alarm';
  const FREE_TIER_ALARMS = 10;

  it('deploys six from the archive stack', () => {
    expect(idsOfType(archive, ALARM).sort()).toEqual([
      'AlertChannelAlarm',
      'BackupAgeAlarm',
      'DlqAlarm',
      'ErrorAlarm',
      'SilenceAlarm',
      'UnexplainedQuoteAlarm',
    ]);
  });

  it('deploys six more from the user stack', () => {
    expect(idsOfType(user, ALARM).sort()).toEqual([
      'BackupFreshnessErrorAlarm',
      'BackupFreshnessSilenceAlarm',
      'PoolUsageErrorAlarm',
      'PoolUsageSilenceAlarm',
      'PoolUsersAlarm',
      'UserBackupAgeAlarm',
    ]);
  });

  it('lists its metrics directly and holds every alarm at standard resolution', () => {
    for (const t of [archive, user])
      for (const id of idsOfType(t, ALARM)) {
        expect([id, t.Resources[id].Properties?.Metrics]).toEqual([id, undefined]);
        expect([id, (t.Resources[id].Properties?.Period ?? 0) >= 60]).toEqual([id, true]);
      }
  });

  it('is two past the ten, which the Alerting decision takes knowingly', () => {
    const deployed = [archive, user].flatMap((t) => idsOfType(t, ALARM));
    expect(deployed.length - FREE_TIER_ALARMS).toBe(2);
  });
});

type Step = {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
};
type Concurrency = { group?: string; 'cancel-in-progress'?: boolean; queue?: string };
type Job = {
  needs?: string | string[];
  if?: string;
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  environment?: { name?: string };
  concurrency?: Concurrency;
  outputs?: Record<string, string>;
  steps?: Step[];
};
type Workflow = {
  on: {
    push?: { branches?: string[] };
    workflow_dispatch?: {
      inputs?: Record<string, { options?: string[]; required?: boolean; default?: string }>;
    };
  };
  concurrency?: Concurrency;
  jobs: Record<string, Job>;
};

type Action = {
  inputs?: Record<string, { required?: boolean; default?: string }>;
  outputs?: Record<string, { value?: string }>;
  runs: { using?: string; steps?: Step[] };
};

const workflow = (file: string) =>
  parseDocument(readFileSync(join(REPO, '.github/workflows', file), 'utf8')).toJS() as Workflow;

const REF_TO_ENV = "${{ github.ref_name == 'main' && 'prod' || 'dev' }}";

/** GitHub's self-repository prefix: it resolves an action from THIS repository at the commit the
 *  run is on, with no checkout — which is what lets the gated migration job hold the property
 *  `migrate.yml` has always held, that nothing from the ref reaches the cluster. */
const SELF = '$/';
const INVOKE_ACTION = '.github/actions/invoke-migration';
const ACTION_FILE = `${INVOKE_ACTION}/action.yml`;

const actionText = (path: string) => readFileSync(join(REPO, path), 'utf8');
const action = (path: string) => parseDocument(actionText(path)).toJS() as Action;

/** A job's steps with every self-repository action flattened into the steps it runs.
 *
 *  An assertion about what a JOB does has to look through the call, or moving a step into an action
 *  silently empties it — which is the whole risk of this refactor. TOLERANT OF A MISSING FILE ON
 *  PURPOSE: a throw here happens at collection time and reddens every unrelated assertion in this
 *  file with one message about `readFileSync`. The tolerance is not a hole, because
 *  `every self-repository reference resolves` below asserts the file is there. */
const resolvedSteps = (job?: Job): Step[] =>
  (job?.steps ?? []).flatMap((step) => {
    if (!step.uses?.startsWith(SELF)) return [step];
    const file = `${step.uses.slice(SELF.length)}/action.yml`;
    return existsSync(join(REPO, file)) ? (action(file).runs.steps ?? []) : [step];
  });

const selfCalls = (job?: Job) =>
  (job?.steps ?? []).filter((s) => s.uses === `${SELF}${INVOKE_ACTION}`);

describe('deploy-backend.yml deploys one stack set per branch', () => {
  const wf = workflow('deploy-backend.yml');
  const steps = wf.jobs.deploy.steps ?? [];
  const deploys = steps.filter((s) => s.run?.includes('sam deploy'));

  it('fires on both branches', () => {
    expect(wf.on.push?.branches).toEqual(['dev', 'main']);
  });

  it('takes its environment from the ref rather than a literal', () => {
    expect(wf.jobs.deploy.environment?.name).toBe(REF_TO_ENV);
  });

  // THE WHOLE RUN, AND IT QUEUES. Two failures meet on this block once the apply is gated: a run
  // holding a job that waits on a reviewer is not finished, so it keeps the group — grouped on the
  // deploy job alone, the next push would `sam deploy` a new bundle under a rehearsal already in
  // flight against the old one. And the default `queue: single` CANCELS the one pending run when
  // another arrives, so an approval parked for a day would drop every push behind it but the last.
  // `queue: max` is asserted because without it the workflow-level group reintroduces that drop.
  it('serialises the whole run per branch, and queues rather than dropping', () => {
    expect(wf.concurrency?.group).toContain('github.ref_name');
    expect(wf.concurrency?.['cancel-in-progress']).toBe(false);
    expect(wf.concurrency?.queue).toBe('max');
    // The deploy job must not carry one of its own: a second group would let the run finish its
    // deploy and release nothing, which is the shape this test exists to refuse.
    expect(wf.jobs.deploy.concurrency).toBeUndefined();
  });

  // A RUNNER WITH NO CLIENT TIMEOUT NEEDS THE JOB TO CARRY ONE. `--cli-read-timeout 0` leaves
  // Lambda's 900s as the only bound and Actions cannot see it, so a hung invoke would hold the
  // cluster's group — and the repair dispatch behind it — for the 360-minute default.
  // EVERY JOB THAT CALLS THE ACTION, not just the gated one — the `deploy` job runs the plan and
  // holds the workflow-level group while it does, so a hung invoke there queues every later push
  // on the branch behind it for the six-hour default.
  it('bounds every job that invokes the runner, well under the 360-minute default', () => {
    const jobs: [string, Job][] = [
      ['deploy-backend deploy', wf.jobs.deploy],
      ['deploy-backend migrate', wf.jobs.migrate],
      ['migrate.yml migrate', workflow('migrate.yml').jobs.migrate],
    ];
    for (const [name, job] of jobs) {
      const minutes = job['timeout-minutes'] ?? 0;
      expect([name, minutes > 30 && minutes < 360]).toEqual([name, true]);
    }
  });

  it('deploys the user stack FIRST, unconditionally, and the archive off main only', () => {
    expect(deploys).toHaveLength(2);
    // IN DOCUMENT ORDER, and that is the assertion: the archive deploy DELETES the old
    // migration function, so running it before the user stack exists opens a window in
    // which `migrate.yml` resolves no function at all.
    const [userStack, archiveStack] = deploys;

    expect(userStack.run).toContain('--template-file template-user.yaml');
    expect(userStack.run).toContain('quirenote-backend-user-');
    expect(userStack.if).toBeUndefined();

    expect(archiveStack.run).not.toContain('template-user.yaml');
    expect(archiveStack.run).toContain('--stack-name quirenote-backend');
    expect(archiveStack.run).not.toContain('quirenote-backend-user-');
    // The OPERATOR, not the operands: `== 'main'` names the same two and inverts the
    // rule, so the archive would deploy from `main` alone and the two branches would stop
    // touching disjoint stacks — silently.
    expect(archiveStack.if).toBe("github.ref_name != 'main'");
  });

  it('bundles an entry point for every handler the templates declare', () => {
    const bundle = steps.find((s) => s.run?.includes('esbuild'));
    const entries = [archive, user].flatMap(handlers).map((h) => h.replace(/\.handler$/, ''));
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries)
      expect([entry, bundle?.run?.includes(entry)]).toEqual([entry, true]);
  });

  it('smoke-tests every bundle it copies, and copies every one it bundles', () => {
    const smoke = steps.find((s) => s.run?.includes('bundle-check'));
    const entries = [archive, user].flatMap(handlers).map((h) => h.replace(/\.handler$/, ''));
    expect(smoke).toBeDefined();
    for (const entry of entries) {
      expect([entry, smoke?.run?.includes(`dist/${entry}.js`)]).toEqual([entry, true]);
      expect([entry, smoke?.run?.includes(`require('./${entry}.js')`)]).toEqual([entry, true]);
    }
  });

  it('resolves the environment once, for both the credentials and the stack', () => {
    const [userStack] = deploys;
    expect(userStack.env?.ENVIRONMENT).toBe(wf.jobs.deploy.environment?.name);
    expect(userStack.run).toContain('--parameter-overrides');
    expect(userStack.run).toContain('"Environment=${ENVIRONMENT}"');
    expect(userStack.run).toContain('"OpenRegistration=');
  });

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

  // AND A PARAMETER WITH A DEFAULT IS PASSED ONLY WHEN IT HAS A VALUE. `sam deploy`
  // refuses an empty one — "not a valid format", and the command dies before making a
  // single AWS call — so a template `Default: ''` does not make an unset secret a
  // supported state on its own. Nothing but the argument list can fix it: the parser that
  // refuses is the CLI's rather than CloudFormation's.
  it('guards an optional parameter instead of passing it empty', () => {
    const [userStack] = deploys;
    const optional = Object.entries(user.Parameters ?? {})
      .filter(([, p]) => 'Default' in p)
      .map(([name]) => name);
    expect(optional.length).toBeGreaterThan(0);
    for (const name of optional) {
      if (!userStack.run?.includes(`"${name}=`)) continue;
      const variable = name.replace(/(?!^)([A-Z])/g, '_$1').toUpperCase();
      expect([name, userStack.run.includes(`-n "$${variable}"`)]).toEqual([name, true]);
    }
  });
});

describe('migrate.yml names the stack its target chose', () => {
  const wf = workflow('migrate.yml');
  // THROUGH THE CALL: the invoke now lives in the composite action both workflows use, so a
  // search of the job's own steps would find nothing and every assertion below would be asserting
  // about `undefined`. The assertion bodies are unchanged, but READ WHAT THEY NOW MEASURE — the
  // action's text, where `inputs.*` are the ACTION's inputs, not this workflow's. What couples the
  // two, and what a hard-coded `target: prod` in the call below would break, is pinned by
  // `is called by the dispatch as well, passing every input it takes`; nothing in this block sees
  // it. The environment, the concurrency group and the dispatch inputs are still this file's own.
  const steps = resolvedSteps(wf.jobs.migrate);

  it('resolves the function from a user stack, never the archive', () => {
    const resolve = steps.find((s) => s.run?.includes('--stack-name'));
    expect(resolve?.run).toContain('quirenote-backend-user-');
    // THROUGH `env:` NOW, not substituted into the shell string — the same property this always
    // asserted (the stack is built from the target, never hard-coded), read where it moved.
    expect(Object.values(resolve?.env ?? {})).toContain('${{ inputs.target }}');
  });

  it('runs one target at a time without blocking the other', () => {
    expect(wf.concurrency?.group).toContain('inputs.target');
  });

  it('resolves its environment from the target, never a literal', () => {
    expect(wf.jobs.migrate?.environment?.name).toBe('${{ inputs.target }}');
  });

  it('has no push trigger at all', () => {
    expect(wf.on.push).toBeUndefined();
    expect(wf.on.workflow_dispatch).toBeDefined();
  });

  // ORDER FIRST, ABSENCE SECOND. A `choice` with no `default` preselects its FIRST
  // option, so reordering these makes the safe-by-default target silently become
  // production. The absent `default` is pinned too, because `default: prod` would
  // override the order.
  it('offers dev before prod, and adds no default that would override the order', () => {
    const target = wf.on.workflow_dispatch?.inputs?.target;
    expect(target?.options).toEqual(['dev', 'prod']);
    expect(target).not.toHaveProperty('default');
    expect(target?.required).toBe(true);
  });

  it('offers the bootstrap mode without displacing the harmless default', () => {
    const mode = wf.on.workflow_dispatch?.inputs?.mode;
    expect(mode?.options).toEqual(['rehearse', 'dry-run', 'apply', 'bootstrap']);
    expect(mode?.default).toBe('rehearse');
  });

  it('builds the payload around the address rather than substituting it in', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    expect(invoke?.run).not.toContain('inputs.email');
    expect(invoke?.run).not.toContain('inputs.mode');
    expect(invoke?.run).toContain('jq -n');
    expect(invoke?.run).toContain('--arg');
    expect(Object.values(invoke?.env ?? {})).toContain('${{ inputs.email }}');
    expect(Object.values(invoke?.env ?? {})).toContain('${{ inputs.mode }}');
  });

  it('fails the run on a teardown that left its schema behind, and names it', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    expect(invoke?.run).toMatch(/if jq -e '\.teardown\.dropped == false' out\.json/);
    expect(invoke?.run).toMatch(/jq -r '\.teardown\.schema' out\.json/);
    expect(invoke?.run).toMatch(/drop it by hand[^\r\n]*[\r\n]\s*exit 1/);
  });

  // A rehearsal that RAISED carries the orphaned schema's name in its message, and that
  // name reaches an operator only if the step fails.
  it('fails the run when the handler raised', () => {
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke).toBeDefined();
    expect(invoke?.run).toMatch(/if jq -e 'has\("FunctionError"\)' invoke\.json/);
    expect(invoke?.run).toMatch(/the migration handler raised[^\r\n]*[\r\n]\s*exit 1/);
  });
});

describe('the deploy plans its migration, and a gated job applies it', () => {
  const wf = workflow('deploy-backend.yml');
  const deploy = wf.jobs.deploy;
  const migrate = wf.jobs.migrate;

  it('ends the deploy with a plan against the stack that deploy just shipped', () => {
    const steps = deploy.steps ?? [];
    const plan = steps[steps.length - 1];
    expect(plan?.uses).toBe(`${SELF}${INVOKE_ACTION}`);
    expect(plan?.id).toBe('plan');
    expect(plan?.with?.mode).toBe('dry-run');
    // THE CLUSTER IT PLANS AGAINST IS THE ONE IT DEPLOYED TO. Unpinned, a plan naming `dev` would
    // gate PROD's apply on dev's pending count — already migrated, so the apply is skipped and
    // production is never migrated at all, with this suite green.
    expect(plan?.with?.target).toBe(deploy.environment?.name);
    // LAST, AND THAT IS THE ASSERTION, not merely present: a plan read before `sam deploy` counts
    // the statements in the bundle the PREVIOUS run shipped, and would gate this run on them.
    const shipped = steps.map((s) => s.run?.includes('sam deploy') ?? false).lastIndexOf(true);
    expect(shipped).toBeGreaterThanOrEqual(0);
    expect(steps.length - 1).toBeGreaterThan(shipped);
  });

  it('carries the pending count out of the job, from that step', () => {
    expect(deploy.outputs?.pending).toBe('${{ steps.plan.outputs.pending }}');
    expect(action(ACTION_FILE).outputs?.pending?.value).toBe('${{ steps.invoke.outputs.pending }}');
  });

  it('needs the deploy, waits on a non-zero count, and rehearses before it applies', () => {
    expect(migrate.needs).toBe('deploy');
    expect(migrate.if).toContain('needs.deploy.outputs.pending');
    expect(migrate.if).toContain("!= '0'");
    // IN DOCUMENT ORDER, and `bootstrap` is asserted absent rather than assumed: it mints a real
    // identity, has no rehearsal, and is the one mode no automatic path may reach.
    expect(selfCalls(migrate).map((s) => s.with?.mode)).toEqual(['rehearse', 'apply']);
  });

  it('serialises on the group a dispatch at the same cluster would take', () => {
    const dispatch = workflow('migrate.yml');
    // TWO EXPRESSIONS, ONE STRING PER CLUSTER. Concurrency group names are repository-wide, so
    // this job and a hand dispatch can never both be running at one database — but only if the
    // two spellings agree once evaluated, which no comparison of the raw text would show.
    const evaluate = (expression: string, target: string) =>
      expression.replaceAll('${{ inputs.target }}', target).replaceAll(REF_TO_ENV, target);
    expect(migrate.concurrency?.group).toContain('migrate-');
    for (const target of ['dev', 'prod']) {
      expect([target, evaluate(migrate.concurrency?.group ?? '', target)]).toEqual([
        target,
        evaluate(dispatch.concurrency?.group ?? '', target),
      ]);
    }
    expect(migrate.concurrency?.['cancel-in-progress']).toBe(false);
  });

  // THE SAME ENVIRONMENT THE DEPLOY RESOLVED, which is the whole of the protection now that no
  // reviewer stands in front of it: `prod` admits `main` alone by its deployment branch policy,
  // before any credential exists. A `migrate-prod` of its own existed only to carry a required
  // reviewer that `prod` could not take without holding every frontend release; the reviewer is
  // gone, so the second environment is too. [*User schema and deletes*]
  it('applies against the cluster the deploy resolved, in that same environment', () => {
    expect(deploy.environment?.name).toBe(REF_TO_ENV);
    expect(migrate.environment?.name).toBe(REF_TO_ENV);
    // ONE EXPRESSION FOR THE CLUSTER, so the environment and the stack can never name different
    // ones — a plan against dev gating an apply against prod is the failure this refuses.
    for (const call of selfCalls(migrate)) expect(call.with?.target).toBe(deploy.environment?.name);
  });

  // WHAT REPLACED THE REVIEWER, so it is held to the shape that makes it a replacement. A red run
  // is an email governed by a personal setting no test here can read; an issue is durable, lands
  // in the project's Triage column, and mentions the owner.
  describe('a failed apply opens an issue, because nobody is watching the run', () => {
    const notify = wf.jobs.notify;
    const step = notify?.steps?.[0];

    // NOT `failure()`, AND THIS IS THE ASSERTION. GitHub documents it as true "if any ancestor
    // job fails", and `deploy` is an ancestor — it runs the whole suite, so `if: failure()` filed
    // a production-incident issue for a failing unit test, claiming stacks were live that
    // `sam deploy` had never reached. Pinned as the three clauses rather than a literal so the
    // property survives a rewording: the deploy succeeded, and the migration did not.
    it('fires on the state it is for, and not on any red run', () => {
      expect(notify?.needs).toEqual(['deploy', 'migrate']);
      const when = notify?.if ?? '';
      expect(when).not.toMatch(/(^|[^.\w])failure\(\)/);
      expect(when).toContain('always()');
      // The stacks updated — without this, a failing test or a failed plan reads as a migration.
      expect(when).toContain("needs.deploy.result == 'success'");
      // `!= success` rather than `== failure`, because a job CANCELLED while pending on the
      // cluster's group leaves the same state and is not a failure. `skipped` is the healthy one.
      expect(when).toContain("needs.migrate.result != 'success'");
      expect(when).toContain("needs.migrate.result != 'skipped'");
    });

    it('may write an issue and nothing else', () => {
      expect(notify?.permissions).toEqual({ issues: 'write' });
    });

    it('names the run, the repair and the owner', () => {
      expect(step?.run).toContain('gh issue create');
      expect(step?.run).toContain('gh issue comment');
      expect(step?.run).toContain('--label bug');
      expect(step?.run).toContain('migrate.yml');
      expect(Object.keys(step?.env ?? {})).toEqual(expect.arrayContaining(['GH_TOKEN', 'RUN_URL']));
      expect(step?.env?.TARGET).toBe(REF_TO_ENV);
    });

    // EVERY CLUSTER WORD COMES FROM `$TARGET`. `dev` is the continuous branch, so nearly every
    // issue this job ever writes will be a dev one; a body that says "production" regardless is
    // wrong in its first sentence, in the only durable record of the failure.
    it('says which cluster it means, and never hard-codes production', () => {
      const body =
        step?.run?.slice(step.run.indexOf('body=$('), step.run.indexOf('existing=')) ?? '';
      expect(body).not.toMatch(/\bproduction\b/i);
      expect(body).toContain('$TARGET');
    });

    // THE LOOKUP MUST NOT BE THE THING THAT LOSES THE SIGNAL. Search is an index minutes behind a
    // just-created issue, and the step runs under `bash -e`, where one failed lookup aborts before
    // either branch and the run leaves nothing at all.
    it('dedupes against the list API, and survives the lookup failing', () => {
      // COMMENT LINES DROPPED FIRST, or the sentence explaining why `--search` is wrong reads as
      // a use of it — which is what this assertion caught on its first run.
      const commands = (step?.run ?? '')
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
      expect(commands).toContain('gh issue list');
      expect(commands).not.toContain('--search');
      expect(commands).toMatch(/\|\| true/);
    });
  });

  it('checks nothing out, which the self-repository reference is what allows', () => {
    for (const step of migrate.steps ?? []) {
      expect([step.uses, step.uses?.includes('actions/checkout') ?? false]).toEqual([
        step.uses,
        false,
      ]);
    }
    expect(selfCalls(migrate).length).toBeGreaterThan(0);
    for (const call of selfCalls(migrate)) expect(call.uses?.startsWith(SELF)).toBe(true);
  });
});

describe('the invoke is written once, and both workflows call it', () => {
  // EVERY FILE, NOT A LIST OF EXTENSIONS. `infra/docs/role-deploy.md` rests the whole gate on
  // this sweep — "the gate is a property of what is written" — and an extension list would let a
  // `.py` helper, an extensionless script or a snippet in a `.md` carry the invoke unseen, making
  // that sentence false without anything here going red. Directories are dropped; `.github` holds
  // no binary.
  const files = readdirSync(join(REPO, '.github'), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(
      (entry) => `${entry.parentPath.replaceAll('\\', '/').slice(REPO.length + 1)}/${entry.name}`,
    );

  it('every self-repository reference resolves to a file that is here', () => {
    const referenced = Object.values(workflow('deploy-backend.yml').jobs)
      .concat(Object.values(workflow('migrate.yml').jobs))
      .flatMap((job) => job.steps ?? [])
      .filter((step) => step.uses?.startsWith(SELF))
      .map((step) => `${step.uses?.slice(SELF.length)}/action.yml`);
    expect(referenced.length).toBeGreaterThan(0);
    for (const file of new Set(referenced)) {
      expect([file, existsSync(join(REPO, file))]).toEqual([file, true]);
    }
  });

  it('is the only file under .github that invokes the runner', () => {
    expect(files).toContain(ACTION_FILE);
    const inlining = files.filter((file) => actionText(file).includes('aws lambda invoke'));
    expect(inlining).toEqual([ACTION_FILE]);
  });

  it('is called by the dispatch as well, passing every input it takes', () => {
    const calls = selfCalls(workflow('migrate.yml').jobs.migrate);
    expect(calls).toHaveLength(1);
    expect(calls[0].with).toEqual({
      target: '${{ inputs.target }}',
      mode: '${{ inputs.mode }}',
      email: '${{ inputs.email }}',
    });
  });

  // THE TWO SETTINGS THAT COULD START A SECOND MIGRATION, asserted on the file rather than on a
  // step, because either one deleted from anywhere in it is the same failure: the CLI's clock
  // starts before the function's 900s ceiling and `ReadTimeoutError` is in botocore's retryable
  // set, so a trip would RE-INVOKE into a migration in flight.
  it('holds the no-timeout and no-retry settings, and both verdicts', () => {
    const text = actionText(ACTION_FILE);
    // ONE ATTEMPT FOR EVERY MODE THAT WRITES. `dry-run` is exempt on purpose — it mutates
    // nothing and runs seconds after `sam deploy` replaced the function — so the `else` arm is
    // what has to be pinned, not the literal: it is the one that binds `apply` and `rehearse`.
    expect(text).toContain('else attempts=1');
    expect(text).toContain('AWS_MAX_ATTEMPTS=$attempts');
    expect(text).toMatch(/if \[ "\$MIGRATE_MODE" = 'dry-run' \]; then attempts=/);
    expect(text).toContain('--cli-read-timeout 0');
    // A REPORT THAT IS ABSENT IS NOT A REPORT THAT PARSED: `jq empty` exits 0 on a zero-byte
    // file, so without the size test every verdict below it clears on an empty report.
    expect(text).toContain('[ -s "$report" ]');
    // Fixed filenames, and one job calls this up to three times — a stale report from the
    // previous mode would be uploaded as this one's evidence.
    expect(text).toContain('rm -f out.json invoke.json');
    const steps = action(ACTION_FILE).runs.steps ?? [];
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    expect(invoke?.run).toMatch(/if jq -e 'has\("FunctionError"\)' invoke\.json/);
    expect(invoke?.run).toMatch(/if jq -e '\.teardown\.dropped == false' out\.json/);
    // A raised handler and a refused statement arrive the same way — the handler throws and Lambda
    // answers 200 with `FunctionError` — so what has to be pinned is that each check EXITS.
    expect(invoke?.run).toMatch(/the migration handler raised[^\r\n]*[\r\n]\s*exit 1/);
    expect(invoke?.run).toMatch(/drop it by hand[^\r\n]*[\r\n]\s*exit 1/);
  });

  it('keeps the report whatever the outcome, under a name no second call can collide with', () => {
    const steps = action(ACTION_FILE).runs.steps ?? [];
    const keep = steps.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(keep?.if).toBe('always()');
    // THE MODE AND THE ATTEMPT BOTH, because one run calls this action up to three times and
    // `upload-artifact@v4` refuses a name it has already uploaded. `run_attempt` is the one a
    // reader would prune as noise: `run_id` does not change on "Re-run failed jobs", so without
    // it an `if: always()` upload reddens a re-run whose apply had just succeeded.
    expect(keep?.with?.name).toContain('${{ inputs.mode }}');
    expect(keep?.with?.name).toContain('${{ inputs.target }}');
    expect(keep?.with?.name).toContain('${{ github.run_attempt }}');
  });

  it('counts what is pending before it can fail on the teardown', () => {
    const steps = action(ACTION_FILE).runs.steps ?? [];
    const invoke = steps.find((s) => s.run?.includes('aws lambda invoke'));
    const counted = invoke?.run?.indexOf('pending=') ?? -1;
    const teardown = invoke?.run?.indexOf('.teardown.dropped == false') ?? -1;
    expect(counted).toBeGreaterThanOrEqual(0);
    // A rehearsal that applied cleanly and could not drop its schema still planned correctly, and
    // the count is what the next job is gated on: written after the exit, it would never be set.
    expect(counted).toBeLessThan(teardown);
  });
});
