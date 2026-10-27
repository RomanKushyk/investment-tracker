// @vitest-environment jsdom
// `/sign-in` with the bot check and the sign-in calls stubbed: the widget's events are driven by
// hand, so each case is a step's answer to one of them (`bot-check.dc.html` T2–T4,
// `bot-check-steps.dc.html` T1–T4).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { carrySignedOut } from '../../auth/signed-out';

import type { SignInDeps, SignInOutcome } from '../../auth/sign-in';
import { uk } from '../../i18n/messages';
import type { BotCheckProps } from './BotCheck';

const hold = vi.hoisted(() => ({
  /** The widget on screen now; each step renders its own. */
  props: undefined as BotCheckProps | undefined,
  address: vi.fn(),
  password: vi.fn(),
  newPassword: vi.fn(),
  /** The OS passkey sheet, which `signInDeps.authenticate` opens. */
  sheet: vi.fn(),
  /** This tab's session storage, as `tabStorage` hands it. */
  tab: undefined as Storage | undefined,
}));
vi.mock('../../auth/app', () => ({
  botCheckSitekey: 'site-key',
  cancelPasskey: vi.fn(),
  passkeyDeps: {},
  session: { restore: vi.fn(async () => {}) },
  signInDeps: { authenticate: hold.sheet },
  startGoogle: vi.fn(),
  tabStorage: () => hold.tab,
  useGoogle: () => false,
  useSessionStatus: () => 'signedOut',
}));
vi.mock('../../auth/sign-in', () => ({
  signInWithAddress: hold.address,
  signInWithPassword: hold.password,
  setNewPassword: hold.newPassword,
}));
vi.mock('./BotCheck', () => ({
  BotCheck: (props: BotCheckProps) => {
    hold.props = props;
    return <div data-testid="bot-check" />;
  },
}));
vi.mock('../../app/SignedOutShell', () => ({
  SignedOutShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./useSelfXssWarning', () => ({ useSelfXssWarning: () => {} }));

const { SignIn } = await import('./SignIn');

const EMAIL = 'someone@example.com';
const HELD = { session: 'held-session', userId: 'user-id' };
/** `bot-check.dc.html` T5 and `bot-check-steps.dc.html` T5, character for character. */
const PENDING = 'Перевірка безпеки ще триває. Спробуйте ще раз за мить.';
const EXPIRED = 'Час на встановлення пароля минув. Введіть тимчасовий пароль ще раз.';

/** `/sign-in` as the page's first location, or, `after` another, as a visit from within the app. */
function mount(after?: string) {
  const router = createMemoryRouter(
    [
      { path: '/sign-in', element: <SignIn /> },
      { path: '/', element: <p>home</p> },
      { path: '/allocation', element: <p>allocation</p> },
    ],
    { initialEntries: after === undefined ? ['/sign-in'] : [after, '/sign-in'] },
  );
  render(<RouterProvider router={router} />);
}

const widget = () => {
  if (!hold.props) throw new Error('no bot check is on screen');
  return hold.props;
};
const emit = (fire: (props: BotCheckProps) => void) => act(async () => fire(widget()));
const button = (name: RegExp) => screen.getByRole<HTMLButtonElement>('button', { name });
const press = (name: RegExp) => act(async () => void button(name).click());
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const alerts = () => screen.queryAllByRole('alert').map((alert) => alert.textContent);
const tokensOf = (fn: typeof hold.address, at: number) => fn.mock.calls.map((call) => call[at]);

const CONTINUE = new RegExp(`${uk.auth.signIn.continue}|${uk.auth.signIn.checking}`);
const SIGN_IN = new RegExp(`^(${uk.auth.password.submit}|${uk.auth.password.busy})$`);
const RETRY = new RegExp(uk.auth.retry);

/** The address step, its widget passed, answered by the password step. */
async function toThePassword() {
  hold.address.mockResolvedValueOnce({ kind: 'password', email: EMAIL } satisfies SignInOutcome);
  mount();
  type(uk.auth.email, EMAIL);
  await emit((w) => w.onToken('address-token'));
  await press(CONTINUE);
}

beforeEach(() => {
  hold.props = undefined;
  hold.address.mockReset();
  hold.password.mockReset();
  hold.newPassword.mockReset();
  hold.sheet.mockReset();
  hold.tab = undefined;
});
afterEach(cleanup);

// The fact a sign-out through Cognito's logout carries in this tab is said only by the logout's own
// landing, a load of the page; «Увійти» on a page the logout left is a plain visit (T4).
describe("the line a sign-out through Cognito's logout carries", () => {
  beforeEach(() => {
    hold.tab = window.sessionStorage;
    hold.tab.clear();
    carrySignedOut(hold.tab);
  });
  // The note writes its line once its live region has settled, a tenth of a second in.
  const settled = () => act(() => new Promise((settle) => setTimeout(settle, 200)));

  it("is said where the logout lands, the page's first location", async () => {
    mount();
    await settled();
    expect(screen.queryByText(uk.auth.signedOut)).not.toBeNull();
  });

  it('is not said on a visit from within the app, and is forgotten there', async () => {
    mount('/allocation');
    await settled();
    expect(screen.queryByText(uk.auth.signedOut)).toBeNull();
    expect(hold.tab?.length, 'the visit kept the fact').toBe(0);
  });
});

describe('the address step refuses a press before the token, so the passkey sheet can open', () => {
  it('refuses an empty address on its field, and waits for no token', async () => {
    mount();
    await press(CONTINUE);
    expect(screen.getByText(uk.auth.emailMissing)).toBeTruthy();
    expect(hold.address).not.toHaveBeenCalled();
    expect(button(CONTINUE).disabled).toBe(false);
  });

  it('sends nothing before the token, keeps the button live, and says the check is running', async () => {
    mount();
    type(uk.auth.email, EMAIL);
    await press(CONTINUE);
    expect(hold.address).not.toHaveBeenCalled();
    expect(button(CONTINUE).disabled).toBe(false);
    expect(button(CONTINUE).textContent).toBe(uk.auth.signIn.continue);
    expect(alerts()).toEqual([PENDING]);

    // The check's own word goes when the check passes: it is no longer running.
    hold.address.mockResolvedValueOnce({ kind: 'password', email: EMAIL });
    await emit((w) => w.onToken('address-token'));
    expect(alerts()).toEqual([]);
    await press(CONTINUE);
    expect(hold.address).toHaveBeenCalledTimes(1);
    expect(hold.address.mock.calls[0]?.slice(0, 2)).toEqual([EMAIL, 'address-token']);
  });
});

describe('the password step waits for its own token', () => {
  it('shows «Входимо…» busy from a press before the token, and starts once it comes', async () => {
    await toThePassword();
    expect(hold.props?.reset).toBe(0);
    hold.password.mockResolvedValueOnce({ kind: 'refused', reason: 'wrong' });
    type(uk.auth.password.label, 'Some-Pass-1!');
    await press(SIGN_IN);
    expect(button(SIGN_IN).textContent).toBe(uk.auth.password.busy);
    expect(button(SIGN_IN).disabled).toBe(true);
    expect(hold.password).not.toHaveBeenCalled();

    await emit((w) => w.onToken('password-token'));
    expect(hold.password).toHaveBeenCalledTimes(1);
    expect(hold.password.mock.calls[0]?.slice(0, 3)).toEqual([
      EMAIL,
      'Some-Pass-1!',
      'password-token',
    ]);
  });

  it('refuses an empty password on its field, and waits for no token', async () => {
    await toThePassword();
    await press(SIGN_IN);
    expect(screen.getByText(uk.auth.password.missing)).toBeTruthy();
    expect(button(SIGN_IN).disabled).toBe(false);
    expect(hold.password).not.toHaveBeenCalled();
  });

  // EVERY ANSWER SPENDS THE TOKEN: the widget is reset, and the next start carries the new one.
  it('starts again after a wrong password with a different token', async () => {
    await toThePassword();
    hold.password.mockResolvedValue({ kind: 'refused', reason: 'wrong' });
    await emit((w) => w.onToken('first-token'));
    type(uk.auth.password.label, 'Some-Pass-1!');
    await press(SIGN_IN);
    expect(alerts()).toEqual([uk.auth.password.wrong]);
    expect(widget().reset).toBe(1);

    await press(SIGN_IN);
    expect(hold.password).toHaveBeenCalledTimes(1);
    await emit((w) => w.onToken('second-token'));
    expect(tokensOf(hold.password, 2)).toEqual(['first-token', 'second-token']);
  });
});

describe('the passkey step’s retry takes a widget of its own', () => {
  async function toTheRetry() {
    hold.address.mockImplementationOnce(
      async (_: string, __: string, ___: unknown, onPasskey: (email: string) => void) => {
        onPasskey(EMAIL);
        return { kind: 'refused', reason: 'notFinished' } satisfies SignInOutcome;
      },
    );
    mount();
    type(uk.auth.email, EMAIL);
    await emit((w) => w.onToken('address-token'));
    hold.props = undefined;
    await press(CONTINUE);
  }

  it('enters with the not-finished sentence, refuses a press before its token, then starts', async () => {
    await toTheRetry();
    expect(alerts()).toEqual([uk.auth.passkey.notFinished]);
    expect(screen.getByTestId('bot-check')).toBeTruthy();

    await press(RETRY);
    expect(hold.address).toHaveBeenCalledTimes(1);
    expect(alerts()).toEqual([uk.auth.passkey.notFinished, PENDING]);

    hold.address.mockResolvedValueOnce({ kind: 'refused', reason: 'notFinished' });
    await emit((w) => w.onToken('retry-token'));
    expect(alerts()).toEqual([uk.auth.passkey.notFinished]);
    await press(RETRY);
    expect(tokensOf(hold.address, 1)).toEqual(['address-token', 'retry-token']);
  });

  it('shows no widget while the sheet is open', async () => {
    let finish: (outcome: SignInOutcome) => void = () => {};
    hold.address.mockImplementationOnce(
      (_: string, __: string, ___: unknown, onPasskey: (email: string) => void) => {
        onPasskey(EMAIL);
        return new Promise<SignInOutcome>((resolve) => (finish = resolve));
      },
    );
    mount();
    type(uk.auth.email, EMAIL);
    await emit((w) => w.onToken('address-token'));
    await press(CONTINUE);
    expect(screen.getByText(uk.auth.passkey.title)).toBeTruthy();
    expect(screen.queryByTestId('bot-check')).toBeNull();
    await act(async () => finish({ kind: 'refused', reason: 'notFinished' }));
    expect(screen.getByTestId('bot-check')).toBeTruthy();
  });
});

// `account-way-in-and-out.dc.html` T6: after the sheet closes the step stays, its lead turning to
// «Входимо…» over the sentence it replaces, and both its controls busy until the relay answers.
describe('a passkey being verified', () => {
  let closeSheet: () => void = () => {};
  let answer: (outcome: SignInOutcome) => void = () => {};

  async function toTheSheet() {
    hold.sheet.mockImplementationOnce(() => new Promise((close) => (closeSheet = () => close({}))));
    hold.address.mockImplementationOnce(
      async (_: string, __: string, deps: SignInDeps, onPasskey: (email: string) => void) => {
        onPasskey(EMAIL);
        await deps.authenticate({ challenge: 'c' });
        return new Promise<SignInOutcome>((resolve) => (answer = resolve));
      },
    );
    mount();
    type(uk.auth.email, EMAIL);
    await emit((w) => w.onToken('address-token'));
    await press(CONTINUE);
  }
  const line = () => screen.getByRole('status');
  const change = () => screen.getByRole('button', { name: uk.auth.changeLabel });
  const passwordButton = () => button(new RegExp(uk.auth.passkey.usePassword));
  const busy = () => [change(), passwordButton()].map((b) => b.getAttribute('aria-disabled'));

  it('reads «Входимо…» in the line the lead stood in, the lead held beneath it unread', async () => {
    await toTheSheet();
    // Present and silent since the step appeared, so the word it gains is announced.
    const before = line();
    expect(before.textContent).toBe('');
    expect(screen.getByText(uk.auth.passkey.lead).getAttribute('aria-hidden')).toBeNull();
    expect(busy()).toEqual([null, null]);

    await act(async () => closeSheet());
    expect(line()).toBe(before);
    expect(before.textContent).toBe('Входимо…');
    expect(screen.getByText(uk.auth.passkey.lead).getAttribute('aria-hidden')).toBe('true');
    expect(busy()).toEqual(['true', 'true']);
  });

  it('keeps its step when «Змінити» or «Увійти з паролем» is pressed', async () => {
    await toTheSheet();
    await act(async () => closeSheet());
    await act(async () => change().click());
    await act(async () => passwordButton().click());
    expect(screen.getByText(uk.auth.passkey.title)).toBeTruthy();
    expect(screen.queryByLabelText(uk.auth.password.label)).toBeNull();
    expect(screen.queryByLabelText(uk.auth.email)).toBeNull();
  });

  // The lead coming back is not news: a refusal announces its own sentence, and no window is open.
  it('gives the controls and the lead back with the refusal, and announces only the refusal', async () => {
    await toTheSheet();
    await act(async () => closeSheet());
    await act(async () => answer({ kind: 'refused', reason: 'notFinished' }));
    expect(alerts()).toEqual([uk.auth.passkey.notFinished]);
    expect(line().textContent).toBe('');
    expect(screen.getByText(uk.auth.passkey.lead).getAttribute('aria-hidden')).toBeNull();
    expect(busy()).toEqual([null, null]);
    await act(async () => passwordButton().click());
    expect(screen.getByLabelText(uk.auth.password.label)).toBeTruthy();
  });
});

describe('«Встановіть пароль» answers the held challenge, and starts nothing', () => {
  async function toTheNewPassword() {
    await toThePassword();
    hold.password.mockResolvedValueOnce({ kind: 'newPassword', email: EMAIL, held: HELD });
    await emit((w) => w.onToken('password-token'));
    type(uk.auth.password.label, 'Temporary-1!');
    await press(SIGN_IN);
  }
  const SAVE = new RegExp(`${uk.auth.setPassword.submit}|${uk.auth.setPassword.busy}`);

  it('answers the held challenge with the new password, with no token and no start', async () => {
    await toTheNewPassword();
    expect(screen.queryByTestId('bot-check')).toBeNull();
    hold.newPassword.mockResolvedValueOnce({ kind: 'signedIn', offerPasskey: true });
    type(uk.auth.setPassword.label, 'My-Own-Pass-8!');
    await press(SAVE);
    expect(hold.newPassword.mock.calls[0]?.slice(0, 2)).toEqual([HELD, 'My-Own-Pass-8!']);
    expect(hold.address).toHaveBeenCalledTimes(1);
    expect(hold.password).toHaveBeenCalledTimes(1);
  });

  it('returns an expired session to the password step, and keeps the new password for it', async () => {
    await toTheNewPassword();
    hold.newPassword.mockResolvedValueOnce({ kind: 'refused', reason: 'expired' });
    type(uk.auth.setPassword.label, 'My-Own-Pass-8!');
    await press(SAVE);

    expect(screen.getByText(EMAIL)).toBeTruthy();
    const field = screen.getByLabelText<HTMLInputElement>(uk.auth.password.label);
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    expect(alerts()).toEqual([EXPIRED]);

    hold.password.mockResolvedValueOnce({ kind: 'newPassword', email: EMAIL, held: HELD });
    await emit((w) => w.onToken('another-token'));
    type(uk.auth.password.label, 'Temporary-1!');
    await press(SIGN_IN);
    expect(screen.getByLabelText<HTMLInputElement>(uk.auth.setPassword.label).value).toBe(
      'My-Own-Pass-8!',
    );
  });
});
