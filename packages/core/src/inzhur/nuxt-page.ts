// The provider's offer page as it stood before the current site, a Nuxt app, PURE half: what the
// Wayback Machine's snapshots of it hold (*The price archive*). Its state carries the old asset
// feed's own list, so `parseAssetsFeed` stays the one reader of every era.
import { unflatten } from 'devalue';

import { parseAssetsFeed, type ParsedFeed, type SkippedEntry } from './parse';

// Attributes in either order: a reorder is not a missing state.
const STATE =
  /<script\b(?=[^>]*\bid="__NUXT_DATA__")(?=[^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/;

/** Nuxt's reactive wrappers, read as the values they wrap; the site reduces URLs itself too. */
const identity = (value: unknown) => value;
const REVIVERS = Object.fromEntries(
  [
    'ShallowReactive',
    'Reactive',
    'Ref',
    'ShallowRef',
    'EmptyRef',
    'EmptyShallowRef',
    'NuxtError',
    'Island',
    'URL',
  ].map((type) => [type, identity]),
);

/** Built fresh for each caller: one shared answer is also one point of corruption. */
const notAList = (): ParsedFeed => ({
  entries: [],
  skipped: [{ ref: '(root)', reason: 'not_an_array' }],
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Only `data` is decoded, where `useAsyncData` keeps the asset list under a hashed key: the list is
 *  found by its shape, and none or two is no list. */
function readAssets(html: string): unknown[] | undefined {
  const script = STATE.exec(html)?.[1];
  if (script === undefined) return undefined;
  try {
    const flat: unknown = JSON.parse(script);
    if (!Array.isArray(flat)) return undefined;
    const root = flat[0];
    const payload = Array.isArray(root) && typeof root[1] === 'number' ? flat[root[1]] : root;
    if (!isRecord(payload) || typeof payload.data !== 'number') return undefined;
    const rooted = flat.slice();
    rooted[0] = flat[payload.data];
    const data: unknown = unflatten(rooted, REVIVERS);
    if (!isRecord(data)) return undefined;
    const lists = Object.values(data).filter(
      (v): v is unknown[] =>
        Array.isArray(v) && v.length > 0 && v.every((e) => isRecord(e) && 'assetDetails' in e),
    );
    return lists.length === 1 ? lists[0] : undefined;
  } catch {
    return undefined;
  }
}

/** A fund's `isin: null` is read as absent, as the feed omits it. A bond with no ISIN is skipped
 *  rather than keyed by its slug, which would read it as a fund. */
export function parseNuxtOfferPage(html: string): ParsedFeed {
  const assets = readAssets(html);
  if (assets === undefined) return notAList();
  const unkeyed: SkippedEntry[] = [];
  const kept: unknown[] = [];
  for (const raw of assets as Record<string, unknown>[]) {
    const details = raw.assetDetails;
    // Not a plain object, an array included: the feed's parser skips it as `shape`, with the field named.
    if (!isRecord(details) || Array.isArray(details)) {
      kept.push(raw);
      continue;
    }
    const isin = typeof details.isin === 'string' ? details.isin.trim() : '';
    if (raw.type === 'bond' && isin === '') {
      unkeyed.push({ ref: String(raw.slug ?? '(no slug)'), reason: 'no_ref' });
      continue;
    }
    kept.push(
      details.isin === null ? { ...raw, assetDetails: { ...details, isin: undefined } } : raw,
    );
  }
  const feed = parseAssetsFeed(kept);
  return { entries: feed.entries, skipped: [...unkeyed, ...feed.skipped] };
}
