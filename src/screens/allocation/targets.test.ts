import { describe, expect, it } from 'vitest';

import { changedTargets, parseTargetPct, sumStatus, targetRowStates, targetsSum } from './targets';
import { makeFormat } from '../../core/money';

// Seed-shaped fixture — the demo targets 40/40/17/3 (D5, navigation-map).
const ASSETS = [
  { id: 'reit', targetPct: 40 },
  { id: 'energy', targetPct: 40 },
  { id: 'ovdp8976', targetPct: 17 },
  { id: 'ovdp6475', targetPct: 3 },
];

describe('parseTargetPct', () => {
  it('reads the comma the way the typist means it (D128 round)', () => {
    // THE WHOLE POINT OF THE `lang` PARAMETER, and it had no coverage: this
    // editor parsed under English grouping while the asset form parsed under the
    // user's, so `17,500` was 17.5 in one door and 17500 — refused by the 100
    // cap — in the other, on one stored field.
    expect(parseTargetPct('17,500', 'uk')).toBeCloseTo(17.5, 4);
    expect(parseTargetPct('17,500', 'en')).toBeNull();
    // The unambiguous shapes still mean the same thing in both.
    expect(parseTargetPct('17,5', 'uk')).toBeCloseTo(17.5, 4);
    expect(parseTargetPct('17.5', 'en')).toBeCloseTo(17.5, 4);
  });

  it('accepts the table grammar: integers, comma or dot decimals, padding', () => {
    expect(parseTargetPct('40', 'en')).toBe(40);
    expect(parseTargetPct('17,5', 'en')).toBe(17.5);
    expect(parseTargetPct('17.5', 'en')).toBe(17.5);
    expect(parseTargetPct(' 40 ', 'en')).toBe(40);
  });

  it('accepts the 0 and 100 boundaries (any 0–100 split is a valid target)', () => {
    expect(parseTargetPct('0', 'en')).toBe(0);
    expect(parseTargetPct('100', 'en')).toBe(100);
  });

  it('rejects empty, non-numeric, negative and >100 input', () => {
    expect(parseTargetPct('', 'en')).toBeNull();
    expect(parseTargetPct('3%', 'en')).toBeNull();
    expect(parseTargetPct('abc', 'en')).toBeNull();
    expect(parseTargetPct('-1', 'en')).toBeNull();
    expect(parseTargetPct('101', 'en')).toBeNull();
  });
});

describe('targetRowStates', () => {
  it('rows without a draft mirror the stored target and are unchanged', () => {
    const rows = targetRowStates(ASSETS, {}, 'en');
    expect(rows).toEqual([
      { id: 'reit', value: 40, effective: 40, changed: false },
      { id: 'energy', value: 40, effective: 40, changed: false },
      { id: 'ovdp8976', value: 17, effective: 17, changed: false },
      { id: 'ovdp6475', value: 3, effective: 3, changed: false },
    ]);
  });

  it('a valid differing draft becomes the effective value and marks the row changed', () => {
    const rows = targetRowStates(ASSETS, { ovdp8976: '9' }, 'en');
    expect(rows[2]).toEqual({ id: 'ovdp8976', value: 9, effective: 9, changed: true });
  });

  it('a valid draft equal to the stored value is not a change', () => {
    const rows = targetRowStates(ASSETS, { reit: '40,0' }, 'en');
    expect(rows[0]).toEqual({ id: 'reit', value: 40, effective: 40, changed: false });
  });

  it('an invalid draft nulls the value but keeps the STORED target effective', () => {
    const rows = targetRowStates(ASSETS, { ovdp6475: '3%' }, 'en');
    expect(rows[3]).toEqual({ id: 'ovdp6475', value: null, effective: 3, changed: false });
  });
});

describe('targetsSum + sumStatus (Σ pill math)', () => {
  it('demo targets 40+40+17+3 sum to exactly 100 → ok', () => {
    const sum = targetsSum(targetRowStates(ASSETS, {}, 'en'));
    expect(sum).toBe(100);
    expect(sumStatus(sum)).toBe('ok');
  });

  it('the S4 warn mock: 40+40+9+stored 3 (invalid "3%" falls back) → Σ 92 → warn', () => {
    const sum = targetsSum(targetRowStates(ASSETS, { ovdp8976: '9', ovdp6475: '3%' }, 'en'));
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
    const rows = targetRowStates(
      ASSETS,
      {
        reit: '40', // unchanged
        energy: '35,5', // changed (comma decimals)
        ovdp8976: 'abc', // invalid — never saved
        ovdp6475: '7', // changed
      },
      'en',
    );
    expect(changedTargets(rows)).toEqual([
      { id: 'energy', targetPct: 35.5 },
      { id: 'ovdp6475', targetPct: 7 },
    ]);
  });

  it('returns an empty list when nothing differs', () => {
    expect(changedTargets(targetRowStates(ASSETS, {}, 'en'))).toEqual([]);
  });
});

describe('A36 — what the editor SHOWS round-trips through what it PARSES', () => {
  // The screen seeds each input with `f.units(asset.targetPct)` and parses the
  // edited string with `parseTargetPct`. Before A36 it seeded with `String()`,
  // so a Ukrainian user was shown "17.5" — a dot this UI uses nowhere else —
  // for a value it would then have to accept back. The seed's 40/40/17/3 are
  // all whole, which is why nothing caught it.
  for (const lang of ['uk', 'en'] as const) {
    it(`accepts back exactly what it displays in ${lang}`, () => {
      const f = makeFormat(lang);
      // 1,234 is the class the first list skipped: in Ukrainian the parser
      // reads it as a grouped thousand, so `units` round-tripped to 1234 and
      // the row rejected text the app itself had printed. `input` verifies.
      for (const v of [0, 3, 17, 17.5, 7.25, 40, 100, 1.234, 6.164]) {
        expect(parseTargetPct(f.input(v), lang), `${v} rendered "${f.input(v)}"`).toBe(v);
      }
    });
  }

  it("still accepts the other language's separator, so a paste is not punished", () => {
    expect(parseTargetPct('17.5', 'en')).toBe(17.5);
    expect(parseTargetPct('17,5', 'en')).toBe(17.5);
  });
});
