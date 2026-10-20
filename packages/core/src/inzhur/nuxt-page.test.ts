// Fixture-driven: the provider's REIT offer page as the Wayback Machine holds it from 2026-05-11, when
// the site was a Nuxt app, trimmed to its state script (*The price archive*).
import { readFileSync } from 'node:fs';

import { stringify } from 'devalue';
import { describe, expect, it } from 'vitest';

import { parseNuxtOfferPage } from './nuxt-page';

const PAGE = readFileSync(
  new URL('./__fixtures__/offer-nuxt-2026-05-11.html', import.meta.url),
  'utf8',
);

const FUND = {
  slug: 'inzhur-reit',
  type: 'fund',
  status: 'active',
  assetDetails: { isin: null, prices: { sellUAH: 10.813, buyUAH: 10.8238, navUAH: 10.7166 } },
};
const BOND = {
  slug: 'ovdp',
  type: 'bond',
  status: 'active',
  assetDetails: {
    isin: 'UA4000236475',
    maturityDate: '2028-09-27',
    prices: { sellUAH: 1060.12, buyUAH: 1060.12, navUAH: 0 },
    returnRates: { buy: 16.3, sell: 16.3 },
    paymentSchedule: [],
  },
};

/** A page whose Nuxt state carries `data` as given, in devalue's flat form as Nuxt writes it. */
const pageWith = (data: Record<string, unknown>) =>
  `<script type="application/json" id="__NUXT_DATA__">${stringify({ data })}</script>`;

describe('parseNuxtOfferPage, over the Nuxt-era offer page', () => {
  it('reads each fund by slug and each bond by ISIN, at the prices the page served', () => {
    const { entries } = parseNuxtOfferPage(PAGE);
    expect(entries.find((e) => e.ref === 'inzhur-reit')).toMatchObject({
      kind: 'fund',
      sellUAH: 10.813,
      buyUAH: 10.8238,
      navUAH: 10.7166,
    });
    expect(entries.find((e) => e.ref === 'UA4000236475')).toMatchObject({
      kind: 'bond',
      sellUAH: 1060.12,
    });
  });

  it('reads every entry the page lists: its six funds, whose isin is null, and 26 bonds', () => {
    const { entries, skipped } = parseNuxtOfferPage(PAGE);
    expect(skipped).toEqual([]);
    expect(entries.filter((e) => e.kind === 'fund').map((e) => e.ref)).toEqual([
      'ocean-plaza',
      '1001',
      'inzhur-reit',
      '2001',
      'inzhur-energy',
      'zhytniy',
    ]);
    expect(entries.filter((e) => e.kind === 'bond')).toHaveLength(26);
  });

  it('reads a fund that carries no isin key at all, as the July page has it', () => {
    const details = { prices: FUND.assetDetails.prices };
    const { entries } = parseNuxtOfferPage(pageWith({ k: [{ ...FUND, assetDetails: details }] }));
    expect(entries).toMatchObject([{ kind: 'fund', ref: 'inzhur-reit', sellUAH: 10.813 }]);
  });

  it('skips a bond with no ISIN rather than keying it by its slug as a fund', () => {
    const unkeyed = { ...BOND, assetDetails: { ...BOND.assetDetails, isin: null } };
    const { entries, skipped } = parseNuxtOfferPage(pageWith({ k: [FUND, unkeyed, BOND] }));
    expect(entries.map((e) => `${e.kind} ${e.ref}`)).toEqual([
      'fund inzhur-reit',
      'bond UA4000236475',
    ]);
    expect(skipped).toEqual([{ ref: 'ovdp', reason: 'no_ref' }]);
  });

  it('skips an entry whose assetDetails is not an object, as the feed parser names it', () => {
    const broken = { slug: 'broken', type: 'fund', assetDetails: null };
    const { entries, skipped } = parseNuxtOfferPage(pageWith({ k: [FUND, broken] }));
    expect(entries.map((e) => e.ref)).toEqual(['inzhur-reit']);
    expect(skipped).toEqual([{ ref: 'broken', reason: 'shape', fields: ['assetDetails'] }]);
  });

  it('hands an array assetDetails to the feed parser too, as a shape it skips', () => {
    const listed = { slug: 'x', type: 'bond', assetDetails: [] };
    expect(parseNuxtOfferPage(pageWith({ k: [FUND, listed] })).skipped).toEqual([
      { ref: 'x', reason: 'shape', fields: ['assetDetails'] },
    ]);
  });

  it('answers each caller with its own result, so one caller’s edit reaches no other', () => {
    const first = parseNuxtOfferPage('');
    first.skipped.length = 0;
    expect(parseNuxtOfferPage('').skipped).toHaveLength(1);
  });

  it('reads no list from a page without the state, without one, or with two', () => {
    const none = { entries: [], skipped: [{ ref: '(root)', reason: 'not_an_array' }] };
    expect(parseNuxtOfferPage('<html><body>no state</body></html>')).toEqual(none);
    expect(parseNuxtOfferPage(pageWith({ k: [{ slug: 'x' }] }))).toEqual(none);
    expect(parseNuxtOfferPage(pageWith({ a: [FUND], b: [BOND] }))).toEqual(none);
    expect(
      parseNuxtOfferPage('<script type="application/json" id="__NUXT_DATA__">{not json</script>'),
    ).toEqual(none);
  });
});
