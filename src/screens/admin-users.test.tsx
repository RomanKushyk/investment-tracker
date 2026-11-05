// @vitest-environment jsdom
// Користувачі at /admin/users through the real router, shell and client over a fake of the user API
// (`design/extensions/admin-users.dc.html`, T1–T5 and T7).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fakeApi,
  ME_EMAIL,
  ME_USER_ID,
  type Canned,
  type FakeApi,
  type FakeUser,
} from '../__fixtures__/fake-api';
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
// Desktop unless a test says otherwise. A getter, since `useIsDesktop` keeps the first list it gets.
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
// Radix's Select asks for these, which jsdom does not carry.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

// The copy the drawing names (T1, T3, T4, T5 and T7), written out so the test pins the words.
const NAV = 'Користувачі';
const FILTER = { pending: 'Заявки', active: 'Активні', disabled: 'Вимкнені' } as const;
const EMPTY_PENDING = 'Нових заявок немає.';
const EMPTY_DISABLED = 'Вимкнених облікових записів немає.';
const YOU = 'Ви';
const MORE = 'Показати ще';
const FAILED = 'Не вдалося прочитати список';
const RETRY = 'Спробувати ще раз';
const CANCEL = 'Скасувати';
const ACTION = {
  approve: 'Схвалити',
  decline: 'Відхилити',
  disable: 'Вимкнути',
  enable: 'Увімкнути',
  delete: 'Видалити',
} as const;
const TITLE = {
  approve: 'Схвалити заявку?',
  decline: 'Відхилити заявку?',
  disable: 'Вимкнути обліковий запис?',
  enable: 'Увімкнути обліковий запис?',
  delete: 'Видалити обліковий запис?',
} as const;
const SENTENCE = {
  self: 'Свій обліковий запис тут не змінити.',
  demo: 'Демо-запис звідси не змінюють.',
  not_found: 'Цього запису вже немає.',
  already_decided_application: 'Цю заявку вже розглянуто.',
  already_decided_disable: 'Обліковий запис уже вимкнено.',
  already_decided_enable: 'Обліковий запис уже ввімкнено.',
  unclaimed_identity:
    'Цю адресу тримає непідтверджена реєстрація в Cognito. Видаліть її в консолі, тоді схваліть знову.',
  undecided: 'Це ще заявка: її схвалюють або відхиляють.',
  invalid_request: 'Сервер не прийняв запит.',
  internal: 'Сервер не впорався. Спробуйте ще раз.',
  internal_disable:
    'Сервер не впорався. Якщо запис уже серед вимкнених, його сеанси могли лишитися відкритими.',
  internal_decline:
    'Сервер не впорався. Якщо заявки вже немає в списку, її реєстрацію в Cognito треба видалити в консолі.',
  internal_delete: 'Видалення не завершилося. Видаліть ще раз — воно продовжиться з місця зупинки.',
  throttled: 'Забагато дій поспіль. Спробуйте за мить.',
  network: 'Сервер не відповів. Дія могла дійти — перевірте список.',
} as const;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const stamp = (iso: string) => `${iso}.000000Z`;
const user = (n: number, email: string, status: FakeUser['status'], applied: string): FakeUser => ({
  id: uuid(n),
  email,
  status,
  appliedAt: stamp(applied),
  decidedAt: status === 'pending' ? null : stamp(applied),
});
// Out of order on purpose: the route serves them oldest first.
const SEEDED = (): FakeUser[] => [
  user(2, 'm.shevchenko@example.net', 'pending', '2026-11-02T18:05:44'),
  user(1, 'olena.koval@example.com', 'pending', '2026-10-29T07:42:10'),
  user(3, 'ivan.bondarenko@example.org', 'pending', '2026-11-04T09:13:27'),
  { ...user(0, ME_EMAIL, 'active', '2026-03-02T10:00:00'), id: ME_USER_ID },
  user(11, 'roman.portfolio@example.com', 'active', '2026-10-21T12:30:00'),
  user(21, 'test.account@example.com', 'rejected', '2026-10-08T06:20:00'),
];
const pendingMany = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    user(
      100 + i,
      `applicant${i}@example.com`,
      'pending',
      `2026-10-01T10:${String(i % 60).padStart(2, '0')}:00`,
    ),
  );

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-11-05' });
  api.role = 'super_admin';
  api.users = SEEDED();
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
  wide = true;
});
afterEach(cleanup);

function mount(path = '/admin/users') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const main = () => view.container.querySelector('main')!;
  const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
  return {
    router,
    main: () => main()?.textContent ?? '',
    dialog,
    /** The row action named `{action} {email}`. */
    /** A press, which focuses the button in a browser and not in jsdom. */
    act: (action: keyof typeof ACTION, email: string) => {
      const button = within(main()).getByRole('button', { name: `${ACTION[action]} ${email}` });
      button.focus();
      fireEvent.click(button);
    },
    /** The dialog's armed action. */
    confirm: (action: keyof typeof ACTION) =>
      fireEvent.click(within(dialog()!).getByRole('button', { name: ACTION[action] })),
    /** Picks a filter through the header's Select, by keyboard as Radix answers in jsdom. */
    filter: async (to: keyof typeof FILTER) => {
      const trigger = within(main()).getByRole('combobox');
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      const option = await waitFor(() => {
        const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
          (o) => o.textContent === FILTER[to],
        );
        if (found === undefined) throw new Error('the list is not open');
        return found;
      });
      fireEvent.keyDown(option, { key: 'Enter' });
    },
    navLink: () =>
      [...document.querySelectorAll<HTMLAnchorElement>('#app-sidebar a[href="/admin/users"]')][0],
  };
}

const listReads = () =>
  api.seen.filter((s) => s.method === 'GET' && s.path.startsWith('/admin/users?'));
const writes = () =>
  api.seen.filter((s) => s.method !== 'GET' && s.path.startsWith('/admin/users/'));
const order = (text: string, emails: string[]) => emails.map((e) => text.indexOf(e));
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));

describe('/admin/users, the gate', () => {
  it('is the app’s not-found for a user, which sends no /admin/* request', async () => {
    api.role = 'user';
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
    await settle();
    expect(page.main()).not.toContain(FILTER.pending);
    expect(api.seen.some((s) => s.path.startsWith('/admin/'))).toBe(false);
  });

  it('renders the not-found when the list answers a gate key', async () => {
    // The list's read and the count's, both refused by the gate.
    api.userReads = [
      { status: 403, body: { error: 'terms' } },
      { status: 403, body: { error: 'terms' } },
    ];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
  });
});

describe('/admin/users, the three filters (T1) and the count (T2)', () => {
  it('opens on Заявки, oldest first, with the count on the pill read as one page of 100', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    const text = page.main();
    const at = order(text, [
      'olena.koval@example.com',
      'm.shevchenko@example.net',
      'ivan.bondarenko@example.org',
    ]);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).not.toContain('roman.portfolio@example.com');
    expect(text).toContain('29.10.2026, 09:42');
    expect(within(document.querySelector('main')!).getByRole('combobox').textContent).toContain(
      FILTER.pending,
    );
    await waitFor(() => expect(page.navLink()?.getAttribute('aria-label')).toBe(`${NAV}, 3`));
    expect(page.navLink()!.textContent).toContain('3');
    expect(
      listReads()
        .map((s) => s.path)
        .sort(),
    ).toEqual(
      ['/admin/users?status=pending&limit=50', '/admin/users?status=pending&limit=100'].sort(),
    );
    // «Користувачі» stands above «Архів цін».
    const links = [...document.querySelectorAll('#app-sidebar a[href]')].map((a) =>
      a.getAttribute('href'),
    );
    expect(links.indexOf('/admin/users')).toBeLessThan(links.indexOf('/admin/archive'));
  });

  it('lists Активні with your own row as «Ви» and no action, and Вимкнені with its decision', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await page.filter('active');
    await waitFor(() => expect(page.main()).toContain('roman.portfolio@example.com'));
    expect(page.main()).toContain(ME_EMAIL);
    expect(page.main()).toContain(YOU);
    const main = within(document.querySelector('main')!);
    expect(main.queryByRole('button', { name: new RegExp(ME_EMAIL) })).toBeNull();
    expect(main.getByRole('button', { name: `${ACTION.disable} roman.portfolio@example.com` }));
    expect(main.getByRole('button', { name: `${ACTION.delete} roman.portfolio@example.com` }));
    expect(page.main()).not.toContain('olena.koval@example.com');

    await page.filter('disabled');
    await waitFor(() => expect(page.main()).toContain('test.account@example.com'));
    expect(page.main()).toContain('Рішення');
    expect(main.getByRole('button', { name: `${ACTION.enable} test.account@example.com` }));
    expect(main.getByRole('button', { name: `${ACTION.delete} test.account@example.com` }));
  });

  it('says so when Заявки and Вимкнені are empty, and draws no count', async () => {
    api.users = SEEDED().filter((u) => u.status === 'active');
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(EMPTY_PENDING));
    await settle();
    expect(page.navLink()?.getAttribute('aria-label') ?? NAV).toBe(NAV);
    expect(page.navLink()!.textContent).toBe(NAV);
    await page.filter('disabled');
    await waitFor(() => expect(page.main()).toContain(EMPTY_DISABLED));
  });

  it('makes 100 waiting applications «99+», named «понад 99»', async () => {
    api.users = [...SEEDED(), ...pendingMany(97)];
    const page = mount();
    await waitFor(() =>
      expect(page.navLink()?.getAttribute('aria-label')).toBe(`${NAV}, понад 99`),
    );
    expect(page.navLink()!.textContent).toContain('99+');
  });

  it('ends a list past 50 rows with «Показати ще», which appends the next page', async () => {
    api.users = [...SEEDED(), ...pendingMany(57)];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('applicant0@example.com'));
    expect(page.main()).not.toContain('ivan.bondarenko@example.org');
    fireEvent.click(within(document.querySelector('main')!).getByRole('button', { name: MORE }));
    await waitFor(() => expect(page.main()).toContain('ivan.bondarenko@example.org'));
    expect(page.main()).toContain('applicant0@example.com');
    expect(
      within(document.querySelector('main')!).queryByRole('button', { name: MORE }),
    ).toBeNull();
  });

  it('names the count on the burger below md while the drawer is shut', async () => {
    wide = false;
    mount();
    await waitFor(() =>
      expect(document.getElementById('app-nav-trigger')?.getAttribute('aria-label')).toBe(
        'Відкрити навігацію, заявок: 3',
      ),
    );
  });
});

type Act = keyof typeof ACTION;
const CASES: {
  act: Act;
  email: string;
  filter: keyof typeof FILTER;
  method: string;
  path: string;
}[] = [
  {
    act: 'approve',
    email: 'olena.koval@example.com',
    filter: 'pending',
    method: 'POST',
    path: `/admin/users/${uuid(1)}/approve`,
  },
  {
    act: 'decline',
    email: 'olena.koval@example.com',
    filter: 'pending',
    method: 'POST',
    path: `/admin/users/${uuid(1)}/reject`,
  },
  {
    act: 'disable',
    email: 'roman.portfolio@example.com',
    filter: 'active',
    method: 'POST',
    path: `/admin/users/${uuid(11)}/reject`,
  },
  {
    act: 'enable',
    email: 'test.account@example.com',
    filter: 'disabled',
    method: 'POST',
    path: `/admin/users/${uuid(21)}/enable`,
  },
  {
    act: 'delete',
    email: 'roman.portfolio@example.com',
    filter: 'active',
    method: 'DELETE',
    path: `/admin/users/${uuid(11)}`,
  },
];

async function open(page: ReturnType<typeof mount>, c: (typeof CASES)[number]) {
  await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
  if (c.filter !== 'pending') {
    await page.filter(c.filter);
    await waitFor(() => expect(page.main()).toContain(c.email));
  }
  page.act(c.act, c.email);
  await waitFor(() => expect(page.dialog()?.textContent).toContain(TITLE[c.act]));
  if (c.act === 'delete') {
    const field = within(page.dialog()!).getByLabelText(uk.danger.typeToConfirm(c.email));
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: c.email } });
  }
}

describe('/admin/users, the five confirmations (T4)', () => {
  for (const c of CASES) {
    it(`${c.act}: confirms naming the address, calls its route once, and reads the list again from the start`, async () => {
      const page = mount();
      await open(page, c);
      expect(page.dialog()!.textContent).toContain(c.email);
      const before = listReads().length;
      page.confirm(c.act);
      await waitFor(() => expect(page.dialog()).toBeNull());
      expect(writes().map((s) => `${s.method} ${s.path}`)).toEqual([`${c.method} ${c.path}`]);
      await waitFor(() => expect(listReads().length).toBeGreaterThanOrEqual(before + 2));
      const after = listReads()
        .slice(before)
        .map((s) => s.path);
      expect(after.every((p) => !p.includes('cursor='))).toBe(true);
      expect(after).toContain('/admin/users?status=pending&limit=100');
      await waitFor(() => expect(page.main()).not.toContain(c.email));
    });
  }

  it('opens on Cancel, and Cancel sends nothing', async () => {
    const page = mount();
    await open(page, CASES[0]);
    expect(document.activeElement?.textContent).toBe(CANCEL);
    fireEvent.click(within(page.dialog()!).getByRole('button', { name: CANCEL }));
    await waitFor(() => expect(page.dialog()).toBeNull());
    expect(writes()).toEqual([]);
  });

  it('keeps delete gated until the field holds the address', async () => {
    const page = mount();
    const c = CASES[4];
    await open(page, { ...c, act: 'delete' });
    const field = within(page.dialog()!).getByLabelText(uk.danger.typeToConfirm(c.email));
    fireEvent.change(field, { target: { value: 'roman' } });
    const button = within(page.dialog()!).getByRole('button', { name: ACTION.delete });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    await settle();
    expect(writes()).toEqual([]);
  });

  it('keeps the action’s word while it is on its way, aria-disabled, and sends it once', async () => {
    let release!: () => void;
    api.holdRuling = new Promise<void>((r) => (release = r));
    const page = mount();
    await open(page, CASES[0]);
    page.confirm('approve');
    page.confirm('approve');
    const button = within(page.dialog()!).getByRole('button', { name: ACTION.approve });
    await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
    expect(writes()).toHaveLength(1);
    release();
    await waitFor(() => expect(page.dialog()).toBeNull());
  });

  it('reads only the first page again after a ruling made past it', async () => {
    api.users = [...SEEDED(), ...pendingMany(57)];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('applicant0@example.com'));
    fireEvent.click(within(document.querySelector('main')!).getByRole('button', { name: MORE }));
    await waitFor(() => expect(page.main()).toContain('ivan.bondarenko@example.org'));
    page.act('approve', 'ivan.bondarenko@example.org');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    const before = listReads().length;
    page.confirm('approve');
    await waitFor(() => expect(page.dialog()).toBeNull());
    await waitFor(() => expect(page.main()).not.toContain('ivan.bondarenko@example.org'));
    await settle();
    expect(
      listReads()
        .slice(before)
        .some((s) => s.path.includes('cursor=')),
    ).toBe(false);
  });
});

// Every row of T5's table: the action, its answer, the drawn sentence, the key, and whether the
// action stays armed for a retry.
const REFUSALS: { act: Act; answer: Canned; sentence: string; key?: string; armed: boolean }[] = [
  {
    act: 'approve',
    answer: { status: 400, body: { error: 'invalid_request' } },
    sentence: SENTENCE.invalid_request,
    key: 'invalid_request',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 409, body: { error: 'self' } },
    sentence: SENTENCE.self,
    key: 'self',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 404, body: { error: 'not_found' } },
    sentence: SENTENCE.not_found,
    key: 'not_found',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 409, body: { error: 'demo' } },
    sentence: SENTENCE.demo,
    key: 'demo',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 409, body: { error: 'already_decided' } },
    sentence: SENTENCE.already_decided_application,
    key: 'already_decided',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 409, body: { error: 'unclaimed_identity' } },
    sentence: SENTENCE.unclaimed_identity,
    key: 'unclaimed_identity',
    armed: true,
  },
  {
    act: 'approve',
    answer: { status: 500, body: { error: 'internal' } },
    sentence: SENTENCE.internal,
    key: 'internal',
    armed: true,
  },
  {
    act: 'decline',
    answer: { status: 409, body: { error: 'already_decided' } },
    sentence: SENTENCE.already_decided_application,
    key: 'already_decided',
    armed: false,
  },
  {
    act: 'decline',
    answer: { status: 500, body: { error: 'internal' } },
    sentence: SENTENCE.internal_decline,
    key: 'internal',
    armed: true,
  },
  {
    act: 'disable',
    answer: { status: 409, body: { error: 'already_decided' } },
    sentence: SENTENCE.already_decided_disable,
    key: 'already_decided',
    armed: false,
  },
  {
    act: 'disable',
    answer: { status: 500, body: { error: 'internal' } },
    sentence: SENTENCE.internal_disable,
    key: 'internal',
    armed: true,
  },
  {
    act: 'enable',
    answer: { status: 409, body: { error: 'undecided' } },
    sentence: SENTENCE.undecided,
    key: 'undecided',
    armed: false,
  },
  {
    act: 'enable',
    answer: { status: 409, body: { error: 'already_decided' } },
    sentence: SENTENCE.already_decided_enable,
    key: 'already_decided',
    armed: false,
  },
  {
    act: 'enable',
    answer: { status: 500, body: { error: 'internal' } },
    sentence: SENTENCE.internal,
    key: 'internal',
    armed: true,
  },
  {
    act: 'delete',
    answer: { status: 409, body: { error: 'undecided' } },
    sentence: SENTENCE.undecided,
    key: 'undecided',
    armed: false,
  },
  {
    act: 'delete',
    answer: { status: 500, body: { error: 'internal' } },
    sentence: SENTENCE.internal_delete,
    key: 'internal',
    armed: true,
  },
  {
    act: 'delete',
    answer: { status: 409, body: { error: 'self' } },
    sentence: SENTENCE.self,
    key: 'self',
    armed: false,
  },
  {
    act: 'approve',
    answer: { status: 429, body: { message: 'Too Many Requests' } },
    sentence: SENTENCE.throttled,
    armed: true,
  },
  { act: 'disable', answer: 'offline', sentence: SENTENCE.network, armed: true },
];

describe('/admin/users, a sentence for every refusal (T5)', () => {
  for (const r of REFUSALS) {
    it(`${r.act} answering ${r.answer === 'offline' ? 'nothing' : `${r.answer.status} ${r.key ?? 'with no key'}`}`, async () => {
      const page = mount();
      await open(
        page,
        CASES.find((c) => c.act === r.act)!,
      );
      api.rulings = [r.answer];
      page.confirm(r.act);
      const alert = await waitFor(() => within(page.dialog()!).getByRole('alert'));
      expect(alert.textContent).toContain(r.sentence);
      if (r.key === undefined) expect(alert.querySelector('.font-mono')).toBeNull();
      else expect(alert.querySelector('.font-mono')?.textContent).toBe(r.key);
      expect(alert.textContent).not.toMatch(/\b(400|404|409|429|500)\b/);
      const action = within(page.dialog()!).queryByRole('button', { name: ACTION[r.act] });
      if (r.armed) {
        expect(action).not.toBeNull();
        expect(document.activeElement).toBe(action);
      } else {
        expect(action).toBeNull();
        expect(document.activeElement?.textContent).toBe(CANCEL);
      }
      expect(writes()).toHaveLength(1);
    });
  }

  it('renders the not-found when an action answers a gate key', async () => {
    const page = mount();
    await open(page, CASES[0]);
    api.rulings = [{ status: 403, body: { error: 'forbidden' } }];
    page.confirm('approve');
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
  });
});

describe('/admin/users, a failed read (T3)', () => {
  it('names the list’s key on a failed first read, and reads again on the retry', async () => {
    api.userReads = [
      { status: 500, body: { error: 'internal' } },
      { status: 500, body: { error: 'internal' } },
    ];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    expect(page.main()).toContain(SENTENCE.internal);
    expect(document.querySelector('main .font-mono')?.textContent).toBe('internal');
    fireEvent.click(within(document.querySelector('main')!).getByRole('button', { name: RETRY }));
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
  });

  it('names the status where the failed first read has no key', async () => {
    // A gateway's answer, which names no key of the route's; the transport retries a 429 itself.
    const gateway = { status: 502, body: { message: 'Bad Gateway' } };
    api.userReads = [gateway, gateway];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    expect(page.main()).toContain(uk.archive.read.status(502));
  });

  it('keeps the rows in hand when a re-read fails, and says when', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await settle();
    page.act('approve', 'olena.koval@example.com');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    api.rulings = [{ status: 500, body: { error: 'internal' } }];
    api.userReads = [
      { status: 500, body: { error: 'internal' } },
      { status: 500, body: { error: 'internal' } },
    ];
    page.confirm('approve');
    await waitFor(() => expect(page.main()).toMatch(/Список не оновився о \d\d:\d\d\./));
    expect(page.main()).toContain('olena.koval@example.com');
    expect(page.navLink()?.getAttribute('aria-label')).toBe(`${NAV}, 3`);
  });
});

// The first review round's findings, each pinned before its fix.
describe('/admin/users, focus and a ruling in flight', () => {
  it('keeps the confirmation open through Cancel and Escape while its ruling is on its way', async () => {
    let release!: () => void;
    api.holdRuling = new Promise<void>((r) => (release = r));
    const page = mount();
    await open(page, CASES[0]);
    api.rulings = [{ status: 500, body: { error: 'internal' } }];
    page.confirm('approve');
    const cancel = within(page.dialog()!).getByRole('button', { name: CANCEL });
    await waitFor(() => expect(cancel.getAttribute('aria-disabled')).toBe('true'));
    fireEvent.click(cancel);
    fireEvent.keyDown(page.dialog()!, { key: 'Escape' });
    await settle();
    expect(page.dialog()).not.toBeNull();
    release();
    const alert = await waitFor(() => within(page.dialog()!).getByRole('alert'));
    expect(alert.textContent).toContain(SENTENCE.internal);
  });

  it('takes focus to the retry when a retried first read fails again', async () => {
    const internal = { status: 500, body: { error: 'internal' } };
    // The list's read and the count's on arrival, then the list's again on the retry.
    api.userReads = [internal, internal, internal];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    const retry = () =>
      within(document.querySelector('main')!).getByRole('button', { name: RETRY });
    let release!: () => void;
    api.holdUsersRead = new Promise<void>((r) => (release = r));
    retry().focus();
    fireEvent.click(retry());
    // The card leaves for the held rows while the retry is out, and comes back when it fails.
    await waitFor(() => expect(page.main()).not.toContain(FAILED));
    release();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    await waitFor(() => expect(document.activeElement).toBe(retry()));
  });

  it('takes a ruled row off at once, and gives focus to the row now in its place', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await settle();
    let release!: () => void;
    api.holdUsersRead = new Promise<void>((r) => (release = r));
    page.act('approve', 'olena.koval@example.com');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    page.confirm('approve');
    await waitFor(() => expect(page.dialog()).toBeNull());
    // The re-read is held: the row left on the ruling's answer, not on the read's.
    expect(page.main()).not.toContain('olena.koval@example.com');
    const next = within(document.querySelector('main')!).getByRole('button', {
      name: `${ACTION.approve} m.shevchenko@example.net`,
    });
    await waitFor(() => expect(document.activeElement).toBe(next));
    release();
  });

  it('keeps «Ви» outside the address the cell clips', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await page.filter('active');
    await waitFor(() => expect(page.main()).toContain(ME_EMAIL));
    const clipped = [...document.querySelectorAll('main .truncate')].find((el) =>
      el.textContent?.includes(ME_EMAIL),
    );
    expect(clipped).toBeDefined();
    expect(clipped!.textContent).not.toContain(YOU);
  });
});

// The second round: focus lands where it was whenever its control leaves (HTML's focus fixup).
describe('/admin/users, focus after its control leaves', () => {
  it('lands a cancelled refusal on the row in its place when the re-read took the row away', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('ivan.bondarenko@example.org'));
    await settle();
    page.act('approve', 'ivan.bondarenko@example.org');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    api.users = api.users.filter((u) => u.email !== 'ivan.bondarenko@example.org');
    api.rulings = [{ status: 404, body: { error: 'not_found' } }];
    page.confirm('approve');
    await waitFor(() => within(page.dialog()!).getByRole('alert'));
    await waitFor(() => expect(page.main()).not.toContain('ivan.bondarenko@example.org'));
    fireEvent.click(within(page.dialog()!).getByRole('button', { name: CANCEL }));
    await waitFor(() => expect(page.dialog()).toBeNull());
    const before = within(document.querySelector('main')!).getByRole('button', {
      name: `${ACTION.approve} m.shevchenko@example.net`,
    });
    await waitFor(() => expect(document.activeElement).toBe(before));
  });

  it('lands a retry that succeeds on the filter, the card it was in gone', async () => {
    const internal = { status: 500, body: { error: 'internal' } };
    api.userReads = [internal, internal];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    const retry = within(document.querySelector('main')!).getByRole('button', { name: RETRY });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(document.querySelector('main')!).getByRole('combobox'),
      ),
    );
  });

  it('lands «Показати ще» on the first row it brought, once the last page takes the button away', async () => {
    api.users = [...SEEDED(), ...pendingMany(57)];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('applicant0@example.com'));
    const more = within(document.querySelector('main')!).getByRole('button', { name: MORE });
    more.focus();
    fireEvent.click(more);
    await waitFor(() => expect(page.main()).toContain('ivan.bondarenko@example.org'));
    const first = within(document.querySelector('main')!).getByRole('button', {
      name: `${ACTION.approve} applicant50@example.com`,
    });
    await waitFor(() => expect(document.activeElement).toBe(first));
  });
});

// The third round: the fixup lands on the element that held focus while it is here, takes focus
// only where nobody moved it, and outlives a window switch.
describe('/admin/users, the fixup lands on the element itself', () => {
  const button = (name: string) =>
    within(document.querySelector('main')!).getByRole('button', { name });

  it('gives a cancelled dialog back to the button that opened it, not its row’s first', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('m.shevchenko@example.net'));
    await settle();
    page.act('decline', 'm.shevchenko@example.net');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    fireEvent.click(within(page.dialog()!).getByRole('button', { name: CANCEL }));
    await waitFor(() => expect(page.dialog()).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(button(`${ACTION.decline} m.shevchenko@example.net`)),
    );
  });

  it('keeps the opener when a row above it left while the dialog was open', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('m.shevchenko@example.net'));
    await settle();
    page.act('approve', 'm.shevchenko@example.net');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    api.users = api.users.filter((u) => u.email !== 'olena.koval@example.com');
    api.rulings = [{ status: 500, body: { error: 'internal' } }];
    page.confirm('approve');
    await waitFor(() => within(page.dialog()!).getByRole('alert'));
    await waitFor(() => expect(page.main()).not.toContain('olena.koval@example.com'));
    fireEvent.click(within(page.dialog()!).getByRole('button', { name: CANCEL }));
    await waitFor(() => expect(page.dialog()).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(button(`${ACTION.approve} m.shevchenko@example.net`)),
    );
  });

  it('leaves focus the user moved while a retry was out where they put it', async () => {
    const internal = { status: 500, body: { error: 'internal' } };
    api.userReads = [internal, internal, internal];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    let release!: () => void;
    api.holdUsersRead = new Promise<void>((r) => (release = r));
    button(RETRY).focus();
    fireEvent.click(button(RETRY));
    await waitFor(() => expect(page.main()).not.toContain(FAILED));
    await settle();
    const link = document.querySelector<HTMLElement>('#app-sidebar a')!;
    link.focus();
    await settle();
    release();
    await waitFor(() => expect(page.main()).toContain(FAILED));
    await settle();
    expect(document.activeElement).toBe(link);
  });

  it('still lands a ruled row’s focus after the window was switched away meanwhile', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('olena.koval@example.com'));
    await settle();
    let release!: () => void;
    api.holdRuling = new Promise<void>((r) => (release = r));
    page.act('approve', 'olena.koval@example.com');
    await waitFor(() => expect(page.dialog()).not.toBeNull());
    page.confirm('approve');
    // A window switch: a blur with no related target, the element still here, the document unfocused.
    const away = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    fireEvent.focusOut(document.activeElement!, { relatedTarget: null });
    await settle();
    away.mockRestore();
    release();
    await waitFor(() => expect(page.dialog()).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(button(`${ACTION.approve} m.shevchenko@example.net`)),
    );
  });
});
