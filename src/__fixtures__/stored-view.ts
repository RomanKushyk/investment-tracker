// The view's four reads over ledgers held as tests hold them, with ₴ snapshots as stored: the server's
// composers over the rows given, in place of the series the server rebuilds from per-unit prices.
// The golden ledgers are stored this way, so a screen's figures are held to the composers' own on
// them, and a body built here stands in for the API's wherever a test needs one.
import { todayIso } from '@quirenote/core/dates';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { pricesOfSnapshots } from '@quirenote/core/valuation';
import { buildBalanceRow, paginateSnapshots } from '@quirenote/core/view/balances';
import { buildView, ledgerAsOf } from '@quirenote/core/view/build';
import type { ViewInput } from '@quirenote/core/view/input';
import {
  dayQuotes,
  servedInput,
  type BalancesBody,
  type DayQuotes,
  type DeleteCount,
  type SeriesBody,
  type ViewBody,
} from '@quirenote/core/view/serve';
import { windowView } from '@quirenote/core/view/window';
import { cumulativeYieldSeriesIn } from '@quirenote/core/view/yield';
import type { ViewData } from '../lib/repository';

export interface AllTables {
  assets: Asset[];
  snapshots: Snapshot[];
  transactions: Transaction[];
}

export const NO_TABLES: AllTables = { assets: [], snapshots: [], transactions: [] };

// The rows in the order the server sorts them, with the stored series in place of the rebuilt one.
function storedInput(tables: AllTables, today: string): ViewInput {
  const served = servedInput({
    assets: tables.assets,
    transactions: tables.transactions,
    userPrices: [],
    archiveRows: [],
    paymentDates: [],
    today,
  });
  return { ...served, snapshots: tables.snapshots };
}

/** The day's read as the server composes it, over the stored quotes as per-unit rows at each day's
 *  own holding: the form's prefill, each held position's baseline, and the latest save time. */
const storedDay = (tables: AllTables, date: string): DayQuotes =>
  dayQuotes(
    tables.transactions,
    { user: pricesOfSnapshots(tables.transactions, tables.snapshots), archive: [] },
    date,
  );

/** What deleting each asset removes: its transactions, and its key from every stored day. */
function storedDeleteCounts(
  assets: readonly Asset[],
  transactions: readonly Transaction[],
  snapshots: readonly Snapshot[],
): Record<string, DeleteCount> {
  return Object.fromEntries(
    assets.map((a) => [
      a.id,
      {
        transactions: transactions.filter((t) => t.assetId === a.id).length,
        quoteDays: snapshots.filter((s) => Object.hasOwn(s.quotes, a.id)).length,
      },
    ]),
  );
}

export function viewOf(tables: AllTables, today = todayIso()): ViewBody {
  const input = storedInput(tables, today);
  return {
    view: buildView(input),
    fx: null,
    assets: input.assets,
    transactions: input.transactions,
    today: storedDay(tables, today),
    deleteCounts: storedDeleteCounts(input.assets, input.transactions, tables.snapshots),
  };
}
/** The body as the API serves it: the view and the rows, the tag a write goes under, the settings. */
export const viewDataOf = (tables: AllTables, today = todayIso()): ViewData => ({
  ...viewOf(tables, today),
  tag: '"0"',
  settings: SETTINGS_DEFAULTS,
});
export function seriesOf(tables: AllTables, period: PeriodOption, today = todayIso()): SeriesBody {
  const { assets, snapshots, transactions } = ledgerAsOf(storedInput(tables, today));
  const w = windowView({ assets, snapshots, transactions, period });
  return { period, series: cumulativeYieldSeriesIn(snapshots, transactions, assets, w) };
}
export function balancesOf(tables: AllTables, page: number, today = todayIso()): BalancesBody {
  const { assets, snapshots, transactions } = ledgerAsOf(storedInput(tables, today));
  const cut = paginateSnapshots(snapshots, page);
  return {
    assets: assets.map((a) => a.id),
    rows: cut.rows.map((s) => buildBalanceRow(s, assets, transactions)),
    page: cut.page,
    total: cut.total,
    next: cut.next,
  };
}
export const dayOf = (tables: AllTables, date: string): DayQuotes => storedDay(tables, date);
