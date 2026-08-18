import { describe, expect, it } from 'vitest';
import { mergeSettings, migrateSettings, useSettings, type PersistedSettings } from './settings';

// The full persisted shape at its defaults — spread into every expectation so a
// new field (P3 added the two automation switches + dismissedReminders) does not
// rewrite twenty assertions.
const DEFAULTS: PersistedSettings = {
  defaultCurrency: 'UAH',
  usdRate: 44.83,
  theme: 'system',
  language: 'uk',
  dataset: 'demo',
  autoQuoteSuggest: true,
  couponSuggest: true,
  remindersEnabled: true,
  reminderLeadDays: 7,
  dismissedReminders: [],
};

// v0 payloads are what zustand persisted before `version: 1` landed —
// `{"state":{"currency":…},"version":0}`; migrate receives the `state` part.
// v0/v1.1 payloads carry no usdRate or dataset — both fill from defaults.
//
// NOTE ON THE `currency` KEY BELOW. Every payload in this file writes it, and
// since A21 that is the LEGACY key: the field is persisted as
// `defaultCurrency` now. They are left as they are on purpose — read this way,
// each one doubles as a check that a payload written by any pre-A21 build
// still hydrates, which is the compatibility that let the split ship without a
// `version` bump.
describe('migrateSettings', () => {
  it('keeps a valid persisted currency from a v0 payload', () => {
    expect(migrateSettings({ currency: 'USD' })).toEqual({ ...DEFAULTS, defaultCurrency: 'USD' });
    expect(migrateSettings({ currency: 'UAH' })).toEqual({ ...DEFAULTS, defaultCurrency: 'UAH' });
  });

  it('reads the current key, and prefers it over the legacy one', () => {
    expect(migrateSettings({ defaultCurrency: 'USD' })).toEqual({
      ...DEFAULTS,
      defaultCurrency: 'USD',
    });
    // Both present is only reachable by a hand-edited payload or a rollback and
    // back again. The current key wins — the legacy one is a fallback, not a
    // second source of truth.
    expect(migrateSettings({ defaultCurrency: 'USD', currency: 'UAH' })).toEqual({
      ...DEFAULTS,
      defaultCurrency: 'USD',
    });
  });

  it('never writes the legacy key back', () => {
    expect(migrateSettings({ currency: 'USD' })).not.toHaveProperty('currency');
  });

  it('does not persist the session value', () => {
    // The live value is outside `partialize`, so it can never appear in a
    // payload — and if one carries it anyway (hand-edited), it is an unknown
    // field and is dropped like any other.
    expect(migrateSettings({ defaultCurrency: 'UAH', currency: 'USD' })).toEqual(DEFAULTS);
  });

  it('drops unknown fields', () => {
    // This case used `theme: 'dark'` as its example of a field that does not
    // exist — until P5 made it one that does. Swapped for fields that are
    // still genuinely unknown, so the test keeps testing what it claims to.
    expect(migrateSettings({ defaultCurrency: 'USD', accent: 'teal', legacy: true })).toEqual({
      ...DEFAULTS,
      defaultCurrency: 'USD',
    });
  });

  it('fills defaults for missing or invalid fields', () => {
    expect(migrateSettings({})).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 'EUR' })).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 44.83 })).toEqual(DEFAULTS);
  });

  it('falls back to defaults for non-object payloads', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULTS);
    expect(migrateSettings(null)).toEqual(DEFAULTS);
    expect(migrateSettings('garbage')).toEqual(DEFAULTS);
  });

  it('keeps a valid persisted usdRate', () => {
    expect(migrateSettings({ currency: 'UAH', usdRate: 41.2 })).toEqual({
      ...DEFAULTS,
      usdRate: 41.2,
    });
  });

  it('falls back to the default rate for invalid usdRate values', () => {
    // S8 validity rule: finite number above 0.
    expect(migrateSettings({ currency: 'UAH', usdRate: '44.83' })).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 'UAH', usdRate: 0 })).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 'UAH', usdRate: -5 })).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 'UAH', usdRate: NaN })).toEqual(DEFAULTS);
    expect(migrateSettings({ currency: 'UAH', usdRate: Infinity })).toEqual(DEFAULTS);
  });

  it('keeps each of the three themes, and defaults to system', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      expect(migrateSettings({ theme })).toEqual({ ...DEFAULTS, theme });
    }
    // Absent is the case that matters most: every profile written before P5
    // has no `theme` at all, and those users must land on `system` rather than
    // on whichever literal happened to be first in the check.
    expect(migrateSettings({ currency: 'UAH' })).toEqual(DEFAULTS);
  });

  it('falls back to system for any theme it does not recognise', () => {
    // The head script in index.html applies the identical rule; that the two
    // agree on every one of these is pinned by src/app/theme.test.ts.
    for (const theme of ['solarized', '', 'Light', 'DARK', 3, null, {}, []]) {
      expect(migrateSettings({ theme })).toEqual(DEFAULTS);
    }
  });

  it('keeps either language, and defaults to Ukrainian', () => {
    for (const language of ['uk', 'en'] as const) {
      expect(migrateSettings({ language })).toEqual({ ...DEFAULTS, language });
    }
    // Every profile written before P5 has no `language`, and those users must
    // land on the owner-chosen default rather than on whichever literal came
    // first in the check.
    expect(migrateSettings({ currency: 'UAH' })).toEqual(DEFAULTS);
  });

  it('falls back to Ukrainian for any language it does not recognise', () => {
    // No OS sniffing and no partial matching: `uk-UA` is not `uk` here, because
    // accepting near-misses is how a locale string ends up in a union type.
    for (const language of ['uk-UA', 'en-GB', 'ua', 'UK', '', 3, null, {}, []]) {
      expect(migrateSettings({ language })).toEqual(DEFAULTS);
    }
  });

  it('keeps a persisted live dataset (G4)', () => {
    expect(migrateSettings({ currency: 'UAH', dataset: 'live' })).toEqual({
      ...DEFAULTS,
      dataset: 'live',
    });
    expect(migrateSettings({ dataset: 'demo' })).toEqual(DEFAULTS);
  });

  it('treats anything but the exact "live" literal as demo (G4, matches lib/db.ts)', () => {
    expect(migrateSettings({ dataset: 'staging' })).toEqual(DEFAULTS);
    expect(migrateSettings({ dataset: 'LIVE' })).toEqual(DEFAULTS);
    expect(migrateSettings({ dataset: 1 })).toEqual(DEFAULTS);
  });

  // P3 feat/fixed-yield (S8): both switches default ON, and a v1 payload from
  // before them (the shape on every existing profile) must hydrate to ON.
  it('defaults the automation switches ON and keeps an explicit OFF', () => {
    expect(migrateSettings({ currency: 'UAH', usdRate: 44.83, dataset: 'demo' })).toEqual(DEFAULTS);
    expect(migrateSettings({ autoQuoteSuggest: false, couponSuggest: false })).toEqual({
      ...DEFAULTS,
      autoQuoteSuggest: false,
      couponSuggest: false,
    });
  });

  it('ignores non-boolean switch values', () => {
    expect(migrateSettings({ autoQuoteSuggest: 'false', couponSuggest: 0 })).toEqual(DEFAULTS);
  });

  // P3 feat/reminders (S8): the reminders gate defaults ON and the lead time to
  // 7 days — a v1 payload from before them (every existing profile) must
  // hydrate to exactly that.
  it('defaults the reminders gate ON and the lead time to 7', () => {
    expect(migrateSettings({ autoQuoteSuggest: true, couponSuggest: true })).toEqual(DEFAULTS);
    expect(migrateSettings({ remindersEnabled: false, reminderLeadDays: 14 })).toEqual({
      ...DEFAULTS,
      remindersEnabled: false,
      reminderLeadDays: 14,
    });
    expect(migrateSettings({ reminderLeadDays: 1 })).toEqual({ ...DEFAULTS, reminderLeadDays: 1 });
    expect(migrateSettings({ reminderLeadDays: 30 })).toEqual({ ...DEFAULTS, reminderLeadDays: 30 });
  });

  it('falls back to the default lead time for values outside 1–30 integers', () => {
    for (const bad of [0, 31, 7.5, -3, '7', NaN, Infinity, null]) {
      expect(migrateSettings({ reminderLeadDays: bad })).toEqual(DEFAULTS);
    }
    expect(migrateSettings({ remindersEnabled: 'yes' })).toEqual(DEFAULTS);
  });

  it('keeps dismissed reminder ids and drops non-string entries', () => {
    expect(migrateSettings({ dismissedReminders: ['coupon:ovdp8976:2026-08-25'] })).toEqual({
      ...DEFAULTS,
      dismissedReminders: ['coupon:ovdp8976:2026-08-25'],
    });
    expect(migrateSettings({ dismissedReminders: ['a', 3, null, { id: 'b' }] })).toEqual({
      ...DEFAULTS,
      dismissedReminders: ['a'],
    });
    expect(migrateSettings({ dismissedReminders: 'coupon:x:2026-01-01' })).toEqual(DEFAULTS);
  });
});

// The persist `merge` option (mergeSettings): zustand runs `migrate` ONLY
// when the stored version differs from the store's, so same-version payloads
// reach the store exclusively through `merge` — it must apply the same
// sanitization (a hand-edited v1 payload is the shape that matters: lib/db.ts
// would bind demo via its own exact-'live' rule while an unsanitized store
// hydrated dataset:'garbage' / usdRate:0 → /settings crash, Infinity in $
// figures). Pure tests per D4; the option wiring is one declarative line,
// same trust level as `migrate: migrateSettings` above.
describe('mergeSettings (persist merge — runs on every rehydrate)', () => {
  const current = useSettings.getInitialState();

  it('sanitizes a tampered same-version (v1) payload', () => {
    const merged = mergeSettings(
      { currency: 'UAH', usdRate: 0, dataset: 'garbage', autoQuoteSuggest: 'yes' },
      current,
    );
    expect(merged.dataset).toBe('demo'); // exact-'live' rule (G4/D16)
    expect(merged.usdRate).toBe(44.83); // S8 rule: finite and > 0
    expect(merged.currency).toBe('UAH');
    expect(merged.autoQuoteSuggest).toBe(true); // non-boolean → default ON
  });

  it('sanitizes a tampered lead time', () => {
    expect(mergeSettings({ reminderLeadDays: 90 }, current).reminderLeadDays).toBe(7);
    expect(mergeSettings({ reminderLeadDays: 21 }, current).reminderLeadDays).toBe(21);
  });

  it('keeps a valid persisted payload intact', () => {
    const merged = mergeSettings(
      {
        currency: 'USD',
        usdRate: 41.2,
        dataset: 'live',
        couponSuggest: false,
        dismissedReminders: ['coupon:ovdp8976:2026-08-25'],
      },
      current,
    );
    expect(merged.dataset).toBe('live');
    expect(merged.usdRate).toBe(41.2);
    expect(merged.currency).toBe('USD');
    expect(merged.couponSuggest).toBe(false);
    expect(merged.dismissedReminders).toEqual(['coupon:ovdp8976:2026-08-25']);
  });

  it('preserves the non-persisted store surface (actions)', () => {
    const merged = mergeSettings({ dataset: 'live' }, current);
    expect(merged.setCurrency).toBe(current.setCurrency);
    expect(merged.setUsdRate).toBe(current.setUsdRate);
    expect(merged.setDataset).toBe(current.setDataset);
    expect(merged.setAutoQuoteSuggest).toBe(current.setAutoQuoteSuggest);
    expect(merged.setCouponSuggest).toBe(current.setCouponSuggest);
    expect(merged.setRemindersEnabled).toBe(current.setRemindersEnabled);
    expect(merged.setReminderLeadDays).toBe(current.setReminderLeadDays);
    expect(merged.dismissReminder).toBe(current.dismissReminder);
    expect(merged.restoreDismissed).toBe(current.restoreDismissed);
  });
});

// The automation actions themselves (G3/D11: a persisted field lands with its
// store test in the same commit).
describe('automation actions', () => {
  it('flips the suggestion switches', () => {
    useSettings.getState().setAutoQuoteSuggest(false);
    useSettings.getState().setCouponSuggest(false);
    expect(useSettings.getState().autoQuoteSuggest).toBe(false);
    expect(useSettings.getState().couponSuggest).toBe(false);
    useSettings.getState().setAutoQuoteSuggest(true);
    useSettings.getState().setCouponSuggest(true);
    expect(useSettings.getState().autoQuoteSuggest).toBe(true);
    expect(useSettings.getState().couponSuggest).toBe(true);
  });

  it('flips the reminders gate and takes only valid lead times', () => {
    useSettings.getState().setRemindersEnabled(false);
    expect(useSettings.getState().remindersEnabled).toBe(false);
    useSettings.getState().setRemindersEnabled(true);
    expect(useSettings.getState().remindersEnabled).toBe(true);

    useSettings.getState().setReminderLeadDays(21);
    expect(useSettings.getState().reminderLeadDays).toBe(21);
    // The store's own floor: an invalid value never lands (S8 — the last valid
    // lead time stays in effect while the field shows its error).
    useSettings.getState().setReminderLeadDays(0);
    useSettings.getState().setReminderLeadDays(31);
    useSettings.getState().setReminderLeadDays(7.5);
    expect(useSettings.getState().reminderLeadDays).toBe(21);
    useSettings.getState().setReminderLeadDays(7);
  });

  it('dismisses an occurrence once and restores every dismissal', () => {
    const id = 'coupon:ovdp8976:2026-08-25';
    useSettings.getState().dismissReminder(id);
    useSettings.getState().dismissReminder(id); // idempotent — one entry only
    expect(useSettings.getState().dismissedReminders).toEqual([id]);
    useSettings.getState().dismissReminder('coupon:ovdp6475:2026-12-03');
    expect(useSettings.getState().dismissedReminders).toHaveLength(2);
    useSettings.getState().restoreDismissed();
    expect(useSettings.getState().dismissedReminders).toEqual([]);
  });
});

// A21 — the sidebar toggle is a glance and the Settings control is a
// preference. They were ONE field until 2026-08-18, so these tests exist to
// keep them apart: the interesting assertions are the ones about what does NOT
// happen.
describe('currency: the session value and the persisted default', () => {
  const reset = () => {
    useSettings.setState({ currency: 'UAH', defaultCurrency: 'UAH' });
  };

  it('setCurrency moves the view and leaves the preference alone', () => {
    reset();
    useSettings.getState().setCurrency('USD');
    expect(useSettings.getState().currency).toBe('USD');
    expect(useSettings.getState().defaultCurrency).toBe('UAH');
  });

  it('setDefaultCurrency moves both, so the control is not inert until reload', () => {
    reset();
    useSettings.getState().setDefaultCurrency('USD');
    expect(useSettings.getState().defaultCurrency).toBe('USD');
    expect(useSettings.getState().currency).toBe('USD');
  });

  it('a sidebar flip does not survive a rehydrate', () => {
    reset();
    useSettings.getState().setCurrency('USD'); // the glance
    // What zustand would write and read back: the persisted payload holds the
    // preference only, so the session starts over from it.
    const merged = mergeSettings({ defaultCurrency: 'UAH' }, useSettings.getState());
    expect(merged.currency).toBe('UAH');
    expect(merged.defaultCurrency).toBe('UAH');
  });

  it('a Settings change does survive a rehydrate', () => {
    reset();
    useSettings.getState().setDefaultCurrency('USD');
    const merged = mergeSettings({ defaultCurrency: 'USD' }, useSettings.getState());
    expect(merged.currency).toBe('USD');
    expect(merged.defaultCurrency).toBe('USD');
  });

  it('rehydrating overrides a session value the store already had', () => {
    // The order matters: `merge` receives the CURRENT store (whose `currency`
    // is the initial 'UAH', or whatever a same-tab flip left) and must not let
    // it win over the payload. This is the assertion that would catch a naive
    // `{ ...current, ...persisted }` losing the join.
    useSettings.setState({ currency: 'USD', defaultCurrency: 'USD' });
    const merged = mergeSettings({ defaultCurrency: 'UAH' }, useSettings.getState());
    expect(merged.currency).toBe('UAH');
    reset();
  });
});
