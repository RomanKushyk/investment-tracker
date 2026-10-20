// The provider's offer pages from before the first capture, as the Wayback Machine holds them. Pure:
// the decoded snapshots and the archive's rows on their days in, the rows to write out, and the DB
// half in `capture.ts`. A row here is the provider's own quote, an observation (*The price archive*).
import type { ParsedFeed } from '@quirenote/core/inzhur/parse';
import { inzhurAsOf } from './dates';
import { divisorOn, isDerivedSell, scaled } from './derived-sell';
import { FUND_HISTORY_PARSER_VERSION } from './fund-history';
import { inzhurObservationRows, type ObservationRow } from './observation-rows';

/** Stored per row, so a reader tells a snapshot's quote from a capture's, the history file's and an
 *  imputation's. */
export const WAYBACK_PARSER_VERSION = 'wayback-1';

export interface WaybackSnapshot {
  /** The 14-digit capture time Wayback names a snapshot by, in UTC. */
  timestamp: string;
  url: string;
}

/** Held fixed rather than discovered, as `FUND_HISTORY_CATEGORIES` is: a snapshot the archive no
 *  longer serves refuses the run instead of a neighbour standing in for it. */
export const WAYBACK_SNAPSHOTS: readonly WaybackSnapshot[] = [
  { timestamp: '20260508021040', url: 'https://www.inzhur.reit/offer/inzhur-reit/retail-parks' },
  { timestamp: '20260508024945', url: 'https://www.inzhur.reit/offer/inzhur-reit/supermarkets' },
  { timestamp: '20260508041030', url: 'https://www.inzhur.reit/offer/inzhur-reit/restaurants' },
  { timestamp: '20260511204113', url: 'https://www.inzhur.reit/offer/inzhur-reit' },
  {
    timestamp: '20260514094100',
    url: 'https://www.inzhur.reit/offer/inzhur-energy/elektrostancziyi',
  },
  { timestamp: '20260514094552', url: 'https://www.inzhur.reit/offer/inzhur-reit/supermarkets' },
  { timestamp: '20260514094705', url: 'https://www.inzhur.reit/offer/inzhur-reit/retail-parks' },
  { timestamp: '20260514110138', url: 'https://www.inzhur.reit/offer/inzhur-reit/restaurants' },
  { timestamp: '20260517124336', url: 'https://www.inzhur.reit/offer/inzhur-reit/zh-k' },
  { timestamp: '20260518151933', url: 'https://www.inzhur.reit/offer/inzhur-energy' },
  { timestamp: '20260529002953', url: 'https://www.inzhur.reit/offer/inzhur-energy' },
  { timestamp: '20260607113737', url: 'https://www.inzhur.reit/offer/inzhur-energy' },
  { timestamp: '20260615134339', url: 'https://www.inzhur.reit/offer/inzhur-energy' },
  { timestamp: '20260728170026', url: 'https://www.inzhur.reit/offer/inzhur-energy' },
];

/** `id_` asks for the page as captured, with no Wayback rewriting of its markup. */
export const snapshotUrl = (s: WaybackSnapshot) =>
  `https://web.archive.org/web/${s.timestamp}id_/${s.url}`;

/** `Memento-Datetime` (RFC 7089 §2.1.1, an HTTP-date) as Wayback's 14-digit timestamp. */
export function mementoTimestamp(header: string): string | undefined {
  const ms = Date.parse(header);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export interface DecodedSnapshot {
  snapshot: WaybackSnapshot;
  /** The response's `Memento-Datetime`, verbatim. */
  memento: string;
  feed: ParsedFeed;
}

/** An archive row on a key a snapshot also quotes, its price as the numeric prints it. */
export interface ArchivedRow {
  asOf: string;
  ref: string;
  basis: string;
  price: string;
  parserVersion: string;
}

export interface WaybackRow {
  asOf: string;
  ref: string;
  basis: string;
  price: number;
  observedAt: string;
  returnRateBuy: number | null;
  returnRateSell: number | null;
  status: string | null;
}

export interface InstrumentBounds {
  ref: string;
  kind: 'fund' | 'bond';
  maturity: string | null;
  first: string;
  last: string;
}

/** What a run reports. No money figure: the report is posted. */
export interface WaybackReport {
  snapshots: { timestamp: string; asOf: string; entries: number; skipped: number }[];
  /** Keys the archive already holds, each left as it is because it agrees. */
  collisions: { asOf: string; ref: string; basis: string; parserVersion: string }[];
}

/** The Kyiv day a snapshot was read on, dated as a capture is: one rule for the read and the plan. */
export function snapshotDay(memento: string): string | undefined {
  const ms = Date.parse(memento);
  return Number.isNaN(ms) ? undefined : inzhurAsOf(new Date(ms));
}

/** A derived row is a kopeck value over its divisor, rounded again: it agrees within half a kopeck
 *  over the divisor plus half a ten-thousandth. Any other row agrees to the stored digit. */
function agrees(existing: ArchivedRow, price: number): boolean {
  const held = scaled(existing.price);
  const served = scaled(String(price));
  if (held === undefined || served === undefined) return false;
  const delta = Math.abs(held - served);
  if (existing.parserVersion === FUND_HISTORY_PARSER_VERSION) return delta === 0;
  if (isDerivedSell(existing.parserVersion)) {
    const divisor = divisorOn(existing.ref, existing.asOf);
    if (divisor !== undefined) return 2 * delta * divisor <= 100 + divisor;
  }
  return delta === 0;
}

/** Every snapshot's rows as `observeInzhur` writes a capture's, or every refusal in one throw. A
 *  held key is never written and must agree; a refusal names no price. */
export function waybackPlan(
  snapshots: readonly DecodedSnapshot[],
  existing: readonly ArchivedRow[],
): { rows: WaybackRow[]; instruments: InstrumentBounds[]; report: WaybackReport } {
  const refusals: string[] = [];
  const planned = new Map<string, { row: WaybackRow; source: ObservationRow; timestamp: string }>();
  const instruments = new Map<string, InstrumentBounds>();
  const report: WaybackReport = { snapshots: [], collisions: [] };

  for (const { snapshot, memento, feed } of snapshots) {
    const ts = snapshot.timestamp;
    if (mementoTimestamp(memento) !== ts) {
      refusals.push(`${ts}: its Memento-Datetime ${memento} is not the snapshot's`);
      continue;
    }
    if (feed.skipped.some((s) => s.reason === 'not_an_array')) {
      refusals.push(`${ts}: no asset list on the page`);
      continue;
    }
    if (!feed.entries.some((e) => e.kind === 'fund')) {
      refusals.push(`${ts}: no priced fund on the page`);
      continue;
    }
    const observedAt = new Date(Date.parse(memento)).toISOString();
    const asOf = snapshotDay(memento)!;
    report.snapshots.push({
      timestamp: ts,
      asOf,
      entries: feed.entries.length,
      skipped: feed.skipped.length,
    });

    for (const quote of feed.entries) {
      for (const r of inzhurObservationRows(quote)) {
        const key = `${asOf} ${r.ref} ${r.basis}`;
        const earlier = planned.get(key);
        if (earlier !== undefined) {
          // Two readings of one day: equal hides nothing, different is two claims and neither wins.
          // Every column the row carries, so a column added later is compared too.
          const e = earlier.source;
          if ((Object.keys(r) as (keyof ObservationRow)[]).some((k) => e[k] !== r[k])) {
            refusals.push(`${key}: snapshots ${earlier.timestamp} and ${ts} differ`);
          }
          continue;
        }
        planned.set(key, {
          timestamp: ts,
          source: r,
          row: {
            asOf,
            ref: r.ref,
            basis: r.basis,
            price: r.price,
            observedAt,
            returnRateBuy: r.returnRateBuy,
            returnRateSell: r.returnRateSell,
            status: r.status,
          },
        });
      }
      // Every sighting widens both bounds and fills a maturity, as `observeInzhur` merges them.
      const seen = instruments.get(quote.ref);
      instruments.set(quote.ref, {
        ref: quote.ref,
        kind: quote.kind,
        maturity: quote.maturity ?? seen?.maturity ?? null,
        first: seen !== undefined && seen.first < asOf ? seen.first : asOf,
        last: seen !== undefined && seen.last > asOf ? seen.last : asOf,
      });
    }
  }

  const held = new Map(existing.map((r) => [`${r.asOf} ${r.ref} ${r.basis}`, r]));
  const rows: WaybackRow[] = [];
  for (const [key, { row }] of planned) {
    const archived = held.get(key);
    if (archived === undefined) {
      rows.push(row);
      continue;
    }
    if (!agrees(archived, row.price)) {
      refusals.push(`${key}: the archive's ${archived.parserVersion} row disagrees`);
      continue;
    }
    report.collisions.push({
      asOf: row.asOf,
      ref: row.ref,
      basis: row.basis,
      parserVersion: archived.parserVersion,
    });
  }

  if (refusals.length > 0) throw new Error(`wayback refused:\n${refusals.join('\n')}`);
  return { rows, instruments: [...instruments.values()], report };
}
