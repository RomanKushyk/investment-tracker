// The OpenAPI document is an ARTIFACT, not a source — the rule
// `schema-generated.test.ts` states for the generated SQL, applied to the API.
//
// DERIVED FROM THIS REPOSITORY, NOT FROM THE DEPLOYED API. `aws apigatewayv2
// export-api` returns a correct route half, but regenerating through it needs a
// deployed API, credentials and `apigateway:GET` — which the deploy role does not
// hold and CI cannot reach. A drift test that cannot run is not one, so both
// halves come from files that are committed: the routes from `template-user.yaml`,
// the responses from the handlers' own frozen constants.
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

import { ADDRESS, MAX_ADDRESS } from './address';
import {
  REQUEST_BODY,
  RESPONSES as APPLICATION_RESPONSES,
  ROUTE as APPLY_ROUTE,
} from './applications';
import { APPROVE_ROUTE, REJECT_ROUTE, RESPONSES as ADMIN_RESPONSES } from './approve';
import {
  CSRF_HEADER,
  REFRESH_ROUTE,
  RESPOND_BODY,
  RESPOND_ROUTE,
  RESPONSES as RELAY_RESPONSES,
  SIGN_OUT_ROUTE,
  START_BODY,
  START_ROUTE,
} from './auth-relay';
import { INVALID, bodiless, derived } from './http';
import { ANSWERS, buildSpec, responses, securityOf, servers } from './openapi';

const COMMITTED = new URL('../../docs/reference/openapi.json', import.meta.url);

/**
 * THE TEMPLATE READ A SECOND TIME, here rather than through the generator, so the assertions
 * below compare two readings of one file instead of one reading against itself, parsed the
 * way `public-api.test.ts` parses it.
 *
 * CHECKED ON THE WAY DOWN, because this runs at collection: `yaml` recovers from a structural
 * error by DROPPING content, and a mangled `Domain:` would take the whole file out with a
 * TypeError five levels deep, hiding the generator's own message and the tests below.
 */
const TEMPLATE = parseDocument(
  readFileSync(new URL('../template-user.yaml', import.meta.url), 'utf8'),
);
if (TEMPLATE.errors.length > 0) {
  throw new Error(`template-user.yaml does not parse: ${TEMPLATE.errors[0].message}`);
}
const DOMAIN = (
  TEMPLATE.toJS() as {
    Resources?: { PublicApi?: { Properties?: { Domain?: { DomainName?: string[] } } } };
  }
).Resources?.PublicApi?.Properties?.Domain?.DomainName;
if (DOMAIN === undefined) {
  throw new Error('template-user.yaml declares no Domain on PublicApi');
}

/**
 * EVERY module beside this one, not a written list of four. A list of the answers went stale
 * inside one milestone, which is this file's whole argument — a list of WHERE TO LOOK for them
 * is the same thing one step removed. Reading the directory cannot forget a file.
 */
const SOURCES = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

/** Every source this file reads as text is read through this: a commented-out `json(…)` is no
 *  answer, an import argued about in a comment is no import, and a comment naming
 *  `proveRouteContract(` proves nothing.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

/** Every `json(<status>, '<body>')` literal written in those modules. */
const answersInSource = () =>
  SOURCES.flatMap((file) => {
    const text = stripTs(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), file);
    return [...text.matchAll(/json\(\s*(\d{3}),\s*'([^']*)',?\s*\)/g)].map((m) => ({
      file,
      status: Number(m[1]),
      // ROUND-TRIPPED, because the document holds the parsed value and this holds the text
      // that produced it. `{"error":"x", "reason":"y"}` and `{"error":"x","reason":"y"}` are
      // the same answer, and comparing them as written would report the first undocumented.
      body: JSON.stringify(JSON.parse(m[2])),
    }));
  });

/** `<METHOD> <path>` for every operation the document declares. */
const specRoutes = (spec: ReturnType<typeof buildSpec>) =>
  Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.keys(ops).map((method) => `${method.toUpperCase()} ${path}`),
  );

describe('the document is regenerated, never typed', () => {
  it('reproduces the committed copy exactly', () => {
    const fresh = `${JSON.stringify(buildSpec(), null, 2)}\n`;
    // Committed LF, read on a Windows working tree where `core.autocrlf` may have
    // turned it CRLF — the same allowance `schema-generated.test.ts` makes.
    const committed = readFileSync(COMMITTED, 'utf8').replace(/\r\n/g, '\n');
    expect(fresh).toBe(committed);
  });

  it('needs no deployed API to build', () => {
    const generator = stripTs(
      readFileSync(new URL('./openapi.ts', import.meta.url), 'utf8'),
      './openapi.ts',
    );
    // WHAT IT IMPORTS, not what it mentions, and on the stripped text: the file argues at length
    // about why it does NOT go through `export-api`, and none of that reasoning is a dependency.
    const imports = [...generator.matchAll(/from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual([
      './applications',
      './approve',
      './auth-relay',
      './http',
      'node:fs',
      'yaml',
    ]);
    // And nothing shells out to the CLI, which is the other way a deployed API creeps in.
    for (const reach of ['child_process', 'execFileSync', 'fetch(']) {
      expect([reach, generator.includes(reach)]).toEqual([reach, false]);
    }
  });
});

describe('every answer a handler can give is in the document', () => {
  // THE WHOLE POINT, and the reason the list is scanned out of the source rather than
  // written here: a hand-kept inventory of these went stale inside one milestone —
  // `unclaimed_identity` landed and the issue's own table did not learn it.
  it('describes every json() literal the handlers declare', () => {
    const spec = buildSpec();
    const described = new Set(
      Object.values(spec.paths).flatMap((ops) =>
        Object.values(ops).flatMap((op) =>
          Object.entries(op.responses).flatMap(([status, r]) =>
            Object.values(r.content?.['application/json'].examples ?? {}).map(
              (e) => `${status} ${JSON.stringify(e.value)}`,
            ),
          ),
        ),
      ),
    );
    for (const answer of answersInSource()) {
      expect([
        answer.file,
        `${answer.status} ${answer.body}`,
        described.has(`${answer.status} ${answer.body}`),
      ]).toEqual([answer.file, `${answer.status} ${answer.body}`, true]);
    }
  });

  it('finds the answers at all, so the loop above cannot pass vacuously', () => {
    const answers = answersInSource();
    expect(answers.length).toBeGreaterThanOrEqual(14);
    expect(answers.map((a) => `${a.status} ${a.body}`)).toContain(
      '409 {"error":"unclaimed_identity"}',
    );
  });
});

/** Every route's declared answers, from the handlers that declare them. */
const DECLARED = { ...APPLICATION_RESPONSES, ...ADMIN_RESPONSES, ...RELAY_RESPONSES };

/** THE RELAY SAYS THE HEADER IT REQUIRES: without it a generated client is refused on every call. */
const ASKING_FOR_THE_HEADER = [
  { name: CSRF_HEADER, in: 'header', required: true, schema: { type: 'string', enum: ['1'] } },
];

describe('each operation publishes its own route’s answers', () => {
  // THE LAST LINK. `approve.test.ts` proves each `RESPONSES` list matches what that route
  // really answers, and the scan above proves every constant is documented somewhere — but
  // nothing proved the GENERATOR put the right list on the right operation. Handing every
  // operation the union of both handlers' answers passed the whole suite.
  it('publishes exactly what each route declares, and nothing from another route', () => {
    const spec = buildSpec();
    for (const [route, answers] of Object.entries(DECLARED)) {
      const [method, path] = route.split(' ');
      const op = spec.paths[path][method.toLowerCase()];
      const published = new Set(
        Object.entries(op.responses).flatMap(([status, r]) =>
          Object.values(r.content?.['application/json'].examples ?? {}).map(
            (e) => `${status} ${JSON.stringify(e.value)}`,
          ),
        ),
      );
      // A BUILT ANSWER IS PUBLISHED BY ITS EXAMPLE, having no one body to parse.
      const declared = new Set(
        answers.flatMap((a) =>
          'body' in a
            ? [`${a.statusCode} ${JSON.stringify(JSON.parse(a.body))}`]
            : 'example' in a
              ? [`${a.statusCode} ${JSON.stringify(a.example)}`]
              : [],
        ),
      );
      expect([route, [...published].filter((x) => !declared.has(x))]).toEqual([route, []]);
      expect([route, [...declared].filter((x) => !published.has(x))]).toEqual([route, []]);
    }
  });

  it('covers every route the document declares, so no operation escapes the check', () => {
    expect(Object.keys(DECLARED).sort()).toEqual(specRoutes(buildSpec()).sort());
  });

  // THE REQUEST HALF, which had no proof of its own. Emptying the generator's body map removed
  // `requestBody` from the document entirely and left every gate green — the same defect as the
  // response half, on the other half of the contract.
  it('puts the body on the routes that take one, and on no other', () => {
    const spec = buildSpec();
    const withBody = Object.entries(spec.paths)
      .flatMap(([path, ops]) =>
        Object.entries(ops).map(([method, op]) => ({
          route: `${method.toUpperCase()} ${path}`,
          body: op.requestBody,
        })),
      )
      .filter((o) => o.body !== undefined);
    expect(withBody.map((o) => [o.route, o.body])).toEqual([
      [APPLY_ROUTE, REQUEST_BODY],
      [START_ROUTE, START_BODY],
      [RESPOND_ROUTE, RESPOND_BODY],
    ]);
  });

  // AND THE SCHEMA IS THE ADDRESS RULE, not a description of it: a hand-kept ceiling or
  // pattern here is a second answer to what the cluster accepts, which `address.ts` forbids.
  it('publishes the address rule itself', () => {
    const schema = (
      buildSpec().paths['/v1/applications'].post.requestBody as {
        content: {
          'application/json': {
            schema: { properties: { email: { maxLength: number; pattern: string } } };
          };
        };
      }
    ).content['application/json'].schema.properties.email;
    expect(schema.maxLength).toBe(MAX_ADDRESS);
    expect(schema.pattern).toBe(ADDRESS.source);
  });
});

describe('every route that is published is proved, by mechanism rather than by habit', () => {
  // THE BINDING. The proof that a route's declared answers are the ones it really gives
  // lives in that handler's own test file, where the branches are already driven — but
  // nothing REQUIRED a handler's file to carry one, so a new route could be published proved
  // only "documented somewhere". Derived from the template through `ANSWERS`.
  it('makes every handler that owns a route prove it', () => {
    for (const handler of Object.keys(ANSWERS)) {
      const file = `${handler.replace('.handler', '')}.test.ts`;
      const text = stripTs(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'), file);
      expect([file, text.includes('proveRouteContract(')]).toEqual([file, true]);
    }
  });

  // AND EVERY ROUTE IN THE DOCUMENT BELONGS TO ONE OF THEM. A route whose handler is absent
  // from `ANSWERS` cannot be generated at all — `buildSpec` raises — but a handler present in
  // `ANSWERS` and missing from the template would leave a proved contract nothing publishes.
  it('publishes exactly the routes the handlers declare', () => {
    expect(
      Object.values(ANSWERS)
        .flatMap((byRoute) => Object.keys(byRoute))
        .sort(),
    ).toEqual(specRoutes(buildSpec()).sort());
  });
});

describe('the routes, the authorizer, and the routes outside it', () => {
  const spec = buildSpec();
  const RELAY = [START_ROUTE, RESPOND_ROUTE, REFRESH_ROUTE, SIGN_OUT_ROUTE];

  it('declares the seven routes and no others', () => {
    expect(specRoutes(spec).sort()).toEqual(
      [APPLY_ROUTE, APPROVE_ROUTE, REJECT_ROUTE, ...RELAY].sort(),
    );
  });

  it('declares the Cognito authorizer as the only security scheme', () => {
    expect(Object.keys(spec.components.securitySchemes)).toEqual(['CognitoJwt']);
  });

  // THE ASYMMETRY IS THE POINT, AND IT IS STATED RATHER THAN IMPLIED.
  // `POST /v1/applications` creates the very row every other route is checked against, and the
  // relay is how a token is obtained, so they need nothing — and say so with an EMPTY ARRAY, which
  // the specification defines as removing the document's default. Omitting the field would
  // INHERIT that default and publish them as needing the token they exist to hand out.
  it('opts the application and relay routes out explicitly, and names the scheme on the admin routes', () => {
    const op = (key: string) => {
      const [method, path] = key.split(' ');
      return spec.paths[path][method.toLowerCase()];
    };
    for (const key of [APPLY_ROUTE, ...RELAY]) {
      expect([key, op(key).security]).toEqual([key, []]);
    }
    for (const key of [APPROVE_ROUTE, REJECT_ROUTE]) {
      expect([key, op(key).security]).toEqual([key, [{ CognitoJwt: [] }]]);
    }
  });

  // AND THERE IS A DEFAULT FOR IT TO OVERRIDE. An operation's list carries no "may be
  // incomplete" caveat, which belongs to the root field alone; what the default adds is a
  // posture the DOCUMENT states, rather than one a reader infers from the operations in it.
  it('declares the scheme as the document-level default', () => {
    expect(spec.security).toEqual([{ CognitoJwt: [] }]);
  });

  // NO OPERATION LEAVES ITS POSTURE TO THE DEFAULT, read from the COMMITTED JSON rather than
  // from `buildSpec()`. Against the typed value this cannot fail: `Operation.security` is a
  // required field, so `tsc` rejects an operation built without one. The compiler guards the
  // GENERATOR; this guards the ARTIFACT, where an omitted field is observable at all.
  it('makes every operation state its own posture', () => {
    const committed = JSON.parse(readFileSync(COMMITTED, 'utf8')) as {
      paths: Record<string, Record<string, { security?: unknown }>>;
    };
    const stated = Object.entries(committed.paths).flatMap(([path, operations]) =>
      Object.entries(operations).map(([method, operation]) => ({
        route: `${method.toUpperCase()} ${path}`,
        security: operation.security,
      })),
    );
    // NOT A COUNT — the routes the handlers declare, so an empty `paths` cannot pass the loop
    // below vacuously, which is the standard this file sets itself for every other scan.
    expect(stated.map((o) => o.route).sort()).toEqual(Object.keys(DECLARED).sort());
    for (const { route, security } of stated) {
      expect([route, Array.isArray(security)]).toEqual([route, true]);
    }
  });

  // THE REQUEST HALF OF THE RELAY'S CSRF DEFENCE: a route that refuses every call without a header
  // publishes that header, or a client generated from the document is refused on every call.
  it('asks for the custom header on the relay routes, and on no other', () => {
    for (const key of RELAY) {
      const [method, path] = key.split(' ');
      expect([key, spec.paths[path][method.toLowerCase()].parameters]).toEqual([
        key,
        ASKING_FOR_THE_HEADER,
      ]);
    }
    expect(spec.paths['/v1/applications'].post.parameters).toBeUndefined();
  });

  it('gives the admin routes their path parameter', () => {
    const [, path] = APPROVE_ROUTE.split(' ');
    const params = spec.paths[path].post.parameters ?? [];
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });
});

describe('the document names the hosts it can be called at', () => {
  const spec = buildSpec();

  // THE OTHER HALF THAT WAS MISSING, one field wide. A client generated from a document with
  // no `servers` has every operation and no base URL, so it cannot call anything until a
  // hostname arrives out of band — the same gap the response half had.
  it('takes both hosts from the API’s own Domain, and names no others', () => {
    const [, ...arms] = DOMAIN;
    expect(spec.servers.map((s) => s.url).sort()).toEqual(
      arms.map((host) => `https://${host}`).sort(),
    );
  });

  // AND WHICH ARM IS WHICH, written out rather than derived a second time here: the pairing
  // survives as an ORDER alone, and this template's own comment records that a copied `!If`
  // reads plausibly with its arms inverted. A client that takes the wrong arm for production
  // calls production. The template side of the pair is pinned in `public-api.test.ts`.
  it('pairs each host with its environment, dev first', () => {
    expect(spec.servers).toEqual([
      { url: 'https://api.dev.quirenote.com', description: 'dev' },
      { url: 'https://api.quirenote.com', description: 'prod' },
    ]);
  });
});

describe('the host derivation refuses what it cannot read', () => {
  // A TEMPLATE SHAPED LIKE THE REAL ONE, one part swapped per case. `buildSpec` always reads
  // the committed `template-user.yaml`, so a refusal reached only through it cannot be driven
  // at all — and every guard below was, until this block, deletable with five gates still green.
  const templateWith = (swap: {
    domainName?: unknown;
    conditions?: Record<string, unknown>;
    parameters?: Record<string, { AllowedValues?: string[] }>;
  }) => ({
    Parameters: swap.parameters ?? { Environment: { AllowedValues: ['dev', 'prod'] } },
    Conditions: swap.conditions ?? { IsProd: ['Environment', 'prod'] },
    Resources: {
      PublicApi: {
        Type: 'AWS::Serverless::HttpApi',
        Properties: {
          Domain: {
            DomainName: swap.domainName ?? ['IsProd', 'api.quirenote.com', 'api.dev.quirenote.com'],
          },
        },
      },
    },
  });

  it('reproduces the real document from the shape above, so the swaps below mean something', () => {
    expect(servers(templateWith({}))).toEqual(buildSpec().servers);
  });

  // What `!Sub 'api.${Zone}'` looks like by the time it arrives, and `https://api.${Zone}`
  // is what would ship.
  it('refuses an arm that is not a hostname', () => {
    expect(() =>
      servers(templateWith({ domainName: ['IsProd', 'api.quirenote.com', 'api.${Zone}'] })),
    ).toThrow(
      /DomainName is not three items, the last two hostnames: \["IsProd","api\.quirenote\.com","api\.\$\{Zone\}"\]$/,
    );
  });

  it('refuses a Domain that carries one hostname rather than two', () => {
    expect(() => servers(templateWith({ domainName: ['IsProd', 'api.quirenote.com'] }))).toThrow(
      /DomainName is not three items, the last two hostnames: \["IsProd","api\.quirenote\.com"\]$/,
    );
  });

  it('refuses a Domain that is a bare hostname rather than a list', () => {
    expect(() => servers(templateWith({ domainName: 'api.quirenote.com' }))).toThrow(
      /DomainName is not three items, the last two hostnames: "api\.quirenote\.com"/,
    );
  });

  // The full function form is legal YAML and arrives as an OBJECT, which destructures into a
  // TypeError rather than a message naming the condition.
  it('refuses a condition written as Fn::Equals', () => {
    expect(() =>
      servers(templateWith({ conditions: { IsProd: { 'Fn::Equals': ['Environment', 'prod'] } } })),
    ).toThrow(
      /Conditions\.IsProd is not a parameter and a value, with exactly one other value allowed: \{"Fn::Equals":/,
    );
  });

  it('refuses a condition whose value leaves its parameter two others', () => {
    expect(() =>
      servers(templateWith({ conditions: { IsProd: ['Environment', 'staging'] } })),
    ).toThrow(
      /Conditions\.IsProd is not a parameter and a value, with exactly one other value allowed: \["Environment","staging"\]/,
    );
  });

  // THE COPY-PASTE THIS TEMPLATE INVITES. `IsRegistrationOpen` is a second two-valued condition
  // in the same file, and an `!If` copied from it passes every structural check while naming
  // the hosts `open` and `closed` — production first, silently, before this refusal existed.
  it('refuses a condition that is not about environments', () => {
    expect(() =>
      servers(
        templateWith({
          domainName: ['IsRegistrationOpen', 'api.quirenote.com', 'api.dev.quirenote.com'],
          conditions: { IsRegistrationOpen: ['OpenRegistration', 'open'] },
          parameters: { OpenRegistration: { AllowedValues: ['closed', 'open'] } },
        }),
      ),
    ).toThrow(/neither environment IsRegistrationOpen selects is prod/);
  });

  // AND THE ORDER IS BY NAME, NOT BY ARM. Reverting to the arm order regenerates the committed
  // document byte-for-byte, so this is the only thing that holds it.
  it('puts production last whichever arm carries it', () => {
    expect(
      servers(
        templateWith({
          domainName: ['IsDev', 'api.dev.quirenote.com', 'api.quirenote.com'],
          conditions: { IsDev: ['Environment', 'dev'] },
        }),
      ),
    ).toEqual([
      { url: 'https://api.dev.quirenote.com', description: 'dev' },
      { url: 'https://api.quirenote.com', description: 'prod' },
    ]);
  });
});

describe('what an operation says about credentials', () => {
  // DRIVEN FROM THE FUNCTION, because `buildSpec()` only ever sees the two authorizers this
  // template writes and the third case is the one that matters.
  it('names the scheme for a route that names the authorizer', () => {
    expect(securityOf('CognitoJwt')).toEqual([{ CognitoJwt: [] }]);
  });

  // AN EMPTY ARRAY, not an absent field that would inherit the default. `[{}]` would be
  // a third statement again — credentials optional.
  it('opts a route with no authorizer out explicitly', () => {
    expect(securityOf(undefined)).toEqual([]);
  });

  // AND ANYTHING ELSE RAISES. A second authorizer, or a typo in the first, would otherwise be
  // published as `security: []` — a positive claim that a stranger may call the route, worse
  // to get wrong than the absent field it replaced. The template side is held by
  // `public-api.test.ts`; this is the half that would publish it.
  it('refuses a route naming an authorizer it does not declare', () => {
    expect(() => securityOf('CognitoJwtV2')).toThrow(
      /route names authorizer CognitoJwtV2, and only CognitoJwt is declared/,
    );
  });
});

describe('an answer with no literal body, as the document states it', () => {
  // DRIVEN FROM THE FUNCTION, so these shapes are proved whatever the template's routes declare.
  const TAGGED = derived({ statusCode: 200, name: 'tagged', headers: ['etag'], example: { n: 1 } });
  const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });
  const STRING = { schema: { type: 'string' } };

  // NO `content` KEY AT ALL: a 304 has no body to describe.
  it('gives a 304 its headers and no content', () => {
    const notModified = responses([UNCHANGED])['304'];
    expect(notModified).toEqual({
      description: 'Not modified',
      headers: { etag: STRING, 'cache-control': STRING },
    });
    expect('content' in notModified).toBe(false);
  });

  it('files a derived body’s example under its name, beside its headers', () => {
    expect(responses([TAGGED])['200']).toEqual({
      description: 'Accepted',
      headers: { etag: STRING },
      content: { 'application/json': { examples: { tagged: { value: { n: 1 } } } } },
    });
  });

  // A UNION, which is truthful because a Header Object is `required: false` unless it says so.
  it('lists every header any answer under a status sends', () => {
    const other = derived({ statusCode: 200, name: 'other', headers: ['vary'], example: {} });
    expect(Object.keys(responses([TAGGED, other])['200'].headers ?? {})).toEqual(['etag', 'vary']);
  });

  // A COPY WOULD BE PUBLISHED around the refusals: this one is a 304 with `content`.
  it('refuses to publish a declaration no factory made', () => {
    expect(() => responses([{ ...UNCHANGED, example: {} }])).toThrow(/made by derived/);
  });

  // THE SECOND WOULD OVERWRITE THE FIRST, and the scan above would still find it described on
  // another route. An indexed refusal beside the fixed one is exactly this collision.
  it('refuses two answers under one status filed under one name', () => {
    const indexed = derived({
      statusCode: 400,
      name: 'invalid_request',
      headers: [],
      example: { error: 'invalid_request', index: 3 },
    });
    expect(() => responses([INVALID, indexed])).toThrow(/400 .*invalid_request/);
  });

  it('gives a literal answer no headers', () => {
    expect('headers' in responses([INVALID])['400']).toBe(false);
  });
});
