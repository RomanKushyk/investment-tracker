// `POST /me/terms`: the terms accepted on the step, by an account whose row holds no version
// (*Legal documents*). The one route the gate lets such a caller reach. The first acceptance stands,
// as an application made again leaves its own, so a second press writes nothing and answers alike.
import { TERMS_VERSION } from '@quirenote/core/terms';

import { FORBIDDEN, NO_APPLICATION, PENDING, REJECTED, authorize } from './authorize';
import {
  INTERNAL,
  INVALID,
  TERMS_OUTDATED,
  TOO_LARGE,
  type ApiEvent,
  type ApiResult,
  type Declared,
  type EmptyResult,
  bodiless,
  noContent,
  readJson,
} from './http';
import { loggable } from './log';
import type { SqlClient } from './migrate';
import { RETRY_DELAYS_MS, retryable } from './provision';

export const TERMS_ROUTE = 'POST /me/terms';

const ACCEPTED = bodiless({ statusCode: 204, name: 'accepted', headers: [] });

/** What the route can answer, and the only list of it: `openapi.ts` builds the document from here,
 *  and `accept-terms.test.ts` proves it against what the route really answers. */
export const RESPONSES: Record<string, readonly (ApiResult | Declared)[]> = {
  [TERMS_ROUTE]: [
    ACCEPTED,
    INVALID,
    TOO_LARGE,
    TERMS_OUTDATED,
    PENDING,
    REJECTED,
    NO_APPLICATION,
    FORBIDDEN,
    INTERNAL,
  ],
};

export const REQUEST_BODY = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['termsVersion'],
        additionalProperties: false,
        /** The terms the step showed, accepted by pressing its button; only the current ones. */
        properties: { termsVersion: { type: 'string', enum: [TERMS_VERSION] } },
      },
    },
  },
} as const;

export interface AcceptTermsDeps {
  user: SqlClient;
  sleep: (ms: number) => Promise<void>;
}

// ONE STATEMENT, so `app_user_terms_ck` sees both columns move together, and conditional, so a
// version already held is never replaced and running it again changes nothing.
const ACCEPT = `UPDATE app_user SET terms_version = $2::date, terms_accepted_at = now()
                 WHERE user_id = $1 AND terms_version IS NULL`;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function acceptTerms(
  deps: AcceptTermsDeps,
  event: ApiEvent,
): Promise<ApiResult | EmptyResult> {
  // THE WHOLE BODY IS INSIDE THE CATCH, THE GATE INCLUDED, as `approve.ts` says why.
  try {
    const gate = await authorize(deps.user, event, { terms: 'optional' });
    if ('refusal' in gate) return gate.refusal;
    const read = readJson(event);
    if ('statusCode' in read) return read;
    // EXACT-KEY, as the published schema says, and as `POST /applications` reads its body.
    if (!isObject(read.value) || Object.keys(read.value).some((key) => key !== 'termsVersion')) {
      return INVALID;
    }
    // A step held open across a release showed other terms; they are not the ones recorded here.
    if (read.value.termsVersion !== TERMS_VERSION) return TERMS_OUTDATED;

    for (let attempt = 0; ; attempt += 1) {
      try {
        await deps.user.query(ACCEPT, [gate.caller.userId, TERMS_VERSION]);
        return noContent(ACCEPTED, {});
      } catch (err) {
        // A serialization failure may have committed even so; the write run again finds it done.
        if (!retryable(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      }
      await deps.sleep(RETRY_DELAYS_MS[attempt]);
    }
  } catch (err) {
    console.error('accept terms failed', loggable(err));
    return INTERNAL;
  }
}
