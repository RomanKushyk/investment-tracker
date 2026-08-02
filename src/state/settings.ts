import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Dataset } from '../core/backup/json';

interface SettingsState {
  currency: 'UAH' | 'USD';
  usdRate: number;
  dataset: Dataset;
  setCurrency: (c: 'UAH' | 'USD') => void;
  setUsdRate: (rate: number) => void;
  setDataset: (d: Dataset) => void;
}

/** The persisted payload — keep in exact sync with `partialize` below. */
export interface PersistedSettings {
  currency: 'UAH' | 'USD';
  usdRate: number;
  dataset: Dataset;
}

const PERSISTED_DEFAULTS: PersistedSettings = {
  currency: 'UAH',
  usdRate: 44.83,
  dataset: 'demo',
};

/**
 * Additive-safe sanitizer (G3): whatever shape is on disk (a v0 payload,
 * hand-edited JSON, a future rollback), pick only the known persisted fields
 * and merge them onto defaults — unknown fields are dropped, missing or
 * invalid ones fall back to their default. Wired as BOTH persist options:
 * `migrate` (zustand calls it only when the stored version differs) and
 * `merge` via mergeSettings below (every rehydrate — without it a tampered
 * same-version payload would hydrate unvalidated). Exported pure for tests.
 */
export function migrateSettings(persisted: unknown): PersistedSettings {
  const p = (
    typeof persisted === 'object' && persisted !== null ? persisted : {}
  ) as Record<string, unknown>;
  return {
    currency:
      p.currency === 'UAH' || p.currency === 'USD'
        ? p.currency
        : PERSISTED_DEFAULTS.currency,
    // Same validity rule as the Settings→Appearance field (S8): a rate is a
    // finite number above 0 — anything else falls back to the default.
    usdRate:
      typeof p.usdRate === 'number' && Number.isFinite(p.usdRate) && p.usdRate > 0
        ? p.usdRate
        : PERSISTED_DEFAULTS.usdRate,
    // G4: anything but the exact 'live' literal means demo — the same rule
    // lib/db.ts applies when it binds the active DB at boot (must agree).
    dataset: p.dataset === 'live' ? 'live' : PERSISTED_DEFAULTS.dataset,
  };
}

/**
 * The persist `merge` option, exported pure for unit tests. zustand runs
 * `migrate` ONLY when the stored version differs from the store's, so a
 * same-version payload (hand-edited localStorage is the shape that matters)
 * would otherwise land in the store unvalidated — e.g. dataset:'garbage'
 * crashing /settings while lib/db.ts independently binds demo via its own
 * exact-'live' rule (D16), or usdRate:0 rendering Infinity. `merge` runs on
 * EVERY rehydrate, migrated or not — routing it through migrateSettings
 * keeps store and DB in agreement on all paths.
 */
export function mergeSettings(persisted: unknown, current: SettingsState): SettingsState {
  return { ...current, ...migrateSettings(persisted) };
}

/*
 * ═════════════════════════════════════════════════════════════════════════
 * PERSIST DOCTRINE — G3 (docs/NEXT-PHASE-PLAN.md) / DECISIONS D11
 *
 * 1. EVERY new persisted field MUST be added to `partialize` below IN THE
 *    SAME COMMIT that introduces it — a field missing from `partialize`
 *    silently resets on every reload. Extend `PersistedSettings`,
 *    `PERSISTED_DEFAULTS`, and `migrateSettings` in that same commit.
 * 2. `theme` (landing P5) and `dataset` MUST stay TOP-LEVEL under `state`
 *    in the persisted JSON: the boot-time readers (P5's FOUC-free theme
 *    head script; lib/db.ts binding the active DB before React exists, G4)
 *    read localStorage['kubushka-settings'] and expect
 *    JSON.parse(raw).state.theme / JSON.parse(raw).state.dataset.
 *    Never nest or rename them.
 * 3. Bump `version` ONLY for an incompatible reshape of the persisted
 *    payload; additive fields never bump — `migrateSettings` + zustand's
 *    merge fill defaults for older payloads.
 * ═════════════════════════════════════════════════════════════════════════
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      currency: 'UAH',
      usdRate: 44.83,
      dataset: 'demo',
      setCurrency: (currency) => set({ currency }),
      // Callers validate BEFORE calling (S8: invalid input never writes) —
      // the Settings screen parses via core/schemas.quoteInputSchema.
      setUsdRate: (usdRate) => set({ usdRate }),
      // G4 reload-on-toggle: persist the flag (zustand writes localStorage
      // synchronously) and reload — lib/db.ts rebinds the whole app to the
      // other dataset's DB at the next boot. Never a live cache migration.
      setDataset: (dataset) => {
        if (get().dataset === dataset) return;
        set({ dataset });
        location.reload();
      },
    }),
    {
      name: 'kubushka-settings',
      version: 1,
      migrate: migrateSettings,
      merge: mergeSettings, // sanitize EVERY hydrate, not only version bumps
      partialize: (s) => ({ currency: s.currency, usdRate: s.usdRate, dataset: s.dataset }),
    },
  ),
);

// Demo-mode guard contract (G4/D16): surfaces that must not operate on the
// demo dataset read this selector and disable themselves when it returns
// 'demo' — P3 Inzhur fetch, P4 file mirror, and the live-only "Erase live
// data" flow. (The dataset can only change together with a full reload, so
// the value is stable for the life of the page.)
export const useDataset = (): Dataset => useSettings((s) => s.dataset);
