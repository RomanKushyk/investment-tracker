import { describe, expect, it } from 'vitest';
import { migrateSettings } from './settings';

// v0 payloads are what zustand persisted before `version: 1` landed —
// `{"state":{"currency":…},"version":0}`; migrate receives the `state` part.
// v0/v1.1 payloads carry no usdRate or dataset — both fill from defaults.
describe('migrateSettings', () => {
  it('keeps a valid persisted currency from a v0 payload', () => {
    expect(migrateSettings({ currency: 'USD' })).toEqual({
      currency: 'USD',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 'UAH' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });

  it('drops unknown fields', () => {
    expect(
      migrateSettings({ currency: 'USD', theme: 'dark', legacy: true }),
    ).toEqual({ currency: 'USD', usdRate: 44.83, dataset: 'demo' });
  });

  it('fills defaults for missing or invalid fields', () => {
    expect(migrateSettings({})).toEqual({ currency: 'UAH', usdRate: 44.83, dataset: 'demo' });
    expect(migrateSettings({ currency: 'EUR' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 44.83 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });

  it('falls back to defaults for non-object payloads', () => {
    expect(migrateSettings(undefined)).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings(null)).toEqual({ currency: 'UAH', usdRate: 44.83, dataset: 'demo' });
    expect(migrateSettings('garbage')).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });

  it('keeps a valid persisted usdRate', () => {
    expect(migrateSettings({ currency: 'UAH', usdRate: 41.2 })).toEqual({
      currency: 'UAH',
      usdRate: 41.2,
      dataset: 'demo',
    });
  });

  it('falls back to the default rate for invalid usdRate values', () => {
    // S8 validity rule: finite number above 0.
    expect(migrateSettings({ currency: 'UAH', usdRate: '44.83' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: 0 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: -5 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: NaN })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ currency: 'UAH', usdRate: Infinity })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });

  it('keeps a persisted live dataset (G4)', () => {
    expect(migrateSettings({ currency: 'UAH', dataset: 'live' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'live',
    });
    expect(migrateSettings({ dataset: 'demo' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });

  it('treats anything but the exact "live" literal as demo (G4, matches lib/db.ts)', () => {
    expect(migrateSettings({ dataset: 'staging' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ dataset: 'LIVE' })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
    expect(migrateSettings({ dataset: 1 })).toEqual({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
    });
  });
});
