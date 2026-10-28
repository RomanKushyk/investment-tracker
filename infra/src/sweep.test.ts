// The daily sweep over PGlite: what `dataset.clear` leaves and an import left idle, collected with
// no write from their owners, and only while the function has time for it (*User schema and
// deletes*, #529).
import { randomUUID } from 'node:crypto';

import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import {
  applyUserSchema,
  insertUser,
  writeLedger,
  type LedgerRows,
} from './__fixtures__/user-ledger';
import { IDLE_LIMIT } from './collect';
import { connect } from './dsql';
import type { SqlClient } from './migrate';
import { handler, sweep } from './sweep';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

const ALICE = '9f1e2d3c-0000-4000-8000-0000000000a1';
const BOB = '9f1e2d3c-0000-4000-8000-0000000000b2';
const RAN = { metric: 'sweepRun', value: 1 };
const FAILED = { metric: 'sweepRunFailed', value: 1 };
/** SHA-256 in canonical base64, as the manifest's check asks. */
const DIGEST = `${'A'.repeat(42)}A=`;

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** One asset, two transactions and two prices: a row in every table a generation keys but the
 *  import's own, numbered from `n`. */
const ledger = (n: number): LedgerRows => ({
  assets: [
    {
      id: u(n),
      name: 'REIT',
      code: 'RE',
      colorKey: 'reit',
      yieldType: 'dividends',
      expectedPct: 10,
      targetPct: 25,
      payoutSchedule: 'monthly',
      firstPurchase: '2026-03-02',
      createdAt: '2026-03-02T09:00:00',
    },
  ],
  transactions: [1, 2].map((i) => ({
    id: u(n + i),
    date: '2026-03-01',
    type: 'deposit' as const,
    assetId: '',
    amount: 1_000,
  })),
  userPrices: [
    { assetId: u(n), asOf: '2026-03-02', price: 5 },
    { assetId: u(n), asOf: '2026-03-03', price: 6 },
  ],
});

let db: PGlite;
/** The cluster on PGlite, read lazily: each test is handed a database of its own. */
const cluster: SqlClient = { query: (text, values) => db.query(text, values) };
const ample = () => 60_000;

const pointers = async (user: string) =>
  (
    await db.query<{ live: string | null; staged: string | null }>(
      'SELECT dataset_id AS live, import_dataset_id AS staged FROM app_user WHERE user_id = $1',
      [user],
    )
  ).rows[0];

/** Rows of every table a generation keys, the dataset row included, in generation `id`. */
const rowsIn = async (id: string) =>
  (
    await db.query<{ n: number }>(
      `SELECT ((SELECT count(*) FROM asset WHERE dataset_id = $1)
             + (SELECT count(*) FROM "transaction" WHERE dataset_id = $1)
             + (SELECT count(*) FROM user_price WHERE dataset_id = $1)
             + (SELECT count(*) FROM import_part WHERE dataset_id = $1)
             + (SELECT count(*) FROM import_manifest WHERE dataset_id = $1)
             + (SELECT count(*) FROM dataset WHERE id = $1))::int AS n`,
      [id],
    )
  ).rows[0].n;

/** Rows of the generations `user` owns that neither pointer names. */
const garbage = async (user: string) => {
  const { rows } = await db.query<{ id: string }>(
    `SELECT g.id FROM dataset g JOIN app_user u ON u.user_id = g.user_id
      WHERE u.user_id = $1 AND g.id IS DISTINCT FROM u.dataset_id
        AND g.id IS DISTINCT FROM u.import_dataset_id`,
    [user],
  );
  let n = 0;
  for (const { id } of rows) n += await rowsIn(id);
  return n;
};

/** A dataset of `user`'s holding the ledger numbered from `n`, pointed at by nothing. */
const dataset = async (user: string, n: number) => {
  const id = randomUUID();
  await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
    user,
    id,
  ]);
  await writeLedger(db, user, ledger(n), id);
  return id;
};

/** What `dataset.clear` does: a new empty live dataset, and the old one left behind. */
const clear = async (user: string) => {
  const old = (await pointers(user)).live!;
  const fresh = randomUUID();
  await db.query('INSERT INTO dataset (user_id, id, created_at) VALUES ($1, $2, now())', [
    user,
    fresh,
  ]);
  await db.query('UPDATE app_user SET dataset_id = $2 WHERE user_id = $1', [user, fresh]);
  return old;
};

/** An import staged `idle` ago, with a part of its rows in. */
const stage = async (user: string, n: number, idle: string) => {
  const id = await dataset(user, n);
  await db.query(
    `INSERT INTO import_manifest (dataset_id, digest, assets, transactions, prices, staged_at)
     VALUES ($1, $2, 1, 2, 2, now() - $3::interval)`,
    [id, DIGEST, idle],
  );
  await db.query('UPDATE app_user SET import_dataset_id = $2 WHERE user_id = $1', [user, id]);
  return id;
};

/** A user with a live dataset of rows, who then cleared it and has written nothing since. */
const cleared = async (user: string, email: string, n: number) => {
  await insertUser(db, user, email);
  await writeLedger(db, user, ledger(n));
  return clear(user);
};

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a dataset neither pointer names', () => {
  it('is removed from every user by one run, with no write from its owner', async () => {
    const aliceDead = await cleared(ALICE, 'alice@quirenote.com', 10);
    const bobDead = await cleared(BOB, 'bob@quirenote.com', 40);
    // What a sweep must leave: Alice's live rows and an import she opened a day ago.
    await writeLedger(db, ALICE, ledger(20));
    const aliceStaged = await stage(ALICE, 30, '1 day');
    const [live, staged] = [(await pointers(ALICE)).live!, aliceStaged];
    const kept = [await rowsIn(live), await rowsIn(staged)];
    expect(kept.every((n) => n > 0)).toBe(true);
    expect([await rowsIn(aliceDead), await rowsIn(bobDead)].every((n) => n > 0)).toBe(true);

    await expect(sweep(cluster, ample)).resolves.toBe(true);

    expect([await rowsIn(aliceDead), await rowsIn(bobDead)]).toEqual([0, 0]);
    expect([await garbage(ALICE), await garbage(BOB)]).toEqual([0, 0]);
    expect([await rowsIn(live), await rowsIn(staged)]).toEqual(kept);
    expect(await pointers(ALICE)).toEqual({ live, staged });
  });

  it('leaves a user with nothing to collect alone', async () => {
    await insertUser(db, BOB, 'bob@quirenote.com');
    await writeLedger(db, BOB, ledger(40));
    const live = (await pointers(BOB)).live!;
    const before = await rowsIn(live);
    await sweep(cluster, ample);
    expect(await rowsIn(live)).toBe(before);
  });
});

describe('an import staging', () => {
  it('idle seven days and a minute is expired and collected with no write from its owner', async () => {
    await insertUser(db, ALICE, 'alice@quirenote.com');
    await writeLedger(db, ALICE, ledger(10));
    const id = await stage(ALICE, 30, '7 days 1 minute');
    expect(await rowsIn(id)).toBeGreaterThan(0);

    await sweep(cluster, ample);

    expect((await pointers(ALICE)).staged).toBeNull();
    expect(await rowsIn(id)).toBe(0);
  });

  it('idle six days is left as it is', async () => {
    await insertUser(db, BOB, 'bob@quirenote.com');
    await writeLedger(db, BOB, ledger(40));
    const id = await stage(BOB, 50, '6 days');
    const before = await rowsIn(id);

    await sweep(cluster, ample);

    expect((await pointers(BOB)).staged).toBe(id);
    expect(await rowsIn(id)).toBe(before);
  });
});

describe('a collection that fails', () => {
  it('is reported, and the next user is still collected for', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    await cleared(BOB, 'bob@quirenote.com', 40);
    let attempts = 0;
    const refusing: SqlClient = {
      query: (text, values) => {
        if (!/^\s*DELETE/.test(text)) return db.query(text, values);
        attempts += 1;
        return Promise.reject(new Error('the cluster went away'));
      },
    };
    await expect(sweep(refusing, ample)).resolves.toBe(false);
    expect(attempts).toBe(2);
  });

  // Both codes DSQL reports a lost write conflict under, as `retryable` in `provision.ts` reads them.
  it.each(['40001', 'XX000'])(
    'is no failure when it lost a write conflict (%s), which the next run retries',
    async (code) => {
      await cleared(ALICE, 'alice@quirenote.com', 10);
      const conflicting: SqlClient = {
        query: (text, values) =>
          /^\s*DELETE/.test(text)
            ? Promise.reject(Object.assign(new Error('change conflicts'), { code }))
            : db.query(text, values),
      };
      await expect(sweep(conflicting, ample)).resolves.toBe(true);
    },
  );
});

describe('the thirty days', () => {
  it('hold an import idle past its limit to the next daily run', () => {
    const idle = /^(\d+) days$/.exec(IDLE_LIMIT);
    expect(idle).not.toBeNull();
    // Past the limit, then at most a day to the next firing of `cron(0 3 * * ? *)`.
    expect(Number(idle?.[1]) + 1).toBeLessThanOrEqual(30);
  });
});

describe('the time budget', () => {
  /** The cluster, counting the deletes it has taken. */
  const counting = () => {
    const seen = { deletes: 0 };
    const client: SqlClient = {
      query: (text, values) => {
        if (/^\s*DELETE/.test(text)) seen.deletes += 1;
        return db.query(text, values);
      },
    };
    return { client, seen };
  };

  it('stops cleanly once the time is out, and the next run finishes the job', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    await cleared(BOB, 'bob@quirenote.com', 40);
    const [alice, bob] = [await garbage(ALICE), await garbage(BOB)];

    // Time enough for the first batch, and none after it.
    const { client, seen } = counting();
    await expect(sweep(client, () => (seen.deletes > 0 ? 0 : ample()))).resolves.not.toThrow();

    expect(await garbage(ALICE)).toBeGreaterThan(0);
    expect(await garbage(ALICE)).toBeLessThan(alice);
    expect(await garbage(BOB)).toBe(bob);

    await sweep(cluster, ample);
    expect([await garbage(ALICE), await garbage(BOB)]).toEqual([0, 0]);
  });

  it('starts nothing with no time at all', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    const before = await garbage(ALICE);
    await sweep(cluster, () => 0);
    expect(await garbage(ALICE)).toBe(before);
  });

  it('keeps ten seconds back for the batch in flight', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    const before = await garbage(ALICE);
    await sweep(cluster, () => 10_000);
    expect(await garbage(ALICE)).toBe(before);
    await sweep(cluster, () => 10_001);
    expect(await garbage(ALICE)).toBe(0);
  });
});

// A hand `{}` runs the same sweep and is still not the schedule's firing, which the two alarms read.
describe('the scheduled run’s own lines', () => {
  const context = (ms = 60_000) => ({ getRemainingTimeInMillis: () => ms });

  /** The two signal lines among everything the run logged, parsed. */
  const signals = () =>
    vi.mocked(console.log).mock.calls.flatMap(([line]) => {
      try {
        const parsed = JSON.parse(String(line)) as { metric?: unknown };
        return parsed.metric === RAN.metric || parsed.metric === FAILED.metric ? [parsed] : [];
      } catch {
        return [];
      }
    });

  const connected = (query: SqlClient['query'] = cluster.query) => {
    const end = vi.fn(async () => {});
    vi.mocked(connect).mockResolvedValue({ query, end } as never);
    return end;
  };
  const refusingDeletes: SqlClient['query'] = (text, values) =>
    /^\s*DELETE/.test(text)
      ? Promise.reject(new Error('the cluster went away'))
      : cluster.query(text, values);

  it('writes the run line alone when the sweep finishes', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    connected();
    await handler({ scheduled: true }, context());
    expect(signals()).toEqual([RAN]);
    expect(await garbage(ALICE)).toBe(0);
  });

  it('writes the run line alone when the time runs out, and throws nothing', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    connected();
    await expect(handler({ scheduled: true }, context(0))).resolves.not.toThrow();
    expect(signals()).toEqual([RAN]);
  });

  it('writes the failed line beside the run line when a collection fails, and still answers', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    connected(refusingDeletes);
    await handler({ scheduled: true }, context());
    expect(signals()).toEqual([RAN, FAILED]);
  });

  it('writes the failed line alone when the sweep throws, and throws', async () => {
    connected(() => Promise.reject(new Error('the cluster went away')));
    await expect(handler({ scheduled: true }, context())).rejects.toThrow('the cluster went away');
    expect(signals()).toEqual([FAILED]);
  });

  it('writes the failed line alone when the connection is refused, and throws', async () => {
    await expect(handler({ scheduled: true }, context())).rejects.toThrow('no cluster in a test');
    expect(signals()).toEqual([FAILED]);
  });

  it('writes neither line for a run nobody scheduled', async () => {
    await cleared(ALICE, 'alice@quirenote.com', 10);
    connected(refusingDeletes);
    await handler({}, context());
    connected(() => Promise.reject(new Error('the cluster went away')));
    await expect(handler({}, context())).rejects.toThrow('the cluster went away');
    expect(signals()).toEqual([]);
  });

  it('closes the session, whatever the run did', async () => {
    const ok = connected();
    await handler({ scheduled: true }, context());
    expect(ok).toHaveBeenCalledTimes(1);
    const failed = connected(() => Promise.reject(new Error('the cluster went away')));
    await expect(handler({ scheduled: true }, context())).rejects.toThrow();
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
