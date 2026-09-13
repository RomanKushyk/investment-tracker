// The repository's first HTTP API, pinned the way `cognito-pool.test.ts` pins the pool.
//
// Parsed the same way, for the same reason: `parseDocument`, asserting `errors` and never
// `warnings`, because every CloudFormation intrinsic is an unresolved tag to a YAML
// parser. `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]`
// arrives as the three-element array `['IsProd', 'a', 'b']` — which is what the paired
// assertions match — and a `!Ref` arrives as the bare parameter name, indistinguishable
// from a string spelled the same way. Where the tag itself is load-bearing, the raw source
// is the only place it survives.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

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
const DEV_API = 'api.dev.quirenote.com';
const PROD_API = 'api.quirenote.com';

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

  // NO AUTHORIZER, DELIBERATELY, and this is the one place that is true by design rather
  // than by omission. `docs/DECISIONS.md`, **Auth model**: three surfaces stand outside the
  // authorizer and check no application row — the archive's reads, the demo's, and the
  // sign-up application, which exists to create the very row the others are checked
  // against. The authorizer arrives with the authenticated routes; an `Auth` block landing
  // here quietly before then would close the only door a first visitor has.
  it('puts no authorizer in front of the application', () => {
    expect(props('PublicApi').Auth).toBeUndefined();
  });
});

describe('the route is throttled below the stage it sits in', () => {
  // WHAT WAF IS USUALLY BOUGHT FOR, and free. `app_user_email_uq` collapses one mailbox
  // submitted a thousand times into one row and can do nothing about a thousand different
  // ones, so this is the endpoint's only defence against that — and what it protects is
  // the account-level token bucket rather than the table: an unauthenticated route left on
  // the stage default drains the bucket and takes every other route down with it,
  // including the ones a signed-in owner needs to reach their own portfolio.
  it('gives the route its own ceiling, under the stage default', () => {
    const stage = props('PublicApi').DefaultRouteSettings as Record<string, number>;
    const routes = props('PublicApi').RouteSettings as Record<string, Record<string, number>>;
    expect(stage.ThrottlingRateLimit).toBeGreaterThan(0);
    expect(routes[ROUTE]).toBeDefined();
    expect(routes[ROUTE].ThrottlingRateLimit).toBeLessThan(stage.ThrottlingRateLimit);
    expect(routes[ROUTE].ThrottlingBurstLimit).toBeLessThan(stage.ThrottlingBurstLimit);
  });

  // ONE ENTRY, SPELLED THE WAY THE ROUTE ITSELF IS DECLARED. A throttle is matched to its
  // `<METHOD> <path>` key by string equality and nothing validates it: a key naming a
  // route that does not exist configures nothing, fails nowhere, and leaves the real route
  // on the stage default — the exact state this block exists to prevent. So the key is
  // derived from the event rather than compared to a second copy of the same literal.
  it('names one route, and names it the way the route is declared', () => {
    expect(Object.keys(props('PublicApi').RouteSettings as object)).toEqual([ROUTE]);
    const submit = Object.values(
      (props('ApplicationsFunction').Events ?? {}) as Record<
        string,
        { Properties?: { Method?: string; Path?: string } }
      >,
    )[0]?.Properties;
    expect(`${submit?.Method} ${submit?.Path}`).toBe(ROUTE);
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
      expect([name, arm.AllowHeaders]).toEqual([name, ['content-type']]);
    }
  });
});

describe('the custom domain takes a certificate from its own region', () => {
  it('names the hostname per environment and reads the certificate from a parameter', () => {
    const domain = props('PublicApi').Domain as Record<string, unknown>;
    expect(domain.DomainName).toEqual(['IsProd', PROD_API, DEV_API]);
    expect(domain.EndpointConfiguration).toBe('REGIONAL');
    expect(domain.CertificateArn).toBe('ApiCertificateArn');
    // AND IT IS STILL A `!Ref`. `toJS()` discards the tag and keeps the value, so the
    // assertion above cannot tell the intrinsic from a hard-coded string spelled the same
    // way — and this repository is public, so a hard-coded ARN is an account id in it.
    expect(source).toMatch(/CertificateArn:\s*!Ref\s+ApiCertificateArn/);
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
    expect(user.Outputs?.ApiDomainRegionalTarget).toBeDefined();
    expect(source).toMatch(/!GetAtt\s+PublicApi\.DomainName\.RegionalDomainName/);
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
    const [statement] = policies[0].Statement;
    expect(statement.Action).toBe('dsql:DbConnectAdmin');
    expect(statement.Resource).toBe('UserCluster.ResourceArn');
    // Sliced to THIS resource before matching: the runner carries the identical line, so
    // the same regex over the whole file would stay green against a hard-coded string here.
    const block = source.slice(source.indexOf('  ApplicationsFunction:'));
    expect(block).toMatch(/Resource:\s*!GetAtt\s+UserCluster\.ResourceArn/);
  });

  it('reads the USER cluster endpoint, as a !GetAtt', () => {
    const vars = (
      props('ApplicationsFunction').Environment as { Variables?: Record<string, string> }
    )?.Variables;
    expect(vars?.DSQL_ENDPOINT).toBe('UserCluster.Endpoint');
    expect(JSON.stringify(vars)).not.toContain('PriceCluster');
    expect(source).toMatch(/DSQL_ENDPOINT:\s*!GetAtt\s/);
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.ApplicationsLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ApplicationsLogGroup').RetentionInDays).toBe(30);
  });
});
