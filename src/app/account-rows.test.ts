import { describe, expect, it } from 'vitest';

import { accountRows } from './account-rows';

describe("the footer band's account rows", () => {
  it('are held while the session is unknown, so nothing moves when it answers', () => {
    expect(accountRows('unknown', false, false)).toBe('held');
  });

  // Offline says nothing about the cookie, so a later answer may still be signed in: the slot
  // waits for it rather than opening under a pointer.
  it('stay held after a load the relay never answered', () => {
    expect(accountRows('signedOut', false, true)).toBe('held');
  });

  it('show signed in, and stay while a sign-out that succeeded leaves the route', () => {
    expect(accountRows('signedIn', false, false)).toBe('shown');
    expect(accountRows('signedIn', true, false)).toBe('shown');
    expect(accountRows('signedOut', true, false)).toBe('shown');
  });

  it('close once the relay answers signed out', () => {
    expect(accountRows('signedOut', false, false)).toBe('closed');
  });
});
