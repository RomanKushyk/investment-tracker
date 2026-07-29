import { describe, expect, it } from 'vitest';

import { xirr } from './xirr';

describe('xirr (WEALTH-MANAGEMENT-ARCHITECTRUE §6.1, ACT/365)', () => {
  it('single buy −1000 held one exact year to value 1080 → 8%', () => {
    const r = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 1080 }, // 365 days → t = 1
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.08, 3);
  });

  it('known multi-flow case (Excel XIRR docs example) → ≈37.336%', () => {
    const r = xirr([
      { date: '2008-01-01', amount: -10000 },
      { date: '2008-03-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2009-04-01', amount: 2750 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0.373362535, 6);
  });

  it('flow order does not matter (earliest date found, not assumed first)', () => {
    const r = xirr([
      { date: '2009-04-01', amount: 2750 },
      { date: '2008-10-30', amount: 4250 },
      { date: '2008-01-01', amount: -10000 },
      { date: '2009-02-15', amount: 3250 },
      { date: '2008-03-01', amount: 2750 },
    ]);
    expect(r!).toBeCloseTo(0.373362535, 6);
  });

  it('negative-return portfolios converge too', () => {
    const r = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 900 }, // exactly one year at −10%
    ]);
    expect(r!).toBeCloseTo(-0.1, 6);
  });

  it('deep-loss roots near the domain floor are still found (−99% in a year)', () => {
    // Root −0.99 is inside (−0.999, 10); a scan that starts above RATE_MIN
    // would never bracket it (verification-round fix, docs/FORMULA-AUDIT.md).
    const r = xirr([
      { date: '2026-01-01', amount: -1000 },
      { date: '2027-01-01', amount: 10 },
    ]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.99, 6);
  });

  it('degenerate inputs → null (empty, single flow, one-signed flows)', () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: '2026-01-01', amount: -1000 }])).toBeNull();
    expect(
      xirr([
        { date: '2026-01-01', amount: -1000 },
        { date: '2027-01-01', amount: -500 },
      ]),
    ).toBeNull();
    expect(
      xirr([
        { date: '2026-01-01', amount: 1000 },
        { date: '2027-01-01', amount: 500 },
      ]),
    ).toBeNull();
  });

  it('zero time span (all flows on one date) → null, not Infinity', () => {
    expect(
      xirr([
        { date: '2026-01-01', amount: -1000 },
        { date: '2026-01-01', amount: 1080 },
      ]),
    ).toBeNull();
  });

  it('unparseable dates → null', () => {
    expect(
      xirr([
        { date: 'not-a-date', amount: -1000 },
        { date: '2027-01-01', amount: 1080 },
      ]),
    ).toBeNull();
  });

  it('rates outside (−0.999, 10) → null instead of numerical noise', () => {
    // ×1000 in a week annualizes far beyond +1000%.
    expect(
      xirr([
        { date: '2026-01-01', amount: -1 },
        { date: '2026-01-08', amount: 1000 },
      ]),
    ).toBeNull();
    // near-total loss in a year annualizes below −99.9%.
    expect(
      xirr([
        { date: '2026-01-01', amount: -1000 },
        { date: '2027-01-01', amount: 0.01 },
      ]),
    ).toBeNull();
  });
});
