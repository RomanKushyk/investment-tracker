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
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from './__fixtures__/pglite';
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
// statement the cluster already has. The DML files are excluded; `DDL` is derived from
// `MIGRATIONS`, so a new schema file cannot be forgotten here.
const DML = [
  '005_demo_user.sql',
  '008_demo_account.sql',
  '011_dataset_backfill.sql',
  '013_dataset_catch_up.sql',
];
const DDL = MIGRATIONS.filter((f) => !DML.includes(f));
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
const DATASET = uuid('8');

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
  `INSERT INTO asset (dataset_id, id, name, code, color_slot, yield_type, expected_pct,
                      target_pct, payout_schedule, first_purchase, created_at${cols})
   VALUES (${DATASET}, ${id}, 'REIT', 'RE', 0, 'dividends', 10, 25, 'monthly',
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
  `INSERT INTO transaction (dataset_id, id, user_id, account_id, date, type, amount,
                            asset_id, quantity, unit_price, tax_withheld, note,
                            created_at)
   VALUES (${DATASET}, ${id}, ${USER}, ${ACCOUNT}, '2026-08-26', '${type}', ${amount}, ${tail},
           ${note}, now());`;

beforeAll(async () => {
  db = await freshDb();
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
  await db.exec(
    `INSERT INTO dataset (user_id, id, created_at) VALUES (${USER}, ${DATASET}, now());`,
  );
  await db.exec(insertAsset(ASSET));
  await db.exec(insertTx(PAYOUT, 'dividend_payout', `${ASSET}, NULL, NULL, NULL`));
});

describe('the draft applies as Postgres', () => {
  it('applies every statement', () => {
    expect(applied).toBeGreaterThan(0);
  });

  it('creates exactly the ten tables the spec, the official rate, the dataset, the mutation keys and the import staging name', async () => {
    const { rows } = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'account',
      'app_user',
      'asset',
      'dataset',
      'import_manifest',
      'import_part',
      'mutation_key',
      'official_rate',
      'transaction',
      'user_price',
    ]);
  });

  it('leaves the asset no reinvest policy, the whole point of `007`', async () => {
    // Applied through `DDL`, so this measures what the cluster ends up with rather than
    // what `003` created: the column exists there and a later file drops it.
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset'`,
    );
    expect(rows.map((r) => r.column_name)).not.toContain('reinvest_policy');
  });

  it('leads a user’s keys with `user_id` and a dataset’s rows with `dataset_id` (contract 3)', async () => {
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
    // `official_rate` is the one table no user owns: NBU's rate is every viewer's, keyed by its day.
    expect(leading).toEqual({
      account: 'user_id',
      app_user: 'user_id',
      asset: 'dataset_id',
      dataset: 'user_id',
      import_manifest: 'dataset_id',
      import_part: 'dataset_id',
      mutation_key: 'user_id',
      official_rate: 'rate_date',
      transaction: 'dataset_id',
      user_price: 'dataset_id',
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

  /**
   * THE SPEC'S ONE EXPLICIT DDL RULE, read off the generated SQL rather than off `schema/user.ts`:
   * no CHECK may enumerate a value naming a specific holding, and `inzhur` is one. A closed
   * vocabulary here would turn "the owner opened an account elsewhere" into a migration — and a
   * CHECK added after the table exists is `NOT VALID` for life on DSQL, which refuses
   * `VALIDATE CONSTRAINT`, so the widened rule would never hold the rows already there.
   * The uniqueness of `(user_id, provider)` is the only rule the column carries.
   */
  it('constrains `provider` by no CHECK at all', () => {
    const table = statements(readFileSync(fileUrl('003_user_schema.sql'), 'utf8')).find((s) =>
      s.startsWith('CREATE TABLE "account"'),
    );
    expect(table).toBeDefined();
    expect(table).toContain('"provider" text NOT NULL');
    expect(table).not.toContain('CHECK');
  });
});

// A generation of one user's data (#390): `app_user.dataset_id` names the live one and
// `import_dataset_id` the one an import is staging, so an import replaces the data by moving one
// pointer (*User schema and deletes*).
describe('dataset', () => {
  const OTHER = uuid('6');
  const MINE = uuid('5');
  const THEIRS = uuid('7');
  const dataset = (user: string, id: string) =>
    `INSERT INTO dataset (user_id, id, created_at) VALUES (${user}, ${id}, now());`;
  const point = (column: string, id: string, user = USER) =>
    `UPDATE app_user SET ${column} = ${id} WHERE user_id = ${user};`;

  beforeAll(async () => {
    await db.exec(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                     VALUES (${OTHER}, 'other@quirenote.com', 'active', 'user',
                             now(), now(), ${USER});`);
    await db.exec(dataset(USER, MINE));
    await db.exec(dataset(OTHER, THEIRS));
  });

  it('refuses a dataset for a user that does not exist', async () => {
    await refuses(dataset(nextId(), nextId()));
  });

  it('refuses one id for two datasets, since a data table names its dataset by the id alone', async () => {
    await refuses(dataset(OTHER, MINE));
  });

  it.each(['dataset_id', 'import_dataset_id'])(
    'lets `%s` name its own user’s dataset',
    async (c) => {
      await accepts(point(c, MINE));
      await accepts(point(c, 'NULL'));
    },
  );

  it.each(['dataset_id', 'import_dataset_id'])(
    'refuses `%s` naming another user’s dataset',
    async (c) => {
      await refuses(point(c, THEIRS));
    },
  );

  it.each(['dataset_id', 'import_dataset_id'])(
    'refuses `%s` naming no dataset at all',
    async (c) => {
      await refuses(point(c, nextId()));
    },
  );

  // On `OTHER`, who owns nothing else: a cascading key would delete the user rather than refuse,
  // and the baseline user's own account and asset would refuse that cascade for it.
  it.each(['dataset_id', 'import_dataset_id'])(
    'refuses deleting the dataset `%s` names',
    async (c) => {
      await accepts(point(c, THEIRS, OTHER));
      await refuses(`DELETE FROM dataset WHERE id = ${THEIRS};`);
      await accepts(point(c, 'NULL', OTHER));
    },
  );

  it('refuses deleting a user who owns a dataset', async () => {
    await refuses(`DELETE FROM app_user WHERE user_id = ${OTHER};`);
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
    await refuses(`INSERT INTO asset (dataset_id, id, name, code, color_slot, yield_type,
                                      target_pct, payout_schedule, first_purchase, created_at)
                     VALUES (${DATASET}, ${nextId()}, 'x', 'XX', 1, 'dividends', 25,
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
    `INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
       VALUES (${DATASET}, ${ASSET}, '${asOf}', ${value}, now());`;

  it('accepts one price per dataset, asset and date', async () => {
    await accepts(price('2026-07-25', '10.5'));
  });

  it('refuses a second price for the same day', async () => {
    await refuses(price('2026-07-25', '11.0'));
  });

  it('refuses a non-positive price', async () => {
    await refuses(price('2026-07-26', '0'));
  });

  it('accepts a NULL observed_at — 173 of the 174 snapshots have no save time', async () => {
    await accepts(`INSERT INTO user_price (dataset_id, asset_id, as_of, price, observed_at)
                     VALUES (${DATASET}, ${ASSET}, '2026-07-27', 9.9, NULL);`);
  });
});

// `012` is hand-written, so nothing regenerates it the way `003` is checked: the text itself is
// held to `003`'s rules. A cascading key would hide the batching a delete owes the row ceiling.
describe('`012` keeps `003`’s rules', () => {
  const text = (f: string) => readFileSync(fileUrl(f), 'utf8');
  const checks = (sql: string) =>
    [
      ...sql.matchAll(
        /CONSTRAINT "((?:asset|transaction|user_price)_\w+_ck)" CHECK ([\s\S]*?)(?=,\n\t|\n\))/g,
      ),
    ]
      .map((m) => `${m[1]} ${m[2]}`)
      .sort();

  it('declares every foreign key ON DELETE restrict', () => {
    const keys = text('012_dataset_keys.sql')
      .split('\n')
      .filter((l) => l.includes('FOREIGN KEY'));
    expect(keys).toHaveLength(5);
    for (const key of keys) expect(key).toContain('ON DELETE restrict');
  });

  it('carries over every CHECK of the three tables, unchanged', () => {
    // 9 on asset, 13 on transaction, 1 on user_price: an empty match on both sides is no proof.
    expect(checks(text('003_user_schema.sql'))).toHaveLength(23);
    expect(checks(text('012_dataset_keys.sql'))).toEqual(checks(text('003_user_schema.sql')));
  });
});

// A generation's rows reach no other generation, while an import restores the same ids into a
// generation of its own: the composite keys carry the dataset (#390).
describe('generations', () => {
  const STAGED = uuid('9');
  const SAME_ID_ASSET = (dataset: string) =>
    insertAsset(ASSET).replace(`VALUES (${DATASET},`, `VALUES (${dataset},`);

  beforeAll(async () => {
    await db.exec(
      `INSERT INTO dataset (user_id, id, created_at) VALUES (${USER}, ${STAGED}, now());`,
    );
  });

  it('accepts the same asset id in a second generation', async () => {
    await accepts(SAME_ID_ASSET(STAGED));
  });

  it('refuses an asset in a dataset that does not exist', async () => {
    await refuses(SAME_ID_ASSET(nextId()));
  });

  it('refuses a transaction naming an asset of another generation', async () => {
    const other = nextId();
    await accepts(insertAsset(other).replace(`VALUES (${DATASET},`, `VALUES (${STAGED},`));
    await refuses(insertTx(nextId(), 'dividend_payout', `${other}, NULL, NULL, NULL`));
  });

  it('refuses a price naming an asset of another generation', async () => {
    const other = nextId();
    await accepts(insertAsset(other).replace(`VALUES (${DATASET},`, `VALUES (${STAGED},`));
    await refuses(`INSERT INTO user_price (dataset_id, asset_id, as_of, price)
                     VALUES (${DATASET}, ${other}, '2026-07-28', 9.9);`);
  });

  it('refuses a transaction whose user does not own its dataset', async () => {
    // Their own account, so the dataset's owner is the one key left to refuse it.
    const stranger = nextId();
    const theirAccount = nextId();
    await accepts(`INSERT INTO app_user (user_id, email, status, role, applied_at,
                                         decided_at, decided_by)
                     VALUES (${stranger}, 'stranger@quirenote.com', 'active', 'user',
                             now(), now(), ${USER});`);
    await accepts(`INSERT INTO account (user_id, id, provider, name, created_at)
                     VALUES (${stranger}, ${theirAccount}, 'inzhur', 'Inzhur', now());`);
    await refuses(
      insertTx(nextId(), 'deposit').replace(`${USER}, ${ACCOUNT}`, `${stranger}, ${theirAccount}`),
    );
  });

  // A dataset holding an asset and nothing else, so `asset_dataset_fk` is the one key to refuse.
  it('refuses deleting a dataset that still holds an asset', async () => {
    const only = nextId();
    await accepts(
      `INSERT INTO dataset (user_id, id, created_at) VALUES (${USER}, ${only}, now());`,
    );
    await accepts(insertAsset(nextId()).replace(`VALUES (${DATASET},`, `VALUES (${only},`));
    await refuses(`DELETE FROM dataset WHERE id = ${only};`);
  });
});

describe('mutation_key', () => {
  const FINGERPRINT = `'${'a'.repeat(64)}'`;
  /** A live claim with no response; `over` replaces a column's SQL value. */
  const claim = (over: Record<string, string> = {}) => {
    const row: Record<string, string> = {
      user_id: USER,
      key: nextId(),
      fingerprint: FINGERPRINT,
      token: nextId(),
      claimed_at: 'now()',
      in_progress_until: `now() + interval '20 seconds'`,
      expires_at: `now() + interval '24 hours'`,
      response_status: 'NULL',
      response_body: 'NULL',
      ...over,
    };
    return `INSERT INTO mutation_key (${Object.keys(row).join(', ')})
            VALUES (${Object.values(row).join(', ')});`;
  };
  const holder = (status: string) =>
    `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
     VALUES (${nextId()}, '${status}-${seq}@quirenote.com', '${status}', 'user', now(), now(), ${USER})
     RETURNING user_id;`;

  it('accepts a claim with no response yet, and one with its stored response', async () => {
    await accepts(claim());
    await accepts(claim({ response_status: '200', response_body: `'{"etag":"\\"1\\""}'` }));
  });

  it.each([
    'user_id',
    'key',
    'fingerprint',
    'token',
    'claimed_at',
    'in_progress_until',
    'expires_at',
  ])('refuses a NULL %s, which DSQL could never require later', async (column) => {
    await refuses(claim({ [column]: 'NULL' }));
  });

  it.each([
    ['63 characters', `'${'a'.repeat(63)}'`],
    ['65 characters', `'${'a'.repeat(65)}'`],
    ['upper-case hex', `'${'A'.repeat(64)}'`],
    ['64 characters that are not hex', `'${'z'.repeat(64)}'`],
  ])('refuses a fingerprint of %s, never a sha256 in lower-case hex', async (_, fingerprint) => {
    await refuses(claim({ fingerprint }));
  });

  it.each([
    ['a status without a body', { response_status: '200' }],
    ['a body without a status', { response_body: `'{}'` }],
    ['a stored refusal', { response_status: '409', response_body: `'{}'` }],
    ['a stored failure', { response_status: '500', response_body: `'{}'` }],
  ])('refuses %s', async (_, over) => {
    await refuses(claim(over));
  });

  it.each([
    ['a claim that is live for no time at all', { in_progress_until: 'now()' }],
    ['a key that expires while its claim is live', { expires_at: `now() + interval '10 seconds'` }],
  ])('refuses %s', async (_, over) => {
    await refuses(claim(over));
  });

  it('refuses a key for a user that does not exist', async () => {
    await refuses(claim({ user_id: nextId() }));
  });

  it('refuses one key twice for one user, and takes it for another', async () => {
    const key = nextId();
    const { rows } = await db.query<{ user_id: string }>(holder('active'));
    await accepts(claim({ key }));
    await refuses(claim({ key }));
    await accepts(claim({ key, user_id: `'${rows[0].user_id}'` }));
  });

  // On a user who owns nothing else, so `mutation_key_user_fk` is the one key to refuse.
  it('refuses deleting a user who holds a key', async () => {
    const { rows } = await db.query<{ user_id: string }>(holder('active'));
    const id = `'${rows[0].user_id}'`;
    await accepts(claim({ user_id: id }));
    await refuses(`DELETE FROM app_user WHERE user_id = ${id};`);
  });

  // The sweep reads one user's keys, a range of the primary key, so no index is written per claim.
  it('carries no index but its primary key', async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'mutation_key' ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(['mutation_key_user_id_key_pk']);
  });
});

describe('import staging', () => {
  /** SHA-256 of `import` in base64, as `Content-Digest` carries it: a `+` and a `/` among them. */
  const DIGEST = `'2UL2SIZXjYdHMS42jtktn2sqjUVVbw+STiRE/pEdFa8='`;
  const generation = async () => {
    const id = nextId();
    await db.exec(`INSERT INTO dataset (user_id, id, created_at) VALUES (${USER}, ${id}, now());`);
    return id;
  };
  /** A generation whose import has begun: its manifest is written. */
  const begun = async () => {
    const id = await generation();
    await db.exec(manifest(id));
    return id;
  };
  /** One row of `table`; `over` replaces a column's SQL value. */
  const row = (table: string, base: Record<string, string>, over: Record<string, string>) => {
    const cols = { ...base, ...over };
    return `INSERT INTO ${table} (${Object.keys(cols).join(', ')})
            VALUES (${Object.values(cols).join(', ')});`;
  };
  const manifest = (dataset: string, over: Record<string, string> = {}) =>
    row(
      'import_manifest',
      {
        dataset_id: dataset,
        digest: DIGEST,
        assets: '2',
        transactions: '30',
        prices: '600',
        staged_at: 'now()',
      },
      over,
    );
  const part = (dataset: string, over: Record<string, string> = {}) =>
    row('import_part', { dataset_id: dataset, part: '1', digest: DIGEST }, over);

  const DIGESTS: [string, string][] = [
    ['a SHA-256 in hex', `'${'a'.repeat(64)}'`],
    ['44 characters without the padding', `'${'A'.repeat(44)}'`],
    ['42 characters and the padding', `'${'A'.repeat(42)}='`],
    ['a URL-safe character', `'${'A'.repeat(42)}-='`],
    // 32 bytes leave the last character two spare bits, zero in the one encoding of those bytes.
    ['a last character with its spare bits set', `'${'A'.repeat(42)}B='`],
  ];

  describe('import_manifest', () => {
    it('accepts a manifest, an empty import’s included', async () => {
      await accepts(manifest(await generation()));
      await accepts(manifest(await generation(), { assets: '0', transactions: '0', prices: '0' }));
    });

    it.each(['dataset_id', 'digest', 'assets', 'transactions', 'prices', 'staged_at'])(
      'refuses a NULL %s, which DSQL could never require later',
      async (column) => {
        await refuses(manifest(await generation(), { [column]: 'NULL' }));
      },
    );

    it.each(DIGESTS)('refuses a digest of %s', async (_, digest) => {
      await refuses(manifest(await generation(), { digest }));
    });

    it.each(['assets', 'transactions', 'prices'])('refuses a negative count of %s', async (c) => {
      await refuses(manifest(await generation(), { [c]: '-1' }));
    });

    it('refuses a manifest for a dataset that does not exist', async () => {
      await refuses(manifest(nextId()));
    });

    it('refuses a second manifest for one dataset', async () => {
      const id = await generation();
      await accepts(manifest(id));
      await refuses(manifest(id));
    });

    it('refuses deleting a dataset that holds a manifest', async () => {
      const id = await generation();
      await accepts(manifest(id));
      await refuses(`DELETE FROM dataset WHERE id = ${id};`);
    });
  });

  describe('import_part', () => {
    it.each(['1', '10000'])('accepts part %s', async (n) => {
      await accepts(part(await begun(), { part: n }));
    });

    it.each(['0', '-1', '10001'])('refuses part %s, outside S3’s range', async (n) => {
      await refuses(part(await begun(), { part: n }));
    });

    it.each(['dataset_id', 'part', 'digest'])(
      'refuses a NULL %s, which DSQL could never require later',
      async (column) => {
        await refuses(part(await begun(), { [column]: 'NULL' }));
      },
    );

    it.each(DIGESTS)('refuses a digest of %s', async (_, digest) => {
      await refuses(part(await begun(), { digest }));
    });

    it('refuses a part for a dataset that does not exist', async () => {
      await refuses(part(nextId()));
    });

    it('refuses a part for a generation whose import never began', async () => {
      await refuses(part(await generation()));
    });

    it('refuses one number twice in a generation, and takes it in another', async () => {
      const id = await begun();
      await accepts(part(id));
      await refuses(part(id));
      await accepts(part(await begun()));
    });

    it('refuses deleting the manifest a part names', async () => {
      const id = await begun();
      await accepts(part(id));
      await refuses(`DELETE FROM import_manifest WHERE dataset_id = ${id};`);
    });
  });

  // A part and a manifest are read by their generation, a range of the primary key.
  it('carries no index but each table’s primary key', async () => {
    const { rows } = await db.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename IN ('import_manifest', 'import_part') ORDER BY indexname`,
    );
    expect(rows.map((r) => r.indexname)).toEqual([
      'import_manifest_dataset_id_pk',
      'import_part_dataset_id_part_pk',
    ]);
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
