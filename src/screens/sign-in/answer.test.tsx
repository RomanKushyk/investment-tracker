// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { type ReactNode, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Answer } from '../../auth/access';
import type { HeldAnswer } from '../../auth/app';
import { uk } from '../../i18n/messages';
import type { TermsOutcome } from '../../lib/repository';

// Google on: the sign-out leaves through Cognito's logout, which here takes the page nowhere. The
// held answer is `app.ts`'s store in miniature, so dropping it is seen as the route coming back,
// and a sign-out the relay finished reads signed out before the page leaves, as `session.ts` does.
const auth = vi.hoisted(() => {
  const hearing = new Set<() => void>();
  const self = {
    held: undefined as HeldAnswer | undefined,
    hearing,
    status: 'signedIn' as 'signedIn' | 'signedOut',
    // The relay's answer, held back while a test looks at the run.
    answer: Promise.resolve(),
    signOut: vi.fn(async () => {
      await self.answer;
      self.status = 'signedOut';
      return { logout: 'https://auth.test/logout?client_id=c' };
    }),
    leaveThroughLogout: vi.fn(() => true),
    showAnswer: vi.fn((next?: HeldAnswer) => {
      self.held = next;
      hearing.forEach((listener) => listener());
    }),
    // The acceptance's answer, held back while a test looks at the run.
    accepted: Promise.resolve('accepted' as TermsOutcome),
    acceptTerms: vi.fn(async () => self.accepted),
  };
  return self;
});
const hear = (listener: () => void) => {
  auth.hearing.add(listener);
  return () => void auth.hearing.delete(listener);
};
vi.mock('../../auth/app', () => ({
  leaveThroughLogout: auth.leaveThroughLogout,
  session: { signOut: auth.signOut, status: () => auth.status },
  showAnswer: auth.showAnswer,
  useAnswer: () => useSyncExternalStore(hear, () => auth.held),
}));
vi.mock('../../lib/api', () => ({ repo: { acceptTerms: auth.acceptTerms } }));
vi.mock('../../app/SignedOutShell', () => ({
  SignedOutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// The theme hook `Root` runs reads the system scheme.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
afterAll(() => vi.unstubAllGlobals());

const { Root } = await import('../../app/Root');

function mount(answer: Answer) {
  auth.held = { answer, email: 'who@example.com' };
  // The answer in place of whatever route asked, the route back once it is dropped.
  const router = createMemoryRouter(
    [{ path: '/', element: <Root />, children: [{ path: '*', element: <p>the route</p> }] }],
    { initialEntries: ['/overview'] },
  );
  // `react-router/dom`'s provider, as `main.tsx` mounts it, is this one handed React DOM's
  // `flushSync`; without it a way out commits in a transition.
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} flushSync={(commit) => void flushSync(commit)} />
    </QueryClientProvider>,
  );
  return Object.assign(router, { client });
}
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const pageshow = (persisted: boolean) =>
  act(() => void dispatchEvent(new PageTransitionEvent('pageshow', { persisted })));
const answerShown = () => screen.queryAllByRole('button').length > 0;

beforeEach(() => {
  auth.answer = Promise.resolve();
  auth.accepted = Promise.resolve('accepted');
  auth.acceptTerms.mockClear();
  auth.status = 'signedIn';
  auth.signOut.mockClear();
  auth.leaveThroughLogout.mockClear();
  auth.showAnswer.mockClear();
});
afterEach(cleanup);

describe("an answer screen's sign-out", () => {
  // Back from Cognito's logout can restore the page from the back/forward cache, `leaving` and all.
  // Signed out by then, the answer goes and the route that asked renders signed out in its place.
  it.each([
    ['pending', 'Вийти'],
    ['noApplication', 'Вийти й подати заявку'],
  ] as const)(
    'drops the %s answer when Back restores the page the logout left, signed out (pressed «%s»)',
    async (answer, name) => {
      mount(answer);
      await act(() => button(name).click());
      expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(1);
      expect(answerShown(), 'the answer went before the restore').toBe(true);
      pageshow(true);
      expect(answerShown(), 'the restore kept the answer').toBe(false);
      expect(screen.queryByText('who@example.com', { exact: false })).toBeNull();
      expect(screen.getByText('the route')).toBeTruthy();
    },
  );

  // A sign-out reads signed out before the page leaves, so a restore still signed in is one left by
  // other means: the answer stays, with its way out.
  it.each([
    ['pending', 'Вийти'],
    ['noApplication', 'Вийти й подати заявку'],
  ] as const)(
    'keeps the %s answer and its «%s» when Back restores the page still signed in',
    async (answer, name) => {
      mount(answer);
      pageshow(true);
      expect(auth.showAnswer, 'the restore dropped a signed-in answer').not.toHaveBeenCalled();
      expect(screen.getByText('who@example.com', { exact: false })).toBeTruthy();
      expect(button(name).disabled).toBe(false);
      await act(() => button(name).click());
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(auth.leaveThroughLogout).toHaveBeenCalledTimes(1);
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

// `design/extensions/terms-acceptance-step.dc.html`: the step is the refused caller's card, asking
// for one press; accepting shows the route that asked, declining signs out as «Вийти» does.
describe('the terms step', () => {
  const step = uk.terms.step;

  it('stands in place of the route, with its title, its address and both buttons', () => {
    mount('terms');
    expect(screen.queryByText('the route')).toBeNull();
    expect(screen.getByRole('heading').textContent).toBe(uk.auth.terms.title);
    expect(screen.getByText(uk.auth.terms.lead)).toBeTruthy();
    expect(screen.getByText(uk.auth.signedInAs('who@example.com'))).toBeTruthy();
    expect(button(step.submit).disabled).toBe(false);
    expect(button(step.decline).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: uk.auth.signOut })).toBeNull();
  });

  // Chabolla v. ClassPass: the line names the button word for word, directly above it.
  it('names «Прийняти умови» in the line directly above it, linking the terms alone in a new tab', () => {
    mount('terms');
    const line = button(step.submit).parentElement!.previousElementSibling!;
    expect(line.tagName).toBe('P');
    expect(line.textContent).toContain(`«${step.submit}»`);
    const links = [...line.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/terms']);
    expect(links[0].getAttribute('target')).toBe('_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(links[0].textContent?.endsWith(uk.privacy.newTab)).toBe(true);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  // WP260 ¶8: the first layer is a paragraph of its own, under the buttons, apart from the line.
  it('puts the privacy first layer in a paragraph of its own under the buttons', () => {
    mount('terms');
    const layer = button(step.submit).parentElement!.nextElementSibling!;
    expect(layer.tagName).toBe('P');
    expect([...layer.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/privacy',
    ]);
    expect(layer.textContent).toContain('яку версію Умов і коли ви прийняли');
  });

  it('records the acceptance and shows the route that asked, with no sign-in', async () => {
    const router = mount('terms');
    const reset = vi.spyOn(router.client, 'resetQueries');
    await act(() => button(step.submit).click());
    expect(auth.acceptTerms).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(auth.showAnswer).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(screen.getByText('the route')).toBeTruthy();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/overview');
  });

  it('reads «Приймаємо…» while the write runs, and a press on decline does nothing meanwhile', async () => {
    let settle: (outcome: TermsOutcome) => void = () => {};
    auth.accepted = new Promise<TermsOutcome>((resolve) => (settle = resolve));
    mount('terms');
    act(() => button(step.submit).click());
    expect(button(step.busy).disabled).toBe(true);
    await act(() => button(step.decline).click());
    expect(auth.signOut).not.toHaveBeenCalled();
    await act(async () => settle('failed'));
    expect(button(step.submit).disabled).toBe(false);
  });

  it('signs out to /sign-in on decline, and a press on accept does nothing meanwhile', async () => {
    let answer = () => {};
    auth.answer = new Promise<void>((resolve) => (answer = resolve));
    mount('terms');
    act(() => button(step.decline).click());
    expect(button(step.decline).disabled).toBe(true);
    await act(() => button(step.submit).click());
    expect(auth.acceptTerms).not.toHaveBeenCalled();
    await act(async () => {
      answer();
      await auth.answer;
    });
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.leaveThroughLogout).toHaveBeenCalledExactlyOnceWith(
      'https://auth.test/logout?client_id=c',
      '/sign-in',
    );
  });

  it.each([
    [
      'outdated',
      'Умови користування змінилися. Перезавантажте сторінку, щоб прочитати їх, і прийміть їх ще раз.',
    ],
    ['throttled', 'Зараз забагато запитів. Спробуйте ще раз за мить.'],
    ['failed', 'Не вдалося прийняти умови. Спробуйте ще раз.'],
  ] as const)(
    'says why a %s write did not land, under both buttons, and lets them be pressed again',
    async (outcome, sentence) => {
      auth.accepted = Promise.resolve(outcome);
      mount('terms');
      await act(() => button(step.submit).click());
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(sentence);
      expect(alert.previousElementSibling).toBe(button(step.submit).parentElement);
      expect(auth.showAnswer).not.toHaveBeenCalled();
      expect(button(step.submit).disabled).toBe(false);
      expect(button(step.decline).disabled).toBe(false);
    },
  );
});
