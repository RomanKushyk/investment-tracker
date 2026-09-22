// The Daily-quotes fetch ritual; pure decisions live in ./fetch-quotes.ts. NOTHING
// HERE TOUCHES THE REPOSITORY — a fetch writes draft text and provenance, and the
// save press is still the only way in.
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { kyivDateIso } from '@quirenote/core/dates';
import { matchAssets, type ParsedFeed } from '@quirenote/core/inzhur/parse';
import type { Asset, QuoteSource } from '@quirenote/core/types';
import { INZHUR_REFRESH_HOUR, useInzhurAssets, type InzhurFeed } from '../../hooks/useInzhurAssets';
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
import { inputValue } from '@quirenote/core/money';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import { useSettings } from '../../state/settings';

/** The success flash reverts to the idle label after this long. */
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
  /** Whatever feed is in hand, live or the last-good cache; always undefined in demo. */
  feed: ParsedFeed | undefined;
  /** The instant `feed` was actually fetched — NOT "now" on a cache hit, and never the
   *  date in the picker. Anything reasoning about how old the provider's prices are
   *  dates them from here, or it blames the provider for the cache's own age. */
  feedFetchedAt: string | undefined;
  fetchQuotes: () => void;
  chipFor: (asset: Asset) => ProvenanceChip | undefined;
  offerFor: (asset: Asset) => QuoteOffer | undefined;
  acceptOffer: (assetId: string) => void;
  dismissOffer: (assetId: string) => void;
}

export function useQuoteFetch(
  assets: Asset[],
  /** An asset absent from this record is valued from its stored link total instead. */
  unitsHeld: Record<string, number>,
  /** Assets whose ledger holds position-moving rows but cannot be counted. They fall
   *  back to the link's hand-typed total, so the fetch reports a number that is old
   *  and, after a sale, too large — the only way that becomes visible. */
  incompleteLedgers: readonly string[],
): QuoteFetch {
  const t = useT();
  const f = useFormat();
  const language = useSettings((s) => s.language);
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

  // Reads the draft through getState(), so a second press reconciles against the screen.
  const apply = useCallback(
    (feed: InzhurFeed, source: QuoteSource) => {
      const { linked } = matchAssets(assets, feed.feed, unitsHeld);
      const draft = useDraft.getState();
      const {
        fills,
        offers: pending,
        negative,
        noCount,
      } = reconcileFetched(linked, draft.quotes, draft.origins, language);
      for (const fill of fills) {
        draft.fillQuote(fill.assetId, inputValue(fill.value, 2), { source, at: feed.fetchedAt });
      }
      // Wholesale: every resolve re-decides all rows, which un-hides a dismissed offer.
      setOffers(
        Object.fromEntries(
          pending.map((offer) => [
            offer.assetId,
            { value: offer.value, stale: source === 'cache', at: feed.fetchedAt },
          ]),
        ),
      );
      // THE SUCCESS FLASH BELONGS TO A FETCH THAT SUCCEEDED; applying the CACHE after
      // a failure must not claim it.
      if (source === 'fetch') setFlashAt(feed.fetchedAt);
      // NAMED, NOT COUNTED: a count leaves the owner to find which, when this knows.
      const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
      // SAID OUT LOUD, because the row is FILLED from the link's old total and nothing
      // on screen looks wrong. GATED ON A LIVE FETCH — ONE RULE SERVES ALL THREE
      // TOASTS: this claims a row WAS valued, so on the cache path it would compete
      // with the cache's own account of that value, while the two below are claims
      // about the LEDGER and are ungated. Minus the rows not valued at all, for which
      // it is simply false; a first-time link can be in both sets.
      const stale = incompleteLedgers.filter(
        (id) => linked.some((m) => m.asset.id === id) && !noCount.includes(id),
      );
      if (source === 'fetch' && stale.length > 0) {
        toast.message(t.dailyQuotes.staleLedgerRows(stale.map(nameOf).join(', ')), {
          id: 'stale-ledger',
        });
      }
      // A HOLDING CANNOT BE NEGATIVE. `error`, not `message`: the one above describes
      // a value that is merely old, this an impossible ledger. The prices it was
      // noticed alongside are irrelevant, and the cache path is the one the owner
      // takes for days while the network is down.
      if (negative.length > 0) {
        toast.error(t.dailyQuotes.negativeUnits(negative.map(nameOf).join(', ')), {
          id: 'negative-units',
        });
      }

      // NO COUNT AT ALL, the one state nothing else on the screen explains: the row is
      // linked, the feed HAS it, and the fetch still leaves it empty. It takes
      // precedence over the stale toast, which claims the row WAS valued. `message`,
      // not `error` — nothing is wrong, the app is saying what it needs.
      if (noCount.length > 0) {
        toast(t.dailyQuotes.noUnitsRecorded(noCount.map(nameOf).join(', ')), {
          id: 'no-units-recorded',
        });
      }
    },
    [assets, unitsHeld, incompleteLedgers, language, t],
  );

  const fetchQuotes = useCallback(() => {
    void (async () => {
      // Still fresh on the same feed day: re-serve it, no second roundtrip.
      if (
        data !== undefined &&
        payloadStillFresh(data.fetchedAt, new Date(), INZHUR_REFRESH_HOUR)
      ) {
        apply(data, 'fetch');
        return;
      }
      const feed = await fetchAssets();
      if (feed !== undefined) {
        apply(feed, 'fetch');
        return;
      }
      if (disabled) return; // demo: no request left the app, so no failure
      // Never silent, never a thrown boundary: the cache is offered, never applied.
      toast.error(t.dailyQuotes.fetchFailed, {
        ...(lastGood === undefined
          ? {}
          : {
              action: {
                label: t.dailyQuotes.useValuesFrom(
                  f.dateShort(kyivDateIso(new Date(lastGood.fetchedAt))),
                ),
                onClick: () => apply(lastGood, 'cache'),
              },
            }),
      });
    })();
  }, [apply, data, disabled, fetchAssets, lastGood, f, t]);

  const chipFor = useCallback(
    (asset: Asset) =>
      // A chip describes fetch provenance, and in demo there is no fetch.
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
      return offerVisible(row, offer.value, language) ? offer : undefined;
    },
    [language, offers, origins, quotes],
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
      useDraft.getState().fillQuote(assetId, inputValue(offer.value, 2), {
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
    freshness: feedFreshness(latestFetchedAt(data?.fetchedAt, lastGood?.fetchedAt), new Date()),
    flashAt,
    feed: data?.feed ?? lastGood?.feed,
    feedFetchedAt: data?.fetchedAt ?? lastGood?.fetchedAt,
    fetchQuotes,
    chipFor,
    offerFor,
    acceptOffer,
    dismissOffer,
  };
}
