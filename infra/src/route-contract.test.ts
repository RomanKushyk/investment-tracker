// A route whose body is not a literal, proved by the mechanism the live handlers use. The route
// exists only in this file, so the proof is exercised on answers built per request whatever the
// live handlers answer.
import { describe, expect, it } from 'vitest';

import {
  INVALID,
  type ApiEvent,
  type ApiResult,
  type EmptyResult,
  bodiless,
  derived,
  headerValues,
  notModified,
  respond,
} from './http';
import { answerOf, proveRouteContract, recorder } from './route-contract';

const ROUTE = 'GET /v1/count';
const COUNTED = derived({ statusCode: 200, name: 'counted', headers: ['etag'], example: { n: 1 } });
const UNCHANGED = bodiless({ name: 'not_modified', headers: ['etag'] });
const RESPONSES = { [ROUTE]: [COUNTED, UNCHANGED, INVALID] };

/** Echoes the count in its body, tagged with it, and answers 304 to a caller already holding it. */
const route = (event: ApiEvent): ApiResult | EmptyResult => {
  const n = Number(event.body);
  if (event.body === undefined || !Number.isInteger(n)) return INVALID;
  const etag = `"${n}"`;
  if (headerValues(event, 'if-none-match').includes(etag)) return notModified(UNCHANGED, { etag });
  return respond(COUNTED, { etag }, JSON.stringify({ n }));
};

const request = (body?: string, ifNoneMatch?: string): ApiEvent => ({
  routeKey: ROUTE,
  body,
  headers: ifNoneMatch === undefined ? {} : { 'if-none-match': ifNoneMatch },
});

const { observed, record } = recorder(ROUTE);
const call = (event: ApiEvent) => record(event, route(event));

describe('a route whose body is built per request', () => {
  it('answers each count with a body of its own', () => {
    expect(call(request('1'))).toMatchObject({ statusCode: 200, body: '{"n":1}' });
    expect(call(request('2'))).toMatchObject({ statusCode: 200, body: '{"n":2}' });
  });

  it('answers 304 to a caller holding the tag among several', () => {
    expect(call(request('2', '"1", "2"'))).toEqual({ statusCode: 304, headers: { etag: '"2"' } });
  });

  it('refuses a body that is not a count', () => {
    expect(call(request('x'))).toBe(INVALID);
  });
});

describe('what names an answer that has no literal', () => {
  const declared = RESPONSES[ROUTE].map(answerOf);

  it('names two bodies of one declaration as that one declared answer', () => {
    const one = answerOf(route(request('1')));
    expect(answerOf(route(request('2')))).toBe(one);
    expect(one).toBe(answerOf(COUNTED));
  });

  // A COPY FAILS CLOSED: it reads as the literal it resembles, which nothing declares.
  it('does not recognise a copy of a built answer', () => {
    const copy = { ...respond(COUNTED, { etag: '"1"' }, '{"n":1}') };
    expect(declared).not.toContain(answerOf(copy));
  });

  it('tells apart two declarations sharing a status', () => {
    const other = derived({ statusCode: 200, name: 'other', headers: ['etag'], example: {} });
    expect(declared).not.toContain(answerOf(respond(other, { etag: '"1"' }, '{}')));
  });

  // The document states a declaration's headers, so one sending others is a different answer.
  it('tells apart two declarations sharing a status and a name', () => {
    const other = derived({
      statusCode: 200,
      name: 'counted',
      headers: ['vary'],
      example: COUNTED.example,
    });
    expect(declared).not.toContain(answerOf(respond(other, { vary: 'accept' }, '{"n":1}')));
  });

  it('tells apart two declarations differing only in the example the document shows', () => {
    const other = derived({ statusCode: 200, name: 'counted', headers: ['etag'], example: {} });
    expect(declared).not.toContain(answerOf(respond(other, { etag: '"1"' }, '{"n":1}')));
  });

  // A declared list holding a copy would prove an answer no factory ever vouched for.
  it('refuses to name a declaration no factory made', () => {
    expect(() => answerOf({ ...COUNTED })).toThrow(/made by derived/);
  });
});

proveRouteContract({ declared: RESPONSES, observed, minimum: 4 });
