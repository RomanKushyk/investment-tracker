// The Daily-quotes fetch ritual (S1–S3): one press fills the DRAFT store for
// every Inzhur-linked row with units × sellUAH. Pure decisions live in
// ./fetch-quotes.ts; this hook only wires them to the query, the draft store
// and the toast.
//
// G5, restated where it is enforced: nothing here touches the repository. A
// fetch writes draft text and provenance — the user's "Save snapshot" press is
// still the only path into IndexedDB.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { kyivDateIso } from '../../core/dates';
import { matchAssets, type ParsedFeed } from '../../core/inzhur/parse';
import { fmtDateShort, fmtTable } from '../../core/money';
import type { Asset, QuoteSource } from '../../core/types';
import {
  INZHUR_REFRESH_HOUR,
  useInzhurAssets,
  type InzhurFeed,
} from '../../hooks/useInzhurAssets';
import { useDraft } from '../../state/draft';
import {
  feedFreshness,
  fetchButtonState,
  latestFetchedAt,
  linkedCount,
  offerVisible,
  payloadStillFresh,
  provenanceChip,
  reconcileFetched,
  type FeedFreshness,
  type FetchButtonState,
  type ProvenanceChip,
} from './fetch-quotes';

/** The success flash reverts to the idle label after this long (S1). */
const FLASH_MS = 2500;

export interface QuoteOffer {
  value: number;
  /** The offered number came from the last-good cache, not a live fetch. */
  stale: boolean;
  /** Fetch instant behind the offer — the "as of 25.07" in the stale label. */
  at: string;
}

export interface QuoteFetch {
  state: FetchButtonState;
  /** Header microcopy source; undefined until a fetch has ever succeeded. */
  freshness: FeedFreshness | undefined;
  /** Instant to render in the transient "Fetched 13:05" label. */
  flashAt: string | undefined;
  /**
   * Whatever feed is in hand (live payload, else the last-good cache) — the S5
   * coupon card reads its `paymentSchedule` for a linked bond's amount forecast.
   * Undefined until something has been fetched; always undefined in demo.
   */
  feed: ParsedFeed | undefined;
  fetchQuotes: () => void;
  chipFor: (asset: Asset) => ProvenanceChip | undefined;
  offerFor: (asset: Asset) => QuoteOffer | undefined;
  acceptOffer: (assetId: string) => void;
  dismissOffer: (assetId: string) => void;
}

export function useQuoteFetch(assets: Asset[]): QuoteFetch {
  const { data, lastGood, isFetching, disabled, fetchAssets } = useInzhurAssets();
  const quotes = useDraft((s) => s.quotes);
  const origins = useDraft((s) => s.origins);
  const [offers, setOffers] = useState<Record<string, QuoteOffer>>({});
  const [flashAt, setFlashAt] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (flashAt === undefined) return;
    const timer = setTimeout(() => setFlashAt(undefined), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashAt]);

  // Applies a feed to the DRAFT only. Reads the draft through getState() so a
  // second press always reconciles against what is on screen right now.
  const apply = useCallback(
    (feed: InzhurFeed, source: QuoteSource) => {
      const { linked } = matchAssets(assets, feed.feed);
      const draft = useDraft.getState();
      const { fills, offers: pending } = reconcileFetched(linked, draft.quotes, draft.origins);
      for (const fill of fills) {
        draft.fillQuote(fill.assetId, fmtTable(fill.value), { source, at: feed.fetchedAt });
      }
      // Wholesale replace: every resolve re-decides all rows, which is also
      // what un-hides an offer the user dismissed after the previous fetch.
      setOffers(
        Object.fromEntries(
          pending.map((offer) => [
            offer.assetId,
            { value: offer.value, stale: source === 'cache', at: feed.fetchedAt },
          ]),
        ),
      );
      // The success flash belongs to a fetch that succeeded (a re-served fresh
      // payload counts, S1); applying the CACHE after a failure must not claim
      // it — that press ends in state 5, with the button back to idle.
      if (source === 'fetch') setFlashAt(feed.fetchedAt);
    },
    [assets],
  );

  const fetchQuotes = useCallback(() => {
    void (async () => {
      // Still fresh (same feed day) → re-serve it; no second roundtrip (S1).
      if (data !== undefined && payloadStillFresh(data.fetchedAt, new Date(), INZHUR_REFRESH_HOUR)) {
        apply(data, 'fetch');
        return;
      }
      const feed = await fetchAssets();
      if (feed !== undefined) {
        apply(feed, 'fetch');
        return;
      }
      if (disabled) return; // demo: no request left the app, so no failure
      // Never a silent no-op and never a thrown boundary: a toast, plus the
      // last-good cache offered explicitly (never applied by itself).
      toast.error("Couldn't reach Inzhur — check your connection.", {
        ...(lastGood === undefined
          ? {}
          : {
              action: {
                label: `Use values from ${fmtDateShort(kyivDateIso(new Date(lastGood.fetchedAt)))}`,
                onClick: () => apply(lastGood, 'cache'),
              },
            }),
      });
    })();
  }, [apply, data, disabled, fetchAssets, lastGood]);

  const chipFor = useCallback(
    (asset: Asset) =>
      // Chips describe fetch provenance — in demo there is no fetch, so a
      // `manual` chip on every row would be noise (S2 demo row).
      disabled
        ? undefined
        : provenanceChip(asset.inzhur !== undefined, {
            raw: quotes[asset.id],
            origin: origins[asset.id],
          }),
    [disabled, origins, quotes],
  );

  const offerFor = useCallback(
    (asset: Asset) => {
      const offer = offers[asset.id];
      if (offer === undefined) return undefined;
      const row = { raw: quotes[asset.id], origin: origins[asset.id] };
      return offerVisible(row, offer.value) ? offer : undefined;
    },
    [offers, origins, quotes],
  );

  const dismissOffer = useCallback((assetId: string) => {
    setOffers((current) => {
      const next = { ...current };
      delete next[assetId];
      return next;
    });
  }, []);

  const acceptOffer = useCallback(
    (assetId: string) => {
      const offer = offers[assetId];
      if (offer === undefined) return;
      useDraft.getState().fillQuote(assetId, fmtTable(offer.value), {
        source: offer.stale ? 'cache' : 'fetch',
        at: offer.at,
      });
      dismissOffer(assetId);
    },
    [dismissOffer, offers],
  );

  return {
    state: fetchButtonState({
      demo: disabled,
      linked: linkedCount(assets),
      loading: isFetching,
      flash: flashAt !== undefined,
    }),
    freshness: feedFreshness(
      latestFetchedAt(data?.fetchedAt, lastGood?.fetchedAt),
      new Date(),
    ),
    flashAt,
    feed: data?.feed ?? lastGood?.feed,
    fetchQuotes,
    chipFor,
    offerFor,
    acceptOffer,
    dismissOffer,
  };
}
