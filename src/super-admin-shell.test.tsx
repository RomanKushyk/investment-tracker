// @vitest-environment jsdom
// The shell decided by the role `GET /me` answers (`design/extensions/super-admin-shell.dc.html`):
// the super-admin's band, «Адміністрування» and no portfolio read; the nav waiting for the answer
// for every role, and a failed answer failing every route with the shell kept.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from './__fixtures__/fake-api';
import { uk } from './i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');

// The copy the drawing names (T6), written out so the test pins the words.
const GROUP_ADMIN = 'Адміністрування';
const ARCHIVE = 'Архів цін';
const SUPER_ADMIN = 'Суперадміністратор';
const SUBTITLE_ADMIN = 'Тема й мова';
const HOME_ADMIN = 'Перейти до архіву цін';

// `hold` keeps a route's answer back until the test lets it go, and `failing` answers it 500.
let api: FakeApi;
const held = new Map<string, Promise<void>>();
const releases: (() => void)[] = [];
const failing = new Set<string>();
const hit: string[] = [];
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/relay/, '');
  hit.push(path);
  await held.get(path);
  if (failing.has(path)) {
    return new Response('{"error":"internal"}', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  return api.fetch(input, init);
});
function hold(path: string): () => void {
  let release!: () => void;
  held.set(path, new Promise<void>((r) => (release = r)));
  releases.push(release);
  return () => {
    held.delete(path);
    release();
  };
}
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// Desktop unless a test says otherwise; below `md` the shell is the header bar and the drawer. A
// getter, since `useIsDesktop` keeps the first list it is handed.
let wide = true;
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') ? wide : false;
  },
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
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('./routes');
const { session } = await import('./auth/app');
const { useSettings } = await import('./state/settings');

beforeEach(async () => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: '2026-07-28' },
  );
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
  wide = true;
  useSettings.setState({ sidebarCollapsed: false });
});
afterEach(() => {
  cleanup();
  held.clear();
  // A hold a test left in place lets its request finish rather than hang past the test.
  releases.splice(0).forEach((release) => release());
  failing.clear();
  hit.length = 0;
});

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const text = (el: Element | null | undefined) => el?.textContent ?? '';
  return {
    router,
    main: () => text(view.container.querySelector('main')),
    sidebar: () => text(document.getElementById('app-sidebar')),
    header: () => text(view.container.querySelector('header')),
    drawer: () => text(document.querySelector('[role="dialog"]')),
    links: (root: Element | null) =>
      [...(root?.querySelectorAll('a[href]') ?? [])].map((a) => a.getAttribute('href')),
  };
}

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));
const PORTFOLIO_READ = /^\/(view(\/|$)|state$|imports(\/|$)|mutations$)/;
const portfolioReads = () => hit.filter((p) => PORTFOLIO_READ.test(p));

const PORTFOLIO_ROUTES = [
  '/transactions',
  '/overview',
  '/balances',
  '/payouts',
  '/yield',
  '/attributes',
  '/seasonality',
  '/portfolio',
  '/allocation',
];

describe('the super-admin shell, once GET /me answers super_admin', () => {
  beforeEach(() => {
    api.role = 'super_admin';
  });

  it('draws the band, «Адміністрування» → «Архів цін», Settings and the account in the panel', async () => {
    const page = mount('/admin/archive');
    await waitFor(() => expect(page.sidebar()).toContain(GROUP_ADMIN));
    expect(page.sidebar()).toContain(ARCHIVE);
    expect(page.sidebar()).toContain(SUPER_ADMIN);
    expect(page.sidebar()).toContain(uk.nav.settings);
    expect(page.sidebar()).toContain(ME_EMAIL);
    for (const gone of [uk.nav.groupEntry, uk.nav.groupAnalytics, uk.sidebar.totalCapital]) {
      expect(page.sidebar()).not.toContain(gone);
    }
    const links = page.links(document.getElementById('app-sidebar'));
    expect(links).toContain('/admin/archive');
    for (const route of ['/', ...PORTFOLIO_ROUTES]) expect(links).not.toContain(route);
    // No currency on its footer: the UAH/USD pair is not there.
    expect(document.getElementById('app-sidebar')!.querySelector('[aria-pressed]')).toBeNull();
  });

  it('draws the band, «Архів цін» and no currency box in the collapsed rail, and the role in its header', async () => {
    // The rail's state is the account's, so `GET /me` would undo a collapse made on the device.
    api.settings = JSON.stringify({ sidebarCollapsed: true });
    useSettings.setState({ sidebarCollapsed: true });
    const page = mount('/admin/archive');
    await waitFor(() =>
      expect(page.links(document.getElementById('app-sidebar'))).toContain('/admin/archive'),
    );
    expect(page.sidebar()).toContain(SUPER_ADMIN);
    expect(page.sidebar()).not.toContain('₴');
    const links = page.links(document.getElementById('app-sidebar'));
    for (const route of ['/', ...PORTFOLIO_ROUTES]) expect(links).not.toContain(route);
    expect(page.header()).toContain(SUPER_ADMIN);
    expect(page.header()).not.toContain(uk.sidebar.totalCapital);
  });

  it('names the role in the header bar below md, and the drawer draws the band and the group', async () => {
    wide = false;
    const page = mount('/admin/archive');
    await waitFor(() => expect(page.header()).toContain(SUPER_ADMIN));
    expect(page.header()).not.toContain(uk.sidebar.totalCapital);
    fireEvent.click(document.getElementById('app-nav-trigger')!);
    await waitFor(() => expect(page.drawer()).toContain(GROUP_ADMIN));
    expect(page.drawer()).toContain(SUPER_ADMIN);
    expect(page.drawer()).toContain(ARCHIVE);
    expect(page.drawer()).not.toContain(uk.nav.groupEntry);
    expect(page.drawer()).not.toContain(uk.nav.groupAnalytics);
  });

  it('makes no portfolio read on any route it can reach', async () => {
    const paths = [
      '/',
      ...PORTFOLIO_ROUTES,
      '/settings',
      '/admin/archive',
      '/settings/archive',
      '/profile',
      '/nope',
    ];
    for (const path of paths) {
      const page = mount(path);
      // The band is drawn from `/me`'s answer, so the window opens once the role is known.
      await waitFor(() => expect(page.sidebar()).toContain(SUPER_ADMIN));
      await settle();
      expect({ path, reads: portfolioReads() }).toEqual({ path, reads: [] });
      cleanup();
      hit.length = 0;
    }
  });

  it('lands on /admin/archive from /', async () => {
    const page = mount('/');
    await waitFor(() => expect(page.router.state.location.pathname).toBe('/admin/archive'));
  });

  it('gets the not-found on a portfolio route, whose button goes to /admin/archive', async () => {
    const page = mount('/overview');
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
    expect(page.main()).toContain(HOME_ADMIN);
    expect(page.main()).not.toContain(uk.boundary.notFound.home);
    expect(page.links(document.querySelector('main'))).toContain('/admin/archive');
  });
});

// The account row admits a third role, and every portfolio route and item is a user's alone.
describe('a role that is neither', () => {
  it('gets no nav item, the not-found on a portfolio route, and no portfolio read', async () => {
    api.role = 'demo' as FakeApi['role'];
    const page = mount('/overview');
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
    await settle();
    for (const word of [uk.nav.groupEntry, uk.nav.groupAnalytics, GROUP_ADMIN, SUPER_ADMIN]) {
      expect(page.sidebar()).not.toContain(word);
    }
    expect(portfolioReads()).toEqual([]);
  });
});

describe('a user session', () => {
  it('shows no super-admin indicator in the panel, the rail or the header', async () => {
    const page = mount('/');
    await waitFor(() => expect(page.sidebar()).toContain(uk.nav.groupEntry));
    expect(page.sidebar()).not.toContain(SUPER_ADMIN);
    expect(page.sidebar()).not.toContain(GROUP_ADMIN);
    cleanup();
    api.settings = JSON.stringify({ sidebarCollapsed: true });
    useSettings.setState({ sidebarCollapsed: true });
    const rail = mount('/');
    await waitFor(() =>
      expect(rail.links(document.getElementById('app-sidebar'))).toContain('/overview'),
    );
    expect(rail.sidebar()).not.toContain(SUPER_ADMIN);
    // The header is there, with the capital, so its lack of the role is no absence.
    await waitFor(() => expect(rail.header()).toContain(uk.sidebar.totalCapital));
    expect(rail.header()).not.toContain(SUPER_ADMIN);
  });

  it('stays on /, and its not-found still goes to Daily quotes', async () => {
    const page = mount('/');
    await waitFor(() => expect(page.sidebar()).toContain(uk.nav.groupEntry));
    expect(page.router.state.location.pathname).toBe('/');
    cleanup();
    const lost = mount('/nope');
    await waitFor(() => expect(lost.main()).toContain(uk.boundary.notFound.home));
    expect(lost.main()).not.toContain(HOME_ADMIN);
  });

  it('reads the view only once GET /me has answered user', async () => {
    const release = hold('/me');
    mount('/');
    await waitFor(() => expect(hit).toContain('/me'));
    await settle();
    expect(portfolioReads()).toEqual([]);
    await act(async () => release());
    await waitFor(() => expect(hit).toContain('/view'));
  });
});

describe('while GET /me is out, and after it fails', () => {
  it('draws no nav item and no indicator until the answer, for the super-admin', async () => {
    api.role = 'super_admin';
    const release = hold('/me');
    const page = mount('/admin/archive');
    await waitFor(() => expect(hit).toContain('/me'));
    await settle();
    for (const word of [
      GROUP_ADMIN,
      ARCHIVE,
      SUPER_ADMIN,
      uk.nav.groupEntry,
      uk.nav.groupAnalytics,
    ]) {
      expect(page.sidebar()).not.toContain(word);
    }
    expect(page.sidebar()).not.toContain(uk.sidebar.totalCapital);
    await act(async () => release());
    await waitFor(() => expect(page.sidebar()).toContain(SUPER_ADMIN));
    expect(page.sidebar()).toContain(GROUP_ADMIN);
  });

  it('draws no nav item until the answer, for a user, and no indicator after it', async () => {
    const release = hold('/me');
    const page = mount('/');
    await waitFor(() => expect(hit).toContain('/me'));
    await settle();
    expect(page.sidebar()).not.toContain(uk.nav.groupEntry);
    expect(page.sidebar()).not.toContain(SUPER_ADMIN);
    await act(async () => release());
    await waitFor(() => expect(page.sidebar()).toContain(uk.nav.groupEntry));
    expect(page.sidebar()).not.toContain(SUPER_ADMIN);
  });

  it('shows the header bar its trigger alone below md, with no indicator', async () => {
    api.role = 'super_admin';
    wide = false;
    hold('/me');
    const page = mount('/admin/archive');
    await waitFor(() => expect(hit).toContain('/me'));
    await settle();
    expect(document.getElementById('app-nav-trigger')).not.toBeNull();
    expect(page.header()).not.toContain(SUPER_ADMIN);
    expect(page.header()).not.toContain(uk.sidebar.totalCapital);
  });

  it('fails every route with the shell kept when GET /me fails', async () => {
    for (const path of ['/', '/settings', '/admin/archive']) {
      failing.add('/me');
      const page = mount(path);
      await waitFor(() => expect(page.main()).toContain(uk.boundary.failed.title));
      expect(document.getElementById('app-sidebar')).not.toBeNull();
      expect(page.sidebar()).not.toContain(uk.nav.groupEntry);
      expect(page.sidebar()).not.toContain(SUPER_ADMIN);
      cleanup();
      hit.length = 0;
    }
  });
});

describe('/settings by role', () => {
  const s = uk.settings.sections;

  it('gives the super-admin «Тема й мова» and Appearance with theme and language alone', async () => {
    api.role = 'super_admin';
    const page = mount('/settings');
    await waitFor(() => expect(page.main()).toContain(SUBTITLE_ADMIN));
    expect(page.main()).toContain(s.appearance);
    expect(page.main()).toContain(uk.settings.theme.title);
    expect(page.main()).toContain(uk.settings.language.title);
    for (const gone of [
      s.data,
      s.automation,
      uk.settings.currency.title,
      uk.screen.settings.subtitle,
    ]) {
      expect(page.main()).not.toContain(gone);
    }
    expect(page.links(document.querySelector('main'))).not.toContain('/settings/archive');
    expect(page.links(document.querySelector('main'))).not.toContain('/admin/archive');
  });

  it('gives a user its three cards, as before', async () => {
    const page = mount('/settings');
    await waitFor(() => expect(page.main()).toContain(s.appearance));
    const at = [s.data, s.automation, s.appearance].map((label) => page.main().indexOf(label));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(page.main()).toContain(uk.screen.settings.subtitle);
    expect(page.main()).toContain(uk.settings.currency.title);
    expect(page.main()).not.toContain(SUBTITLE_ADMIN);
  });
});
