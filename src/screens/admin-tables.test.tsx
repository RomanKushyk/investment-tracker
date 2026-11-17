// @vitest-environment jsdom
// The super-admin's three tables wear the app's one anatomy (super-admin.md § Signed, tables.md
// § Signed): a header band, zebra rows with no row lines, 8 + 8 cells with 12 at the row's ends.
// Only the users table, which fills its page, scrolls in a box of its own; the archive's two sit
// mid-page and the page scrolls them (the owner's ruling on #694). Below md each list is zebra
// records in its one card (R2, wave 26). Through the real router over a fake of the user API.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../__fixtures__/router';
import {
  fakeApi,
  ME_EMAIL,
  ME_USER_ID,
  type FakeApi,
  type FakeUser,
} from '../__fixtures__/fake-api';
import { uk } from '../i18n/messages';
import type { ArchiveDiagnosis, ArchiveOperation } from '../lib/repository';

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
Element.prototype.scrollIntoView ??= () => {};
afterAll(() => vi.unstubAllGlobals());

const { routes } = await import('../routes');
const { session } = await import('../auth/app');

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const applicant = (n: number, email: string): FakeUser => ({
  id: uuid(n),
  email,
  status: 'pending',
  appliedAt: `2026-11-0${n}T10:00:00.000000Z`,
  decidedAt: null,
});

const run = (over: Partial<ArchiveOperation>): ArchiveOperation => ({
  id: crypto.randomUUID(),
  mode: 'observe',
  parameters: { source: 'nbu_fv', from: '2026-07-01', to: '2026-07-02' },
  state: 'succeeded',
  startedBy: ME_USER_ID,
  startedAt: '2026-07-28T10:40:00.000000Z',
  deadlineAt: '2026-07-28T11:01:00.000000Z',
  finishedAt: '2026-07-28T10:42:00.000000Z',
  result: { mode: 'observe', dates: 4, written: 4, mismatched: 0, complete: true, nextFrom: null },
  error: null,
  ...over,
});

const sample = (ref: string, basis: string) => ({
  as_of: '2026-07-28',
  instrument_ref: ref,
  basis,
  price: '1009.860000',
  ytm: '17.250000',
  clean_rate: null,
});
const DIAGNOSIS: ArchiveDiagnosis = {
  size: { rows: '6781', total_bytes: String(36.6 * 1024 * 1024) },
  bySource: [],
  observations: [],
  sample: [
    sample('UA4000236475', 'fair'),
    sample('UA4000238976', 'fair'),
    sample('inzhur-reit', 'nav'),
  ],
};

beforeEach(async () => {
  api = fakeApi({}, { today: '2026-07-28' });
  api.role = 'super_admin';
  api.claims = { sub: ME_USER_ID, email: ME_EMAIL };
  api.users = [
    applicant(1, 'olena.koval@example.com'),
    applicant(2, 'm.shevchenko@example.net'),
    applicant(3, 'ivan.bondarenko@example.org'),
  ];
  api.operations = [
    run({}),
    run({ parameters: { source: 'inzhur', from: '2026-07-01', to: '2026-07-02' } }),
    run({ state: 'failed', error: { reason: 'start_failed', message: 'boom' }, result: null }),
  ];
  api.diagnosis = DIAGNOSIS;
  await session.respond({});
  wide = true;
});
afterEach(cleanup);

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return () => document.querySelector('main')!;
}

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];
const has = (el: Element, ...want: string[]) =>
  expect(classes(el)).toEqual(expect.arrayContaining(want));
const lacks = (el: Element, ...unwanted: string[]) => {
  for (const c of unwanted) expect(classes(el)).not.toContain(c);
};
/** The glass card around an element. */
const cardOf = (el: Element) => el.closest('.glass')!;
/** The table's own scroll box: its viewport carries the signed height. */
const ownBox = (el: Element) => el.closest('[class*="max-h-[max(200px"]');

const RECORD = ['rounded-[18px]', 'p-4', 'even:bg-ink/3'];

/** The band, the zebra and the cells of one desktop table. */
function anatomy(table: HTMLTableElement, numeric: string[] = []) {
  has(table, 'border-separate', 'border-spacing-0');
  const heads = [...table.querySelectorAll('thead th')];
  expect(heads.length).toBeGreaterThan(1);
  for (const th of heads) {
    expect(th.getAttribute('scope')).toBe('col');
    has(th, 'bg-table-band', 'text-label-caps', 'uppercase', 'text-muted', 'whitespace-nowrap');
    has(th, numeric.includes(th.textContent ?? '') ? 'text-right' : 'text-left');
  }
  const rows = [...table.querySelectorAll('tbody tr')];
  expect(rows.length).toBeGreaterThan(1);
  for (const tr of rows) {
    has(tr, 'group/row');
    lacks(tr, 'border-t', 'border-hairline');
    for (const cell of tr.children) {
      has(cell, 'h-9', 'px-2', 'first:pl-3', 'last:pr-3');
      has(cell, 'group-even/row:bg-ink/3', 'group-hover/row:bg-ink/5');
    }
  }
  return rows;
}

describe('/admin/users at md and up', () => {
  it('reads under one sticky band in a box of its own, zebra rows with no lines', async () => {
    const main = mount('/admin/users');
    const table = await waitFor(() => {
      const found = main().querySelector<HTMLTableElement>('table');
      expect(found?.querySelectorAll('tbody tr').length).toBe(3);
      return found!;
    });
    has(table.querySelector('thead')!, 'sticky', 'top-0');
    expect(ownBox(table)).not.toBeNull();
    anatomy(table);
  });

  it('keeps a row at 36 px around its sm buttons: no vertical padding on any cell', async () => {
    const main = mount('/admin/users');
    const table = await waitFor(() => {
      const found = main().querySelector<HTMLTableElement>('table');
      expect(found?.querySelectorAll('tbody tr').length).toBe(3);
      return found!;
    });
    for (const cell of table.querySelectorAll('tbody tr > *')) {
      expect(classes(cell).some((c) => /^py-/.test(c))).toBe(false);
    }
    // The address is the row's header, in the row's cells, not on the band.
    const email = table.querySelector('tbody th[scope="row"]')!;
    lacks(email, 'bg-table-band');
    has(email, 'h-9', 'group-even/row:bg-ink/3', 'font-semibold');
  });

  it('gives the actions column room for both buttons past the cell’s 8 + 12 padding', async () => {
    const main = mount('/admin/users');
    const table = await waitFor(() => {
      const found = main().querySelector<HTMLTableElement>('table');
      expect(found?.querySelectorAll('tbody tr').length).toBe(3);
      return found!;
    });
    // «Схвалити» and «Відхилити» measure 187 px together in Chrome; a 200 column leaves 180.
    has([...table.querySelectorAll('col')].at(-1)!, 'w-[220px]');
  });
});

describe('/admin/users below md', () => {
  it('sets the records as zebra records in the one card that holds the head', async () => {
    wide = false;
    const main = mount('/admin/users');
    const actions = await waitFor(() => {
      const found = main().querySelectorAll('[data-row-actions]');
      expect(found).toHaveLength(3);
      return [...found];
    });
    const records = actions.map((a) => a.closest('.rounded-\\[18px\\]')!);
    const card = cardOf(records[0]!);
    expect(within(card as HTMLElement).getByText(uk.users.filter.pending)).toBeTruthy();
    for (const record of records) {
      has(record, ...RECORD);
      lacks(record, 'glass');
      expect(cardOf(record)).toBe(card);
    }
    // They bleed over the card's 22 px to sit 6 px in, the last one 6 px above its bottom.
    has(records[0]!.parentElement!, '-mx-4', 'last:-mb-4');
  });

  it('keeps the actions at the start of the footer, out of reach of its ml-auto', async () => {
    wide = false;
    const main = mount('/admin/users');
    const span = await waitFor(() => {
      const found = main().querySelector('[data-row-actions]');
      expect(found).not.toBeNull();
      return found!;
    });
    has(span, 'contents');
    expect(span.tagName).toBe('SPAN');
    // The footer's ml-auto reaches only a button that is its own child.
    expect(span.parentElement!.querySelector(':scope > button')).toBeNull();
  });
});

describe('/admin/archive’s run log', () => {
  it('reads under one band with zebra rows and no lines, and the page scrolls it', async () => {
    const main = mount('/admin/archive');
    const table = await waitFor(() => {
      const found = main().querySelector<HTMLTableElement>('table');
      expect(found?.querySelectorAll('tr[data-run]').length).toBe(3);
      return found!;
    });
    lacks(table.querySelector('thead')!, 'sticky');
    expect(ownBox(table)).toBeNull();
    const rows = anatomy(table);
    // The two-line rows keep their 9 px.
    for (const tr of rows) for (const cell of tr.children) has(cell, 'py-[9px]');
  });

  it('sets the runs as zebra records in its one card below md, each still a [data-run]', async () => {
    wide = false;
    const main = mount('/admin/archive');
    const runs = await waitFor(() => {
      const found = main().querySelectorAll('[data-run]');
      expect(found).toHaveLength(3);
      return [...found];
    });
    const card = cardOf(runs[0]!);
    expect(within(card as HTMLElement).getByText(uk.archive.runs.title)).toBeTruthy();
    for (const record of runs) {
      expect(record.tagName).toBe('LI');
      has(record, ...RECORD);
      lacks(record, 'border-t', 'not-first:border-t', 'not-first:border-hairline');
      expect(cardOf(record)).toBe(card);
    }
    has(runs[0]!.parentElement!, '-mx-4');
  });
});

describe('/admin/archive’s spot check', () => {
  async function read(main: () => Element) {
    await waitFor(() => expect(main().textContent).toContain(uk.archive.read.start));
    fireEvent.click(
      within(main() as HTMLElement).getByRole('button', { name: uk.archive.read.start }),
    );
    await waitFor(() => expect(main().textContent).toContain('inzhur-reit'));
  }
  const s = uk.archive.spot;

  it('reads under one band with zebra rows and no lines, the figures right, the page scrolling it', async () => {
    const main = mount('/admin/archive');
    await read(main);
    const table = [...main().querySelectorAll<HTMLTableElement>('table')].find((t) =>
      t.querySelector('thead')!.textContent!.includes(s.instrument),
    )!;
    lacks(table.querySelector('thead')!, 'sticky');
    expect(ownBox(table)).toBeNull();
    const rows = anatomy(table, [s.price, s.ytm, s.clean]);
    expect(rows).toHaveLength(3);
  });

  it('sets its rows as zebra records in its one card below md', async () => {
    wide = false;
    const main = mount('/admin/archive');
    await read(main);
    const card = cardOf(within(main() as HTMLElement).getByText(s.title));
    const records = ['UA4000236475', 'UA4000238976', 'inzhur-reit'].map((ref) =>
      within(card as HTMLElement)
        .getByText(ref)
        .closest('.rounded-\\[18px\\]')!,
    );
    for (const record of records) {
      has(record, ...RECORD);
      lacks(record, 'border-t', 'border-hairline');
    }
    has(records[0]!.parentElement!, '-mx-4');
  });
});
