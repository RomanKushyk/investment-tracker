// @vitest-environment jsdom
// Deleting a confirmed coupon's payout from the ledger (*Cloud target*): the delete and the reopening
// of the occurrence, which is the asset's `nextCoupon` moved back, are one request, so they land whole
// or not at all, and the toast says what the request did. The panel is driven through the real route
// and client, over a fake of the user API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Op } from '@quirenote/core/ops';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
// The seed's coupon of 25.02.2026 on the bond whose pointer stands at 25.08.2026.
const PAYOUT = '5eed0000-0000-4000-8000-00000000000d';
const BOND = '5eed0000-0000-4000-8000-000000000003';

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
const { toast } = await import('sonner');
const { useDraft } = await import('../state/draft');

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
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
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
const held = () => api.rows.transactions.some((t) => t.id === PAYOUT);
const nextCoupon = () => api.rows.assets.find((a) => a.id === BOND)?.nextCoupon;

/** Presses the payout's ✕, then the confirm it asks. */
async function deletePayout() {
  const glyph = document.querySelector(`[data-delete-row="${PAYOUT}"]`);
  if (glyph === null) throw new Error('the payout has no delete control');
  fireEvent.click(glyph);
  fireEvent.click(await screen.findByRole('button', { name: uk.transaction.delete.confirm }));
}

describe('deleting a confirmed coupon', () => {
  it('deletes the payout and reopens the occurrence in one request', async () => {
    await open('/transactions');

    await deletePayout();

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(uk.transaction.delete.couponReopenedToast),
    );
    expect(posts()).toHaveLength(1);
    expect(held()).toBe(false);
    expect(nextCoupon()).toBe('2026-02-25');
  });

  it('changes nothing, says so, and can be asked again when the request fails', async () => {
    await open('/transactions');
    const restore = failingWriteThat((op) => op.op === 'asset.patch');

    await deletePayout();

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(uk.transaction.delete.failedToast),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The occurrence is as it was, nothing was told as done, and the question is still asked.
    expect(held()).toBe(true);
    expect(nextCoupon()).toBe('2026-08-25');
    expect(toast.success).not.toHaveBeenCalled();

    restore();
    fireEvent.click(screen.getByRole('button', { name: uk.transaction.delete.confirm }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(uk.transaction.delete.couponReopenedToast),
    );
    expect(held()).toBe(false);
    expect(nextCoupon()).toBe('2026-02-25');
  });

  it.each(['deposit', 'buy'] as const)(
    'sends the delete alone when the row is a %s, which settled no coupon',
    async (type) => {
      await open('/transactions');
      // A buy names an asset the pointer could be moved on; a deposit names none.
      const row = SEED.transactions.find((t) => t.type === type);
      if (row === undefined) throw new Error(`the seed holds no ${type}`);
      const glyph = document.querySelector(`[data-delete-row="${row.id}"]`);
      if (glyph === null) throw new Error(`the ${type} has no delete control`);

      fireEvent.click(glyph);
      fireEvent.click(await screen.findByRole('button', { name: uk.transaction.delete.confirm }));

      await waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith(uk.transaction.delete.doneToast),
      );
      expect(posts()).toHaveLength(1);
      expect(JSON.parse(posts()[0].body)).toEqual({
        ops: [{ op: 'transaction.delete', id: row.id }],
      });
    },
  );
});
