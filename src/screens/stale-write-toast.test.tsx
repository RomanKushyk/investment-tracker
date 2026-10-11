// @vitest-environment jsdom
// A write refused for a stale tag says so once, in one toast, whichever control sent it (*Cloud
// target*): the controls that have a failure message of their own say nothing more of a refusal
// that changed nothing. Each control is driven through the real route and client, over a fake of
// the user API whose dataset another tab has moved.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** Another tab writes, then this one sends its write under the tag it had. Every toast of an error
 *  that follows, once the write has been refused and the toasts have had a tick to come. */
async function refused(send: () => void) {
  api.version += 1;
  send();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  expect(api.seen.filter((r) => r.method === 'POST')).toHaveLength(1);
  return vi.mocked(toast.error).mock.calls.map(([message]) => message);
}

const reit = SEED.assets[0];

describe('a control with a failure message of its own', () => {
  it('Delete asset says a stale tag once', async () => {
    await open('/portfolio');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.deleteAria(reit.name) }));
    const dialog = await screen.findByRole('alertdialog');

    const told = await refused(() =>
      fireEvent.click(within(dialog).getByRole('button', { name: uk.assets.deleteAction })),
    );

    expect(told).toEqual([uk.sync.staleWrite]);
  });

  it('Save changes on an asset says a stale tag once', async () => {
    await open('/portfolio');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.editAria(reit.name) }));
    const dialog = await screen.findByRole('dialog');

    const told = await refused(() =>
      fireEvent.click(within(dialog).getByRole('button', { name: uk.assets.saveChanges })),
    );

    expect(told).toEqual([uk.sync.staleWrite]);
  });

  it('Save on the targets says a stale tag once', async () => {
    await open('/allocation');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    const field = await screen.findByRole('textbox', { name: uk.targets.fieldAria(reit.name) });
    fireEvent.change(field, { target: { value: '12' } });

    const told = await refused(() =>
      fireEvent.click(screen.getByRole('button', { name: uk.edit.save })),
    );

    expect(told).toEqual([uk.sync.staleWrite]);
  });

  it('Erase data says a stale tag once', async () => {
    await open('/settings');
    fireEvent.click(screen.getByRole('button', { name: uk.danger.trigger }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'erase' } });

    const told = await refused(() =>
      fireEvent.click(within(dialog).getByRole('button', { name: uk.danger.action })),
    );

    expect(told).toEqual([uk.sync.staleWrite]);
  });

  it('deleting a transaction says a stale tag once', async () => {
    await open('/transactions');
    fireEvent.click(screen.getAllByRole('button', { name: uk.transaction.delete.aria })[0]);

    const told = await refused(() =>
      fireEvent.click(screen.getByRole('button', { name: uk.transaction.delete.confirm })),
    );

    expect(told).toEqual([uk.sync.staleWrite]);
  });
});

describe('the same controls, refused for another reason', () => {
  it('Delete asset says what failed, once', async () => {
    await open('/portfolio');
    fireEvent.click(screen.getByRole('button', { name: uk.edit.edit }));
    fireEvent.click(await screen.findByRole('button', { name: uk.assets.deleteAria(reit.name) }));
    const dialog = await screen.findByRole('alertdialog');
    // The API answers 500 to the write the dialog sends.
    const serve = api.fetch;
    api.fetch = async (input, init) =>
      String(input).endsWith('/mutations')
        ? new Response('{}', { status: 500 })
        : serve(input, init);

    fireEvent.click(within(dialog).getByRole('button', { name: uk.assets.deleteAction }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(vi.mocked(toast.error).mock.calls.map(([m]) => m)).toEqual([uk.assets.deleteFailed]);
  });
});
