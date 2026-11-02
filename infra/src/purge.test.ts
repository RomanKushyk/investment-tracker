// The purge on PGlite with every migration (#576): a scheduled deletion runs as its last day ends in
// Kyiv, through the same core as a deletion asked for at once, and one that fails is finished by a
// later run with nobody asking. Each deletion is read back, never taken from the answer.
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { applyUserSchema, insertUser, writeLedger } from './__fixtures__/user-ledger';
import type { AccountIdentity } from './account-delete';
import { authorize } from './authorize';
import { connect } from './dsql';
import type { ApiEvent } from './http';
import type { SqlClient } from './migrate';
import { type PurgeDeps, handler, purge } from './purge';

vi.mock('./dsql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./dsql')>()),
  connect: vi.fn(),
}));

// The handler's own client: every call answers as a pool with nobody to find, so nothing reaches AWS.
vi.mock('@aws-sdk/client-cognito-identity-provider', async (actual) => ({
  ...(await actual<typeof import('@aws-sdk/client-cognito-identity-provider')>()),
  CognitoIdentityProviderClient: vi.fn(function () {
    return { send: async () => ({}) };
  }),
}));

const POOL = 'eu-north-1_EXAMPLE';
const ALICE = '9f1e2d3c-0000-4000-8000-0000000000a1';
const ALICE_EMAIL = 'alice@quirenote.com';
const BOB = '9f1e2d3c-0000-4000-8000-0000000000b2';
const BOB_EMAIL = 'bob@quirenote.com';
const DUE = '2026-11-29';
/** The last instant of the last day in Kyiv (UTC+2 in November), and the run after it. */
const LAST_INSTANT = Date.parse('2026-11-29T21:59:59.999Z');
const AFTER = Date.parse('2026-11-29T22:05:00Z');
const PLENTY = () => 60_000;

let db: PGlite;
let pooled: Set<string>;
let calls: string[];

const missing = () =>
  Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
const identity: AccountIdentity = {
  adminUserGlobalSignOut: async ({ Username }) => {
    calls.push(`signOut ${Username}`);
    if (!pooled.has(Username)) throw missing();
    return {};
  },
  adminDeleteUser: async ({ Username }) => {
    calls.push(`delete ${Username}`);
    if (!pooled.delete(Username)) throw missing();
    return {};
  },
  listUsers: async () => ({ Users: [] }),
};

const deps = (over: Partial<PurgeDeps> = {}): PurgeDeps => ({
  user: db as unknown as SqlClient,
  identity,
  userPoolId: POOL,
  now: () => AFTER,
  ...over,
});

const ledger = {
  assets: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'REIT',
      code: 'RE',
      colorKey: 'reit' as const,
      yieldType: 'dividends' as const,
      expectedPct: 10,
      targetPct: 25,
      payoutSchedule: 'monthly' as const,
      firstPurchase: '2026-03-02',
      createdAt: '2026-03-02T09:00:00',
    },
  ],
  transactions: [],
  userPrices: [],
};

const hold = (userId: string, due = DUE) =>
  db.query(
    `UPDATE app_user SET deletion_due = $2, deletion_requested_at = '2026-10-30T12:00:00Z'
      WHERE user_id = $1`,
    [userId, due],
  );
const rows = async () =>
  (await db.query<{ user_id: string }>('SELECT user_id FROM app_user ORDER BY email')).rows.map(
    (r) => r.user_id,
  );
const assets = async () => (await db.query('SELECT 1 FROM asset')).rows.length;

beforeEach(async () => {
  db = await freshDb();
  await applyUserSchema(db);
  await insertUser(db, ALICE, ALICE_EMAIL);
  await writeLedger(db, ALICE, ledger);
  await insertUser(db, BOB, BOB_EMAIL);
  await hold(ALICE);
  pooled = new Set([ALICE_EMAIL, BOB_EMAIL]);
  calls = [];
  vi.stubEnv('OPEN_REGISTRATION', 'false');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.mocked(connect).mockRejectedValue(new Error('no cluster in a test'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the purge', () => {
  it('touches nothing while the last day has not ended in Kyiv', async () => {
    expect(await purge(deps({ now: () => LAST_INSTANT }), PLENTY)).toBe(true);
    expect(await rows()).toEqual([ALICE, BOB]);
    expect(await assets()).toBe(1);
    expect(calls).toEqual([]);
  });

  it('deletes the account, its data and its identity once that day has ended', async () => {
    expect(await purge(deps(), PLENTY)).toBe(true);
    expect(await rows()).toEqual([BOB]);
    expect(await assets()).toBe(0);
    expect(pooled).toEqual(new Set([BOB_EMAIL]));
    expect(calls).toContain(`signOut ${ALICE_EMAIL}`);
  });

  it('leaves an account no deletion waits on, and one whose day is still to end', async () => {
    await hold(BOB, '2026-11-30');
    await purge(deps(), PLENTY);
    expect(await rows()).toEqual([BOB]);
    await db.query('UPDATE app_user SET deletion_due = NULL, deletion_requested_at = NULL');
    await purge(deps({ now: () => Date.parse('2026-12-31T00:00:00Z') }), PLENTY);
    expect(await rows()).toEqual([BOB]);
  });

  it('starts nothing past its reserve, leaving the account to the next run', async () => {
    expect(await purge(deps(), () => 0)).toBe(true);
    expect(await rows()).toEqual([ALICE, BOB]);
    expect(calls).toEqual([]);
  });

  it('answers false when one fails, goes on to the next, and a later run finishes it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await insertUser(db, '9f1e2d3c-0000-4000-8000-0000000000c3', 'carol@quirenote.com');
    await hold('9f1e2d3c-0000-4000-8000-0000000000c3');
    pooled.add('carol@quirenote.com');
    const failing: AccountIdentity = {
      ...identity,
      adminDeleteUser: (input) =>
        input.Username === ALICE_EMAIL
          ? Promise.reject(new Error('the pool said no'))
          : identity.adminDeleteUser(input),
    };
    expect(await purge(deps({ identity: failing }), PLENTY)).toBe(false);
    expect(pooled.has(ALICE_EMAIL)).toBe(true);
    // The row stays while the identity does: it is how the next run finds what is left.
    expect(await rows()).toContain(ALICE);
    expect(pooled.has('carol@quirenote.com')).toBe(false);
    // Nobody asks: the next run finds the rest due and finishes it.
    expect(await purge(deps({ now: () => AFTER + 3_600_000 }), PLENTY)).toBe(true);
    expect(await rows()).toEqual([BOB]);
    expect(pooled).toEqual(new Set([BOB_EMAIL]));
  });

  it('answers false and keeps the account when it is the only super-admin', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.query("UPDATE app_user SET role = 'super_admin' WHERE user_id = $1", [ALICE]);
    expect(await purge(deps(), PLENTY)).toBe(false);
    expect(await rows()).toEqual([ALICE, BOB]);
    expect(calls).toEqual([]);
  });

  // Its own steps, once each: the sessions, the identities, then the rows, with no second pass of
  // the core over what it has just done, inside a run's bounded time.
  it('asks the pool for the address’s profiles once to end the sessions and once to delete', async () => {
    let listed = 0;
    const counting: AccountIdentity = {
      ...identity,
      listUsers: async (input) => {
        listed += 1;
        return identity.listUsers(input);
      },
    };
    expect(await purge(deps({ identity: counting }), PLENTY)).toBe(true);
    expect(listed).toBe(2);
    expect(calls).toEqual([`signOut ${ALICE_EMAIL}`, `delete ${ALICE_EMAIL}`]);
    expect(await rows()).toEqual([BOB]);
  });

  it('deletes a held super-admin while another stands free, and refuses both when both are held', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await db.query("UPDATE app_user SET role = 'super_admin'");
    expect(await purge(deps(), PLENTY)).toBe(true);
    expect(await rows()).toEqual([BOB]);

    await insertUser(db, ALICE, ALICE_EMAIL, 'active', 'super_admin');
    await hold(ALICE);
    await hold(BOB);
    expect(await purge(deps(), PLENTY)).toBe(false);
    expect(await rows()).toEqual([ALICE, BOB]);
  });

  it('names no address in what it logs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing: AccountIdentity = {
      ...identity,
      adminDeleteUser: () => Promise.reject(new Error('the pool said no')),
    };
    await purge(deps({ identity: failing }), PLENTY);
    const logged = JSON.stringify([...errors.mock.calls, ...vi.mocked(console.log).mock.calls]);
    expect(logged).toContain(ALICE);
    expect(logged).not.toContain(ALICE_EMAIL);
  });

  it('leaves the account answering as deleted, never as held, to a token it signed in with', async () => {
    await purge(deps(), PLENTY);
    const e: ApiEvent = {
      requestContext: {
        authorizer: {
          jwt: {
            claims: {
              token_use: 'id',
              sub: ALICE,
              email: ALICE_EMAIL,
              email_verified: 'true',
              auth_time: String(Date.parse('2026-11-01T00:00:00Z') / 1000),
            },
          },
        },
      },
    };
    const gate = await authorize(db as unknown as SqlClient, e, { now: () => AFTER });
    expect(gate).toEqual({
      refusal: expect.objectContaining({ body: '{"error":"no_application"}' }),
    });
  });
});

// A hand `{}` runs the same purge and is not the schedule's firing, which the two alarms read.
describe('the scheduled run’s own lines', () => {
  const context = (ms = 60_000) => ({ getRemainingTimeInMillis: () => ms });
  const RAN = { metric: 'purgeRun', value: 1 };
  const FAILED = { metric: 'purgeRunFailed', value: 1 };
  const signals = () =>
    vi.mocked(console.log).mock.calls.flatMap(([line]) => {
      try {
        const parsed = JSON.parse(String(line)) as { metric?: unknown };
        return parsed.metric === RAN.metric || parsed.metric === FAILED.metric ? [parsed] : [];
      } catch {
        return [];
      }
    });
  const connected = (query: SqlClient['query']) => {
    const end = vi.fn(async () => {});
    vi.mocked(connect).mockResolvedValue({ query, end } as never);
    return end;
  };

  beforeEach(() => {
    vi.stubEnv('USER_POOL_ID', POOL);
  });

  it('writes the run line alone when nothing is due, and closes its connection', async () => {
    await db.query('UPDATE app_user SET deletion_due = NULL, deletion_requested_at = NULL');
    const end = connected((text, values) => db.query(text, values));
    await handler({ scheduled: true }, context());
    expect(signals()).toEqual([RAN]);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('writes both lines when a deletion fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    connected((text, values) =>
      /^\s*DELETE/.test(text)
        ? Promise.reject(new Error('the cluster went away'))
        : db.query(text, values),
    );
    vi.spyOn(Date, 'now').mockReturnValue(AFTER);
    await handler({ scheduled: true }, context());
    expect(signals()).toEqual([RAN, FAILED]);
  });

  it('writes the failed line alone when the connection is refused, and throws', async () => {
    await expect(handler({ scheduled: true }, context())).rejects.toThrow('no cluster in a test');
    expect(signals()).toEqual([FAILED]);
  });

  it('writes the failed line alone when the function names no pool, and throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('USER_POOL_ID', '');
    connected((text, values) => db.query(text, values));
    await expect(handler({ scheduled: true }, context())).rejects.toThrow('USER_POOL_ID');
    expect(signals()).toEqual([FAILED]);
  });

  it('writes no line on a hand run', async () => {
    await db.query('UPDATE app_user SET deletion_due = NULL, deletion_requested_at = NULL');
    connected((text, values) => db.query(text, values));
    await handler({}, context());
    expect(signals()).toEqual([]);
  });
});
