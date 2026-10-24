// @vitest-environment jsdom
// The ways in to the profile, through the real router and shell: the panel's address, the rail's
// item and the drawer's copy of the panel (`design/extensions/own-account.dc.html`, T5).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';
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
const { session } = await import('../auth/app');
const { useSettings } = await import('../state/settings');

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(() => {
  cleanup();
  breakpoint.desktop = true;
  useSettings.setState(useSettings.getInitialState(), true);
});

async function open(path: string) {
  const client = new QueryClient();
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return view.container;
}

const profileLinks = (root: ParentNode) => [...root.querySelectorAll('a[href="/profile"]')];
const settingsLink = (root: ParentNode) => root.querySelector('a[href="/settings"]')!;

describe('the panel’s address', () => {
  it('is the link to the profile, named for it, and keeps the whole address in its title', async () => {
    const page = await open('/settings');
    const [link] = profileLinks(page.querySelector('#app-sidebar')!);
    expect(link?.getAttribute('aria-label')).toBe(uk.auth.profileLink(ME_EMAIL));
    expect(link?.getAttribute('title')).toBe(ME_EMAIL);
    expect(link?.hasAttribute('aria-current')).toBe(false);
  });

  it('reads as current on the profile, where Settings does not', async () => {
    const sidebar = (await open('/profile')).querySelector('#app-sidebar')!;
    expect(profileLinks(sidebar)[0]?.getAttribute('aria-current')).toBe('page');
    expect(settingsLink(sidebar).hasAttribute('aria-current')).toBe(false);
  });

  it('is no link while nobody is signed in', async () => {
    await session.signOut();
    const sidebar = (await open('/settings')).querySelector('#app-sidebar')!;
    expect(profileLinks(sidebar)).toHaveLength(0);
    expect(sidebar.textContent).toContain(uk.auth.notSignedIn);
  });
});

describe('the rail', () => {
  async function rail(path: string) {
    const page = await open(path);
    await act(async () => void fireEvent.click(page.querySelector(`#${SIDEBAR_COLLAPSE_ID}`)!));
    return page.querySelector('#app-sidebar')!;
  }

  it('gains the profile between Settings and the sign-out, named by the address', async () => {
    const sidebar = await rail('/profile');
    const [item] = profileLinks(sidebar);
    expect(item?.getAttribute('aria-label')).toBe(uk.auth.profileLink(ME_EMAIL));
    expect(item?.getAttribute('aria-current')).toBe('page');
    const order = [
      settingsLink(sidebar),
      item!,
      sidebar.querySelector(`[aria-label="${uk.auth.signOut}"]`)!,
    ];
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it('signed out, holds the glyph alone, with no link', async () => {
    await session.signOut();
    const sidebar = await rail('/settings');
    expect(profileLinks(sidebar)).toHaveLength(0);
    const slot = sidebar.querySelector('[data-rail-profile]');
    expect(slot).not.toBeNull();
    expect(slot!.querySelector('a, button')).toBeNull();
    expect(slot!.querySelector('svg')).not.toBeNull();
  });
});

describe('the drawer', () => {
  it('carries the panel’s link', async () => {
    breakpoint.desktop = false;
    const page = await open('/settings');
    await act(async () => void fireEvent.click(page.ownerDocument.getElementById(NAV_TRIGGER_ID)!));
    const dialog = await waitFor(() => {
      const found = page.ownerDocument.querySelector('[role="dialog"]');
      expect(found).not.toBeNull();
      return found!;
    });
    const [link] = profileLinks(dialog);
    expect(link?.getAttribute('aria-label')).toBe(uk.auth.profileLink(ME_EMAIL));
  });
});
