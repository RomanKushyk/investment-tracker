// The shape every route on this API speaks, in one place, for the reason `address.ts` gives for
// the address rule: a second `json()` would be a second answer to what this API returns.
import { MAX_BODY_BYTES } from '@quirenote/core/ops';

/** EVERY FIELD IS OPTIONAL, because they arrive per route rather than per request: the
 *  unauthenticated application has a body and no claims, the admin routes have claims and a path
 *  parameter and no body. Narrowed by hand — nothing here depends on `@types/aws-lambda`. */
export type ApiEvent = {
  body?: string;
  isBase64Encoded?: boolean;
  /** `<METHOD> <path>`, exactly as the template spells the route. */
  routeKey?: string;
  pathParameters?: Record<string, string | undefined>;
  /** ABSENT with no query string; a parameter sent twice arrives once, its values comma-joined. */
  queryStringParameters?: Record<string, string | undefined>;
  /** LOWER-CASED BY API GATEWAY, and a header sent twice arrives once, its values comma-joined. A
   *  list header is read through `headerValues`; one whose value holds a comma, a date, is not. */
  headers?: Record<string, string | undefined>;
  /** Payload 2.0 takes every `Cookie` header out of `headers` and delivers it here, `name=value`
   *  apiece. */
  cookies?: string[];
  requestContext?: {
    /** What the NATIVE JWT authorizer passes through: AWS validates signature, issuer, audience
     *  and expiry. A claim is text or a list of it, and nothing trusts one to be anything else. */
    authorizer?: { jwt?: { claims?: Record<string, string | string[]> } };
  };
};

export type ApiResult = {
  statusCode: number;
  headers: Record<string, string>;
  /** Payload 2.0's own list, "each cookie becomes a set-cookie header". ABSENT when there is none. */
  cookies?: readonly string[];
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
/** RFC 9110 §15.5.13, a precondition the request carried that the current state fails. */
export const PRECONDITION_FAILED = json(412, '{"error":"precondition_failed"}');
/** RFC 6585 §3: a write that names no state it expects; `*` matches whatever exists, so it is
 *  none. */
export const PRECONDITION_REQUIRED = json(428, '{"error":"precondition_required"}');
/** A body past core's `MAX_BODY_BYTES`, which the routes that take one share. */
export const TOO_LARGE = json(413, '{"error":"payload_too_large","max":1048576}');

/** A 304 or a 204: headers and NO BODY KEY. Each is a null-body status, and `body: ''` is still a
 *  body, which an adapter answers with a 500. */
export type EmptyResult = { statusCode: 204 | 304; headers: Record<string, string> };

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
  statusCode: 204 | 304;
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

/** A 304 unless it names 204, the one other null-body answer a route gives. */
export const bodiless = <H extends Lowercase<string>>(declared: {
  statusCode?: 204;
  name: string;
  headers: readonly H[];
}): Bodiless<H> => {
  refuseContentType(declared.name, declared.headers);
  const declaration: Bodiless<H> = Object.freeze({
    statusCode: declared.statusCode ?? 304,
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

/** Text for every header but `set-cookie`, which RFC 6265 §3 says not to fold into one field: a
 *  list of at least one, as payload 2.0 carries it. */
type HeaderValues<H extends string> = {
  [K in H]: K extends 'set-cookie' ? readonly [string, ...string[]] : string;
};

/** A FRESH OBJECT EVERY CALL, and FROZEN as the fixed answers are: the proof and the document
 *  name it by its declaration, so a status or a body changed afterwards would go out under it. */
export const respond = <H extends Lowercase<string>>(
  declared: Derived<H>,
  headers: HeaderValues<NoInfer<H>>,
  body: string,
): ApiResult => {
  made(declared);
  // A DECLARED `set-cookie` LEAVES THROUGH `cookies`, one entry per cookie, the channel AWS documents;
  // the declaration still names the header, which is what a client receives and the document shows.
  const names: readonly string[] = declared.headers;
  const { 'set-cookie': cookies, ...values } = headers as Record<string, unknown>;
  const sent = carried(
    names.filter((name) => name !== 'set-cookie'),
    values as Record<string, string>,
  );
  const cookied = names.includes('set-cookie');
  // CHECKED HERE as `carried` checks the rest: read back as the wide type, the list is not asked for.
  if (
    cookied &&
    !(Array.isArray(cookies) && cookies.length > 0 && cookies.every((c) => typeof c === 'string'))
  ) {
    throw new Error('the declared header set-cookie takes a list of at least one cookie');
  }
  const result: ApiResult = Object.freeze({
    statusCode: declared.statusCode,
    headers: Object.freeze({ 'content-type': 'application/json', ...sent }),
    ...(cookied ? { cookies: Object.freeze([...(cookies as string[])]) } : {}),
    body,
  });
  DECLARATIONS.set(result, declared);
  return result;
};

/** A bodiless answer of the status its declaration names, held to the one each caller means. */
const empty = <H extends Lowercase<string>>(
  status: EmptyResult['statusCode'],
  declared: Bodiless<H>,
  headers: Record<NoInfer<H>, string>,
): EmptyResult => {
  made(declared);
  if (declared.statusCode !== status) {
    throw new Error(`${declared.name} is a ${declared.statusCode}, not a ${status}`);
  }
  const result: EmptyResult = Object.freeze({
    statusCode: declared.statusCode,
    headers: Object.freeze(carried(declared.headers, headers)),
  });
  DECLARATIONS.set(result, declared);
  return result;
};

export const notModified = <H extends Lowercase<string>>(
  declared: Bodiless<H>,
  headers: Record<NoInfer<H>, string>,
): EmptyResult => empty(304, declared, headers);

export const noContent = <H extends Lowercase<string>>(
  declared: Bodiless<H>,
  headers: Record<NoInfer<H>, string>,
): EmptyResult => empty(204, declared, headers);

/** What a result was built from — nothing for a fixed answer, or for a copy of a built one. */
export const declarationOf = (result: ApiResult | EmptyResult): Declared | undefined =>
  DECLARATIONS.get(result);

/** The body's bytes, past core's byte bound 413. */
export const bodyBytes = (event: ApiEvent): Buffer | ApiResult => {
  const raw = event.body ?? '';
  const bytes = event.isBase64Encoded ? Buffer.from(raw, 'base64') : Buffer.from(raw, 'utf8');
  return bytes.length > MAX_BODY_BYTES ? TOO_LARGE : bytes;
};

/** JSON in UTF-8, as RFC 8259 §8.1 requires: not UTF-8, unparseable or holding a `__proto__` key
 *  anywhere 400, a key zod drops before any schema sees it. */
export const parseJson = (bytes: Buffer): { value: unknown } | ApiResult => {
  let forbidden = false;
  try {
    // Fatal, where a Buffer's decoding would put U+FFFD in place of what the client sent.
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    const value: unknown = JSON.parse(text, (key: string, v: unknown) => {
      if (key === '__proto__') forbidden = true;
      return v;
    });
    return forbidden ? INVALID : { value };
  } catch {
    return INVALID;
  }
};

/** A JSON body, bounded and parsed: the door every route that takes one shares. */
export const readJson = (event: ApiEvent): { value: unknown } | ApiResult => {
  const bytes = bodyBytes(event);
  return Buffer.isBuffer(bytes) ? parseJson(bytes) : bytes;
};

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

const WEAK = 'W/';
const opaque = (tag: string) => (tag.startsWith(WEAK) ? tag.slice(WEAK.length) : tag);

/** RFC 9110 §8.8.3.2's weak comparison, `If-None-Match`'s: the opaque tags alike, either weak.
 *  `*` stands for any current representation. */
export const weakMatch = (tags: readonly string[], current: string): boolean =>
  tags.some((tag) => tag === '*' || opaque(tag) === opaque(current));

/** Its strong comparison, `If-Match`'s: alike and neither weak, so a weak tag never matches. */
export const strongMatch = (tags: readonly string[], current: string): boolean =>
  tags.some(
    (tag) => tag === '*' || (!tag.startsWith(WEAK) && !current.startsWith(WEAK) && tag === current),
  );
