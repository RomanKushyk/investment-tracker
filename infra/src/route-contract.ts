// ONE MECHANISM FOR PROVING A ROUTE'S PUBLISHED CONTRACT, instead of a convention each
// handler's test file re-implements.
//
// The document this API publishes is a chain — the template names the routes, each handler
// declares what its routes answer, the generator turns those into operations, and the artifact
// is committed. Every link of that chain was at some point asserted rather than proved, and
// each one failed the same way when somebody finally mutated it: an answer moved to a route
// that cannot give it, or vanished from one that can, with the whole suite green. Four
// instances, at four layers. `docs/reference/openapi.json` is only the last of them.
//
// What made it recur is that the proofs were per-file conventions. Two test files each grew
// their own recorder, and NOTHING REQUIRED A THIRD HANDLER'S FILE TO HAVE ONE — so a new route
// would be published and proved only "documented somewhere", which is exactly how the second
// and third instances happened. This module is the proof; `openapi.test.ts` is what requires
// every handler that owns a route to use it.
import { describe, expect, it } from 'vitest';

import type { ApiEvent, ApiResult } from './http';

/** `<status> <body>` — one answer, as both the handler and the document spell it. */
export const answerOf = (result: ApiResult): string => `${result.statusCode} ${result.body}`;

export type Observation = { route: string; answer: string };

/**
 * Records what a handler answered, per ROUTE.
 *
 * Route-aware even for a handler serving one route today: recording the answer alone is how a
 * file first passed while publishing one route's answers on another, and a second route on the
 * same handler inherits that hole silently.
 */
export const recorder = (fallbackRoute: string) => {
  const observed: Observation[] = [];
  return {
    observed,
    record: <T extends ApiResult>(event: ApiEvent, result: T): T => {
      observed.push({ route: event.routeKey ?? fallbackRoute, answer: answerOf(result) });
      return result;
    },
  };
};

/**
 * The proof, generated rather than written out in each file.
 *
 * BOTH DIRECTIONS, because each catches a different lie. An answer observed but not declared
 * means the document omits something the route really gives; an answer declared but never
 * observed means the document advertises something the route cannot reach, and a client
 * branches on an answer that never arrives.
 *
 * `minimum` guards the second direction against a filtered `-t` run, which records a handful
 * and would otherwise read as a contract break rather than as a partial run.
 */
export const proveRouteContract = (opts: {
  declared: Record<string, readonly ApiResult[]>;
  observed: Observation[];
  minimum: number;
}): void => {
  describe('the answers these tests observed are the ones the document publishes', () => {
    // EVERY ROUTE THE HANDLER DECLARES, read from the declaration rather than listed here.
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
