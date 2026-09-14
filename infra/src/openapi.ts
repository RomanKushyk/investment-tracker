// The API described from the two places that already know: the template, and the handlers.
//
// NOT FROM THE DEPLOYED API. `aws apigatewayv2 export-api --specification OAS30` returns a
// correct route half — routes, the authorizer, the path parameter, which route stands outside
// it — and no response half at all: every operation gets a single `default`. Adding the
// responses by hand beside it would be a second source for a contract three test files already
// assert, which is the drift this repository has now watched twice. So the route half is read
// from `template-user.yaml` instead, and both halves regenerate with no credentials, no
// deployed stack and no `apigateway:GET` — which the deploy role does not hold and CI cannot
// reach. That is what lets `openapi.test.ts` regenerate and diff on every run.
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

import {
  REQUEST_BODY,
  RESPONSES as APPLICATION_RESPONSES,
  ROUTE as APPLY_ROUTE,
} from './applications';
import { RESPONSES as ADMIN_RESPONSES } from './approve';
import type { ApiResult } from './http';

/** The one security scheme, named as the template names it. */
const SCHEME = 'CognitoJwt';

/** The environment this repository deploys to production, as `IsProd` spells it. */
const PRODUCTION = 'prod';

/**
 * A hostname and nothing else, because an intrinsic arm arrives as its inner text. Case is
 * ignored: DNS ignores it, CloudFormation accepts it, and refusing `Api.Quirenote.com` would
 * stop `pnpm openapi` with a message about intrinsics that misnames what it found.
 */
const HOSTNAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

type Event = {
  Type?: string;
  Properties?: { Method?: string; Path?: string; Auth?: { Authorizer?: string } };
};
type Resource = { Type: string; Properties?: Record<string, unknown> };
type Template = {
  Parameters?: Record<string, { AllowedValues?: string[] }>;
  Conditions?: Record<string, unknown>;
  Resources: Record<string, Resource>;
};

/**
 * Which module answers a route, keyed by the `Handler` the template names. The template is
 * the only thing that knows a route reaches `approve.handler`; this is the only thing that
 * knows `approve.handler`'s answers are `approve.ts`'s. A handler with no entry raises
 * rather than producing an operation with no responses.
 */
export const ANSWERS: Record<string, Record<string, readonly ApiResult[]>> = {
  'applications.handler': APPLICATION_RESPONSES,
  'approve.handler': ADMIN_RESPONSES,
};

/**
 * The bodies a ROUTE takes, for the one route that takes one. Keyed by route rather than by
 * handler: a second event on the same function would otherwise attach a required JSON body to
 * every operation that handler serves, a GET included.
 */
const BODIES: Record<string, unknown> = {
  [APPLY_ROUTE]: REQUEST_BODY,
};

type Operation = {
  operationId: string;
  summary: string;
  parameters?: { name: string; in: string; required: boolean; schema: { type: string } }[];
  requestBody?: unknown;
  security: { [scheme: string]: string[] }[];
  responses: Record<
    string,
    {
      description: string;
      content: { 'application/json': { examples: Record<string, { value: unknown }> } };
    }
  >;
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  security: { [scheme: string]: string[] }[];
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, Record<string, unknown>> };
};

/** Every HttpApi route the template declares, with the handler that answers it. */
const declaredRoutes = (user: Template) =>
  Object.values(user.Resources)
    .filter((r) => r.Type === 'AWS::Serverless::Function')
    .flatMap((r) =>
      Object.values((r.Properties?.Events ?? {}) as Record<string, Event>)
        .filter((e) => e.Type === 'HttpApi')
        .map((e) => ({
          handler: r.Properties?.Handler as string,
          method: (e.Properties?.Method ?? '').toLowerCase(),
          path: e.Properties?.Path ?? '',
          authorizer: e.Properties?.Auth?.Authorizer,
        })),
    );

/**
 * THE HOSTS, from the API's own custom domain. Without them the document describes three
 * operations and no base URL, and a client generated from it cannot call anything until a
 * hostname arrives out of band.
 *
 * `toJS()` drops an intrinsic's tag and keeps its value, so `!If [IsProd, a, b]` arrives as
 * `['IsProd', a, b]` and the PAIRING survives as an order alone. That pairing is the
 * load-bearing half — a client that takes the wrong arm for production calls production — so
 * it is read back out of the condition rather than assumed: `IsProd` is
 * `!Equals [!Ref Environment, prod]`, which names the true arm's environment, and the false
 * arm's is the other value `Environment` allows.
 *
 * PRODUCTION LAST, by name rather than by arm position — `IsDev` with the arms swapped
 * describes the same API and would otherwise put production first. Tools take `servers[0]` as
 * the default, Redoc's selector opens on it, and the two accidents are not the same size: a dev
 * caller who never chooses writes into production.
 */
export const servers = (user: Template): OpenApiDocument['servers'] => {
  const domain = (user.Resources.PublicApi?.Properties?.Domain as { DomainName?: unknown })
    ?.DomainName;
  // THE ARMS ARE READ, NOT JUST COUNTED. The same dropped tag that makes the array readable
  // makes `!Sub 'api.${Zone}'` arrive as that text, which would ship unresolved inside a URL.
  if (
    !Array.isArray(domain) ||
    domain.length !== 3 ||
    !domain.slice(1).every((arm) => typeof arm === 'string' && HOSTNAME.test(arm))
  ) {
    throw new Error(
      `PublicApi.Domain.DomainName is not an !If over two hostnames: ${JSON.stringify(domain)}`,
    );
  }
  const [condition, whenTrue, whenFalse] = domain as [string, string, string];
  // ARRAY-CHECKED BEFORE IT IS DESTRUCTURED. The full function form — `Fn::Equals: [...]` — is
  // legal in this template and `toJS()` gives it as an OBJECT, which destructures into a
  // `TypeError` rather than the message below; every other unknown in this module names itself.
  const equals = user.Conditions?.[condition];
  const [parameter, whenTrueIs] = (Array.isArray(equals) ? equals : []) as [string?, string?];
  const rest = (user.Parameters?.[parameter ?? '']?.AllowedValues ?? []).filter(
    (value) => value !== whenTrueIs,
  );
  if (whenTrueIs === undefined || rest.length !== 1) {
    throw new Error(`${condition} is not an !Equals over one of two values ${parameter} allows`);
  }
  const named = [
    { url: `https://${whenTrue}`, description: whenTrueIs },
    { url: `https://${whenFalse}`, description: rest[0] },
  ];
  // ONE OF THE TWO MUST BE PRODUCTION, or the ordering below has nothing to order by and would
  // fall back to arm position without a word — the thing it exists to stop. It is also the only
  // check that the condition is about ENVIRONMENTS at all: this template carries a second
  // two-valued parameter and a matching condition, `IsRegistrationOpen` over `[closed, open]`,
  // and an `!If` copied from it satisfies every check above while naming the two hosts `open`
  // and `closed` and putting production first.
  if (!named.some((server) => server.description === PRODUCTION)) {
    throw new Error(
      `neither environment ${condition} selects is ${PRODUCTION}: ` +
        named.map((server) => server.description).join(', '),
    );
  }
  return named.sort(
    (a, b) => Number(a.description === PRODUCTION) - Number(b.description === PRODUCTION),
  );
};

/**
 * A readable, unique id per operation, DERIVED from the route rather than named by hand — a
 * hand-written one is a second thing to keep in step, and generators key off this.
 * `POST /admin/users/{id}/approve` becomes `postAdminUsersIdApprove`.
 */
const operationId = (method: string, path: string): string =>
  method +
  path
    .split('/')
    .filter((seg) => seg !== '')
    .map((seg) => seg.replace(/[{}]/g, ''))
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');

/**
 * WHAT AN OPERATION SAYS ABOUT CREDENTIALS. A route naming THE authorizer requires it; a route
 * naming none gets an EMPTY ARRAY, which the specification defines as removing the document's
 * default. Not `[{}]` — an array holding the empty security requirement `{}`, which says
 * credentials are OPTIONAL: a third thing again.
 *
 * "NAMING NONE IS PUBLIC" IS AN ASSUMPTION, and it is this function's fail-open edge. A route
 * whose `Auth` block was forgotten in the template arrives here indistinguishable from the
 * sign-up route and is published as callable by a stranger. Nothing in this module can tell the
 * two apart; what holds the line is `public-api.test.ts`, which fails a route that names no
 * authorizer and is not on its written public list.
 *
 * A ROUTE NAMING SOMETHING ELSE RAISES, because that one IS distinguishable: a second
 * authorizer, or a typo in the first, is a public surface by no reading.
 */
export const securityOf = (authorizer: string | undefined): Operation['security'] => {
  if (authorizer === SCHEME) {
    return [{ [SCHEME]: [] }];
  }
  if (authorizer === undefined) {
    return [];
  }
  throw new Error(`route names authorizer ${authorizer}, and only ${SCHEME} is declared`);
};

/** `{id}` in a path is a required string parameter, and the only kind this API has. */
const parameters = (path: string) =>
  [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

/**
 * One status may carry SEVERAL BODIES — the gate's four 403s are four different answers, and
 * OpenAPI 3.0 allows one response object per status code. So they become named `examples`
 * under that one status rather than one of them winning an `example` and the rest vanishing.
 * The name is the body's own word, which is what a client branches on.
 */
const nameOf = (body: string): string => {
  const parsed = JSON.parse(body) as { error?: string; status?: string };
  const name = parsed.error ?? parsed.status;
  // RAISED RATHER THAN KEYED BY THE WHOLE BODY. Every other unknown in this module raises, and
  // a body with neither word is a new answer shape — naming it after its own JSON is a key no
  // reader or client would recognise.
  if (name === undefined) {
    throw new Error(`no error or status to name this answer by: ${body}`);
  }
  return name;
};

const responses = (answers: readonly ApiResult[]) => {
  const byStatus: Operation['responses'] = {};
  for (const answer of answers) {
    const status = String(answer.statusCode);
    byStatus[status] ??= {
      description: status.startsWith('2')
        ? 'Accepted'
        : status.startsWith('5')
          ? 'Failed'
          : 'Refused',
      content: { 'application/json': { examples: {} } },
    };
    byStatus[status].content['application/json'].examples[nameOf(answer.body)] = {
      // THE VALUE, NOT THE TEXT. An Example Object under `application/json` holds the media
      // type's own value, so the raw string here makes Redoc — which the README tells the
      // reader to run — render every answer as a quoted, backslash-escaped string, and a
      // generated client type it `string` where the API sends an object.
      value: JSON.parse(answer.body) as unknown,
    };
  }
  return byStatus;
};

export function buildSpec(): OpenApiDocument {
  const source = readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8');
  const doc = parseDocument(source);
  // ERRORS, NEVER WARNINGS — the anchor `public-api.test.ts` opens with, for its reason: `yaml`
  // recovers from a structural error by DROPPING content, so a mangled `Events:` block yields
  // fewer routes and a smaller document, which reads as a stale artifact rather than a broken
  // template. Every CloudFormation intrinsic is a warning here and none of them is a problem.
  if (doc.errors.length > 0) {
    throw new Error(`template-user.yaml does not parse: ${doc.errors[0].message}`);
  }
  const user = doc.toJS() as Template;

  const paths: OpenApiDocument['paths'] = {};
  for (const route of declaredRoutes(user)) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    const answers = ANSWERS[route.handler]?.[key];
    if (answers === undefined) {
      throw new Error(
        `no answers declared for ${route.method.toUpperCase()} ${route.path} ` +
          `(${route.handler}) — export them from the handler and add it to ANSWERS`,
      );
    }
    const params = parameters(route.path);
    paths[route.path] ??= {};
    paths[route.path][route.method] = {
      operationId: operationId(route.method, route.path),
      summary: `${route.method.toUpperCase()} ${route.path}`,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(BODIES[key] === undefined ? {} : { requestBody: BODIES[key] }),
      // AN EMPTY ARRAY RATHER THAN AN ABSENT FIELD on the one public route, and the hazard
      // here is FAIL-CLOSED. An operation that omits `security` inherits the document's
      // default, so omitting it on `POST /v1/applications` would publish the sign-up route as
      // needing a bearer token — the one route somebody without a token has to reach in order
      // to ask for one.
      //
      // AND NO OPERATION THIS GENERATOR WRITES CAN OMIT IT: `securityOf` always answers and the
      // field is required, so the default below governs nothing here and catches no forgotten
      // route. It earns its place for what it SAYS: the shipped document states the API's
      // posture once instead of leaving a reader to infer it from three operations, and the
      // empty array above overrides something rather than standing alone.
      security: securityOf(route.authorizer),
      responses: responses(answers),
    };
  }

  return {
    openapi: '3.0.1',
    info: {
      title: 'Quirenote API',
      version: '1.0.0',
      description:
        'Derived from infra/template-user.yaml and the handlers’ own response constants ' +
        'by infra/src/openapi.ts. Do not edit: run `pnpm openapi` and commit the result. ' +
        'These are the HANDLERS’ answers. API Gateway answers ahead of them too and those are ' +
        'not described here: 401 for a token the JWT authorizer refuses, which is the commonest ' +
        'admin failure once an access token passes its hour, and 429 from the per-route throttle.',
    },
    servers: servers(user),
    // THE DEFAULT EVERY OPERATION ABOVE OVERRIDES, beside `servers` rather than after
    // `components` where the specification's field table lists it. JSON members are unordered,
    // so the placement costs nothing and a default sitting below every path is one a reader
    // does not know to look for. It is the scheme the template's own authorizer declares, so
    // nothing is decided here that is not decided there.
    security: [{ [SCHEME]: [] }],
    paths,
    components: {
      securitySchemes: {
        [SCHEME]: {
          // WHAT THE CALLER ACTUALLY DOES, which is send a bearer token in `Authorization` —
          // the template says exactly that two lines from the authorizer
          // (`IdentitySource: $request.header.Authorization`). `oauth2` with an empty `flows`
          // gives Redoc an Authorize button with nothing behind it, and
          // `x-amazon-apigateway-authtype` is the REST (v1) extension, not this API's. The
          // issuer and audience are per-environment intrinsics, so they are not spelled here.
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };
}
