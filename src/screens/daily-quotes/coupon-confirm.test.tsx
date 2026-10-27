// @vitest-environment jsdom
// Recording a due coupon from its card (*Cloud target*): the payout, the reinvest that makes it count
// as reinvested and the roll of the asset's pointer are one request, so they land whole or not at
// all. The card is driven through the real route and client, over a fake of the user API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Op } from '@quirenote/core/ops';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, type FakeApi } from '../../__fixtures__/fake-api';
import { uk } from '../../i18n/messages';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

const SEED = buildSeedBackup('2026-07-28T12:00:00');
// The day after the seed's bond falls due on 25.08.2026.
const TODAY = '2026-08-26';
const BOND = '5eed0000-0000-4000-8000-000000000003';
const DUE = '2026-08-25';

// The API a page is served by: a new one for each test, behind the one `fetch` the page was given.
let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
vi.mock('../../components/charts/YieldLines', () => ({ YieldLines: () => null }));

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
const { routes } = await import('../../routes');
const { toast } = await import('sonner');
const { useDraft } = await import('../../state/draft');

beforeEach(() => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: TODAY },
  );
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => {
  cleanup();
  useDraft.setState(useDraft.getInitialState(), true);
});

async function open(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // The card itself, not the read's end: a slow read keeps the placeholder up for a while after.
  await waitFor(card);
}

/** The card of the bond: the smallest element around its amount field that holds a confirm button. */
function card() {
  let at = document.getElementById(`coupon-amount-${BOND}`)?.parentElement ?? null;
  const confirm = { name: uk.dailyQuotes.coupon.confirm };
  while (at !== null && within(at).queryAllByRole('button', confirm).length === 0) {
    at = at.parentElement;
  }
  if (at === null) throw new Error('the bond has no coupon card');
  return within(at);
}

/** Types an amount, ticks the reinvest with a count of one unit and presses Record coupon. */
function recordWithReinvest() {
  const c = card();
  fireEvent.change(c.getByRole('textbox', { name: uk.transaction.amount }), {
    target: { value: '1183,5' },
  });
  fireEvent.click(c.getByRole('checkbox'));
  fireEvent.change(c.getByRole('textbox', { name: uk.transaction.quantity }), {
    target: { value: '1' },
  });
  fireEvent.click(c.getByRole('button', { name: uk.dailyQuotes.coupon.confirm }));
}

/** The API answers 500 to a write that carries an op `carries` picks out, and serves the rest. */
function failingWriteThat(carries: (op: Op) => boolean) {
  const serve = api.fetch;
  api.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), 'http://localhost'), init);
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith('/mutations')) {
      const { ops } = JSON.parse(await request.clone().text()) as { ops: Op[] };
      if (ops.some(carries)) return new Response('{}', { status: 500 });
    }
    return serve(request);
  };
  return () => {
    api.fetch = serve;
  };
}

const posts = () => api.seen.filter((r) => r.method === 'POST' && r.path === '/mutations');
const dueRows = () =>
  api.rows.transactions.filter((t) => t.assetId === BOND && t.date === DUE).map((t) => t.type);
const nextCoupon = () => api.rows.assets.find((a) => a.id === BOND)?.nextCoupon;

describe('recording a coupon', () => {
  it('sends the payout and the roll as one request when nothing is reinvested', async () => {
    await open('/');

    const c = card();
    fireEvent.change(c.getByRole('textbox', { name: uk.transaction.amount }), {
      target: { value: '1183,5' },
    });
    fireEvent.click(c.getByRole('button', { name: uk.dailyQuotes.coupon.confirm }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(uk.dailyQuotes.coupon.recordedToast),
    );
    expect(posts()).toHaveLength(1);
    expect(dueRows()).toEqual(['interest_payout']);
    expect(nextCoupon()).toBe('2027-02-25');
  });

  it('sends the payout, the reinvest and the roll as one request', async () => {
    await open('/');

    recordWithReinvest();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(uk.dailyQuotes.coupon.recordedReinvestToast),
    );
    expect(posts()).toHaveLength(1);
    expect(dueRows()).toEqual(['interest_payout', 'reinvest']);
    expect(nextCoupon()).toBe('2027-02-25');
  });

  it.each([
    ['the reinvest', (op: Op) => op.op === 'transaction.add' && op.transaction.type === 'reinvest'],
    ['the roll', (op: Op) => op.op === 'asset.patch'],
  ])(
    'writes nothing when the request that carries %s fails, and can be pressed again',
    async (_, carries) => {
      await open('/');
      const restore = failingWriteThat(carries);

      recordWithReinvest();

      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(uk.transaction.failedToast));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      // The occurrence is still open: no payout settled it, and the card is still there to press.
      expect(dueRows()).toEqual([]);
      expect(nextCoupon()).toBe(DUE);
      expect(toast.success).not.toHaveBeenCalled();
      expect(
        card()
          .getByRole('button', { name: uk.dailyQuotes.coupon.confirm })
          .hasAttribute('disabled'),
      ).toBe(false);

      restore();
      fireEvent.click(card().getByRole('button', { name: uk.dailyQuotes.coupon.confirm }));

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(uk.dailyQuotes.coupon.recordedReinvestToast),
      );
      expect(dueRows()).toEqual(['interest_payout', 'reinvest']);
      expect(nextCoupon()).toBe('2027-02-25');
    },
  );
});
