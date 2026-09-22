// The Inzhur feed's network half: a MANUAL-ONLY query plus the last-good payload in the
// meta table. Nothing here writes portfolio data — a fetch produces values in memory,
// and only the user's own press records anything. *External sources*
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { msUntilNextKyivHour } from '@quirenote/core/dates';
import { parseAssetsFeed, type ParsedFeed, type SkippedEntry } from '@quirenote/core/inzhur/parse';
import { repo } from '../lib/repository';
import { useDataset } from '../state/settings';

/**
 * Public and unauthenticated. It MUST be requested as a BARE GET — zero custom headers
 * and no credentials: a non-safelisted header makes the request preflighted and the
 * OPTIONS response carries no ACAO, while `ACAO: *` itself rules out credentials.
 * Both fail in the browser.
 */
export const INZHUR_ASSETS_URL = 'https://www.inzhur.reit/_api/assets';

/** Prices refresh at this Kyiv hour — the freshness boundary. */
export const INZHUR_REFRESH_HOUR = 13;

const INZHUR_TIMEOUT_MS = 10_000;

export const inzhurKeys = {
  assets: ['inzhur', 'assets'] as const,
  lastFetch: ['inzhur', 'lastFetch'] as const,
  lastParse: ['inzhur', 'lastParse'] as const,
};

export const INZHUR_LAST_FETCH_KEY = 'inzhur:lastFetch';

/** Beside the payload, not inside it: the diagnosis has to survive a reload and be
 *  readable without re-parsing the whole feed. */
export const INZHUR_LAST_PARSE_KEY = 'inzhur:lastParse';

/**
 * What the last parse made of the payload, written on EVERY successful fetch including
 * the ones with nothing skipped: a record that appears only on failure cannot tell
 * "the feed is fine" from "nobody has looked since it broke".
 */
export interface InzhurLastParse {
  at: string;
  entries: number;
  skipped: SkippedEntry[];
}

/** The RAW payload, so a later parse improvement re-reads the untouched feed. */
export interface InzhurLastFetch {
  payload: unknown;
  fetchedAt: string;
}

export interface InzhurFeed {
  feed: ParsedFeed;
  /** An instant, not a wall clock: the UI turns it into local copy. */
  fetchedAt: string;
}

async function getPayload(querySignal: AbortSignal): Promise<unknown> {
  // Our own controller, so the timeout and TanStack's cancellation abort one request.
  const controller = new AbortController();
  const abort = () => controller.abort();
  querySignal.addEventListener('abort', abort);
  const timeout = setTimeout(abort, INZHUR_TIMEOUT_MS);
  try {
    const response = await fetch(INZHUR_ASSETS_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Inzhur responded ${response.status}`);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
    querySignal.removeEventListener('abort', abort);
  }
}

async function fetchFeed(querySignal: AbortSignal): Promise<InzhurFeed> {
  const payload = await getPayload(querySignal);
  const feed = parseAssetsFeed(payload);
  if (feed.entries.length === 0) {
    // Shape drift or an error page: fail loudly rather than overwrite a usable cache.
    throw new Error('Inzhur returned no readable assets');
  }
  const fetchedAt = new Date().toISOString();
  await repo.setMeta(INZHUR_LAST_FETCH_KEY, { payload, fetchedAt } satisfies InzhurLastFetch);
  // Written whether or not anything was skipped: "nothing wrong as of <when>" is a
  // different statement from "no record", and only the first is evidence.
  await repo.setMeta(INZHUR_LAST_PARSE_KEY, {
    at: fetchedAt,
    entries: feed.entries.length,
    skipped: feed.skipped,
  } satisfies InzhurLastParse);
  return { feed, fetchedAt };
}

/** A local read, so it works offline and survives a reload. */
export function useLastParse(): InzhurLastParse | undefined {
  const { data } = useQuery({
    queryKey: inzhurKeys.lastParse,
    queryFn: async () => (await repo.getMeta<InzhurLastParse>(INZHUR_LAST_PARSE_KEY)) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: 'always',
  });
  return data ?? undefined;
}

function readCache(row: unknown): InzhurFeed | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const { payload, fetchedAt } = row as Partial<InzhurLastFetch>;
  if (typeof fetchedAt !== 'string') return undefined;
  const feed = parseAssetsFeed(payload);
  return feed.entries.length === 0 ? undefined : { feed, fetchedAt };
}

export interface UseInzhurAssets {
  data: InzhurFeed | undefined;
  /** What the UI offers when a fetch fails; survives reloads. */
  lastGood: InzhurFeed | undefined;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  /** True in the demo dataset: no request can leave the app. */
  disabled: boolean;
  /** The ONLY way a request happens: the query is `enabled: false`. Undefined when
   *  disabled or failed — the failure itself surfaces through isError/error. */
  fetchAssets: () => Promise<InzhurFeed | undefined>;
}

export function useInzhurAssets(): UseInzhurAssets {
  const disabled = useDataset() === 'demo';
  const queryClient = useQueryClient();

  // Destructured field by field: TanStack re-renders only for the ones read.
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: inzhurKeys.assets,
    queryFn: ({ signal }) => fetchFeed(signal),
    enabled: false, // manual only — the user's click is the sole trigger
    retry: 1,
    // 'always' and not the default 'online', which PAUSES a press made offline: no
    // request and no error, so the UI sits silent — and then fills drafts by itself
    // when the connection returns, which nothing here may do. The attempt has to
    // happen and to FAIL, so the error path can offer the last-good cache.
    networkMode: 'always',
    // From the FETCH instant, and a function so it is evaluated lazily.
    staleTime: (q) =>
      q.state.dataUpdatedAt === 0
        ? 0
        : msUntilNextKyivHour(new Date(q.state.dataUpdatedAt), INZHUR_REFRESH_HOUR),
    gcTime: Infinity, // one fetch a day: never drop it while the app is open
  });

  const { data: cached } = useQuery({
    queryKey: inzhurKeys.lastFetch,
    // `?? null`: TanStack REJECTS `undefined` as query data and leaves the query
    // failed, while "no cache row yet" is the normal state on a fresh profile.
    queryFn: async () => (await repo.getMeta<InzhurLastFetch>(INZHUR_LAST_FETCH_KEY)) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
    // A local read, never paused for being "offline" — which is exactly when the
    // last-good cache has to be readable.
    networkMode: 'always',
  });

  // Parsed once per cached row, not per render: `readCache` parses the whole raw
  // payload and the consumers re-render on every keystroke in a quote input. It also
  // keeps `lastGood`'s identity stable, so the callbacks built on it stop churning.
  const lastGood = useMemo(() => readCache(cached), [cached]);

  const fetchAssets = useCallback(async () => {
    if (disabled) return undefined;
    const result = await refetch();
    // A failed refetch KEEPS the previous payload in `data`, so returning it would let
    // a caller mistake it for a fresh fetch.
    if (result.error !== null) return undefined;
    // The success rewrote both meta rows, so re-read them.
    await queryClient.invalidateQueries({ queryKey: inzhurKeys.lastFetch });
    await queryClient.invalidateQueries({ queryKey: inzhurKeys.lastParse });
    return result.data;
  }, [disabled, refetch, queryClient]);

  return {
    data,
    lastGood,
    isFetching,
    isError,
    error,
    disabled,
    fetchAssets,
  };
}
