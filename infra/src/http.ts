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
  /** LOWER-CASED BY API GATEWAY, and a header sent twice arrives once, its values comma-joined. A
   *  list header is read through `headerValues`; one whose value holds a comma, a date, is not. */
  headers?: Record<string, string | undefined>;
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

/** A 304: headers and NO BODY KEY. It is a null-body status, and `body: ''` is still a body, which
 *  an adapter answers with a 500. */
export type EmptyResult = { statusCode: 304; headers: Record<string, string> };

/** AN ANSWER BUILT PER REQUEST, declared once beside the fixed ones so the document and the
 *  route's proof can name it with no literal to read. `name` keys its example in the document and
 *  is unique under its status; it is not an error code. Made by `derived` or `bodiless` alone. */
export type Derived<H extends Lowercase<string> = Lowercase<string>> = Readonly<{
  statusCode: number;
  name: string;
  headers: readonly H[];
  /** What the document shows in place of a body that differs per request. */
  example: unknown;
}>;
export type Bodiless<H extends Lowercase<string> = Lowercase<string>> = Readonly<{
  statusCode: 304;
  name: string;
  headers: readonly H[];
}>;
export type Declared = Derived | Bodiless;

/** Fetch's null-body statuses that are final; 101 and 103 are interim responses, not answers. */
const NULL_BODY = new Set([204, 205, 304]);

/** The builder sets it from whether there is a body; declared, it could put one on a 304. */
const refuseContentType = (name: string, headers: readonly string[]): void => {
  if (headers.includes('content-type')) {
    throw new Error(`${name}: content-type is set by the builder, never declared`);
  }
};

/** What `derived` and `bodiless` made. A literal, a spread copy or a cast types as a declaration
 *  while skipping their refusals, and no type tells them apart, so every use asks here. */
const MADE = new WeakSet<Declared>();

/** The declaration itself, once it is known to be one a factory made. */
export const made = <D extends Declared>(declared: D): D => {
  if (!MADE.has(declared)) {
    throw new Error(
      `${declared.name}: a declaration is made by derived() or bodiless(), never written or copied`,
    );
  }
  return declared;
};

// FROZEN for `json`'s reason: a declaration is a module-level singleton every request shares.
export const derived = <H extends Lowercase<string>>(declared: Derived<H>): Derived<H> => {
  if (NULL_BODY.has(declared.statusCode)) {
    throw new Error(
      `${declared.statusCode} ${declared.name}: a null-body status cannot carry a body`,
    );
  }
  refuseContentType(declared.name, declared.headers);
  const declaration: Derived<H> = Object.freeze({
    ...declared,
    headers: Object.freeze([...declared.headers]),
  });
  MADE.add(declaration);
  return declaration;
};

export const bodiless = <H extends Lowercase<string>>(declared: {
  name: string;
  headers: readonly H[];
}): Bodiless<H> => {
  refuseContentType(declared.name, declared.headers);
  const declaration: Bodiless<H> = Object.freeze({
    statusCode: 304,
    name: declared.name,
    headers: Object.freeze([...declared.headers]),
  });
  MADE.add(declaration);
  return declaration;
};

/** A built answer's declaration, kept OFF the object API Gateway serialises. A copy loses it. */
const DECLARATIONS = new WeakMap<ApiResult | EmptyResult, Declared>();

/** Exactly the names the declaration lists, so the document's headers are the ones sent — and
 *  every one of them: typed wide, a declaration does not make the compiler ask for each. */
const carried = <H extends string>(names: readonly H[], values: Record<H, string>) =>
  Object.fromEntries(
    names.map((name) => {
      const value: unknown = values[name];
      if (typeof value !== 'string') throw new Error(`no value for the declared header ${name}`);
      return [name, value] as const;
    }),
  );

/** A FRESH OBJECT EVERY CALL, and FROZEN as the fixed answers are: the proof and the document
 *  name it by its declaration, so a status or a body changed afterwards would go out under it. */
export const respond = <H extends Lowercase<string>>(
  declared: Derived<H>,
  headers: Record<NoInfer<H>, string>,
  body: string,
): ApiResult => {
  made(declared);
  const result: ApiResult = Object.freeze({
    statusCode: declared.statusCode,
    headers: Object.freeze({
      'content-type': 'application/json',
      ...carried(declared.headers, headers),
    }),
    body,
  });
  DECLARATIONS.set(result, declared);
  return result;
};

export const notModified = <H extends Lowercase<string>>(
  declared: Bodiless<H>,
  headers: Record<NoInfer<H>, string>,
): EmptyResult => {
  made(declared);
  const result: EmptyResult = Object.freeze({
    statusCode: declared.statusCode,
    headers: Object.freeze(carried(declared.headers, headers)),
  });
  DECLARATIONS.set(result, declared);
  return result;
};

/** What a result was built from — nothing for a fixed answer, or for a copy of a built one. */
export const declarationOf = (result: ApiResult | EmptyResult): Declared | undefined =>
  DECLARATIONS.get(result);

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

/** Every element of a list header, in either shape it arrives — sent twice, or written as one
 *  list — trimmed, the empty ones dropped. A comma between double quotes separates nothing, exact
 *  for an entity-tag, which has no escapes; a quoted string holding `\"` is split wrongly. */
export const headerValues = (event: ApiEvent, name: Lowercase<string>): string[] =>
  (event.headers?.[name]?.match(/(?:"[^"]*"|[^,])+/g) ?? [])
    .map((element) => element.trim())
    .filter((element) => element !== '');
