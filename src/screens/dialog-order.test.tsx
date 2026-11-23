// @vitest-environment jsdom
// W1: below md the action stacks first and the dismissive one last, at md and up «Скасувати» leads;
// each dialog is opened through its real trigger, over a fake of the user API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { RouterProvider } from '../__fixtures__/router';
import { fakeApi, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() }),
}));

const SEED = buildSeedBackup('2026-07-28T12:00:00');

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
// A getter, since `useIsDesktop` keeps the first list it gets.
let wide = true;
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') ? wide : false;
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
const { useDraft } = await import('../state/draft');

beforeEach(() => {
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: '2026-07-28' },
  );
});
afterEach(() => {
  cleanup();
  useDraft.setState(useDraft.getInitialState(), true);
  wide = true;
});

function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const find = (name: string) => screen.findByRole('button', { name }, { timeout: 5000 });

/** The labels of the row that holds `action`, in DOM order. */
function row(dialog: HTMLElement, action: string) {
  const button = within(dialog).getByRole('button', { name: action });
  return [...button.parentElement!.children].map((b) => b.textContent);
}

const reit = SEED.assets[0];

const DIALOGS: {
  name: string;
  path: string;
  reach: () => Promise<HTMLElement>;
  action: string;
  dismiss: string;
}[] = [
  {
    name: 'the asset form',
    path: '/portfolio',
    reach: async () => {
      fireEvent.click(await find(uk.edit.edit));
      fireEvent.click(await find(uk.assets.editAria(reit.name)));
      return screen.findByRole('dialog');
    },
    action: uk.assets.saveChanges,
    dismiss: uk.assets.cancel,
  },
  {
    name: 'asset delete',
    path: '/portfolio',
    reach: async () => {
      fireEvent.click(await find(uk.edit.edit));
      fireEvent.click(await find(uk.assets.deleteAria(reit.name)));
      return screen.findByRole('alertdialog');
    },
    action: uk.assets.deleteAction,
    dismiss: uk.assets.cancel,
  },
  {
    name: 'erase data',
    path: '/settings',
    reach: async () => {
      fireEvent.click(await find(uk.danger.trigger));
      return screen.findByRole('alertdialog');
    },
    action: uk.danger.action,
    dismiss: uk.assets.cancel,
  },
  {
    // «Продовжити редагування» plays the dismissive role.
    name: 'discard',
    path: '/allocation',
    reach: async () => {
      fireEvent.click(await find(uk.edit.edit));
      const field = await screen.findByRole('textbox', { name: uk.targets.fieldAria(reit.name) });
      fireEvent.change(field, { target: { value: '12' } });
      fireEvent.click(screen.getByRole('button', { name: uk.edit.cancel }));
      return screen.findByRole('dialog');
    },
    action: uk.edit.discard,
    dismiss: uk.edit.keepEditing,
  },
];

describe.each(DIALOGS)('$name', ({ path, reach, action, dismiss }) => {
  it('below md stacks the action first and the dismissive one last', async () => {
    wide = false;
    open(path);
    const dialog = await reach();
    expect(row(dialog, action)).toEqual([action, dismiss]);
  });

  it('at md and up leads with the dismissive one', async () => {
    open(path);
    const dialog = await reach();
    expect(row(dialog, action)).toEqual([dismiss, action]);
  });
});
