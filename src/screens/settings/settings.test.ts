import { describe, expect, it } from 'vitest';

import { parseLeadDays } from './settings';

describe('parseLeadDays (S8 "Lead time, days")', () => {
  it('accepts whole days inside 1–30, trimmed', () => {
    expect(parseLeadDays('7')).toBe(7);
    expect(parseLeadDays(' 1 ')).toBe(1);
    expect(parseLeadDays('30')).toBe(30);
    expect(parseLeadDays('07')).toBe(7);
  });

  it('rejects everything else — the field errors and nothing is written', () => {
    for (const bad of ['', ' ', '0', '31', '45', '-3', '7.5', '7,5', 'abc', '7d', '1e1']) {
      expect(parseLeadDays(bad)).toBeNull();
    }
  });
});
