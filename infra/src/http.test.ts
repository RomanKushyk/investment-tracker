// What a route reads off a request and what it answers with, for the answers that cannot be fixed
// text: a body built from the request, or a 304 that carries headers and nothing else.
import { describe, expect, it } from 'vitest';

import {
  INTERNAL,
  INVALID,
  type ApiEvent,
  type Derived,
  bodiless,
  derived,
  headerValues,
  json,
  notModified,
  respond,
} from './http';

const sent = (value: string): ApiEvent => ({ headers: { 'if-none-match': value } });

describe('a request header, in either shape API Gateway delivers it', () => {
  it('reads a header sent once', () => {
    expect(headerValues(sent('"a"'), 'if-none-match')).toEqual(['"a"']);
  });

  // A header sent twice arrives ONCE, its values joined with a bare comma.
  it('reads a header sent twice', () => {
    expect(headerValues(sent('"a","b"'), 'if-none-match')).toEqual(['"a"', '"b"']);
  });

  it('reads a list the client wrote as one header', () => {
    expect(headerValues(sent('W/"a", "b"'), 'if-none-match')).toEqual(['W/"a"', '"b"']);
  });

  // An entity-tag's opaque part may hold a comma, so a split that ignored quotes would cut it.
  it('keeps a comma inside a quoted tag', () => {
    expect(headerValues(sent('W/"a,b", "c"'), 'if-none-match')).toEqual(['W/"a,b"', '"c"']);
  });

  it('loses no character to a quote that never closes', () => {
    expect(headerValues(sent('"a,b'), 'if-none-match')).toEqual(['"a', 'b']);
  });

  it('drops the empty elements a list may carry', () => {
    expect(headerValues(sent(' , "a",, "b" ,'), 'if-none-match')).toEqual(['"a"', '"b"']);
  });

  it('reads an absent header as no values', () => {
    expect(headerValues({ headers: {} }, 'if-none-match')).toEqual([]);
    expect(headerValues({}, 'if-none-match')).toEqual([]);
  });

  // THE NAME IS NEVER FOLDED, because API Gateway already lower-cased every one it sent.
  it('is asked for by the lower-cased name, which the type holds', () => {
    // @ts-expect-error a capitalised name matches no header API Gateway delivers
    expect(headerValues(sent('"a"'), 'If-None-Match')).toEqual([]);
  });
});

const TAGGED = derived({
  statusCode: 200,
  name: 'tagged',
  headers: ['etag', 'cache-control'],
  example: { n: 1 },
});
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag', 'cache-control'] });
const COOKIED = derived({
  statusCode: 200,
  name: 'cookied',
  headers: ['set-cookie', 'cache-control'],
  example: {},
});

describe('a response built per request', () => {
  it('carries its own headers and leaves every shared constant as it was', () => {
    const before = [TAGGED, INVALID, INTERNAL].map((constant) => structuredClone(constant));

    const first = respond(TAGGED, { etag: '"1"', 'cache-control': 'private, no-cache' }, '{"n":1}');
    const second = respond(
      TAGGED,
      { etag: '"2"', 'cache-control': 'private, no-cache' },
      '{"n":2}',
    );

    expect(first).toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        etag: '"1"',
        'cache-control': 'private, no-cache',
      },
      body: '{"n":1}',
    });
    expect(second).toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
        etag: '"2"',
        'cache-control': 'private, no-cache',
      },
      body: '{"n":2}',
    });
    expect(first.headers).not.toBe(second.headers);

    expect([TAGGED, INVALID, INTERNAL]).toEqual(before);
    const shared = [TAGGED, TAGGED.headers, INVALID, INVALID.headers, INTERNAL, INTERNAL.headers];
    for (const constant of shared) {
      expect(Object.isFrozen(constant)).toBe(true);
    }
  });

  // WHAT THE DOCUMENT PUBLISHES IS WHAT IS SENT: a value no declaration names stays behind.
  it('sends exactly the headers its declaration names', () => {
    const values = { etag: '"1"', 'cache-control': 'private, no-cache', 'set-cookie': 'x=1' };
    const built = respond(TAGGED, values, '{}');
    expect(Object.keys(built.headers).sort()).toEqual(
      ['cache-control', 'content-type', 'etag'].sort(),
    );
    expect('cookies' in built).toBe(false);
  });

  // PAYLOAD 2.0 CARRIES COOKIES IN A LIST OF THEIR OWN, "each cookie becomes a set-cookie header",
  // so a declared one travels there — and the document still publishes the header it becomes.
  it('sends a declared set-cookie as a cookie, never as a header', () => {
    const built = respond(
      COOKIED,
      { 'set-cookie': ['a=1; Secure'], 'cache-control': 'no-store' },
      '{}',
    );
    expect(built).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      cookies: ['a=1; Secure'],
      body: '{}',
    });
    expect(Object.isFrozen(built.cookies)).toBe(true);
  });

  // RFC 6265 §3: SET-COOKIE SHOULD NOT BE FOLDED into one field, so it is the header given as a list.
  it('sends every cookie of a declared set-cookie, one apiece and in order', () => {
    const built = respond(
      COOKIED,
      { 'set-cookie': ['a=1; Secure', 'b=2; Secure'], 'cache-control': 'no-store' },
      '{}',
    );
    expect(built.cookies).toEqual(['a=1; Secure', 'b=2; Secure']);
  });

  // AN EMPTY LIST IS THE LIST'S WAY OF LEAVING THE HEADER OUT, refused like any other.
  it('refuses a declared set-cookie that carries no cookie', () => {
    const widened: Derived = COOKIED;
    // @ts-expect-error a declared set-cookie carries at least one cookie
    expect(() => respond(COOKIED, { 'set-cookie': [], 'cache-control': 'no-store' }, '{}')).toThrow(
      /set-cookie/,
    );
    expect(() => respond(widened, { 'cache-control': 'no-store' }, '{}')).toThrow(/set-cookie/);
  });

  // FROZEN as the fixed answers are: the proof and the document name an answer by its
  // declaration, so a status or a body changed afterwards would be sent under that name.
  it('cannot be changed once built', () => {
    const cache = { etag: '"1"', 'cache-control': 'private, no-cache' };
    const built = respond(TAGGED, cache, '{}');
    const empty = notModified(UNCHANGED, cache);
    expect(() => {
      built.statusCode = 304;
    }).toThrow(TypeError);
    expect(() => {
      built.headers.vary = 'accept';
    }).toThrow(TypeError);
    expect(() => Object.assign(empty, { body: '' })).toThrow(TypeError);
    expect(() => {
      empty.headers['content-type'] = 'application/json';
    }).toThrow(TypeError);
  });

  // READ BACK AS THE WIDE TYPE, a declaration does not make the compiler ask for every header,
  // and a missing one would vanish from the wire when the result is serialised.
  it('refuses to leave out a header its declaration names', () => {
    const widened: Derived = TAGGED;
    expect(() => respond(widened, {}, '{}')).toThrow(/etag/);
  });
});

describe('a 304', () => {
  // A NULL-BODY STATUS: `body: ''` is still a body, and an adapter turns it into a 500.
  it('has no body key and no content-type', () => {
    const answer = notModified(UNCHANGED, { etag: '"1"', 'cache-control': 'private, no-cache' });
    expect('body' in answer).toBe(false);
    expect('content-type' in answer.headers).toBe(false);
    expect(answer).toEqual({
      statusCode: 304,
      headers: { etag: '"1"', 'cache-control': 'private, no-cache' },
    });
  });
});

describe('every answer names its status', () => {
  // API Gateway reads JSON with no `statusCode` as a 200 whose body is the whole object.
  it('comes from every helper with an integer status code', () => {
    const answers = [
      json(418, '{"error":"teapot"}'),
      respond(TAGGED, { etag: '"1"', 'cache-control': 'private, no-cache' }, '{}'),
      notModified(UNCHANGED, { etag: '"1"', 'cache-control': 'private, no-cache' }),
    ];
    for (const answer of answers) {
      expect(Number.isInteger(answer.statusCode)).toBe(true);
    }
  });
});

describe('a declaration refuses what its response could not carry', () => {
  it.each([204, 205, 304])('refuses a body on %i, a null-body status', (statusCode) => {
    expect(() => derived({ statusCode, name: 'x', headers: [], example: {} })).toThrow(/null-body/);
  });

  // The builder sets it from whether there is a body; declared, it could put one on a 304.
  it('refuses a declared content-type', () => {
    expect(() =>
      derived({ statusCode: 200, name: 'x', headers: ['content-type'], example: {} }),
    ).toThrow(/content-type/);
    expect(() => bodiless({ name: 'x', headers: ['content-type'] })).toThrow(/content-type/);
  });

  // CHECKED WHERE IT IS USED: a literal, a spread copy and a cast all type as a declaration, and
  // each would skip both refusals above — a body on a 304 among them.
  it('is refused when used without having been made by one', () => {
    const cache = { etag: '"1"', 'cache-control': 'private, no-cache' };
    const literal: Derived<'etag'> = { statusCode: 200, name: 'x', headers: ['etag'], example: {} };
    const bodied = { ...UNCHANGED, example: {} };
    const cast = JSON.parse(JSON.stringify(TAGGED)) as typeof TAGGED;
    expect(() => respond(literal, { etag: '"1"' }, '{}')).toThrow(/made by derived/);
    expect(() => respond(bodied, cache, '{}')).toThrow(/made by derived/);
    expect(() => respond(cast, cache, '{}')).toThrow(/made by derived/);
    expect(() => notModified({ ...UNCHANGED }, cache)).toThrow(/made by derived/);
  });
});
