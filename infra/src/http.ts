// The shape every route on this API speaks, in one place, for the reason `address.ts` gives for
// the address rule: a second `json()` would be a second answer to what this API returns.

/** EVERY FIELD IS OPTIONAL, because they arrive per route rather than per request: the
 *  unauthenticated application has a body and no claims, the admin routes have claims and a path
 *  parameter and no body. Narrowed by hand — nothing here depends on `@types/aws-lambda`. */
export type ApiEvent = {
  body?: string;
  isBase64Encoded?: boolean;
  /** `<METHOD> <path>`, exactly as the template spells the route. */
  routeKey?: string;
  pathParameters?: Record<string, string | undefined>;
  requestContext?: {
    /** What the NATIVE JWT authorizer passes through: AWS validates signature, issuer, audience
     *  and expiry. A claim is text or a list of it, and nothing trusts one to be anything else. */
    authorizer?: { jwt?: { claims?: Record<string, string | string[]> } };
  };
};

export type ApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

// FROZEN: these are singletons shared by every request a Lambda ever answers, so a route that
// reached for one and added a header would change the answer given to everyone after it.
export const json = (statusCode: number, body: string): ApiResult =>
  Object.freeze({
    statusCode,
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body,
  });

// The point of a fixed answer is that it is the same everywhere, never one naming a constraint.
export const INVALID = json(400, '{"error":"invalid_request"}');
export const INTERNAL = json(500, '{"error":"internal"}');

/** Hex is hex in either case, which is exactly what makes the fold below necessary. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** VALIDATING AND FOLDING ARE ONE OPERATION, as `address.ts` does for an address. Postgres reads a
 *  `uuid` column canonically, so `WHERE user_id = $1` matches whatever case arrives while
 *  JavaScript `===` does not — a guard that accepted either case then compared with `===` lets the
 *  SAME id read as two. Validated at all because an unparseable uuid reaches the cluster as
 *  `22P02`, surfacing as a 500 for what is really a malformed request. */
export const canonicalUuid = (supplied: unknown): string | undefined =>
  typeof supplied === 'string' && UUID.test(supplied) ? supplied.toLowerCase() : undefined;

/** A claim's value when it is a single string, and nothing when it is absent or a list. */
export const claim = (
  claims: Record<string, string | string[]> | undefined,
  name: string,
): string | undefined => {
  const value = claims?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
};
