// Fixture-driven: `/offer/ovdp` as served, against the last feed capture the archive holds, taken
// the same day (*External sources*).
import { readFileSync } from 'node:fs';

import { stringify } from 'devalue';
import { describe, expect, it } from 'vitest';

import { FUND_SLUGS, parseOfferPage } from './offer-page';
import { parseAssetsFeed, type InzhurQuote } from './parse';
import feedFixture from './__fixtures__/assets-2026-09-24.json';

const PAGE = readFileSync(
  new URL('./__fixtures__/offer-ovdp-2026-09-24.html', import.meta.url),
  'utf8',
);
const STATE = /<script class="it-astro-state"[\s\S]*?<\/script>/;
const ISLAND = /<astro-island\b[\s\S]*?<\/astro-island>/;

/** The page without one element. The count is checked first, or a pattern that matched nothing
 *  would "remove" it and the test would pass on the untouched page. */
function without(pattern: RegExp): string {
  expect(PAGE.match(new RegExp(pattern.source, 'g'))).toHaveLength(1);
  return PAGE.replace(pattern, '');
}

// The page carries no titles for funds and a generic one for bonds; nothing archived reads it.
const untitled = (q: InzhurQuote) => ({ ...q, title: undefined });

const feed = parseAssetsFeed(feedFixture);
const page = parseOfferPage(PAGE);

function pageQuote(ref: string): InzhurQuote {
  const found = page.entries.find((e) => e.ref === ref);
  if (found === undefined) throw new Error(`page has no entry '${ref}'`);
  return found;
}

describe('parseOfferPage on the page as served', () => {
  it('parses every ref of the last feed capture to the quote the feed parsed to', () => {
    expect(feed.entries).toHaveLength(39);
    expect(feed.skipped).toEqual([]);
    for (const quote of feed.entries) {
      expect(untitled(pageQuote(quote.ref)), quote.ref).toEqual(untitled(quote));
    }
  });

  it('adds only the five bonds that had matured before the feed stopped listing them', () => {
    const listed = new Set(feed.entries.map((e) => e.ref));
    const added = page.entries.filter((e) => !listed.has(e.ref)).map((e) => e.ref);
    expect(added.sort()).toEqual(
      ['UA4000228449', 'UA4000228910', 'UA4000230635', 'UA4000231187', 'UA40002312K7'].sort(),
    );
  });

  it('skips a fund the crosswalk lacks, naming its core id, and keys none by a guess', () => {
    expect(page.skipped.map((s) => `${s.ref}:${s.reason}`).sort()).toEqual([
      'fund#14:no_ref',
      'fund#15:no_ref',
      'fund#16:no_ref',
      'fund#19:no_ref',
      'fund#20:no_ref',
    ]);
    const funds = page.entries.filter((e) => e.kind === 'fund').map((e) => e.ref);
    expect(funds.sort()).toEqual(Object.values(FUND_SLUGS).sort());
  });

  // THE CROSSWALK IS THE FEED'S OWN RECORD: each of its fund entries carried `id` beside `slug`.
  it('pins each fund id to the slug the feed published beside it', () => {
    const published = Object.fromEntries(
      feedFixture.filter((e) => e.type === 'fund').map((e) => [e.id, e.slug]),
    );
    expect(FUND_SLUGS).toEqual(published);
  });
});

describe('parseOfferPage on a page missing what it reads', () => {
  it('reads nothing from a page without the catalogue, and says so', () => {
    expect(parseOfferPage(without(STATE))).toEqual({
      entries: [],
      skipped: [{ ref: '(root)', reason: 'not_an_array' }],
    });
  });

  it('leaves every bond without a schedule when the page lacks the island', () => {
    const bonds = parseOfferPage(without(ISLAND)).entries.filter((e) => e.kind === 'bond');
    expect(bonds).toHaveLength(39);
    expect(bonds.filter((b) => b.paymentSchedule.length > 0).map((b) => b.ref)).toEqual([]);
  });

  // Every price still reads: a throw here would cost the day's quotes along with its schedules.
  it('keeps every price when the island cannot be parsed', () => {
    for (const broken of ['props="{', 'props="&#99999999;']) {
      const at = PAGE.split('props="');
      expect(at).toHaveLength(2);
      const parsed = parseOfferPage(at.join(broken));
      expect(parsed.entries, broken).toHaveLength(44);
      const scheduled = parsed.entries.filter((e) => e.paymentSchedule.length > 0);
      expect(
        scheduled.map((e) => e.ref),
        broken,
      ).toEqual([]);
    }
  });

  it('reads the catalogue whatever the order of its script’s attributes', () => {
    const tag = '<script class="it-astro-state" type="application/json+devalue">';
    expect(PAGE.split(tag)).toHaveLength(2);
    const reordered = PAGE.replace(
      tag,
      '<script type="application/json+devalue" class="it-astro-state">',
    );
    expect(parseOfferPage(reordered)).toEqual(page);
  });
});

/** Astro's island prop encoding: an array is `[1, items]`, anything else `[0, value]`. */
function astro(value: unknown): unknown {
  if (Array.isArray(value)) return [1, value.map(astro)];
  if (value !== null && typeof value === 'object') {
    return [0, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, astro(v)]))];
  }
  return [0, value];
}

/** A store the capture never reads, of a type only the site's own reducers know. */
class SiteOnly {
  readonly note = 'unread';
}

function syntheticPage(
  schedules: Record<string, unknown[]>,
  { siteOnlyStore = false } = {},
): string {
  const assets = Object.keys(schedules).map((isin, id) => ({
    id,
    status: 'active',
    type: 'bond',
    details: {
      isin,
      maturityDate: '2027-03-24T00:00:00.000Z',
      prices: { sellUAH: 1000, buyUAH: 1001, navUAH: 0 },
      returnRates: { buy: 15, sell: 15 },
      paymentSchedule: [],
    },
  }));
  const stores = new Map<string, unknown>([['@inox-tools/request-nanostores:assets', assets]]);
  if (siteOnlyStore) stores.set('@inox-tools/request-nanostores:site-only', new SiteOnly());
  const state = stringify(stores, { SiteOnly: (v) => v instanceof SiteOnly && [v.note] });
  const segments = Object.entries(schedules).map(([isin, rows]) => [
    0,
    {
      attributes: [
        0,
        {
          asset: astro({ data: { attributes: { isin } } }),
          paymentSchedule: [1, rows],
        },
      ],
    },
  ]);
  const props = { data: astro({ Sections: [] }) } as { data: [number, Record<string, unknown>] };
  props.data[1].Sections = [1, [[0, { bondSegments: [0, { data: [1, segments] }] }]]];
  const escaped = JSON.stringify(props)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return (
    `<script class="it-astro-state" type="application/json+devalue">${state}</script>` +
    `<astro-island component-export="OffersWelcome" props="${escaped}"></astro-island>`
  );
}

describe('parseOfferPage on an island row it cannot read', () => {
  // A PARTIAL SCHEDULE IS WORSE THAN NONE: it reaches `bond_terms` with a fresh digest and reads
  // as a genuine revision, where an empty one is refused and counted.
  it("drops a bond's whole schedule when one of its rows is not plain data", () => {
    const row = (date: string) => astro({ id: 1, date, amount: '7840' });
    const parsed = parseOfferPage(
      syntheticPage({
        UA0000000001: [row('2026-09-22T21:00:00.000Z'), row('2027-03-23T22:00:00.000Z')],
        // A Date-typed leaf, which only a drifted page would carry.
        UA0000000002: [
          row('2026-09-22T21:00:00.000Z'),
          [0, { id: [0, 2], date: [3, '2027-03-23T22:00:00.000Z'], amount: [0, '7840'] }],
        ],
      }),
    );
    const schedule = (ref: string) => parsed.entries.find((e) => e.ref === ref)?.paymentSchedule;
    expect(schedule('UA0000000001')).toEqual([
      { date: '2026-09-23', amount: 78.4 },
      { date: '2027-03-24', amount: 78.4 },
    ]);
    expect(schedule('UA0000000002')).toEqual([]);
  });

  it("drops a bond's whole schedule when the parser cannot read one of its rows", () => {
    const row = (amount: string) => astro({ id: 1, date: '2027-03-23T22:00:00.000Z', amount });
    const parsed = parseOfferPage(syntheticPage({ UA0000000001: [row('7840'), row('75.50 UAH')] }));
    expect(parsed.entries.map((e) => [e.ref, e.paymentSchedule])).toEqual([['UA0000000001', []]]);
  });
});

describe('parseOfferPage on a state store it never reads', () => {
  it('reads the catalogue past a store whose type it cannot decode', () => {
    const row = astro({ id: 1, date: '2027-03-23T22:00:00.000Z', amount: '7840' });
    const html = syntheticPage({ UA0000000001: [row] }, { siteOnlyStore: true });
    expect(html).toContain('"SiteOnly"');
    expect(parseOfferPage(html).entries.map((e) => e.ref)).toEqual(['UA0000000001']);
  });
});
