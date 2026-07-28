import { describe, expect, it } from 'vitest';

import { signedPp } from './format';

describe('signedPp', () => {
  it('formats a positive gap with an explicit "+" and 1 decimal', () => {
    expect(signedPp(6.1)).toBe('+6.1');
  });

  it('formats a negative gap with U+2212 (not ASCII hyphen)', () => {
    const result = signedPp(-6.4);
    expect(result).toBe('−6.4');
    expect(result).not.toContain('-'); // ASCII hyphen-minus must not appear
  });

  it('appends an optional suffix (Overview "%", Yield " pp")', () => {
    expect(signedPp(-6.4, '%')).toBe('−6.4%');
    expect(signedPp(-4.7, ' pp')).toBe('−4.7 pp');
  });

  it('defaults to no suffix (Allocation pills)', () => {
    expect(signedPp(-0.1)).toBe('−0.1');
  });

  it('rounds to 1 decimal place', () => {
    expect(signedPp(6.14)).toBe('+6.1');
    expect(signedPp(6.16)).toBe('+6.2');
  });
});
