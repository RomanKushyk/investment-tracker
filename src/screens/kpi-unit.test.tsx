// @vitest-environment jsdom
// K2 (`type.md`, The KPI figure): a kpi or display figure sets its unit apart, at 70 % in `muted`
// at 500, .18em from the digits, which keep the sign colour. Tables and the sidebar's one-line
// capital keep one string.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeFormat } from '@quirenote/core/money';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { viewBody } from '@quirenote/core/view/serve';
import { RouterProvider } from '../__fixtures__/router';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { Amount } from '../components/ui/Amount';
import { uk } from '../i18n/messages';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const NBSP = ' ';
const f = makeFormat('uk');
const o = viewBody({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  userPrices: SEED.prices,
  archiveRows: [],
  paymentDates: [],
  today: TODAY,
  fx: undefined,
}).view.periods.all.overview;

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
vi.mock('../components/charts/YieldLines', () => ({ YieldLines: () => null }));

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
// A getter: `useIsDesktop` keeps the first MediaQueryList it is handed.
let wide = true;
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && wide;
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

beforeEach(() => {
  wide = true;
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: TODAY },
  );
});
afterEach(cleanup);

async function mount(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

const UNIT = '.text-unit';
const main = () => document.querySelector('main')!;

/** A KPI card's value: the element after the label that names it, inside `main`. */
async function valueOf(label: string) {
  let el: Element | null = null;
  await waitFor(() => {
    el =
      [...main().querySelectorAll('div')].find((d) => d.textContent === label)
        ?.nextElementSibling ?? null;
    expect(el).not.toBeNull();
  });
  return el as unknown as Element;
}

/** One unit element holding the NBSP and the ₴, the digits outside it. */
function expectK2(value: Element, text: string) {
  expect(value.textContent).toBe(text);
  const units = value.querySelectorAll(UNIT);
  expect(units).toHaveLength(1);
  const [unit] = units;
  expect(unit.textContent).toBe(`${NBSP}₴`);
  expect(unit.className).toContain('text-muted');
  expect(unit.className).toContain('[word-spacing:-.02em]');
  expect(text.endsWith(unit.textContent!)).toBe(true);
}

describe('K2 on the figures drawn today', () => {
  it('every money KPI on /overview sets its ₴ apart, the text unchanged', async () => {
    await mount('/overview');
    const ov = uk.analytics.overview;
    expectK2(await valueOf(ov.totalCapital), f.money(o.total));
    expectK2(await valueOf(ov.capitalGain), f.signedMoney(o.net.uah));
    expectK2(await valueOf(ov.totalReturnNet), f.signedMoney(o.totalReturn.uah));
    expectK2(await valueOf(ov.depositedReinvested), f.moneyWhole(o.deposited));
    expectK2(await valueOf(ov.freeCash), f.money(o.cash));
    expectK2(await valueOf(ov.incomeReceived), f.money(o.income.total));
  });

  it('the two money KPIs on /payouts set their ₴ apart, and its table keeps one string', async () => {
    await mount('/payouts');
    expectK2(await valueOf(uk.analytics.receivedTotal), f.money(o.income.total));
    expectK2(await valueOf(uk.analytics.reinvested), f.money(o.reinvested));
    await waitFor(() => expect(main().querySelector('table')).not.toBeNull());
    expect(main().querySelector(`table ${UNIT}`)).toBeNull();
  });

  it('/portfolio’s table keeps one string', async () => {
    await mount('/portfolio');
    await waitFor(() => expect(main().querySelector('table td')).not.toBeNull());
    expect(main().querySelector(`table ${UNIT}`)).toBeNull();
  });

  it('the sidebar capital keeps one string, at a 600 role', async () => {
    await mount('/overview');
    const label = [...document.querySelectorAll('div')].find(
      (d) => d.textContent === uk.sidebar.totalCapital && !main().contains(d),
    )!;
    const value = label.nextElementSibling!.firstElementChild!;
    // The sidebar mounts before the view answers, so its figure tweens up from 0.
    await waitFor(() => expect(value.textContent).toBe(f.moneyWhole(o.total)), { timeout: 5000 });
    expect(value.querySelector(UNIT)).toBeNull();
    expect(value.className).toContain('text-h3');
  });

  it('the header capital, below md, sets its ₴ apart at a 600 role', async () => {
    wide = false;
    await mount('/overview');
    let value: Element | undefined;
    await waitFor(
      () => {
        value = document.querySelector('header .text-display-header') ?? undefined;
        expect(value?.textContent).toBe(f.moneyWhole(o.total));
      },
      { timeout: 5000 },
    );
    expectK2(value!, f.moneyWhole(o.total));
  });

  it('the /overview capital is at a 600 role', async () => {
    await mount('/overview');
    expect((await valueOf(uk.analytics.overview.totalCapital)).className).toContain('text-title');
  });
});

describe('Amount, the parts drawn', () => {
  it('a unit that leads the digits (en) sits .18em before them, with no space', () => {
    const { container } = render(
      <Amount parts={makeFormat('en').signedMoneyParts(-4452.61, 'USD')} />,
    );
    expect(container.textContent).toBe(makeFormat('en').signedMoney(-4452.61, 'USD'));
    const unit = container.querySelector(UNIT)!;
    expect(unit.textContent).toBe('$');
    expect(unit.className).toContain('me-[.18em]');
    expect(unit.className).not.toContain('word-spacing');
  });

  it('a «—» draws no unit', () => {
    const { container } = render(<Amount parts={f.moneyParts(NaN)} />);
    expect(container.textContent).toBe('—');
    expect(container.querySelector(UNIT)).toBeNull();
  });
});
