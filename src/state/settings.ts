import { create } from 'zustand';
import type { PeriodOption } from '@quirenote/core/period';
import { persist } from 'zustand/middleware';

import { DEFAULT_LEAD_DAYS, isLeadDays } from '@quirenote/core/reminders';
import { SETTINGS_DEFAULTS, sanitiseSettings } from '@quirenote/core/settings';
import { SETTINGS_KEY } from '../lib/storage-keys';

/** `system` is a PREFERENCE, never a resolved value — which is what lets an OS flip
 *  reach a user sitting on it without rewriting their stored choice. */
export type Theme = 'light' | 'dark' | 'system';

/**
 * The order both theme controls walk, and the runtime check below reads it rather
 * than repeating its literals. ORDER here, LABELS in the dictionary.
 */
export const THEME_ORDER = ['light', 'dark', 'system'] as const satisfies readonly Theme[];

export const isTheme = (v: unknown): v is Theme => (THEME_ORDER as readonly unknown[]).includes(v);

/**
 * No `system` here, unlike `theme`: language drives every number and date format
 * (Contract 0), so guessing it from the OS rewrites every figure on screen.
 */
export type Language = 'uk' | 'en';

interface SettingsState {
  /** SESSION ONLY, never persisted: the sidebar toggle is a glance, and flipping to
   *  `$` to read one KPI must not outlive the tab. `defaultCurrency` is the
   *  preference. */
  currency: 'UAH' | 'USD';
  defaultCurrency: 'UAH' | 'USD';
  usdRate: number;
  theme: Theme;
  language: Language;
  autoQuoteSuggest: boolean;
  couponSuggest: boolean;
  remindersEnabled: boolean;
  reminderLeadDays: number;
  dismissedReminders: string[];
  /** Which nav groups are CLOSED, by key; empty is all open. PERSISTED, unlike the
   *  currency glance above, on the rule this file applies both times: keep what was
   *  chosen, drop what was passed through. */
  collapsedNavGroups: string[];

  /** Whether the desktop sidebar shows its rail instead of the panel. PERSISTED on the
   *  same rule — a rail is a place, so choosing it is durable. Read only at and above
   *  the breakpoint; below it the drawer is the shell. */
  sidebarCollapsed: boolean;
  /** The window every analytics screen reads. Splitting one control across three
   *  routes is only safe because the selection survives the navigation. */
  period: PeriodOption;
  setCurrency: (c: 'UAH' | 'USD') => void;
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void;
  /** The preference, and it moves the session with it: a default that does not take
   *  effect until the next reload reads as a control that does nothing. The reverse
   *  does not hold. */
  setDefaultCurrency: (c: 'UAH' | 'USD') => void;
  setUsdRate: (rate: number) => void;
  setTheme: (t: Theme) => void;
  setLanguage: (l: Language) => void;
  setAutoQuoteSuggest: (on: boolean) => void;
  setCouponSuggest: (on: boolean) => void;
  setRemindersEnabled: (on: boolean) => void;
  setReminderLeadDays: (days: number) => void;
  dismissReminder: (id: string) => void;
  restoreDismissed: () => void;
  toggleNavGroup: (key: string) => void;
  setPeriod: (p: PeriodOption) => void;
}

export interface PersistedSettings {
  // The DEFAULT, not the live value. Stored under the old `currency` key until the
  // split; `migrateSettings` still reads that key — see the PERMANENT note there.
  defaultCurrency: 'UAH' | 'USD';
  usdRate: number;
  // Doctrine 2 below binds `theme`, and not the `language` after it, to the top level of
  // the persisted JSON.
  theme: Theme;
  // Drives every number and date format, not only the strings: never display-only.
  language: Language;
  autoQuoteSuggest: boolean;
  couponSuggest: boolean;
  remindersEnabled: boolean;
  reminderLeadDays: number;
  // A derived id expires once its occurrence passes out of scope, so this is never
  // pruned — "Restore dismissed" clears it wholesale.
  dismissedReminders: string[];
  collapsedNavGroups: string[];
  sidebarCollapsed: boolean;
  period: PeriodOption;
}

// The account's ten come from core, the rule for each being the one the server runs on a write.
const PERSISTED_DEFAULTS: PersistedSettings = {
  ...SETTINGS_DEFAULTS,
  usdRate: 44.83,
  theme: 'system',
};

/**
 * Additive-safe sanitizer: whatever shape is on disk, take the known fields onto
 * defaults and drop the rest. Wired as BOTH persist options — `mergeSettings` says
 * why. Exported pure for tests.
 */
export function migrateSettings(persisted: unknown): PersistedSettings {
  const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Record<
    string,
    unknown
  >;
  // TWO KEYS READ, ONE WRITTEN, AND THE FALLBACK IS PERMANENT — do not "clean it up"
  // once old localStorage payloads have aged out. The BACKUP FILE format still carries
  // the old `currency` key (`core/backup/json.ts`), deliberately, so every backup ever
  // written restores through this line. Remove it and restore silently falls back.
  return {
    ...sanitiseSettings({ ...p, defaultCurrency: p.defaultCurrency ?? p.currency }),
    usdRate:
      typeof p.usdRate === 'number' && Number.isFinite(p.usdRate) && p.usdRate > 0
        ? p.usdRate
        : PERSISTED_DEFAULTS.usdRate,
    // Must agree with the head script, which cannot import this: an unrecognised value
    // is 'system', never a guess at what the user meant.
    theme: isTheme(p.theme) ? p.theme : PERSISTED_DEFAULTS.theme,
  };
}

/**
 * The persist `merge` option, and why both are wired: `migrate` runs only on a version
 * mismatch, so a hand-edited same-version payload would land unvalidated — a rate of 0
 * putting Infinity in the $ figures. This runs on EVERY rehydrate.
 */
export function mergeSettings(persisted: unknown, current: SettingsState): SettingsState {
  const merged = migrateSettings(persisted);
  // The ONLY place the two are joined on a read path; everything after moves them apart.
  return { ...current, ...merged, currency: merged.defaultCurrency };
}

/*
 * PERSIST DOCTRINE — *Persistence today* in docs/DECISIONS.md.
 *
 * 1. A new persisted field enters `partialize` below IN THE SAME COMMIT that adds it,
 *    alongside the interface, the defaults and the sanitizer. A field missing from
 *    `partialize` silently resets on every reload.
 * 2. `theme` stays TOP-LEVEL under `state`, never nested or renamed: the head script
 *    reads it from localStorage before any module exists.
 * 3. Bump `version` only for an incompatible reshape; additive fields never bump.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currency: 'UAH',
      defaultCurrency: 'UAH',
      usdRate: 44.83,
      theme: 'system',
      language: 'uk',
      autoQuoteSuggest: true,
      couponSuggest: true,
      remindersEnabled: true,
      reminderLeadDays: DEFAULT_LEAD_DAYS,
      dismissedReminders: [],
      collapsedNavGroups: [],
      sidebarCollapsed: false,
      period: 'all',
      setCurrency: (currency) => set({ currency }),
      setDefaultCurrency: (defaultCurrency) => set({ defaultCurrency, currency: defaultCurrency }),
      setUsdRate: (usdRate) => set({ usdRate }),
      // No DOM write — `useTheme` owns the attribute, so there is one writer.
      setTheme: (theme) => set({ theme }),
      // core/money.ts takes the language as a parameter rather than a module global,
      // so every formatted figure re-renders in place with no reload.
      setLanguage: (language) => set({ language }),
      setAutoQuoteSuggest: (autoQuoteSuggest) => set({ autoQuoteSuggest }),
      setCouponSuggest: (couponSuggest) => set({ couponSuggest }),
      setRemindersEnabled: (remindersEnabled) => set({ remindersEnabled }),
      // The store's own floor, matching the sanitizer: a caller that fails it leaves
      // the last valid lead time in effect.
      setReminderLeadDays: (days) => {
        if (isLeadDays(days)) set({ reminderLeadDays: days });
      },
      dismissReminder: (id) =>
        set((s) =>
          s.dismissedReminders.includes(id)
            ? s
            : { dismissedReminders: [...s.dismissedReminders, id] },
        ),
      restoreDismissed: () => set({ dismissedReminders: [] }),
      setPeriod: (period) => set({ period }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleNavGroup: (key) =>
        set((s) => ({
          collapsedNavGroups: s.collapsedNavGroups.includes(key)
            ? s.collapsedNavGroups.filter((k) => k !== key)
            : [...s.collapsedNavGroups, key],
        })),
    }),
    {
      name: SETTINGS_KEY,
      version: 1,
      migrate: migrateSettings,
      merge: mergeSettings, // sanitize EVERY hydrate, not only version bumps
      partialize: (s) => ({
        // `currency` is deliberately NOT here: a field in this object is a field
        // that survives a reload, and the session value must not.
        defaultCurrency: s.defaultCurrency,
        usdRate: s.usdRate,
        theme: s.theme,
        language: s.language,
        autoQuoteSuggest: s.autoQuoteSuggest,
        couponSuggest: s.couponSuggest,
        remindersEnabled: s.remindersEnabled,
        reminderLeadDays: s.reminderLeadDays,
        dismissedReminders: s.dismissedReminders,
        collapsedNavGroups: s.collapsedNavGroups,
        sidebarCollapsed: s.sidebarCollapsed,
        period: s.period,
      }),
    },
  ),
);
