// `toJS()` keeps an intrinsic's value and discards its tag, so `!If [IsProd, a, b]` arrives as the
// array `['IsProd', 'a', 'b']` and a `!Ref` as the bare parameter name, indistinguishable from a
// string spelled the same way. Where the tag is load-bearing, `intrinsicAt` reads the node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { TERMS_ROUTE } from './accept-terms';
import { LIST_ROUTE } from './admin-users';
// The route key is matched by string equality in three places and nothing validates them against
// each other. Renamed on one side alone, every suite here stays green and admin calls answer 400.
import { APPROVE_ROUTE, REJECT_ROUTE } from './approve';
import { DIAGNOSIS_ROUTE } from './archive-admin';
import {
  OPERATIONS_ROUTE,
  OPERATION_ROUTE,
  START_ROUTE as OPERATION_START_ROUTE,
} from './archive-operations';
import {
  CSRF_HEADER,
  GOOGLE_BEGIN_ROUTE,
  GOOGLE_COMPLETE_ROUTE,
  PASSKEY_COMPLETE_ROUTE,
  PASSKEY_LIST_ROUTE,
  PASSKEY_START_ROUTE,
  REFRESH_ROUTE,
  RESPOND_ROUTE,
  SIGN_OUT_GLOBAL_ROUTE,
  SIGN_OUT_ROUTE,
  START_ROUTE,
} from './auth-relay';
import { ANSWER_MS, SECRET_MS } from './bot-check';
import { DELETION_ROUTE } from './deletion';
import { envVars, grantAt, intrinsicAt, tagAt } from './template-intrinsic';
import { ABORT_ROUTE, BEGIN_ROUTE, COMMIT_ROUTE, PART_ROUTE } from './imports';
import { ME_ROUTE } from './me';
import { MUTATIONS_ROUTE, STATE_ROUTE } from './mutations';
import { BALANCES_ROUTE, DAY_ROUTE, EXPOSED, ROUTE as VIEW_ROUTE, SERIES_ROUTE } from './view';

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

const ROUTE = 'POST /applications';
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

describe('the application route, on a domain the stack cannot finish', () => {
  // An empty or unparsed file passes every absence assertion below.
  it('parses, and the API is in it', () => {
    expect(doc.errors).toEqual([]);
    expect(user.Resources.PublicApi?.Type).toBe('AWS::Serverless::HttpApi');
  });

  it('routes POST /applications at the handler and declares no other route', () => {
    const events = (props('ApplicationsFunction').Events ?? {}) as Record<
      string,
      { Type?: string; Properties?: { ApiId?: string; Method?: string; Path?: string } }
    >;
    const declared = Object.values(events).map((e) => [
      e.Type,
      e.Properties?.Method,
      e.Properties?.Path,
    ]);
    expect(declared).toEqual([['HttpApi', 'POST', '/applications']]);
    expect(Object.values(events)[0].Properties?.ApiId).toBe('PublicApi');
    expect(props('ApplicationsFunction').Handler).toBe('applications.handler');
  });

  // No authorizer in front of this route, deliberately: the sign-up application exists to create
  // the very row the others are checked against. [*Auth model*]
  it('puts no authorizer in front of the application', () => {
    const [submit] = declaredRoutes().filter((r) => r.key === ROUTE);
    expect(submit.authorizer).toBeUndefined();
  });
});

// The SPA is the only client and deploys from the same commit, so a breaking change is a deploy,
// never a version. [*API shape*]
describe('the paths carry no version', () => {
  it('declares no route with a version segment', () => {
    const paths = declaredRoutes().map((r) => r.key.split(' ')[1]);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => p.split('/').some((seg) => /^v\d+/i.test(seg)))).toEqual([]);
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
  const PUBLIC = [
    ROUTE,
    START_ROUTE,
    RESPOND_ROUTE,
    REFRESH_ROUTE,
    SIGN_OUT_ROUTE,
    SIGN_OUT_GLOBAL_ROUTE,
    GOOGLE_BEGIN_ROUTE,
    GOOGLE_COMPLETE_ROUTE,
    PASSKEY_LIST_ROUTE,
    PASSKEY_START_ROUTE,
    PASSKEY_COMPLETE_ROUTE,
  ];

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

  // THE API'S BODY IS OURS, SO SAM CHECKS NEITHER: a second event on a route overwrites the first's
  // integration, and a function's `Condition` leaves its path in the body unconditionally.
  it('declares each route once, from functions with no condition', () => {
    const keys = declaredRoutes().map((r) => r.key);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    const conditional = [...new Set(declaredRoutes().map((r) => r.fn))].filter(
      (fn) => 'Condition' in (user.Resources[fn] ?? {}),
    );
    expect(conditional).toEqual([]);
  });

  it('puts the list, approve and reject on this API, each naming the authorizer', () => {
    const admin = declaredRoutes().filter((r) => r.fn === 'ApproveFunction');
    expect(admin.map((r) => r.key).sort()).toEqual(
      [LIST_ROUTE, APPROVE_ROUTE, REJECT_ROUTE].sort(),
    );
    for (const route of admin) {
      expect([route.key, route.api]).toEqual([route.key, 'PublicApi']);
      expect([route.key, route.authorizer]).toEqual([route.key, AUTHORIZER]);
    }
    expect(props('ApproveFunction').Handler).toBe('approve.handler');
  });

  it('puts the derived reads on this API, each a GET naming the authorizer', () => {
    const read = declaredRoutes().filter((r) => r.fn === 'ViewFunction');
    expect(read.map((r) => [r.key, r.api, r.authorizer])).toEqual([
      [VIEW_ROUTE, 'PublicApi', AUTHORIZER],
      [SERIES_ROUTE, 'PublicApi', AUTHORIZER],
      [BALANCES_ROUTE, 'PublicApi', AUTHORIZER],
      [DAY_ROUTE, 'PublicApi', AUTHORIZER],
    ]);
    expect(props('ViewFunction').Handler).toBe('view.handler');
    expect(user.Resources.ViewLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ViewLogGroup').RetentionInDays).toBe(30);
  });

  it('puts the write, the export, the import, the settings, the account’s own read and the terms’ acceptance on this API, each naming the authorizer', () => {
    const routes = declaredRoutes().filter((r) => r.fn === 'MutationsFunction');
    expect(routes.map((r) => [r.key, r.api, r.authorizer])).toEqual([
      [MUTATIONS_ROUTE, 'PublicApi', AUTHORIZER],
      [STATE_ROUTE, 'PublicApi', AUTHORIZER],
      [BEGIN_ROUTE, 'PublicApi', AUTHORIZER],
      [PART_ROUTE, 'PublicApi', AUTHORIZER],
      [COMMIT_ROUTE, 'PublicApi', AUTHORIZER],
      [ABORT_ROUTE, 'PublicApi', AUTHORIZER],
      // A literal, not `SETTINGS_ROUTE`, so the template is held to the route on its own.
      ['PATCH /me/settings', 'PublicApi', AUTHORIZER],
      [ME_ROUTE, 'PublicApi', AUTHORIZER],
      [TERMS_ROUTE, 'PublicApi', AUTHORIZER],
    ]);
    expect(props('MutationsFunction').Handler).toBe('mutations.handler');
    expect(user.Resources.MutationsLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('MutationsLogGroup').RetentionInDays).toBe(30);
  });

  it('puts the account’s deletion on this API, in a function of its own, naming the authorizer', () => {
    const routes = declaredRoutes().filter((r) => r.fn === 'DeleteAccountFunction');
    expect(routes.map((r) => [r.key, r.api, r.authorizer])).toEqual([
      [DELETION_ROUTE, 'PublicApi', AUTHORIZER],
    ]);
    expect(props('DeleteAccountFunction').Handler).toBe('deletion.handler');
    expect(user.Resources.DeleteAccountLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('DeleteAccountLogGroup').RetentionInDays).toBe(30);
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

  it('admits the application at two a second with a burst of five', () => {
    const settings = props('PublicApi').RouteSettings as Record<string, Record<string, unknown>>;
    expect(settings[ROUTE]).toEqual({ ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 });
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

describe('the relay: ten POSTs outside the authorizer, reading its two secrets', () => {
  const relay = ['Resources', 'AuthRelayFunction', 'Properties', 'Policies', 0, 'Statement'];

  // OUTSIDE THE AUTHORIZER BECAUSE THEY ARE HOW A TOKEN IS OBTAINED OR SPENT: a caller reaching them
  // holds none yet, or holds only the cookies. [*Auth model*]
  it('routes the six sign-in routes, sign-out everywhere and the three passkey calls at the relay, each a POST with no authorizer', () => {
    const routes = declaredRoutes().filter((r) => r.fn === 'AuthRelayFunction');
    expect(routes.map((r) => r.key)).toEqual([
      START_ROUTE,
      RESPOND_ROUTE,
      REFRESH_ROUTE,
      SIGN_OUT_ROUTE,
      SIGN_OUT_GLOBAL_ROUTE,
      GOOGLE_BEGIN_ROUTE,
      GOOGLE_COMPLETE_ROUTE,
      PASSKEY_LIST_ROUTE,
      PASSKEY_START_ROUTE,
      PASSKEY_COMPLETE_ROUTE,
    ]);
    for (const route of routes) {
      expect([route.key, route.api, route.authorizer]).toEqual([route.key, 'PublicApi', undefined]);
    }
    expect(props('AuthRelayFunction').Handler).toBe('auth-relay.handler');
  });

  // NO GET REACHES IT, and neither does a catch-all: a GET is a request a page can send cross-site
  // with no preflight, which is the one the custom header exists to force.
  it('lets nothing but a POST reach an /auth path, and declares no catch-all', () => {
    const events = Object.values(user.Resources).flatMap((r) =>
      Object.values((r.Properties?.Events ?? {}) as Record<string, Event>),
    );
    for (const e of events) {
      const key = `${e.Properties?.Method} ${e.Properties?.Path}`;
      expect([key, e.Properties?.Method?.toUpperCase() === 'ANY']).toEqual([key, false]);
      expect([key, /\$default|\+\}/.test(e.Properties?.Path ?? '')]).toEqual([key, false]);
      if (e.Properties?.Path?.startsWith('/auth/')) {
        expect([key, e.Properties?.Method]).toEqual([key, 'POST']);
      }
    }
  });

  // TWO ACTIONS ON ONE POOL — the secret's read, pool-wide by the accepted cost of storing it nowhere,
  // and sign-out everywhere, which a Google token's scope cannot authorize — and the one bot-check
  // parameter; the passkey calls take the user's access token, which Cognito checks alone.
  it('may read the client secret and end a user’s sessions in this pool, read its bot-check secret, and do nothing else', () => {
    const policies = props('AuthRelayFunction').Policies as {
      Statement: Record<string, unknown>[];
    }[];
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement.map((s) => s.Action)).toEqual([
      'cognito-idp:DescribeUserPoolClient',
      'ssm:GetParameter',
      'kms:Decrypt',
      'cognito-idp:AdminUserGlobalSignOut',
    ]);
    for (const action of [
      'cognito-idp:DescribeUserPoolClient',
      'cognito-idp:AdminUserGlobalSignOut',
    ]) {
      expect([action, grantAt(doc, relay, action)]).toEqual([
        action,
        { tag: '!GetAtt', value: 'UserPool.Arn' },
      ]);
    }
    expect(grantAt(doc, relay, 'ssm:GetParameter')).toEqual({
      tag: '!Sub',
      value:
        'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/quirenote/${Environment}/turnstile-secret',
    });
    const decrypt = policies[0].Statement[2] as { Condition?: unknown };
    expect(JSON.stringify(decrypt.Condition)).toContain('kms:ViaService');
  });

  // THE START'S GATES FIT THE FUNCTION'S DEADLINE, reserving time for the SSM SDK's first load and for
  // the client secret's first read and `InitiateAuth`, none of which carries a deadline of its own.
  it('gives the bot-check secret and siteverify less than its timeout, leaving Cognito its time', () => {
    const SDK_LOAD_MS = 200;
    const COGNITO_MS = 1300;
    expect(SDK_LOAD_MS + SECRET_MS + ANSWER_MS + COGNITO_MS).toBeLessThanOrEqual(
      Number(props('AuthRelayFunction').Timeout) * 1000,
    );
  });

  // NO SECRET IN ITS CONFIGURATION: the pool, the client, the managed-login domain and the bot-check
  // parameter are named, and both secrets are read.
  it('is told the pool, the client, the auth domain, the bot check and its dev bypass, and nothing else', () => {
    const vars = (props('AuthRelayFunction').Environment as { Variables?: Record<string, unknown> })
      ?.Variables;
    expect(Object.keys(vars ?? {}).sort()).toEqual([
      'AUTH_DOMAIN',
      'BOT_CHECK_BYPASS_PARAMETER',
      'BOT_CHECK_HOSTNAMES',
      'BOT_CHECK_PARAMETER',
      'NODE_OPTIONS',
      'USER_POOL_CLIENT_ID',
      'USER_POOL_ID',
    ]);
    expect(intrinsicAt(doc, ...envVars('AuthRelayFunction'), 'BOT_CHECK_PARAMETER')).toEqual({
      tag: '!Sub',
      value: '/quirenote/${Environment}/turnstile-secret',
    });
    expect(intrinsicAt(doc, ...envVars('AuthRelayFunction'), 'AUTH_DOMAIN')).toEqual({
      tag: '!Ref',
      value: 'UserPoolDomain',
    });
    expect(intrinsicAt(doc, ...envVars('AuthRelayFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
    expect(intrinsicAt(doc, ...envVars('AuthRelayFunction'), 'USER_POOL_CLIENT_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPoolClient',
    });
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.AuthRelayLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('AuthRelayLogGroup').RetentionInDays).toBe(30);
  });
});

describe('the browser origins are named per environment', () => {
  type Cors = {
    AllowOrigins: string[];
    AllowMethods: string[];
    AllowHeaders: string[];
    ExposeHeaders?: string[];
    AllowCredentials?: boolean;
  };
  const [condition, prod, dev] = props('PublicApi').CorsConfiguration as [string, Cors, Cors];

  // EXACT LISTS, NOT `toContain`: the origins are the deployed hosts `src/auth/environment.ts`
  // maps, held as literals because an assertion comparing two lists passes for any pair that agrees.
  // A host it does not map sends nothing to the API, so a credentialed origin for it is unused.
  it('allows the custom hosts alone', () => {
    expect(condition).toBe('IsProd');
    expect(prod.AllowOrigins).toEqual(['https://quirenote.com', 'https://www.quirenote.com']);
    expect(dev.AllowOrigins).toEqual(['https://dev.quirenote.com']);
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
      // A part is a PUT, an abort a DELETE and a settings write a PATCH, none of which a preflight
      // allows unless named.
      expect([name, arm.AllowMethods?.slice().sort()]).toEqual([
        name,
        ['DELETE', 'GET', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
      ]);
      // `authorization` is what lets a browser send the token at all: every admin call is
      // cross-origin, and the preflight refuses a header the list does not name — a failure that
      // appears only in a browser, never in `curl`. `if-none-match` is not safelisted either, and
      // it is how the read revalidates; a write sends `if-match` and its `idempotency-key`, and
      // a staged part its `content-digest`.
      expect([name, arm.AllowHeaders?.slice().sort()]).toEqual([
        name,
        [
          'authorization',
          'content-digest',
          'content-type',
          'idempotency-key',
          'if-match',
          'if-none-match',
          CSRF_HEADER,
        ].sort(),
      ]);
      // A script reads no response header CORS does not expose, and with credentials a `*` is a
      // header literally named `*`: the read's validator and identifier are named.
      expect([name, arm.ExposeHeaders?.slice().sort()]).toEqual([name, [...EXPOSED].sort()]);
      // THE COOKIE CROSSES ORIGINS: `api.quirenote.com` is same-site with `quirenote.com` but not
      // same-origin, so the app sends `credentials: 'include'` and the preflight must allow it.
      expect([name, arm.AllowCredentials]).toEqual([name, true]);
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

  // ONLY THE CUSTOM DOMAIN ANSWERS: the generated `execute-api` hostname is a second name nothing
  // calls, and the relay's `__Host-` cookies are never set on it. SAM writes the flag into the
  // OpenAPI body as a `servers` entry, so it lands with the import and no stage deploy is owed.
  it('disables the default execute-api endpoint', () => {
    expect(props('PublicApi').DisableExecuteApiEndpoint).toBe(true);
  });

  // THE FLAG NEEDS A SERVER URL BESIDE IT, or the import warns and `FailOnWarnings` rolls the stack
  // back; the URL is the custom domain's own name, read from it, and the routes stay the events'.
  it('writes an inline body naming each environment custom domain as its server', () => {
    const body = props('PublicApi').DefinitionBody as {
      openapi?: unknown;
      info?: { title?: unknown; version?: unknown };
      servers?: { url?: unknown }[];
      paths?: unknown;
    };
    const [condition, prod, dev] = (props('PublicApi').Domain as { DomainName: string[] })
      .DomainName;
    expect(body?.openapi).toBe('3.0.1');
    expect(body.info).toEqual({ title: 'AWS::StackName', version: '1.0' });
    expect(body.servers).toHaveLength(1);
    expect(body.servers?.[0]?.url).toEqual([condition, `https://${prod}`, `https://${dev}`]);
    expect(body.paths).toEqual({});
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
  // NO `ApiEndpoint`: with the default endpoint disabled that URL refuses every call, so an output
  // naming it is a door that reads open. Before the record exists a route is reached through the
  // regional target instead, `curl --connect-to` with the custom host (`reference/DEPLOYMENT.md`).
  it('outputs the domain and its regional target, and no execute-api URL', () => {
    expect(user.Outputs?.ApiDomain?.Value).toEqual(['IsProd', PROD_API, DEV_API]);
    expect(intrinsicAt(doc, 'Outputs', 'ApiDomainRegionalTarget', 'Value')).toEqual({
      tag: '!GetAtt',
      value: 'PublicApi.DomainName.RegionalDomainName',
    });
    expect(user.Outputs).not.toHaveProperty('ApiEndpoint');
  });
});

describe('the handler is wired to the user cluster and logs like its neighbours', () => {
  // The grant, not only the endpoint variable: a copy-paste leaving the archive's cluster here
  // would pass every other test in this repository.
  it('may connect to the user cluster, read and decrypt its own bot-check secret, and nothing else', () => {
    const policies = props('ApplicationsFunction').Policies as [
      { Statement: Record<string, unknown>[] },
    ];
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement.map((s) => s.Action)).toEqual([
      'dsql:DbConnectAdmin',
      'ssm:GetParameter',
      'kms:Decrypt',
    ]);
    // A KEY USED THROUGH SSM ALONE, which is how the parameter's is.
    const decrypt = policies[0].Statement[2] as { Condition?: unknown };
    expect(JSON.stringify(decrypt.Condition)).toContain('kms:ViaService');
    // ONE PARAMETER, the name the function is handed, never the `quirenote/*` tree.
    expect(
      grantAt(
        doc,
        ['Resources', 'ApplicationsFunction', 'Properties', 'Policies', 0, 'Statement'],
        'ssm:GetParameter',
      ),
    ).toEqual({
      tag: '!Sub',
      value:
        'arn:${AWS::Partition}:ssm:${AWS::Region}:${AWS::AccountId}:parameter/quirenote/${Environment}/turnstile-secret',
    });
    expect(intrinsicAt(doc, ...envVars('ApplicationsFunction'), 'BOT_CHECK_PARAMETER')).toEqual({
      tag: '!Sub',
      value: '/quirenote/${Environment}/turnstile-secret',
    });
    expect(
      grantAt(
        doc,
        ['Resources', 'ApplicationsFunction', 'Properties', 'Policies', 0, 'Statement'],
        'dsql:DbConnectAdmin',
      ),
    ).toEqual({ tag: '!GetAtt', value: 'UserCluster.ResourceArn' });
  });

  // THE GATES' DEADLINES FIT THE FUNCTION'S, reserving 1500 ms of it for the connection and the
  // insert, which carry no deadline of their own: past `Timeout`, API Gateway answers for it.
  it('gives the secret and siteverify less than its timeout, leaving the cluster its time', () => {
    const CLUSTER_MS = 1500;
    expect(SECRET_MS + ANSWER_MS + CLUSTER_MS).toBeLessThanOrEqual(
      Number(props('ApplicationsFunction').Timeout) * 1000,
    );
  });

  // The boundary caps each grant, so both name SSM in eu-north-1, where every stack deploys: a
  // boundary scoped otherwise deploys green and refuses the first decrypt.
  it.each([
    ['dev', 'ApplicationsFunction'],
    ['prod', 'ApplicationsFunction'],
    ['dev', 'AuthRelayFunction'],
    ['prod', 'AuthRelayFunction'],
  ])('%s: lets the boundary decrypt through SSM exactly as %s’s grant does', (env, fn) => {
    const boundary = JSON.parse(
      readFileSync(
        new URL(`../iam/quirenote-backend-boundary-${env}.json`, import.meta.url),
        'utf8',
      ),
    ) as { Statement: { Sid?: string; Condition?: unknown }[] };
    const capped = boundary.Statement.find((s) => s.Sid === 'DecryptTheBotCheckSecret');
    expect(capped?.Condition).toEqual({
      StringEquals: { 'kms:ViaService': 'ssm.eu-north-1.amazonaws.com' },
    });
    const node = doc.getIn(
      [
        'Resources',
        fn,
        'Properties',
        'Policies',
        0,
        'Statement',
        2,
        'Condition',
        'StringEquals',
        'kms:ViaService',
      ],
      true,
    ) as { tag?: string; value?: string };
    expect([node.tag, node.value]).toEqual(['!Sub', 'ssm.${AWS::Region}.amazonaws.com']);
    const key = doc.getIn(
      ['Resources', fn, 'Properties', 'Policies', 0, 'Statement', 2, 'Resource'],
      true,
    ) as { tag?: string; value?: string };
    expect([key.tag, key.value]).toEqual([
      '!Sub',
      'arn:${AWS::Partition}:kms:${AWS::Region}:${AWS::AccountId}:key/*',
    ]);
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

  // This function can mint an identity, disable one and delete one, so the pool is named, never
  // wildcarded, and the actions are the six the handler makes and no seventh. `AdminEnableUser`
  // undoes this file's own disable and grants no access by itself: an enabled identity with no
  // `active` row is refused by every route. `AdminDeleteUser` and `ListUsers` are a declined
  // application's identities going with its row. [*Auth model*]
  it('may create, read, disable, re-enable, find and delete a user in ONE pool, and nothing else', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(
      grantAt(doc, approve, [
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:ListUsers',
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

describe('the deletion holds exactly two grants, and the function behind the writes holds no delete', () => {
  const policies = props('DeleteAccountFunction').Policies as [
    { Statement: Record<string, unknown>[] },
  ];
  const deletion = ['Resources', 'DeleteAccountFunction', 'Properties', 'Policies', 0, 'Statement'];

  // Every session the account holds ends, then every identity under its address goes: the three
  // calls the core makes, on ONE pool, and nothing else. [*Auth model*]
  it('may end the sessions of, find and delete a user in ONE pool, and nothing else', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(
      grantAt(doc, deletion, [
        'cognito-idp:AdminUserGlobalSignOut',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:ListUsers',
      ]),
    ).toEqual({ tag: '!GetAtt', value: 'UserPool.Arn' });
  });

  it('may connect to the user cluster and to no other', () => {
    expect(grantAt(doc, deletion, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
  });

  it('reads the pool and the cluster from the stack, and no registration switch', () => {
    const vars = (
      props('DeleteAccountFunction').Environment as { Variables?: Record<string, unknown> }
    )?.Variables;
    expect(intrinsicAt(doc, ...envVars('DeleteAccountFunction'), 'USER_POOL_ID')).toEqual({
      tag: '!Ref',
      value: 'UserPool',
    });
    expect(intrinsicAt(doc, ...envVars('DeleteAccountFunction'), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    // The gate makes no row on this route, so the switch would be read by nothing.
    expect(vars).not.toHaveProperty('OPEN_REGISTRATION');
  });

  it('leaves the function behind every portfolio write without a delete', () => {
    const granted = JSON.stringify(props('MutationsFunction').Policies);
    expect(granted).not.toContain('AdminDeleteUser');
    expect(granted).not.toContain('AdminUserGlobalSignOut');
  });
});

describe('the archive diagnosis is a super-admin read, served in every environment', () => {
  const policies = props('ArchiveAdminFunction').Policies as [
    { Statement: Record<string, unknown>[] },
  ];
  const statements = [
    'Resources',
    'ArchiveAdminFunction',
    'Properties',
    'Policies',
    0,
    'Statement',
  ];

  it('puts the read on this API, a GET naming the authorizer, on a function of its own', () => {
    const routes = declaredRoutes().filter((r) => r.fn === 'ArchiveAdminFunction');
    expect(routes.map((r) => [r.key, r.api, r.authorizer])).toEqual([
      [DIAGNOSIS_ROUTE, 'PublicApi', AUTHORIZER],
    ]);
    expect(props('ArchiveAdminFunction').Handler).toBe('archive-admin.handler');
    // No condition: the read is the same store in dev and prod, so both stacks serve it.
    expect(user.Resources.ArchiveAdminFunction).not.toHaveProperty('Condition');
  });

  // The function gates on the user cluster and invokes the capture, and holds nothing else: the
  // invoke is the one grant the read adds to the stack.
  it('may connect to the user cluster and invoke the capture function it is given, and nothing else', () => {
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(2);
    expect(grantAt(doc, statements, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
    expect(grantAt(doc, statements, 'lambda:InvokeFunction')).toEqual({
      tag: '!Sub',
      value:
        'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:${CaptureFunctionName}',
    });
  });

  it('names the capture function by the deploy parameter, and holds the API under its 30 s limit', () => {
    expect(intrinsicAt(doc, ...envVars('ArchiveAdminFunction'), 'CAPTURE_FUNCTION_NAME')).toEqual({
      tag: '!Ref',
      value: 'CaptureFunctionName',
    });
    expect(intrinsicAt(doc, ...envVars('ArchiveAdminFunction'), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    expect(props('ArchiveAdminFunction').Timeout).toBeLessThan(30);
  });

  // Each read holds two executions while the capture runs, out of the account's concurrency: one
  // a second and no burst, so the read cannot spend it in one go.
  it('admits one request a second, with no burst', () => {
    const settings = props('PublicApi').RouteSettings as Record<string, Record<string, unknown>>;
    expect(settings[DIAGNOSIS_ROUTE]).toEqual({ ThrottlingRateLimit: 1, ThrottlingBurstLimit: 1 });
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.ArchiveAdminLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ArchiveAdminLogGroup').RetentionInDays).toBe(30);
  });
});

describe('the archive operations are super-admin routes, served in every environment', () => {
  const FN = 'ArchiveOperationsFunction';
  const statements = ['Resources', FN, 'Properties', 'Policies', 0, 'Statement'];

  it('puts the start, the list and the read on this API, each naming the authorizer, on a function of its own', () => {
    const routes = declaredRoutes().filter((r) => r.fn === FN);
    expect(routes.map((r) => [r.key, r.api, r.authorizer])).toEqual([
      [OPERATION_START_ROUTE, 'PublicApi', AUTHORIZER],
      [OPERATIONS_ROUTE, 'PublicApi', AUTHORIZER],
      [OPERATION_ROUTE, 'PublicApi', AUTHORIZER],
    ]);
    expect(props(FN).Handler).toBe('archive-operations.handler');
    // No condition: the routes keep their paths in every environment, and dev's start refuses.
    expect(user.Resources[FN]).not.toHaveProperty('Condition');
  });

  // The start's grant stands apart under production's condition; the function's own policies hold
  // the cluster alone.
  it('may connect to the user cluster, and its own policies grant nothing else', () => {
    const policies = props(FN).Policies as [{ Statement: unknown[] }];
    expect(policies).toHaveLength(1);
    expect(policies[0].Statement).toHaveLength(1);
    expect(grantAt(doc, statements, 'dsql:DbConnectAdmin')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.ResourceArn',
    });
  });

  it('is told the state machine in production alone, and holds the API under its 30 s limit', () => {
    const at = [...envVars(FN), 'STATE_MACHINE_ARN'];
    expect(tagAt(doc, ...at)).toBe('!If');
    expect(intrinsicAt(doc, ...at, 0)).toEqual({ tag: undefined, value: 'IsProd' });
    expect(intrinsicAt(doc, ...at, 1)).toEqual({
      tag: '!GetAtt',
      value: 'ArchiveOperationsStateMachine.Arn',
    });
    expect(intrinsicAt(doc, ...at, 2)).toEqual({ tag: '!Ref', value: 'AWS::NoValue' });
    expect(intrinsicAt(doc, ...envVars(FN), 'DSQL_ENDPOINT')).toEqual({
      tag: '!GetAtt',
      value: 'UserCluster.Endpoint',
    });
    expect(props(FN).Timeout).toBeLessThan(30);
  });

  // A start holds an execution of the account's concurrency for the whole run: one a second and
  // no burst. The reads are the admin reads' 2/5.
  it('admits one start a second with no burst, and the reads as the admin reads', () => {
    const settings = props('PublicApi').RouteSettings as Record<string, Record<string, unknown>>;
    expect(settings[OPERATION_START_ROUTE]).toEqual({
      ThrottlingRateLimit: 1,
      ThrottlingBurstLimit: 1,
    });
    for (const route of [OPERATIONS_ROUTE, OPERATION_ROUTE])
      expect([route, settings[route]]).toEqual([
        route,
        { ThrottlingRateLimit: 2, ThrottlingBurstLimit: 5 },
      ]);
  });

  it('carries a log group of its own, retained like the others', () => {
    expect(user.Resources.ArchiveOperationsLogGroup?.Type).toBe('AWS::Logs::LogGroup');
    expect(props('ArchiveOperationsLogGroup').RetentionInDays).toBe(30);
  });
});
