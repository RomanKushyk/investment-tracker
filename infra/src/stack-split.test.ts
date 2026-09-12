import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { REPO } from '../../src/repo-root';

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
  DeletionPolicy?: string;
  UpdateReplacePolicy?: string;
  Properties?: {
    Handler?: string;
    DeletionProtectionEnabled?: boolean;
    Environment?: { Variables?: Record<string, string> };
    Tags?: { Key: string; Value: unknown }[];
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
  it('uses only the three resource types user data needs', () => {
    const allowed = new Set([CLUSTER, 'AWS::Serverless::Function', 'AWS::Logs::LogGroup']);
    for (const [id, r] of resources(user)) expect([id, allowed.has(r.Type)]).toEqual([id, true]);
  });

  it('its one function is the runner, pointed at the USER cluster', () => {
    const functions = idsOfType(user, 'AWS::Serverless::Function');
    expect(functions).toHaveLength(1);
    const fn = user.Resources[functions[0]];
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
  // days". Prod's cluster is worth that; dev's, which is `003` plus `005` and a
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

// The acceptance criterion "no archive row is duplicated", stated as the structural
// fact beneath it: there is one capture pipeline in existence, so there is one writer.
describe('the capture pipeline exists exactly once across both templates', () => {
  const both = [archive, user];

  it('has one capture handler, and it is the archive stack that has it', () => {
    expect(both.flatMap(handlers).filter((h) => h === 'capture.handler')).toHaveLength(1);
    expect(handlers(archive)).toContain('capture.handler');
  });

  it('has one schedule', () => {
    expect(both.flatMap((t) => idsOfType(t, 'AWS::Scheduler::Schedule'))).toHaveLength(1);
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

  // ONE RESOLUTION, USED TWICE. The job's environment decides which credentials the job
  // holds; the step's ENVIRONMENT decides which stack it writes. They are the same
  // expression and must stay so — diverged, the job assumes production's role and
  // deploys the dev stack, or the reverse.
  it('resolves the environment once, for both the credentials and the stack', () => {
    const [userStack] = deploys;
    expect(userStack.env?.ENVIRONMENT).toBe(wf.jobs.deploy.environment?.name);
    expect(userStack.run).toContain('--parameter-overrides "Environment=${ENVIRONMENT}"');
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
});
