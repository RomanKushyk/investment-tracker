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

type Event = {
  Type?: string;
  Properties?: { Method?: string; Path?: string; Auth?: { Authorizer?: string } };
};
type Resource = { Type: string; Properties?: Record<string, unknown> };
type Template = { Resources: Record<string, Resource> };

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
  security?: { [scheme: string]: string[] }[];
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
      // ABSENT RATHER THAN EMPTY on the one public route. `security: []` means "this operation
      // overrides the document default and needs none", which is a different statement from a
      // document that declares no default at all — and this one does not.
      ...(route.authorizer === SCHEME ? { security: [{ [SCHEME]: [] }] } : {}),
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
