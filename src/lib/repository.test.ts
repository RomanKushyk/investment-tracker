// The client of the user API against a fake of it (`src/__fixtures__/fake-api.ts`): the cascade of
// a delete, an import that lands whole or not at all, the round trip through an erase, a move onto
// a taken day, a backup that carries a version its importer accepts, and the precondition that
// stands between two tabs: a tab writing against a tag another tab has moved is refused, and what a
// tab began for an account sends and keeps nothing once the account has changed (*Cloud target*).
import { describe, expect, it, vi } from 'vitest';

import { diffBackup, validateImport } from '@quirenote/core/backup/import';
import { buildBackup, parseBackup } from '@quirenote/core/backup/json';
import { importParts, type StagedImport } from '@quirenote/core/backup/parts';
import { headlineKpis, headlineTotal } from '@quirenote/core/derive';
import { buildSeedBackup } from '@quirenote/core/seed';
import type { Asset, Transaction } from '@quirenote/core/types';
import { snapshotsOfPrices } from '@quirenote/core/valuation';

import {
  DERIVATION_ID,
  fakeApi,
  type FakeApi,
  type Rows,
  type Sent,
} from '../__fixtures__/fake-api';
import type { RelayAnswer, RelayCall } from '../auth/relay';
import { createSession, type Locks, type Session } from '../auth/session';
import { csvTablesOf } from './backup';
import { ApiError, createRepository, type Repository } from './repository';
import { createTransport } from './transport';

const TODAY = '2026-07-28';
const TOKENS: RelayAnswer = { kind: 'tokens', tokens: { idToken: 'h.e30.s', expiresIn: 3600 } };
const noLocks = { request: (_: string, callback: () => unknown) => callback() } as unknown as Locks;

async function signedIn(): Promise<Session> {
  const session = createSession({ relay: vi.fn<RelayCall>(async () => TOKENS), locks: noLocks });
  await session.restore();
  return session;
}

/** A tab: its own repository, and so its own tag, over the one API. */
async function tab(api: FakeApi, session?: Session): Promise<Repository> {
  return createRepository(
    createTransport({
      hostname: 'dev.quirenote.com',
      fetch: api.fetch,
      session: session ?? (await signedIn()),
      showAnswer: vi.fn(),
      derivationId: DERIVATION_ID,
    }),
  );
}

const SEED = buildSeedBackup('2026-07-28T12:00:00');
const SEED_ROWS = (): Rows => ({
  assets: SEED.assets as Asset[],
  transactions: SEED.transactions as Transaction[],
  prices: SEED.prices,
});
const [REIT, ENERGY, OVDP8976, OVDP6475] = SEED.assets.map((a) => a.id);

/** The API holding the seed, and a repository that has read the view of it. */
async function seeded(rows: Rows = SEED_ROWS()) {
  const api = fakeApi(rows, { today: TODAY });
  const repo = await tab(api);
  await repo.readView();
  return { api, repo };
}

const planOf = async (rows: Pick<Rows, 'assets' | 'transactions' | 'prices'>) => {
  const plan = await importParts(rows);
  if (!plan.ok) throw new Error(JSON.stringify(plan.issues));
  return plan;
};

/** What a backup file written now holds, from the API's export. */
async function exportText(repo: Repository): Promise<string> {
  const { assets, transactions, prices } = await repo.exportState();
  return JSON.stringify(
    buildBackup(
      assets,
      prices,
      transactions,
      { currency: 'UAH', usdRate: 44.83 },
      '2026-08-04T12:00:00',
    ),
  );
}

const writes = (api: FakeApi) => api.seen.filter((r) => r.method === 'POST');

describe('deleteAsset cascade', () => {
  it('removes the asset, its transactions and its prices — nothing else', async () => {
    const { api, repo } = await seeded();
    const before = SEED_ROWS();

    await repo.deleteAsset(REIT);

    const { assets, transactions, prices } = await repo.exportState();
    expect(assets.map((a) => a.id)).toEqual([ENERGY, OVDP8976, OVDP6475]);
    expect(transactions.some((t) => t.assetId === REIT)).toBe(false);
    expect(transactions).toHaveLength(before.transactions.filter((t) => t.assetId !== REIT).length);
    expect(prices).toEqual(before.prices.filter((p) => p.assetId !== REIT));
    expect(api.rows.assets).toHaveLength(3);
  });
});

describe('replaceAll', () => {
  it('is all-or-nothing: a file the API refuses part-way commits nothing and closes the import', async () => {
    const { api, repo } = await seeded();
    const before = structuredClone(api.rows);
    const { etag } = await repo.exportState();
    // Two assets under one id pass every door a row has, and are refused as the second is staged.
    const file = { ...SEED_ROWS(), assets: [...SEED.assets, SEED.assets[0]] as Asset[] };

    await expect(repo.replaceAll(etag, await planOf(file))).rejects.toBeInstanceOf(ApiError);

    expect(api.rows).toEqual(before);
    expect(api.seen.at(-1)).toMatchObject({ method: 'DELETE' });
  });

  it('replaces every table when the data is valid', async () => {
    const { api, repo } = await seeded();
    const { etag } = await repo.exportState();
    const one = {
      assets: [SEED.assets[0]] as Asset[],
      transactions: [SEED.transactions[0]] as Transaction[],
      prices: SEED.prices.filter((p) => p.assetId === REIT).slice(0, 3),
    };

    expect(await repo.replaceAll(etag, await planOf(one))).toBe('imported');

    expect(api.rows).toEqual(one);
  });

  it('chains the next write on the tag the import gave', async () => {
    const { api, repo } = await seeded();
    const { etag } = await repo.exportState();
    await repo.replaceAll(etag, await planOf(SEED_ROWS()));

    await repo.deleteTransaction(SEED.transactions[0].id);

    expect(api.rows.transactions).toHaveLength(24);
  });

  it('comes back as a conflict, with the import closed, when another tab wrote since the tag', async () => {
    const { api, repo } = await seeded();
    const { etag } = await repo.exportState();
    const other = await tab(api);
    await other.readView();
    await other.deleteTransaction(SEED.transactions[0].id);

    expect(await repo.replaceAll(etag, await planOf(SEED_ROWS()))).toBe('conflict');

    expect(api.rows.transactions).toHaveLength(24);
    expect(api.seen.at(-1)).toMatchObject({ method: 'DELETE' });
  });
});

describe('a backup written now', () => {
  it('parses back, carries a version its importer accepts, and names no database version', async () => {
    const { repo } = await seeded();
    const text = await exportText(repo);

    expect(parseBackup(text).ok).toBe(true);
    expect(validateImport(text).ok).toBe(true);
    expect(text).not.toContain('dbVersion');
  });

  it('is refused as an older version when it carries a database version', async () => {
    const { repo } = await seeded();
    const envelope = JSON.parse(await exportText(repo)) as Record<string, unknown>;
    const legacy = JSON.stringify({ ...envelope, formatVersion: 14, dbVersion: 2 });

    const result = validateImport(legacy);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.rejection).toMatchObject({ kind: 'format', code: 'older-format', version: 14 });
  });
});

describe('export → erase → import round-trip', () => {
  it('restores every row of the seed, with every pinned figure intact', async () => {
    const { api, repo } = await seeded();
    const before = structuredClone(api.rows);
    const text = await exportText(repo);

    await repo.clearAll();
    expect(api.rows.assets).toHaveLength(0);

    const validation = validateImport(text);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    const { etag } = await repo.exportState();
    expect(await repo.replaceAll(etag, await planOf(validation.envelope))).toBe('imported');

    const after = await repo.exportState();
    expect(after.assets).toEqual(before.assets);
    expect(after.transactions).toEqual(before.transactions);
    expect(after.prices).toEqual(before.prices);
    const days = snapshotsOfPrices(after.transactions, after.prices);
    expect(after.assets).toHaveLength(4);
    expect(days).toHaveLength(174);
    expect(after.transactions).toHaveLength(25);
    const kpis = headlineKpis(days, after.transactions);
    expect(kpis.total).toBeCloseTo(149016.36, 2);
    expect(kpis.net.uah).toBeCloseTo(4452.61, 2);
    expect(kpis.net.pct * 100).toBeCloseTo(3.08, 2);
    expect(headlineTotal(days, after.transactions)).toBeCloseTo(149016.36, 2);
  });

  it('previews a re-import of what is stored as all-replaced, nothing lost', async () => {
    const { repo } = await seeded();
    const current = csvTablesOf(await repo.exportState());
    const validation = validateImport(await exportText(repo));
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    const diff = diffBackup(current, validation.envelope, { today: '2026-08-04' });

    expect(diff.assets).toEqual({ added: 0, replaced: 4, removed: 0 });
    expect(diff.snapshots).toEqual({ added: 0, replaced: 174, removed: 0 });
    expect(diff.transactions).toEqual({ added: 0, replaced: 25, removed: 0 });
    expect(diff.after).toEqual({ assets: 4, snapshots: 174, transactions: 25 });
    expect(diff.warnings).toEqual([]);
  });

  it('writes nothing for a rejected file — validation happens before any request', async () => {
    const { api, repo } = await seeded();
    const broken = JSON.parse(await exportText(repo)) as Record<string, unknown>;
    (broken.assets as Record<string, unknown>[])[0].createdAt = '2026-02-03T10:00:00Z';
    const sent = api.seen.length;

    expect(validateImport(JSON.stringify(broken)).ok).toBe(false);

    expect(api.seen).toHaveLength(sent);
  });

  it('erases with clearAll() and puts nothing back', async () => {
    const { api, repo } = await seeded();

    await repo.clearAll();

    expect(api.rows).toEqual({ assets: [], transactions: [], prices: [] });
  });
});

describe('two tabs', () => {
  it('refuse the write of the tab that is behind with one 412, and lose no update', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const a = await tab(api);
    const b = await tab(api);
    await a.readView();
    await b.readView();

    await a.deleteTransaction(SEED.transactions[0].id);
    const refused = await b.deleteTransaction(SEED.transactions[1].id).catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).stale).toBe(true);
    expect(writes(api)).toHaveLength(2);
    // The first write stands and the second changed nothing; the 412 is never retried.
    expect(api.rows.transactions.map((t) => t.id)).not.toContain(SEED.transactions[0].id);
    expect(api.rows.transactions.map((t) => t.id)).toContain(SEED.transactions[1].id);

    await b.readView();
    await b.deleteTransaction(SEED.transactions[1].id);
    expect(api.rows.transactions).toHaveLength(23);
  });

  it('chain their own writes on the tag each answer gives, with no read between', async () => {
    const { api, repo } = await seeded();

    await repo.deleteTransaction(SEED.transactions[0].id);
    await repo.deleteTransaction(SEED.transactions[1].id);

    expect(api.rows.transactions).toHaveLength(23);
  });

  it('send the writes of one tab one at a time, so none is refused against its own tag', async () => {
    const { api, repo } = await seeded();

    await Promise.all([
      repo.deleteTransaction(SEED.transactions[0].id),
      repo.deleteTransaction(SEED.transactions[1].id),
      repo.deleteTransaction(SEED.transactions[2].id),
    ]);

    expect(api.rows.transactions).toHaveLength(22);
    expect(writes(api)).toHaveLength(3);
  });
});

describe('a tab and its own tag', () => {
  // The three writes that give a tag. A read of the view sent before one landed, and answered after
  // it, is for a dataset it has changed.
  const landing: [string, (repo: Repository, api: FakeApi) => Promise<unknown>][] = [
    ['a write', (repo) => repo.deleteTransaction(SEED.transactions[0].id)],
    ['a delete of an asset', (repo) => repo.deleteAsset(REIT)],
    ['an import', async (repo, api) => repo.replaceAll(api.tag(), await planOf(SEED_ROWS()))],
  ];

  describe.each(landing)('after %s', (_, land) => {
    it.each([
      ['a 200', false],
      ['a 304', true],
    ])('is not moved back by %s answered after it', async (__, revalidated) => {
      const api = fakeApi(SEED_ROWS(), { today: TODAY });
      const serve = api.fetch;
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let views = 0;
      api.fetch = async (input, init) => {
        const response = await serve(input, init);
        if (String(input).endsWith('/view') && (views += 1) === 2) await held;
        return response;
      };
      const repo = await tab(api);
      const first = await repo.readView();
      const late = repo.readView(revalidated ? first : undefined);
      await vi.waitFor(() => expect(api.seen.filter((r) => r.path === '/view')).toHaveLength(2));

      await land(repo, api);
      release();
      await late;
      await repo.clearAll();

      expect(api.rows.transactions).toEqual([]);
    });
  });

  it('adopts the tag of a read that no write of the tab overtook', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const repo = await tab(api);
    await repo.readView();
    await repo.deleteTransaction(SEED.transactions[0].id);

    const view = await repo.readView();

    expect(view.tag).toBe(api.tag());
    await repo.deleteTransaction(SEED.transactions[1].id);
    expect(api.rows.transactions).toHaveLength(23);
  });
});

describe('moveSnapshotDate', () => {
  it('is refused onto a taken day and writes nothing', async () => {
    const { api, repo } = await seeded();
    const before = structuredClone(api.rows);

    await expect(repo.moveSnapshotDate('2026-07-25', '2026-07-27')).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(api.rows).toEqual(before);
  });

  it('moves a day to a free date', async () => {
    const { api, repo } = await seeded();

    await repo.moveSnapshotDate('2026-07-27', '2026-07-26');

    expect(api.rows.prices.some((p) => p.asOf === '2026-07-27')).toBe(false);
    expect(api.rows.prices.filter((p) => p.asOf === '2026-07-26')).toHaveLength(1);
    expect(api.rows.prices).toHaveLength(SEED.prices.length);
  });
});

describe('exportState', () => {
  it('returns all three tables with the seed row counts', async () => {
    const { repo } = await seeded();

    const { assets, transactions, prices } = await repo.exportState();

    expect(assets).toHaveLength(4);
    expect(transactions).toHaveLength(25);
    expect(prices).toHaveLength(572);
  });
});

describe('the reads', () => {
  it('hand back the view with the tag a write goes under and the validator it came under', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const repo = await tab(api);

    const view = await repo.readView();

    expect(view.tag).toBe(api.tag());
    expect(view.validator).toMatch(/^W\//);
    expect(view.assets).toHaveLength(4);
  });

  it('revalidate with If-None-Match, and hand back what they had when the answer is a 304', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const repo = await tab(api);
    const first = await repo.readView();

    const second = await repo.readView(first);

    expect(second).toBe(first);
    expect(api.seen.at(-1)?.headers['if-none-match']).toBe(first.validator);
    expect(api.notModified).toBe(1);
  });

  it('read the new view once a write has changed it', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const repo = await tab(api);
    const first = await repo.readView();
    await repo.deleteTransaction(SEED.transactions[0].id);

    const second = await repo.readView(first);

    expect(second).not.toBe(first);
    expect(second.transactions).toHaveLength(24);
    expect(second.tag).toBe(api.tag());
  });

  it('keep one validator for each period, page and day', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const repo = await tab(api);
    const curve = await repo.readSeries('3m');
    const page = await repo.readBalances(1);
    const day = await repo.readDay('2026-07-25');

    expect(await repo.readSeries('3m', curve)).toBe(curve);
    expect(await repo.readBalances(1, page)).toBe(page);
    expect(await repo.readDay('2026-07-25', day)).toBe(day);
    expect(api.notModified).toBe(3);
    expect(new Set([curve.validator, page.validator, day.validator]).size).toBe(3);
  });

  it('send nothing without a token, and say the caller is signed out', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const signedOut = createSession({
      relay: vi.fn<RelayCall>(async () => ({ kind: 'refused', reason: 'notAuthorized' })),
      locks: noLocks,
    });
    await signedOut.restore();
    const repo = await tab(api, signedOut);

    const refused = await repo.readView().catch((e: unknown) => e);

    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).signedOut).toBe(true);
    expect(api.seen).toEqual([]);
  });
});

describe('forgetting the account', () => {
  it('drops the tag, so the next write reads the dataset it goes under', async () => {
    const { api, repo } = await seeded();
    const other = await tab(api);
    await other.readView();
    await other.deleteTransaction(SEED.transactions[0].id);

    repo.forget();
    await repo.deleteTransaction(SEED.transactions[1].id);

    // Not refused: a tag from before the forgetting would have been stale.
    expect(api.rows.transactions).toHaveLength(23);
    expect(api.seen.filter((r) => r.path === '/state')).toHaveLength(1);
  });
});

/** Holds the answer to the `nth` request `matches` picks out until `release`, once the API has
 *  acted on it. Installed before the tab is made, since the transport keeps the fetch it is given. */
function holding(api: FakeApi, matches: (sent: Sent) => boolean, nth = 1) {
  const serve = api.fetch;
  let count = 0;
  let reached!: () => void;
  const arrived = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  api.fetch = async (input, init) => {
    const before = api.seen.length;
    const response = await serve(input, init);
    const sent = api.seen[before];
    if (sent !== undefined && matches(sent) && (count += 1) === nth) {
      reached();
      await held;
    }
    return response;
  };
  return { arrived, release };
}

const isView = (sent: Sent) => sent.method === 'GET' && sent.path === '/view';
const isMutation = (sent: Sent) => sent.method === 'POST' && sent.path === '/mutations';
const isExport = (sent: Sent) => sent.method === 'GET' && sent.path === '/state';
const isImportBegun = (sent: Sent) => sent.method === 'POST' && sent.path === '/imports';

describe('an operation begun before the account changed', () => {
  // The account changes under a tab when another tab signs in as someone else; the tab forgets what
  // it held. What it began for the last account is that account's: its tag, its ops, its file.

  it('hands back no view answered after it, and leaves no tag of it behind', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const gate = holding(api, isView, 2);
    const repo = await tab(api);
    await repo.readView();

    const late = repo.readView();
    await gate.arrived;
    repo.forget();
    gate.release();

    await expect(late).rejects.toBeInstanceOf(ApiError);
    await repo.deleteTransaction(SEED.transactions[0].id);
    // The write read the dataset it goes under, rather than going under the last account's tag.
    expect(api.seen.filter(isExport)).toHaveLength(1);
  });

  it('sends nothing of a write queued behind one in flight: an erase does not land', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const gate = holding(api, isMutation);
    const repo = await tab(api);
    await repo.readView();

    const first = repo.deleteTransaction(SEED.transactions[0].id);
    const erase = repo.clearAll();
    await gate.arrived;
    repo.forget();
    gate.release();

    // The first had landed when the account changed; its answer is the last account's.
    await expect(first).rejects.toBeInstanceOf(ApiError);
    await expect(erase).rejects.toBeInstanceOf(ApiError);
    expect(api.seen.filter(isMutation)).toHaveLength(1);
    expect(api.rows.transactions).toHaveLength(SEED.transactions.length - 1);
  });

  const queuing: [
    string,
    (repo: Repository, api: FakeApi, plan: StagedImport) => Promise<unknown>,
  ][] = [
    ['a write', (repo) => repo.deleteTransaction(SEED.transactions[1].id)],
    ['an asset delete', (repo) => repo.deleteAsset(REIT)],
    ['an import', (repo, api, plan) => repo.replaceAll(api.tag(), plan)],
  ];

  it.each(queuing)(
    'sends nothing of %s queued before it, under the tag the next account’s view gave',
    async (_, queue) => {
      const api = fakeApi(SEED_ROWS(), { today: TODAY });
      const gate = holding(api, isMutation);
      const repo = await tab(api);
      await repo.readView();
      const plan = await planOf(SEED_ROWS());

      const first = repo.deleteTransaction(SEED.transactions[0].id);
      const queued = queue(repo, api, plan);
      await gate.arrived;
      repo.forget();
      // The next account's view, read while the first write's answer is still out, gives a tag.
      await repo.readView();
      gate.release();

      await expect(first).rejects.toBeInstanceOf(ApiError);
      await expect(queued).rejects.toBeInstanceOf(ApiError);
      expect(api.seen.filter((sent) => sent.method !== 'GET')).toHaveLength(1);
    },
  );

  it('sends no write under the tag of an export answered after it', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const gate = holding(api, isExport);
    const repo = await tab(api);

    // No view read: the write reads the dataset's tag from the export first.
    const writing = repo.deleteTransaction(SEED.transactions[0].id);
    await gate.arrived;
    repo.forget();
    gate.release();

    await expect(writing).rejects.toBeInstanceOf(ApiError);
    expect(api.seen.filter(isMutation)).toHaveLength(0);
  });

  it('stops an asset delete between its steps', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY, maxRows: 5 });
    const gate = holding(api, isMutation);
    const repo = await tab(api);
    await repo.readView();

    const deleting = repo.deleteAsset(REIT);
    await gate.arrived;
    repo.forget();
    gate.release();

    await expect(deleting).rejects.toBeInstanceOf(ApiError);
    expect(api.seen.filter(isMutation)).toHaveLength(1);
  });

  it('sends no part and no commit of an import begun before it', async () => {
    const api = fakeApi(SEED_ROWS(), { today: TODAY });
    const gate = holding(api, isImportBegun);
    const repo = await tab(api);
    const rows = SEED_ROWS();
    const plan = await planOf({ ...rows, transactions: rows.transactions.slice(0, 3) });

    const importing = repo.replaceAll(api.tag(), plan);
    await gate.arrived;
    repo.forget();
    gate.release();

    await expect(importing).rejects.toBeInstanceOf(ApiError);
    expect(api.seen.filter((sent) => sent.path.startsWith('/imports/'))).toEqual([]);
    expect(api.rows.transactions).toHaveLength(SEED.transactions.length);
  });
});
