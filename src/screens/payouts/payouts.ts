// Pure data-shaping for the Payouts screen (monthly chart + log table) — not
// in src/lib, that layer stays untouched per this task's scope. Covered by
// payouts.test.ts.
import { fmtTable } from '../../lib/format';
import type { Transaction, TxType } from '../../lib/types';

export interface MonthlyPayout {
  month: string; // 'YYYY-MM'
  dividends: number;
  coupons: number;
  total: number;
}

// dividend_accrual -> dividends bar (reit color), interest_payout -> coupons
// bar (ovdp8976 color), grouped by calendar month, chronological.
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
    .map(([month, { dividends, coupons }]) => ({ month, dividends, coupons, total: dividends + coupons }));
}

export interface PayoutLogRow {
  date: string;
  assetId: string;
  type: Extract<TxType, 'dividend_accrual' | 'interest_payout'>;
  amount: number;
  destination: string; // 'account' | 'reinvested (₴X,XX)'
}

// A payout's destination derives from a same-date, same-asset `reinvest` tx
// (README §6.4 / D5#3) — else it went to the account.
export function payoutLogRows(transactions: Transaction[]): PayoutLogRow[] {
  const payouts = transactions.filter(
    (t): t is Transaction & { type: 'dividend_accrual' | 'interest_payout' } =>
      t.type === 'dividend_accrual' || t.type === 'interest_payout',
  );
  const reinvests = transactions.filter((t) => t.type === 'reinvest');

  return payouts
    .map((t) => {
      const match = reinvests.find((r) => r.date === t.date && r.assetId === t.assetId);
      const destination = match ? `reinvested (₴${fmtTable(match.amount)})` : 'account';
      return { date: t.date, assetId: t.assetId, type: t.type, amount: t.amount, destination };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}
