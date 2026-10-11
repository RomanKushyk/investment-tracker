// The device's answer to the user API's four reads: the server's composers over the rows Dexie
// holds. The device keeps ₴ snapshots, so it composes the figures over them as they are stored, and
// reads the day and the delete counts from them as stored; the server rebuilds the series from
// per-unit prices, and has an archive and payment dates the device has not. The reads below are
// what a query calls; the API's client takes their place by swapping the calls and nothing above
// them.
import { todayIso } from '@quirenote/core/dates';
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
import { repo, type AllTables } from './repository';

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

// What a screen shows before its read answers: the same functions over no rows.
export const emptyView = (): ViewBody => viewOf(NO_TABLES);
export const emptyDay = (date: string): DayQuotes => dayOf(NO_TABLES, date);

// One consistent read of the three tables per answer, so a figure never mixes two states.
export async function readView(): Promise<ViewBody> {
  return viewOf(await repo.exportAll());
}
export async function readSeries(period: PeriodOption): Promise<SeriesBody> {
  return seriesOf(await repo.exportAll(), period);
}
export async function readBalances(page: number): Promise<BalancesBody> {
  return balancesOf(await repo.exportAll(), page);
}
export async function readDay(date: string): Promise<DayQuotes> {
  return dayOf(await repo.exportAll(), date);
}
