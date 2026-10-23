// The API described from the two places that already know: the template, and the handlers.
//
// NOT FROM THE DEPLOYED API. `aws apigatewayv2 export-api --specification OAS30` returns a correct
// route half and no response half at all — every operation gets a single `default` — and needs
// `apigateway:GET`, which the deploy role does not hold. So the route half is read from
// `template-user.yaml`, and both halves regenerate with no credentials and no deployed stack,
// which is what lets `openapi.test.ts` diff on every run.
import { readFileSync } from 'node:fs';
import { parseDocument } from 'yaml';

import { PARAMETERS as LIST_PARAMETERS, RESPONSES as LIST_RESPONSES } from './admin-users';
import {
  REQUEST_BODY,
  RESPONSES as APPLICATION_RESPONSES,
  ROUTE as APPLY_ROUTE,
} from './applications';
import { RESPONSES as ADMIN_RESPONSES } from './approve';
import { RESPONSES as ARCHIVE_RESPONSES } from './archive-admin';
import {
  PARAMETERS as OPERATION_PARAMETERS,
  RESPONSES as OPERATION_RESPONSES,
  START_BODY as OPERATION_START_BODY,
  START_ROUTE as OPERATION_START_ROUTE,
} from './archive-operations';
import {
  GOOGLE_COMPLETE_BODY,
  GOOGLE_COMPLETE_ROUTE,
  PARAMETERS as RELAY_PARAMETERS,
  PASSKEY_BODY,
  PASSKEY_COMPLETE_BODY,
  PASSKEY_COMPLETE_ROUTE,
  PASSKEY_LIST_ROUTE,
  PASSKEY_START_ROUTE,
  RESPOND_BODY,
  RESPOND_ROUTE,
  RESPONSES as RELAY_RESPONSES,
  START_BODY,
  START_ROUTE,
} from './auth-relay';
import { type ApiResult, type Declared, made } from './http';
import {
  BEGIN_BODY,
  BEGIN_ROUTE,
  PARAMETERS as IMPORT_PARAMETERS,
  PART_BODY,
  PART_ROUTE,
  RESPONSES as IMPORT_RESPONSES,
} from './imports';
import { PARAMETERS as ME_PARAMETERS, RESPONSES as ME_RESPONSES } from './me';
import {
  BODY as MUTATIONS_BODY,
  MUTATIONS_ROUTE,
  PARAMETERS as MUTATIONS_PARAMETERS,
  RESPONSES as MUTATIONS_RESPONSES,
} from './mutations';
import { BODY as SETTINGS_BODY, RESPONSES as SETTINGS_RESPONSES, SETTINGS_ROUTE } from './settings';
import { PARAMETERS as VIEW_PARAMETERS, RESPONSES as VIEW_RESPONSES } from './view';

/** The one security scheme, named as the template names it. */
const SCHEME = 'CognitoJwt';

const PRODUCTION = 'prod';

/** A hostname only, because an intrinsic arm arrives as its inner text. Case-blind: refusing
 *  `Api.Quirenote.com` would say a hostname is not one. */
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

/** Which module answers a route: the template knows only that one reaches `approve.handler`, and
 *  this map is the only thing that knows whose answers those are. */
export const ANSWERS: Record<string, Record<string, readonly (ApiResult | Declared)[]>> = {
  'applications.handler': APPLICATION_RESPONSES,
  // The two rulings and the list they start from share one function.
  'approve.handler': { ...ADMIN_RESPONSES, ...LIST_RESPONSES },
  'archive-admin.handler': ARCHIVE_RESPONSES,
  'archive-operations.handler': OPERATION_RESPONSES,
  'auth-relay.handler': RELAY_RESPONSES,
  'view.handler': VIEW_RESPONSES,
  // The write, the export, the staged import, the settings and the account's own read share one
  // function.
  'mutations.handler': {
    ...MUTATIONS_RESPONSES,
    ...IMPORT_RESPONSES,
    ...SETTINGS_RESPONSES,
    ...ME_RESPONSES,
  },
};

/** Keyed by route, not by handler: a second event on one function would otherwise attach a
 *  required JSON body to every operation it serves, a GET included. */
const BODIES: Record<string, unknown> = {
  [APPLY_ROUTE]: REQUEST_BODY,
  [OPERATION_START_ROUTE]: OPERATION_START_BODY,
  [START_ROUTE]: START_BODY,
  [RESPOND_ROUTE]: RESPOND_BODY,
  [GOOGLE_COMPLETE_ROUTE]: GOOGLE_COMPLETE_BODY,
  [PASSKEY_LIST_ROUTE]: PASSKEY_BODY,
  [PASSKEY_START_ROUTE]: PASSKEY_BODY,
  [PASSKEY_COMPLETE_ROUTE]: PASSKEY_COMPLETE_BODY,
  [MUTATIONS_ROUTE]: MUTATIONS_BODY,
  [BEGIN_ROUTE]: BEGIN_BODY,
  [PART_ROUTE]: PART_BODY,
  [SETTINGS_ROUTE]: SETTINGS_BODY,
};

/** One group per first path segment, in Swagger UI and in a generated client. [*API shape*] */
export const TAGS: Record<string, string> = {
  applications: 'The sign-up application, which an approval turns into an account.',
  admin:
    'The super-admin’s: the applications and their rulings, and the price archive’s diagnosis and repairs.',
  auth: 'The relay: sign-in by password, passkey or Google, the session’s refresh and sign-out, and the account’s passkeys.',
  view: 'The derived reads: the portfolio for six periods, the yield curve, the Balances table and a day’s quotes.',
  mutations: 'The portfolio’s write, as ordered ops under one precondition.',
  state: 'The raw export of the stored portfolio.',
  imports:
    'The staged import: a dataset too large for one transaction, in parts that one commit moves.',
  settings: 'The account’s settings, as a merge patch.',
  me: 'The caller’s own account and what it holds, read by the screens that show it.',
};

type Operation = {
  tags: string[];
  operationId: string;
  summary: string;
  parameters?: {
    name: string;
    in: string;
    required: boolean;
    description?: string;
    schema: { type: string; enum?: readonly string[]; minimum?: number; maximum?: number };
  }[];
  requestBody?: unknown;
  security: { [scheme: string]: string[] }[];
  responses: Record<
    string,
    {
      description: string;
      headers?: Record<string, { schema: { type: string } }>;
      // ABSENT for a 304, which has no body: `application/json` here would publish one.
      content?: { 'application/json': { examples: Record<string, { value: unknown }> } };
    }
  >;
};

/** A route's own request headers and query parameters, keyed like the bodies. */
const PARAMETERS: Record<string, NonNullable<Operation['parameters']>> = {
  ...LIST_PARAMETERS,
  ...OPERATION_PARAMETERS,
  ...RELAY_PARAMETERS,
  ...VIEW_PARAMETERS,
  ...MUTATIONS_PARAMETERS,
  ...IMPORT_PARAMETERS,
  ...ME_PARAMETERS,
};

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  security: { [scheme: string]: string[] }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, Record<string, unknown>> };
};

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
 * THE HOSTS, or a generated client cannot call anything until a hostname arrives out of band.
 *
 * `toJS()` drops an intrinsic's tag, so `!If [IsProd, a, b]` arrives as `['IsProd', a, b]` and the
 * PAIRING survives as an order alone. That pairing is load-bearing — a client taking the wrong arm
 * for production calls production — so it is read back out of the condition rather than assumed.
 * Production goes LAST by NAME, not by arm position: tools take `servers[0]` as the default.
 */
export const servers = (user: Template): OpenApiDocument['servers'] => {
  const domain = (user.Resources.PublicApi?.Properties?.Domain as { DomainName?: unknown })
    ?.DomainName;
  // THE ARMS ARE READ, NOT JUST COUNTED: the same dropped tag makes `!Sub 'api.${Zone}'` arrive as
  // that text, which would ship unresolved inside a URL.
  if (
    !Array.isArray(domain) ||
    domain.length !== 3 ||
    !domain.slice(1).every((arm) => typeof arm === 'string' && HOSTNAME.test(arm))
  ) {
    throw new Error(
      `PublicApi.Domain.DomainName is not three items, the last two hostnames: ${JSON.stringify(domain)}`,
    );
  }
  const [condition, whenTrue, whenFalse] = domain as [string, string, string];
  // Array-checked before it is destructured: the full function form is legal in this template and
  // `toJS()` gives it as an OBJECT, which destructures into a `TypeError` rather than a message.
  const equals = user.Conditions?.[condition];
  const [parameter, whenTrueIs] = (Array.isArray(equals) ? equals : []) as [string?, string?];
  const rest = (user.Parameters?.[parameter ?? '']?.AllowedValues ?? []).filter(
    (value) => value !== whenTrueIs,
  );
  if (whenTrueIs === undefined || rest.length !== 1) {
    throw new Error(
      `Conditions.${condition} is not a parameter and a value, with exactly one other value ` +
        `allowed: ${JSON.stringify(equals)}`,
    );
  }
  const named = [
    { url: `https://${whenTrue}`, description: whenTrueIs },
    { url: `https://${whenFalse}`, description: rest[0] },
  ];
  // ONE OF THE TWO MUST BE PRODUCTION, or the ordering falls back to arm position without a word.
  // It is also the only check that the condition is about ENVIRONMENTS at all: an `!If` copied from
  // this template's other two-valued condition, `IsRegistrationOpen` over `[closed, open]`,
  // satisfies every check above while naming the hosts `open` and `closed`.
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

const operationId = (method: string, path: string): string =>
  method +
  path
    .split('/')
    .filter((seg) => seg !== '')
    // A kebab-case segment is split too, so `sign-out` names `SignOut`, not `Sign-out`.
    .flatMap((seg) => seg.replace(/[{}]/g, '').split('-'))
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');

/**
 * A route naming THE authorizer requires it; a route naming none gets an EMPTY ARRAY, which the
 * specification defines as removing the document's default — not `[{}]`, which says credentials
 * are optional, a third thing again. A route naming anything else raises.
 *
 * "NAMING NONE IS PUBLIC" IS AN ASSUMPTION, and this function's FAIL-OPEN edge: a route whose
 * `Auth` block was forgotten is indistinguishable here from the sign-up route and is published as
 * callable by a stranger. `public-api.test.ts` is what holds that line.
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

const parameters = (path: string) =>
  [...path.matchAll(/\{([^}]+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

/** One status may carry SEVERAL BODIES — the gate's four 403s — and OpenAPI 3.0 allows one
 *  response object per status, so they become named `examples` rather than one winning. */
const nameOf = (body: string): string => {
  const parsed = JSON.parse(body) as { error?: string; status?: string };
  const name = parsed.error ?? parsed.status;
  // Raised rather than keyed by the whole body, which would be a key no client would recognise.
  if (name === undefined) {
    throw new Error(`no error or status to name this answer by: ${body}`);
  }
  return name;
};

export const responses = (answers: readonly (ApiResult | Declared)[]) => {
  const byStatus: Operation['responses'] = {};
  for (const answer of answers) {
    const status = String(answer.statusCode);
    const response = (byStatus[status] ??= {
      description:
        status === '304'
          ? 'Not modified'
          : status.startsWith('2')
            ? 'Accepted'
            : status.startsWith('5')
              ? 'Failed'
              : 'Refused',
    });
    if ('name' in answer) {
      made(answer);
      // A UNION of what the status's answers send, true because a Header Object is optional.
      for (const header of answer.headers) {
        (response.headers ??= {})[header] = { schema: { type: 'string' } };
      }
    }
    if ('name' in answer && !('example' in answer)) continue;

    const [name, value]: [string, unknown] =
      'name' in answer
        ? [answer.name, answer.example]
        : // THE VALUE, NOT THE TEXT: an Example Object holds the media type's own value, so a
          // raw string types a generated client `string` where the API sends an object.
          [nameOf(answer.body), JSON.parse(answer.body)];
    const { examples } = (response.content ??= { 'application/json': { examples: {} } })[
      'application/json'
    ];
    // REFUSED, NOT OVERWRITTEN: the lost answer could still read as described on another route.
    if (Object.hasOwn(examples, name)) {
      throw new Error(`two answers under ${status} are both named ${name}`);
    }
    examples[name] = { value };
  }
  return byStatus;
};

export function buildSpec(): OpenApiDocument {
  const source = readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8');
  const doc = parseDocument(source);
  // ERRORS, NEVER WARNINGS: `yaml` recovers from a structural error by DROPPING content, so a
  // mangled `Events:` block yields a smaller document that reads as stale rather than broken.
  if (doc.errors.length > 0) {
    throw new Error(`template-user.yaml does not parse: ${doc.errors[0].message}`);
  }
  const user = doc.toJS() as Template;

  const paths: OpenApiDocument['paths'] = {};
  const tags: OpenApiDocument['tags'] = [];
  for (const route of declaredRoutes(user)) {
    const key = `${route.method.toUpperCase()} ${route.path}`;
    const answers = ANSWERS[route.handler]?.[key];
    if (answers === undefined) {
      throw new Error(
        `no answers declared for ${route.method.toUpperCase()} ${route.path} ` +
          `(${route.handler}) — export them from the handler and add it to ANSWERS`,
      );
    }
    const tag = route.path.split('/')[1];
    if (!Object.hasOwn(TAGS, tag)) {
      throw new Error(`no description for the tag ${tag} of ${key} — add it to TAGS`);
    }
    if (!tags.some((t) => t.name === tag)) tags.push({ name: tag, description: TAGS[tag] });
    // A route's own headers and query parameters follow its path parameters, keyed like the bodies.
    const params = [...parameters(route.path), ...(PARAMETERS[key] ?? [])];
    paths[route.path] ??= {};
    paths[route.path][route.method] = {
      tags: [tag],
      operationId: operationId(route.method, route.path),
      summary: `${route.method.toUpperCase()} ${route.path}`,
      ...(params.length > 0 ? { parameters: params } : {}),
      ...(BODIES[key] === undefined ? {} : { requestBody: BODIES[key] }),
      // AN EMPTY ARRAY RATHER THAN AN ABSENT FIELD, and this hazard is FAIL-CLOSED: an operation
      // omitting `security` inherits the document default, so omitting it on the sign-up route
      // would publish it as needing a token — the one route a caller without one must reach.
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
    // THE DEFAULT EVERY OPERATION ABOVE OVERRIDES. It governs nothing, since `securityOf` always
    // answers; it earns its place for what it SAYS about the API's posture.
    security: [{ [SCHEME]: [] }],
    // Swagger UI orders its groups as this list does, and files an untagged operation under
    // «default».
    tags,
    paths,
    components: {
      securitySchemes: {
        [SCHEME]: {
          // WHAT THE CALLER ACTUALLY DOES. `oauth2` with an empty `flows` gives Redoc an
          // Authorize button with nothing behind it, and `x-amazon-apigateway-authtype` is the
          // REST (v1) extension. Issuer and audience are per-environment intrinsics.
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  };
}
