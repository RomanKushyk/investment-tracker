import { describe, expect, it } from 'vitest';

import { SEED_ASSETS } from '../../lib/seed';
import { allocationRows, rebalancePlan } from './allocation';

const VALUES = { reit: 68702.1, energy: 60086.09, ovdp8976: 15846.3, ovdp6475: 4374.12 };
const TOTAL = 149016.36;

describe('allocationRows', () => {
  const rows = allocationRows(SEED_ASSETS, VALUES, TOTAL);

  it('REIT +6.1pp off-target (severity "off", red even though the sign is positive)', () => {
    const reit = rows.find((r) => r.asset.id === 'reit')!;
    expect(reit.share).toBeCloseTo(46.1, 1);
    expect(reit.deltaPp).toBeCloseTo(6.1, 1);
    expect(reit.severity).toBe('off');
  });

  it('…6475 -0.1pp near-target (severity "near", green) despite the negative sign', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp6475')!;
    expect(b.deltaPp).toBeCloseTo(-0.1, 1);
    expect(b.severity).toBe('near');
  });

  it('Energy +0.3pp near-target', () => {
    const e = rows.find((r) => r.asset.id === 'energy')!;
    expect(e.deltaPp).toBeCloseTo(0.3, 1);
    expect(e.severity).toBe('near');
  });

  it('…8976 -6.4pp off-target', () => {
    const b = rows.find((r) => r.asset.id === 'ovdp8976')!;
    expect(b.deltaPp).toBeCloseTo(-6.4, 1);
    expect(b.severity).toBe('off');
  });
});

describe('rebalancePlan', () => {
  const { actions, withinRange } = rebalancePlan(SEED_ASSETS, VALUES, TOTAL);

  it('buys before sells: …8976 top-up (~+11,429, D5#4) then REIT trim (~-9,095)', () => {
    expect(actions.map((a) => a.asset.id)).toEqual(['ovdp8976', 'reit']);
    expect(actions[0].kind).toBe('buy');
    expect(actions[0].amount).toBeCloseTo(11429.49, 1);
    expect(actions[1].kind).toBe('sell');
    expect(actions[1].amount).toBeGreaterThan(9000);
    expect(actions[1].amount).toBeLessThan(9200);
  });

  it('Energy and …6475 are within range, no action', () => {
    expect(withinRange.map((a) => a.id).sort()).toEqual(['energy', 'ovdp6475']);
  });
});
