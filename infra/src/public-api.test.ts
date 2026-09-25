// `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]` arrives as the
// array `['IsProd', 'a', 'b']` and a `!Ref` as the bare parameter name, indistinguishable from a
// string spelled the same way. Where the tag is load-bearing, `intrinsicAt` reads the node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

// The route key is matched by string equality in three places and nothing validates them against
// each other. Renamed on one side alone, every suite here stays green and admin calls answer 400.
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
  // An empty or unparsed file passes every absence assertion below.
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

  // No authorizer in front of this one route, deliberately: the sign-up application exists to
  // create the very row the others are checked against. [*Auth model*]
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

  // One authorizer, native, no Lambda in the path: a second would be a second answer to which pool
  // a token may come from. [*Auth model*]
  //
  // AND NO `DefaultAuthorizer`, a decision rather than an oversight: SAM renders a route opted out
  // of a default against a scheme it never declares, and `FailOnWarnings: true` rolls the stack
  // back on a warning. The guarantee it was wanted for is the next test, which runs in this same
  // workflow BEFORE the deploy step.
  it('declares one JWT authorizer and no default', () => {
    expect(Object.keys(auth?.Authorizers ?? {})).toEqual([AUTHORIZER]);
    expect(auth?.DefaultAuthorizer).toBeUndefined();
    expect(source).not.toMatch(/Authorizer:\s*NONE/);
  });

  it('trusts this environment’s own pool and this environment’s own client', () => {
    const jwt = auth.Authorizers?.[AUTHORIZER].JwtConfiguration as { audience?: string[] };
    expect(jwt?.audience).toEqual(['UserPoolClient']);
    // Both are INTRINSICS, tag and value: a pool id spelled out would pin one environment's pool
    // into both stacks, and `toJS()` reads that as the same string.
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

  // This stands in for `DefaultAuthorizer` and is stronger: a route with no authorizer fails the
  // suite before `sam deploy` runs. PUBLIC IS A WRITTEN LIST, not a count — a count is satisfied
  // by the wrong route being the exception.
  const PUBLIC = [ROUTE];

  // A `Globals:` block is the one way auth can move without a route moving: `Globals.HttpApi.Auth`
  // reaches every route from outside the derivation below, and the test would keep passing.
  it('declares no Globals block', () => {
    expect(user as Record<string, unknown>).not.toHaveProperty('Globals');
  });

  it('gives every route the authorizer except the ones written down as public', () => {
    const unprotected = declaredRoutes()
      .filter((r) => r.authorizer !== AUTHORIZER)
      .map((r) => r.key);
    expect(unprotected).toEqual(PUBLIC);
  });

  // A second `AWS::Serverless::HttpApi` could carry no authorizer, and the check above — which
  // reads the event's own `Auth` block — would not notice.
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
  // What this protects is the account-level token bucket, not the table: a route left on the stage
  // default drains the bucket and takes every other route down with it. EVERY ROUTE, not only the
  // unauthenticated one — the role check runs inside the Lambda, after the connection, so the
  // authorizer admits every holder of a valid pool token.
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

  // A throttle key naming no real route configures nothing and fails nowhere, so it is derived.
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

  // A CORS list naming only the custom domain leaves the Amplify URL failing at the preflight.
  it('allows the custom host and the Amplify host, and nothing from the other environment', () => {
    expect(condition).toBe('IsProd');
    expect(prod.AllowOrigins).toContain('https://quirenote.com');
    expect(prod.AllowOrigins).toContain('https://main.d17m4jf400my6.amplifyapp.com');
    expect(dev.AllowOrigins).toContain('https://dev.quirenote.com');
    expect(dev.AllowOrigins).toContain('https://dev.d17m4jf400my6.amplifyapp.com');
    expect(prod.AllowOrigins.join()).not.toContain('dev.');
    expect(dev.AllowOrigins.every((o) => o.includes('dev'))).toBe(true);
  });

  // THE CONDITION IS ON THE WHOLE BLOCK AND BOTH ARMS ARE COMPLETE, which is not a style choice:
  // SAM builds the OpenAPI extension itself, and an intrinsic found at `AllowOrigins` sends it
  // down a branch that keeps that value and DROPS the methods, the headers and the max-age.
  // Nothing fails at deploy; the preflight simply stops naming a method.
  it('gives each environment a complete block, methods and headers included', () => {
    for (const [name, arm] of [
      ['prod', prod],
      ['dev', dev],
    ] as const) {
      expect([name, arm.AllowMethods?.slice().sort()]).toEqual([name, ['OPTIONS', 'POST']]);
      // `authorization` is what lets a browser send the token at all: every admin call is
      // cross-origin, and the preflight refuses a header the list does not name — a failure that
      // appears only in a browser, never in `curl`.
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
    // A `!Ref`, not a string spelled the same way: this repository is public, so a hard-coded ARN
    // is an account id in it and `toJS()` cannot tell the two apart.
    expect(
      intrinsicAt(doc, 'Resources', 'PublicApi', 'Properties', 'Domain', 'CertificateArn'),
    ).toEqual({ tag: '!Ref', value: 'ApiCertificateArn' });
  });

  // DNS is Cloudflare's: `Route53:` would create a record set in a zone this account lacks.
  it('asks for no Route 53 record', () => {
    expect(props('PublicApi').Domain).not.toHaveProperty('Route53');
  });

  it('takes the certificate as a parameter with no default', () => {
    expect(user.Parameters?.ApiCertificateArn?.Type).toBe('String');
    expect(user.Parameters?.ApiCertificateArn).not.toHaveProperty('Default');
  });

  // THE REGION IS THE TRAP, and copying the pool's pattern is how it is walked into: the pool's
  // certificate must be in us-east-1 because a Cognito custom domain is fronted by CloudFront,
  // which is global. An HTTP API custom domain is REGIONAL and needs its certificate in the API's
  // own region — so the valid ARN here is the one the pool's pattern would reject.
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
  // API Gateway names the regional endpoint itself and the Cloudflare record must point at that
  // exact name; until it exists the stack is green and the hostname resolves nowhere. Read through
  // SAM's referenceable property, never the generated logical id: AWS generates
  // `AWS::ApiGatewayV2::DomainName` under a hashed id whose hash may change, so
  // `PublicApi.DomainName` is the only stable way to reach it.
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
  // The grant, not only the endpoint variable: a copy-paste leaving the archive's cluster here
  // would pass every other test in this repository.
  it('may connect to the user cluster and to nothing else', () => {
    const policies = props('ApplicationsFunction').Policies as [
      { Statement: [Record<string, unknown>] },
    ];
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(1);
    const [statement] = policies[0].Statement;
    expect(statement.Action).toBe('dsql:DbConnectAdmin');
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
  const approve = ['Resources', 'ApproveFunction', 'Properties', 'Policies', 0, 'Statement'];

  // This function can mint an identity and disable one, so the pool is named, never wildcarded,
  // and the actions are the four the handler makes and no fifth. `AdminEnableUser` undoes this
  // file's own disable and grants no access by itself: an enabled identity with no `active` row is
  // refused by every route. `AdminDeleteUser` is absent — deleting a user is not decided.
  it('may create, read, disable and re-enable a user in ONE pool, and nothing else', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(
      grantAt(doc, approve, [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminGetUser',
      ]),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
  });

  it('may connect to the user cluster and to no other', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(grantAt(doc, approve, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
  });

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
