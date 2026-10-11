import {
  focusManager,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';

import type { PeriodOption } from '@quirenote/core/period';
import type { Asset, Snapshot, Transaction } from '@quirenote/core/types';
import type { BalancesBody, DayQuotes, SeriesBody, ViewBody } from '@quirenote/core/view/serve';
import {
  emptyDay,
  emptyView,
  readBalances,
  readDay,
  readSeries,
  readView,
} from '../lib/local-view';
import { repo } from '../lib/repository';
import { useToday } from './useToday';

// THE READS. Every screen and form takes its slice of ONE query, `GET /view`'s body, through a
// selector made at module level (`slices.ts`): `select` runs again only when the data or the
// function changes, and what it returns is shared structurally, so a consumer of one slice does not
// render when another moves (*Core is pure*). The three wide figures are reads of their own, by
// period, by page and by day.
//
// Fresh until something says otherwise: a write, another tab's replace or erase, the day changing
// or the page being shown again invalidates the key (`refreshView`, `useDbSync`,
// `useViewDayRollover`, `useViewShownAgain`), and moving between screens reads the view no more.
export const viewKey = ['view'] as const;
const FRESH = { staleTime: Infinity } as const;

export const viewQuery = queryOptions({ queryKey: viewKey, queryFn: readView, ...FRESH });

export const seriesQuery = (period: PeriodOption) =>
  queryOptions({
    queryKey: [...viewKey, 'series', period] as const,
    queryFn: () => readSeries(period),
    ...FRESH,
  });

export const balancesQuery = (page: number) =>
  queryOptions({
    queryKey: [...viewKey, 'balances', page] as const,
    queryFn: () => readBalances(page),
    ...FRESH,
  });

export const dayQuery = (date: string) =>
  queryOptions({
    queryKey: [...viewKey, 'day', date] as const,
    queryFn: () => readDay(date),
    ...FRESH,
  });

function useViewRead<T>(select: (body: ViewBody) => T) {
  return useQuery({ ...viewQuery, select });
}

/** A slice of the view. Until the read answers it is the slice of an empty portfolio, which is what
 *  a screen showed before its rows were listed. */
export function useView<T>(select: (body: ViewBody) => T): T {
  const { data } = useViewRead(select);
  const empty = useMemo(
    () => (data === undefined ? select(emptyView()) : undefined),
    [data, select],
  );
  return data !== undefined ? data : (empty as T);
}

const nothing = () => null;
/** Whether the view has been read at least once. */
export function useViewReady(): boolean {
  return useViewRead(nothing).isSuccess;
}

/** The yield curve of one period, nothing until the first read answers: an empty curve would read as
 *  a portfolio with no snapshots. A period read after another keeps the curve it had until the new
 *  one lands, so the chart does not blank between two periods. */
export function useSeries(period: PeriodOption): SeriesBody | undefined {
  return useQuery({ ...seriesQuery(period), placeholderData: keepPreviousData }).data;
}

/** One page of the Balances table, nothing until the first read answers, and the page it had until
 *  the next lands. A body names its own `page`, which tells the one shown from the one asked for. */
export function useBalancesPage(page: number): BalancesBody | undefined {
  return useQuery({ ...balancesQuery(page), placeholderData: keepPreviousData }).data;
}

/** What was recorded on `date` and before it. The view carries the caller's day, so that day costs
 *  no read; another is read on its own, and shows as an empty day until it lands, never as the
 *  last one picked. */
export function useDayQuotes(date: string, today: DayQuotes): DayQuotes {
  const held = date === today.date;
  const { data } = useQuery({ ...dayQuery(date), enabled: !held });
  const empty = useMemo(() => emptyDay(date), [date]);
  return held ? today : (data ?? empty);
}

/** The view is cut at the caller's day, so a new day is a new view: read again when the clock finds
 *  one. Mounted once, where the shell is. */
export function useViewDayRollover(): void {
  const qc = useQueryClient();
  const today = useToday();
  const seen = useRef(today);
  useEffect(() => {
    if (seen.current === today) return;
    seen.current = today;
    void qc.invalidateQueries({ queryKey: viewKey });
  }, [today, qc]);
}

/** A row written in one tab is announced to no other, so a page shown again invalidates every view
 *  read: the ones on screen are read at once, the rest when next mounted. TanStack's own refetch on
 *  focus goes through a mounted observer, which a cached curve, page or day has none of. Mounted
 *  once, where the shell is. */
export function useViewShownAgain(): void {
  const qc = useQueryClient();
  useEffect(
    () =>
      focusManager.subscribe((focused) => {
        if (focused) void qc.invalidateQueries({ queryKey: viewKey });
      }),
    [qc],
  );
}

// THE WRITES. Each returns the invalidation's promise, which the mutation waits for before it
// settles: a control that waits on its write waits for the view the write changed, and is never idle
// beside the figure it had not changed yet.
const refreshView = (qc: QueryClient) => qc.invalidateQueries({ queryKey: viewKey });

export function useSaveSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Snapshot) => repo.saveSnapshot(s),
    onSuccess: () => refreshView(qc),
  });
}

export function useRecordTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tx, newAsset }: { tx: Transaction; newAsset?: Asset }) =>
      repo.recordTransaction(tx, newAsset),
    onSuccess: () => refreshView(qc),
  });
}

// Standalone create (/portfolio "Add asset") —
// the TransactionPanel quick-create keeps the atomic recordTransaction path.
export function useAddAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (asset: Asset) => repo.addAsset(asset),
    onSuccess: () => refreshView(qc),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Asset> }) =>
      repo.updateAsset(id, patch),
    onSuccess: () => refreshView(qc),
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteAsset(id),
    onSuccess: () => refreshView(qc),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Transaction> }) =>
      repo.updateTransaction(id, patch),
    onSuccess: () => refreshView(qc),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => repo.deleteTransaction(id),
    onSuccess: () => refreshView(qc),
  });
}

export function useDeleteSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (date: string) => repo.deleteSnapshot(date),
    onSuccess: () => refreshView(qc),
  });
}

// One-shot consistent read of all three tables (backup download) — a
// mutation, not a query: the export must reflect the DB at click time, never
// a cached result. Nothing to invalidate.
export function useExportAll() {
  return useMutation({ mutationFn: () => repo.exportAll() });
}

// Whole-dataset replace (import). `onBlocked` is forwarded to the Web Lock
// so the caller can say "Waiting for another tab…" instead of "Replacing…".
export function useReplaceAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      data,
      onBlocked,
    }: {
      data: Parameters<typeof repo.replaceAll>[0];
      onBlocked?: () => void;
    }) => repo.replaceAll(data, { onBlocked }),
    onSuccess: () => refreshView(qc),
  });
}

export function useClearAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => repo.clearAll(),
    onSuccess: () => refreshView(qc),
  });
}
