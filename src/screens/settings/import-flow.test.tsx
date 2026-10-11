// @vitest-environment jsdom
// The import over the API, driven through the row and its dialog (*Cloud target*): the safety backup
// comes from the API's export and goes to the browser before anything is staged, the diff is the
// file against what the API holds now, and a dataset that moved since the person looked is shown
// again, not replaced behind their back. A rejected file sends nothing.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBackup } from '@quirenote/core/backup/json';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { fakeApi, type FakeApi } from '../../__fixtures__/fake-api';
import { uk } from '../../i18n/messages';

let api: FakeApi;
vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => api.fetch(input, init));
const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
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
// The browser's side of a download: what reached it, and in what order against the API's requests.
const saved: { name: string; text: string; after: number }[] = [];
vi.mock('../../lib/download', () => ({
  saveTextFile: vi.fn(async (name: string, text: string) => {
    saved.push({ name, text, after: api.seen.length });
    return 'saved';
  }),
}));
afterAll(() => vi.unstubAllGlobals());

const { ImportRow } = await import('./ImportRow');
const { session } = await import('../../auth/app');

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const TODAY = '2026-07-28';
const seedRows = () => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
/** The seed's file, as a person's disk holds it. */
const fileOf = (text = JSON.stringify(SEED), name = 'quirenote-backup.json') =>
  new File([text], name, { type: 'application/json' });

beforeEach(async () => {
  api = fakeApi(
    {
      assets: SEED.assets.slice(0, 2) as Asset[],
      transactions: SEED.transactions.slice(0, 2) as Transaction[],
      prices: [],
    },
    { today: TODAY },
  );
  saved.length = 0;
  await session.restore();
});
afterEach(cleanup);

function mount() {
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <ImportRow />
    </QueryClientProvider>,
  );
  const pick = async (file: File) => {
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
  };
  return { ...view, pick };
}

const confirm = () => screen.findByRole('button', { name: uk.importing.preview.confirm });
const requests = (method: string, prefix: string) =>
  api.seen.filter((r) => r.method === method && r.path.startsWith(prefix));

describe('picking a file', () => {
  it('shows the diff of the file against what the API holds, and writes nothing', async () => {
    const { pick } = mount();

    await pick(fileOf());

    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(api.seen.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /state']);
    expect(api.rows.assets).toHaveLength(2);
  });

  it('reports a file the importer refuses, and sends no request but the read', async () => {
    const broken = JSON.parse(JSON.stringify(SEED)) as { assets: Record<string, unknown>[] };
    broken.assets[0].createdAt = '2026-02-03T10:00:00Z';
    const { pick } = mount();

    await pick(fileOf(JSON.stringify(broken)));

    expect(await screen.findByText(uk.importing.report.title)).toBeTruthy();
    expect(api.seen.every((r) => r.method === 'GET')).toBe(true);
  });

  it('reports a file whose ids the API would refuse, before staging anything', async () => {
    // A seed id such as 'reit' passes the importer and fails the API’s UUID door.
    const legacy = buildBackup(
      [{ ...SEED.assets[0], id: 'reit' }] as Asset[],
      [],
      [],
      undefined,
      '2026-07-28T12:00:00',
    );
    const { pick } = mount();

    await pick(fileOf(JSON.stringify(legacy)));

    expect(await screen.findByText(uk.importing.report.title)).toBeTruthy();
    expect(requests('POST', '/imports')).toEqual([]);
  });
});

describe('confirming', () => {
  it('hands the browser the safety backup first, then stages the parts and commits under the tag', async () => {
    const { pick } = mount();
    await pick(fileOf());

    fireEvent.click(await confirm());

    await waitFor(() => expect(api.rows.assets).toHaveLength(4));
    expect(api.rows).toEqual(seedRows());
    // The safety backup is the dataset the API held, and it was saved before the import began.
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toMatch(/^quirenote-before-import-/);
    const firstImportRequest = api.seen.findIndex((r) => r.path.startsWith('/imports'));
    expect(saved[0].after).toBeLessThanOrEqual(firstImportRequest);
    expect(JSON.parse(saved[0].text)).toMatchObject({
      assets: [{ id: SEED.assets[0].id }, { id: SEED.assets[1].id }],
    });
    expect(requests('POST', '/imports/')).toHaveLength(1);
    expect(requests('POST', '/imports/')[0].headers['if-match']).toBe('"0"');
  });

  it('shows the diff again, and replaces nothing, when the dataset moved since it was shown', async () => {
    const { pick } = mount();
    await pick(fileOf());
    await screen.findByRole('alertdialog');
    // Another tab recorded a transaction while the dialog was open.
    api.rows.transactions.push(SEED.transactions[2] as Transaction);
    api.version += 1;

    fireEvent.click(await confirm());

    expect(await screen.findByText(uk.importing.warning.dataMoved)).toBeTruthy();
    expect(requests('POST', '/imports')).toEqual([]);
    expect(api.rows.transactions).toHaveLength(3);

    // Confirmed against the diff now shown, it goes through.
    fireEvent.click(await confirm());
    await waitFor(() => expect(api.rows.transactions).toHaveLength(25));
  });

  it('shows the diff again, and replaces nothing, when the dataset changed with no row added or removed', async () => {
    const { pick } = mount();
    await pick(fileOf());
    await screen.findByRole('alertdialog');
    // Another tab edited a transaction and renamed an asset: the same ids, the same counts.
    const [first] = api.rows.transactions;
    api.rows.transactions[0] = { ...first, amount: first.amount + 1000 };
    api.rows.assets[0] = { ...api.rows.assets[0], name: 'Renamed elsewhere' };
    api.version += 1;

    fireEvent.click(await confirm());

    expect(await screen.findByText(uk.importing.warning.dataMoved)).toBeTruthy();
    expect(requests('POST', '/imports')).toEqual([]);
    expect(saved).toEqual([]);
    expect(api.rows.assets[0].name).toBe('Renamed elsewhere');
    expect(api.rows.transactions[0].amount).toBe(first.amount + 1000);

    // Confirmed against the diff now shown, it goes through.
    fireEvent.click(await confirm());
    await waitFor(() => expect(api.rows).toEqual(seedRows()));
  });

  it('shows the diff again, and closes the import, when the commit is refused for a stale tag', async () => {
    api.beforeCommit = (a) => {
      // Another tab wrote between the safety backup and the commit.
      a.beforeCommit = undefined;
      a.rows.transactions.push(SEED.transactions[2] as Transaction);
      a.version += 1;
    };
    const { pick } = mount();
    await pick(fileOf());

    fireEvent.click(await confirm());

    expect(await screen.findByText(uk.importing.warning.dataMoved)).toBeTruthy();
    // The import that could not commit is closed, and the dataset is the one the other tab left.
    expect(requests('DELETE', '/imports/')).toHaveLength(1);
    expect(api.rows.assets).toHaveLength(2);
    expect(api.rows.transactions).toHaveLength(3);

    fireEvent.click(await confirm());
    await waitFor(() => expect(api.rows.assets).toHaveLength(4));
    expect(api.rows.transactions).toHaveLength(25);
  });
});
