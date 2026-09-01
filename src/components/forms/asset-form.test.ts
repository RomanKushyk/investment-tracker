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
      const parsed = assetFormSchema('edit', 'en').safeParse(defaults);
      expect(parsed.success, JSON.stringify(defaults.inzhur)).toBe(true);
      expect(parsed.success && parsed.data.inzhur?.units).toBe(6164);
    });

    // A36 put the two percent fields on this same formatted path, so they join
    // the test that exists because of it. A fractional target is the case the
    // 40/40/17/3 seed cannot show.
    it(`keeps a fractional percent in ${lang}`, () => {
      // `fmt`, not `f`: the module binds `f` to Ukrainian for the whole file, and
      // shadowing it here made the `en` iteration one deletion away from
      // silently asserting Ukrainian output.
      const fmt = makeFormat(lang);
      const asset = { ...linked, expectedPct: 16.4, targetPct: 17.5 };
      const defaults = assetFormDefaults(fmt, asset as never);
      expect(defaults.targetPct).toBe(lang === 'uk' ? '17,5' : '17.5');
      expect(defaults.expectedPct).toBe(lang === 'uk' ? '16,4' : '16.4');
      const parsed = assetFormSchema('edit', 'en').safeParse(defaults);
      expect(parsed.success, JSON.stringify(defaults)).toBe(true);
      expect(parsed.success && parsed.data.targetPct).toBe(17.5);
      expect(parsed.success && parsed.data.expectedPct).toBe(16.4);
    });

    it(`writes a whole percent without a decimal tail in ${lang}`, () => {
      // `f.num` would render "40,00" here and `f.pctPlain` "40,0 %" — the first
      // is noise in an editable field, the second puts a unit inside a field
      // whose label already carries one.
      const defaults = assetFormDefaults(makeFormat(lang), linked as never);
      expect(defaults.targetPct).toBe('40');
      expect(defaults.expectedPct).toBe('14');
    });
  }

  it('survives a three-decimal percent, which is where `units` lost a factor of 1000', () => {
    // uk `f.units(6.164)` is "6,164", which `normalizeNumberInput` reads as a
    // grouped 6164 — an untouched Save would have stored a 1000x yield.
    const defaults = assetFormDefaults(makeFormat('uk'), {
      ...linked,
      expectedPct: 6.164,
    } as never);
    expect(defaults.expectedPct).toBe('6,1640');
    const parsed = assetFormSchema('edit', 'en').safeParse(defaults);
    expect(parsed.success && parsed.data.expectedPct).toBe(6.164);
  });

  it('does not round what the user stored', () => {
    // `pctPlain` rounds to one decimal, so a stored 7,25 would come back as
    // 7,3 and an untouched Save would silently rewrite it.
    const defaults = assetFormDefaults(makeFormat('uk'), { ...linked, targetPct: 7.25 } as never);
    expect(defaults.targetPct).toBe('7,25');
    const parsed = assetFormSchema('edit', 'en').safeParse(defaults);
    expect(parsed.success && parsed.data.targetPct).toBe(7.25);
  });
});
