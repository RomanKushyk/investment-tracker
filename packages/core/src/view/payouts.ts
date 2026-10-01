// Pure data-shaping for the Payouts screen: imports core/ only. Covered by payouts.test.ts.
import { incomeReceived, reinvestedTotal } from '../derive';
import type { Transaction, TxType } from '../types';
import type { ClockInput, LedgerInput } from './input';
import { nextPayoutRows, type PayoutRow } from './overview';

export interface MonthlyPayout {
  month: string; // 'YYYY-MM'
  dividends: number;
  coupons: number;
  total: number;
}

export function monthlyPayouts(transactions: Transaction[]): MonthlyPayout[] {
  const byMonth = new Map<string, { dividends: number; coupons: number }>();
  for (const t of transactions) {
    if (t.type !== 'dividend_accrual' && t.type !== 'interest_payout') continue;
    const month = t.date.slice(0, 7);
    const entry = byMonth.get(month) ?? { dividends: 0, coupons: 0 };
    if (t.type === 'dividend_accrual') entry.dividends += t.amount;
    else entry.coupons += t.amount;
    byMonth.set(month, entry);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { dividends, coupons }]) => ({
      month,
      dividends,
      coupons,
      total: dividends + coupons,
    }));
}

// Structured token — the UI renders the destination words.
export type PayoutDestination = { kind: 'account' } | { kind: 'reinvested'; amount: number };

export interface PayoutLogRow {
  date: string;
  assetId: string;
  type: Extract<TxType, 'dividend_accrual' | 'interest_payout'>;
  amount: number;
  /** Absent is the only spelling of none — never 0. */
  taxWithheld?: number;
  /** `amount − coalesce(taxWithheld, 0)`, derived here so the screen has no arithmetic. */
  net: number;
  destination: PayoutDestination;
}

// A payout's destination derives from a same-date, same-asset `reinvest` row.
export function payoutLogRows(transactions: Transaction[]): PayoutLogRow[] {
  const payouts = transactions.filter(
    (t): t is Transaction & { type: 'dividend_accrual' | 'interest_payout' } =>
      t.type === 'dividend_accrual' || t.type === 'interest_payout',
  );
  const reinvests = transactions.filter((t) => t.type === 'reinvest');

  return payouts
    .map((t) => {
      const match = reinvests.find((r) => r.date === t.date && r.assetId === t.assetId);
      const destination: PayoutDestination = match
        ? { kind: 'reinvested', amount: match.amount }
        : { kind: 'account' };
      return {
        date: t.date,
        assetId: t.assetId,
        type: t.type,
        amount: t.amount,
        // Spread rather than assigned, so an untaxed row carries no key at all — the
        // shape the store, the envelope and the CSV already use.
        ...(t.taxWithheld === undefined ? {} : { taxWithheld: t.taxWithheld }),
        net: t.amount - (t.taxWithheld ?? 0),
        destination,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export interface PayoutsView {
  income: ReturnType<typeof incomeReceived>;
  reinvested: number;
  /** Of everything paid out, the share put straight back in; 0 when nothing was paid. */
  reinvestedPct: number;
  nextPayouts: PayoutRow[];
  months: MonthlyPayout[];
  log: PayoutLogRow[];
}

/** The Payouts screen's figures, over the whole ledger; the next payouts are measured
 *  from `today`, as on Overview. */
export function payoutsView({
  assets,
  transactions,
  today,
}: Pick<LedgerInput, 'assets' | 'transactions'> & ClockInput): PayoutsView {
  const income = incomeReceived(transactions);
  const reinvested = reinvestedTotal(transactions);
  return {
    income,
    reinvested,
    reinvestedPct: income.total === 0 ? 0 : (reinvested / income.total) * 100,
    nextPayouts: nextPayoutRows(assets, transactions, today),
    months: monthlyPayouts(transactions),
    log: payoutLogRows(transactions),
  };
}
