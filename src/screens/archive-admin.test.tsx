// @vitest-environment jsdom
// The archive panel's gate, through the real router, shell and client over a fake of the user API
// (`design/extensions/archive-admin.dc.html`, T1 and T3).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, ME_EMAIL, ME_USER_ID, type FakeApi } from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';
import type { ArchiveDiagnosis } from '../lib/repository';

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';

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
  api = fakeApi(
    {
      assets: SEED.assets as Asset[],
      transactions: SEED.transactions as Transaction[],
      prices: SEED.prices,
    },
    { today: TODAY },
  );
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  await session.respond({});
});
afterEach(cleanup);

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const main = () => view.container.querySelector('main')!;
  return {
    router,
    main: () => main()?.textContent ?? '',
    press: (name: string) => fireEvent.click(within(main()).getByRole('button', { name })),
  };
}

// Two groups of Inzhur's, one with a missing captured day, and one of the NBU's; the latest row.
const ANSWER: ArchiveDiagnosis = {
  size: { rows: '6781', total_bytes: String(36.6 * 1024 * 1024) },
  bySource: [
    { source: 'inzhur', n: '81', bytes: String(2.9 * 1024 * 1024) },
    { source: 'nbu_fv', n: '6700', bytes: String(33.7 * 1024 * 1024) },
  ],
  observations: [
    {
      instrument_ref: 'UA4000207518',
      basis: 'buy',
      source: 'inzhur',
      dates: '20',
      measured_from: '2026-07-01',
      last_as_of: '2026-07-28',
      publishedDays: '20',
      gaps: 1,
      importedDays: null,
      emptyDays: 1,
      emptyDates: ['2026-07-14'],
    },
    {
      instrument_ref: 'inzhur-reit',
      basis: 'nav',
      source: 'inzhur',
      dates: '20',
      measured_from: '2026-07-01',
      last_as_of: '2026-07-28',
      publishedDays: '20',
      gaps: 0,
      importedDays: '30',
      emptyDays: 0,
      emptyDates: [],
    },
    {
      instrument_ref: 'UA4000236475',
      basis: 'fair',
      source: 'nbu_fv',
      dates: '20',
      measured_from: '2026-07-01',
      last_as_of: '2026-07-28',
      publishedDays: '20',
      gaps: 0,
      importedDays: null,
      emptyDays: 0,
      emptyDates: [],
    },
  ],
  sample: [
    {
      as_of: '2026-07-28',
      instrument_ref: 'UA4000236475',
      basis: 'fair',
      price: '1009.860000',
      ytm: '17.250000',
      clean_rate: null,
    },
  ],
};

const r = uk.archive.read;

describe('/settings/archive', () => {
  it('is the panel for the super-admin, and reads nothing on arrival', async () => {
    api.role = 'super_admin';
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain('Архів цін'));
    expect(page.main()).toContain('Прочитати архів');
    expect(page.main()).not.toContain(uk.boundary.notFound.title);
    expect(api.seen.some((s) => s.path.startsWith('/admin/'))).toBe(false);
  });

  it('is the app’s not-found for any other signed-in user', async () => {
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
    expect(page.main()).not.toContain('Архів цін');
    expect(api.seen.some((s) => s.path.startsWith('/admin/'))).toBe(false);
  });

  it('reads on a press, holds its boxes meanwhile, then draws the answer', async () => {
    api.role = 'super_admin';
    api.diagnosis = ANSWER;
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain('UA4000207518'));
    expect(api.seen.filter((s) => s.path === '/admin/archive/diagnosis')).toHaveLength(1);
    const text = page.main();
    expect(text).toContain(r.refresh);
    expect(text).toContain(uk.archive.source.inzhur);
    expect(text).toContain(uk.archive.coverage.title(uk.archive.source.nbu_fv));
    expect(text).toContain('81 · 2,9 МБ');
    expect(text).toContain('6 781 · 36,6 МБ');
    expect(text).toContain('1 009,86');
    // The archive serves NUMERIC as text, six decimals deep; the spot check prints two.
    expect(text).toContain('17,25 %');
    expect(text).not.toContain('1 009,860');
    // Every group is listed, the one with a missing day first.
    expect(text.indexOf('UA4000207518')).toBeLessThan(text.indexOf('inzhur-reit'));
    expect(text).toContain(uk.archive.kpi.empty(1, '1'));
  });

  it('marks a missing captured day on its group’s strip', async () => {
    api.role = 'super_admin';
    api.diagnosis = ANSWER;
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain('UA4000207518'));
    const marks = document.querySelectorAll('main [data-mark]');
    expect(marks).toHaveLength(1);
  });

  it.each([
    ['capture_failed', r.capture_failed],
    ['capture_timeout', r.capture_timeout],
  ] as const)('names a first read’s %s and offers to read again', async (key, sentence) => {
    api.role = 'super_admin';
    api.diagnosis = key;
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain(r.failed));
    expect(page.main()).toContain(sentence);
    expect(page.main()).toContain(key);
    expect(page.main()).not.toContain(uk.archive.spot.title);
    api.diagnosis = ANSWER;
    page.press(r.retry);
    await waitFor(() => expect(page.main()).toContain('UA4000207518'));
  });

  it('keeps the answer in hand when a refresh fails, and says so in the slot', async () => {
    api.role = 'super_admin';
    api.diagnosis = ANSWER;
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain('UA4000207518'));
    api.diagnosis = 'capture_timeout';
    page.press(r.refresh);
    await waitFor(() => expect(page.main()).toContain('оновити не вдалося'));
    expect(page.main()).toContain('capture_timeout');
    expect(page.main()).toContain('UA4000207518');
    expect(page.main()).not.toContain(r.failed);
  });

  it('is the not-found once the diagnosis refuses the caller', async () => {
    api.role = 'super_admin';
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    api.role = 'user';
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain(uk.boundary.notFound.title));
  });

  it('takes focus to the retry when a first read fails, the slot it was in gone', async () => {
    api.role = 'super_admin';
    api.diagnosis = 'capture_failed';
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain(r.failed));
    const retry = [...document.querySelectorAll('main button')].find((b) =>
      b.textContent?.includes(r.retry),
    );
    await waitFor(() => expect(document.activeElement).toBe(retry));
  });

  it('counts the groups not measured even where no measured group has an empty day', async () => {
    api.role = 'super_admin';
    api.diagnosis = {
      ...ANSWER,
      observations: [
        ...ANSWER.observations,
        {
          instrument_ref: 'UA4000238976',
          basis: 'fair',
          source: 'nbu_fv',
          dates: '0',
          measured_from: null,
          last_as_of: null,
          publishedDays: null,
          gaps: null,
          importedDays: null,
          emptyDays: null,
          emptyDates: null,
        },
      ],
    };
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain('UA4000238976'));
    expect(page.main()).toContain(uk.archive.kpi.emptySub(0, 2, 1));
  });

  it('moves no focus for a failure it finds on arrival', async () => {
    api.role = 'super_admin';
    api.diagnosis = 'capture_failed';
    const page = mount('/settings/archive');
    await waitFor(() => expect(page.main()).toContain(r.start));
    page.press(r.start);
    await waitFor(() => expect(page.main()).toContain(r.failed));
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => void (await page.router.navigate('/settings')));
    await act(async () => void (await page.router.navigate('/settings/archive')));
    await waitFor(() => expect(page.main()).toContain(r.failed));
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))));
    expect(document.activeElement).toBe(document.body);
  });

  // The archive's days are Kyiv's, so the axis ends at the Kyiv day the answer was read on, whatever
  // the browser's zone: in New York it is still the evening before.
  it('ends the axis at the Kyiv day of the answer', async () => {
    const zone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T03:30:00Z'));
    try {
      expect(new Date().getDate()).toBe(9);
      api.role = 'super_admin';
      const day = {
        ...ANSWER.observations[2]!,
        measured_from: '2026-03-10',
        last_as_of: '2026-03-10',
      };
      api.diagnosis = { ...ANSWER, observations: [day] };
      const page = mount('/settings/archive');
      await waitFor(() => expect(page.main()).toContain(r.start));
      page.press(r.start);
      await waitFor(() => expect(page.main()).toContain('UA4000236475'));
      expect(page.main()).toContain(uk.archive.coverage.span('10.03.2026', 1));
      const band = document.querySelector<HTMLElement>('main .h-3 > .bg-muted');
      expect(band?.style.width).toBe('100%');
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
  });
});
