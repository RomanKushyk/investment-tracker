// The repository's first HTTP API, pinned the way `cognito-pool.test.ts` pins the pool.
//
// Parsed the same way, for the same reason: `parseDocument`, asserting `errors` and never
// `warnings`, because every CloudFormation intrinsic is an unresolved tag to a YAML
// parser. `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]`
// arrives as the three-element array `['IsProd', 'a', 'b']` — which is what the paired
// assertions match — and a `!Ref` arrives as the bare parameter name, indistinguishable
// from a string spelled the same way. Where the tag itself is load-bearing, `intrinsicAt`
// reads it off the document node, which is the only place it survives.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

// THE HANDLER'S OWN CONSTANTS, NOT A SECOND COPY OF THE SAME STRINGS. The route key is matched by
// string equality in three places — the template declares it, the template throttles it by the
// same key, and the handler dispatches on it — and nothing validates any of them against another.
// Renamed on one side alone, every suite here stays green and every admin call answers 400.
import { APPROVE_ROUTE, REJECT_ROUTE } from './approve';
import { envVars, grantAt, intrinsicAt } from './template-intrinsic';

type Resource = {
  Type: string;
  Properties?: Record<string, unknown>;
};
type Template = {
  Parameters?: Record<string, { Type: string; Default?: string }>;
  Resources: Record<string, Resource>;
  Outputs?: Record<string, { Value?: unknown }>;
};

const source = readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8');
const doc = parseDocument(source);
const user = doc.toJS() as Template;

const props = (id: string) => user.Resources[id]?.Properties ?? {};

const ROUTE = 'POST /v1/applications';
const AUTHORIZER = 'CognitoJwt';
const DEV_API = 'api.dev.quirenote.com';
const PROD_API = 'api.quirenote.com';

type Event = {
  Type?: string;
  Properties?: { ApiId?: string; Method?: string; Path?: string; Auth?: { Authorizer?: string } };
};

/** Every HttpApi route the template declares, as `<function> <METHOD> <path>` plus its authorizer. */
const declaredRoutes = () =>
  Object.entries(user.Resources)
    .filter(([, r]) => r.Type === 'AWS::Serverless::Function')
    .flatMap(([id, r]) =>
      Object.values((r.Properties?.Events ?? {}) as Record<string, Event>)
        .filter((e) => e.Type === 'HttpApi')
        .map((e) => ({
          fn: id,
          api: e.Properties?.ApiId,
          key: `${e.Properties?.Method} ${e.Properties?.Path}`,
          authorizer: e.Properties?.Auth?.Authorizer,
        })),
    );

describe('one unauthenticated route, on a domain the stack cannot finish', () => {
  // The anchor `cognito-pool.test.ts` and `stack-split.test.ts` both open with, for the
  // same reason: an empty or unparsed file passes every absence assertion below.
  it('parses, and the API is in it', () => {
    expect(doc.errors).toEqual([]);
    expect(user.Resources.PublicApi?.Type).toBe('AWS::Serverless::HttpApi');
  });

  it('routes POST /v1/applications at the handler and declares no other route', () => {
    const events = (props('ApplicationsFunction').Events ?? {}) as Record<
      string,
      { Type?: string; Properties?: { ApiId?: string; Method?: string; Path?: string } }
    >;
    const declared = Object.values(events).map((e) => [
      e.Type,
      e.Properties?.Method,
      e.Properties?.Path,
    ]);
    expect(declared).toEqual([['HttpApi', 'POST', '/v1/applications']]);
    expect(Object.values(events)[0].Properties?.ApiId).toBe('PublicApi');
    expect(props('ApplicationsFunction').Handler).toBe('applications.handler');
  });

  // NO AUTHORIZER IN FRONT OF THIS ONE ROUTE, deliberately. `docs/DECISIONS.md`, **Auth
  // model**: three surfaces stand outside the authorizer and check no application row — the
  // archive's reads, the demo's, and the sign-up application, which exists to create the very
  // row the others are checked against. One of the three is a route on this API today.
  it('puts no authorizer in front of the application', () => {
    const [submit] = declaredRoutes().filter((r) => r.key === ROUTE);
    expect(submit.authorizer).toBeUndefined();
  });
});

describe('every other route is behind the pool, and the pool is the only issuer', () => {
  const auth = props('PublicApi').Auth as {
    Authorizers?: Record<string, Record<string, unknown>>;
    DefaultAuthorizer?: string;
  };

  // ONE AUTHORIZER, NATIVE, NO LAMBDA IN THE PATH — `docs/DECISIONS.md`, **Auth model**. A
  // second one would be a second answer to which pool a token may come from.
  //
  // AND NO `DefaultAuthorizer`, WHICH IS A DECISION RATHER THAN AN OVERSIGHT. SAM renders a
  // route opted out of a default as `security: [{"NONE": []}]` against a scheme it never
  // declares, and this API sets `FailOnWarnings: true` — which rolls the stack back on a warning
  // `ImportApi` merely records. Whether it records one there is not answerable before a deploy,
  // and the answer would arrive as a red deploy blocking `dev`. The guarantee the default was
  // wanted for is the next test instead, and it runs in this same workflow BEFORE the deploy
  // step, so a route that forgot its authorizer cannot reach AWS at all.
  it('declares one JWT authorizer and no default', () => {
    expect(Object.keys(auth?.Authorizers ?? {})).toEqual([AUTHORIZER]);
    expect(auth?.DefaultAuthorizer).toBeUndefined();
    expect(source).not.toMatch(/Authorizer:\s*NONE/);
  });

  it('trusts this environment’s own pool and this environment’s own client', () => {
    const jwt = auth.Authorizers?.[AUTHORIZER].JwtConfiguration as { audience?: string[] };
    // ONE audience and no second, which is the part a path cannot say: a client added here
    // would be trusted by every route.
    expect(jwt?.audience).toEqual(['UserPoolClient']);
    // AND BOTH ARE INTRINSICS, tag and value together. A pool id spelled out would pin one
    // environment's pool into both stacks, and `toJS()` reads that as the same string.
    const jwtPath = ['Resources', 'PublicApi', 'Properties', 'Auth', 'Authorizers', AUTHORIZER];
    expect(intrinsicAt(doc, ...jwtPath, 'JwtConfiguration', 'issuer')).toEqual({
      tag: '!Sub',
      value: 'https://cognito-idp.${AWS::Region}.amazonaws.com/${UserPool}',
    });
    expect(intrinsicAt(doc, ...jwtPath, 'JwtConfiguration', 'audience', 0)).toEqual({
      tag: '!Ref',
      value: 'UserPoolClient',
    });
    expect(auth.Authorizers?.[AUTHORIZER].IdentitySource).toBe('$request.header.Authorization');
  });

  // THIS IS THE ONE THAT STANDS IN FOR `DefaultAuthorizer`, and it is stronger in the way that
  // matters: a route declared with no authorizer fails the suite, and `pnpm test` runs earlier in
  // the same workflow than `sam deploy`, so such a route never reaches AWS. PUBLIC IS A WRITTEN
  // LIST, not a count — a count is satisfied by the wrong route being the exception.
  const PUBLIC = [ROUTE];

  // A `Globals:` BLOCK IS THE ONE WAY AUTH CAN MOVE WITHOUT A ROUTE MOVING. The template forbids
  // one in prose — "NO `Globals:` BLOCK, here as everywhere in this file" — and prose is not a
  // gate: `Globals.HttpApi.Auth` would reach every route at once, from outside the derivation
  // below, and the test would keep reading the events and keep passing.
  it('declares no Globals block', () => {
    expect(user as Record<string, unknown>).not.toHaveProperty('Globals');
  });

  it('gives every route the authorizer except the ones written down as public', () => {
    const unprotected = declaredRoutes()
      .filter((r) => r.authorizer !== AUTHORIZER)
      .map((r) => r.key);
    expect(unprotected).toEqual(PUBLIC);
  });

  // AND EVERY ROUTE IS ON THIS API. A second `AWS::Serverless::HttpApi` is an allowed resource
  // type here, so a route could be declared against one that carries no authorizer at all — and
  // the check above, which reads the event's own `Auth` block, would not notice.
  it('declares every route against the one API', () => {
    expect(declaredRoutes().map((r) => r.api)).toEqual(declaredRoutes().map(() => 'PublicApi'));
  });

  it('puts approve and reject on this API, each naming the authorizer', () => {
    const admin = declaredRoutes().filter((r) => r.fn === 'ApproveFunction');
    expect(admin.map((r) => r.key).sort()).toEqual([APPROVE_ROUTE, REJECT_ROUTE].sort());
    for (const route of admin) {
      expect([route.key, route.api]).toEqual([route.key, 'PublicApi']);
      expect([route.key, route.authorizer]).toEqual([route.key, AUTHORIZER]);
    }
    expect(props('ApproveFunction').Handler).toBe('approve.handler');
  });
});

describe('the route is throttled below the stage it sits in', () => {
  // WHAT WAF IS USUALLY BOUGHT FOR, and free. `app_user_email_uq` collapses one mailbox
  // submitted a thousand times into one row and can do nothing about a thousand different
  // ones, so this is the endpoint's only defence against that — and what it protects is
  // the account-level token bucket rather than the table: an unauthenticated route left on
  // the stage default drains the bucket and takes every other route down with it,
  // including the ones a signed-in owner needs to reach their own portfolio.
  // EVERY ROUTE, NOT ONLY THE UNAUTHENTICATED ONE. The admin routes need it for a reason that is
  // easy to talk yourself out of: the role check runs inside the Lambda, after the connection, so
  // the authorizer admits every holder of a valid pool token and a `pending` applicant reaches
  // the function as often as they like. Left on the stage default they would want hundreds of
  // concurrent executions out of an account pool the template sizes at about ten.
  it('gives every route its own ceiling, under the stage default', () => {
    const stage = props('PublicApi').DefaultRouteSettings as Record<string, number>;
    const routes = props('PublicApi').RouteSettings as Record<string, Record<string, number>>;
    expect(stage.ThrottlingRateLimit).toBeGreaterThan(0);
    for (const { key } of declaredRoutes()) {
      expect([key, routes[key] !== undefined]).toEqual([key, true]);
      expect([key, routes[key].ThrottlingRateLimit < stage.ThrottlingRateLimit]).toEqual([
        key,
        true,
      ]);
      expect([key, routes[key].ThrottlingBurstLimit < stage.ThrottlingBurstLimit]).toEqual([
        key,
        true,
      ]);
    }
  });

  // ONE ENTRY, SPELLED THE WAY THE ROUTE ITSELF IS DECLARED. A throttle is matched to its
  // `<METHOD> <path>` key by string equality and nothing validates it: a key naming a
  // route that does not exist configures nothing, fails nowhere, and leaves the real route
  // on the stage default — the exact state this block exists to prevent. So the key is
  // derived from the event rather than compared to a second copy of the same literal.
  it('throttles the routes that exist and no others', () => {
    expect(Object.keys(props('PublicApi').RouteSettings as object).sort()).toEqual(
      declaredRoutes()
        .map((r) => r.key)
        .sort(),
    );
  });
});

describe('the browser origins are named per environment', () => {
  type Cors = { AllowOrigins: string[]; AllowMethods: string[]; AllowHeaders: string[] };
  const [condition, prod, dev] = props('PublicApi').CorsConfiguration as [string, Cors, Cors];

  // BOTH HOSTS, because both serve the app: the custom domain and the Amplify one the
  // branch is deployed to (`docs/reference/DEPLOYMENT.md`). A CORS list naming only the
  // first leaves the Amplify URL — which is what a deploy preview is checked on — failing
  // at the preflight, months after the branch that caused it merged.
  it('allows the custom host and the Amplify host, and nothing from the other environment', () => {
    expect(condition).toBe('IsProd');
    expect(prod.AllowOrigins).toContain('https://quirenote.com');
    expect(prod.AllowOrigins).toContain('https://main.d17m4jf400my6.amplifyapp.com');
    expect(dev.AllowOrigins).toContain('https://dev.quirenote.com');
    expect(dev.AllowOrigins).toContain('https://dev.d17m4jf400my6.amplifyapp.com');
    expect(prod.AllowOrigins.join()).not.toContain('dev.');
    expect(dev.AllowOrigins.every((o) => o.includes('dev'))).toBe(true);
  });

  // THE CONDITION IS ON THE WHOLE BLOCK AND BOTH ARMS ARE COMPLETE, which is not a style
  // choice and not obvious from the deployed result. SAM builds the OpenAPI extension
  // itself, and an intrinsic found at `AllowOrigins` sends it down a branch that keeps
  // that value and DROPS the methods, the headers and the max-age — emitting an
  // `x-amazon-apigateway-cors` that resolves to a bare list where an object belongs.
  // Nothing fails at deploy; the preflight simply stops naming a method. Asserting each
  // arm separately is what makes the shape impossible to simplify back.
  it('gives each environment a complete block, methods and headers included', () => {
    for (const [name, arm] of [
      ['prod', prod],
      ['dev', dev],
    ] as const) {
      expect([name, arm.AllowMethods?.slice().sort()]).toEqual([name, ['OPTIONS', 'POST']]);
      // `authorization` IS WHAT LETS A BROWSER SEND THE TOKEN AT ALL. The admin routes are on
      // a different host from the app, so every call is cross-origin and the preflight refuses
      // a header the list does not name — a failure that appears only in a browser, never in
      // `curl`, and only once a screen exists to make the call.
      expect([name, arm.AllowHeaders?.slice().sort()]).toEqual([
        name,
        ['authorization', 'content-type'],
      ]);
    }
  });
});

describe('the custom domain takes a certificate from its own region', () => {
  it('names the hostname per environment and reads the certificate from a parameter', () => {
    const domain = props('PublicApi').Domain as Record<string, unknown>;
    expect(domain.DomainName).toEqual(['IsProd', PROD_API, DEV_API]);
    expect(domain.EndpointConfiguration).toBe('REGIONAL');
    // A `!Ref` rather than a string spelled the same way: this repository is public, so a
    // hard-coded ARN is an account id in it, and `toJS()` cannot tell the two apart.
    expect(
      intrinsicAt(doc, 'Resources', 'PublicApi', 'Properties', 'Domain', 'CertificateArn'),
    ).toEqual({ tag: '!Ref', value: 'ApiCertificateArn' });
  });

  // DNS IS CLOUDFLARE'S. SAM creates a Route 53 record set when `Route53:` is present, in a
  // hosted zone this account does not have; the record is added by hand, DNS-only, from the
  // output below.
  it('asks for no Route 53 record', () => {
    expect(props('PublicApi').Domain).not.toHaveProperty('Route53');
  });

  it('takes the certificate as a parameter with no default', () => {
    expect(user.Parameters?.ApiCertificateArn?.Type).toBe('String');
    expect(user.Parameters?.ApiCertificateArn).not.toHaveProperty('Default');
  });

  // THE REGION IS THE TRAP, and copying the pool's pattern is how it is walked into. The
  // pool's certificate must be in **us-east-1** whatever region the pool is in, because a
  // Cognito custom domain is fronted by CloudFront, which is global. An HTTP API custom
  // domain is REGIONAL, and AWS requires its certificate in the API's own region — so the
  // valid ARN here is the one the pool's pattern would reject, and the other way round.
  it('refuses an empty or non-eu-north-1 certificate before it creates anything', () => {
    const p = user.Parameters?.ApiCertificateArn as {
      MinLength?: number;
      AllowedPattern?: string;
    };
    expect(p?.MinLength).toBe(1);
    expect(p?.AllowedPattern).toContain('eu-north-1');
    const pattern = new RegExp(p.AllowedPattern as string);
    expect(pattern.test('')).toBe(false);
    expect(pattern.test('arn:aws:acm:us-east-1:123456789012:certificate/abc')).toBe(false);
    expect(pattern.test('arn:aws:acm:eu-north-1:123456789012:certificate/abc')).toBe(true);
  });
});

describe('the stack publishes what nobody outside it can construct', () => {
  // THE SAME SHAPE AS `UserPoolDomainCloudFrontAlias`, and the same reason. API Gateway
  // builds a regional endpoint for the custom domain and names it itself; the Cloudflare
  // record has to point at that exact name, DNS-only. Until the record exists the stack is
  // green and the hostname resolves nowhere.
  //
  // READ THROUGH SAM'S REFERENCEABLE PROPERTY, never through the generated logical id: AWS
  // generates `AWS::ApiGatewayV2::DomainName` under a hashed id and documents that the hash
  // may change, so `PublicApi.DomainName` is the only stable way to reach it.
  it('outputs the domain, its regional target and the endpoint that works before DNS', () => {
    expect(user.Outputs?.ApiDomain?.Value).toEqual(['IsProd', PROD_API, DEV_API]);
    expect(intrinsicAt(doc, 'Outputs', 'ApiDomainRegionalTarget', 'Value')).toEqual({
      tag: '!GetAtt',
      value: 'PublicApi.DomainName.RegionalDomainName',
    });
    expect(user.Outputs?.ApiEndpoint).toBeDefined();
  });
});

describe('the handler is wired to the user cluster and logs like its neighbours', () => {
  // THE GRANT, NOT ONLY THE ENDPOINT VARIABLE. The variable says which cluster the handler
  // dials; the policy says which one it is ALLOWED to dial as `admin`, and that is the
  // assertion worth having on an internet-facing unauthenticated function. A copy-paste
  // leaving the archive's cluster here would pass every other test in this repository.
  it('may connect to the user cluster and to nothing else', () => {
    const policies = props('ApplicationsFunction').Policies as [
      { Statement: [Record<string, unknown>] },
    ];
    expect(policies).toHaveLength(1);
    // BOTH LISTS, because they are different claims and only one of them was made here. The line
    // above bounds the POLICIES; this bounds the statements inside the one policy, which is where
    // a second grant lands — and on the internet-facing unauthenticated function, a second grant
    // is the whole of what "and nothing else" is promising about.
    expect(policies[0].Statement).toHaveLength(1);
    const [statement] = policies[0].Statement;
    expect(statement.Action).toBe('dsql:DbConnectAdmin');
    // Addressed at THIS function's own statement, and reached through the action it grants
    // rather than through its position: three grants in the template name the same cluster ARN,
    // so a hard-coded one here reads as every other one's line.
    expect(
      grantAt(
        doc,
        ['Resources', 'ApplicationsFunction', 'Properties', 'Policies', 0, 'Statement'],
        'dsql:DbConnectAdmin',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserCluster.ResourceArn' });
  });

  it('reads the USER cluster endpoint, as a !GetAtt', () => {
    const vars = (
      props('ApplicationsFunction').Environment as { Variables?: Record<string, string> }
    )?.Variables;
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
    expect(intrinsicAt(doc, ...envVars('ApplicationsFunction'), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.ApplicationsLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ApplicationsLogGroup').RetentionInDays).toBe(30);
  });
});

describe('the approval handler holds exactly two grants, and they are different in kind', () => {
  const policies = props('ApproveFunction').Policies as [{ Statement: Record<string, unknown>[] }];
  const approveStatement = (i: number) =>
    ['Resources', 'ApproveFunction', 'Properties', 'Policies', 0, 'Statement', i] as const;

  // THE COGNITO HALF IS THE ONE WORTH ASSERTING. This function can mint an identity and
  // disable one, which is the widest thing in the stack after the runner's — so the pool it
  // may do that to is named, never wildcarded, and the actions are the four the handler
  // makes and no fifth. `AdminEnableUser` is there to undo this file's own disable on the one
  // path that can turn off an account another caller just approved, and it grants no access by
  // itself: an enabled identity with no `active` row is refused by every route.
  // `AdminDeleteUser` in particular is absent: deleting a user is not implemented and not
  // decided.
  it('may create, read, disable and re-enable a user in ONE pool, and nothing else', () => {
    const statements = policies[0].Statement;
    const cognito = statements.findIndex((s) => JSON.stringify(s.Action).includes('cognito-idp:'));
    expect(cognito).toBeGreaterThanOrEqual(0);
    expect((statements[cognito]?.Action as string[]).slice().sort()).toEqual([
      'cognito-idp:AdminCreateUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminGetUser',
    ]);
    // The pool as the intrinsic, on the statement those actions are in. Three other grants in
    // the template name the same ARN, so this is addressed by path rather than matched as text.
    expect(intrinsicAt(doc, ...approveStatement(cognito), 'Resource')).toEqual({
      tag: '!GetAtt',
      value: 'UserPool.Arn',
    });
  });

  it('may connect to the user cluster and to no other', () => {
    const statements = policies[0].Statement;
    const dsql = statements.findIndex((s) => s.Action === 'dsql:DbConnectAdmin');
    expect(dsql).toBeGreaterThanOrEqual(0);
    expect(statements).toHaveLength(2);
    expect(intrinsicAt(doc, ...approveStatement(dsql), 'Resource')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
  });

  // ONE PARAMETER DRIVES EVERY CONSUMER OF THE SWITCH. The pool's `AllowAdminCreateUserOnly`
  // and the trigger's environment were the first two; the gate is the third, because it is
  // what creates a row for somebody who got in through the open door. Read from the same
  // condition so the three cannot disagree.
  it('reads the pool and the registration switch from the stack, not from a literal', () => {
    const vars = (props('ApproveFunction').Environment as { Variables?: Record<string, unknown> })
      ?.Variables;
    expect(intrinsicAt(doc, ...envVars('ApproveFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
    expect(intrinsicAt(doc, ...envVars('ApproveFunction'), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    expect(vars?.OPEN_REGISTRATION).toEqual(['IsRegistrationOpen', 'true', 'false']);
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.ApproveLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ApproveLogGroup').RetentionInDays).toBe(30);
  });
});
