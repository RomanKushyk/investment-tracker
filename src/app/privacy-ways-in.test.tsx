// @vitest-environment jsdom
// `/privacy` and the ways in to it, through the real router and shells: under the signed-out card,
// on the links line in the panel and the drawer, and in the profile's «Ваші дані»
// (`design/extensions/privacy-notice.dc.html`).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { en, uk } from '../i18n/messages';
import { NAV_TRIGGER_ID, SIDEBAR_COLLAPSE_ID } from './nav-ids';

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// jsdom lays nothing out; the page scrolls itself to its top on arrival.
vi.stubGlobal('scrollTo', () => {});
const breakpoint = { desktop: true };
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && breakpoint.desktop;
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

const { routes } = await import('../routes');
const { session, showAnswer } = await import('../auth/app');
const { useSettings } = await import('../state/settings');
const { settingsCopy } = await import('../lib/api');

const SECTIONS = [
  'controller',
  'data',
  'purposes',
  'recipients',
  'transfers',
  'retention',
  'rights',
  'cookies',
  'changes',
];

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(() => {
  cleanup();
  breakpoint.desktop = true;
  useSettings.setState(useSettings.getInitialState(), true);
  showAnswer(undefined);
  vi.restoreAllMocks();
});

async function open(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return { page: view.container, router };
}

const privacyLinks = (root: ParentNode) => [...root.querySelectorAll('a[href="/privacy"]')];
const heading = (root: ParentNode) => root.querySelector('h2')?.textContent;

/** Follows a link and reads where it landed. */
async function follow(link: Element, router: Awaited<ReturnType<typeof open>>['router']) {
  await act(async () => void fireEvent.click(link));
  return router.state.location.pathname;
}

describe('the page', () => {
  it.each([
    ['uk', uk],
    ['en', en],
  ] as const)('reads in %s, with every section the contents list names', async (language, t) => {
    useSettings.setState({ language });
    const { page } = await open('/privacy');
    expect(heading(page)).toBe(t.privacy.title);
    const contents = [...page.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href'));
    expect(contents).toEqual(SECTIONS.map((id) => `#${id}`));
    for (const id of SECTIONS) {
      const section = page.querySelector(`#${id}`);
      expect(section, `no section #${id}`).not.toBeNull();
      expect(section!.textContent).toContain(
        t.privacy.sections[id as keyof typeof t.privacy.sections].title,
      );
    }
  });

  it('is the same page signed out, with no app shell and no data request', async () => {
    const signedIn = (await open('/privacy')).page.innerHTML;
    cleanup();
    await session.signOut();
    const { page } = await open('/privacy');
    expect(page.innerHTML).toBe(signedIn);
    expect(page.querySelector('#app-sidebar')).toBeNull();
    expect(api.seen).toEqual([]);
  });

  // A language chosen here is the account's, as in the portfolio shell; signed out, there is none.
  it.each([
    ['signed in', 'in'],
    ['signed out', 'out'],
  ] as const)('%s, a language chosen on it is sent to the account or not', async (_, state) => {
    if (state === 'out') await session.signOut();
    const starts = vi.spyOn(settingsCopy, 'start');
    const { page } = await open('/privacy');
    expect(starts.mock.calls.length > 0).toBe(state === 'in');
    const english = [...page.ownerDocument.querySelectorAll('[role="radio"]')].find(
      (radio) => radio.textContent === uk.settings.language.en,
    );
    await act(async () => void fireEvent.click(english!));
    await new Promise((resolve) => setTimeout(resolve, 700));
    const sent = api.seen.filter((r) => r.method === 'PATCH' && r.path === '/me/settings');
    expect(sent.map((r) => JSON.parse(r.body) as unknown)).toEqual(
      state === 'in' ? [{ language: 'en' }] : [],
    );
  });

  it('leads back to the app with «До Quirenote»', async () => {
    const { page, router } = await open('/privacy');
    const back = [...page.querySelectorAll('a')].find((a) => a.textContent === uk.privacy.back);
    expect(back?.getAttribute('href')).toBe('/');
    expect(await follow(back!, router)).toBe('/');
  });
});

// A route change keeps the window's scroll, and a load scrolls to its `#id` before the sections exist.
describe('arriving', () => {
  it('opens at its top from a page scrolled down, and Forward leaves the browser its place', async () => {
    const scrolled = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const { page, router } = await open('/profile');
    const link = await waitFor(() => {
      const found = privacyLinks(page.querySelector('main')!)[0];
      expect(found).toBeDefined();
      return found!;
    });
    await follow(link, router);
    expect(scrolled.mock.calls).toEqual([[{ top: 0, behavior: 'instant' }]]);
    await act(async () => void (await router.navigate(-1)));
    await act(async () => void (await router.navigate(1)));
    expect(heading(page)).toBe(uk.privacy.title);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('opens at the section its address names', async () => {
    // jsdom lays nothing out, so it has no `scrollIntoView` to spy on.
    const shown = vi.fn();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: shown,
      configurable: true,
    });
    try {
      await open('/privacy#rights');
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
    expect(shown.mock.contexts.map((section) => (section as Element).id)).toEqual(['rights']);
  });
});

describe('under the signed-out card', () => {
  it.each(['/sign-in', '/apply'])(
    '%s carries the link, and it reaches the notice',
    async (path) => {
      await session.signOut();
      const { page, router } = await open(path);
      // On `/apply` the first layer links the notice too; this is the shell's own.
      const link = privacyLinks(page).find((a) => a.textContent === uk.privacy.link);
      expect(link).toBeDefined();
      expect(link?.hasAttribute('aria-current')).toBe(false);
      expect(await follow(link!, router)).toBe('/privacy');
      expect(heading(page)).toBe(uk.privacy.title);
    },
  );

  // The answer holds a sign-out that may still be running, so its page stays: the notice opens beside it.
  it('under an answer opens the notice in a new tab, and says so', async () => {
    showAnswer({ answer: 'pending', email: ME_EMAIL });
    const { page } = await open('/settings');
    expect(heading(page)).toBe(uk.auth.pending.title);
    const [link] = privacyLinks(page);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toBe(`${uk.privacy.link} ${uk.privacy.newTab}`);
  });

  it('names the page it is on', async () => {
    const { page } = await open('/privacy');
    const [link] = privacyLinks(page);
    expect(link?.getAttribute('aria-current')).toBe('page');
  });
});

describe('the links line', () => {
  it('carries the link in the panel, and it reaches the notice', async () => {
    const { page, router } = await open('/settings');
    const [link] = privacyLinks(page.querySelector('#app-sidebar')!);
    expect(link?.textContent).toBe(uk.privacy.link);
    // The links take a line of their own over the version (`terms-of-use.dc.html` T3).
    expect(link?.parentElement?.nextElementSibling?.textContent).toBe('v0.0.0');
    expect(await follow(link!, router)).toBe('/privacy');
  });

  it('carries the link in the drawer', async () => {
    breakpoint.desktop = false;
    const { page } = await open('/settings');
    await act(async () => void fireEvent.click(page.ownerDocument.getElementById(NAV_TRIGGER_ID)!));
    const dialog = await waitFor(() => {
      const found = page.ownerDocument.querySelector('[role="dialog"]');
      expect(found).not.toBeNull();
      return found!;
    });
    expect(privacyLinks(dialog)).toHaveLength(1);
  });

  it('is not in the collapsed rail', async () => {
    const { page } = await open('/settings');
    await act(async () => void fireEvent.click(page.querySelector(`#${SIDEBAR_COLLAPSE_ID}`)!));
    expect(privacyLinks(page.querySelector('#app-sidebar')!)).toHaveLength(0);
  });
});

describe('the profile’s «Ваші дані»', () => {
  it('carries a row that reaches the notice', async () => {
    const { page, router } = await open('/profile');
    const link = await waitFor(() => {
      const found = privacyLinks(page.querySelector('main')!)[0];
      expect(found).toBeDefined();
      return found!;
    });
    expect(link.textContent).toBe(uk.profile.privacy.open);
    expect(page.querySelector('main')!.textContent).toContain(uk.profile.privacy.title);
    expect(await follow(link, router)).toBe('/privacy');
  });
});
