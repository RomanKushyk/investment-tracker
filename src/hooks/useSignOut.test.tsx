// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider, useBlocker } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionStatus } from '../auth/session';

// The session as the shell sees it: a status that a sign-out turns signed out, the host's
// environment, and whether Cognito's logout takes the page away, all read at call time.
const auth = vi.hoisted(() => {
  const hearing = new Set<() => void>();
  return {
    status: 'signedIn' as SessionStatus,
    environment: true,
    google: false,
    // The relay's answer, held back while a test looks at the run.
    answer: Promise.resolve(),
    hearing,
    tell: () => hearing.forEach((listener) => listener()),
  };
});

vi.mock('../auth/app', () => ({
  get hasAuthEnvironment() {
    return auth.environment;
  },
  leaveThroughLogout: () => auth.google,
  session: {
    signOut: async () => {
      await auth.answer;
      auth.status = 'signedOut';
      auth.tell();
      return {};
    },
  },
  useSessionStatus: () =>
    useSyncExternalStore(
      (listener) => {
        auth.hearing.add(listener);
        return () => void auth.hearing.delete(listener);
      },
      () => auth.status,
    ),
  useSessionUnanswered: () => false,
}));

const { useSignOut } = await import('./useSignOut');

let block = false;
const seen = {} as {
  rows: string;
  leaving: boolean;
  leave: () => Promise<void>;
  blocker: ReturnType<typeof useBlocker>;
  drawn: string[];
};

function Probe() {
  // The edit screens' guard: unsaved work holds every navigation, the sign-out's too.
  const blocker = useBlocker(() => block);
  const { rows, leaving, leave } = useSignOut();
  // Published after each commit, which `act` flushes before the test reads it.
  useEffect(() => {
    Object.assign(seen, { rows, leaving, leave, blocker });
    seen.drawn.push(rows);
  });
  return null;
}

function mount(at: string) {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <p>signed out</p> },
      { path: '*', element: <Probe /> },
    ],
    { initialEntries: [at] },
  );
  // `react-router/dom`'s provider, as `main.tsx` mounts it, is this one handed React DOM's
  // `flushSync`; without it the way out commits in a transition, after the hook has moved on.
  render(<RouterProvider router={router} flushSync={(commit) => void flushSync(commit)} />);
  return router;
}

beforeEach(() => {
  auth.status = 'signedIn';
  auth.environment = true;
  auth.google = false;
  auth.answer = Promise.resolve();
  block = false;
  for (const key of Object.keys(seen)) delete seen[key as keyof typeof seen];
  seen.drawn = [];
});
afterEach(cleanup);

describe("the shell's account slot", () => {
  // «Увійти» never takes the place of the «Вийти» that was pressed while the page leaves.
  // OUTSIDE `act`: inside it, an update queued before a timer waits for the scope's next flush, so
  // a frame a browser paints between the answer and the way out is never drawn here.
  it('keeps the signed-in rows until the page leaves for /sign-in', async () => {
    const router = mount('/allocation');
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
    scope.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      await seen.leave();
      await new Promise((settle) => setTimeout(settle, 50));
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(seen.drawn, '«Увійти» stood in for the pressed «Вийти»').not.toContain('entry');
  });

  // Unsaved work can hold the way out, and the screen that holds it can unmount and drop it: the
  // page stays, signed out, so the slot says so rather than a dead «Вийти» under "Signed in".
  it('answers signed out on the same route when unsaved work holds the way out', async () => {
    mount('/allocation');
    block = true;
    await act(() => seen.leave());
    expect(seen.blocker.state, 'the sign-out was not held').toBe('blocked');
    expect(seen.rows).toBe('entry');
  });

  it('stays signed out on a return to the route the sign-out was pressed on', async () => {
    const router = mount('/allocation');
    block = true;
    await act(() => seen.leave());
    act(() => seen.blocker.reset?.());
    block = false;
    await act(() => router.navigate('/overview'));
    await act(() => router.navigate('/allocation'));
    expect(seen.rows).toBe('entry');
  });

  // Busy while it runs, whatever route the user moves to meanwhile: a second press would join
  // the same sign-out and raise a second toast if it failed.
  it('stays busy across a route change until the relay answers', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    const router = mount('/allocation');
    let leaving: Promise<void> = Promise.resolve();
    act(() => void (leaving = seen.leave()));
    expect(seen.leaving).toBe(true);
    await act(() => router.navigate('/overview'));
    expect(router.state.location.pathname).toBe('/overview');
    expect(seen.leaving, 'busy lapsed on a route change mid-run').toBe(true);
    await act(async () => {
      answer();
      await leaving;
    });
  });

  // Back from Cognito's logout can restore this page from the back/forward cache, state and all.
  it("answers signed out when Back restores the page Cognito's logout left", async () => {
    auth.google = true;
    mount('/allocation');
    await act(() => seen.leave());
    expect(seen.rows, 'the rows closed while the page left').toBe('shown');
    act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(seen.rows).toBe('entry');
  });

  it('answers signed out with the entry where the host has an auth environment', () => {
    auth.status = 'signedOut';
    mount('/');
    expect(seen.rows).toBe('entry');
  });

  it('shows no entry on a host with no auth environment', () => {
    auth.status = 'signedOut';
    auth.environment = false;
    mount('/');
    expect(seen.rows).toBe('closed');
  });
});
