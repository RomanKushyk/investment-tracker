// Which /yield windows have no line at all, and what the card says then (#338, the owner's ruling):
// «За цей період жоден актив не має лінії — оберіть довший період.», and under «Від початку», where
// no longer period exists, the first clause alone. An asset has a line when a point carries it.
import { describe, expect, it } from 'vitest';

import { ledgerUnits } from '@quirenote/core/derive';
import { PERIOD_OPTIONS, resolveWindow } from '@quirenote/core/period';
import { SEED_ASSETS, SEED_TRANSACTIONS, buildSeedSnapshots } from '@quirenote/core/seed';
import type { Transaction } from '@quirenote/core/types';
import { cumulativeYieldSeriesIn } from '@quirenote/core/view/yield';
import { en, uk } from '../../i18n/messages';
import { noLineMessage, withLine } from './yield-lines';

const snaps = buildSeedSnapshots();
const START = '2026-02-03';
const LATEST = '2026-07-27';

// #338's sold-out ledger: every seed position sold on 01.07, and no ledger row after that.
const held = ledgerUnits(SEED_TRANSACTIONS, '2026-07-01').units;
const SOLD_OUT: Transaction[] = [
  ...SEED_TRANSACTIONS.filter((t) => t.date <= '2026-07-01'),
  ...SEED_ASSETS.map((a, i) => ({
    id: `sold${i}`,
    date: '2026-07-01',
    type: 'sell' as const,
    assetId: a.id,
    amount: 1000,
    quantity: held[a.id],
  })),
];

describe('withLine', () => {
  it.each(PERIOD_OPTIONS)('on the seed under %s, every asset has a line', (period) => {
    const series = cumulativeYieldSeriesIn(
      snaps,
      SEED_TRANSACTIONS,
      SEED_ASSETS,
      resolveWindow(period, START, LATEST),
    );
    expect(withLine(series, SEED_ASSETS).map((a) => a.id)).toEqual(SEED_ASSETS.map((a) => a.id));
  });

  it('on the sold-out ledger over 10.07–27.07, no asset has one, though the curve has points', () => {
    const series = cumulativeYieldSeriesIn(snaps, SOLD_OUT, SEED_ASSETS, {
      from: '2026-07-10',
      to: LATEST,
      clamped: false,
    });
    expect(series.length).toBeGreaterThan(0);
    expect(withLine(series, SEED_ASSETS)).toEqual([]);
  });

  it('keeps an asset one point carries, and drops one no point carries', () => {
    const series = [
      { date: '2026-07-26', a: 0.4 },
      { date: '2026-07-27', a: 0.5, b: 0 },
    ];
    const assets = ['a', 'b', 'c'].map((id) => ({ ...SEED_ASSETS[0], id }));
    expect(withLine(series, assets).map((a) => a.id)).toEqual(['a', 'b']);
  });
});

describe('noLineMessage', () => {
  it('under «Від початку» reads the first clause alone', () => {
    expect(noLineMessage('all', uk.analytics.yield)).toBe(
      'За цей період жоден актив не має лінії.',
    );
    expect(noLineMessage('all', en.analytics.yield)).toBe('No asset has a line in this period.');
  });

  it.each(PERIOD_OPTIONS.filter((p) => p !== 'all'))('under %s carries the pathway', (period) => {
    expect(noLineMessage(period, uk.analytics.yield)).toBe(
      'За цей період жоден актив не має лінії — оберіть довший період.',
    );
    expect(noLineMessage(period, en.analytics.yield)).toBe(
      'No asset has a line in this period — choose a longer one.',
    );
  });
});
