// @vitest-environment jsdom
// `/terms` and the ways in to it, through the real router and shells: under the signed-out card
// beside the privacy link, on the links line in the panel and the drawer, in the profile's
// «Ваші дані», and on `/apply`'s acceptance line (`design/extensions/terms-of-use.dc.html`).
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

const SECTIONS = [
  'operator',
  'service',
  'advice',
  'sources',
  'account',
  'data',
  'use',
  'availability',
  'liability',
  'termination',
  'changes',
  'law',
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

const termsLinks = (root: ParentNode) => [...root.querySelectorAll('a[href="/terms"]')];
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
    const { page } = await open('/terms');
    expect(heading(page)).toBe(t.terms.title);
    const contents = [...page.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute('href'));
    expect(contents).toEqual(SECTIONS.map((id) => `#${id}`));
    SECTIONS.forEach((id, i) => {
      const title = page.querySelector(`#${id} h3`);
      expect(title, `no section #${id}`).not.toBeNull();
      // Bare in the copy; the page numbers it.
      expect(title!.textContent).toBe(
        `${i + 1}. ${t.terms.sections[id as keyof typeof t.terms.sections].title}`,
      );
    });
  });

  it('prints the version it records as its date', async () => {
    const { page } = await open('/terms');
    expect(page.textContent).toContain(uk.terms.updated('29.10.2026'));
  });

  it('is the same page signed out, with no app shell and no data request', async () => {
    const signedIn = (await open('/terms')).page.innerHTML;
    cleanup();
    await session.signOut();
    const { page } = await open('/terms');
    expect(page.innerHTML).toBe(signedIn);
    expect(page.querySelector('#app-sidebar')).toBeNull();
    expect(api.seen).toEqual([]);
  });

  it('leads back to the app with «До Quirenote»', async () => {
    const { page, router } = await open('/terms');
    const back = [...page.querySelectorAll('a')].find((a) => a.textContent === uk.privacy.back);
    expect(back?.getAttribute('href')).toBe('/');
    expect(await follow(back!, router)).toBe('/');
  });

  it('reaches the privacy notice from its data section, inside the app', async () => {
    const { page, router } = await open('/terms');
    const [link] = [...page.querySelectorAll('#data a[href="/privacy"]')];
    expect(link).toBeDefined();
    expect(await follow(link!, router)).toBe('/privacy');
  });
});

describe('under the signed-out card', () => {
  it.each(['/sign-in', '/apply', '/privacy'])(
    '%s carries the link beside the privacy link, and it reaches the terms',
    async (path) => {
      await session.signOut();
      const { page, router } = await open(path);
      const link = termsLinks(page).find((a) => a.textContent === uk.terms.link);
      expect(link).toBeDefined();
      expect(link?.hasAttribute('aria-current')).toBe(false);
      expect(link?.parentElement?.querySelector('a[href="/privacy"]')?.textContent).toBe(
        uk.privacy.link,
      );
      expect(await follow(link!, router)).toBe('/terms');
      expect(heading(page)).toBe(uk.terms.title);
    },
  );

  // The answer holds a sign-out that may still be running, so its page stays: the terms open beside it.
  it('under an answer opens the terms in a new tab, and says so', async () => {
    showAnswer({ answer: 'pending', email: ME_EMAIL });
    const { page } = await open('/settings');
    expect(heading(page)).toBe(uk.auth.pending.title);
    const [link] = termsLinks(page);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.textContent).toBe(`${uk.terms.link} ${uk.privacy.newTab}`);
  });

  it('names the page it is on', async () => {
    const { page } = await open('/terms');
    const link = termsLinks(page).find((a) => a.textContent === uk.terms.link);
    expect(link?.getAttribute('aria-current')).toBe('page');
  });
});

describe('the links line', () => {
  it('carries the link in the panel, over the version, and it reaches the terms', async () => {
    const { page, router } = await open('/settings');
    const [link] = termsLinks(page.querySelector('#app-sidebar')!);
    expect(link?.textContent).toBe(uk.terms.link);
    expect(link?.parentElement?.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(link?.parentElement?.textContent).not.toContain('v0.0.0');
    expect(link?.parentElement?.nextElementSibling?.textContent).toBe('v0.0.0');
    expect(await follow(link!, router)).toBe('/terms');
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
    expect(termsLinks(dialog)).toHaveLength(1);
  });

  it('is not in the collapsed rail', async () => {
    const { page } = await open('/settings');
    await act(async () => void fireEvent.click(page.querySelector(`#${SIDEBAR_COLLAPSE_ID}`)!));
    expect(termsLinks(page.querySelector('#app-sidebar')!)).toHaveLength(0);
  });
});

describe('the profile’s «Ваші дані»', () => {
  it('carries a row after the privacy row that reaches the terms', async () => {
    const { page, router } = await open('/profile');
    const main = page.querySelector('main')!;
    const link = await waitFor(() => {
      const found = termsLinks(main)[0];
      expect(found).toBeDefined();
      return found!;
    });
    expect(link.textContent).toBe(uk.profile.terms.open);
    expect(main.textContent).toContain(uk.profile.terms.title);
    const privacy = main.querySelector('a[href="/privacy"]')!;
    expect(privacy.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await follow(link, router)).toBe('/terms');
  });
});

describe('/apply’s acceptance line', () => {
  it('links the terms in a new tab', async () => {
    await session.signOut();
    const { page } = await open('/apply');
    const [link] = termsLinks(page.querySelector('form')!);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.textContent?.endsWith(uk.privacy.newTab)).toBe(true);
  });
});
