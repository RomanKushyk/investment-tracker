// W7's user schema, executed. `003` is a pinned, content-hashed contract with create-time-only
// keys, so a mistake in it is a DROP/CREATE of live user data rather than a migration, and a
// tightening is a new migration file. [*User schema and deletes*]
//
// WHAT THIS CANNOT PROVE: nothing about Aurora DSQL acceptance. Local Postgres is the SUBSET, and
// it is why both halves of the index line stay Postgres-shaped — `CREATE INDEX ASYNC` is DSQL-only
// and would fail here, `USING btree` is what drizzle-kit emits and DSQL rejects outright — so
// `rewriteForDsql` rewrites every index line TWICE on the way out. Doing only the first still
// gives a statement the cluster refuses, and a DSQL-only rejection stays invisible here.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEMO_USER_EMAIL } from './demo-user';
// The runner's own splitter, so this suite certifies the statements actually sent.
// `--> statement-breakpoint` is a SQL comment AND the statement separator, which is what makes a
// `;` split quietly wrong rather than loudly: the marker is not line-anchored — drizzle appends it
// to a terminating `;` — so a full-line comment strip cannot reach it, and the `;` split
// reproduces the statement count while leaving the marker at the head of the statements that
// follow.
import { MIGRATIONS, statementsOf as statements } from './migrate';

// The case rule is a LATER file rather than a column of `003`, because `CREATE TABLE "app_user"`
// is applied on both clusters and the ledger keys by content hash — editing it would re-send a
// statement the cluster already has. `005` is excluded as DML; `DDL` is derived from `MIGRATIONS`,
// so a new schema file cannot be forgotten here.
const DML = '005_demo_user.sql';
const DDL = MIGRATIONS.filter((f) => f !== DML);
const fileUrl = (f: string) => new URL(`../migrations/${f}`, import.meta.url);

const uuid = (c: string) =>
  `'${c.repeat(8)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(4)}-${c.repeat(12)}'`;

/**
 * A FRESH id per insert. One throwaway id was safe only while every test using it expected a
 * rejection; the moment a case flipped to accepting, the row persisted and the next test collided
 * on the primary key. Sequential rather than random so a failure is reproducible.
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

/** Trailing four: asset_id, quantity, unit_price, tax_withheld. `note` is its
 *  own parameter because it is the only one that arrives already quoted. */
const insertTx = (
  id: string,
  type: string,
  tail = 'NULL, NULL, NULL, NULL',
  amount = '100',
  note = 'NULL',
) =>
  `INSERT INTO transaction (user_id, id, account_id, date, type, amount,
                            asset_id, quantity, unit_price, tax_withheld, note,
                            created_at)
   VALUES (${USER}, ${id}, ${ACCOUNT}, '2026-08-26', '${type}', ${amount}, ${tail},
           ${note}, now());`;

beforeAll(async () => {
  db = new PGlite();
  const stmts = DDL.flatMap((f) => statements(readFileSync(fileUrl(f), 'utf8')));
  for (const stmt of stmts) {
    // A failure here names the statement rather than the file. No `+ ';'`: splitting on the marker
    // leaves each statement's own terminator where it was.
    await db.exec(stmt).catch((e: Error) => {
      throw new Error(`DDL failed: ${stmt.split('\n')[0]}\n${e.message}`);
    });
  }
  applied = stmts.length;

  // The baseline every constraint below is measured against.
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
    // DSQL's index-organized key is the reason and this engine cannot show it; what IS checkable
    // is that the declared key order says what the contract says.
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

  it('refuses a role outside user | super_admin | demo', async () => {
    await refuses(other(nextId(), 'b@x.com', 'pending', 'admin'));
  });

  it('refuses a second row on the same email', async () => {
    await refuses(other(nextId(), 'owner@quirenote.com'));
  });

  it('refuses an `active` row with no decision recorded', async () => {
    await refuses(other(nextId(), 'c@x.com', 'active'));
  });

  // The demo's exemption is what makes the ruling structural: the seeded row sits under an
  // identity that must never gain a provider account, and the only decision-free spelling
  // `app_user_decided_ck` had was `pending`. It is an `OR`, so it only WIDENS. [*Auth model*]
  it('ACCEPTS an `active` demo row with no decision recorded', async () => {
    await accepts(other(nextId(), DEMO_USER_EMAIL, 'active', 'demo'));
  });

  it('refuses a `pending` row that already carries a decision', async () => {
    await refuses(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                     VALUES (${nextId()}, 'e@x.com', 'pending', 'user', now(),
                             now(), ${USER});`);
  });

  // An UPDATE is where the pair is likeliest to be forgotten — `SET status = 'rejected'` reads
  // complete on its own, which is why the database has to be the thing that refuses it.
  it('refuses an UPDATE that decides a row without recording the decision', async () => {
    const id = nextId();
    await accepts(other(id, 'reject-me@x.com'));
    await refuses(`UPDATE app_user SET status = 'rejected' WHERE user_id = ${id};`);
  });

  it('refuses an UPDATE that puts a decided row back to `pending` and keeps the pair', async () => {
    const id = nextId();
    await accepts(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                     VALUES (${id}, 'decided@x.com', 'active', 'user', now(), now(), ${USER});`);
    await refuses(`UPDATE app_user SET status = 'pending' WHERE user_id = ${id};`);
  });

  // The check is "NOT BOTH NULL", not "both present", and the gap is recorded rather than
  // discovered: a decided row carrying `decided_at` and naming NO approver is legal, so the
  // constraint cannot be what holds the pair together. Tightening it would be a new migration
  // file; what keeps the pair whole is that ONE statement writes both halves.
  it('ACCEPTS a decided row naming no approver — the halves are held by the writer', async () => {
    await accepts(`INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at)
                     VALUES (${nextId()}, 'half@x.com', 'active', 'user', now(), now());`);
  });

  // The two halves name ONE mailbox and differ only in case, which makes the refusal below
  // attributable: `app_user_email_uq` is byte-exact, so `NEW@` cannot answer `23505` and the only
  // thing left to refuse it is the case rule.
  it('accepts a mailbox in its canonical spelling', async () => {
    await accepts(other(nextId(), 'new@quirenote.com'));
  });

  // The only test here that names its constraint: its argument is that the refusal is the CHECK
  // and not `app_user_email_uq`, and `refuses()` cannot tell a `23514` from a `23505`.
  it('refuses that same mailbox spelled with capitals', async () => {
    // Cognito does not close this: its duplicate refusal is exact-match only, and a pool matching
    // case-insensitively still stores the case typed.
    await expect(db.exec(other(nextId(), 'NEW@quirenote.com'))).rejects.toThrow(
      /app_user_email_lower_ck/,
    );
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
    // 0 and negatives are not smaller rates — `couponPerPayment` gates on `rate > 0`, so they read
    // as ABSENT and fall back to the legacy amount. Over 100 scales every coupon produced.
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

  it('refuses a deposit that invents a quantity', async () => {
    await refuses(insertTx(nextId(), 'deposit', 'NULL, 1, NULL, NULL'));
  });

  it('refuses a payout that invents a unit_price, the same as a quantity', async () => {
    // The price is the other half of one fact, so it takes the rule the count takes: a schema
    // governing only the count would let a migration land a row the app refuses to write.
    await refuses(insertTx(nextId(), 'dividend_payout', `${ASSET}, NULL, 11.14, NULL`));
    await refuses(insertTx(nextId(), 'withdrawal', 'NULL, NULL, 11.14, NULL'));
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
    // The sign of an amount comes from the type, so a negative quantity would flip the position
    // movement independently and nothing else records units.
    await refuses(insertTx(nextId(), 'sell', `${ASSET}, -5, NULL, NULL`));
  });

  it('refuses a zero quantity', async () => {
    await refuses(insertTx(nextId(), 'buy', `${ASSET}, 0, NULL, NULL`));
  });

  it('refuses a negative unit_price', async () => {
    await refuses(insertTx(nextId(), 'buy', `${ASSET}, 5, -1, NULL`));
  });

  it("refuses the app's `dividend_accrual` until the migration maps it", async () => {
    // Silent acceptance would split the vocabulary in two, which a key-adjacent contract cannot
    // undo.
    await refuses(insertTx(nextId(), 'dividend_accrual', `${ASSET}, NULL, NULL, NULL`));
  });

  // THE ACCEPTING TWIN COMES FIRST, EVERY TIME, and it is a rule rather than a habit: `refuses()`
  // asserts that a statement throws, and an INSERT naming a column the table does not have throws
  // too, so a `refuses` written before its column exists is GREEN FOR THE WRONG REASON.
  it('accepts a withholding on either payout type', async () => {
    await accepts(insertTx(nextId(), 'dividend_payout', `${ASSET}, NULL, NULL, 65.44`));
    await accepts(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, 18`));
  });

  it('refuses a withholding on any of the six types that take none', async () => {
    for (const type of ['buy', 'sell', 'reinvest', 'redemption']) {
      await refuses(insertTx(nextId(), type, `${ASSET}, 5, NULL, 10`));
    }
    for (const type of ['deposit', 'withdrawal']) {
      await refuses(insertTx(nextId(), type, 'NULL, NULL, NULL, 10'));
    }
  });

  it('refuses a withholding that is not STRICTLY below its own amount', async () => {
    // The bound catches a decimal slipped the wrong way UP and deliberately not one slipped DOWN,
    // which stays plausible. Equal is refused too: a withholding that is the whole payout leaves
    // nothing received.
    await refuses(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, 100`));
    await refuses(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, 654.40`, '467.46'));
    await accepts(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, 65.44`, '467.46'));
  });

  it('refuses a withholding of zero — NULL is the only spelling of none', async () => {
    await refuses(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, 0`));
    await refuses(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, -1`));
    await accepts(insertTx(nextId(), 'interest_payout', `${ASSET}, NULL, NULL, NULL`));
  });

  it('accepts a note on any type, at one character and at a hundred', async () => {
    const hundred = `'${'я'.repeat(100)}'`;
    await accepts(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', `'x'`));
    await accepts(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', hundred));
  });

  it('refuses a note over the cap and an EMPTY one', async () => {
    // `length()` counts CHARACTERS in Postgres, not bytes, so the bound does not move with the
    // language.
    const overCap = `'${'я'.repeat(101)}'`;
    await refuses(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', overCap));
    await refuses(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', `''`));
  });

  it('refuses a note of WHITESPACE, in every spelling of it', async () => {
    // The one place the three doors did not agree: a bare `length > 0` accepts a note of spaces,
    // which renders as an empty second line on the ledger.
    for (const blank of [`'   '`, `'\t'`, `'\n'`]) {
      await refuses(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', blank));
    }
    // Padding AROUND text is still a note — only the emptiness is refused.
    await accepts(insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', `'  ok  '`));
  });

  it('counts the CAP in characters, so a Cyrillic note is not half a note', async () => {
    await accepts(
      insertTx(nextId(), 'deposit', 'NULL, NULL, NULL, NULL', '100', `'${'я'.repeat(100)}'`),
    );
  });

  it('requires an asset on a PAYOUT too, which is what keeps a withholding attributable', async () => {
    // A payout naming no asset would put its withholding under the empty key: no per-asset
    // consumer reads it while the totals still count it, so nothing looks missing.
    for (const type of ['dividend_payout', 'interest_payout']) {
      await refuses(insertTx(nextId(), type, 'NULL, NULL, NULL, NULL'));
      await accepts(insertTx(nextId(), type, `${ASSET}, NULL, NULL, NULL`));
    }
    // The partition is complete: no type is left to judgement.
    await accepts(insertTx(nextId(), 'withdrawal', 'NULL, NULL, NULL, NULL'));
    await refuses(insertTx(nextId(), 'withdrawal', `${ASSET}, NULL, NULL, NULL`));
  });

  it('requires a count on a position-moving row, and only there', async () => {
    // The store must not be weaker than the app: the count is required at the form and at the
    // backup importer, so a schema accepting a count-less `buy` would let a migration land rows
    // the application refuses to write. W7 seeds fresh demo data, so there are no legacy rows
    // without one.
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
    // The rowcount is the conflict detector, and the SQLSTATE 40001 retry is a different mechanism
    // for a different failure.
    const bump = (expected: number) =>
      db.query(`UPDATE app_user SET data_version = data_version + 1
                  WHERE user_id = ${USER} AND data_version = ${expected}`);

    expect((await bump(0)).affectedRows).toBe(1); // the expected version
    expect((await bump(0)).affectedRows).toBe(0); // stale — this is the 412
    expect((await bump(1)).affectedRows).toBe(1); // and on again from there
  });
});
