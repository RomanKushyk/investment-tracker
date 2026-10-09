// What the three reads answer, from the rows the server reads: here rather than in the handler, so
// the derivation identifier, a hash of this package, moves with every rule that shapes a body.
import { addDays } from '../dates';
import { normalizeRef } from '../inzhur/ref';
import type { PeriodOption } from '../period';
import type { Asset, Transaction } from '../types';
import { rebuildSnapshots, type PriceRow } from '../valuation';
import { buildBalanceRow, paginateSnapshots, type BalanceRow } from './balances';
import { buildView, ledgerAsOf, type View } from './build';
import type { ViewInput } from './input';
import { windowView } from './window';
import { cumulativeYieldSeriesIn, type YieldSeriesPoint } from './yield';

/** Wider than any gap between two of the archive's sell observations of one ref: a held day reads
 *  the latest observation at or before it, so the first one needs the row before it. */
export const ARCHIVE_LOOKBACK_DAYS = 7;

/** The archive rows a ledger needs: its linked refs, folded, over a window ending today. */
export interface ArchiveSpan {
  refs: string[];
  from: string;
  to: string;
}

/** One sell observation as the archive stores it; its ref is matched to assets here. */
export interface ArchiveRow {
  ref: string;
  asOf: string;
  price: number;
}

/** A bond's payment dates as the archive serves them; its ref is matched to assets here. */
export interface PaymentDatesRow {
  ref: string;
  dates: readonly string[];
}

/** The official rate, under the day it is for. */
export interface Fx {
  rate: number;
  date: string;
}

export interface ViewBody {
  view: View;
  fx: Fx | null;
}

/** `GET /view/series`: the yield curve for one period, the one figure too wide to send for six. */
export interface SeriesBody {
  period: PeriodOption;
  series: YieldSeriesPoint[];
}

/** `GET /view/balances`: one page of the table. `cells` line up with `assets`, which names them. */
export interface BalancesBody {
  assets: string[];
  rows: BalanceRow[];
  page: number;
  total: number;
  next: number | null;
}

/** The rows the server reads, as each body takes them. */
export interface ServedRows {
  assets: Asset[];
  transactions: Transaction[];
  userPrices: PriceRow[];
  archiveRows: readonly ArchiveRow[];
  paymentDates: readonly PaymentDatesRow[];
  today: string;
}

/** Nothing when no asset is linked or no row is dated on or before today: a span then reads
 *  nothing, and the archive's read refuses one that ends before it starts. */
export function archiveSpan(
  assets: Asset[],
  transactions: Transaction[],
  today: string,
): ArchiveSpan | undefined {
  const refs = [...new Set(assets.flatMap((a) => (a.inzhur ? [normalizeRef(a.inzhur.ref)] : [])))];
  let first: string | undefined;
  for (const t of transactions)
    if (t.date <= today && (first === undefined || t.date < first)) first = t.date;
  if (refs.length === 0 || first === undefined) return undefined;
  return { refs: refs.sort(), from: addDays(first, -ARCHIVE_LOOKBACK_DAYS), to: today };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The composers' input over the rebuilt series. SORTED FIRST, as the SPA's repository reads: rows
 *  arrive in no order, and the composers break ties and sum floats in input order. */
export function servedInput(input: ServedRows): ViewInput {
  const assets = [...input.assets].sort(
    (a, b) => compare(a.createdAt, b.createdAt) || compare(a.id, b.id),
  );
  const transactions = [...input.transactions].sort(
    (a, b) => compare(a.date, b.date) || compare(a.id, b.id),
  );
  const order = new Map(assets.map((a, i) => [a.id, i]));
  const byAssetThenDay = (a: PriceRow, b: PriceRow) =>
    (order.get(a.assetId) ?? assets.length) - (order.get(b.assetId) ?? assets.length) ||
    compare(a.assetId, b.assetId) ||
    compare(a.asOf, b.asOf);
  // Every asset linked to a ref takes its rows; the sell basis is the only one read.
  const linked = new Map<string, string[]>();
  for (const a of assets) {
    if (a.inzhur === undefined) continue;
    const ref = normalizeRef(a.inzhur.ref);
    linked.set(ref, [...(linked.get(ref) ?? []), a.id]);
  }
  // ONE ROW PER ASSET AND DAY, as `PriceRows` asks, the lower price kept: a ref stored in two
  // spellings would otherwise let arrival order pick the price under one digest.
  const archive = input.archiveRows
    .flatMap(({ ref, asOf, price }) =>
      (linked.get(normalizeRef(ref)) ?? []).map((assetId) => ({ assetId, asOf, price })),
    )
    .sort((a, b) => byAssetThenDay(a, b) || a.price - b.price)
    .filter((r, i, rows) => i === 0 || byAssetThenDay(rows[i - 1], r) !== 0);
  const snapshots = rebuildSnapshots(
    assets,
    transactions,
    { user: [...input.userPrices].sort(byAssetThenDay), archive },
    input.today,
  );
  // A bond's schedule, by the link's kind: a fund pays no coupon, whatever row names its ref.
  const served = new Map(input.paymentDates.map((r) => [normalizeRef(r.ref), r.dates]));
  const paymentDates = new Map<string, readonly string[]>();
  for (const a of assets) {
    const dates = a.inzhur?.kind === 'bond' ? served.get(normalizeRef(a.inzhur.ref)) : undefined;
    if (dates !== undefined) paymentDates.set(a.id, dates);
  }
  return { assets, transactions, snapshots, today: input.today, paymentDates };
}

/** `buildView` over the rebuilt series, the rate beside it. */
export function viewBody(input: ServedRows & { fx: Fx | undefined }): ViewBody {
  return { view: buildView(servedInput(input)), fx: input.fx ?? null };
}

/** The curve the Yield screen draws for `period`, cut at the caller's day as `buildView` cuts. */
export function seriesBody(rows: ServedRows, period: PeriodOption): SeriesBody {
  const { assets, snapshots, transactions } = ledgerAsOf(servedInput(rows));
  const w = windowView({ assets, snapshots, transactions, period });
  return { period, series: cumulativeYieldSeriesIn(snapshots, transactions, assets, w) };
}

/** One page of the Balances table, cut at the caller's day as `buildView` cuts. */
export function balancesBody(rows: ServedRows, page: number): BalancesBody {
  const { assets, snapshots, transactions } = ledgerAsOf(servedInput(rows));
  const cut = paginateSnapshots(snapshots, page);
  return {
    assets: assets.map((a) => a.id),
    rows: cut.rows.map((s) => buildBalanceRow(s, assets, transactions)),
    page: cut.page,
    total: cut.total,
    next: cut.next,
  };
}
