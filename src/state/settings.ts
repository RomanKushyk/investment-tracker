import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  currency: 'UAH' | 'USD';
  usdRate: number;
  setCurrency: (c: 'UAH' | 'USD') => void;
  setUsdRate: (rate: number) => void;
}

/** The persisted payload — keep in exact sync with `partialize` below. */
export interface PersistedSettings {
  currency: 'UAH' | 'USD';
  usdRate: number;
}

const PERSISTED_DEFAULTS: PersistedSettings = { currency: 'UAH', usdRate: 44.83 };

/**
 * Additive-safe migration (G3): whatever shape is on disk (a v0 payload,
 * hand-edited JSON, a future rollback), pick only the known persisted fields
 * and merge them onto defaults — unknown fields are dropped, missing or
 * invalid ones fall back to their default. Exported pure for unit tests.
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
  };
}

/*
 * ═════════════════════════════════════════════════════════════════════════
 * PERSIST DOCTRINE — G3 (docs/NEXT-PHASE-PLAN.md) / DECISIONS D11
 *
 * 1. EVERY new persisted field MUST be added to `partialize` below IN THE
 *    SAME COMMIT that introduces it — a field missing from `partialize`
 *    silently resets on every reload. Extend `PersistedSettings`,
 *    `PERSISTED_DEFAULTS`, and `migrateSettings` in that same commit.
 * 2. `theme` and `dataset` (landing P5 / P2) MUST stay TOP-LEVEL under
 *    `state` in the persisted JSON: the future index.html head scripts
 *    (FOUC-free theme flip, dataset-at-boot DB selection) read
 *    localStorage['kubushka-settings'] and expect
 *    JSON.parse(raw).state.theme / JSON.parse(raw).state.dataset.
 *    Never nest or rename them.
 * 3. Bump `version` ONLY for an incompatible reshape of the persisted
 *    payload; additive fields never bump — `migrateSettings` + zustand's
 *    merge fill defaults for older payloads.
 * ═════════════════════════════════════════════════════════════════════════
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'UAH',
      usdRate: 44.83,
      setCurrency: (currency) => set({ currency }),
      // Callers validate BEFORE calling (S8: invalid input never writes) —
      // the Settings screen parses via core/schemas.quoteInputSchema.
      setUsdRate: (usdRate) => set({ usdRate }),
    }),
    {
      name: 'kubushka-settings',
      version: 1,
      migrate: migrateSettings,
      partialize: (s) => ({ currency: s.currency, usdRate: s.usdRate }),
    },
  ),
);
