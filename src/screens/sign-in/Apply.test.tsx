// @vitest-environment jsdom
// `/apply` with the bot check stubbed: the widget's own events are driven by hand, so each case is
// the form's answer to one of them (`bot-check.dc.html` T1, T4).
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApplyOutcome } from '../../auth/apply';
import { uk } from '../../i18n/messages';
import type { BotCheckProps } from './BotCheck';

const hold = vi.hoisted(() => ({
  props: undefined as BotCheckProps | undefined,
  apply: vi.fn<(typed: string, botCheck: string) => Promise<ApplyOutcome>>(),
}));
vi.mock('../../auth/app', () => ({ apply: hold.apply, botCheckSitekey: 'site-key' }));
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

const { Apply } = await import('./Apply');

const ADDRESS = 'new@quirenote.com';
const recorded: ApplyOutcome = { kind: 'recorded', email: ADDRESS };
const refused = (reason: Extract<ApplyOutcome, { kind: 'refused' }>['reason']): ApplyOutcome => ({
  kind: 'refused',
  reason,
});

function mount() {
  const router = createMemoryRouter(
    [
      { path: '/apply', element: <Apply /> },
      { path: '/sign-in', element: <p>sign in</p> },
    ],
    { initialEntries: ['/apply'] },
  );
  render(<RouterProvider router={router} />);
}

const widget = () => {
  if (!hold.props) throw new Error('the bot check was never rendered');
  return hold.props;
};
const button = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /Подати заявку|Надсилаємо…/ });
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText(uk.auth.email), { target: { value } });
const press = () => act(async () => void button().click());
const emit = (fire: (props: BotCheckProps) => void) => act(async () => fire(widget()));
const alert = () => screen.queryByRole('alert')?.textContent;

beforeEach(() => {
  hold.props = undefined;
  hold.apply.mockReset();
});
afterEach(cleanup);

describe('the address is checked before any token is waited for', () => {
  it('refuses an empty address on its field, and sends nothing', async () => {
    mount();
    await press();
    expect(screen.getByText(uk.auth.emailMissing)).toBeTruthy();
    expect(button().textContent).toBe(uk.auth.apply.submit);
    expect(button().disabled).toBe(false);
    expect(hold.apply).not.toHaveBeenCalled();
  });

  it('refuses a malformed address on its field, and sends nothing', async () => {
    mount();
    type('оксана@пошта.укр');
    await press();
    expect(screen.getByText(uk.auth.emailInvalid)).toBeTruthy();
    expect(button().textContent).toBe(uk.auth.apply.submit);
    expect(hold.apply).not.toHaveBeenCalled();
  });
});

describe('a press before the token', () => {
  it('shows the busy word, and posts once when the token arrives', async () => {
    hold.apply.mockResolvedValue(recorded);
    mount();
    type(ADDRESS);
    await press();
    expect(button().textContent).toBe(uk.auth.apply.busy);
    expect(button().disabled).toBe(true);
    expect(hold.apply).not.toHaveBeenCalled();

    await emit((w) => w.onToken('token-1'));
    expect(hold.apply).toHaveBeenCalledOnce();
    expect(hold.apply).toHaveBeenCalledWith(ADDRESS, 'token-1');
  });

  // The wait ends with the widget's answer: a failure returns the step live, with its sentence.
  it('returns the step live with the failure sentence when the widget fails instead', async () => {
    mount();
    type(ADDRESS);
    await press();
    await emit((w) => w.onFailed());
    expect(button().textContent).toBe(uk.auth.apply.submit);
    expect(button().disabled).toBe(false);
    expect(alert()).toBe(uk.auth.botCheck.failed);
    expect(hold.apply).not.toHaveBeenCalled();
  });
});

describe('the failure sentence', () => {
  it("appears under the button on the widget's own failure, press or not", async () => {
    mount();
    await emit((w) => w.onFailed());
    expect(alert()).toBe(uk.auth.botCheck.failed);
  });

  it("clears on the widget's next success", async () => {
    mount();
    await emit((w) => w.onFailed());
    await emit((w) => w.onToken('token-1'));
    expect(alert()).toBeUndefined();
  });

  it('appears when the server refuses the token', async () => {
    hold.apply.mockResolvedValue(refused('botCheck'));
    mount();
    await emit((w) => w.onToken('token-1'));
    type(ADDRESS);
    await press();
    expect(alert()).toBe(uk.auth.botCheck.failed);
  });

  // The reset widget's next pass comes within a second; the refusal must outlast it.
  it("stays when the server refused the token, through the reset widget's next success", async () => {
    hold.apply.mockResolvedValue(refused('botCheck'));
    mount();
    await emit((w) => w.onToken('token-1'));
    type(ADDRESS);
    await press();
    await emit((w) => w.onToken('token-2'));
    expect(alert()).toBe(uk.auth.botCheck.failed);
  });

  // Turnstile retries on its own and calls its error callback each time; one sentence for them.
  it('is said once across the widget repeating its failure', async () => {
    mount();
    await emit((w) => w.onFailed());
    const first = screen.getByRole('alert');
    await emit((w) => w.onFailed());
    expect(screen.getByRole('alert')).toBe(first);
  });
});

describe('a press after the widget failed', () => {
  // Its next failure must end the wait, or the button stays on the busy word with nothing sent.
  it('is returned live, with the sentence, when the widget fails again', async () => {
    mount();
    await emit((w) => w.onFailed());
    type(ADDRESS);
    await press();
    expect(button().textContent).toBe(uk.auth.apply.busy);
    await emit((w) => w.onFailed());
    expect(button().disabled).toBe(false);
    expect(alert()).toBe(uk.auth.botCheck.failed);
    expect(hold.apply).not.toHaveBeenCalled();
  });

  // A widget resting on its failure may never call again; the press asks it again itself.
  it('restarts the challenge, so the wait has an answer coming', async () => {
    mount();
    await emit((w) => w.onFailed());
    const before = widget().reset;
    type(ADDRESS);
    await press();
    expect(widget().reset).toBeGreaterThan(before);
  });

  it('leaves a challenge still verifying alone', async () => {
    mount();
    const before = widget().reset;
    type(ADDRESS);
    await press();
    expect(widget().reset).toBe(before);
  });

  // A checkbox that timed out or failed is no longer the press's to wait for.
  it('waits again once a checkbox has failed', async () => {
    mount();
    await emit((w) => w.onInteractive());
    await emit((w) => w.onFailed());
    type(ADDRESS);
    await press();
    expect(button().textContent).toBe(uk.auth.apply.busy);
  });
});

describe('every answer spends the token', () => {
  it('resets the widget, so a second press waits for and carries a fresh token', async () => {
    hold.apply.mockResolvedValue(refused('throttled'));
    mount();
    const before = widget().reset;
    await emit((w) => w.onToken('token-1'));
    type(ADDRESS);
    await press();
    expect(hold.apply).toHaveBeenLastCalledWith(ADDRESS, 'token-1');
    expect(widget().reset).toBeGreaterThan(before);

    await press();
    expect(hold.apply).toHaveBeenCalledOnce();
    expect(button().textContent).toBe(uk.auth.apply.busy);
    await emit((w) => w.onToken('token-2'));
    expect(hold.apply).toHaveBeenCalledTimes(2);
    expect(hold.apply).toHaveBeenLastCalledWith(ADDRESS, 'token-2');
  });

  // The form gives way, and the widget with it: its unmount removes it from the page.
  it('takes the widget away with the form once the application is recorded', async () => {
    hold.apply.mockResolvedValue(recorded);
    mount();
    await emit((w) => w.onToken('token-1'));
    type(ADDRESS);
    await press();
    expect(hold.apply).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('bot-check')).toBeNull();
  });
});

describe('a widget that never loaded', () => {
  it('answers every press with the unavailable sentence and posts nothing', async () => {
    mount();
    await emit((w) => w.onUnavailable());
    type(ADDRESS);
    await press();
    expect(alert()).toBe(uk.auth.botCheck.unavailable);
    await press();
    expect(alert()).toBe(uk.auth.botCheck.unavailable);
    expect(button().disabled).toBe(false);
    expect(hold.apply).not.toHaveBeenCalled();
  });

  it('ends a press already waiting with the unavailable sentence', async () => {
    mount();
    type(ADDRESS);
    await press();
    await emit((w) => w.onUnavailable());
    expect(button().disabled).toBe(false);
    expect(alert()).toBe(uk.auth.botCheck.unavailable);
    expect(hold.apply).not.toHaveBeenCalled();
  });
});

// Managed judged the visit risky: the press asked for is the checkbox's, so the step stays live.
describe('a widget showing its checkbox', () => {
  it('returns a waiting press live, with nothing sent', async () => {
    mount();
    type(ADDRESS);
    await press();
    await emit((w) => w.onInteractive());
    expect(button().disabled).toBe(false);
    expect(hold.apply).not.toHaveBeenCalled();
  });

  it('keeps a press made while it shows live, with nothing sent and no wait', async () => {
    mount();
    await emit((w) => w.onInteractive());
    type(ADDRESS);
    await press();
    expect(button().textContent).toBe(uk.auth.apply.submit);
    expect(button().disabled).toBe(false);
    // Ticked, the token arrives and sends nothing of its own: the next press is the user's.
    await emit((w) => w.onToken('token-1'));
    expect(hold.apply).not.toHaveBeenCalled();
  });
});

// The notice's first layer (`privacy-notice.dc.html` S2): at collection, under the button, with no
// checkbox and no "you agree" (EDPB 2/2019 ¶20).
describe('the first layer of the privacy notice', () => {
  const layer = () =>
    screen.getByText(
      (_, el) => el?.tagName === 'P' && el.querySelector('a[href="/privacy"]') !== null,
    );

  it('stands under the button, and asks for no agreement', () => {
    mount();
    expect(
      button().compareDocumentPosition(layer()) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the layer is not under the button',
    ).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(layer().textContent).not.toMatch(/agree|погодж/i);
  });

  it('opens the notice in a new tab, and its name says so', () => {
    mount();
    const link = screen.getByRole('link', { name: /Політиці конфіденційності/ });
    expect(link.getAttribute('href')).toBe('/privacy');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(link.textContent!.endsWith(uk.privacy.newTab)).toBe(true);
  });

  it('goes with the form once the application is recorded', async () => {
    hold.apply.mockResolvedValue(recorded);
    mount();
    type(ADDRESS);
    await emit((w) => w.onToken('token-1'));
    await press();
    expect(screen.queryByRole('link', { name: /Політиці конфіденційності/ })).toBeNull();
  });
});
