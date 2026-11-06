// The Inzhur offer page (GET https://www.inzhur.reit/offer/ovdp), PURE half: where the capture
// reads the dealer quote, the asset feed being refused (*External sources*). The page is reshaped
// into the feed's own entries, so `parseAssetsFeed` stays the one reader of both.
import { unflatten } from 'devalue';

import { parseAssetsFeed, pickSchedule, type ParsedFeed, type SkippedEntry } from './parse';

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

// Every island's props: the page moves the schedules' zone entry between islands, and the
// catalogue carries them empty.
const ISLAND_PROPS = /<astro-island\b[^>]*\sprops="([^"]*)"/g;
/** The CMS's UID for the zone entry holding the schedules, its identity wherever it sits. */
const BOND_UNITS = 'assets.bond-units';

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

/** Pushes every `assets.bond-units` entry under `v`, at any depth of Astro's pairs, onto `found`. */
function bondUnits(v: unknown, found: unknown[]): void {
  const e = encoded(v);
  if (e?.[0] === 1 && Array.isArray(e[1])) {
    for (const x of e[1]) bondUnits(x, found);
  } else if (e?.[0] === 0 && e[1] !== null && typeof e[1] === 'object' && !Array.isArray(e[1])) {
    if (plain(field(v, '__component')) === BOND_UNITS) found.push(v);
    for (const x of Object.values(e[1])) bondUnits(x, found);
  }
}

const UNREADABLE = 'unreadable';

/** What the parser reads of a schedule, whole or nothing: `UNREADABLE` when it drops any row. */
function reading(rows: unknown): string {
  if (!Array.isArray(rows)) return UNREADABLE;
  const payments = pickSchedule(rows);
  return payments.length === rows.length ? JSON.stringify(payments) : UNREADABLE;
}

function readSchedules(html: string): Map<string, unknown[]> {
  const entries: unknown[] = [];
  for (const [, attr] of html.matchAll(ISLAND_PROPS)) {
    try {
      const props: unknown = JSON.parse(unescapeAttribute(attr));
      const found: unknown[] = [];
      for (const v of Object.values(props as object)) bondUnits(v, found);
      entries.push(...found);
    } catch {
      // An island unparsed or too deep to walk reads as none, not a throw costing the day's
      // prices: a missing schedule is the capture's to report.
    }
  }

  const schedules = new Map<string, unknown[]>();
  const said = new Map<string, string>();
  for (const entry of entries) {
    for (const segment of items(field(field(entry, 'bondSegments'), 'data'))) {
      const attributes = field(segment, 'attributes');
      const asset = field(field(field(attributes, 'asset'), 'data'), 'attributes');
      const isin = plain(field(asset, 'isin'));
      if (typeof isin !== 'string') continue;
      const key = isin.trim();
      const raw = field(attributes, 'paymentSchedule');
      const rows = plain(raw);
      const read = reading(rows);
      // No field, a null one or no rows says nothing about the bond's schedule.
      if (raw === undefined || rows === null || read === '[]') continue;
      const seen = said.get(key);
      // Compared as the parser reads them; a disagreement or an unreadable copy leaves none, since
      // a guess reaches `bond_terms` as a revision where a missing schedule is refused and counted.
      if (seen === undefined) {
        said.set(key, read);
        schedules.set(key, read === UNREADABLE ? [] : (rows as unknown[]));
      } else if (seen !== read) {
        schedules.set(key, []);
      }
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
