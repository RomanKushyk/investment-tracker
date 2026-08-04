// The S7 picker's option rows, derived from the trimmed live fixture
// (core/inzhur/__fixtures__/assets-sample.json): funds inzhur-reit /
// inzhur-energy, bonds UA4000238976 (24.03.2027) / UA4000236475 (27.09.2028).
import { describe, expect, it } from 'vitest';

import { parseAssetsFeed } from '../../core/inzhur/parse';
import fixture from '../../core/inzhur/__fixtures__/assets-sample.json';
import { inzhurRefOptions } from './asset-form';

const entries = parseAssetsFeed(fixture).entries;

describe('inzhurRefOptions (S7)', () => {
  it('lists funds as title + slug hint, valued by slug', () => {
    expect(inzhurRefOptions(entries, 'fund', '')).toEqual([
      { value: 'inzhur-reit', label: 'Inzhur REIT', hint: 'inzhur-reit' },
      { value: 'inzhur-energy', label: 'Inzhur Energy', hint: 'inzhur-energy' },
    ]);
  });

  it('lists bonds as ISIN + maturity hint, valued by ISIN', () => {
    expect(inzhurRefOptions(entries, 'bond', '')).toEqual([
      { value: 'UA4000238976', label: 'UA4000238976', hint: 'matures 24.03.2027' },
      { value: 'UA4000236475', label: 'UA4000236475', hint: 'matures 27.09.2028' },
    ]);
  });

  it('keeps an already-linked ref selectable when the feed lacks it', () => {
    const options = inzhurRefOptions(entries, 'bond', ' UA9999999999 ');
    expect(options.at(-1)).toEqual({ value: 'UA9999999999', label: 'UA9999999999' });
    expect(options).toHaveLength(3);
  });

  it('does not duplicate a ref the feed already carries', () => {
    expect(inzhurRefOptions(entries, 'fund', 'inzhur-reit')).toHaveLength(2);
  });

  it('drops the title hint when the feed has no title, and never crashes on an empty feed', () => {
    const untitled = parseAssetsFeed([
      { slug: 'inzhur-x', assetDetails: { prices: { sellUAH: 1 } } },
    ]).entries;
    expect(inzhurRefOptions(untitled, 'fund', '')).toEqual([
      { value: 'inzhur-x', label: 'inzhur-x' },
    ]);
    expect(inzhurRefOptions([], 'bond', '')).toEqual([]);
  });
});
