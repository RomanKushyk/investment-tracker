import { create } from 'zustand';
import { PERIOD_OPTIONS, type PeriodOption } from '../core/period';
import { persist } from 'zustand/middleware';

import type { Dataset } from '../core/backup/json';
import { DEFAULT_LEAD_DAYS, isLeadDays } from '../core/reminders';
import { SETTINGS_KEY } from '../lib/storage-keys';

/**
 * Three states, not two (Phase 5 owner decision): `system` is the default and
 * follows the OS live. It is a PREFERENCE, never a resolved value — what the
 * page actually wears is `resolveTheme()`'s answer, stamped on the root as
 * data-theme="light"|"dark". Keeping the two apart is what lets the OS flip
 * reach a user sitting on `system` without their stored choice being rewritten.
 */
export type Theme = 'light' | 'dark' | 'system';

/**
 * Ukrainian is the DEFAULT (Phase 5 owner decision), English stays as the
 * second. Unlike `theme` there is no `system` here: a language is a deliberate
 * choice, and guessing it from the OS would silently re-write every figure on
 * screen (Contract 0) for someone who never asked.
 */
export type Language = 'uk' | 'en';

interface SettingsState {
  /**
   * WHAT THE APP IS SHOWING RIGHT NOW — session only, never persisted (A21).
   *
   * The sidebar toggle writes this and nothing else, because it is a glance:
   * flipping to `$` to read one KPI is not a preference and must not outlive
   * the tab. `defaultCurrency` below is the preference, and this starts each
   * page life as a copy of it (see `mergeSettings`).
   */
  currency: 'UAH' | 'USD';
  /** The persisted preference, applied at app open. Settings writes it. */
  defaultCurrency: 'UAH' | 'USD';
  usdRate: number;
  theme: Theme;
  language: Language;
  dataset: Dataset;
  autoQuoteSuggest: boolean;
  couponSuggest: boolean;
  remindersEnabled: boolean;
  reminderLeadDays: number;
  dismissedReminders: string[];
  /**
   * Which sidebar nav groups are CLOSED, by key (A33). Empty = all open, which
   * is the default and the state the reference draws.
   *
   * PERSISTED, unlike A21's currency glance and unlike `useEditMode` — and the
   * contrast is the point. A nav arrangement is a durable choice someone makes
   * about their own tool; a currency flip to read one KPI is not. One rule both
   * times: keep what was chosen, drop what was passed through.
   */
  collapsedNavGroups: string[];
  /**
   * The window every analytics screen reads (A38, extension D-2). PERSISTED,
   * and it is not a free-standing preference — D-1 DEPENDS on it. Splitting one
   * control across `/overview`, `/yield` and `/seasonality` is only safe
   * because the selection survives the navigation between them; the two
   * decisions are one decision.
   */
  period: PeriodOption;
  /** Session only — the sidebar toggle. Gone on reload, by design. */
  setCurrency: (c: 'UAH' | 'USD') => void;
  /**
   * The preference. Moves the session with it, because a default that does not
   * visibly take effect until the next reload reads as a control that does
   * nothing. The reverse does not hold: a session flip never touches this.
   */
  setDefaultCurrency: (c: 'UAH' | 'USD') => void;
  setUsdRate: (rate: number) => void;
  setTheme: (t: Theme) => void;
  setLanguage: (l: Language) => void;
  setDataset: (d: Dataset) => void;
  setAutoQuoteSuggest: (on: boolean) => void;
  setCouponSuggest: (on: boolean) => void;
  setRemindersEnabled: (on: boolean) => void;
  setReminderLeadDays: (days: number) => void;
  dismissReminder: (id: string) => void;
  restoreDismissed: () => void;
  toggleNavGroup: (key: string) => void;
  setPeriod: (p: PeriodOption) => void;
}

/** The persisted payload — keep in exact sync with `partialize` below. */
export interface PersistedSettings {
  // The DEFAULT, not the live value (A21) — the sidebar toggle's choice is
  // deliberately absent from this payload. Stored under `currency` until
  // 2026-08-18; `migrateSettings` still reads that key, see below.
  defaultCurrency: 'UAH' | 'USD';
  usdRate: number;
  // Appearance (P5 S1). MUST stay top-level under `state` — see doctrine #2:
  // the FOUC-free head script in index.html reads it straight out of
  // localStorage before any module exists.
  theme: Theme;
  // Appearance (P5 S2). Drives BOTH the strings and, per Contract 0, every
  // number and date format — so it is never a display-only preference.
  language: Language;
  dataset: Dataset;
  // Automation (S8): the two suggestion switches, both ON by default — the
  // suggestions are the phase's headline and they never write anything (G5).
  autoQuoteSuggest: boolean;
  couponSuggest: boolean;
  // Reminders (S6/S8): the global gate plus the coupon lead time in days.
  remindersEnabled: boolean;
  reminderLeadDays: number;
  // Derived ids the user dismissed (`coupon:<assetId>:<date>` from the S5 card
  // skip, plus the S6 reminder banners' own ids). Derived ids expire by
  // themselves once the occurrence passes out of scope, so this list needs no
  // pruning — "Restore dismissed" (S8) clears it wholesale.
  dismissedReminders: string[];
  // A33. The standing invariant is that a new persisted field enters
  // `partialize` in the SAME commit — see the doctrine block below.
  collapsedNavGroups: string[];
  // A38, and the same invariant. `state/settings.ts` names `partialize` as the
  // one that gets forgotten, and the extension's D-2 repeats the warning
  // because splitting the control across three screens depends on it.
  period: PeriodOption;
}

const PERSISTED_DEFAULTS: PersistedSettings = {
  defaultCurrency: 'UAH',
  usdRate: 44.83,
  theme: 'system',
  language: 'uk',
  dataset: 'demo',
  autoQuoteSuggest: true,
  couponSuggest: true,
  remindersEnabled: true,
  reminderLeadDays: DEFAULT_LEAD_DAYS,
  dismissedReminders: [],
  collapsedNavGroups: [],
  period: 'all',
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
  const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Record<
    string,
    unknown
  >;
  // TWO KEYS READ, ONE WRITTEN. The field was called `currency` before A21;
  // falling back to it keeps a payload written by any earlier build working,
  // which is why this needed no `version` bump — `merge` routes EVERY hydrate
  // through here, so both shapes are handled on every path rather than only on
  // a version mismatch. The old key is never written back.
  //
  // AND THE FALLBACK IS PERMANENT, NOT TRANSITIONAL — do not "clean it up"
  // once old localStorage payloads have aged out. The BACKUP FILE format still
  // carries `currency` (`core/backup/json.ts`) and was deliberately left
  // alone, so every backup ever written, including the ones written after
  // A21, restores through this line. Removing it would break restore silently:
  // the value would simply fall back to UAH.
  const stored = p.defaultCurrency ?? p.currency;
  return {
    defaultCurrency:
      stored === 'UAH' || stored === 'USD' ? stored : PERSISTED_DEFAULTS.defaultCurrency,
    // Same validity rule as the Settings→Appearance field (S8): a rate is a
    // finite number above 0 — anything else falls back to the default.
    usdRate:
      typeof p.usdRate === 'number' && Number.isFinite(p.usdRate) && p.usdRate > 0
        ? p.usdRate
        : PERSISTED_DEFAULTS.usdRate,
    // Same shape of rule as `dataset` below, and it must agree with the head
    // script's: an unrecognised value is 'system', never a guess at what the
    // user meant. The script cannot import this, so the two are duplicated by
    // necessity — index.html carries a pointer back here.
    theme:
      p.theme === 'light' || p.theme === 'dark' || p.theme === 'system'
        ? p.theme
        : PERSISTED_DEFAULTS.theme,
    // Only the two literals; anything else is the default. No OS sniffing —
    // see the Language type for why.
    language: p.language === 'uk' || p.language === 'en' ? p.language : PERSISTED_DEFAULTS.language,
    // G4: anything but the exact 'live' literal means demo — the same rule
    // lib/db.ts applies when it binds the active DB at boot (must agree).
    dataset: p.dataset === 'live' ? 'live' : PERSISTED_DEFAULTS.dataset,
    autoQuoteSuggest:
      typeof p.autoQuoteSuggest === 'boolean'
        ? p.autoQuoteSuggest
        : PERSISTED_DEFAULTS.autoQuoteSuggest,
    couponSuggest:
      typeof p.couponSuggest === 'boolean' ? p.couponSuggest : PERSISTED_DEFAULTS.couponSuggest,
    remindersEnabled:
      typeof p.remindersEnabled === 'boolean'
        ? p.remindersEnabled
        : PERSISTED_DEFAULTS.remindersEnabled,
    // Same rule as the S8 field (core/reminders.isLeadDays): a whole number of
    // days inside 1–30 — anything else falls back to the default.
    reminderLeadDays: isLeadDays(p.reminderLeadDays)
      ? p.reminderLeadDays
      : PERSISTED_DEFAULTS.reminderLeadDays,
    // Only strings survive: a corrupt entry would otherwise hide banners
    // nothing can restore.
    dismissedReminders: Array.isArray(p.dismissedReminders)
      ? p.dismissedReminders.filter((id): id is string => typeof id === 'string')
      : [...PERSISTED_DEFAULTS.dismissedReminders],
    // Same rule as the list above: only strings survive. An unknown key is
    // harmless — it would collapse a group that does not exist — so there is no
    // whitelist, and a fourth group later needs no migration.
    collapsedNavGroups: Array.isArray(p.collapsedNavGroups)
      ? p.collapsedNavGroups.filter((k): k is string => typeof k === 'string')
      : [...PERSISTED_DEFAULTS.collapsedNavGroups],
    // A WHITELIST HERE, unlike `collapsedNavGroups` three lines above, and the
    // difference is what the value does. An unknown group key collapses a group
    // that does not exist — harmless. An unknown period reaches `resolveWindow`,
    // which switches on the six literals and would fall through to a window
    // nobody chose. So it is validated against the union and falls back to the
    // default, which is also the widest.
    period: PERIOD_OPTIONS.includes(p.period as PeriodOption)
      ? (p.period as PeriodOption)
      : PERSISTED_DEFAULTS.period,
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
  const merged = migrateSettings(persisted);
  // The session starts as a copy of the preference. This is the ONLY place the
  // two are joined on a read path — everything after it can move them apart.
  return { ...current, ...merged, currency: merged.defaultCurrency };
}

/*
 * ═════════════════════════════════════════════════════════════════════════
 * PERSIST DOCTRINE — G3 (docs/plans/NEXT-PHASE-PLAN.md) / DECISIONS D11
 *
 * 1. EVERY new persisted field MUST be added to `partialize` below IN THE
 *    SAME COMMIT that introduces it — a field missing from `partialize`
 *    silently resets on every reload. Extend `PersistedSettings`,
 *    `PERSISTED_DEFAULTS`, and `migrateSettings` in that same commit.
 * 2. `theme` (landing P5) and `dataset` MUST stay TOP-LEVEL under `state`
 *    in the persisted JSON: the boot-time readers (P5's FOUC-free theme
 *    head script; lib/db.ts binding the active DB before React exists, G4)
 *    read localStorage[SETTINGS_KEY] and expect
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
      defaultCurrency: 'UAH',
      usdRate: 44.83,
      theme: 'system',
      language: 'uk',
      dataset: 'demo',
      autoQuoteSuggest: true,
      couponSuggest: true,
      remindersEnabled: true,
      reminderLeadDays: DEFAULT_LEAD_DAYS,
      dismissedReminders: [],
      collapsedNavGroups: [],
      period: 'all',
      setCurrency: (currency) => set({ currency }),
      setDefaultCurrency: (defaultCurrency) => set({ defaultCurrency, currency: defaultCurrency }),
      // Callers validate BEFORE calling (S8: invalid input never writes) —
      // the Settings screen parses via core/schemas.quoteInputSchema.
      setUsdRate: (usdRate) => set({ usdRate }),
      // No reload and no DOM write here: useTheme() owns the attribute, so the
      // store stays a plain preference and there is exactly one writer.
      setTheme: (theme) => set({ theme }),
      // No reload: the brief pins the text swap as INSTANT (Surface 2), which
      // is also why core/money.ts takes the language as a parameter rather than
      // reading a module global — every formatted figure must re-render.
      setLanguage: (language) => set({ language }),
      // G4 reload-on-toggle: persist the flag (zustand writes localStorage
      // synchronously) and reload — lib/db.ts rebinds the whole app to the
      // other dataset's DB at the next boot. Never a live cache migration.
      setDataset: (dataset) => {
        if (get().dataset === dataset) return;
        set({ dataset });
        location.reload();
      },
      // S8 automation switches — no validation to do (a switch is a boolean)
      // and no reload: every surface reads the flag at render time.
      setAutoQuoteSuggest: (autoQuoteSuggest) => set({ autoQuoteSuggest }),
      setCouponSuggest: (couponSuggest) => set({ couponSuggest }),
      setRemindersEnabled: (remindersEnabled) => set({ remindersEnabled }),
      // Callers validate BEFORE calling (S8: an invalid entry never writes —
      // the last valid lead time stays in effect); the guard here is the
      // store's own floor, matching the persist sanitizer.
      setReminderLeadDays: (days) => {
        if (isLeadDays(days)) set({ reminderLeadDays: days });
      },
      // Derived-id dismissals (S5 skip today, S6 banners next). Idempotent: the
      // same occurrence can only be in the list once.
      dismissReminder: (id) =>
        set((s) =>
          s.dismissedReminders.includes(id)
            ? s
            : { dismissedReminders: [...s.dismissedReminders, id] },
        ),
      restoreDismissed: () => set({ dismissedReminders: [] }),
      // Idempotent per key, like `dismissReminder`: a group is in the list once
      // or not at all.
      setPeriod: (period) => set({ period }),
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
        // `currency` is deliberately NOT here — it is the session value, and a
        // field in this object is a field that survives a reload (A21).
        defaultCurrency: s.defaultCurrency,
        usdRate: s.usdRate,
        theme: s.theme,
        language: s.language,
        dataset: s.dataset,
        autoQuoteSuggest: s.autoQuoteSuggest,
        couponSuggest: s.couponSuggest,
        remindersEnabled: s.remindersEnabled,
        reminderLeadDays: s.reminderLeadDays,
        dismissedReminders: s.dismissedReminders,
        collapsedNavGroups: s.collapsedNavGroups,
        period: s.period,
      }),
    },
  ),
);

// Demo-mode guard contract (G4/D16): surfaces that must not operate on the
// demo dataset read this selector and disable themselves when it returns
// 'demo' — P3 Inzhur fetch, P4 file mirror, and the live-only "Erase live
// data" flow. (The dataset can only change together with a full reload, so
// the value is stable for the life of the page.)
export const useDataset = (): Dataset => useSettings((s) => s.dataset);
