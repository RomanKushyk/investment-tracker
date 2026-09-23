// Provisioning, executed. THE POINT OF THE TRANSACTION IS THE FOREIGN KEY: `transaction.account_id`
// is NOT NULL against `account(user_id, id)`, so a user row that landed without its account is not
// an empty state anybody can render — it is a user who cannot write. Both rows go together or
// neither does.
//
// WHAT THIS CANNOT PROVE: PGlite is pessimistic, so no assertion here produces a real `40001`. The
// retry is measured against a fabricated one, and DSQL's own behaviour — that `ON CONFLICT DO
// NOTHING` does not exempt an insert from OCC adjudication — stays recorded in
// `infra/docs/dsql-constraints.md`.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
import { MIGRATIONS, type SqlClient, statementsOf as statements } from './migrate';
import { provision } from './provision';

const DML = ['005_demo_user.sql', '008_demo_account.sql'];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const USER = '9f1e2d3c-0000-4000-8000-0000000000a1';
const EMAIL = 'applicant@quirenote.com';

let db: PGlite;

/** What both real callers hand `provision`: a user write that is a no-op the second time, which is
 *  what lets the whole transaction be re-run. `provision` returning `existing` after a raised
 *  duplicate depends on it too — the rollback that answer follows must lose nothing. */
const writeUser = (client: SqlClient) => () =>
  client.query(
    `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
       VALUES ($1, $2, 'active', 'user', now(), now(), $1)
     ON CONFLICT (user_id) DO NOTHING`,
    [USER, EMAIL],
  );

const accounts = async () =>
  (
    await db.query<{ user_id: string; id: string; provider: string; name: string }>(
      'SELECT user_id, id, provider, name FROM account ORDER BY id',
    )
  ).rows;

const users = async () => (await db.query('SELECT user_id FROM app_user')).rows;

/** The real cluster, except that one statement fails — so a failure lands mid-transaction. */
const failingOn = (needle: string): SqlClient => ({
  query: async <R>(text: string, values?: unknown[]) => {
    if (text.includes(needle)) throw new Error('the cluster said no');
    return db.query<R>(text, values) as Promise<{ rows: R[] }>;
  },
});

/**
 * The real cluster, except that the first `COMMIT` answers a code WITHOUT reaching it — which is
 * the state a conflicting transaction is really in: still open, waiting to be rolled back. Every
 * statement is recorded, so "it started again" is assertable rather than inferred from the rows.
 */
const refusingFirstCommit = (code: string) => {
  const sent: string[] = [];
  let refused = false;
  const client: SqlClient = {
    query: async <R>(text: string, values?: unknown[]) => {
      sent.push(text);
      if (text === 'COMMIT' && !refused) {
        refused = true;
        throw Object.assign(new Error('change conflicts with another transaction (OC000)'), {
          code,
        });
      }
      return db.query<R>(text, values) as Promise<{ rows: R[] }>;
    },
  };
  return { client, sent };
};

beforeEach(async () => {
  db = await freshDb();
  for (const stmt of DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')))) {
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
});

describe('a user and their account are one write', () => {
  it('gives the user exactly one account, under the only provider in use', async () => {
    expect(await provision(db, USER, writeUser(db))).toBe('created');
    expect(await accounts()).toEqual([
      {
        user_id: USER,
        id: expect.any(String),
        provider: 'inzhur',
        name: 'Inzhur',
      },
    ]);
  });

  // READ RATHER THAN RETURNED, and the distinction the whole module turns on. `SqlClient` promises
  // `rows` alone, so the alternative was `RETURNING` on a suppressed `ON CONFLICT` — a combination
  // no probe has sent to DSQL, and one `migrate.ts` keeps off `BOOTSTRAP_ROW` for that reason. A
  // `SELECT` inside the same transaction answers the same question without that second doubt.
  it('says created for an insert that performed and existing for one suppressed', async () => {
    expect(await provision(db, USER, writeUser(db))).toBe('created');
    expect(await provision(db, USER, writeUser(db))).toBe('existing');
    expect(await accounts()).toHaveLength(1);
  });

  it('leaves neither row behind when the account insert fails', async () => {
    const client = failingOn('INSERT INTO account');
    await expect(provision(client, USER, writeUser(client))).rejects.toThrow(/the cluster said no/);
    expect(await users()).toEqual([]);
    expect(await accounts()).toEqual([]);
  });
});

describe('contention is retried, and nothing else is', () => {
  it('starts the transaction again on 40001 and settles with one account', async () => {
    const { client, sent } = refusingFirstCommit('40001');
    expect(await provision(client, USER, writeUser(client))).toBe('created');
    expect(sent.filter((t) => t === 'BEGIN')).toHaveLength(2);
    expect(sent.filter((t) => t === 'ROLLBACK')).toHaveLength(1);
    expect(await accounts()).toHaveLength(1);
  });

  // A REFUSAL IS REPORTED, NEVER HAMMERED — the runner's teardown draws the same line.
  it('reports a code that is not contention on the first attempt', async () => {
    const { client, sent } = refusingFirstCommit('42501');
    await expect(provision(client, USER, writeUser(client))).rejects.toThrow(/OC000/);
    expect(sent.filter((t) => t === 'BEGIN')).toHaveLength(1);
    expect(await accounts()).toEqual([]);
  });

  /**
   * `ON CONFLICT (user_id, provider)` names the SECONDARY unique index, and `dsql-constraints.md`
   * measured suppression on the PRIMARY KEY alone — so the raised shape is kept rather than assumed
   * away, exactly as `applications.ts` keeps it for `app_user_email_uq`. The constraint NAME is
   * what makes the branch safe: a `23505` on its own does not say which index refused.
   */
  it('reads a duplicate raised rather than suppressed as the account already being there', async () => {
    await provision(db, USER, writeUser(db));
    const raising: SqlClient = {
      query: async <R>(text: string, values?: unknown[]) => {
        if (text.includes('INSERT INTO account')) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'account_user_provider_uq',
          });
        }
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    expect(await provision(raising, USER, writeUser(raising))).toBe('existing');
    expect(await accounts()).toHaveLength(1);
  });

  it('does not absorb a duplicate raised by another constraint', async () => {
    const raising: SqlClient = {
      query: async <R>(text: string, values?: unknown[]) => {
        if (text.includes('INSERT INTO account')) {
          throw Object.assign(new Error('duplicate key value violates unique constraint'), {
            code: '23505',
            constraint: 'app_user_email_uq',
          });
        }
        return db.query<R>(text, values) as Promise<{ rows: R[] }>;
      },
    };
    await expect(provision(raising, USER, writeUser(raising))).rejects.toThrow(/duplicate key/);
  });
});

// THE WHOLE REASON THE ROW EXISTS. `transaction_account_fk` is composite and `account_id` is NOT
// NULL with exactly one value to hold, so this insert is what every mutation will do first.
describe('a freshly provisioned user can be written against', () => {
  it('takes a transaction naming the account provisioning just made', async () => {
    await provision(db, USER, writeUser(db));
    const [account] = await accounts();
    await expect(
      db.query(
        `INSERT INTO transaction (user_id, id, account_id, date, type, amount, created_at)
           VALUES ($1, '9f1e2d3c-0000-4000-8000-0000000000f6', $2, '2026-08-26', 'deposit',
                   1000, now())`,
        [USER, account.id],
      ),
    ).resolves.toBeDefined();
  });
});
