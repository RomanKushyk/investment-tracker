import { describe, expect, it } from 'vitest';

import {
  RETURN_TO,
  arrivedEnded,
  carriedFrom,
  carryReturn,
  forgetReturn,
  returnTarget,
  returnedTarget,
  sentToSignIn,
} from './return-to';

const ORIGIN = 'https://quirenote.test';

/** Session storage as the tab has it, and one the browser refuses. */
function tab() {
  const kept = new Map<string, string>();
  return {
    kept,
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  };
}
const refusing = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('the return target', () => {
  // OWASP: a local return URL is accepted only through a helper that rejects non-local destinations.
  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['an absolute URL', 'https://evil.example/'],
    ['a backslash the URL parser reads as a slash', '/\\evil'],
    // With a path, which a check of the path alone would keep.
    ['a protocol-relative URL with a path', '//evil.example/yield'],
    ['a backslash URL with a path', '/\\evil.example/yield'],
    ['a script URL', 'javascript:alert(1)'],
    ['a relative path', 'yield'],
    ['an empty string', ''],
    ['the sign-in page', '/sign-in'],
    ['the sign-in page with a query', '/sign-in?x=1'],
    ['the sign-in page with a trailing slash', '/sign-in/'],
    // The router matches a path in any case and decoded: so does the check.
    ['the sign-in page in another case', '/Sign-In'],
    ['the sign-in page percent-encoded', '/sign%2Din'],
    ['a path that does not decode', '/%E0%A4%A'],
    ['the application', '/apply'],
    ['the Google callback', '/auth/callback?code=c&state=s'],
    ['no string at all', { pathname: '/yield' }],
    ['nothing', undefined],
  ])('lands %s on `/`', (_, value) => {
    expect(returnTarget(value, ORIGIN)).toBe('/');
  });

  it('keeps an app path whole: its pathname, search and hash', () => {
    expect(returnTarget('/yield?period=1y#chart', ORIGIN)).toBe('/yield?period=1y#chart');
    expect(returnTarget('/', ORIGIN)).toBe('/');
    expect(returnTarget('/admin/users', ORIGIN)).toBe('/admin/users');
  });

  it('keeps a path nothing in the app matches, which the shell answers as not found', () => {
    expect(returnTarget('/no-such-page', ORIGIN)).toBe('/no-such-page');
  });
});

describe('the router state a shell route hands `/sign-in`', () => {
  it('carries the place, and says whether the session ended', () => {
    const cold = sentToSignIn('/yield?period=1y#chart', false);
    expect(carriedFrom(cold)).toBe('/yield?period=1y#chart');
    expect(arrivedEnded(cold)).toBe(false);
    const ended = sentToSignIn('/profile', true);
    expect(carriedFrom(ended)).toBe('/profile');
    expect(arrivedEnded(ended)).toBe(true);
  });

  it('reads nothing from a state it did not write', () => {
    for (const state of [null, undefined, 'x', { from: 1 }, { ended: 'yes' }]) {
      expect(carriedFrom(state)).toBeUndefined();
      expect(arrivedEnded(state)).toBe(false);
    }
  });
});

// GOOGLE'S ROUND TRIP LEAVES THE APP: the place crosses Cognito in this tab's storage, as the
// signed-out line does, and is read back through the same check.
describe('the place across Google', () => {
  it('is carried, read back and forgotten', () => {
    const storage = tab();
    carryReturn(storage, '/yield?period=1y#chart');
    expect(storage.kept.get(RETURN_TO)).toBe('/yield?period=1y#chart');
    expect(returnedTarget(storage, ORIGIN)).toBe('/yield?period=1y#chart');
    forgetReturn(storage);
    expect(returnedTarget(storage, ORIGIN)).toBe('/');
  });

  it('carries nothing for `/`, and forgets an older place', () => {
    const storage = tab();
    carryReturn(storage, '/profile');
    carryReturn(storage, '/');
    expect(storage.kept.has(RETURN_TO)).toBe(false);
  });

  it('checks what it reads back, which anything on the origin could have written', () => {
    const storage = tab();
    storage.setItem(RETURN_TO, '//evil.example');
    expect(returnedTarget(storage, ORIGIN)).toBe('/');
  });

  it('lands on `/` where the browser refuses storage', () => {
    expect(() => carryReturn(refusing, '/yield')).not.toThrow();
    expect(returnedTarget(refusing, ORIGIN)).toBe('/');
    expect(() => forgetReturn(refusing)).not.toThrow();
    expect(returnedTarget(undefined, ORIGIN)).toBe('/');
  });
});
