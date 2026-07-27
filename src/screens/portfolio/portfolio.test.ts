import { describe, expect, it } from 'vitest';

import { SEED_ASSETS, SEED_TRANSACTIONS } from '../../lib/seed';
import { bestPerformer, incomeEngine, laggard } from './portfolio';

const VALUES = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };
const INVESTED = { reit: 65800, energy: 59208, ovdp8976: 15390, ovdp6475: 4158 };

describe('bestPerformer', () => {
  it('picks the highest yieldSinceStart — OVDP …6475 +5.20% on seed', () => {
    const r = bestPerformer(SEED_ASSETS, VALUES, INVESTED);
    expect(r?.asset.id).toBe('ovdp6475');
    expect(r?.yield).toBeCloseTo(0.052, 3);
  });
});

describe('laggard', () => {
  it('picks the lowest yieldSinceStart — Inzhur Energy +1.48% on seed', () => {
    const r = laggard(SEED_ASSETS, VALUES, INVESTED);
    expect(r?.asset.id).toBe('energy');
    expect(r?.yield).toBeCloseTo(0.0148, 3);
  });
});

describe('incomeEngine', () => {
  it('picks the asset with the most dividend+coupon income — REIT ₴3,641.44 dividends on seed', () => {
    const r = incomeEngine(SEED_ASSETS, SEED_TRANSACTIONS);
    expect(r?.asset.id).toBe('reit');
    expect(r?.dividends).toBeCloseTo(3641.44, 2);
    expect(r?.coupons).toBe(0);
  });

  it('returns undefined when there is no income history', () => {
    expect(incomeEngine(SEED_ASSETS, [])).toBeUndefined();
  });
});
