// The Inzhur offer page (GET https://www.inzhur.reit/offer/ovdp), PURE half: where the capture
// reads the dealer quote, the asset feed being refused (*External sources*). The page is reshaped
// into the feed's own entries, so `parseAssetsFeed` stays the one reader of both.
import { unflatten } from 'devalue';

import { parseAssetsFeed, type ParsedFeed, type SkippedEntry } from './parse';

/** The slug the feed published beside each fund's core id: the page names a fund by id alone. An
 *  id missing here is skipped with the id named, never keyed by a guess. */
export const FUND_SLUGS: Readonly<Record<number, string>> = Object.freeze({
  13: 'inzhur-energy',
  17: 'ocean-plaza',
  18: 'zhytniy',
  21: 'inzhur-reit',
  48: 'inzhur-miltech',
});

// Attributes in either order: a reorder is not a missing catalogue.
const STATE =
  /<script\b(?=[^>]*\bclass="it-astro-state")(?=[^>]*\btype="application\/json\+devalue")[^>]*>([\s\S]*?)<\/script>/;
const CATALOGUE = '@inox-tools/request-nanostores:assets';

/** The one island whose props carry the bonds' schedules: the catalogue carries them empty. */
const SCHEDULES = /<astro-island\b[^>]*\bcomponent-export="OffersWelcome"[^>]*\bprops="([^"]*)"/;

const ENTITY = /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(quot|amp|lt|gt|apos));/g;
const NAMED: Readonly<Record<string, string>> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
};

// ONE PASS, or `&amp;quot;` would decode twice into a quote the attribute never held.
function unescapeAttribute(value: string): string {
  return value.replace(ENTITY, (match, dec?: string, hex?: string, name?: string) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return NAMED[name ?? ''] ?? match;
  });
}

/** Only the catalogue's subtree is decoded, so a store the capture never reads cannot fail it. The
 *  site reduces URLs itself, as `["URL", <index>]`, where devalue's own type reads a string. */
function readCatalogue(html: string): unknown {
  const script = STATE.exec(html)?.[1];
  if (script === undefined) return undefined;
  const flat: unknown = JSON.parse(script);
  if (!Array.isArray(flat)) return undefined;
  // devalue's flat form: slot 0 is the root, here `["Map", key, value, …]` by slot index.
  const root: unknown = flat[0];
  if (!Array.isArray(root) || root[0] !== 'Map') return undefined;
  for (let i = 1; i + 1 < root.length; i += 2) {
    const key: unknown = root[i];
    const value: unknown = root[i + 1];
    if (typeof key !== 'number' || flat[key] !== CATALOGUE) continue;
    if (typeof value !== 'number' || value < 1) return undefined;
    const rooted = flat.slice();
    rooted[0] = flat[value];
    return unflatten(rooted, { URL: (href: unknown) => href });
  }
  return undefined;
}

// Astro's island prop encoding (`PROP_TYPE` in astro's runtime/server/serialize.ts): `[0, value]`
// for a value or an object of encoded fields, `[1, items]` for an array. Nothing else is plain.
type Encoded = [number, unknown];

function encoded(v: unknown): Encoded | undefined {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number'
    ? (v as Encoded)
    : undefined;
}

function field(v: unknown, key: string): unknown {
  const e = encoded(v);
  if (e?.[0] !== 0 || e[1] === null || typeof e[1] !== 'object') return undefined;
  return (e[1] as Record<string, unknown>)[key];
}

function items(v: unknown): unknown[] {
  const e = encoded(v);
  return e?.[0] === 1 && Array.isArray(e[1]) ? e[1] : [];
}

const DRIFT = Symbol('drift');

/** The decoded value, or `DRIFT` if any leaf is not plain. WHOLE OR NOTHING: a schedule decoded in
 *  part reaches `bond_terms` as a revision, where a missing one is refused and counted. */
function plain(v: unknown): unknown {
  const e = encoded(v);
  if (e?.[0] === 1 && Array.isArray(e[1])) {
    const out = e[1].map(plain);
    return out.includes(DRIFT) ? DRIFT : out;
  }
  if (e?.[0] !== 0 || Array.isArray(e[1])) return DRIFT;
  if (e[1] === null || typeof e[1] !== 'object') return e[1];
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(e[1])) {
    const d = plain(x);
    if (d === DRIFT) return DRIFT;
    out[k] = d;
  }
  return out;
}

function readSchedules(html: string): Map<string, unknown[]> {
  const schedules = new Map<string, unknown[]>();
  const attr = SCHEDULES.exec(html)?.[1];
  if (attr === undefined) return schedules;
  let props: unknown;
  try {
    props = JSON.parse(unescapeAttribute(attr));
  } catch {
    // No schedules rather than a throw, which would cost the day's prices too: the missing
    // schedules are the capture's to report.
    return schedules;
  }
  const data = (props as { data?: unknown } | null)?.data;
  for (const section of items(field(data, 'Sections'))) {
    for (const segment of items(field(field(section, 'bondSegments'), 'data'))) {
      const attributes = field(segment, 'attributes');
      const asset = field(field(field(attributes, 'asset'), 'data'), 'attributes');
      const isin = plain(field(asset, 'isin'));
      const rows = plain(field(attributes, 'paymentSchedule'));
      if (typeof isin === 'string' && Array.isArray(rows)) schedules.set(isin.trim(), rows);
    }
  }
  return schedules;
}

export function parseOfferPage(html: string): ParsedFeed {
  const catalogue = readCatalogue(html);
  // Not a list: the feed parser's own answer, so both sources report it alike.
  if (!Array.isArray(catalogue)) return parseAssetsFeed(catalogue);

  const schedules = readSchedules(html);
  const unkeyed: SkippedEntry[] = [];
  const entries: unknown[] = [];
  const rowsServed = new Map<string, number>();
  for (const raw of catalogue) {
    const asset = (raw ?? {}) as {
      id?: unknown;
      type?: unknown;
      status?: unknown;
      details?: unknown;
    };
    const details = (asset.details ?? {}) as Record<string, unknown>;
    const isin = typeof details.isin === 'string' ? details.isin.trim() : '';
    if (isin !== '') {
      const paymentSchedule = schedules.get(isin) ?? details.paymentSchedule;
      rowsServed.set(isin, Array.isArray(paymentSchedule) ? paymentSchedule.length : 0);
      entries.push({ status: asset.status, assetDetails: { ...details, paymentSchedule } });
      continue;
    }
    const slug = typeof asset.id === 'number' ? FUND_SLUGS[asset.id] : undefined;
    if (slug !== undefined) {
      entries.push({ slug, status: asset.status, assetDetails: details });
      continue;
    }
    const kind = typeof asset.type === 'string' ? asset.type : 'asset';
    unkeyed.push({ ref: `${kind}#${String(asset.id)}`, reason: 'no_ref' });
  }

  const parsed = parseAssetsFeed(entries);
  // Whole or nothing here too: `parseAssetsFeed` drops an unreadable row alone.
  const whole = parsed.entries.map((e) =>
    e.kind === 'bond' && e.paymentSchedule.length !== rowsServed.get(e.ref)
      ? { ...e, paymentSchedule: [] }
      : e,
  );
  return { entries: whole, skipped: [...unkeyed, ...parsed.skipped] };
}
