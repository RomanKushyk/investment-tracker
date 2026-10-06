// A core ledger written into the user schema on PGlite, the way a test needs it read back: the
// reverse of `ledger.ts`'s mapping, spelt out here so a test compares two readings, not one.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type { PGlite } from '@electric-sql/pglite';
import { COLOR_KEYS } from '@quirenote/core/colors';
import type { Asset, Transaction, TxType } from '@quirenote/core/types';
import type { PriceRow } from '@quirenote/core/valuation';

import { MIGRATIONS, statementsOf } from '../migrate';

export interface LedgerRows {
  assets: Asset[];
  transactions: Transaction[];
  userPrices: PriceRow[];
}

const DML = ['005_demo_user.sql', '008_demo_account.sql'];

/** The user cluster's DDL, every schema file in `MIGRATIONS`. */
export async function applyUserSchema(db: PGlite): Promise<void> {
  const files = MIGRATIONS.filter((f) => !DML.includes(f));
  for (const f of files) {
    const text = readFileSync(new URL(`../../migrations/${f}`, import.meta.url), 'utf8');
    for (const stmt of statementsOf(text)) await db.exec(stmt);
  }
}

/** A row the gate reads; a decided one carries the decision pair `app_user_decided_ck` asks for. */
export async function insertUser(
  db: PGlite,
  userId: string,
  email: string,
  status = 'active',
  role = 'user',
): Promise<void> {
  const decided = status !== 'pending';
  await db.query(
    `INSERT INTO app_user (user_id, email, status, role, applied_at, decided_at, decided_by)
     VALUES ($1, $2, $3, $4, now(), ${decided ? 'now()' : 'NULL'}, ${decided ? '$1' : 'NULL'})`,
    [userId, email, status, role],
  );
}

const SCHEMA_TYPE = {
  buy: 'buy',
  sell: 'sell',
  deposit: 'deposit',
  withdrawal: 'withdrawal',
  dividend_accrual: 'dividend_payout',
  interest_payout: 'interest_payout',
  reinvest: 'reinvest',
  redemption: 'redemption',
} satisfies Record<TxType, string>;

const text = (n: number | undefined) => (n === undefined ? null : String(n));

/** Every row of `ledger` under `userId`, with the account a transaction needs. */
export async function writeLedger(db: PGlite, userId: string, ledger: LedgerRows): Promise<void> {
  const account = randomUUID();
  await db.query(
    `INSERT INTO account (user_id, id, provider, name, created_at)
     VALUES ($1, $2, 'inzhur', 'Inzhur', now())`,
    [userId, account],
  );
  for (const a of ledger.assets) {
    await db.query(
      `INSERT INTO asset (user_id, id, name, code, color_slot, yield_type, expected_pct, target_pct,
                          payout_schedule, first_purchase, maturity, coupon_amount,
                          coupon_rate_pct, next_coupon, provider_kind, provider_ref, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        userId,
        a.id,
        a.name,
        a.code,
        COLOR_KEYS.indexOf(a.colorKey),
        a.yieldType,
        String(a.expectedPct),
        String(a.targetPct),
        a.payoutSchedule,
        a.firstPurchase,
        a.maturity ?? null,
        text(a.couponAmount),
        text(a.couponRatePct),
        a.nextCoupon ?? null,
        a.inzhur?.kind ?? null,
        a.inzhur?.ref ?? null,
        // The backup's format carries no zone; the cluster's clock is UTC.
        /[zZ]|[+-]\d\d:\d\d$/.test(a.createdAt) ? a.createdAt : `${a.createdAt}Z`,
      ],
    );
  }
  for (const t of ledger.transactions) {
    await db.query(
      `INSERT INTO transaction (user_id, id, account_id, date, type, amount, asset_id, quantity,
                                unit_price, tax_withheld, note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
      [
        userId,
        t.id,
        account,
        t.date,
        SCHEMA_TYPE[t.type],
        String(t.amount),
        t.assetId === '' ? null : t.assetId,
        text(t.quantity),
        text(t.unitPrice),
        text(t.taxWithheld),
        t.note ?? null,
      ],
    );
  }
  for (const p of ledger.userPrices) {
    await db.query(
      `INSERT INTO user_price (user_id, asset_id, as_of, price, observed_at)
       VALUES ($1, $2, $3, $4, now())`,
      [userId, p.assetId, p.asOf, String(p.price)],
    );
  }
}

/**
 * The same ledger keyed by uuids, the cluster's id type. Numbered in the order the rows are given,
 * so ordering by (date, id) is the given order's stable sort by date.
 */
export function withUuids(ledger: LedgerRows): LedgerRows {
  const ids = new Map<string, string>();
  const uuid = (key: string) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = `00000000-0000-4000-8000-${(ids.size + 1).toString(16).padStart(12, '0')}`;
      ids.set(key, id);
    }
    return id;
  };
  const asset = (id: string) => (id === '' ? '' : uuid(`asset:${id}`));
  const assets = ledger.assets.map((a) => ({ ...a, id: asset(a.id) }));
  return {
    assets,
    transactions: ledger.transactions.map((t) => ({
      ...t,
      id: uuid(`tx:${t.id}`),
      assetId: asset(t.assetId),
    })),
    userPrices: ledger.userPrices.map((p) => ({ ...p, assetId: asset(p.assetId) })),
  };
}
