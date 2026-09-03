// W7's user-schema draft, executed.
// `infra/migrations/drafts/003_user_schema.sql`
// is a pinned contract with IMMUTABLE primary keys (D30), so a mistake in it is
// a DROP/CREATE of live user data rather than a migration — and until W7 there
// is no other consumer to notice one.
//
// PGlite is Postgres compiled to WASM, so the parser, the planner and every
// CHECK below are Postgres's own. No server, no daemon, no container. That is
// what makes the "local Postgres for the inner loop" the cloud-stack spec
// committed to actually available here.
//
// WHAT THIS CANNOT PROVE: nothing about Aurora DSQL acceptance. Local
// Postgres is the SUBSET, and this file is why BOTH halves of the index line
// stay Postgres-shaped in the generated SQL: `CREATE INDEX ASYNC` is DSQL-only
// and would fail here, and `USING btree` is what drizzle-kit emits and what
// this suite needs — DSQL rejects it outright (D99). So promotion rewrites
// every index line TWICE, inserting `ASYNC` and stripping `USING btree`
// (`infra/migrations/drafts/README.md`); doing only the first still gives a
// statement the cluster refuses. A DSQL-only rejection stays invisible to this
// test by construction, so the suite is not a substitute for first contact —
// which for the DDL has now happened (`infra/docs/dsql-constraints.md`),
// and for the migration RUNNER has not.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

// Promotion moves the file up one directory (the draft's PROMOTION PATH); this
// path moves with it, in the same commit.
const SCHEMA = new URL('../migrations/drafts/003_user_schema.sql', import.meta.url);

/**
 * Statements, comment lines stripped FIRST.
 *
 * The generated SQL carries `--> statement-breakpoint` lines between
 * statements; stripping them before splitting on `;` keeps a breakpoint
 * marker from landing inside the next statement's text.
 */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const uuid = (c: string) =>
  `'${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}'`;

/**
 * A FRESH id per insert.
 *
 * Reusing one throwaway id across tests was safe only while every test using it
 * expected a rejection. The moment a case flipped to accepting — a tax with no
 * asset, a moving row WITH a count — the row persisted and the next test collided
 * on the primary key, failing for a reason that had nothing to do with what it
 * was checking. Sequential rather than random so a failure is reproducible.
 */
let seq = 0;
const nextId = () => {
  seq += 1;
  return `'00000000-0000-4000-8000-${String(seq).padStart(12, '0')}'`;
};

const USER = uuid('1');
const ACCOUNT = uuid('2');
const ASSET = uuid('3');
const PAYOUT = uuid('4');

let db: PGlite;
let applied = 0;

/** Reject = the database refuses. The message is not asserted; the refusal is. */
async function refuses(stmt: string): Promise<void> {
  await expect(db.exec(stmt)).rejects.toThrow();
}
async function accepts(stmt: string): Promise<void> {
  await expect(db.exec(stmt)).resolves.toBeDefined();
}

/** An `asset` insert with every NOT NULL column the app declares required. */
const insertAsset = (id: string, cols = '', vals = '') =>
  `INSERT INTO asset (user_id, id, name, code, color_slot, yield_type, expected_pct,
                      target_pct, payout_schedule, first_purchase, created_at${cols})
   VALUES (${USER}, ${id}, 'REIT', 'RE', 0, 'dividends', 10, 25, 'monthly',
           '2026-02-03', now()${vals});`;

/** Trailing four: asset_id, quantity, unit_price, settles_payout_id. */
const insertTx = (id: string, type: string, tail = 'NULL, NULL, NULL, NULL', amount = '100') =>
  `INSERT INTO transaction (user_id, id, account_id, date, type, amount,
                            asset_id, quantity, unit_price, settles_payout_id, created_at)
   VALUES (${USER}, ${id}, ${ACCOUNT}, '2026-08-26', '${type}', ${amount}, ${tail}, now());`;

beforeAll(async () => {
  db = new PGlite();
  const stmts = statements(readFileSync(SCHEMA, 'utf8'));
  for (const stmt of stmts) {
    // A failure here names the statement rather than the file.
    await db.exec(stmt + ';').catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  applied = stmts.length;

  // The baseline every constraint below is measured against: one approved user,
  // one provider account, one asset, one payout for a tax row to settle.
  await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                       decided_at, decided_by)
                   VALUES (${USER}, 'owner@quirenote.com', 'active', 'super_admin',
                           now(), now(), ${USER});`);
  await db.exec(`INSERT INTO account (user_id, id, provider, name, created_at)
                   VALUES (${USER}, ${ACCOUNT}, 'inzhur', 'Inzhur', now());`);
  await db.exec(insertAsset(ASSET));
  await db.exec(insertTx(PAYOUT, 'dividend_payout', `${ASSET}, NULL, NULL, NULL`));
});

describe('the draft applies as Postgres', () => {
  it('applies every statement', () => {
    expect(applied).toBeGreaterThan(0);
  });

  it('creates exactly the five tables the spec names', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'account',
      'app_user',
      'asset',
      'transaction',
      'user_price',
    ]);
  });

  it('leads every per-user key with `user_id` (contract 3)', async () => {
    // The reason is DSQL's index-organized key, which this engine cannot show;
    // what IS checkable is that the declared key order says what the contract
    // says, and that is the part a later edit would silently break.
    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `SELECT c.table_name, c.column_name
         FROM information_schema.table_constraints t
         JOIN information_schema.key_column_usage c
           ON c.constraint_name = t.constraint_name
        WHERE t.constraint_type = 'PRIMARY KEY'
          AND t.table_schema = 'public'
          AND c.ordinal_position = 1
        ORDER BY c.table_name`,
    );
    const leading = Object.fromEntries(rows.map((r) => [r.table_name, r.column_name]));
    expect(leading).toEqual({
      account: 'user_id',
      app_user: 'user_id',
      asset: 'user_id',
      transaction: 'user_id',
      user_price: 'user_id',
    });
  });
});

describe('app_user', () => {
  const other = (id: string, email: string, status = 'pending', role = 'user') =>
    `INSERT INTO app_user (user_id, email, status, role, applied_at)
       VALUES (${id}, '${email}', '${status}', '${role}', now());`;

  it('refuses a status outside pending | active | rejected', async () => {
    await refuses(other(nextId(), 'a@x.com', 'approved'));
  });

  it('refuses a role outside user | super_admin', async () => {
    await refuses(other(nextId(), 'b@x.com', 'pending', 'admin'));
  });

  it('refuses a second row on the same email', async () => {
    await refuses(other(nextId(), 'owner@quirenote.com'));
  });

  it('refuses an `active` row with no decision recorded', async () => {
    await refuses(other(nextId(), 'c@x.com', 'active'));
  });

  it('refuses a `pending` row that already carries a decision', async () => {
    await refuses(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                     VALUES (${nextId()}, 'e@x.com', 'pending', 'user', now(),
                             now(), ${USER});`);
  });

  it('ACCEPTS the same mailbox in another case — the unique index is byte-exact', async () => {
    // Pinned as a fact, not as an approval. The draft's comment says so: Cognito
    // normalizes the address and is what holds this line; if the API ever
    // accepts an address Cognito has not seen, it must lower-case on write.
    await accepts(other(nextId(), 'OWNER@quirenote.com'));
  });
});

describe('account', () => {
  it('refuses the same provider twice for one user', async () => {
    await refuses(`INSERT INTO account (user_id, id, provider, name, created_at)
                     VALUES (${USER}, ${nextId()}, 'inzhur', 'again', now());`);
  });

  it('accepts a second provider', async () => {
    await accepts(`INSERT INTO account (user_id, id, provider, name, created_at)
                     VALUES (${USER}, ${nextId()}, 'other-broker', 'Other', now());`);
  });
});

describe('asset', () => {
  it('accepts a hand-valued asset with no provider link', async () => {
    await accepts(insertAsset(nextId()));
  });

  it('accepts a linked fund', async () => {
    await accepts(
      insertAsset(nextId(), ', provider_kind, provider_ref', ", 'fund', 'inzhur-reit'"),
    );
  });

  it('refuses a provider_ref with no provider_kind', async () => {
    await refuses(insertAsset(nextId(), ', provider_ref', ", 'inzhur-reit'"));
  });

  it('refuses an unknown provider_kind', async () => {
    await refuses(insertAsset(nextId(), ', provider_kind, provider_ref', ", 'etf', 'x'"));
  });

  it('refuses a yield_type outside the four the app declares', async () => {
    await refuses(insertAsset(nextId()).replace("'dividends'", "'dividend'"));
  });

  it('refuses a payout_schedule outside the five', async () => {
    await refuses(insertAsset(nextId()).replace("'monthly'", "'semi_annual'"));
  });

  it('refuses a color_slot past the palette — which has FOUR entries', async () => {
    await refuses(insertAsset(nextId()).replace(', 0,', ', 4,'));
  });

  it('refuses a code that is not two letters', async () => {
    await refuses(insertAsset(nextId()).replace("'RE'", "'REIT'"));
  });

  it('refuses a negative expected_pct and a target_pct over 100', async () => {
    await refuses(insertAsset(nextId()).replace(', 10, 25,', ', -1, 25,'));
    await refuses(insertAsset(nextId()).replace(', 10, 25,', ', 10, 101,'));
  });

  it('refuses an omitted expected_pct, which the app declares required', async () => {
    await refuses(`INSERT INTO asset (user_id, id, name, code, color_slot, yield_type,
                                      target_pct, payout_schedule, first_purchase, created_at)
                     VALUES (${USER}, ${nextId()}, 'x', 'XX', 1, 'dividends', 25,
                             'monthly', '2026-02-03', now());`);
  });
  it('refuses a coupon rate outside the range the form allows', async () => {
    // D119: 0 and negatives are not smaller rates — `couponPerPayment` gates on
    // `rate > 0`, so they read as ABSENT and fall back to the legacy amount with
    // nothing to say they did. Over 100 scales every coupon the asset produces.
    await refuses(insertAsset(nextId(), ', coupon_rate_pct', ', 0'));
    await refuses(insertAsset(nextId(), ', coupon_rate_pct', ', -1'));
    await refuses(insertAsset(nextId(), ', coupon_rate_pct', ', 250'));
    await accepts(insertAsset(nextId(), ', coupon_rate_pct', ', 15.68'));
    await accepts(insertAsset(nextId(), ', coupon_rate_pct', ', NULL'));
  });
});

describe('transaction', () => {
  it('accepts a deposit with no asset and no quantity', async () => {
    await accepts(insertTx(nextId(), 'deposit'));
  });

  it('accepts a buy with an asset and a quantity', async () => {
    await accepts(insertTx(nextId(), 'buy', `${ASSET}, 12.5, 8.0, NULL`));
  });

  it('ACCEPTS a tax row with no asset — required only when it settles a payout', async () => {
    // The first draft's biconditional forced an asset onto every tax row, which
    // the spec does not.
    await accepts(insertTx(nextId(), 'tax', 'NULL, NULL, NULL, NULL'));
  });

  it('refuses a deposit that invents a quantity', async () => {
    await refuses(insertTx(nextId(), 'deposit', 'NULL, 1, NULL, NULL'));
  });

  it('refuses a payout that invents a unit_price, the same as a quantity', async () => {
    // The price is the other half of one fact — what a position movement cost
    // per unit — so it takes the rule the count takes. The application enforces
    // both at all three of its doors; a schema governing only the count would
    // let a migration land a row the app refuses to write.
    await refuses(insertTx(nextId(), 'dividend_payout', `${ASSET}, NULL, 11.14, NULL`));
    await refuses(insertTx(nextId(), 'tax', 'NULL, NULL, 11.14, NULL'));
  });

  it('still ACCEPTS a unit_price on a row that does move a position', async () => {
    await accepts(insertTx(nextId(), 'redemption', `${ASSET}, 5, 11.14, NULL`));
  });

  it('refuses a buy with no asset — a position nothing owns', async () => {
    await refuses(insertTx(nextId(), 'buy', 'NULL, 5, NULL, NULL'));
  });

  it('refuses a deposit carrying an asset — external cash attributed to a holding', async () => {
    await refuses(insertTx(nextId(), 'deposit', `${ASSET}, NULL, NULL, NULL`));
  });

  it('refuses a negative amount', async () => {
    await refuses(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '-5'));
  });

  it('refuses a negative quantity', async () => {
    // Contract 5: the sign of an amount comes from the type, so a negative
    // quantity is not redundant with anything — it would flip the position
    // movement independently, and nothing else records units.
    await refuses(insertTx(nextId(), 'sell', `${ASSET}, -5, NULL, NULL`));
  });

  it('refuses a zero quantity', async () => {
    await refuses(insertTx(nextId(), 'buy', `${ASSET}, 0, NULL, NULL`));
  });

  it('refuses a negative unit_price', async () => {
    await refuses(insertTx(nextId(), 'buy', `${ASSET}, 5, -1, NULL`));
  });

  it("refuses the app's `dividend_accrual` until the migration maps it", async () => {
    // The CHECK spells the SPEC's nine names. Silent acceptance would split the
    // vocabulary in two, which is the thing a key-adjacent contract cannot undo.
    await refuses(insertTx(nextId(), 'dividend_accrual', `${ASSET}, NULL, NULL, NULL`));
  });

  it('accepts a tax row settling a payout', async () => {
    await accepts(insertTx(nextId(), 'tax', `${ASSET}, NULL, NULL, ${PAYOUT}`));
  });

  it('refuses a SECOND tax on the same payout — the double count', async () => {
    // A plain index let both through; the UNIQUE is what makes the draft's
    // "structurally impossible" claim true.
    await refuses(insertTx(nextId(), 'tax', `${ASSET}, NULL, NULL, ${PAYOUT}`));
  });

  it('lets ANOTHER user settle a payout carrying the same id', async () => {
    // The UNIQUE is `(user_id, settles_payout_id)`. Unscoped, one tenant's tax
    // row would refuse another's — and on DSQL it would be a single global
    // index every tax insert contends on.
    const other = nextId();
    await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at)
                     VALUES (${other}, 'second@x.com', 'pending', 'user', now());`);
    await accepts(`INSERT INTO transaction (user_id, id, account_id, date, type,
                                            amount, asset_id, quantity, unit_price,
                                            settles_payout_id, created_at)
                     VALUES (${other}, ${nextId()}, ${ACCOUNT}, '2026-08-26', 'tax',
                             10, NULL, NULL, NULL, ${PAYOUT}, now());`);
  });

  it('refuses a non-tax row settling a payout', async () => {
    await refuses(insertTx(nextId(), 'sell', `${ASSET}, 1, NULL, ${PAYOUT}`));
  });
  it('requires a count on a position-moving row, and only there (D125)', async () => {
    // THE CONVERSE of `transaction_quantity_absent_ck`, REVERSING the rule this
    // file pinned until now ("ACCEPTS a buy with no quantity — the legacy rows
    // have none"). That reasoning was about rows already STORED, and W7 stores
    // none of them: it seeds fresh demo data rather than carrying the local
    // store across (owner, 2026-09-01). No live user, no history, no backfill —
    // the constraint is simply true of everything that will be written.
    //
    // The store must not be weaker than the app, which is the argument the
    // `unit_price` check already makes: the count is now required at the form
    // (D124) and at the backup importer, so a schema that still accepted a
    // count-less `buy` would let a migration land rows the application refuses
    // to write.
    for (const type of ['buy', 'sell', 'reinvest', 'redemption']) {
      await refuses(insertTx(nextId(), type, `${ASSET}, NULL, NULL, NULL`));
      await accepts(insertTx(nextId(), type, `${ASSET}, 5, NULL, NULL`));
    }
    // A row that moves nothing still states nothing, which is the other check.
    await accepts(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL'));
  });
});

describe('user_price', () => {
  const price = (asOf: string, value: string) =>
    `INSERT INTO user_price (user_id, asset_id, as_of, price, observed_at)
       VALUES (${USER}, ${ASSET}, '${asOf}', ${value}, now());`;

  it('accepts one price per user, asset and date', async () => {
    await accepts(price('2026-07-25', '10.5'));
  });

  it('refuses a second price for the same day', async () => {
    await refuses(price('2026-07-25', '11.0'));
  });

  it('refuses a non-positive price', async () => {
    await refuses(price('2026-07-26', '0'));
  });

  it('accepts a NULL observed_at — 173 of the 174 snapshots have no save time', async () => {
    await accepts(`INSERT INTO user_price (user_id, asset_id, as_of, price, observed_at)
                     VALUES (${USER}, ${ASSET}, '2026-07-27', 9.9, NULL);`);
  });
});

describe('the OCC contract (contract 2)', () => {
  it('detects a conflict by ROWCOUNT, not by an error', async () => {
    // This is the subtlest thing in the schema and the one W7 has to implement
    // exactly: the rowcount is the conflict detector, and the SQLSTATE 40001
    // retry is a different mechanism for a different failure.
    const bump = (expected: number) =>
      db.query(`UPDATE app_user SET data_version = data_version + 1
                  WHERE user_id = ${USER} AND data_version = ${expected}`);

    expect((await bump(0)).affectedRows).toBe(1); // the expected version
    expect((await bump(0)).affectedRows).toBe(0); // stale — this is the 412
    expect((await bump(1)).affectedRows).toBe(1); // and on again from there
  });
});
