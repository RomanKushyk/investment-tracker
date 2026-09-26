import { describe, expect, it } from 'vitest';

import { MAX_ADDRESS, canonicalAddress } from './address';

describe('canonicalAddress', () => {
  it('trims and folds an address it accepts', () => {
    expect(canonicalAddress('  Name.Surname@Example.COM ')).toBe('name.surname@example.com');
  });

  it('refuses what the cluster would not store', () => {
    expect(canonicalAddress('')).toBeUndefined();
    expect(canonicalAddress('name@localhost')).toBeUndefined();
    expect(canonicalAddress('імʼя@example.com')).toBeUndefined();
    expect(canonicalAddress(42)).toBeUndefined();
  });

  it('refuses past the octet ceiling, however well formed', () => {
    const at = '@example.com';
    const local = 'a'.repeat(MAX_ADDRESS - at.length);
    expect(canonicalAddress(`${local}${at}`)).toBe(`${local}${at}`);
    expect(canonicalAddress(`a${local}${at}`)).toBeUndefined();
  });
});
