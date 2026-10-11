// @vitest-environment jsdom
// The portfolio does not outlive its account on a shared browser (*Auth model*): once the relay has
// answered a sign-out, the figures held in memory, the tag a write goes under and the draft are
// gone. OWASP: "do not assume client-side storage provides confidentiality".
import { QueryClient } from '@tanstack/react-query';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DRAFT_KEY } from './storage-keys';

// Set before the draft store loads: it reads `localStorage` as it does.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
afterAll(() => vi.unstubAllGlobals());

const { forgetAccount, forgetOnAccountEnd } = await import('./account');
const { useDraft } = await import('../state/draft');

beforeEach(() => {
  kept.clear();
  useDraft.setState(useDraft.getInitialState(), true);
});

/** The queries that still hold an answer: a reset query stays in the cache, without one. */
const heldBy = (client: QueryClient) =>
  client
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.data !== undefined);

/** The part of a session that tells a listener its status changed. */
function sessionOf(status: 'unknown' | 'signedIn' | 'signedOut', unanswered = false) {
  const listeners = new Set<() => void>();
  const state = { status, unanswered, changes: 0 };
  return {
    state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    status: () => state.status,
    unanswered: () => state.unanswered,
    accountChanges: () => state.changes,
    /** A signed-in answer for another account than the one held, with no sign-out between. */
    switchAccount() {
      state.changes += 1;
      for (const listener of listeners) listener();
    },
    become(next: typeof status, unansweredNow = false) {
      state.status = next;
      state.unanswered = unansweredNow;
      for (const listener of listeners) listener();
    },
  };
}

describe('forgetting the account', () => {
  it('empties the answers, drops the tag and clears the draft with its stored keys', () => {
    const client = new QueryClient();
    client.setQueryData(['view'], { assets: [{ id: 'a' }] });
    client.setQueryData(['view', 'series', '3m'], { period: '3m' });
    client.getMutationCache().build(client, { mutationFn: async () => 'sent' });
    useDraft.getState().setDate('2026-07-27');
    useDraft.getState().setQuote('a', '12,5');
    expect(kept.get(DRAFT_KEY)).toContain('12,5');
    const forget = vi.fn();

    forgetAccount(client, { forget });

    expect(heldBy(client)).toEqual([]);
    expect(client.getMutationCache().getAll()).toEqual([]);
    expect(forget).toHaveBeenCalledTimes(1);
    expect(useDraft.getState()).toMatchObject({ date: '', quotes: {}, origins: {} });
    expect(kept.has(DRAFT_KEY)).toBe(false);
  });
});

describe('forgetting when the account ends', () => {
  it('forgets once the relay has answered that nobody is signed in', () => {
    const session = sessionOf('signedIn');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget);

    session.become('signedOut');

    expect(forget).toHaveBeenCalledTimes(1);
  });

  it('forgets nothing while someone is signed in, or before the relay has said', () => {
    const session = sessionOf('unknown');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget);

    session.become('signedIn');
    session.become('signedIn');

    expect(forget).not.toHaveBeenCalled();
  });

  it('keeps a draft when the load went unanswered: offline says nothing about the account', () => {
    const session = sessionOf('unknown');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget);

    session.become('signedOut', true);

    expect(forget).not.toHaveBeenCalled();
  });

  it('forgets again at the next sign-out, once for each, and not twice for one', () => {
    const session = sessionOf('signedIn');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget);

    session.become('signedOut');
    session.become('signedOut');
    session.become('signedIn');
    session.become('signedOut');

    expect(forget).toHaveBeenCalledTimes(2);
  });

  // A COOKIE ANOTHER TAB REPLACED: no sign-out ran here, and what the page holds is the first
  // account's.
  it('forgets when the account changed under a signed-in page, once for each change', () => {
    const session = sessionOf('signedIn');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget);

    session.switchAccount();
    session.become('signedIn');
    session.switchAccount();

    expect(forget).toHaveBeenCalledTimes(2);
  });

  it('stops when it is unsubscribed', () => {
    const session = sessionOf('signedIn');
    const forget = vi.fn();
    forgetOnAccountEnd(session, forget)();

    session.become('signedOut');

    expect(forget).not.toHaveBeenCalled();
  });
});
