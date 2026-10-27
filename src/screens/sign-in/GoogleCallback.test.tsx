// @vitest-environment jsdom
// Back from Google, the card says «Входимо…» while the relay redeems the code, with no form
// (`account-way-in-and-out.dc.html` T5), then lands where the answer sends it.
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { arrivedGoogleFailed } from '../../auth/google';
import type { RelayAnswer } from '../../auth/relay';
import { useSettings } from '../../state/settings';

const hold = vi.hoisted(() => {
  // Before the settings store is imported, which persists to it.
  const kept = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  } as Storage;
  return { complete: vi.fn() };
});
vi.mock('../../auth/app', () => ({
  session: { complete: hold.complete },
  tabStorage: () => undefined,
}));
vi.mock('../../app/SignedOutShell', () => ({
  SignedOutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./useSelfXssWarning', () => ({ useSelfXssWarning: () => {} }));

const { GoogleCallback } = await import('./GoogleCallback');

// A code is redeemed once per page load, whoever asks, so each case brings its own.
let codes = 0;
let answer: (value: RelayAnswer) => void = () => {};

function mount(search = `?code=c${++codes}&state=s`) {
  const router = createMemoryRouter(
    [
      { path: '/auth/callback', element: <GoogleCallback /> },
      { path: '/', element: <p>home</p> },
      { path: '/sign-in', element: <p>sign-in</p> },
    ],
    { initialEntries: [`/auth/callback${search}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  hold.complete.mockReset();
  hold.complete.mockImplementation(() => new Promise<RelayAnswer>((land) => (answer = land)));
  useSettings.setState({ language: 'uk' });
});
afterEach(cleanup);

describe('back from Google, while the relay redeems the code', () => {
  // The drawing's words, character for character.
  it('says «Входимо…» over «Завершуємо вхід через Google.», its heading focused', () => {
    mount();
    const heading = screen.getByRole('heading', { name: 'Входимо…' });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('Завершуємо вхід через Google.')).toBeTruthy();
  });

  it('holds no field, no button and no link, and no second announcement', () => {
    mount();
    for (const role of ['textbox', 'button', 'link', 'status', 'alert']) {
      expect(screen.queryAllByRole(role), role).toEqual([]);
    }
  });

  it('says it in English when the page is', () => {
    useSettings.setState({ language: 'en' });
    mount();
    expect(screen.getByRole('heading', { name: 'Signing in…' })).toBeTruthy();
    expect(screen.getByText('Finishing your Google sign-in.')).toBeTruthy();
  });
});

describe('once the relay has answered', () => {
  it('lands on / signed in, the callback entry replaced', async () => {
    const router = mount();
    await act(async () => answer({ kind: 'tokens', tokens: {} } as RelayAnswer));
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('lands on /sign-in saying Google did not finish, when the relay refuses the code', async () => {
    const router = mount();
    await act(async () => answer({ kind: 'refused', reason: 'notAuthorized' } as RelayAnswer));
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(arrivedGoogleFailed(router.state.location.state)).toBe(true);
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('sends nothing for a return Google refused, and lands on /sign-in saying so', async () => {
    const router = mount('?error=access_denied&state=s');
    await act(async () => {});
    expect(hold.complete).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(arrivedGoogleFailed(router.state.location.state)).toBe(true);
  });
});
