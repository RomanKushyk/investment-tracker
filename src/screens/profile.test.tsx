// @vitest-environment jsdom
// The profile, rendered through the real router, shell, client and relay over a fake of the user API
// and the relay's passkey list (`design/extensions/own-account.dc.html`, T1–T3 and T6).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import type { SignInDeps } from '../auth/sign-in';
import { uk } from '../i18n/messages';
import type { BotCheckProps } from './sign-in/BotCheck';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const rowsOfSeed = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});

// The API a page is served by, behind the one `fetch` the page was given; `hold` keeps a route's
// answer back until the test lets it go, and `fail` answers it 500.
let api: FakeApi;
const held = new Map<string, Promise<void>>();
const failing = new Set<string>();
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/relay/, '');
  await held.get(path);
  if (failing.has(path)) {
    return new Response('{"error":"internal"}', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
  return api.fetch(input, init);
});
function hold(path: string): () => void {
  let release!: () => void;
  held.set(path, new Promise<void>((r) => (release = r)));
  return () => {
    held.delete(path);
    release();
  };
}

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('__APP_VERSION__', '0.0.0');
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

// Whether Google sign-in is on, as a refresh would have said: the first refresh settles it for the
// page's life, so a test sets it here. `leaving` lends jsdom's host a listed site, which Cognito's
// logout returns to, and records where the page left for.
const google = vi.hoisted(() => ({ on: false }));
const leaving = vi.hoisted(() => ({ site: undefined as string | undefined, to: [] as string[] }));
vi.mock('../auth/app', async (original) => {
  const { throughLogout } = await import('../auth/signed-out');
  return {
    ...(await original<typeof import('../auth/app')>()),
    useGoogle: () => google.on,
    leaveThroughLogout: (logout: string | undefined, to: string) => {
      const out = throughLogout(logout, leaving.site, leaving.site ?? '', to);
      if (out === undefined) return false;
      leaving.to.push(out.url);
      return true;
    },
  };
});

// THE PROOF IS SIGN-IN'S, tested there: here each call answers as a case needs, and the widget's
// events are driven by hand, as SignIn.test does.
const signIn = vi.hoisted(() => ({ address: vi.fn(), password: vi.fn() }));
vi.mock('../auth/sign-in', async (original) => ({
  ...(await original<typeof import('../auth/sign-in')>()),
  signInWithAddress: signIn.address,
  signInWithPassword: signIn.password,
}));
const check = vi.hoisted(() => ({ props: undefined as BotCheckProps | undefined }));
vi.mock('./sign-in/BotCheck', () => ({
  BotCheck: (props: BotCheckProps) => {
    check.props = props;
    return <div data-bot-check />;
  },
}));

const writeText = vi.fn<(text: string) => Promise<void>>();
Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

beforeEach(async () => {
  api = fakeApi(rowsOfSeed(), { today: TODAY });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  google.on = false;
  leaving.site = undefined;
  leaving.to = [];
  check.props = undefined;
  signIn.address.mockReset();
  signIn.password.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  await session.respond({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  held.clear();
  failing.clear();
});

async function open(path = '/profile') {
  const client = new QueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await settle(client);
  return { client, view, router, main: () => view.container.querySelector('main')! };
}

async function settle(client: QueryClient) {
  await waitFor(() => expect(client.isFetching()).toBe(0));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });
  await waitFor(() => expect(client.isFetching()).toBe(0));
}

const wait = (ms: number) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = (el: Element) => el.textContent ?? '';
const p = uk.profile;

describe('the page', () => {
  it('shows the account, the data, the sessions and the sign-in, in that order', async () => {
    const { main } = await open();
    const page = text(main());
    const at = [p.sections.account, p.sections.data, 'Сеанси', p.sections.signIn].map((l) =>
      page.indexOf(l),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(page).toContain(ME_EMAIL);
    expect(page).toContain(ME_USER_ID);
    expect(page).toContain('28.07.2026');
    expect(page).toContain(String(SEED.assets.length));
    expect(page).toContain(String(SEED.transactions.length));
  });

  // The owner's rulings: every account holds a password while registration is closed, so the row
  // would have no varying source; a role is shown where it names a privilege.
  it('has no password row, and no role row for a plain user', async () => {
    const page = text((await open()).main());
    expect(page).not.toContain(p.role);
    expect(page).not.toContain('Пароль');
  });

  it('names the super-admin’s role', async () => {
    api.role = 'super_admin';
    const page = text((await open()).main());
    expect(page).toContain(p.role);
    expect(page).toContain(p.superAdmin);
  });

  it('shows the Google row only while Google sign-in is on', async () => {
    expect(text((await open()).main())).not.toContain(p.google);
    cleanup();
    google.on = true;
    api.googleLinked = true;
    const page = text((await open()).main());
    expect(page).toContain(p.google);
    expect(page).toContain(p.linked);
  });

  it('reads an empty dataset as 0, 0 and «—»', async () => {
    api.rows = { assets: [], transactions: [], prices: [] };
    const { main } = await open();
    const values = [...main().querySelectorAll('[data-fact]')].map((f) => [
      f.getAttribute('data-fact'),
      text(f.querySelector('dd')!),
    ]);
    expect(values).toEqual(
      expect.arrayContaining([
        ['assets', '0'],
        ['transactions', '0'],
        ['firstActivity', '—'],
      ]),
    );
  });

  it('leads to Settings by a link', async () => {
    const { main } = await open();
    const link = [...main().querySelectorAll('a')].find((a) => text(a) === p.copyData.open);
    expect(link?.getAttribute('href')).toBe('/settings');
  });
});

describe('the passkeys', () => {
  it('shows one card each, an empty name as «Ключ доступу», and the day it was made', async () => {
    api.passkeys = [
      { name: 'Roaming passkey', createdAt: '2026-10-22' },
      { name: '', createdAt: '2026-10-23' },
    ];
    const { main } = await open();
    const cards = [...main().querySelectorAll('[data-passkey]')].map(text);
    expect(cards).toEqual([
      `Roaming passkey${p.passkeys.created('22.10.2026')}`,
      `${p.passkeys.unnamed}${p.passkeys.created('23.10.2026')}`,
    ]);
  });

  it.each([
    ['none', [] as const, p.passkeys.none],
    ['a Google session', 'google' as const, p.passkeys.google],
    ['a failed read', 'failed' as const, p.passkeys.failed],
  ])('says so for %s, in a line that is announced', async (_, answer, note) => {
    api.passkeys = answer === 'google' || answer === 'failed' ? answer : [];
    const { main } = await open();
    const line = [...main().querySelectorAll('[role="status"]')].find((s) => text(s) === note);
    expect(line, `no status line reads ${note}`).toBeDefined();
    expect(main().querySelectorAll('[data-passkey]')).toHaveLength(0);
  });

  it('holds three rows while the list is out, and announces what lands', async () => {
    const release = hold('/auth/passkey/list');
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
    // Laid out unseen at first, as a read that answers soon shows nothing, then shown.
    const blocks = () => [...main().querySelectorAll('[data-placeholder="passkey"]')];
    expect(blocks()).toHaveLength(3);
    expect(blocks().every((b) => b.closest('.invisible') !== null)).toBe(true);
    await wait(400);
    expect(blocks().every((b) => b.closest('.invisible') === null)).toBe(true);
    const status = main().querySelector('[data-passkeys-note]');
    expect(status?.getAttribute('role')).toBe('status');
    release();
    await waitFor(() => expect(text(status!)).toBe(p.passkeys.none));
    expect(main().querySelectorAll('[data-placeholder="passkey"]')).toHaveLength(0);
  });

  // The account first: a list shown under an account still on its way moves the page as it lands.
  it('stays held until the account lands, whatever the list answered', async () => {
    api.passkeys = [{ name: 'Roaming passkey', createdAt: '2026-10-22' }];
    const release = hold('/me');
    const client = new QueryClient();
    const router = createMemoryRouter(routes, { initialEntries: ['/profile'] });
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(api.passkeyLists).toBe(1));
    await wait(400);
    const main = view.container.querySelector('main')!;
    expect(main.querySelectorAll('[data-placeholder="passkey"]')).toHaveLength(3);
    expect(main.querySelectorAll('[data-passkey]')).toHaveLength(0);
    release();
    await waitFor(() => expect(main.querySelectorAll('[data-passkey]')).toHaveLength(1));
  });

  // The list changes only from another device's sign-in, which this tab cannot learn of.
  it('is read again on every visit', async () => {
    const { router, client } = await open();
    expect(api.passkeyLists).toBe(1);
    await act(() => router.navigate('/settings'));
    await act(() => router.navigate('/profile'));
    await settle(client);
    expect(api.passkeyLists).toBe(2);
  });
});

describe('the account read', () => {
  it('shows nothing new for 300 ms, then holds every value and every control', async () => {
    const release = hold('/me');
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await wait(100);
    expect(text(main())).toBe('');
    await wait(300);
    expect(text(main())).toContain(p.sections.account);
    expect(main().querySelectorAll('[data-dash]').length).toBeGreaterThan(0);
    expect(text(main())).not.toContain(ME_EMAIL);
    expect(main().querySelectorAll('a, button')).toHaveLength(0);
    release();
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
  });

  // Once shown, the boxes stay their own while at least, so their fade-in always completes.
  it('keeps the held boxes for a while once shown, even when the read lands at once', async () => {
    const release = hold('/me');
    const view = render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/profile'] })} />
      </QueryClientProvider>,
    );
    const main = () => view.container.querySelector('main')!;
    await wait(350);
    expect(main().querySelectorAll('[data-dash]').length).toBeGreaterThan(0);
    release();
    await wait(100);
    expect(text(main())).not.toContain(ME_EMAIL);
    await waitFor(() => expect(text(main())).toContain(ME_EMAIL));
  });

  it('that fails shows the failed-screen state inside the shell', async () => {
    failing.add('/me');
    const { main, view } = await open();
    expect(text(main())).toContain(uk.boundary.failed.title);
    // The shell stands: the sidebar is still there around it.
    expect(view.container.querySelector('#app-sidebar')).not.toBeNull();
  });

  it('is not made, and nothing shows, when nobody is signed in', async () => {
    await session.signOut();
    const { main } = await open();
    // Past the hold, after which a page that were made would show its held boxes.
    await wait(400);
    expect(text(main())).toBe('');
    expect(api.seen.filter((r) => r.path === '/me')).toHaveLength(0);
    expect(api.passkeyLists).toBe(0);
  });
});

describe('copying the account ID', () => {
  const copyButton = (main: Element) =>
    [...main.querySelectorAll('button')].find((b) => text(b).includes(p.copy))!;

  it('writes it, reads «Скопійовано» for 2 s once written, and announces it', async () => {
    const { main } = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const button = copyButton(main());
    await act(async () => void fireEvent.click(button));
    expect(writeText).toHaveBeenCalledWith(ME_USER_ID);
    expect(text(button)).toBe(p.copied);
    const status = main().querySelector('[data-copy-status]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(text(status)).toBe(p.copiedStatus);
    act(() => void vi.advanceTimersByTime(1999));
    expect(text(button)).toBe(p.copied);
    act(() => void vi.advanceTimersByTime(1));
    expect(text(button)).toBe(p.copy);
    expect(text(status)).toBe('');
  });

  // Primer's copy pattern: never a silent failure, and the value left selected to copy by hand.
  it('that the browser refuses says so for 2 s, announced, with the ID selected', async () => {
    writeText.mockRejectedValue(new DOMException('blocked', 'NotAllowedError'));
    const { main } = await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const button = copyButton(main());
    await act(async () => void fireEvent.click(button));
    expect(text(button)).toBe(p.copyFailed);
    expect(text(main().querySelector('[data-copy-status]')!)).toBe(p.copyFailedStatus);
    expect(document.getSelection()?.toString()).toBe(ME_USER_ID);
    act(() => void vi.advanceTimersByTime(2000));
    expect(text(button)).toBe(p.copy);
  });
});

// «Вийти на всіх пристроях» (`own-account.dc.html` T1, T4; `re-authentication.dc.html` T1–T4,
// T5's confirmed state without its timer, T6's refusal), the copy character for character (T9).
describe('signing out everywhere', () => {
  const E = {
    open: 'Вийти всюди…',
    confirmTitle: 'Вийти на всіх пристроях?',
    confirmBody:
      'Вхід завершиться на кожному пристрої, зокрема на цьому. Далі підтвердьте, що це ви.',
    cancel: 'Скасувати',
    proceed: 'Продовжити',
    title: 'Підтвердьте, що це ви',
    lead: 'Перш ніж вийти на всіх пристроях, підтвердьте вхід.',
    confirm: 'Підтвердити',
    checking: 'Перевіряємо…',
    passkeyTitle: 'Підтвердьте ключем доступу',
    usePassword: 'Підтвердити паролем',
    notFinished:
      'Підтвердження ключем доступу не завершено: його скасовано, або на цьому пристрої немає ключа для цієї адреси.',
    retry: 'Спробувати ще раз',
    passwordTitle: 'Введіть пароль',
    missing: 'Вкажіть пароль.',
    wrong: 'Неправильний пароль.',
    tooMany: 'Забагато спроб. Спробуйте пізніше.',
    pending: 'Перевірка безпеки ще триває. Спробуйте ще раз за мить.',
    busy: 'Виходимо…',
    confirmedTitle: 'Ви підтвердили, що це ви',
    confirmedLead: 'Тепер можна вийти на всіх пристроях, зокрема на цьому.',
    action: 'Вийти всюди',
    failed: 'Не вдалося вийти на всіх пристроях. Спробуйте ще раз.',
    expired: 'Час на підтвердження минув. Підтвердьте ще раз.',
  };
  const LOGOUT = 'https://auth.dev.quirenote.com/logout?client_id=c';
  const SITE = 'https://dev.quirenote.com';

  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  const buttonIn = (root: ParentNode | null, name: string) =>
    [...(root?.querySelectorAll('button') ?? [])].find((b) => text(b) === name);
  const press = async (el: HTMLElement | undefined) => {
    expect(el, 'nothing to press').toBeDefined();
    el!.focus();
    await act(async () => void fireEvent.click(el!));
  };
  const pass = (token = 'token') => act(() => check.props!.onToken(token));
  const alerts = () => [...(dialog()?.querySelectorAll('[role="alert"]') ?? [])].map(text);
  const statuses = () => [...(dialog()?.querySelectorAll('[role="status"]') ?? [])].map(text);

  /** The page, the confirmation, and «Продовжити»: the first state. */
  async function toTheStep() {
    const view = await open();
    await press(buttonIn(view.main(), E.open));
    await press(buttonIn(dialog(), E.proceed));
    return view;
  }
  /** The first state passed and pressed, answered with no passkey: the password step. */
  async function toThePassword() {
    signIn.address.mockResolvedValue({ kind: 'password', email: ME_EMAIL });
    const view = await toTheStep();
    pass();
    await press(buttonIn(dialog(), E.confirm));
    await waitFor(() => expect(text(dialog()!)).toContain(E.passwordTitle));
    return view;
  }
  async function typeAndConfirm(password = 'secret') {
    const field = dialog()!.querySelector<HTMLInputElement>('input[type="password"]')!;
    fireEvent.change(field, { target: { value: password } });
    pass();
    await press(buttonIn(dialog(), E.confirm));
  }

  it('stands in a «Сеанси» card, whose outline button opens the confirmation', async () => {
    const { main } = await open();
    const card = [...main().querySelectorAll('section, div')].find(
      (c) => text(c).startsWith('Сеанси') && buttonIn(c, E.open),
    );
    expect(card, 'no «Сеанси» card holds «Вийти всюди…»').toBeDefined();
    expect(text(card!)).toContain('Вийти на всіх пристроях');
    expect(dialog()).toBeNull();
    await press(buttonIn(main(), E.open));
    expect(text(dialog()!)).toContain(E.confirmTitle);
    expect(text(dialog()!)).toContain(E.confirmBody);
    // At and above md the drawn order, «Скасувати» then «Продовжити».
    expect([...dialog()!.querySelectorAll('button')].map(text)).toEqual([E.cancel, E.proceed]);
  });

  it('closes on «Скасувати» and sends nothing', async () => {
    const { main } = await open();
    await press(buttonIn(main(), E.open));
    await press(buttonIn(dialog(), E.cancel));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(api.everywhereSent).toEqual([]);
  });

  it('swaps to the first state: the address shown, the check, its heading focused', async () => {
    await toTheStep();
    const panel = dialog()!;
    expect(text(panel)).toContain(E.title);
    expect(text(panel)).toContain(E.lead);
    expect(text(panel)).toContain(ME_EMAIL);
    expect(panel.querySelector('[data-bot-check]')).not.toBeNull();
    expect(check.props?.action).toBe('sign-in');
    expect(document.activeElement?.textContent).toBe(E.title);
    expect(signIn.address).not.toHaveBeenCalled();
  });

  it('refuses a press before the check’s token, and sends nothing', async () => {
    await toTheStep();
    await press(buttonIn(dialog(), E.confirm));
    expect(alerts()).toContain(E.pending);
    expect(signIn.address).not.toHaveBeenCalled();
  });

  it('opens the passkey sheet for the account’s own address; cancelled, says so with a retry', async () => {
    let finish!: (outcome: unknown) => void;
    signIn.address.mockImplementation(
      (_: string, __: string, ___: SignInDeps, onPasskey: (email: string) => unknown) => {
        onPasskey(ME_EMAIL);
        return new Promise((resolve) => (finish = resolve));
      },
    );
    await toTheStep();
    pass('t1');
    await press(buttonIn(dialog(), E.confirm));
    expect(signIn.address).toHaveBeenCalledWith(
      ME_EMAIL,
      't1',
      expect.anything(),
      expect.any(Function),
    );
    await waitFor(() => expect(text(dialog()!)).toContain(E.passkeyTitle));
    expect(buttonIn(dialog(), E.usePassword)).toBeDefined();
    await act(async () => finish({ kind: 'refused', reason: 'notFinished' }));
    expect(alerts()).toContain(E.notFinished);
    expect(buttonIn(dialog(), E.retry)).toBeDefined();
    await press(buttonIn(dialog(), E.usePassword));
    expect(text(dialog()!)).toContain(E.passwordTitle);
  });

  it('refuses an empty password on its field, sending nothing', async () => {
    await toThePassword();
    await press(buttonIn(dialog(), E.confirm));
    const field = dialog()!.querySelector('input[type="password"]')!;
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(text(dialog()!)).toContain(E.missing);
    expect(signIn.password).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong', E.wrong],
    ['tooMany', E.tooMany],
  ] as const)('says a %s refusal under the row, the password kept', async (reason, sentence) => {
    await toThePassword();
    signIn.password.mockResolvedValue({ kind: 'refused', reason });
    await typeAndConfirm('kept');
    expect(signIn.password).toHaveBeenCalledWith(ME_EMAIL, 'kept', 'token', expect.anything());
    await waitFor(() => expect(alerts()).toContain(sentence));
    expect(dialog()!.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe('kept');
    expect(api.everywhereSent).toEqual([]);
  });

  // RFC 9470 §3: the client repeats the request with the fresh sign-in; no second press (T10).
  it('signs out everywhere at once once the password proves it, and lands signed out', async () => {
    const view = await toThePassword();
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const release = hold('/auth/sign-out/global');
    await typeAndConfirm();
    await waitFor(() => expect(buttonIn(dialog(), E.busy)).toBeDefined());
    const confirm = buttonIn(dialog(), E.busy);
    expect(confirm, '«Підтвердити» does not read «Виходимо…»').toBeDefined();
    // Busy without `disabled`, which would drop focus to the page (T10).
    expect(confirm!.disabled).toBe(false);
    expect(confirm!.getAttribute('aria-disabled')).toBe('true');
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(buttonIn(dialog(), E.cancel)!.getAttribute('aria-disabled')).toBe('true');
    // A sent sign-out cannot be recalled: Escape is inert while it runs.
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    expect(dialog()).not.toBeNull();
    release();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sign-in'));
    // Arrived as a sign-out: `/sign-in` says so, and uses the entry's state up.
    await waitFor(() => expect(text(view.view.container)).toContain(uk.auth.signedOut));
    expect(api.everywhereSent).toEqual([{ sub: ME_USER_ID }]);
    expect(session.status()).toBe('signedOut');
  });

  it('runs the action at once after a passkey, the status in the lead’s line', async () => {
    signIn.address.mockImplementation(
      async (_: string, __: string, ___: SignInDeps, onPasskey: (email: string) => unknown) => {
        onPasskey(ME_EMAIL);
        return { kind: 'signedIn', offerPasskey: false };
      },
    );
    const release = hold('/auth/sign-out/global');
    const view = await toTheStep();
    pass();
    await press(buttonIn(dialog(), E.confirm));
    await waitFor(() => expect(statuses()).toContain(E.busy));
    expect(buttonIn(dialog(), E.usePassword)!.getAttribute('aria-disabled')).toBe('true');
    release();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sign-in'));
  });

  // GOOGLE ON: this device leaves through Cognito's logout, the only way its session cookie goes.
  it('leaves through Cognito’s logout when the answer names one', async () => {
    api.logout = LOGOUT;
    leaving.site = SITE;
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const view = await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(leaving.to).toHaveLength(1));
    const url = new URL(leaving.to[0]!);
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.dev.quirenote.com/logout');
    expect(url.searchParams.get('logout_uri')).toBe(`${SITE}/sign-in`);
    expect(view.router.state.location.pathname).toBe('/profile');
  });

  it('lands signed out when the session was already over here', async () => {
    api.everywhere = ['endedHere'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const view = await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sign-in'));
    expect(session.status()).toBe('signedOut');
  });

  // ANOTHER TAB SIGNED THIS BROWSER OUT while the dialog waited: one refresh says so.
  it('lands signed out after a plain refusal whose refresh is refused', async () => {
    api.everywhere = ['cookieGone'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const view = await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sign-in'));
    expect(session.status()).toBe('signedOut');
  });

  // Back from Cognito's logout the page may be restored as it left, signed out: the dialog goes.
  it('closes on a back/forward restore once the page had set out', async () => {
    api.logout = LOGOUT;
    leaving.site = SITE;
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(leaving.to).toHaveLength(1));
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => void window.dispatchEvent(restored));
    await waitFor(() => expect(dialog()).toBeNull());
  });

  // A back/forward restore of a page still signed in keeps the dialog and its proof.
  it('stays open through a back/forward restore while nothing has left', async () => {
    api.everywhere = ['failed'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(buttonIn(dialog(), E.action)).toBeDefined());
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    act(() => void window.dispatchEvent(restored));
    await wait(50);
    expect(dialog()).not.toBeNull();
  });

  // A FAILED ACTION KEEPS THE PROOF: the confirmed state, and «Вийти всюди» retries it (T5).
  it('lands a failed action on the confirmed state, whose press retries it', async () => {
    api.everywhere = ['failed'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const view = await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(text(dialog()!)).toContain(E.confirmedTitle));
    expect(text(dialog()!)).toContain(E.confirmedLead);
    expect(alerts()).toContain(E.failed);
    expect(session.status()).toBe('signedIn');
    await press(buttonIn(dialog(), E.action));
    await waitFor(() => expect(view.router.state.location.pathname).toBe('/sign-in'));
    expect(api.everywhereSent).toHaveLength(2);
    expect(signIn.password).toHaveBeenCalledTimes(1);
  });

  // T6: a press the server refuses as too old returns to the first state, said as a status.
  it('returns to the first state when the sign-in is too old', async () => {
    api.everywhere = ['failed', 'tooOld'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(buttonIn(dialog(), E.action)).toBeDefined());
    await press(buttonIn(dialog(), E.action));
    await waitFor(() => expect(statuses()).toContain(E.expired));
    expect(text(dialog()!)).toContain(E.title);
    expect(text(dialog()!)).toContain(E.lead);
    expect(session.status()).toBe('signedIn');
  });

  // A STOP while Cognito's logout loads leaves the page here, signed out: the dialog can go.
  it('lets go once the page that set out for the logout stays', async () => {
    api.logout = LOGOUT;
    leaving.site = SITE;
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    const navigation = new EventTarget();
    vi.stubGlobal('navigation', navigation);
    try {
      await toThePassword();
      await typeAndConfirm();
      await waitFor(() => expect(leaving.to).toHaveLength(1));
      expect(dialog()).not.toBeNull();
      act(() => void navigation.dispatchEvent(new Event('navigateerror')));
      await waitFor(() => expect(dialog()).toBeNull());
    } finally {
      vi.stubGlobal('navigation', undefined);
    }
  });

  // No Navigation API to say so: Escape is the way out once nothing is left to send.
  it('closes on Escape once the sign-out has finished and the page has not left', async () => {
    api.logout = LOGOUT;
    leaving.site = SITE;
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(leaving.to).toHaveLength(1));
    fireEvent.keyDown(dialog()!, { key: 'Escape' });
    await waitFor(() => expect(dialog()).toBeNull());
  });

  // A touch screen has no Escape: once nothing is left to send, «Скасувати» is the way out.
  it('frees «Скасувати» once the page has set out', async () => {
    api.logout = LOGOUT;
    leaving.site = SITE;
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(leaving.to).toHaveLength(1));
    const cancel = buttonIn(dialog(), E.cancel)!;
    expect(cancel.getAttribute('aria-disabled')).not.toBe('true');
    await press(cancel);
    await waitFor(() => expect(dialog()).toBeNull());
  });

  // Another account ends the run too: the proof still out lands nowhere.
  it('ends a proof still out when the tab’s account changes', async () => {
    let finish!: (outcome: unknown) => void;
    await toThePassword();
    signIn.password.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await typeAndConfirm();
    api.claims = { sub: 'another-account', email: 'b@example.com' };
    await act(async () => void (await session.respond({})));
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => finish({ kind: 'signedIn', offerPasskey: false }));
    await wait(50);
    expect(api.everywhereSent).toEqual([]);
  });

  // T10: focus stays on the pressed button; the heading takes it only when a step arrives.
  it('keeps focus on «Підтвердити» pressed after a too-old return', async () => {
    api.everywhere = ['failed', 'tooOld'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(buttonIn(dialog(), E.action)).toBeDefined());
    await press(buttonIn(dialog(), E.action));
    await waitFor(() => expect(statuses()).toContain(E.expired));
    signIn.address.mockImplementation(() => new Promise(() => {}));
    pass();
    await press(buttonIn(dialog(), E.confirm));
    expect(document.activeElement?.textContent).toBe(E.checking);
  });

  // THE PROOF WAS ONE ACCOUNT'S: another one in this tab ends the dialog, so its retry cannot
  // sign the other out everywhere.
  it('closes when the tab’s account changes, and sends nothing for the new one', async () => {
    api.everywhere = ['failed'];
    signIn.password.mockResolvedValue({ kind: 'signedIn', offerPasskey: false });
    await toThePassword();
    await typeAndConfirm();
    await waitFor(() => expect(buttonIn(dialog(), E.action)).toBeDefined());
    api.claims = { sub: 'another-account', email: 'b@example.com' };
    await act(async () => void (await session.respond({})));
    await waitFor(() => expect(dialog()).toBeNull());
    expect(api.everywhereSent).toEqual([{ sub: ME_USER_ID }]);
  });

  // A start that answers after the dialog closed opens no sheet over the page it left.
  it('opens no passkey sheet for a start that answers after the dialog closed', async () => {
    let answer!: () => void;
    const opened: unknown[] = [];
    signIn.address.mockImplementation(
      (_: string, __: string, ___: SignInDeps, onPasskey: (email: string) => unknown) =>
        new Promise((resolve) => {
          answer = () => {
            opened.push(onPasskey(ME_EMAIL));
            resolve({ kind: 'refused', reason: 'notFinished' });
          };
        }),
    );
    await toTheStep();
    pass();
    await press(buttonIn(dialog(), E.confirm));
    await press(buttonIn(dialog(), E.cancel));
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => answer());
    expect(opened).toEqual([false]);
  });

  // «Скасувати» stays live while a proof is checked; a late answer lands nowhere (T1).
  it('closes while a proof is checked, and the late answer sends nothing', async () => {
    let finish!: (outcome: unknown) => void;
    await toThePassword();
    signIn.password.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    await typeAndConfirm();
    expect(buttonIn(dialog(), E.checking)).toBeDefined();
    const cancel = buttonIn(dialog(), E.cancel)!;
    expect(cancel.getAttribute('aria-disabled')).not.toBe('true');
    await press(cancel);
    await waitFor(() => expect(dialog()).toBeNull());
    await act(async () => finish({ kind: 'signedIn', offerPasskey: false }));
    await wait(50);
    expect(api.everywhereSent).toEqual([]);
  });
});
