// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Answer } from '../../auth/access';

// Google on: the sign-out leaves through Cognito's logout, which here takes the page nowhere.
const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => ({ logout: 'https://auth.test/logout?client_id=c' })),
  leaveThroughLogout: vi.fn(() => true),
}));
vi.mock('../../auth/app', () => ({
  leaveThroughLogout: auth.leaveThroughLogout,
  session: { signOut: auth.signOut },
  showAnswer: vi.fn(),
}));
vi.mock('../../app/SignedOutShell', () => ({
  SignedOutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { AnswerScreen } = await import('./Answer');

function mount(answer: Answer) {
  render(
    <MemoryRouter>
      <AnswerScreen held={{ answer, email: 'who@example.com' }} />
    </MemoryRouter>,
  );
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const pageshow = (persisted: boolean) =>
  act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted })));

beforeEach(() => {
  auth.signOut.mockClear();
  auth.leaveThroughLogout.mockClear();
});
afterEach(cleanup);

describe("an answer screen's sign-out", () => {
  // Back from Cognito's logout can restore the page from the back/forward cache, `leaving` and all,
  // and the screen offers no other way out.
  it.each([
    ['pending', 'Вийти'],
    ['noApplication', 'Вийти й подати заявку'],
  ] as const)(
    'offers the %s answer’s «%s» again when Back restores the page the logout left',
    async (answer, name) => {
      mount(answer);
      await act(() => button(name).click());
      expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(1);
      expect(button(name).disabled, 'the press left the button enabled').toBe(true);
      pageshow(true);
      expect(button(name).disabled).toBe(false);
      // Enabled is not enough: a guard still latched would leave it drawn pressable and dead.
      await act(() => button(name).click());
      expect(auth.signOut).toHaveBeenCalledTimes(2);
      expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(2);
    },
  );

  it('stays busy while the page leaves, and a pageshow that is no restore changes nothing', async () => {
    mount('pending');
    await act(() => button('Вийти').click());
    pageshow(false);
    expect(button('Вийти').disabled).toBe(true);
  });
});
