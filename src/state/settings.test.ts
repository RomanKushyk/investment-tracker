import { describe, expect, it } from 'vitest';
import { migrateSettings } from './settings';

// v0 payloads are what zustand persisted before `version: 1` landed —
// `{"state":{"currency":…},"version":0}`; migrate receives the `state` part.
describe('migrateSettings', () => {
  it('keeps a valid persisted currency from a v0 payload', () => {
    expect(migrateSettings({ currency: 'USD' })).toEqual({ currency: 'USD' });
    expect(migrateSettings({ currency: 'UAH' })).toEqual({ currency: 'UAH' });
  });

  it('drops unknown fields', () => {
    expect(
      migrateSettings({ currency: 'USD', theme: 'dark', legacy: true }),
    ).toEqual({ currency: 'USD' });
  });

  it('fills defaults for missing or invalid fields', () => {
    expect(migrateSettings({})).toEqual({ currency: 'UAH' });
    expect(migrateSettings({ currency: 'EUR' })).toEqual({ currency: 'UAH' });
    expect(migrateSettings({ currency: 44.83 })).toEqual({ currency: 'UAH' });
  });

  it('falls back to defaults for non-object payloads', () => {
    expect(migrateSettings(undefined)).toEqual({ currency: 'UAH' });
    expect(migrateSettings(null)).toEqual({ currency: 'UAH' });
    expect(migrateSettings('garbage')).toEqual({ currency: 'UAH' });
  });
});
