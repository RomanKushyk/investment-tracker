import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import type { StagedImport } from '@quirenote/core/backup/parts';
import { todayIso } from '@quirenote/core/dates';
import type { PeriodOption } from '@quirenote/core/period';
import type { Asset, Transaction } from '@quirenote/core/types';
import {
  dayQuotes,
  viewBody,
  type BalancesBody,
  type DayQuotes,
  type SeriesBody,
  type ViewBody,
} from '@quirenote/core/view/serve';
import { useT } from '../i18n/useT';
import { repo, settingsCopy } from '../lib/api';
import { meKey } from '../lib/me-key';
import {
  ApiError,
  type BalancesData,
  type CouponReopen,
  type DayData,
  type MeData,
  type SeriesData,
  type ViewData,
} from '../lib/repository';
import { useToday } from './useToday';

// THE READS. Every screen and form takes its slice of ONE query, `GET /view`'s body, through a
// selector made at module level (`slices.ts`): `select` runs again only when the data or the
// function changes, and what it returns is shared structurally, so a consumer of one slice does not
// render when another moves (*Core is pure*). The three wide figures are reads of their own, by
// period, by page and by day.
//
// Fresh for a bounded while, then revalidated with the validator the API gave: a 304 hands back
// what is held, so the read costs a request and no body. A write, and the clock finding a new day,
// invalidate the key (`useWrite`, `useViewDayRollover`); TanStack's own refetch on focus and on
// mount takes everything else once it has gone stale, a curve, a page or a day cached off screen
// included. A change another tab makes is not announced; the write that would overwrite it is a 412.
export const viewKey = ['view'] as const;

/** The longest the view is shown without asking whether it has moved. A sole user's other device is
 *  the only thing that changes it behind this tab, and a write from here against a tag that moved is
 *  refused, so the window bounds how long a screen can be behind, never what is lost. */
export const VIEW_STALE_MS = 5 * 60_000;

// `networkMode: 'always'`: the default pauses a read made offline with no answer, which a screen
// would show as loading for ever. The transport retries, and a read that cannot be answered fails.
const FRESH = { staleTime: VIEW_STALE_MS, retry: false, networkMode: 'always' } as const;

export const viewQuery = queryOptions({
  queryKey: viewKey,
  queryFn: ({ client }) => repo.readView(client.getQueryData<ViewData>(viewKey)),
  ...FRESH,
});

export const seriesQuery = (period: PeriodOption) =>
  queryOptions({
    queryKey: [...viewKey, 'series', period] as const,
    queryFn: ({ client, queryKey }) =>
      repo.readSeries(period, client.getQueryData<SeriesData>(queryKey)),
    ...FRESH,
  });

export const balancesQuery = (page: number) =>
  queryOptions({
    queryKey: [...viewKey, 'balances', page] as const,
    queryFn: ({ client, queryKey }) =>
      repo.readBalances(page, client.getQueryData<BalancesData>(queryKey)),
    ...FRESH,
  });

/** The account's own read: outside the view's key, so reading the view again asks nothing of it,
 *  and held for the view's window. A write invalidates it, since the counts move with the dataset,
 *  and so does a settings patch (`lib/api.ts`). */
export const meQuery = queryOptions({
  queryKey: meKey,
  queryFn: ({ client }) => repo.readMe(client.getQueryData<MeData>(meKey)),
  ...FRESH,
});

export const dayQuery = (date: string) =>
  queryOptions({
    queryKey: [...viewKey, 'day', date] as const,
    queryFn: ({ client, queryKey }) => repo.readDay(date, client.getQueryData<DayData>(queryKey)),
    ...FRESH,
  });

// What a consumer in the shell holds before the first read answers: the body of a portfolio with
// no rows, by the function the server composes it with.
const emptyView = (): ViewBody =>
  viewBody({
    assets: [],
    transactions: [],
    userPrices: [],
    archiveRows: [],
    paymentDates: [],
    today: todayIso(),
    fx: undefined,
  });
const emptyDay = (date: string): DayQuotes => dayQuotes([], { user: [], archive: [] }, date);

function useViewRead<T>(select: (body: ViewBody) => T) {
  return useQuery({ ...viewQuery, select });
}

/** A slice of the view. Until the read answers it is the slice of an empty portfolio: the screens
 *  wait behind `Loadable` and never show it, and the shell reads `useViewReady` beside it. */
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

export type ViewGate = 'pending' | 'ready' | 'signedOut';

/** Where a screen stands with the view. A read that failed is thrown to the screen's boundary,
 *  where the failed-screen state is (*Not found and failures*), unless a view is in hand to show;
 *  a caller nobody has signed in asks for none, and gets `signedOut`. */
export function useViewGate(): ViewGate {
  const { data, status, error } = useViewRead(nothing);
  if (data !== undefined) return 'ready';
  if (status === 'error') {
    if (error instanceof ApiError && error.signedOut) return 'signedOut';
    throw error;
  }
  return 'pending';
}

/** A first read that failed, with no answer for its key to show, is thrown to the screen's boundary
 *  as the view's is: it would otherwise stay pending for ever. A caller nobody has signed in asks
 *  for nothing, and fails nothing. */
function throwFailedFirstRead(data: unknown, error: Error | null): void {
  if (data !== undefined || error === null) return;
  if (error instanceof ApiError && error.signedOut) return;
  throw error;
}

/** The yield curve of one period, nothing until the first read answers: an empty curve would read as
 *  a portfolio with no snapshots. A period read after another keeps the curve it had until the new
 *  one lands, so the chart does not blank between two periods; one whose read fails is thrown. */
export function useSeries(period: PeriodOption): SeriesBody | undefined {
  const { data, error } = useQuery({ ...seriesQuery(period), placeholderData: keepPreviousData });
  throwFailedFirstRead(data, error);
  return data;
}

/** One page of the Balances table, nothing until the first read answers, and the page it had until
 *  the next lands. A body names its own `page`, which tells the one shown from the one asked for. */
export function useBalancesPage(page: number): BalancesBody | undefined {
  const { data, error } = useQuery({ ...balancesQuery(page), placeholderData: keepPreviousData });
  throwFailedFirstRead(data, error);
  return data;
}

/** The caller's own account, nothing until the read answers. Read by the screen that shows it, so
 *  a load asks for none; one whose first read fails is thrown to the screen's boundary. */
export function useMe(): MeData | undefined {
  const { data, error } = useQuery(meQuery);
  throwFailedFirstRead(data, error);
  return data;
}

/** The caller's role, nothing while `GET /me` is out or after it fails. Settings reads it for a card
 *  only the super-admin sees, and three cards of the browser's own are not replaced over it. */
export function useRole(): MeData['role'] | undefined {
  return useQuery(meQuery).data?.role;
}

export const archiveDiagnosisKey = ['admin', 'archive', 'diagnosis'] as const;

// THE PANEL NAMES ITS FAILURES (*Not found and failures*, the archive panel's exception): the
// route's own error key, or the HTTP status where the route has none. A 403 is the router's
// not-found, which no other role may tell apart from a missing route.
export type ReadFailure =
  | { kind: 'refused' }
  | { kind: 'key'; key: 'capture_failed' | 'capture_timeout' }
  | { kind: 'status'; status: number }
  | { kind: 'offline' };

const READ_KEYS = ['capture_failed', 'capture_timeout'] as const;
const isReadKey = (v: unknown): v is (typeof READ_KEYS)[number] => READ_KEYS.some((k) => k === v);

function failureOf(error: Error): ReadFailure {
  if (!(error instanceof ApiError)) return { kind: 'offline' };
  const reply = error.reply;
  switch (reply.kind) {
    case 'answer':
      return { kind: 'refused' };
    case 'unauthorized':
      return { kind: 'status', status: 401 };
    case 'throttled':
      return { kind: 'status', status: 429 };
    case 'failed': {
      if (reply.status === undefined) return { kind: 'offline' };
      const key =
        typeof reply.body === 'object' && reply.body !== null && 'error' in reply.body
          ? reply.body.error
          : undefined;
      return isReadKey(key) ? { kind: 'key', key } : { kind: 'status', status: reply.status };
    }
    default:
      return { kind: 'offline' };
  }
}

/** The archive's diagnosis, read on a press only and never on arrival, focus or a timer. Kept until
 *  the account's queries are reset at sign-out (the owner's ruling), and a refresh that fails keeps
 *  the answer in hand, as TanStack's error state does. */
export function useArchiveDiagnosis() {
  const query = useQuery({
    queryKey: archiveDiagnosisKey,
    queryFn: () => repo.readArchiveDiagnosis(),
    enabled: false,
    gcTime: Infinity,
    retry: false,
    networkMode: 'always',
  });
  return {
    data: query.data,
    at: query.dataUpdatedAt,
    failure: query.error === null ? undefined : failureOf(query.error),
    fetching: query.isFetching,
    read: () => void query.refetch(),
  };
}

/** What was recorded on `date`, and each position's value before it. The view carries the caller's day, so that day costs
 *  no read; another is read on its own, and is an empty day, and `pending`, until it lands, never
 *  the last one picked. */
export function useDayQuotes(date: string, today: DayQuotes): { day: DayQuotes; pending: boolean } {
  const carried = date === today.date;
  const { data, error } = useQuery({ ...dayQuery(date), enabled: !carried });
  if (!carried) throwFailedFirstRead(data, error);
  const empty = useMemo(() => emptyDay(date), [date]);
  return { day: carried ? today : (data ?? empty), pending: !carried && data === undefined };
}

/** The device's copy of the account's settings sends its changes while the portfolio shell is
 *  mounted: the pages without it have no account to send to. Mounted once, where the shell is. */
export function useSettingsCopy(): void {
  useEffect(() => settingsCopy.start(), []);
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

// THE WRITES. Each settles only once the view it may have changed has been read again, so a control
// that waits on its write is never idle beside the figure it had not changed yet. A write refused
// for a stale tag changed nothing, and says so once, whichever tab or control it came from.
/** What a write moves: the view, which its control waits for, and the counts the account's own read
 *  carries, which it does not. */
const refreshWritten = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: meKey });
  return qc.invalidateQueries({ queryKey: viewKey });
};
const STALE_TOAST = 'stale-write';

/** What a control tells of a write that failed. A write refused for a stale tag has been told by
 *  `useWrite` already, once, and is not told again beside it. */
export function toastWriteFailure(error: unknown, message: string): void {
  if (error instanceof ApiError && error.stale) return;
  toast.error(message);
}

function useWrite<V, R>(write: (variables: V) => Promise<R>) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: write,
    onError: (error) => {
      if (error instanceof ApiError && error.stale) {
        toast.error(t.sync.staleWrite, { id: STALE_TOAST });
      }
    },
    onSettled: () => refreshWritten(qc),
  });
}

export function useSaveSnapshot() {
  return useWrite(
    ({
      date,
      quotes,
      stored,
    }: {
      date: string;
      quotes: Record<string, number>;
      stored: Record<string, number>;
    }) => repo.saveSnapshot(date, quotes, stored),
  );
}

export function useRecordTransaction() {
  return useWrite(({ tx, newAsset }: { tx: Transaction; newAsset?: Asset }) =>
    repo.recordTransaction(tx, newAsset),
  );
}

/** A due coupon's payout, its reinvest and the roll of the asset's pointer in one request. */
export function useRecordCoupon() {
  return useWrite(
    ({
      payout,
      reinvest,
      nextCoupon,
    }: {
      payout: Transaction;
      reinvest?: Transaction;
      nextCoupon?: string;
    }) => repo.recordCoupon(payout, reinvest, nextCoupon),
  );
}

// Standalone create (/portfolio "Add asset") —
// the TransactionPanel quick-create keeps the atomic recordTransaction path.
export function useAddAsset() {
  return useWrite((asset: Asset) => repo.addAsset(asset));
}

export function useUpdateAsset() {
  return useWrite(({ id, patch }: { id: string; patch: Partial<Asset> }) =>
    repo.updateAsset(id, patch),
  );
}

/** Every changed target in one request, so the save lands whole or not at all. */
export function useSaveTargets() {
  return useWrite((targets: readonly { id: string; targetPct: number }[]) =>
    repo.saveTargets(targets),
  );
}

export function useDeleteAsset() {
  return useWrite((id: string) => repo.deleteAsset(id));
}

export function useUpdateTransaction() {
  return useWrite(({ id, patch }: { id: string; patch: Partial<Transaction> }) =>
    repo.updateTransaction(id, patch),
  );
}

export function useDeleteTransaction() {
  return useWrite(({ id, reopen }: { id: string; reopen?: CouponReopen }) =>
    repo.deleteTransaction(id, reopen),
  );
}

export function useDeleteSnapshot() {
  return useWrite((date: string) => repo.deleteSnapshot(date));
}

// One-shot read of the dataset as the API holds it (backup download, CSV, import's diff) — a
// mutation, not a query: the export must reflect the dataset at click time, never a cached result.
// Nothing to invalidate.
export function useExportState() {
  return useMutation({ mutationFn: () => repo.exportState() });
}

// Whole-dataset replace (import) under the tag of the export the person confirmed against. It
// answers `conflict` when another write overtook that tag, for the dialog to show the new difference.
export function useReplaceAll() {
  return useWrite(({ etag, plan }: { etag: string; plan: StagedImport }) =>
    repo.replaceAll(etag, plan),
  );
}

export function useClearAll() {
  return useWrite<void, void>(() => repo.clearAll());
}
