import { describe, expect, it } from 'vitest';

import { accountRows } from './account-rows';

describe("the footer band's account rows", () => {
  it('are held while the session is unknown, so nothing moves when it answers', () => {
    expect(accountRows('unknown', false, false, true)).toBe('held');
  });

  // Offline says nothing about the cookie, so a later answer may still be signed in: the slot
  // waits for it rather than opening under a pointer.
  it('stay held after a load the relay never answered', () => {
    expect(accountRows('signedOut', false, true, true)).toBe('held');
  });

  it('show signed in, and stay while a sign-out that succeeded leaves the route', () => {
    expect(accountRows('signedIn', false, false, true)).toBe('shown');
    expect(accountRows('signedIn', true, false, true)).toBe('shown');
    expect(accountRows('signedOut', true, false, true)).toBe('shown');
  });

  // The slot keeps its signed-in shape (`sign-in-entry.dc.html`, T4): the status and «Увійти»
  // fade into it, so Settings stands where it stood while the session was unknown.
  it('offer the entry once the relay answers signed out', () => {
    expect(accountRows('signedOut', false, false, true)).toBe('entry');
  });

  // Known without asking, so the slot is never held and nothing moves there either.
  it('close from the first render on a host with no auth environment', () => {
    expect(accountRows('unknown', false, false, false)).toBe('closed');
    expect(accountRows('signedOut', false, false, false)).toBe('closed');
  });
});
