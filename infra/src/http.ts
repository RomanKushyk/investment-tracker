// The shape every route on this API speaks, in one place.
//
// SHARED BECAUSE MORE THAN ONE PLACE NEEDS IT AND THEY MUST NOT DISAGREE — the rule
// `address.ts` states for the address. It began inside `applications.ts`, whose comment already
// called it "the shape every route this API grows will answer in"; the approval routes are the
// growth, and a second `json()` would be a second answer to what this API returns.

/**
 * What API Gateway's payload format 2.0 sends that a handler here reads.
 *
 * EVERY FIELD IS OPTIONAL, because they arrive per route rather than per request: the
 * unauthenticated application has a body and no claims, the admin routes have claims and a path
 * parameter and no body. Narrowed by hand rather than taken from `@types/aws-lambda`, which this
 * repository does not depend on — the same choice `pre-signup.ts` makes for its trigger event.
 */
export type ApiEvent = {
  body?: string;
  isBase64Encoded?: boolean;
  /** `<METHOD> <path>`, exactly as the template spells the route. */
  routeKey?: string;
  pathParameters?: Record<string, string | undefined>;
  requestContext?: {
    /**
     * What the NATIVE JWT authorizer passes through. There is no Lambda in the path — AWS
     * validates the signature, the issuer, the audience and the expiry, and hands the claims
     * on. A claim is text or a list of it; nothing here trusts one to be anything else.
     */
    authorizer?: { jwt?: { claims?: Record<string, string | string[]> } };
  };
};

/** What API Gateway expects back. */
export type ApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

// FROZEN, because these are singletons shared by every request a Lambda ever answers. A route
// that reached for one and added a header would change the answer given to everyone after it,
// on a container that lives for hours.
export const json = (statusCode: number, body: string): ApiResult =>
  Object.freeze({
    statusCode,
    headers: Object.freeze({ 'content-type': 'application/json' }),
    body,
  });

// TWO ANSWERS EVERY ROUTE HERE CAN GIVE, in one place for the reason this file exists at all.
// A second copy of `{"error":"internal"}` is a second chance for one of them to start naming a
// constraint; the point of a fixed answer is that it is the same fixed answer everywhere.
export const INVALID = json(400, '{"error":"invalid_request"}');
export const INTERNAL = json(500, '{"error":"internal"}');

/** Hex is hex in either case, which is exactly what makes the fold below necessary. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The canonical form of a uuid that arrived from outside — a Cognito `sub`, or an `{id}` off a
 * path — or `undefined` when there is none.
 *
 * VALIDATING AND FOLDING ARE ONE OPERATION HERE, for the reason `address.ts` gives for doing the
 * same with an address: two comparisons that disagree about case are a hole, and the hole is only
 * visible from whichever side is not doing the comparing. Postgres reads a `uuid` column
 * canonically, so `WHERE user_id = $1` matches whatever case arrives — while JavaScript `===`
 * does not. A guard that accepted either case and then compared with `===` would therefore let
 * the SAME id read as two different ones: refused by the code and found by the cluster. That is
 * not hypothetical, it is how the self-rejection guard was first written.
 *
 * Validated at all because an unparseable uuid sent to the cluster is `22P02`, which would
 * surface as a 500 for what is really a malformed request.
 */
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
