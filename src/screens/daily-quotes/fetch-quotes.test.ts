// Figures come from the trimmed live fixture (core/inzhur/__fixtures__) and
// the user's real dashboard: 6 164 × 11.1389 = 68 660,18 · 9 × 6 675,8848 =
// 60 082,96 · 15 × 1 057,67 = 15 865,05 (docs/NEXT-PHASE-PLAN.md P3 Verify).
import { describe, expect, it } from 'vitest';

import { matchAssets, parseAssetsFeed, type InzhurMatch } from '../../core/inzhur/parse';
import type { Asset, QuoteOrigin } from '../../core/types';
import fixture from '../../core/inzhur/__fixtures__/assets-sample.json';
import {
  feedFreshness,
  fetchButtonState,
  isTyped,
  latestFetchedAt,
  linkedCount,
  offerVisible,
  payloadStillFresh,
  provenanceChip,
  reconcileFetched,
  sameQuote,
} from './fetch-quotes';

const feed = parseAssetsFeed(fixture);

function asset(id: string, inzhur?: Asset['inzhur']): Asset {
  return {
    id,
    name: id,
    code: 'XX',
    colorKey: 'reit',
    yieldType: 'capitalization',
    expectedPct: 0,
    targetPct: 0,
    payoutSchedule: 'none',
    firstPurchase: '2026-02-03',
    createdAt: '2026-02-03T00:00:00',
    ...(inzhur === undefined ? {} : { inzhur }),
  };
}

const reit = asset('reit', { kind: 'fund', ref: 'inzhur-reit', units: 6164 });
const energy = asset('energy', { kind: 'fund', ref: 'inzhur-energy', units: 9 });
const bond = asset('ovdp8976', { kind: 'bond', ref: 'UA4000238976', units: 15 });
const manual = asset('manual');

const matches: InzhurMatch[] = matchAssets([reit, energy, bond], feed).linked;
const FETCH: QuoteOrigin = { source: 'fetch', at: '2026-08-04T10:05:00.000Z' };
const CACHE: QuoteOrigin = { source: 'cache', at: '2026-07-25T10:05:00.000Z' };

describe('sameQuote — the S3 equality guard', () => {
  it('accepts the table format the fetch itself writes', () => {
    expect(sameQuote('68 660,18', 68660.18)).toBe(true);
    expect(sameQuote('68660.18', 68660.18)).toBe(true);
  });

  it('rejects a different number, an unparseable draft and an absent one', () => {
    expect(sameQuote('68 660,19', 68660.18)).toBe(false);
    expect(sameQuote('15 90', 15907.45)).toBe(false);
    expect(sameQuote('', 1)).toBe(false);
    expect(sameQuote(undefined, 1)).toBe(false);
  });

  it('compares at kopeck precision (float noise never creates an offer)', () => {
    expect(sameQuote('60 082,96', 9 * 6675.8848)).toBe(true);
  });
});

describe('isTyped / offerVisible', () => {
  it('counts a non-empty draft without an origin as the user’s own', () => {
    expect(isTyped({ raw: '60 100,00', origin: undefined })).toBe(true);
    expect(isTyped({ raw: '   ', origin: undefined })).toBe(false);
    expect(isTyped({ raw: undefined, origin: undefined })).toBe(false);
    expect(isTyped({ raw: '68 660,18', origin: FETCH })).toBe(false);
  });

  it('shows an offer only over a differing typed value', () => {
    expect(offerVisible({ raw: '60 100,00', origin: undefined }, 60082.96)).toBe(true);
    expect(offerVisible({ raw: '60 082,96', origin: undefined }, 60082.96)).toBe(false);
    expect(offerVisible({ raw: '', origin: undefined }, 60082.96)).toBe(false);
    // A machine-filled row is refilled, never offered.
    expect(offerVisible({ raw: '60 000,00', origin: FETCH }, 60082.96)).toBe(false);
  });
});

describe('provenanceChip (S2)', () => {
  it('never chips an unlinked row', () => {
    expect(provenanceChip(false, { raw: '68 660,18', origin: FETCH })).toBeUndefined();
  });

  it('never chips an empty linked row', () => {
    expect(provenanceChip(true, { raw: undefined, origin: undefined })).toBeUndefined();
    expect(provenanceChip(true, { raw: ' ', origin: undefined })).toBeUndefined();
  });

  it('maps origin → token: fetch = auto, cache = stale, none = manual', () => {
    expect(provenanceChip(true, { raw: '68 660,18', origin: FETCH })).toEqual({
      chip: 'auto',
      at: FETCH.at,
    });
    expect(provenanceChip(true, { raw: '15 852,60', origin: CACHE })).toEqual({
      chip: 'stale',
      at: CACHE.at,
    });
    expect(provenanceChip(true, { raw: '60 100,00', origin: undefined })).toEqual({
      chip: 'manual',
    });
  });
});

describe('reconcileFetched — the G5 decision', () => {
  it('fills every empty linked row with units × sellUAH', () => {
    expect(reconcileFetched(matches, {}, {})).toEqual({
      fills: [
        { assetId: 'reit', value: 68660.18 },
        { assetId: 'energy', value: 60082.96 },
        { assetId: 'ovdp8976', value: 15865.05 },
      ],
      offers: [],
    });
  });

  it('offers instead of overwriting a value the user typed', () => {
    const { fills, offers } = reconcileFetched(
      matches,
      { energy: '60 100,00' },
      {},
    );
    expect(fills.map((f) => f.assetId)).toEqual(['reit', 'ovdp8976']);
    expect(offers).toEqual([{ assetId: 'energy', value: 60082.96 }]);
  });

  it('refills a row a previous fetch filled (it is not the user’s value)', () => {
    const { fills, offers } = reconcileFetched(
      matches,
      { reit: '68 000,00', energy: '60 000,00' },
      { reit: FETCH, energy: CACHE },
    );
    expect(fills.map((f) => f.assetId)).toEqual(['reit', 'energy', 'ovdp8976']);
    expect(offers).toEqual([]);
  });

  it('neither fills nor offers when the typed value already equals the fetched one', () => {
    const { fills, offers } = reconcileFetched(
      matches,
      { ovdp8976: '15 865,05' },
      {},
    );
    expect(fills.map((f) => f.assetId)).toEqual(['reit', 'energy']);
    expect(offers).toEqual([]);
  });

  it('ignores assets the feed does not carry (matchAssets never lists them)', () => {
    const gone = asset('gone', { kind: 'bond', ref: 'UA9999999999', units: 1 });
    const { linked } = matchAssets([gone, manual], feed);
    expect(reconcileFetched(linked, {}, {})).toEqual({ fills: [], offers: [] });
  });
});

describe('linkedCount', () => {
  it('counts only linked assets', () => {
    expect(linkedCount([reit, energy, bond, manual])).toBe(3);
    expect(linkedCount([manual])).toBe(0);
    expect(linkedCount([])).toBe(0);
  });
});

describe('latestFetchedAt', () => {
  it('takes the later instant and tolerates absences', () => {
    expect(latestFetchedAt(CACHE.at, FETCH.at)).toBe(FETCH.at);
    expect(latestFetchedAt(FETCH.at, undefined)).toBe(FETCH.at);
    expect(latestFetchedAt(undefined, undefined)).toBeUndefined();
  });
});

describe('feedFreshness (S1 microcopy)', () => {
  // 10:05Z is 13:05 in Kyiv summer (+3) — the design's "Inzhur 13:05".
  const now = new Date('2026-08-04T10:30:00.000Z');

  it('is fresh while the payload carries today’s Kyiv date', () => {
    expect(feedFreshness('2026-08-04T10:05:00.000Z', now)).toEqual({
      state: 'fresh',
      at: '2026-08-04T10:05:00.000Z',
    });
  });

  it('is stale for an older payload', () => {
    expect(feedFreshness(CACHE.at, now)?.state).toBe('stale');
  });

  it('uses the KYIV day boundary, not UTC', () => {
    // 21:30Z on 03.08 is already 00:30 on 04.08 in Kyiv → still today.
    expect(feedFreshness('2026-08-03T21:30:00.000Z', now)?.state).toBe('fresh');
  });

  it('is absent until a fetch has ever succeeded', () => {
    expect(feedFreshness(undefined, now)).toBeUndefined();
  });
});

describe('payloadStillFresh (S1 "re-serve, do not refetch")', () => {
  // Fetched 13:05 Kyiv on 04.08 → fresh until 13:00 Kyiv on 05.08.
  const at = '2026-08-04T10:05:00.000Z';

  it('is fresh minutes after the fetch', () => {
    expect(payloadStillFresh(at, new Date('2026-08-04T10:30:00.000Z'), 13)).toBe(true);
  });

  it('is fresh right up to the next refresh hour and stale from it on', () => {
    expect(payloadStillFresh(at, new Date('2026-08-05T09:59:59.000Z'), 13)).toBe(true);
    expect(payloadStillFresh(at, new Date('2026-08-05T10:00:00.000Z'), 13)).toBe(false);
  });

  it('goes stale at the SAME day’s refresh when fetched before it', () => {
    const morning = '2026-08-04T09:59:00.000Z'; // 12:59 Kyiv
    expect(payloadStillFresh(morning, new Date('2026-08-04T09:59:30.000Z'), 13)).toBe(true);
    expect(payloadStillFresh(morning, new Date('2026-08-04T10:00:01.000Z'), 13)).toBe(false);
  });
});

describe('fetchButtonState (S1 machine)', () => {
  const base = { demo: false, linked: 2, loading: false, flash: false };

  it('resolves in the pinned precedence', () => {
    expect(fetchButtonState({ ...base, demo: true, loading: true })).toBe('demo');
    expect(fetchButtonState({ ...base, linked: 0 })).toBe('unlinked');
    expect(fetchButtonState({ ...base, loading: true, flash: true })).toBe('loading');
    expect(fetchButtonState({ ...base, flash: true })).toBe('success');
    expect(fetchButtonState(base)).toBe('idle');
  });
});
