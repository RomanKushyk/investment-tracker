import { describe, expect, it } from 'vitest';

import { buildSeedSnapshots, SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import type { Snapshot } from '../../core/types';
import { cumulativeYieldSeries, yieldTableRows } from './yield';

const snaps = buildSeedSnapshots();

describe('yieldTableRows', () => {
  const rows = yieldTableRows(SEED_ASSETS, snaps, SEED_TRANSACTIONS);

  it('REIT: +4.41% total, +9.3% annualized (global 174-day basis), -4.7pp vs expected', () => {
    const reit = rows.find((r) => r.asset.id === 'reit')!;
    expect(reit.deltaTotal).toBeCloseTo(0.0441, 3);
    expect(reit.annualized).toBeCloseTo(0.0925, 3);
    expect(reit.vsExpectedPp).toBeCloseTo(-4.7, 1);
  });

  it('Energy: +1.48% total, +3.1% annualized, -6.9pp vs expected', () => {
    const energy = rows.find((r) => r.asset.id === 'energy')!;
    expect(energy.deltaTotal).toBeCloseTo(0.0148, 3);
    expect(energy.annualized).toBeCloseTo(0.0311, 3);
    expect(energy.vsExpectedPp).toBeCloseTo(-6.9, 1);
  });

  it('…8976: +2.96% total, +6.2% annualized, -10.2pp vs expected', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp8976')!;
    expect(b.deltaTotal).toBeCloseTo(0.0296, 3);
    expect(b.annualized).toBeCloseTo(0.0622, 3);
    expect(b.vsExpectedPp).toBeCloseTo(-10.2, 1);
  });

  it('…6475 uses the GLOBAL portfolio-start basis: +10.9% (NOT +34.5% per-asset basis, D5#5)', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp6475')!;
    expect(b.deltaTotal).toBeCloseTo(0.052, 3);
    expect(b.annualized).toBeCloseTo(0.109, 2);
    expect(b.vsExpectedPp).toBeCloseTo(-4.3, 1);
  });

  it('an asset with no quote yet reports undefined figures instead of a bogus huge negative % (empty-state guard)', () => {
    // No snapshots at all -> every asset is unquoted, even though invested
    // capital exists — must not compute yieldSinceStart(0, invested) = -100%
    // scaled up by the annualization factor.
    const noQuoteRows = yieldTableRows(SEED_ASSETS, [], SEED_TRANSACTIONS);
    for (const r of noQuoteRows) {
      expect(r.value).toBeUndefined();
      expect(r.deltaTotal).toBeUndefined();
      expect(r.annualized).toBeUndefined();
      expect(r.vsExpectedPp).toBeUndefined();
    }
  });

  it('an asset with invested capital but no quote is undefined even when OTHER assets are quoted', () => {
    const onlyReit: Snapshot[] = [{ date: '2026-07-25', cash: 7.75, quotes: { reit: 68629.36 } }];
    const partialRows = yieldTableRows(SEED_ASSETS, onlyReit, SEED_TRANSACTIONS);
    const reit = partialRows.find((r) => r.asset.id === 'reit')!;
    const energy = partialRows.find((r) => r.asset.id === 'energy')!;
    expect(reit.value).toBe(68629.36);
    expect(reit.deltaTotal).toBeDefined();
    expect(energy.value).toBeUndefined();
    expect(energy.deltaTotal).toBeUndefined();
  });
});

describe('cumulativeYieldSeries', () => {
  const series = cumulativeYieldSeries(snaps, SEED_TRANSACTIONS, SEED_ASSETS);

  it('starts at the first snapshot date', () => {
    expect(series[0].date).toBe('2026-02-03');
  });

  it('…6475 has no entry before its 02.06 first purchase', () => {
    const feb = series.find((p) => p.date === '2026-02-10')!;
    expect(feb.ovdp6475).toBeUndefined();
  });

  it('…6475 appears from 02.06 onward', () => {
    const jun2 = series.find((p) => p.date === '2026-06-02')!;
    expect(jun2.ovdp6475).toBeDefined();
  });

  it("reit's series ends at 07.27 matching the table Δ +4.41% (headline uses the partial-row quote)", () => {
    const last = series[series.length - 1];
    expect(last.date).toBe('2026-07-27');
    expect(last.reit).toBeCloseTo(4.41, 1);
    expect(last.energy).toBeUndefined();
  });

  it("energy's last defined point (07.25) matches its table Δ +1.48% (unaffected by the partial row)", () => {
    const jul25 = series.find((p) => p.date === '2026-07-25')!;
    expect(jul25.energy).toBeCloseTo(1.48, 1);
  });
});
