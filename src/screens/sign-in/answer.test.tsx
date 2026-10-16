// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Answer } from '../../auth/access';
import type { HeldAnswer } from '../../auth/app';

// Google on: the sign-out leaves through Cognito's logout, which here takes the page nowhere. The
// held answer is `app.ts`'s store in miniature, so dropping it is seen as the route coming back.
const auth = vi.hoisted(() => {
  const hearing = new Set<() => void>();
  const self = {
    held: undefined as HeldAnswer | undefined,
    hearing,
    // The relay's answer, held back while a test looks at the run.
    answer: Promise.resolve(),
    signOut: vi.fn(async () => {
      await self.answer;
      return { logout: 'https://auth.test/logout?client_id=c' };
    }),
    leaveThroughLogout: vi.fn(() => true),
    showAnswer: vi.fn((next?: HeldAnswer) => {
      self.held = next;
      hearing.forEach((listener) => listener());
    }),
  };
  return self;
});
const hear = (listener: () => void) => {
  auth.hearing.add(listener);
  return () => void auth.hearing.delete(listener);
};
vi.mock('../../auth/app', () => ({
  leaveThroughLogout: auth.leaveThroughLogout,
  session: { signOut: auth.signOut },
  showAnswer: auth.showAnswer,
}));
vi.mock('../../app/SignedOutShell', () => ({
  SignedOutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const { AnswerScreen } = await import('./Answer');

// `Root`'s shape: the answer in place of whatever route asked, the route back once it is dropped.
function Asked() {
  const held = useSyncExternalStore(hear, () => auth.held);
  return held ? <AnswerScreen held={held} /> : <p>the route</p>;
}

function mount(answer: Answer) {
  auth.held = { answer, email: 'who@example.com' };
  const router = createMemoryRouter([{ path: '*', element: <Asked /> }], {
    initialEntries: ['/overview'],
  });
  // `react-router/dom`'s provider, as `main.tsx` mounts it, is this one handed React DOM's
  // `flushSync`; without it a way out commits in a transition.
  render(<RouterProvider router={router} flushSync={(commit) => void flushSync(commit)} />);
  return router;
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const pageshow = (persisted: boolean) =>
  act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted })));
const answerShown = () => screen.queryAllByRole('button').length > 0;

beforeEach(() => {
  auth.answer = Promise.resolve();
  auth.signOut.mockClear();
  auth.leaveThroughLogout.mockClear();
  auth.showAnswer.mockClear();
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

  // A redirect that does leave keeps the answer and the pressed button until the page has gone.
  it('stays busy while the page leaves, and a pageshow that is no restore changes nothing', async () => {
    mount('pending');
    await act(() => button('Вийти').click());
    pageshow(false);
    expect(button('Вийти').disabled).toBe(true);
    expect(
      auth.showAnswer,
      'the answer was dropped with no later act of the user’s',
    ).not.toHaveBeenCalled();
  });

  // A Stop while the logout loads leaves the page here: the next route change drops the answer
  // (`account-way-in-and-out.dc.html`, T4), and the route that asked renders signed out.
  it.each([
    ['pending', 'Вийти'],
    ['noApplication', 'Вийти й подати заявку'],
  ] as const)(
    'drops the %s answer by the next route change when Cognito’s logout left the page in place (pressed «%s»)',
    async (answer, name) => {
      const router = mount(answer);
      await act(() => button(name).click());
      expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(1);
      expect(button(name).disabled).toBe(true);
      await act(() => router.navigate('/allocation'));
      expect(answerShown(), 'the answer outlived the route change').toBe(false);
      expect(screen.getByText('the route')).toBeTruthy();
      expect(auth.showAnswer).toHaveBeenCalledExactlyOnceWith(undefined);
    },
  );

  // A route change before the relay answers comes before the page sets out, so it is not the one
  // that finds the page still here: the answer goes at the first route change after the redirect.
  it('drops the answer only by a route change after the redirect set out', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    const router = mount('pending');
    act(() => button('Вийти').click());
    expect(button('Вийти').disabled).toBe(true);
    await act(() => router.navigate('/allocation'));
    await act(async () => {
      answer();
      await auth.answer;
    });
    expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(1);
    expect(answerShown(), 'the move mid-run dropped the answer').toBe(true);
    expect(button('Вийти').disabled).toBe(true);
    await act(() => router.navigate('/overview'));
    expect(answerShown()).toBe(false);
  });
});
