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
import { en, uk } from '../i18n/messages';

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

async function open(
  currency: 'UAH' | 'USD',
  sidebarCollapsed = false,
  language: 'uk' | 'en' = 'uk',
) {
  // The rail and the language are the account's: the view's answer overwrites the device's copy, so
  // it holds the same.
  api.settings = JSON.stringify({ sidebarCollapsed, language });
  useSettings.setState({ currency, sidebarCollapsed, language });
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

/** A card of the page, read off the label that heads it: its value, its sub-line, and the paint of
 *  the value. */
function card(label: string) {
  const value = within(document.querySelector('main')!).getByText(label).nextElementSibling!;
  return {
    value: value.textContent,
    sub: value.nextElementSibling?.textContent ?? '',
    valuePaint: value.className,
  };
}
/** The Total-capital card's sub-line: the figure in the other currency, then the rate line under
 *  it. `dict` is the language the page is in. */
function capitalSub(dict: typeof uk | typeof en = uk) {
  const value = within(document.querySelector('main')!).getByText(
    dict.analytics.overview.totalCapital,
  ).nextElementSibling!;
  const sub = value.nextElementSibling!;
  return {
    figure: sub.firstChild?.textContent,
    figurePaint: sub.className,
    line: sub.lastElementChild as HTMLElement,
  };
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
/** The page's subtitle, which carries the date and no rate. */
const subtitle = () =>
  within(document.querySelector('main')!).getByText(/Портфель одним поглядом/).textContent;
const NONE = '—';
// The line under the card keeps «НБУ» with its figure and «на» with its date: no-break spaces.
const NB = String.fromCharCode(0xa0);
const NBU_PAGE = { uk: 'https://bank.gov.ua/ua/open-data', en: 'https://bank.gov.ua/en/open-data' };

describe('the $ view with a rate served', () => {
  it('converts every headline card at it', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('USD');
    const t = uk.analytics.overview;

    const capital = capitalSub();
    expect(card(t.totalCapital).value).toBe(f.money(o.total / 40, 'USD'));
    expect(capital.figure).toBe(f.money(o.total));
    expect(card(t.capitalGain).value).toBe(f.signedMoney(o.net.uah / 40, 'USD'));
    expect(card(t.totalReturnNet).value).toBe(f.signedMoney(o.totalReturn.uah / 40, 'USD'));
    expect(card(t.depositedReinvested)).toMatchObject({
      value: f.money(o.deposited / 40, 'USD'),
      sub: uk.analytics.prose.plusReinvested(f.money(o.reinvested / 40, 'USD')),
    });
    expect(card(t.freeCash).value).toBe(f.money(o.cash / 40, 'USD'));
    await waitFor(() => expect(sidebarCapital()).toBe(f.money(o.total / 40, 'USD')));
  });

  it('converts at the rate it is served, not at a rate it holds', async () => {
    api.fx = { rate: 50, date: TODAY };
    await open('USD');
    const t = uk.analytics.overview;

    expect(card(t.totalCapital).value).toBe(f.money(o.total / 50, 'USD'));
    expect(card(t.freeCash).value).toBe(f.money(o.cash / 50, 'USD'));
    expect(capitalSub().line.textContent).toBe(`НБУ${NB}50 на${NB}28.07.2026`);
  });

  it('shows the dollar total beside the ₴ headline, in the card’s green', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH');

    const capital = capitalSub();
    expect(card(uk.analytics.overview.totalCapital).value).toBe(f.money(o.total));
    expect(capital.figure).toBe(f.money(o.total / 40, 'USD'));
    expect(capital.figurePaint).toContain('text-pos');
  });
});

describe('the rate line under the Total-capital card', () => {
  it('names the rate with the day it is NBU’s for, and links NBU’s open data', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH');

    const { line } = capitalSub();
    expect(line.textContent).toBe(`НБУ${NB}40 на${NB}28.07.2026`);
    expect(line.className).toContain('text-muted');
    const link = within(line).getByRole('link', { name: 'НБУ, відкриті дані' });
    expect(link.textContent).toBe('НБУ');
    expect(link.getAttribute('href')).toBe(NBU_PAGE.uk);
  });

  it('opens in the same tab, with no icon, underlined, and is reached by keyboard', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH');

    const link = within(capitalSub().line).getByRole('link');
    expect(link.hasAttribute('target')).toBe(false);
    expect(link.querySelector('svg')).toBeNull();
    expect(link.className).toContain('underline');
    expect(link.hasAttribute('tabindex')).toBe(false);
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('dates a rate from an earlier day with that day, in the same words', async () => {
    api.fx = { rate: 41.317, date: '2026-07-26' };
    await open('USD');

    expect(capitalSub().line.textContent).toBe(`НБУ${NB}41,317 на${NB}26.07.2026`);
  });

  it('reads the same in English, and links the English page', async () => {
    api.fx = { rate: 40.5, date: '2026-07-26' };
    await open('UAH', false, 'en');

    const { line } = capitalSub(en);
    expect(line.textContent).toBe(`NBU${NB}40.5 for${NB}26${NB}Jul${NB}2026`);
    const link = within(line).getByRole('link', { name: 'NBU, open data' });
    expect(link.textContent).toBe('NBU');
    expect(link.getAttribute('href')).toBe(NBU_PAGE.en);
  });

  it('is the one place the rate shows: the subtitle carries the date alone', async () => {
    api.fx = { rate: 40, date: TODAY };
    await open('UAH');

    expect(subtitle()).toMatch(/ · 28\.07\.2026$/);
    expect(subtitle()).not.toMatch(/курс|₴\/\$/);
    const main = document.querySelector('main')!;
    expect(within(main).getAllByRole('link', { name: 'НБУ, відкриті дані' })).toHaveLength(1);
    expect(document.querySelector('aside a[href^="https://bank.gov.ua"]')).toBeNull();
  });
});

describe('the $ view with no rate served', () => {
  it('reads «—» for every converted figure, and invents none', async () => {
    await open('USD');
    const t = uk.analytics.overview;

    expect(card(t.totalCapital).value).toBe(NONE);
    expect(card(t.capitalGain).value).toBe(NONE);
    expect(card(t.totalReturnNet).value).toBe(NONE);
    // The reinvested amount is a figure too, and a «—» beside «+ … реінвестовано» reads as a sum.
    expect(card(t.depositedReinvested)).toMatchObject({ value: NONE, sub: NONE });
    expect(card(t.freeCash).value).toBe(NONE);
    // The ₴ total beside the missing rate is the portfolio's own, and stays.
    expect(capitalSub().figure).toBe(f.money(o.total));
    expect(subtitle()).not.toMatch(/курс|₴\/\$/);
    await waitFor(() => expect(sidebarCapital()).toBe(NONE));
  });

  it('paints each «—» muted, since a dash has no sign to paint', async () => {
    await open('USD');
    const t = uk.analytics.overview;

    for (const label of [
      t.totalCapital,
      t.capitalGain,
      t.totalReturnNet,
      t.depositedReinvested,
      t.freeCash,
    ]) {
      const { valuePaint } = card(label);
      expect(valuePaint, label).toContain('text-muted');
      expect(valuePaint, label).not.toMatch(/text-(pos|neg)/);
    }
    // The ₴ total under the dash is the portfolio's own, and keeps the card's green.
    expect(capitalSub().figurePaint).toContain('text-pos');
  });

  it('says so under the card, and keeps «НБУ» linked', async () => {
    await open('USD');

    const { line } = capitalSub();
    expect(line.textContent).toBe('НБУ — курс недоступний');
    expect(line.className).toContain('text-muted');
    expect(
      within(line).getByRole('link', { name: 'НБУ, відкриті дані' }).getAttribute('href'),
    ).toBe(NBU_PAGE.uk);
  });

  it('leaves the ₴ figures as they are, and reads the dollar total «—» in muted', async () => {
    await open('UAH');
    const t = uk.analytics.overview;

    const capital = capitalSub();
    expect(card(t.totalCapital).value).toBe(f.money(o.total));
    expect(card(t.totalCapital).valuePaint).not.toContain('text-muted');
    expect(capital.figure).toBe(NONE);
    expect(capital.figurePaint).toContain('text-muted');
    expect(capital.figurePaint).not.toContain('text-pos');
    expect(capital.line.textContent).toBe('НБУ — курс недоступний');
    expect(card(t.freeCash).value).toBe(f.money(o.cash));
    await waitFor(() => expect(sidebarCapital()).toBe(f.moneyWhole(o.total)));
  });

  it('says it in English, and links the English page', async () => {
    await open('UAH', false, 'en');

    const { line } = capitalSub(en);
    expect(line.textContent).toBe('NBU rate unavailable');
    const link = within(line).getByRole('link', { name: 'NBU, open data' });
    expect(link.getAttribute('href')).toBe(NBU_PAGE.en);
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
