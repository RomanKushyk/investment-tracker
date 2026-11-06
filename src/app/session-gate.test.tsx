// @vitest-environment jsdom
// A SHELL ROUTE SIGNED OUT SENDS THE VISITOR TO `/sign-in`, the entry replaced and the place carried,
// and a sign-in from there lands back on it (*Two shells, one breakpoint*). The real routes, session
// and relay against the fake API; the bot check and the sign-in calls are stubbed, as in
// `SignIn.test.tsx`, and the calls sign in through the real session.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { flushSync } from 'react-dom';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RouteObject } from 'react-router';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import type { SignInDeps, SignInOutcome } from '../auth/sign-in';
import { uk } from '../i18n/messages';
import type { BotCheckProps } from '../screens/sign-in/BotCheck';

const hold = vi.hoisted(() => ({
  props: undefined as BotCheckProps | undefined,
  password: { offerPasskey: false },
}));
vi.mock('../screens/sign-in/BotCheck', () => ({
  BotCheck: (props: BotCheckProps) => {
    hold.props = props;
    return <div data-testid="bot-check" />;
  },
}));
vi.mock('../auth/sign-in', () => ({
  signInWithAddress: async (email: string): Promise<SignInOutcome> => ({ kind: 'password', email }),
  signInWithPassword: async (
    _email: string,
    _password: string,
    _token: string,
    deps: SignInDeps,
  ): Promise<SignInOutcome> => {
    await deps.session.respond({});
    return { kind: 'signedIn', offerPasskey: hold.password.offerPasskey };
  },
  setNewPassword: vi.fn(),
}));
vi.mock('../screens/sign-in/useSelfXssWarning', () => ({ useSelfXssWarning: () => {} }));

let api: FakeApi;
/** The relay unreachable: every refresh is lost on the network. */
let unreachable = false;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (unreachable && url.includes('/auth/')) return Promise.reject(new TypeError('offline'));
  return api.fetch(input, init);
});
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('min-width'),
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);
// The session keeps the clock it finds when it is made: `skew` ages the pair it holds.
let skew = 0;
const realNow = Date.now.bind(Date);
vi.spyOn(Date, 'now').mockImplementation(() => realNow() + skew);
afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ENDED = 'Сеанс завершився. Увійдіть знову.';

/** A page load: every module afresh, so the session is unknown until the relay answers. */
async function load(host = 'http://localhost:3300/') {
  vi.resetModules();
  vi.stubGlobal('location', new URL(host));
  const { routes } = await import('../routes');
  const { session } = await import('../auth/app');
  const { Layout } = await import('./Layout');
  return { routes, session, Layout };
}

/** Every route `<Layout />` holds, as a path to open: the index as `/`, `*` as an unknown path. */
function shellPaths(routes: RouteObject[], Layout: unknown): string[] {
  const holding = (list: RouteObject[]): RouteObject | undefined => {
    for (const route of list) {
      if ((route.element as { type?: unknown } | undefined)?.type === Layout) return route;
      const found = route.children && holding(route.children);
      if (found) return found;
    }
    return undefined;
  };
  const leaves = (list: RouteObject[]): string[] =>
    list.flatMap((route) =>
      route.children
        ? leaves(route.children)
        : [route.index ? '/' : route.path === '*' ? '/no-such-page' : `/${route.path}`],
    );
  const layout = holding(routes);
  if (!layout?.children) throw new Error('no route holds the shell');
  return leaves(layout.children);
}

let observer: MutationObserver | undefined;
/** Whether the shell's sidebar was ever in the document, from before the first render. */
let sidebarSeen = false;

/** Opens `path` after `/privacy`, a page outside the shell, so Back has somewhere to go. */
function open(routes: RouteObject[], path: string) {
  sidebarSeen = false;
  observer = new MutationObserver(() => {
    if (document.getElementById('app-sidebar')) sidebarSeen = true;
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const router = createMemoryRouter(routes, {
    initialEntries: ['/privacy', path],
    initialIndex: 1,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      {/* Handed React DOM's `flushSync`, as `react-router/dom`'s provider in `main.tsx` is: without
          it a sign-out's way out commits in a transition, a frame production never renders. */}
      <RouterProvider router={router} flushSync={(commit) => void flushSync(commit)} />
    </QueryClientProvider>,
  );
  return router;
}

const here = (router: ReturnType<typeof createMemoryRouter>) => {
  const { pathname, search, hash } = router.state.location;
  return `${pathname}${search}${hash}`;
};
// The note writes its line once its live region has settled, a tenth of a second in.
const settled = () => act(() => new Promise((settle) => setTimeout(settle, 200)));

beforeEach(() => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  unreachable = false;
  skew = 0;
  hold.props = undefined;
  hold.password.offerPasskey = false;
  kept.clear();
  sessionStorage.clear();
});
afterEach(() => {
  observer?.disconnect();
  cleanup();
});

describe('a shell route opened signed out', { timeout: 60_000 }, () => {
  it('covers every route the shell holds', async () => {
    const { routes, Layout } = await load();
    expect(shellPaths(routes, Layout)).toEqual(
      expect.arrayContaining(['/', '/yield', '/settings', '/profile', '/no-such-page']),
    );
  });

  it('ends on /sign-in from each, the entry replaced and no shell painted on the way', async () => {
    const loaded = await load();
    let { routes } = loaded;
    const paths = [...shellPaths(routes, loaded.Layout), '/yield?period=1y#chart'];
    for (const path of paths) {
      ({ routes } = await load());
      api.signedIn = false;
      const router = open(routes, path);
      await waitFor(() => expect(router.state.location.pathname, path).toBe('/sign-in'));
      expect(router.state.historyAction, path).toBe('REPLACE');
      expect(sidebarSeen, `${path} painted the shell`).toBe(false);
      // Back leaves for the page before, not the shell route.
      await act(async () => void (await router.navigate(-1)));
      expect(router.state.location.pathname, path).toBe('/privacy');
      observer?.disconnect();
      cleanup();
    }
  });

  it('says nothing on /sign-in for a load that never had a session', async () => {
    const { routes } = await load();
    api.signedIn = false;
    const router = open(routes, '/yield');
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await settled();
    expect(screen.queryByText(ENDED)).toBeNull();
    expect(screen.queryByText(uk.auth.signedOut)).toBeNull();
  });

  it('paints nothing of the shell before the relay answers, then the shell signed in', async () => {
    const { routes } = await load();
    let answer: () => void = () => {};
    const held = new Promise<void>((land) => (answer = land));
    const reach = api.fetch;
    api.fetch = async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/auth/refresh'))
        await held;
      return reach(input, init);
    };
    open(routes, '/settings');
    await act(() => new Promise((settle) => setTimeout(settle, 50)));
    expect(document.getElementById('app-sidebar')).toBeNull();
    await act(async () => answer());
    await waitFor(() => expect(document.getElementById('app-sidebar')).not.toBeNull());
  });
});

describe('a session that ends while the tab is open', { timeout: 60_000 }, () => {
  it('moves the tab to /sign-in, saying the session ended, the place carried', async () => {
    const { routes, session } = await load();
    const router = open(routes, '/yield?period=1y#chart');
    await waitFor(() => expect(document.getElementById('app-sidebar')).not.toBeNull());
    // The relay refuses the next refresh: the cookie gone, as a sign-out in another tab leaves it.
    api.signedIn = false;
    skew = 3_600_000;
    await act(async () => void (await session.getIdToken()));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    expect(router.state.historyAction).toBe('REPLACE');
    await settled();
    expect(screen.queryByText(ENDED)).not.toBeNull();
  });
});

describe('a sign-in from that /sign-in', { timeout: 60_000 }, () => {
  const continueTo = new RegExp(uk.auth.signIn.continue);
  const submit = new RegExp(`^${uk.auth.password.submit}$`);

  async function signIn(router: ReturnType<typeof createMemoryRouter>) {
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    api.signedIn = false;
    fireEvent.change(await screen.findByLabelText(uk.auth.email), {
      target: { value: ME_EMAIL },
    });
    await act(async () => hold.props?.onToken('address-token'));
    await act(async () => void screen.getByRole('button', { name: continueTo }).click());
    fireEvent.change(await screen.findByLabelText(uk.auth.password.label), {
      target: { value: 'secret' },
    });
    await act(async () => hold.props?.onToken('password-token'));
    await act(async () => void screen.getByRole('button', { name: submit }).click());
  }

  it('lands on the carried path, search and hash by the password step, the entry replaced', async () => {
    const { routes } = await load();
    api.signedIn = false;
    const router = open(routes, '/yield?period=1y#chart');
    await signIn(router);
    await waitFor(() => expect(here(router)).toBe('/yield?period=1y#chart'));
    expect(router.state.historyAction).toBe('REPLACE');
    await act(async () => void (await router.navigate(-1)));
    expect(router.state.location.pathname).toBe('/privacy');
  });

  it('lands there past the passkey offer too', async () => {
    const { routes } = await load();
    api.signedIn = false;
    hold.password.offerPasskey = true;
    const router = open(routes, '/profile');
    await signIn(router);
    const later = await screen.findByRole('button', { name: uk.auth.addPasskey.later });
    await act(async () => void later.click());
    await waitFor(() => expect(here(router)).toBe('/profile'));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('no redirect', { timeout: 60_000 }, () => {
  // The shell asks once per load and once per route; a read's own retries, on a random backoff, are
  // the transport's, so the asks are counted at `restore`, not on the network.
  it('while the relay is unreachable: the shell stays, asked once until the next route', async () => {
    const { routes, session } = await load();
    const asks = vi.spyOn(session, 'restore');
    unreachable = true;
    const router = open(routes, '/yield');
    await waitFor(() => expect(document.getElementById('app-sidebar')).not.toBeNull());
    await act(() => new Promise((settle) => setTimeout(settle, 50)));
    expect(router.state.location.pathname).toBe('/yield');
    expect(asks, 'the load asked more than once').toHaveBeenCalledTimes(1);
    await act(async () => void (await router.navigate('/overview')));
    expect(asks, 'the next route did not ask once').toHaveBeenCalledTimes(2);
  });

  it('on a host with no auth environment, which has nothing to sign in to', async () => {
    const { routes } = await load('https://preview.example.com/');
    const router = open(routes, '/yield');
    await waitFor(() => expect(document.getElementById('app-sidebar')).not.toBeNull());
    await act(() => new Promise((settle) => setTimeout(settle, 50)));
    expect(router.state.location.pathname).toBe('/yield');
  });
});

describe('a sign-out', { timeout: 60_000 }, () => {
  // The rows fade in after the relay answers and render again as the reads land: the press finds
  // the button on screen then.
  async function signOut() {
    await screen.findByRole('button', { name: uk.auth.signOut });
    await settled();
    await act(async () => void screen.getByRole('button', { name: uk.auth.signOut }).click());
  }

  it('lands with its own line, not the session-ended one', async () => {
    const { routes } = await load();
    const router = open(routes, '/yield');
    await signOut();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await settled();
    expect(screen.queryByText(uk.auth.signedOut)).not.toBeNull();
    expect(screen.queryByText(ENDED)).toBeNull();
  });

  // A ROUTE CHANGE WHILE THE RELAY REVOKES moves no landing: the sign-out still lands it, once.
  it('lands with its own line when the route changes while it runs', async () => {
    const { routes } = await load();
    const router = open(routes, '/yield');
    let release: () => void = () => {};
    const held = new Promise<void>((land) => (release = land));
    const reach = api.fetch;
    api.fetch = async (input, init) => {
      if (String(input instanceof Request ? input.url : input).includes('/auth/sign-out'))
        await held;
      return reach(input, init);
    };
    await signOut();
    await act(async () => void (await router.navigate('/balances')));
    expect(router.state.location.pathname).toBe('/balances');
    const moves: string[] = [];
    router.subscribe(({ historyAction, location }) =>
      moves.push(`${historyAction} ${location.pathname} ${JSON.stringify(location.state)}`),
    );
    await act(async () => release());
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await settled();
    expect(screen.queryByText(uk.auth.signedOut)).not.toBeNull();
    // The sign-out's landing alone: no redirect of the gate's, which would carry the route.
    expect(moves.filter((move) => move.includes('"from"'))).toEqual([]);
  });

  it('opened again by Back lands on /sign-in, saying nothing', async () => {
    const { routes } = await load();
    const router = open(routes, '/yield');
    await signOut();
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await act(async () => void (await router.navigate(-1)));
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'));
    await settled();
    expect(screen.queryByText(ENDED)).toBeNull();
  });
});
