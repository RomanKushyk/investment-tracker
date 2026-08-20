import { describe, expect, it } from 'vitest';

import { changedTargets, parseTargetPct, sumStatus, targetRowStates, targetsSum } from './targets';

// Seed-shaped fixture — the demo targets 40/40/17/3 (D5, navigation-map).
const ASSETS = [
  { id: 'reit', targetPct: 40 },
  { id: 'energy', targetPct: 40 },
  { id: 'ovdp8976', targetPct: 17 },
  { id: 'ovdp6475', targetPct: 3 },
];

describe('parseTargetPct', () => {
  it('accepts the table grammar: integers, comma or dot decimals, padding', () => {
    expect(parseTargetPct('40')).toBe(40);
    expect(parseTargetPct('17,5')).toBe(17.5);
    expect(parseTargetPct('17.5')).toBe(17.5);
    expect(parseTargetPct(' 40 ')).toBe(40);
  });

  it('accepts the 0 and 100 boundaries (any 0–100 split is a valid target)', () => {
    expect(parseTargetPct('0')).toBe(0);
    expect(parseTargetPct('100')).toBe(100);
  });

  it('rejects empty, non-numeric, negative and >100 input', () => {
    expect(parseTargetPct('')).toBeNull();
    expect(parseTargetPct('3%')).toBeNull();
    expect(parseTargetPct('abc')).toBeNull();
    expect(parseTargetPct('-1')).toBeNull();
    expect(parseTargetPct('101')).toBeNull();
  });
});

describe('targetRowStates', () => {
  it('rows without a draft mirror the stored target and are unchanged', () => {
    const rows = targetRowStates(ASSETS, {});
    expect(rows).toEqual([
      { id: 'reit', value: 40, effective: 40, changed: false },
      { id: 'energy', value: 40, effective: 40, changed: false },
      { id: 'ovdp8976', value: 17, effective: 17, changed: false },
      { id: 'ovdp6475', value: 3, effective: 3, changed: false },
    ]);
  });

  it('a valid differing draft becomes the effective value and marks the row changed', () => {
    const rows = targetRowStates(ASSETS, { ovdp8976: '9' });
    expect(rows[2]).toEqual({ id: 'ovdp8976', value: 9, effective: 9, changed: true });
  });

  it('a valid draft equal to the stored value is not a change', () => {
    const rows = targetRowStates(ASSETS, { reit: '40,0' });
    expect(rows[0]).toEqual({ id: 'reit', value: 40, effective: 40, changed: false });
  });

  it('an invalid draft nulls the value but keeps the STORED target effective', () => {
    const rows = targetRowStates(ASSETS, { ovdp6475: '3%' });
    expect(rows[3]).toEqual({ id: 'ovdp6475', value: null, effective: 3, changed: false });
  });
});

describe('targetsSum + sumStatus (Σ pill math)', () => {
  it('demo targets 40+40+17+3 sum to exactly 100 → ok', () => {
    const sum = targetsSum(targetRowStates(ASSETS, {}));
    expect(sum).toBe(100);
    expect(sumStatus(sum)).toBe('ok');
  });

  it('the S4 warn mock: 40+40+9+stored 3 (invalid "3%" falls back) → Σ 92 → warn', () => {
    const sum = targetsSum(targetRowStates(ASSETS, { ovdp8976: '9', ovdp6475: '3%' }));
    expect(sum).toBe(92);
    expect(sumStatus(sum)).toBe('warn');
  });

  it('normalizes float noise: 33.3+33.3+33.4 reads exactly 100 → ok', () => {
    const rows = [{ effective: 33.3 }, { effective: 33.3 }, { effective: 33.4 }];
    expect(targetsSum(rows)).toBe(100);
    expect(sumStatus(targetsSum(rows))).toBe('ok');
  });

  it('a genuine near-miss stays a warn: 33.33×3 → 99.99', () => {
    const rows = [{ effective: 33.33 }, { effective: 33.33 }, { effective: 33.33 }];
    expect(targetsSum(rows)).toBe(99.99);
    expect(sumStatus(targetsSum(rows))).toBe('warn');
  });
});

describe('changedTargets (per-asset save patches)', () => {
  it('emits a patch only for valid rows that differ from the stored value', () => {
    const rows = targetRowStates(ASSETS, {
      reit: '40', // unchanged
      energy: '35,5', // changed (comma decimals)
      ovdp8976: 'abc', // invalid — never saved
      ovdp6475: '7', // changed
    });
    expect(changedTargets(rows)).toEqual([
      { id: 'energy', targetPct: 35.5 },
      { id: 'ovdp6475', targetPct: 7 },
    ]);
  });

  it('returns an empty list when nothing differs', () => {
    expect(changedTargets(targetRowStates(ASSETS, {}))).toEqual([]);
  });
});
