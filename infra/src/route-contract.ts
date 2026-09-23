// One mechanism for proving a route's published contract, instead of a convention each handler's
// test file re-implements. The document is a chain — template, handler declaration, generator,
// committed artifact — and every link was at some point asserted rather than proved, failing four
// times at those four layers: an answer published on a route that cannot give it, or missing from
// one that can. Nothing required a THIRD handler's file to grow its own recorder, which is how the
// second and third of those happened. `openapi.test.ts` requires every route's handler to use it.
import { describe, expect, it } from 'vitest';

import {
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  declarationOf,
  made,
} from './http';

/** `<status> <body>` for a fixed answer, as both the handler and the document spell it. An answer
 *  built per request is its declaration — everything that declaration states: status, name,
 *  headers and, for a body, the example — whatever body this request got. */
export const answerOf = (answer: ApiResult | EmptyResult | Declared): string => {
  const declared = 'name' in answer ? made(answer) : declarationOf(answer);
  if (declared !== undefined) {
    const example = 'example' in declared ? ` ${JSON.stringify(declared.example)}` : '';
    return `${declared.statusCode} <${declared.name}> [${declared.headers.join(', ')}]${example}`;
  }
  // A bodiless result with no declaration was built by hand, and reads as undeclared.
  return `${answer.statusCode} ${'body' in answer ? answer.body : '<no body>'}`;
};

export type Observation = { route: string; answer: string };

/** Route-aware even for a handler serving one route today: recording the answer alone is how a
 *  file first passed while publishing one route's answers on another. */
export const recorder = (fallbackRoute: string) => {
  const observed: Observation[] = [];
  return {
    observed,
    record: <T extends ApiResult | EmptyResult>(event: ApiEvent, result: T): T => {
      observed.push({ route: event.routeKey ?? fallbackRoute, answer: answerOf(result) });
      return result;
    },
  };
};

/** BOTH DIRECTIONS, because each catches a different lie: observed but not declared means the
 *  document omits something the route gives; declared but never observed means a client branches
 *  on an answer that never arrives. `minimum` separates a contract break from a filtered `-t` run. */
export const proveRouteContract = (opts: {
  declared: Record<string, readonly (ApiResult | Declared)[]>;
  observed: Observation[];
  minimum: number;
}): void => {
  describe('the answers these tests observed are the ones the document publishes', () => {
    for (const route of Object.keys(opts.declared)) {
      const declared = () => new Set(opts.declared[route].map(answerOf));
      const seen = () =>
        new Set(opts.observed.filter((o) => o.route === route).map((o) => o.answer));

      it(`answers nothing ${route} does not declare`, () => {
        expect([...seen()].filter((a) => !declared().has(a))).toEqual([]);
      });

      it(`declares nothing ${route} never answers`, () => {
        if (opts.observed.length < opts.minimum) {
          throw new Error(
            `only ${opts.observed.length} answers were recorded — this proof needs the whole ` +
              `file to run, not a filtered subset`,
          );
        }
        expect([...declared()].filter((a) => !seen().has(a))).toEqual([]);
      });
    }

    it('declares at least one route, so the loop above cannot be empty', () => {
      expect(Object.keys(opts.declared).length).toBeGreaterThan(0);
    });
  });
};
