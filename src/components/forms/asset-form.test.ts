// The S7 picker's option rows, derived from the trimmed live fixture
// (core/inzhur/__fixtures__/assets-sample.json): funds inzhur-reit /
// inzhur-energy, bonds UA4000238976 (24.03.2027) / UA4000236475 (27.09.2028).
import { describe, expect, it } from 'vitest';

import { makeFormat } from '../../core/money';
import { uk } from '../../i18n/messages';

import { parseAssetsFeed } from '../../core/inzhur/parse';
import fixture from '../../core/inzhur/__fixtures__/assets-sample.json';
import { assetFormSchema } from '../../core/schemas';
import { assetFormDefaults, inzhurRefOptions } from './asset-form';

// The formatter is a parameter now (Contract 0), so these fixtures bind it
// to Ukrainian — the language whose forms these expectations were written in
// and still are: dd.MM.yyyy dates, comma decimals.
const f = makeFormat('uk');
// The whole fixture is Ukrainian — formatter and dictionary together, so the
// dates and the words agree. Mixing them was how the reminder tests ended up
// asserting a combination neither language produces.
const t = uk;

const entries = parseAssetsFeed(fixture).entries;

describe('inzhurRefOptions (S7)', () => {
  it('lists funds as title + slug hint, valued by slug', () => {
    expect(inzhurRefOptions(entries, 'fund', '', f, t)).toEqual([
      { value: 'inzhur-reit', label: 'Inzhur REIT', hint: 'inzhur-reit' },
      { value: 'inzhur-energy', label: 'Inzhur Energy', hint: 'inzhur-energy' },
    ]);
  });

  it('lists bonds as ISIN + maturity hint, valued by ISIN', () => {
    expect(inzhurRefOptions(entries, 'bond', '', f, t)).toEqual([
      { value: 'UA4000238976', label: 'UA4000238976', hint: 'погашення 24.03.2027' },
      { value: 'UA4000236475', label: 'UA4000236475', hint: 'погашення 27.09.2028' },
    ]);
  });

  it('keeps an already-linked ref selectable when the feed lacks it', () => {
    const options = inzhurRefOptions(entries, 'bond', ' UA9999999999 ', f, t);
    expect(options.at(-1)).toEqual({ value: 'UA9999999999', label: 'UA9999999999' });
    expect(options).toHaveLength(3);
  });

  it('does not duplicate a ref the feed already carries', () => {
    expect(inzhurRefOptions(entries, 'fund', 'inzhur-reit', f, t)).toHaveLength(2);
  });

  it('drops the title hint when the feed has no title, and never crashes on an empty feed', () => {
    const untitled = parseAssetsFeed([
      { slug: 'inzhur-x', assetDetails: { prices: { sellUAH: 1 } } },
    ]).entries;
    expect(inzhurRefOptions(untitled, 'fund', '', f, t)).toEqual([
      { value: 'inzhur-x', label: 'inzhur-x' },
    ]);
    expect(inzhurRefOptions([], 'bond', '', f, t)).toEqual([]);
  });
});

describe('assetFormDefaults round-trips through the schema in BOTH languages', () => {
  // The prefill is FORMATTED (Contract 0) and the schema parses that same
  // string back, so the two have to agree in every language. They did not:
  // English formats 6164 units as "6,164", the parser read the comma as a
  // decimal point, and saving an untouched linked asset stored 6.164 units —
  // its value (units x sell price) collapsing by three orders of magnitude.
  const linked = {
    id: 'reit',
    name: 'Inzhur REIT',
    code: 'RE',
    colorKey: 'reit',
    yieldType: 'div_cap',
    expectedPct: 14,
    targetPct: 40,
    payoutSchedule: 'monthly',
    firstPurchase: '2026-02-03',
    inzhur: { kind: 'fund', ref: 'inzhur-reit', units: 6164 },
  } as const;

  for (const lang of ['uk', 'en'] as const) {
    it(`keeps 6164 units in ${lang}`, () => {
      const defaults = assetFormDefaults(makeFormat(lang), linked as never);
      const parsed = assetFormSchema('edit').safeParse(defaults);
      expect(parsed.success, JSON.stringify(defaults.inzhur)).toBe(true);
      expect(parsed.success && parsed.data.inzhur?.units).toBe(6164);
    });
  }
});
