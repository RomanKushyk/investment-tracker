// @vitest-environment jsdom
// The $ view converts at the rate `/view` serves and at no other (*External sources*): the headline
// cards of Overview and the sidebar's capital follow a served rate, and read «—» when the API has
// none, never a number made up (*Language, numbers, fonts*).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { viewBody } from '@quirenote/core/view/serve';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const served = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  userPrices: SEED.prices,
  archiveRows: [],
  paymentDates: [],
  today: TODAY,
  fx: undefined,
});
const f = makeFormat('uk');
const o = viewBody(served()).view.periods.all.overview;

// The API a page is served by: a new one for each test, behind the one `fetch` the page was given.
let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
vi.mock('../components/charts/YieldLines', () => ({ YieldLines: () => null }));

// Set before the route graph loads: the persisted stores read `localStorage` as they load.
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// jsdom lays nothing out and answers no media query.
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

// Loaded while the file is collected, so the import counts against no test's timeout.
const { routes } = await import('../routes');
const { useSettings } = await import('../state/settings');

beforeEach(() => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: TODAY },
  );
});
afterEach(() => {
  cleanup();
  // The currency is the store's, and outlives the test that set it.
  useSettings.setState(useSettings.getInitialState(), true);
});

async function open(currency: 'UAH' | 'USD', sidebarCollapsed = false) {
  // The rail is the account's: the view's answer overwrites the device's copy, so it holds the same.
  api.settings = JSON.stringify({ sidebarCollapsed });
  useSettings.setState({ currency, sidebarCollapsed });
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: ['/overview'] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

/** A card of the page, read off the label that heads it: its value, and its sub-line. */
function card(label: string) {
  const value = within(document.querySelector('main')!).getByText(label).nextElementSibling!;
  return { value: value.textContent, sub: value.nextElementSibling?.textContent ?? '' };
}
/** The figure the sidebar's capital strip shows, read off the caption that heads it. */
const sidebarCapital = () =>
  within(document.querySelector('aside')!).getByText(uk.sidebar.totalCapital).nextElementSibling!
    .firstElementChild!.textContent;
/** How many elements of the header bar read exactly this. The bar is mounted below 768 and while the
 *  rail is collapsed, which no other test opens; the default matcher folds the non-breaking space a
 *  figure is spelled with, so it would match none. */
const inHeaderBar = (text: string) =>
  within(document.querySelector('header')!).queryAllByText(text, { normalizer: (t) => t }).length;
/** Whether the page's subtitle names this rate, beside today's date. */
const subtitled = (rate: string) =>
  within(document.querySelector('main')!).queryByText(
    uk.screen.overview.subtitle(f.date(TODAY), rate),
  ) !== null;
const NONE = '—';

describe('the $ view with a rate served', () => {
  it('converts every headline card at it, and says which', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('USD');
    const t = uk.analytics.overview;
    const rate = f.units(40);

    expect(card(t.totalCapital)).toEqual({
      value: f.money(o.total / 40, 'USD'),
      sub: uk.analytics.prose.withRate(f.money(o.total), rate),
    });
    expect(card(t.capitalGain).value).toBe(f.signedMoney(o.net.uah / 40, 'USD'));
    expect(card(t.totalReturnNet).value).toBe(f.signedMoney(o.totalReturn.uah / 40, 'USD'));
    expect(card(t.depositedReinvested)).toEqual({
      value: f.money(o.deposited / 40, 'USD'),
      sub: uk.analytics.prose.plusReinvested(f.money(o.reinvested / 40, 'USD')),
    });
    expect(card(t.freeCash).value).toBe(f.money(o.cash / 40, 'USD'));
    expect(subtitled(rate)).toBe(true);
    await waitFor(() => expect(sidebarCapital()).toBe(f.money(o.total / 40, 'USD')));
  });

  it('converts at the rate it is served, not at a rate it holds', async () => {
    api.fx = { rate: 50, date: TODAY };
    await open('USD');
    const t = uk.analytics.overview;

    expect(card(t.totalCapital).value).toBe(f.money(o.total / 50, 'USD'));
    expect(card(t.freeCash).value).toBe(f.money(o.cash / 50, 'USD'));
    expect(subtitled(f.units(50))).toBe(true);
  });

  it('shows the rate and the dollar total beside the ₴ headline', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH');

    expect(card(uk.analytics.overview.totalCapital)).toEqual({
      value: f.money(o.total),
      sub: uk.analytics.prose.withRate(f.money(o.total / 40, 'USD'), f.units(40)),
    });
  });
});

describe('the $ view with no rate served', () => {
  it('reads «—» for every converted figure, and invents none', async () => {
    await open('USD');
    const t = uk.analytics.overview;

    expect(card(t.totalCapital).value).toBe(NONE);
    expect(card(t.capitalGain).value).toBe(NONE);
    expect(card(t.totalReturnNet).value).toBe(NONE);
    expect(card(t.depositedReinvested)).toEqual({
      value: NONE,
      sub: uk.analytics.prose.plusReinvested(NONE),
    });
    expect(card(t.freeCash).value).toBe(NONE);
    // The ₴ total beside the missing rate is the portfolio's own, and stays.
    expect(card(t.totalCapital).sub).toBe(uk.analytics.prose.withRate(f.money(o.total), NONE));
    expect(subtitled(NONE)).toBe(true);
    await waitFor(() => expect(sidebarCapital()).toBe(NONE));
  });

  it('leaves the ₴ figures as they are, and reads the dollar total «—»', async () => {
    await open('UAH');
    const t = uk.analytics.overview;

    expect(card(t.totalCapital)).toEqual({
      value: f.money(o.total),
      sub: uk.analytics.prose.withRate(NONE, NONE),
    });
    expect(card(t.freeCash).value).toBe(f.money(o.cash));
    await waitFor(() => expect(sidebarCapital()).toBe(f.moneyWhole(o.total)));
  });
});

describe('the header bar of a collapsed rail, in the ₴ view', () => {
  it('shows the dollar total at the rate it is served', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH', true);

    await waitFor(() => expect(inHeaderBar(f.money(o.total / 40, 'USD'))).toBe(1));
  });

  it('reads «—» for it when none is served, beside the ₴ total', async () => {
    await open('UAH', true);

    // The ₴ total proves the bar holds the portfolio and not its empty state, which draws a «—» of its own.
    await waitFor(() => expect(inHeaderBar(f.moneyWhole(o.total))).toBe(1));
    expect(inHeaderBar(NONE)).toBe(1);
  });
});
