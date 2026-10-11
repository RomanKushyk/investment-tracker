// The view's four reads over ledgers held as tests hold them, with ₴ snapshots as stored: the server's
// composers over the rows given, in place of the series the server rebuilds from per-unit prices.
// The golden ledgers are stored this way, so a screen's figures are held to the composers' own on
// them, and a body built here stands in for the API's wherever a test needs one.
import { todayIso } from '@quirenote/core/dates';
import { SETTINGS_DEFAULTS } from '@quirenote/core/settings';
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import { buildBalanceRow, paginateSnapshots } from '@quirenote/core/view/balances';
import { buildView, ledgerAsOf } from '@quirenote/core/view/build';
import type { ViewInput } from '@quirenote/core/view/input';
import {
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

/** What was stored on `date` and before it, quotes of a position held none of included: the
 *  form's prefill, each asset's last quote before the day, and the latest save time. */
function storedDay(snapshots: readonly Snapshot[], date: string): DayQuotes {
  const previous: DayQuotes['previous'] = {};
  let savedAt: string | null = null;
  for (const s of snapshots) {
    if (s.savedAt !== undefined && (savedAt === null || s.savedAt > savedAt)) savedAt = s.savedAt;
    if (s.date >= date) continue;
    for (const [id, value] of Object.entries(s.quotes)) {
      if (previous[id] === undefined || previous[id].date < s.date) {
        previous[id] = { value, date: s.date };
      }
    }
  }
  return { date, quotes: snapshots.find((s) => s.date === date)?.quotes ?? {}, previous, savedAt };
}

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
    today: storedDay(tables.snapshots, today),
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
export const dayOf = (tables: AllTables, date: string): DayQuotes =>
  storedDay(tables.snapshots, date);
