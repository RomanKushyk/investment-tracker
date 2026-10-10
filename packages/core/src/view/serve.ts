// What the reads answer, from the rows the server reads: here rather than in the handler, so the
// derivation identifier, a hash of this package, moves with every rule that shapes a body.
import { addDays } from '../dates';
import { normalizeRef } from '../inzhur/ref';
import type { PeriodOption } from '../period';
import type { Asset, Transaction } from '../types';
import { rebuildSnapshots, snapshotsOfPrices, type PriceRow } from '../valuation';
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

/** What the user recorded on one day and before it: the quotes screen's prefill, its subline and
 *  baseline, and its last-saved stamp. */
export interface DayQuotes {
  date: string;
  /** Each asset's recorded ₴ quote that day. A position held none of that day has none. */
  quotes: Record<string, number>;
  /** Each asset's latest recorded quote strictly before the day, and the day it was recorded. */
  previous: Record<string, { value: number; date: string }>;
  /** The latest witness time of any price the user recorded, on any day. */
  savedAt: string | null;
}

/** What deleting an asset removes besides the asset: its transactions, and every day it has a
 *  stored price, whatever its position held that day. */
export interface DeleteCount {
  transactions: number;
  quoteDays: number;
}

/** `GET /view`'s body but for its `etag`: the figures, and the rows, the delete counts and the
 *  caller's day's facts the editors read. */
export interface ViewBody {
  view: View;
  fx: Fx | null;
  /** Every asset and every transaction, uncut: unlike the figures, a form reads the rows dated
   *  after the caller's day. */
  assets: Asset[];
  transactions: Transaction[];
  /** The caller's day as the quotes screen opens on it. */
  today: DayQuotes;
  deleteCounts: Record<string, DeleteCount>;
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

/** What the user recorded on `date` and before it, read from their own price rows alone: the rebuilt
 *  series also quotes a carried grid day and an archive price, and neither was recorded. Priced as
 *  a stored day is (`snapshotsOfPrices`), so a position held none that day has no quote. Rows in
 *  any order give one answer. */
export function dayQuotes(
  transactions: Transaction[],
  userPrices: readonly PriceRow[],
  date: string,
): DayQuotes {
  // Sorted, so that the key order of what is answered is not the order the rows arrived in.
  const sorted = [...userPrices].sort(
    (a, b) => compare(a.asOf, b.asOf) || compare(a.assetId, b.assetId),
  );
  const days = snapshotsOfPrices(transactions, sorted);
  const previous: DayQuotes['previous'] = {};
  for (const day of days) {
    if (day.date >= date) break;
    for (const [assetId, value] of Object.entries(day.quotes)) {
      previous[assetId] = { value, date: day.date };
    }
  }
  // The stamp is when anything was saved, so it reads rows of every day.
  let savedAt: string | null = null;
  for (const { observedAt } of userPrices) {
    if (observedAt === undefined) continue;
    if (savedAt === null || observedAt > savedAt) savedAt = observedAt;
  }
  return { date, quotes: days.find((d) => d.date === date)?.quotes ?? {}, previous, savedAt };
}

/** Each asset's counts, as `asset.delete` removes them: every transaction naming it and every price
 *  row of it, a day its position held none included. */
export function deleteCounts(
  assets: readonly Asset[],
  transactions: readonly Transaction[],
  userPrices: readonly PriceRow[],
): Record<string, DeleteCount> {
  const counts = new Map(assets.map((a) => [a.id, { transactions: 0, quoteDays: 0 }]));
  for (const t of transactions) {
    const count = counts.get(t.assetId);
    if (count !== undefined) count.transactions += 1;
  }
  for (const p of userPrices) {
    const count = counts.get(p.assetId);
    if (count !== undefined) count.quoteDays += 1;
  }
  return Object.fromEntries(counts);
}

/** `buildView` over the rebuilt series, the rate beside it, and the rows the editors read. */
export function viewBody(input: ServedRows & { fx: Fx | undefined }): ViewBody {
  const served = servedInput(input);
  return {
    view: buildView(served),
    fx: input.fx ?? null,
    assets: served.assets,
    transactions: served.transactions,
    today: dayQuotes(served.transactions, input.userPrices, input.today),
    deleteCounts: deleteCounts(served.assets, served.transactions, input.userPrices),
  };
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

/** `GET /view/day`: the facts `viewBody` carries for the caller's day, for any day. Cut at none, as
 *  a form reads every row. */
export function dayBody(rows: ServedRows, date: string): DayQuotes {
  return dayQuotes(rows.transactions, rows.userPrices, date);
}
