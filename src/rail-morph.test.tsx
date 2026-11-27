// @vitest-environment jsdom
// The collapse and the expand morph ONE glass card (rail-and-account-foot.md § Wave 29, M2): the
// card is the same element in both states, and the contents a toggle leaves stay, inert, for their
// fade, then go, so a screen reader and the keyboard meet one state's contents only.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { RouterProvider } from './__fixtures__/router';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from './__fixtures__/fake-api';
import { NAV_TRIGGER_ID, SIDEBAR_COLLAPSE_ID, SIDEBAR_ID } from './app/nav-ids';

const SEED = buildSeedBackup('2026-07-28T12:00:00');

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// Desktop: the card is the desktop shell's.
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
  // The rail's state is the account's, so `GET /me` would undo a collapse made on the device.
  api.settings = JSON.stringify({ sidebarCollapsed: true });
  useSettings.setState({ sidebarCollapsed: true });
  await session.respond({});
});
afterEach(cleanup);

function mount() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/balances'] })} />
    </QueryClientProvider>,
  );
}

const aside = () => document.getElementById(SIDEBAR_ID)!;
const byId = (id: string) => document.querySelectorAll(`#${id}`);

describe('the collapse and the expand morph one card', () => {
  it('keeps the card, holds the leaving contents inert for their fade, then drops them', async () => {
    mount();
    await waitFor(() => expect(byId(NAV_TRIGGER_ID)).toHaveLength(1));
    const card = aside().firstElementChild!;
    // At rest one state's contents, and the first paint fades nothing.
    expect(card.children).toHaveLength(1);
    expect(card.firstElementChild!.className).not.toMatch(/\banimate-in\b/);

    fireEvent.click(byId(NAV_TRIGGER_ID)[0]!);
    expect(aside().firstElementChild, 'the expand replaced the card').toBe(card);
    expect(card.children).toHaveLength(2);
    const [rail, panel] = [...card.children];
    // `inert` hides it from the accessibility tree as well as the keyboard.
    expect(rail!.hasAttribute('inert'), 'the leaving rail can still be reached').toBe(true);
    expect(rail!.className).toMatch(/\banimate-out\b/);
    expect(panel!.hasAttribute('inert')).toBe(false);
    expect(panel!.className).toMatch(/\banimate-in\b/);
    // Each id once, so the handoff's `getElementById` finds the arriving control.
    expect(byId(SIDEBAR_COLLAPSE_ID)).toHaveLength(1);
    expect(byId(NAV_TRIGGER_ID)).toHaveLength(1);
    await waitFor(() => expect(document.activeElement?.id).toBe(SIDEBAR_COLLAPSE_ID));
    await waitFor(() => expect(card.children).toHaveLength(1), { timeout: 1000 });
    expect(card.firstElementChild, 'the panel did not stay').toBe(panel);

    fireEvent.click(byId(SIDEBAR_COLLAPSE_ID)[0]!);
    expect(aside().firstElementChild, 'the collapse replaced the card').toBe(card);
    expect(card.children).toHaveLength(2);
    expect(card.children[1], 'the leaving panel was remounted').toBe(panel);
    expect(panel!.hasAttribute('inert')).toBe(true);
    expect(panel!.className).toMatch(/\banimate-out\b/);
    await waitFor(() => expect(document.activeElement?.id).toBe(NAV_TRIGGER_ID));
    await waitFor(() => expect(card.children).toHaveLength(1), { timeout: 1000 });
    expect(card.querySelector(`#${SIDEBAR_COLLAPSE_ID}`)).toBeNull();
  });

  // A NODE MOVED IS A NODE RE-INSERTED: it loses its scroll and restarts its animations. A toggle
  // back mid-tween takes the leaving contents up where they stand.
  it('takes the leaving contents back in place when the toggle reverses mid-tween', async () => {
    mount();
    await waitFor(() => expect(byId(NAV_TRIGGER_ID)).toHaveLength(1));
    const card = aside().firstElementChild!;
    fireEvent.click(byId(NAV_TRIGGER_ID)[0]!);
    await waitFor(() => expect(byId(SIDEBAR_COLLAPSE_ID)).toHaveLength(1));
    const [rail, panel] = [...card.children];
    const moved: Node[] = [];
    const watch = new MutationObserver((records) =>
      records.forEach((r) => moved.push(...r.removedNodes)),
    );
    watch.observe(card, { childList: true });
    fireEvent.click(byId(SIDEBAR_COLLAPSE_ID)[0]!);
    await waitFor(() => expect(rail!.hasAttribute('inert')).toBe(false));
    watch.disconnect();
    expect(moved, 'a toggle back re-inserted a node').toEqual([]);
    expect([...card.children]).toEqual([rail, panel]);
    expect(panel!.hasAttribute('inert')).toBe(true);
  });
});
