import { describe, expect, it } from 'vitest';
import { migrateSettings } from './settings';

// v0 payloads are what zustand persisted before `version: 1` landed —
// `{"state":{"currency":…},"version":0}`; migrate receives the `state` part.
// v0/v1.1 payloads carry no usdRate — it always fills from the default.
describe('migrateSettings', () => {
  it('keeps a valid persisted currency from a v0 payload', () => {
    expect(migrateSettings({ currency: 'USD' })).toEqual({ currency: 'USD', usdRate: 44.83 });
    expect(migrateSettings({ currency: 'UAH' })).toEqual({ currency: 'UAH', usdRate: 44.83 });
  });

  it('drops unknown fields', () => {
    expect(
      migrateSettings({ currency: 'USD', theme: 'dark', legacy: true }),
    ).toEqual({ currency: 'USD', usdRate: 44.83 });
  });

  it('fills defaults for missing or invalid fields', () => {
    expect(migrateSettings({})).toEqual({ currency: 'UAH', usdRate: 44.83 });
    expect(migrateSettings({ currency: 'EUR' })).toEqual({ currency: 'UAH', usdRate: 44.83 });
    expect(migrateSettings({ currency: 44.83 })).toEqual({ currency: 'UAH', usdRate: 44.83 });
  });

  it('falls back to defaults for non-object payloads', () => {
    expect(migrateSettings(undefined)).toEqual({ currency: 'UAH', usdRate: 44.83 });
    expect(migrateSettings(null)).toEqual({ currency: 'UAH', usdRate: 44.83 });
    expect(migrateSettings('garbage')).toEqual({ currency: 'UAH', usdRate: 44.83 });
  });

  it('keeps a valid persisted usdRate', () => {
    expect(migrateSettings({ currency: 'UAH', usdRate: 41.2 })).toEqual({
      currency: 'UAH',
      usdRate: 41.2,
    });
  });

  it('falls back to the default rate for invalid usdRate values', () => {
    // S8 validity rule: finite number above 0.
    expect(migrateSettings({ currency: 'UAH', usdRate: '44.83' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: 0 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: -5 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: NaN })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: Infinity })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
    });
  });
});
