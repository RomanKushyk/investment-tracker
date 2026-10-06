// The caller's rows as core reads them, from this stack's cluster: the schema's vocabulary turned
// into core's, the inverse of the seam `model-parity.test.ts` holds.
import { COLOR_KEYS } from '@quirenote/core/colors';
import type { Asset, PayoutSchedule, Transaction, TxType, YieldType } from '@quirenote/core/types';
import type { PriceRow } from '@quirenote/core/valuation';

import type { SqlClient } from './migrate';

export interface Ledger {
  /** `app_user.data_version` as text: a `bigint` past 2^53 does not survive a number. */
  dataVersion: string;
  assets: Asset[];
  transactions: Transaction[];
  userPrices: PriceRow[];
}

type AssetRow = {
  id: string;
  name: string;
  code: string;
  color_slot: number;
  yield_type: string;
  expected_pct: string;
  target_pct: string;
  payout_schedule: string;
  first_purchase: string;
  maturity: string | null;
  coupon_amount: string | null;
  coupon_rate_pct: string | null;
  next_coupon: string | null;
  provider_kind: string | null;
  provider_ref: string | null;
  created_at: string;
};

type TransactionRow = {
  id: string;
  date: string;
  type: string;
  amount: string;
  asset_id: string | null;
  quantity: string | null;
  unit_price: string | null;
  tax_withheld: string | null;
  note: string | null;
};

type PriceRowText = { asset_id: string; as_of: string; price: string };

// Dates and numbers as text: `pg` turns a bare `date` into a local midnight and a `numeric` into a
// string, PGlite a `numeric` into a number. `created_at` in the backup's form, UTC with no zone.
const VERSION = `SELECT u.data_version::text AS data_version FROM app_user u WHERE u.user_id = $1`;
const ASSETS = `SELECT a.id, a.name, a.code, a.color_slot, a.yield_type,
                       a.expected_pct::text AS expected_pct, a.target_pct::text AS target_pct,
                       a.payout_schedule, to_char(a.first_purchase, 'YYYY-MM-DD') AS first_purchase,
                       to_char(a.maturity, 'YYYY-MM-DD') AS maturity,
                       a.coupon_amount::text AS coupon_amount,
                       a.coupon_rate_pct::text AS coupon_rate_pct,
                       to_char(a.next_coupon, 'YYYY-MM-DD') AS next_coupon,
                       a.provider_kind, a.provider_ref,
                       to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS')
                         AS created_at
                  FROM asset a WHERE a.user_id = $1`;
const TRANSACTIONS = `SELECT t.id, to_char(t.date, 'YYYY-MM-DD') AS date, t.type,
                             t.amount::text AS amount, t.asset_id,
                             t.quantity::text AS quantity, t.unit_price::text AS unit_price,
                             t.tax_withheld::text AS tax_withheld, t.note
                        FROM "transaction" t WHERE t.user_id = $1`;
const PRICES = `SELECT p.asset_id, to_char(p.as_of, 'YYYY-MM-DD') AS as_of, p.price::text AS price
                  FROM user_price p WHERE p.user_id = $1`;

/** The schema keeps the spec's name for the one type core renamed. */
const CORE_TYPE: Record<string, TxType> = {
  buy: 'buy',
  sell: 'sell',
  deposit: 'deposit',
  withdrawal: 'withdrawal',
  dividend_payout: 'dividend_accrual',
  interest_payout: 'interest_payout',
  reinvest: 'reinvest',
  redemption: 'redemption',
};

/** ABSENT IS THE ONLY SPELLING OF NONE in core, so a NULL column leaves its key out. */
const present = <K extends string, V>(key: K, value: V | null): { [P in K]?: V } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: V };
const num = (text: string | null) => (text === null ? null : Number(text));

const asset = (r: AssetRow): Asset => ({
  id: r.id,
  name: r.name,
  code: r.code,
  colorKey: COLOR_KEYS[r.color_slot],
  yieldType: r.yield_type as YieldType,
  expectedPct: Number(r.expected_pct),
  targetPct: Number(r.target_pct),
  payoutSchedule: r.payout_schedule as PayoutSchedule,
  firstPurchase: r.first_purchase,
  createdAt: r.created_at,
  ...present('maturity', r.maturity),
  ...present('couponRatePct', num(r.coupon_rate_pct)),
  ...present('couponAmount', num(r.coupon_amount)),
  ...present('nextCoupon', r.next_coupon),
  ...(r.provider_kind === null || r.provider_ref === null
    ? {}
    : { inzhur: { kind: r.provider_kind as 'fund' | 'bond', ref: r.provider_ref } }),
});

const transaction = (r: TransactionRow): Transaction => ({
  id: r.id,
  date: r.date,
  type: CORE_TYPE[r.type],
  assetId: r.asset_id ?? '',
  amount: Number(r.amount),
  ...present('quantity', num(r.quantity)),
  ...present('unitPrice', num(r.unit_price)),
  ...present('taxWithheld', num(r.tax_withheld)),
  ...present('note', r.note),
});

/** The caller's version and rows from ONE SNAPSHOT, so a write between two statements cannot pair
 *  an old version with new rows. Read-only: nothing here writes. */
export async function readLedger(client: SqlClient, userId: string): Promise<Ledger> {
  await client.query('START TRANSACTION READ ONLY');
  try {
    const version = await client.query<{ data_version: string }>(VERSION, [userId]);
    const assets = await client.query<AssetRow>(ASSETS, [userId]);
    const transactions = await client.query<TransactionRow>(TRANSACTIONS, [userId]);
    const prices = await client.query<PriceRowText>(PRICES, [userId]);
    await client.query('COMMIT');
    return {
      dataVersion: version.rows[0].data_version,
      assets: assets.rows.map(asset),
      transactions: transactions.rows.map(transaction),
      userPrices: prices.rows.map((p) => ({
        assetId: p.asset_id,
        asOf: p.as_of,
        price: Number(p.price),
      })),
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
