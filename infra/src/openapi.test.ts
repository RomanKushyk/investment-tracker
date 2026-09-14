// The OpenAPI document is an ARTIFACT, not a source — the rule
// `schema-generated.test.ts` states for the generated SQL, applied to the API.
// A hand edit is discarded by the next regeneration, so it fails here instead.
//
// DERIVED FROM THIS REPOSITORY, NOT FROM THE DEPLOYED API. `aws apigatewayv2
// export-api` returns a correct route half, but regenerating through it needs a
// deployed API, credentials and `apigateway:GET` — which the deploy role does not
// hold and CI cannot reach. A drift test that cannot run is not one, so both
// halves come from files that are committed: the routes from `template-user.yaml`,
// the responses from the handlers' own frozen constants.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ADDRESS, MAX_ADDRESS } from './address';
import {
  REQUEST_BODY,
  RESPONSES as APPLICATION_RESPONSES,
  ROUTE as APPLY_ROUTE,
} from './applications';
import { APPROVE_ROUTE, REJECT_ROUTE, RESPONSES as ADMIN_RESPONSES } from './approve';
import { ANSWERS, buildSpec } from './openapi';

const COMMITTED = new URL('../../docs/reference/openapi.json', import.meta.url);

/**
 * EVERY module beside this one, not a written list of four. A list of the answers went stale
 * inside one milestone, which is this file's whole argument — a list of WHERE TO LOOK for them
 * is the same thing one step removed, and a new handler added to the API would simply not be
 * scanned. Reading the directory cannot forget a file.
 */
const SOURCES = readdirSync(new URL('.', import.meta.url), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .sort();

/** Every `json(<status>, '<body>')` literal written in those modules. */
const answersInSource = () =>
  SOURCES.flatMap((file) => {
    const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
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

  // CRITERION 4, AS A TEST RATHER THAN A PROMISE. The generator reaching for the
  // deployed API is exactly what would make this suite unable to run it.
  it('needs no deployed API to build', () => {
    const generator = readFileSync(new URL('./openapi.ts', import.meta.url), 'utf8');
    // WHAT IT IMPORTS, not what it mentions: the file argues at length about why it does
    // NOT go through `export-api`, so a substring match would fail on its own reasoning.
    const imports = [...generator.matchAll(/from '([^']+)';/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./applications', './approve', './http', 'node:fs', 'yaml']);
    // And nothing shells out to the CLI, which is the other way a deployed API creeps in.
    for (const reach of ['child_process', 'execFileSync', 'fetch(']) {
      expect([reach, generator.includes(reach)]).toEqual([reach, false]);
    }
  });
});

describe('every answer a handler can give is in the document', () => {
  // THE WHOLE POINT, and the reason the list is scanned out of the source rather
  // than written here: a hand-kept inventory of these went stale inside one
  // milestone — `unclaimed_identity` landed and the issue's own table did not
  // learn it. A new `json(…)` constant with no entry in the document fails here.
  it('describes every json() literal the handlers declare', () => {
    const spec = buildSpec();
    const described = new Set(
      Object.values(spec.paths).flatMap((ops) =>
        Object.values(ops).flatMap((op) =>
          Object.entries(op.responses).flatMap(([status, r]) =>
            Object.values(r.content['application/json'].examples).map(
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
const DECLARED = { ...APPLICATION_RESPONSES, ...ADMIN_RESPONSES };

describe('each operation publishes its own route’s answers', () => {
  // THE LAST LINK, and it was missing. `approve.test.ts` proves each `RESPONSES` list matches
  // what that route really answers, and the scan above proves every constant is documented
  // somewhere — but nothing proved the GENERATOR put the right list on the right operation.
  // Handing every operation the union of both routes' answers passed the whole suite, which is
  // the same defect one file downstream: a document advertising an answer the route cannot give.
  it('publishes exactly what each route declares, and nothing from another route', () => {
    const spec = buildSpec();
    for (const [route, answers] of Object.entries(DECLARED)) {
      const [method, path] = route.split(' ');
      const op = spec.paths[path][method.toLowerCase()];
      const published = new Set(
        Object.entries(op.responses).flatMap(([status, r]) =>
          Object.values(r.content['application/json'].examples).map(
            (e) => `${status} ${JSON.stringify(e.value)}`,
          ),
        ),
      );
      const declared = new Set(
        answers.map((a) => `${a.statusCode} ${JSON.stringify(JSON.parse(a.body))}`),
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
  it('puts the body on the route that takes one, and on no other', () => {
    const spec = buildSpec();
    const withBody = Object.entries(spec.paths)
      .flatMap(([path, ops]) =>
        Object.entries(ops).map(([method, op]) => ({
          route: `${method.toUpperCase()} ${path}`,
          body: op.requestBody,
        })),
      )
      .filter((o) => o.body !== undefined);
    expect(withBody.map((o) => o.route)).toEqual([APPLY_ROUTE]);
    expect(withBody[0].body).toEqual(REQUEST_BODY);
  });

  // AND THE SCHEMA IS THE ADDRESS RULE, not a description of it. A hand-kept ceiling or
  // pattern here is a second answer to what the cluster accepts, which `address.ts` forbids
  // in its own words.
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
  // THE BINDING, and the thing whose absence made the same defect appear four times. The proof
  // that a route's declared answers are the ones it really gives lives in that handler's own
  // test file, because that is where the branches are already driven — but nothing REQUIRED a
  // handler's file to carry one, so a new route would be published proved only "documented
  // somewhere", which is exactly how two of the four instances happened.
  //
  // Derived from the template through `ANSWERS`, so adding a handler to the generator without
  // proving its routes fails here rather than going unnoticed.
  it('makes every handler that owns a route prove it', () => {
    for (const handler of Object.keys(ANSWERS)) {
      const file = `${handler.replace('.handler', '')}.test.ts`;
      const text = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
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

describe('the routes, the authorizer, and the one route outside it', () => {
  const spec = buildSpec();

  it('declares the three routes and no others', () => {
    expect(specRoutes(spec).sort()).toEqual([APPLY_ROUTE, APPROVE_ROUTE, REJECT_ROUTE].sort());
  });

  it('declares the Cognito authorizer as the only security scheme', () => {
    expect(Object.keys(spec.components.securitySchemes)).toEqual(['CognitoJwt']);
  });

  // THE ASYMMETRY IS THE POINT. `POST /v1/applications` creates the very row every
  // other route is checked against, so it alone carries no security.
  it('puts security on the admin routes and none on the application', () => {
    const op = (key: string) => {
      const [method, path] = key.split(' ');
      return spec.paths[path][method.toLowerCase()];
    };
    expect(op(APPLY_ROUTE).security).toBeUndefined();
    for (const key of [APPROVE_ROUTE, REJECT_ROUTE]) {
      expect([key, op(key).security]).toEqual([key, [{ CognitoJwt: [] }]]);
    }
  });

  it('gives the admin routes their path parameter', () => {
    const [, path] = APPROVE_ROUTE.split(' ');
    const params = spec.paths[path].post.parameters ?? [];
    expect(params).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });
});
