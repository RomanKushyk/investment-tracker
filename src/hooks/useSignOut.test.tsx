// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider, useBlocker } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionStatus } from '../auth/session';
import { throughLogout } from '../auth/signed-out';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }),
}));

// The session as the shell sees it: a status that a sign-out turns signed out, the host's
// environment, and the logout the relay names with Google on, all read at call time.
const auth = vi.hoisted(() => {
  const hearing = new Set<() => void>();
  const self = {
    status: 'signedIn' as SessionStatus,
    environment: true,
    logout: undefined as string | undefined,
    // The relay's answer, held back while a test looks at the run; `fail` makes it a refusal.
    answer: Promise.resolve(),
    fail: false,
    running: false,
    hearing,
    tell: () => hearing.forEach((listener) => listener()),
    // The store's sign-out, which tells its subscribers when it begins and when the relay answers,
    // as `session.ts` does. Counted: a press that joined a running one shows as a second call.
    signOut: vi.fn(async (): Promise<false | object> => {
      self.running = true;
      self.tell();
      try {
        await self.answer;
        if (self.fail) return false;
        self.status = 'signedOut';
        self.tell();
        return self.logout === undefined ? {} : { logout: self.logout };
      } finally {
        self.running = false;
        self.tell();
      }
    }),
  };
  return self;
});

const hear = (listener: () => void) => {
  auth.hearing.add(listener);
  return () => void auth.hearing.delete(listener);
};

const LOGOUT = 'https://auth.test/logout?client_id=c';
const SITE = 'https://dev.quirenote.com';

vi.mock('../auth/app', () => ({
  get hasAuthEnvironment() {
    return auth.environment;
  },
  // `app.ts`'s, on the listed site, minus the carry and the `location.assign` the page never makes.
  leaveThroughLogout: (logout: string | undefined, to: '/sign-in' | '/apply') =>
    throughLogout(logout, SITE, SITE, to) !== undefined,
  session: { signOut: auth.signOut, signingOut: () => auth.running },
  useSessionStatus: () => useSyncExternalStore(hear, () => auth.status),
  useSessionSigningOut: () => useSyncExternalStore(hear, () => auth.running),
  useSessionUnanswered: () => false,
}));

const { useSignOut } = await import('./useSignOut');

let block = false;
/** What one instance of the hook last published. */
interface Seen {
  rows: string;
  leaving: boolean;
  leave: () => Promise<void>;
  blocker: ReturnType<typeof useBlocker>;
  drawn: string[];
}
const seen = {} as Seen;
// A second instance of the hook, mounted while the first's sign-out runs.
const other = {} as Seen;
// How many instances of the hook have mounted.
let mounted = 0;

function Probe({ into }: { into: Seen }) {
  // The edit screens' guard: unsaved work holds every navigation, the sign-out's too.
  const blocker = useBlocker(() => block);
  const { rows, leaving, leave } = useSignOut();
  useEffect(() => {
    mounted += 1;
  }, []);
  // Published after each commit, which `act` flushes before the test reads it.
  useEffect(() => {
    Object.assign(into, { rows, leaving, leave, blocker });
    into.drawn.push(rows);
  });
  return null;
}

function mount(at: string, into = seen) {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <p>signed out</p> },
      // A route with no account slot: the drawer closed on a route change leaves none mounted.
      { path: '/balances', element: <p>no slot</p> },
      { path: '*', element: <Probe into={into} /> },
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
  auth.logout = undefined;
  auth.answer = Promise.resolve();
  auth.fail = false;
  auth.running = false;
  auth.signOut.mockClear();
  vi.mocked(toast.error).mockClear();
  block = false;
  mounted = 0;
  for (const record of [seen, other]) {
    for (const key of Object.keys(record)) delete record[key as keyof Seen];
    record.drawn = [];
  }
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

  // The drawer: a route change closes it and the next open mounts its «Вийти» afresh, while the
  // sign-out pressed in the old one still runs. The new one is busy, joins nothing, and the one
  // failure raises one toast, after which it is the retry.
  it('shows a «Вийти» mounted mid-run busy, whose press joins nothing, and one toast on failure', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    auth.fail = true;
    const router = mount('/allocation');
    let leaving: Promise<void> = Promise.resolve();
    act(() => void (leaving = seen.leave()));
    await act(() => router.navigate('/balances'));
    await act(() => router.navigate('/allocation'));
    expect(mounted, 'the route change kept the instance').toBe(2);
    expect(seen.leaving, 'a «Вийти» mounted mid-run reads idle').toBe(true);
    act(() => void seen.leave());
    expect(auth.signOut, 'the second press joined the sign-out').toHaveBeenCalledTimes(1);
    await act(async () => {
      answer();
      await leaving;
    });
    expect(toast.error, 'one failure, one toast').toHaveBeenCalledTimes(1);
    expect(seen.leaving, 'not the retry after the failure').toBe(false);
  });

  // Two instances under one sign-out: whichever is pressed, the other is busy, and after a failure
  // either is the retry.
  it('keeps every «Вийти» busy under one sign-out, and after a failure each is the retry', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    auth.fail = true;
    mount('/allocation');
    mount('/allocation', other);
    let leaving: Promise<void> = Promise.resolve();
    act(() => void (leaving = seen.leave()));
    expect(other.leaving, 'the other control reads idle').toBe(true);
    act(() => void other.leave());
    expect(auth.signOut, 'the other press joined the sign-out').toHaveBeenCalledTimes(1);
    await act(async () => {
      answer();
      await leaving;
    });
    expect(toast.error, 'one failure, one toast').toHaveBeenCalledTimes(1);
    expect(seen.leaving).toBe(false);
    expect(other.leaving, 'the other control is not the retry').toBe(false);
    auth.answer = Promise.resolve();
    await act(() => other.leave());
    expect(auth.signOut, 'the retry began no sign-out').toHaveBeenCalledTimes(2);
  });

  // Back from Cognito's logout can restore this page from the back/forward cache, state and all.
  it("answers signed out when Back restores the page Cognito's logout left", async () => {
    auth.logout = LOGOUT;
    mount('/allocation');
    await act(() => seen.leave());
    expect(seen.rows, 'the rows closed while the page left').toBe('shown');
    act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    expect(seen.rows).toBe('entry');
  });

  // The page on its way out through Cognito's logout: «Вийти» stays busy under the pointer that
  // pressed it, whatever the store tells meanwhile, until the page has gone.
  it("keeps the signed-in rows while the page leaves through Cognito's logout", async () => {
    auth.logout = LOGOUT;
    mount('/allocation');
    await act(() => seen.leave());
    act(() => auth.tell());
    expect(seen.leaving).toBe(true);
    expect(seen.drawn, '«Увійти» stood in for the pressed «Вийти»').not.toContain('entry');
  });

  // A Stop while the logout loads leaves the page here, latched: the next route change ends it
  // (`account-way-in-and-out.dc.html`, T4), and Back to the route it set out from latches nothing.
  it("answers signed out by the next route change when Cognito's logout left the page in place", async () => {
    auth.logout = LOGOUT;
    const router = mount('/allocation');
    await act(() => seen.leave());
    expect(seen.leaving).toBe(true);
    await act(() => router.navigate('/overview'));
    expect(seen.rows, 'the latch outlived the route change').toBe('entry');
    expect(seen.leaving).toBe(false);
    await act(() => router.navigate(-1));
    expect(seen.rows, 'Back re-latched the route the sign-out set out from').toBe('entry');
    expect(seen.leaving).toBe(false);
  });

  // A route change before the relay answers comes before the page sets out, so it is not the one
  // that finds the page still here: the latch ends at the first route change after the redirect.
  it('ends the latch only by a route change after the redirect set out', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    auth.logout = LOGOUT;
    const router = mount('/allocation');
    let leaving: Promise<void> = Promise.resolve();
    act(() => void (leaving = seen.leave()));
    await act(() => router.navigate('/overview'));
    await act(async () => {
      answer();
      await leaving;
    });
    expect(seen.rows, 'the move mid-run ended the latch').toBe('shown');
    expect(seen.leaving).toBe(true);
    await act(() => router.navigate('/allocation'));
    expect(seen.rows).toBe('entry');
    expect(seen.leaving).toBe(false);
  });

  // A logout the relay names that is no URL is none: the sign-out goes its own way to `/sign-in`,
  // as where there is no logout, and nothing rejects on a page already signed out (T4).
  it('goes its own way to /sign-in when the logout the relay names is no URL', async () => {
    auth.logout = 'logout';
    const router = mount('/allocation');
    await act(() => seen.leave());
    expect(router.state.location.pathname).toBe('/sign-in');
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
