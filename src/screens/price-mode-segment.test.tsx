// @vitest-environment jsdom
// PriceMode, the amount field's «Σ / 1» (open-values-shell-controls.md § Signed, item 14): the
// shared segmented control at 24 px, a radiogroup named by the amount's own label.
//
// THE DEFECT IT CARRIES: the panel converts the typed amount on every mode change, so a press on
// the radio already in effect, or an arrow move reported twice, multiplied the amount.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../__fixtures__/router';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
vi.stubGlobal('scrollTo', () => {});
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

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(cleanup);

const t = uk.transaction;

/** The form on /transactions, on its default Buy, with 4 units and an amount of 1 000. */
async function filled() {
  const router = createMemoryRouter(routes, { initialEntries: ['/transactions'] });
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const units = await waitFor(() => {
    const found = container.querySelector<HTMLInputElement>('#tx-quantity');
    expect(found).not.toBeNull();
    return found!;
  });
  const amount = container.querySelector<HTMLInputElement>('#tx-amount')!;
  fireEvent.change(units, { target: { value: '4' } });
  fireEvent.change(amount, { target: { value: '1000' } });
  return { amount: () => amount.value.replace(/\s/g, '') };
}

const group = () => screen.getByRole('radiogroup', { name: /₴/ });
const radio = (name: string) => within(group()).getByRole('radio', { name });

/** An arrow pressed and released, as Radix reads it: held during the focus move it checks. */
async function arrow(from: HTMLElement, key: string) {
  fireEvent.keyDown(from, { key });
  await waitFor(() => expect(document.activeElement).not.toBe(from));
  fireEvent.keyUp(document.activeElement!, { key });
}

describe('PriceMode is a radiogroup on the segmented control', () => {
  it('is two radios named in words, showing «Σ» and «1», named by the amount label', async () => {
    await filled();
    expect(screen.getByRole('radiogroup', { name: t.amount })).toBe(group());
    const radios = within(group()).getAllByRole('radio');
    expect(radios.map((r) => r.querySelector('[aria-hidden]')?.textContent)).toEqual(['Σ', '1']);
    expect(radios.map((r) => r.getAttribute('title'))).toEqual([t.priceTotal, t.priceUnit]);
    expect(radio(t.priceTotal).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('main [aria-pressed]')).toBeNull();
  });

  it('draws 24 × 24 segments at radius 6 with no 44 overlay', async () => {
    await filled();
    for (const r of within(group()).getAllByRole('radio')) {
      expect(r.className.split(/\s+/)).toEqual(expect.arrayContaining(['size-6', 'rounded-[6px]']));
      expect(r.className).not.toContain('max-md:after:size-11');
    }
  });
});

describe('the amount converts exactly once per change', () => {
  it('converts on a press, and a press on the radio in effect converts nothing', async () => {
    const form = await filled();
    fireEvent.click(radio(t.priceUnit));
    expect(form.amount()).toBe('250');
    // The label is the contract: the group is renamed with it.
    expect(screen.getByRole('radiogroup', { name: t.amountUnit })).toBe(group());
    fireEvent.click(radio(t.priceUnit));
    expect(form.amount(), 'a press that changed nothing converted').toBe('250');
    fireEvent.click(radio(t.priceTotal));
    fireEvent.click(radio(t.priceTotal));
    expect(form.amount()).toBe('1000');
  });

  it('converts once on each arrow move', async () => {
    const form = await filled();
    const total = radio(t.priceTotal);
    total.focus();
    await arrow(total, 'ArrowRight');
    expect(radio(t.priceUnit).getAttribute('aria-checked')).toBe('true');
    expect(form.amount()).toBe('250');
    await arrow(radio(t.priceUnit), 'ArrowLeft');
    expect(radio(t.priceTotal).getAttribute('aria-checked')).toBe('true');
    expect(form.amount()).toBe('1000');
  });
});
