// @vitest-environment jsdom
// The archive panel's two repairs and its run log, through the real router, shell and client over a
// fake of the user API (`design/extensions/archive-admin.dc.html`, T2, T5 and T6).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';
import type { ArchiveOperation } from '../lib/repository';

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
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

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  api.role = 'super_admin';
  await session.respond({});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount() {
  const router = createMemoryRouter(routes, { initialEntries: ['/settings/archive'] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const main = () => view.container.querySelector('main')!;
  return {
    main: () => main()?.textContent ?? '',
    form: (title: string) => within(main()).getByRole('group', { name: title }),
    press: (name: string) => fireEvent.click(within(main()).getByRole('button', { name })),
    rows: () => main().querySelectorAll('[data-run]').length,
  };
}

const re = uk.archive.repairs;
const runs = uk.archive.runs;
const OBSERVE = re.observe.title;
const IMPORT = re.import.title;

/** Presses a form's «Запустити…», then the confirmation's «Запустити». */
function start(form: HTMLElement) {
  fireEvent.click(within(form).getByRole('button', { name: re.start }));
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Запустити' }),
  );
}

const starts = () => api.seen.filter((s) => s.method === 'POST');
const listReads = () => api.seen.filter((s) => s.path.startsWith('/admin/archive/operations?'));

/** A run as the API lists it: an NBU observe that succeeded, unless told otherwise. 10:40 UTC is
 *  13:40 in Kyiv in July. */
const run = (over: Partial<ArchiveOperation>): ArchiveOperation => ({
  id: crypto.randomUUID(),
  mode: 'observe',
  parameters: { source: 'nbu_fv', from: '2026-07-01', to: '2026-07-02' },
  state: 'succeeded',
  startedBy: ME_USER_ID,
  startedAt: '2026-07-28T10:40:00.000000Z',
  deadlineAt: '2026-07-28T11:01:00.000000Z',
  finishedAt: '2026-07-28T10:42:00.000000Z',
  result: {
    mode: 'observe',
    dates: 400,
    written: 0,
    mismatched: 0,
    complete: true,
    nextFrom: null,
  },
  error: null,
  ...over,
});

describe('the archive panel’s repairs', () => {
  it('shows a start pending until its answer, then the run running', async () => {
    let answer!: () => void;
    api.holdStart = new Promise((resolve) => (answer = resolve));
    const page = mount();
    await waitFor(() => expect(page.main()).toContain('Ще жодного запуску'));
    start(page.form('Імпортувати історію фондів'));
    await waitFor(() => expect(page.main()).toContain('Надсилається'));
    expect(page.main()).not.toContain('Виконується');
    answer();
    await waitFor(() => expect(page.main()).toContain('Виконується'));
    expect(page.main()).not.toContain('Надсилається');
    expect(page.main()).toContain('inzhur-reit, inzhur-energy');
  });

  it('echoes an observe with its source’s wire name, and no range while the dates are empty', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    fireEvent.click(within(page.form(OBSERVE)).getByRole('button', { name: re.start }));
    const echo = within(screen.getByRole('alertdialog'));
    expect(echo.getByText(re.confirm.observe)).toBeTruthy();
    const terms = [...screen.getByRole('alertdialog').querySelectorAll('dt')].map((d) => [
      d.textContent,
      d.nextElementSibling?.textContent,
    ]);
    expect(terms).toEqual([
      [re.confirm.operation, re.confirm.ops.observe],
      [re.observe.source, 'Inzhur · inzhur'],
      [re.observe.from, '—'],
      [re.observe.to, '—'],
      [re.confirm.days, '—'],
    ]);
    fireEvent.click(echo.getByRole('button', { name: re.confirm.cancel }));
    expect(starts()).toHaveLength(0);
  });

  it('sends the source chosen, and the run reads as its backfill', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    fireEvent.click(within(page.form(OBSERVE)).getByRole('radio', { name: 'НБУ' }));
    start(page.form(OBSERVE));
    await waitFor(() => expect(page.main()).toContain(runs.state.running));
    expect(JSON.parse(starts()[0].body)).toEqual({
      mode: 'observe',
      source: 'nbu_fv',
      from: '',
      to: '',
    });
    expect(page.main()).toContain(runs.observe('НБУ'));
  });

  it('reads an empty date in a run’s range as «—»', async () => {
    api.holdStart = new Promise(() => {});
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(OBSERVE));
    await waitFor(() => expect(page.main()).toContain(runs.state.pending));
    expect(page.main()).toContain('— – —');
    expect(page.main()).not.toContain('undefined');
  });

  it('sends only the funds switched on', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    fireEvent.click(within(page.form(IMPORT)).getByRole('switch', { name: 'Inzhur REIT' }));
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(runs.state.running));
    expect(JSON.parse(starts()[0].body)).toEqual({
      mode: 'importFundHistory',
      refs: ['inzhur-energy'],
    });
  });

  it('shows dev’s 405 at its form, and records no run', async () => {
    api.starts = [{ status: 405, body: { error: 'operations_prod_only' } }];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(re.refused.prodOnly));
    expect(within(page.form(IMPORT)).getByRole('status').textContent).toBe(re.refused.prodOnly);
    expect(page.main()).toContain(runs.empty);
    expect(page.rows()).toBe(0);
    // A refusal clears on its form's next press.
    fireEvent.click(within(page.form(IMPORT)).getByRole('button', { name: re.start }));
    expect(page.main()).not.toContain(re.refused.prodOnly);
  });

  it('puts a 422 under the field it names, and one it does not own under the form', async () => {
    api.starts = [
      {
        status: 422,
        body: {
          error: 'invalid_operation',
          issues: [
            { field: 'to', code: 'custom' },
            { field: 'extra', code: 'unrecognized_keys' },
          ],
        },
      },
    ];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(OBSERVE));
    await waitFor(() => expect(page.main()).toContain(re.refused.field['to.custom']));
    const form = within(page.form(OBSERVE));
    expect(form.getByText(re.refused.field['to.custom'])).toBeTruthy();
    expect(form.getByText(re.refused.other('extra', 'unrecognized_keys'))).toBeTruthy();
    expect(page.main()).not.toContain(runs.state.pending);
    expect(page.rows()).toBe(0);
  });

  it('names a fund the server refused under the funds', async () => {
    api.starts = [
      {
        status: 422,
        body: { error: 'invalid_operation', issues: [{ field: 'refs.1', code: 'invalid_value' }] },
      },
    ];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(IMPORT));
    await waitFor(() =>
      expect(
        within(page.form(IMPORT)).getByText(re.refused.field['refsN.invalid_value']),
      ).toBeTruthy(),
    );
  });

  it.each([
    [{ status: 502, body: { error: 'start_failed' } }, re.refused.startFailed],
    [{ status: 429, body: { error: 'too_many_requests' } }, re.refused.throttled],
    [{ status: 500, body: { error: 'internal' } }, re.refused.internal],
    ['offline', re.refused.network],
  ] as const)('says what a refused start came to at its form', async (answer, sentence) => {
    api.starts = [answer];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(IMPORT));
    await waitFor(() =>
      expect(within(page.form(IMPORT)).getByRole('alert').textContent).toBe(sentence),
    );
    expect(page.main()).not.toContain(runs.state.pending);
    expect(starts()).toHaveLength(1);
  });

  it('shows a run whose start was answered while another start still awaits its answer', async () => {
    api.holdStart = new Promise(() => {});
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(runs.state.pending));
    api.holdStart = undefined;
    start(page.form(OBSERVE));
    await waitFor(() => expect(page.main()).toContain(runs.state.running));
    expect(page.main()).toContain(runs.state.pending);
    expect(page.rows()).toBe(2);
  });

  it('shows the refusal of a form’s latest start, never an earlier one answered late', async () => {
    let answer!: () => void;
    api.holdStart = new Promise((resolve) => (answer = resolve));
    // The first start, held, comes to no answer at all; the second is answered first.
    api.starts = ['offline', 'accepted'];
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(runs.state.pending));
    api.holdStart = undefined;
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(runs.state.running));
    answer();
    await waitFor(() => expect(page.main()).not.toContain(runs.state.pending));
    expect(within(page.form(IMPORT)).queryByRole('alert')).toBeNull();
  });

  it('reads the log again after a start’s answer', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    expect(listReads()).toHaveLength(1);
    start(page.form(IMPORT));
    await waitFor(() => expect(listReads()).toHaveLength(2));
  });
});

describe('the run log', () => {
  it('reads each result as its mode writes it', async () => {
    api.operations = [
      run({
        mode: 'importFundHistory',
        parameters: { refs: ['inzhur-reit', 'inzhur-energy'] },
        result: {
          mode: 'importFundHistory',
          funds: [
            { ref: 'inzhur-reit', rows: 301, written: 301, from: '2025-09-09', to: '2026-07-06' },
            { ref: 'inzhur-energy', rows: 600, written: 600, from: '2024-11-14', to: '2026-07-06' },
          ],
        },
      }),
      run({
        parameters: { source: 'inzhur', from: '2026-07-01', to: '2026-07-02' },
        result: {
          mode: 'observe',
          source: 'inzhur',
          dates: 2,
          written: 5,
          skipped: 1,
          termsWritten: 3,
          termsRefused: 0,
          complete: true,
          nextFrom: null,
        },
      }),
      run({
        parameters: { source: 'nbu_fv', from: '2016-01-04', to: '2026-07-27' },
        result: {
          mode: 'observe',
          dates: 400,
          written: 0,
          mismatched: 0,
          complete: false,
          nextFrom: '2017-08-09',
        },
      }),
    ];
    const page = mount();
    await waitFor(() => expect(page.rows()).toBe(3));
    const text = page.main();
    expect(text).toContain('inzhur-reit: 301 рядок, записано 301 · 09.09.2025 – 06.07.2026');
    expect(text).toContain('inzhur-energy: 600 рядків, записано 600 · 14.11.2024 – 06.07.2026');
    expect(text).toContain(runs.inzhur('2', '5', '1', '3', '0'));
    expect(text).toContain(runs.nbu('400', '0', '0'));
    expect(text).toContain(runs.incomplete('09.08.2017'));
    expect(text).toContain('28.07.2026, 13:40');
    expect(text).toContain('04.01.2016 – 27.07.2026');
  });

  it('keeps a failed run in the list with its reason', async () => {
    api.operations = [
      run({
        state: 'failed',
        result: null,
        error: { reason: 'capture_failed', message: 'HTTP 503 for https://api.inzhur.reit/cms' },
      }),
      run({ state: 'failed', result: null, error: { reason: 'deadline_exceeded', message: null } }),
      run({ state: 'failed', result: null, error: { reason: 'start_failed', message: null } }),
    ];
    const page = mount();
    await waitFor(() => expect(page.rows()).toBe(3));
    const text = page.main();
    expect(text).toContain(runs.reason.capture_failed);
    expect(text).toContain('HTTP 503 for https://api.inzhur.reit/cms');
    expect(text).toContain(runs.reason.deadline_exceeded(21));
    expect(text).toContain(runs.reason.start_failed);
  });

  it('names who started a run: «Ви», or the first eight of another’s id', async () => {
    api.operations = [run({ startedBy: '0a1b2c3d-4e5f-4000-8000-000000000001' }), run({})];
    const page = mount();
    await waitFor(() => expect(page.rows()).toBe(2));
    expect(page.main()).toContain('0a1b2c3d…');
    expect(page.main()).toContain(runs.you);
  });

  it('shows ten runs, and more on «Показати ще»', async () => {
    api.operations = Array.from({ length: 12 }, () => run({}));
    const page = mount();
    await waitFor(() => expect(page.rows()).toBe(10));
    page.press(runs.more);
    await waitFor(() => expect(page.rows()).toBe(12));
    expect(page.main()).not.toContain(runs.more);
  });

  it('says a failed «Показати ще» at the button, not as a failed refresh', async () => {
    api.operations = Array.from({ length: 12 }, () => run({}));
    const page = mount();
    await waitFor(() => expect(page.rows()).toBe(10));
    api.operations = 500;
    page.press(runs.more);
    await waitFor(() => expect(page.main()).toContain(uk.archive.read.status(500)));
    expect(page.main()).not.toContain('Журнал не оновився');
    expect(page.rows()).toBe(10);
    expect(page.main()).toContain(runs.more);
  });

  it('names a first read that fails, and reads again on a press', async () => {
    api.operations = 500;
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.failed));
    expect(page.main()).toContain(runs.failedLead(uk.archive.read.status(500)));
    api.operations = [];
    within(document.querySelector('main')!)
      .getAllByRole('button', { name: uk.archive.read.retry })
      .forEach((b) => fireEvent.click(b));
    await waitFor(() => expect(page.main()).toContain(runs.empty));
  });

  it('is the not-found once the log refuses the caller', async () => {
    const page = mount();
    await waitFor(() => expect(page.main()).toContain(runs.empty));
    api.role = 'user';
    start(page.form(IMPORT));
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
  });
});

describe('the run log’s poll', () => {
  const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
  /** Mounts under a fake clock and lets the arrival's read land. */
  async function mountTimed() {
    vi.useFakeTimers({
      toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    vi.setSystemTime(new Date('2026-07-28T10:45:00Z'));
    const page = mount();
    for (let i = 0; i < 20 && listReads().length === 0; i += 1) await tick(50);
    await tick(50);
    return page;
  }

  it('reads every 10 s while a run is running, and stops once none is', async () => {
    api.operations = [run({ state: 'running', finishedAt: null, result: null })];
    const page = await mountTimed();
    expect(page.main()).toContain(runs.state.running);
    expect(listReads()).toHaveLength(1);
    await tick(10_000);
    expect(listReads()).toHaveLength(2);
    api.operations = [run({})];
    await tick(10_000);
    expect(listReads()).toHaveLength(3);
    expect(page.main()).toContain(runs.state.succeeded);
    await tick(30_000);
    expect(listReads()).toHaveLength(3);
  });

  it('reads nothing on a timer while nothing is running', async () => {
    api.operations = [run({})];
    await mountTimed();
    await tick(30_000);
    expect(listReads()).toHaveLength(1);
  });

  it('keeps the rows when a poll fails, says when, and polls on', async () => {
    const running = run({ state: 'running', finishedAt: null, result: null });
    api.operations = [running];
    const page = await mountTimed();
    api.operations = 500;
    await tick(10_000);
    expect(page.main()).toContain(runs.staleStatus('13:45', 500));
    expect(page.main()).toContain(runs.state.running);
    api.operations = [running];
    await tick(10_000);
    expect(listReads()).toHaveLength(3);
    expect(page.main()).not.toContain('Журнал не оновився');
  });

  it('holds back a run the log did not hold at a press still awaiting its answer', async () => {
    let answer!: () => void;
    api.holdStart = new Promise((resolve) => (answer = resolve));
    const before = run({ state: 'running', finishedAt: null, result: null });
    api.operations = [before];
    const page = await mountTimed();
    start(page.form(IMPORT));
    await tick(0);
    expect(page.main()).toContain(runs.state.pending);
    // The server has recorded the start, its answer not back yet, and the run held at the press
    // has finished: its «Готово» says the poll has landed.
    api.operations = [
      run({
        state: 'running',
        finishedAt: null,
        result: null,
        startedAt: '2026-07-28T10:45:00.000000Z',
      }),
      { ...before, state: 'succeeded', result: { mode: 'observe' } },
    ];
    await tick(10_000);
    await tick(50);
    expect(listReads()).toHaveLength(2);
    expect(page.main()).toContain(runs.state.succeeded);
    expect(page.main()).not.toContain(runs.state.running);
    expect(page.rows()).toBe(2);
    answer();
    await tick(50);
    expect(page.main()).not.toContain(runs.state.pending);
    expect(page.main()).toContain(runs.state.running);
  });
  it('keeps a failed «Показати ще» at its button while the next poll is out', async () => {
    let read!: () => void;
    api.operations = Array.from({ length: 12 }, () =>
      run({ state: 'running', finishedAt: null, result: null }),
    );
    const page = await mountTimed();
    api.operations = 500;
    page.press(runs.more);
    await tick(50);
    expect(page.main()).toContain(uk.archive.read.status(500));
    api.holdRead = new Promise((resolve) => (read = resolve));
    await tick(10_000);
    expect(listReads()).toHaveLength(3);
    expect(page.main()).toContain(uk.archive.read.status(500));
    expect(page.main()).not.toContain('Журнал не оновився');
    read();
  });

  it('shows older runs «Показати ще» loads while a start awaits its answer', async () => {
    api.holdStart = new Promise(() => {});
    api.operations = Array.from({ length: 12 }, () => run({}));
    const page = await mountTimed();
    expect(page.rows()).toBe(10);
    start(page.form(IMPORT));
    await tick(0);
    expect(page.rows()).toBe(11);
    page.press(runs.more);
    await tick(50);
    expect(page.rows()).toBe(13);
  });

  it('keeps a «Показати ще» in flight when a start’s answer reads the log again', async () => {
    let read!: () => void;
    api.operations = Array.from({ length: 12 }, () => run({}));
    const page = await mountTimed();
    api.holdRead = new Promise((resolve) => (read = resolve));
    page.press(runs.more);
    await tick(0);
    start(page.form(IMPORT));
    await tick(50);
    read();
    api.holdRead = undefined;
    await tick(50);
    // The ten, the two older ones, and the run the start's answer named.
    expect(page.rows()).toBe(13);
    expect(page.main()).toContain(runs.state.running);
  });

  it('keeps a started run through a poll that read the log before it was recorded', async () => {
    let read!: () => void;
    api.operations = [run({ state: 'running', finishedAt: null, result: null })];
    const page = await mountTimed();
    // The poll reads the run finished, and its answer is still on the way.
    api.operations = [run({})];
    api.holdRead = new Promise((resolve) => (read = resolve));
    await tick(10_000);
    expect(listReads()).toHaveLength(2);
    start(page.form(IMPORT));
    await tick(50);
    read();
    api.holdRead = undefined;
    await tick(50);
    expect(page.main()).toContain(runs.state.running);
    // And the log goes on reading while it runs.
    await tick(10_000);
    expect(listReads().length).toBeGreaterThan(2);
  });
  it('lets a started run go once ten newer ones have pushed it past the pages read', async () => {
    const page = await mountTimed();
    start(page.form(IMPORT));
    await tick(50);
    expect(page.main()).toContain(runs.import);
    api.operations = [
      ...Array.from({ length: 10 }, () => run({ startedAt: '2026-07-28T10:50:00.000000Z' })),
      ...(api.operations as ArchiveOperation[]),
    ];
    await tick(10_000);
    await tick(50);
    expect(page.rows()).toBe(10);
    expect(page.main()).not.toContain(runs.import);
  });
  it('holds back a second start’s own run when the first read had not landed at its press', async () => {
    let read!: () => void;
    api.holdRead = new Promise((resolve) => (read = resolve));
    const page = await mountTimed();
    start(page.form(OBSERVE));
    await tick(50);
    api.holdStart = new Promise(() => {});
    start(page.form(IMPORT));
    await tick(50);
    api.holdRead = undefined;
    read();
    await tick(50);
    await tick(10_000);
    await tick(50);
    // The observe's run, and the import pending: never the import's own run beside it.
    expect(page.rows()).toBe(2);
    expect(page.main()).toContain(runs.state.pending);
    expect(page.main().split(runs.import)).toHaveLength(2);
  });

  it('says the log could not be read when a start lands after a first read that failed', async () => {
    api.operations = 500;
    const page = await mountTimed();
    expect(page.main()).toContain(runs.failed);
    start(page.form(IMPORT));
    await tick(50);
    expect(page.main()).toContain(runs.state.running);
    expect(page.main()).toContain('Журнал не оновився');
  });

  it('lets a started run go once the reads list a run of its own stamp after it', async () => {
    const page = await mountTimed();
    start(page.form(IMPORT));
    await tick(50);
    const own = (api.operations as ArchiveOperation[])[0];
    // Ten observes stamped with the started run's own microsecond, listed before it by id.
    api.operations = [
      ...Array.from({ length: 10 }, (_, i) =>
        run({ startedAt: own.startedAt, id: `ffffffff-ffff-4fff-8fff-ffffffffff0${i}` }),
      ),
      own,
    ];
    await tick(10_000);
    await tick(50);
    expect(page.rows()).toBe(10);
    expect(page.main()).not.toContain(runs.import);
  });

  it('lists the runs no read lists yet newest first, whichever answer came first', async () => {
    let first!: () => void;
    api.holdRead = new Promise(() => {});
    const page = await mountTimed();
    api.holdStart = new Promise((resolve) => (first = resolve));
    start(page.form(OBSERVE));
    await tick(1000);
    api.holdStart = undefined;
    start(page.form(IMPORT));
    await tick(50);
    first();
    await tick(50);
    const text = page.main();
    expect(text.indexOf(runs.import)).toBeGreaterThan(-1);
    expect(text.indexOf(runs.import)).toBeLessThan(text.indexOf(runs.observe('Inzhur')));
  });
});
