// The Inzhur feed's network half: a MANUAL-ONLY TanStack query over the public
// endpoint, plus the last-good payload in the Dexie meta table. Parsing and
// matching stay pure (core/inzhur/parse.ts); policy is docs/decisions/README.md D19.
//
// Nothing here writes portfolio data (G5): a fetch produces values in memory —
// only the user's Save/Confirm press in the P3 UI ever records anything.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { msUntilNextKyivHour } from '../core/dates';
import { parseAssetsFeed, type ParsedFeed } from '../core/inzhur/parse';
import { repo } from '../lib/repository';
import { useDataset } from '../state/settings';

/**
 * Public, unauthenticated, `Access-Control-Allow-Origin: *`. It MUST be
 * requested as a BARE GET — zero custom request headers and no credentials
 * (D19, verified from the app's own origin): a non-safelisted header makes the
 * request preflighted and the OPTIONS response has no ACAO, while `ACAO: *`
 * itself rules out credentialed requests. Both fail in the browser.
 */
export const INZHUR_ASSETS_URL = 'https://www.inzhur.reit/_api/assets';

/** Prices refresh ~13:00 Europe/Kyiv — the freshness boundary (D19). */
export const INZHUR_REFRESH_HOUR = 13;

const INZHUR_TIMEOUT_MS = 10_000;

export const inzhurKeys = {
  /** Pinned Phase 3 contract. */
  assets: ['inzhur', 'assets'] as const,
  /** Local companion: the meta-table read, no network. */
  lastFetch: ['inzhur', 'lastFetch'] as const,
};

/** Meta row key pinned by the Phase 3 contracts. */
export const INZHUR_LAST_FETCH_KEY = 'inzhur:lastFetch';

/** What we persist: the RAW payload (so a later parse improvement re-reads the
 *  untouched feed) plus when it arrived. */
export interface InzhurLastFetch {
  payload: unknown;
  fetchedAt: string;
}

export interface InzhurFeed {
  feed: ParsedFeed;
  /** Full ISO instant (with 'Z') — an instant, not a wall clock: the UI turns
   *  it into local "fetched 13:05" / "as of 25.07" copy. */
  fetchedAt: string;
}

async function getPayload(querySignal: AbortSignal): Promise<unknown> {
  // Our own controller so the ~10 s timeout and TanStack's cancellation both
  // abort the same request.
  const controller = new AbortController();
  const abort = () => controller.abort();
  querySignal.addEventListener('abort', abort);
  const timeout = setTimeout(abort, INZHUR_TIMEOUT_MS);
  try {
    // Nothing but the signal — no headers, no credentials (see the URL doc).
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
    // Shape drift or an error page: fail loudly rather than overwrite a usable
    // last-good cache with something we cannot read.
    throw new Error('Inzhur returned no readable assets');
  }
  const fetchedAt = new Date().toISOString();
  await repo.setMeta(INZHUR_LAST_FETCH_KEY, { payload, fetchedAt } satisfies InzhurLastFetch);
  return { feed, fetchedAt };
}

function readCache(row: unknown): InzhurFeed | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const { payload, fetchedAt } = row as Partial<InzhurLastFetch>;
  if (typeof fetchedAt !== 'string') return undefined;
  const feed = parseAssetsFeed(payload);
  return feed.entries.length === 0 ? undefined : { feed, fetchedAt };
}

export interface UseInzhurAssets {
  /** The last successful fetch of this session. */
  data: InzhurFeed | undefined;
  /** Last-good feed from the meta cache — survives reloads and is what the UI
   *  offers when a fetch fails ("Use values from 25.07"). */
  lastGood: InzhurFeed | undefined;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  /** True in the demo dataset: no request can leave the app (G4/D16). */
  disabled: boolean;
  /** The ONLY way a request happens (the query is `enabled: false`). Resolves
   *  with the feed, or undefined when disabled or the fetch failed — the
   *  failure itself surfaces through isError/error. */
  fetchAssets: () => Promise<InzhurFeed | undefined>;
}

export function useInzhurAssets(): UseInzhurAssets {
  const disabled = useDataset() === 'demo';
  const queryClient = useQueryClient();

  // Destructured field by field on purpose: TanStack tracks which result
  // properties a component reads and re-renders only for those.
  const { data, isFetching, isError, error, refetch } = useQuery({
    queryKey: inzhurKeys.assets,
    queryFn: ({ signal }) => fetchFeed(signal),
    enabled: false, // manual only — the user's click is the sole trigger
    retry: 1,
    // 'always' instead of the default 'online': with the default, a press made
    // while the browser is offline PAUSES the query — no request, no error, so
    // the UI would sit there silently (and would then fill drafts by itself
    // whenever the connection came back, which G5 forbids). We want the attempt
    // to happen and to FAIL, so the S1 error path can offer the last-good cache.
    networkMode: 'always',
    // Measured from the FETCH instant (a function, so it is evaluated lazily
    // and never during render): a payload stays fresh until the feed's next
    // ~13:00 Kyiv refresh, whether that is in 10 minutes or 23 hours.
    staleTime: (q) =>
      q.state.dataUpdatedAt === 0
        ? 0
        : msUntilNextKyivHour(new Date(q.state.dataUpdatedAt), INZHUR_REFRESH_HOUR),
    gcTime: Infinity, // one fetch a day: never drop it while the app is open
  });

  const { data: cached } = useQuery({
    queryKey: inzhurKeys.lastFetch,
    // `?? null`: TanStack rejects `undefined` as query data (it logs an error
    // and leaves the query failed), and "no cache row yet" is the normal state
    // on a fresh profile — null says "read it, there is nothing".
    queryFn: async () => (await repo.getMeta<InzhurLastFetch>(INZHUR_LAST_FETCH_KEY)) ?? null,
    staleTime: Infinity,
    gcTime: Infinity,
    // A local IndexedDB read — never let it be paused for being "offline":
    // offline is exactly when the last-good cache has to be readable.
    networkMode: 'always',
  });

  // Parsed once per cached row, not per render: `readCache` zod-parses the whole
  // raw payload (~300 KB live), and the consumers re-render on every keystroke in
  // a quote input. Memoizing also keeps `lastGood`'s identity stable, so the
  // callbacks built on it stop churning.
  const lastGood = useMemo(() => readCache(cached), [cached]);

  const fetchAssets = useCallback(async () => {
    if (disabled) return undefined;
    const result = await refetch();
    // A failed refetch keeps the previous payload in `data` — return undefined
    // so a caller can never mistake it for a fresh fetch (the failure itself is
    // on isError/error, and lastGood is what the UI offers instead).
    if (result.error !== null) return undefined;
    // The success rewrote the meta row — re-read it so lastGood keeps up.
    await queryClient.invalidateQueries({ queryKey: inzhurKeys.lastFetch });
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
