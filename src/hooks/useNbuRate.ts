// The NBU exchange rate's network half: a MANUAL-ONLY TanStack query over the
// public directory, plus the last-good rate in the Dexie meta table. Parsing
// stays pure (core/nbu/rate.ts) — core never fetches (G1).
//
// Nothing here writes settings. A fetch produces a value in memory; only the
// user's press in Settings ever stores it, exactly as a quote fetch only fills
// a draft (G5).
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { todayIso } from '../core/dates';
import { nbuRateUrl, parseNbuRate, type NbuRate } from '../core/nbu/rate';
import { repo } from '../lib/repository';
import { useDataset } from '../state/settings';

const NBU_TIMEOUT_MS = 10_000;

export const nbuKeys = {
  rate: ['nbu', 'rate'] as const,
};

/** Meta row key — the last rate that parsed, so a failed fetch still has
 *  something honest to show. */
export const NBU_LAST_RATE_KEY = 'nbu:lastRate';

export interface NbuRateResult extends NbuRate {
  /** Full ISO instant the value arrived. Distinct from `date`, which is the day
   *  the rate APPLIES to — a Monday fetch of Sunday's rate has both. */
  fetchedAt: string;
}

async function fetchRate(querySignal: AbortSignal): Promise<NbuRateResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  querySignal.addEventListener('abort', abort);
  const timeout = setTimeout(abort, NBU_TIMEOUT_MS);
  try {
    // A bare GET: no custom headers, no credentials. `ACAO: *` rules out
    // credentialed requests, and any non-safelisted header would make this
    // preflighted — the same constraint as the Inzhur feed (D19).
    const response = await fetch(nbuRateUrl(todayIso()), { signal: controller.signal });
    if (!response.ok) throw new Error(`NBU responded ${response.status}`);
    // TEXT, not json(): every failure this endpoint has arrives as an HTTP 200,
    // and one of them (`[{ Wrong date format }]`) is not JSON at all. The
    // tolerant parse owns that, so `response.json()` would throw first.
    const rate = parseNbuRate(await response.text());
    if (rate === undefined) throw new Error('NBU returned no readable rate');
    const result: NbuRateResult = { ...rate, fetchedAt: new Date().toISOString() };
    await repo.setMeta(NBU_LAST_RATE_KEY, result);
    return result;
  } finally {
    clearTimeout(timeout);
    querySignal.removeEventListener('abort', abort);
  }
}

function readCache(row: unknown): NbuRateResult | undefined {
  if (typeof row !== 'object' || row === null) return undefined;
  const { rate, date, currency, fetchedAt } = row as Partial<NbuRateResult>;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return undefined;
  if (typeof date !== 'string' || typeof fetchedAt !== 'string') return undefined;
  return { rate, date, currency: typeof currency === 'string' ? currency : 'USD', fetchedAt };
}

export interface UseNbuRate {
  /** The last successful fetch of this session. */
  data: NbuRateResult | undefined;
  /** Last-good rate from the meta cache — survives reloads, and is what the UI
   *  shows when a fetch fails. */
  lastGood: NbuRateResult | undefined;
  isFetching: boolean;
  isError: boolean;
  /** True in the demo dataset: no request may leave the app (G4/D16). */
  disabled: boolean;
  /** The ONLY way a request happens. Resolves undefined when disabled or the
   *  fetch failed — the failure surfaces through isError. */
  fetchRate: () => Promise<NbuRateResult | undefined>;
}

export function useNbuRate(): UseNbuRate {
  const disabled = useDataset() === 'demo';
  const queryClient = useQueryClient();

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: nbuKeys.rate,
    queryFn: ({ signal }) => fetchRate(signal),
    enabled: false, // manual only — the user's press is the sole trigger
    retry: 1,
    // 'always', not the default 'online': an offline press must ATTEMPT and
    // FAIL so the UI can say so, rather than pausing silently and then firing
    // by itself when the connection returns.
    networkMode: 'always',
  });

  const { data: lastGood } = useQuery({
    queryKey: [...nbuKeys.rate, 'lastGood'] as const,
    queryFn: async () => readCache(await repo.getMeta(NBU_LAST_RATE_KEY)) ?? null,
  });

  return {
    data,
    lastGood: lastGood ?? undefined,
    isFetching,
    isError,
    disabled,
    fetchRate: async () => {
      if (disabled) return undefined;
      const r = await refetch();
      await queryClient.invalidateQueries({ queryKey: [...nbuKeys.rate, 'lastGood'] });
      return r.data;
    },
  };
}
