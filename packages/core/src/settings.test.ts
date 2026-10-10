import { describe, expect, it } from 'vitest';

import { PERIOD_OPTIONS } from './period';
import { LEAD_DAYS_MAX, LEAD_DAYS_MIN } from './reminders';
import {
  SETTING_NAMES,
  SETTINGS_DEFAULTS,
  patchSettings,
  sanitiseSettings,
  settingsOf,
  type AccountSettings,
} from './settings';

const DEFAULTS: AccountSettings = {
  defaultCurrency: 'UAH',
  language: 'uk',
  autoQuoteSuggest: true,
  couponSuggest: true,
  remindersEnabled: true,
  reminderLeadDays: 7,
  dismissedReminders: [],
  collapsedNavGroups: [],
  sidebarCollapsed: false,
  period: 'all',
};

/** One value each field takes that is not its default, and one it refuses. */
const FIELDS: [name: keyof AccountSettings, ok: unknown, refused: unknown[]][] = [
  ['defaultCurrency', 'USD', ['EUR', 'usd', 44.83, true]],
  ['language', 'en', ['system', 'de', 1, true]],
  ['autoQuoteSuggest', false, ['false', 0, 'yes']],
  ['couponSuggest', false, ['false', 0, 'yes']],
  ['remindersEnabled', false, ['false', 0, 'yes']],
  ['reminderLeadDays', 14, [0, 31, 7.5, '7', Number.NaN, LEAD_DAYS_MIN - 1, LEAD_DAYS_MAX + 1]],
  ['dismissedReminders', ['quote-missing:2026-10-10'], ['a', {}, [1], [null]]],
  ['collapsedNavGroups', ['analytics'], ['a', {}, [1], [null]]],
  ['sidebarCollapsed', true, ['true', 1, 'yes']],
  ['period', '3m', ['1y', 'ALL', 3, ['all']]],
];

describe('the account’s settings', () => {
  it('are these ten fields and no per-device one', () => {
    expect([...SETTING_NAMES]).toEqual([
      'defaultCurrency',
      'language',
      'autoQuoteSuggest',
      'couponSuggest',
      'remindersEnabled',
      'reminderLeadDays',
      'dismissedReminders',
      'collapsedNavGroups',
      'sidebarCollapsed',
      'period',
    ]);
    expect(Object.keys(SETTINGS_DEFAULTS)).toEqual([...SETTING_NAMES]);
    expect(SETTINGS_DEFAULTS).toEqual(DEFAULTS);
    for (const device of ['theme', 'usdRate', 'dataset', 'currency']) {
      expect(SETTING_NAMES).not.toContain(device);
    }
  });

  it('offer every period core lists, so the control and the sanitiser cannot disagree', () => {
    for (const period of PERIOD_OPTIONS) {
      expect(sanitiseSettings({ period }).period).toBe(period);
    }
  });
});

describe('sanitiseSettings, the rule for each field', () => {
  it.each([undefined, null, 42, 'text', true, []])('reads %j as the defaults', (raw) => {
    expect(sanitiseSettings(raw)).toEqual(DEFAULTS);
  });

  it.each(FIELDS)('keeps a valid %s', (name, ok) => {
    expect(sanitiseSettings({ [name]: ok })).toEqual({ ...DEFAULTS, [name]: ok });
  });

  for (const [name, , refused] of FIELDS) {
    it.each(refused)(`reads ${name} as its default when it is %j`, (value) => {
      expect(sanitiseSettings({ [name]: value })).toEqual(DEFAULTS);
    });
  }

  it('keeps the strings of a list and drops the rest', () => {
    expect(
      sanitiseSettings({ dismissedReminders: ['a', 5, null, 'b'], collapsedNavGroups: ['x', {}] }),
    ).toEqual({ ...DEFAULTS, dismissedReminders: ['a', 'b'], collapsedNavGroups: ['x'] });
  });

  it('takes the known fields and drops the rest, a per-device one included', () => {
    const sane = sanitiseSettings({
      period: '1m',
      theme: 'dark',
      usdRate: 40,
      dataset: 'live',
      currency: 'USD',
      accent: 'teal',
    });
    expect(sane).toEqual({ ...DEFAULTS, period: '1m' });
    expect(Object.keys(sane)).toEqual([...SETTING_NAMES]);
  });

  it('answers lists of its own each time, never the defaults’', () => {
    sanitiseSettings({}).dismissedReminders.push('x');
    sanitiseSettings({}).collapsedNavGroups.push('y');
    expect(sanitiseSettings({})).toEqual(DEFAULTS);
    expect(SETTINGS_DEFAULTS).toEqual(DEFAULTS);
  });

  it('does not take a name Object.prototype owns for a field', () => {
    expect(sanitiseSettings(JSON.parse('{"constructor":"x","toString":1}'))).toEqual(DEFAULTS);
  });
});

describe('settingsOf, the column as it reads', () => {
  it('reads NULL as the defaults', () => {
    expect(settingsOf(null)).toEqual(DEFAULTS);
  });

  it.each(['', 'not json', '{"period":', '[]', '7', 'null', '"text"'])(
    'reads the text %j as the defaults',
    (text) => {
      expect(settingsOf(text)).toEqual(DEFAULTS);
    },
  );

  it('lays the stored fields over the defaults and drops what is not a setting', () => {
    expect(settingsOf('{"period":"3m","language":"en","theme":"dark","usdRate":1}')).toEqual({
      ...DEFAULTS,
      period: '3m',
      language: 'en',
    });
  });

  it('reads a stored field it cannot accept as its default, the rest as stored', () => {
    expect(settingsOf('{"period":"1y","language":"en"}')).toEqual({ ...DEFAULTS, language: 'en' });
  });
});

describe('patchSettings merges the fields it names', () => {
  const text = (result: ReturnType<typeof patchSettings>) => {
    if ('issues' in result) throw new Error(`refused: ${JSON.stringify(result.issues)}`);
    return result.text;
  };
  const settings = (result: ReturnType<typeof patchSettings>) => {
    if ('issues' in result) throw new Error(`refused: ${JSON.stringify(result.issues)}`);
    return result.settings;
  };

  it('sets a field on NULL, stores only that field and answers all of them', () => {
    const result = patchSettings(null, { period: '3m' });
    expect(text(result)).toBe('{"period":"3m"}');
    expect(settings(result)).toEqual({ ...DEFAULTS, period: '3m' });
  });

  it('changes the fields it names and leaves the rest as stored', () => {
    const stored = '{"language":"en","sidebarCollapsed":true,"period":"1m"}';
    const result = patchSettings(stored, { period: '3m', couponSuggest: false });
    expect(text(result)).toBe(
      '{"language":"en","couponSuggest":false,"sidebarCollapsed":true,"period":"3m"}',
    );
    expect(settings(result)).toEqual({
      ...DEFAULTS,
      language: 'en',
      couponSuggest: false,
      sidebarCollapsed: true,
      period: '3m',
    });
  });

  it.each(FIELDS)('sets %s to a value it accepts', (name, ok) => {
    expect(settings(patchSettings(null, { [name]: ok }))).toEqual({ ...DEFAULTS, [name]: ok });
  });

  it('resets a field to its default with null and keeps the others', () => {
    const result = patchSettings('{"language":"en","period":"1m"}', { period: null });
    expect(text(result)).toBe('{"language":"en"}');
    expect(settings(result)).toEqual({ ...DEFAULTS, language: 'en' });
  });

  it('stores NULL once no field is set', () => {
    const everything = Object.fromEntries(SETTING_NAMES.map((name) => [name, null]));
    const result = patchSettings('{"language":"en","period":"1m"}', everything);
    expect(text(result)).toBeNull();
    expect(settings(result)).toEqual(DEFAULTS);
  });

  it('changes nothing for an empty patch, and for a null on a field never stored', () => {
    expect(text(patchSettings(null, {}))).toBeNull();
    expect(text(patchSettings(null, { period: null }))).toBeNull();
    expect(text(patchSettings('{"period":"3m"}', {}))).toBe('{"period":"3m"}');
  });

  it('stores a value equal to the default when it is named', () => {
    expect(text(patchSettings(null, { period: 'all' }))).toBe('{"period":"all"}');
  });

  it('writes the fields in the list’s order, whatever order they were stored and named in', () => {
    const result = patchSettings('{"period":"1m","language":"en"}', {
      sidebarCollapsed: true,
      defaultCurrency: 'USD',
    });
    expect(text(result)).toBe(
      '{"defaultCurrency":"USD","language":"en","sidebarCollapsed":true,"period":"1m"}',
    );
  });

  it('leaves a stored value its rule refuses as stored, and answers its default', () => {
    const stored = '{"period":"1y","language":"en","reminderLeadDays":99}';
    const result = patchSettings(stored, {});
    expect(text(result)).toBe('{"language":"en","reminderLeadDays":99,"period":"1y"}');
    expect(settings(result)).toEqual({ ...DEFAULTS, language: 'en' });
  });

  it('writes back what a newer build accepted and this one refuses, whatever field it patches', () => {
    const stored = '{"defaultCurrency":"EUR","language":"pl","period":"2y","futureSetting":true}';
    expect(text(patchSettings(stored, {}))).toBe(stored);
    expect(text(patchSettings(stored, { sidebarCollapsed: true }))).toBe(
      '{"defaultCurrency":"EUR","language":"pl","sidebarCollapsed":true,"period":"2y","futureSetting":true}',
    );
  });

  it('leaves a stored list holding a non-string as stored, where a read keeps its strings', () => {
    const stored = '{"language":"en","dismissedReminders":["a",1]}';
    const result = patchSettings(stored, { period: '3m' });
    expect(text(result)).toBe('{"language":"en","dismissedReminders":["a",1],"period":"3m"}');
    expect(settings(result).dismissedReminders).toEqual(['a']);
  });

  it('replaces or removes a stored value its rule refuses when the patch names the field', () => {
    const stored = '{"period":"1y","language":"pl"}';
    expect(text(patchSettings(stored, { period: '3m' }))).toBe('{"language":"pl","period":"3m"}');
    expect(text(patchSettings(stored, { period: null }))).toBe('{"language":"pl"}');
    expect(text(patchSettings(stored, { period: null, language: null }))).toBeNull();
  });

  it('writes back a stored member no field is for, after the fields, in the order it was stored', () => {
    const stored = '{"zeta":1,"period":"1m","language":"en","alpha":{"on":[true]}}';
    const result = patchSettings(stored, { couponSuggest: false });
    expect(text(result)).toBe(
      '{"language":"en","couponSuggest":false,"period":"1m","zeta":1,"alpha":{"on":[true]}}',
    );
    expect(settings(result)).toEqual({
      ...DEFAULTS,
      language: 'en',
      couponSuggest: false,
      period: '1m',
    });
  });

  it('stores NULL only once no member is left, one no field is for included', () => {
    const everything = Object.fromEntries(SETTING_NAMES.map((name) => [name, null]));
    expect(text(patchSettings('{"language":"en","later":true}', everything))).toBe(
      '{"later":true}',
    );
    expect(text(patchSettings('{"language":"en"}', everything))).toBeNull();
  });

  it('writes back a stored member named like one Object.prototype owns, as an own member', () => {
    const stored = '{"__proto__":{"polluted":1},"constructor":2,"language":"en"}';
    const result = patchSettings(stored, { period: '3m' });
    expect(text(result)).toBe(
      '{"language":"en","period":"3m","__proto__":{"polluted":1},"constructor":2}',
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('starts from nothing when the stored text is not an object', () => {
    for (const stored of ['', 'garbage', '[1]', '7', 'null']) {
      expect(text(patchSettings(stored, { period: '3m' }))).toBe('{"period":"3m"}');
    }
  });

  it('leaves one state however many times the same patch is applied', () => {
    const patch = { period: '6m', dismissedReminders: ['a', 'b'], language: null };
    const once = text(patchSettings('{"language":"en","couponSuggest":false}', patch));
    const twice = text(patchSettings(once, patch));
    expect(twice).toBe(once);
    expect(once).toBe('{"couponSuggest":false,"dismissedReminders":["a","b"],"period":"6m"}');
  });
});

describe('patchSettings refuses what the sanitiser would not keep', () => {
  it.each(['theme', 'usdRate', 'dataset', 'currency', 'accent', 'constructor', 'toString'])(
    'refuses %s, which is no account setting, even to reset it',
    (field) => {
      expect(patchSettings(null, { [field]: 'x' })).toEqual({
        issues: [{ field, code: 'unknown-key' }],
      });
      expect(patchSettings('{"period":"3m"}', { [field]: null })).toEqual({
        issues: [{ field, code: 'unknown-key' }],
      });
    },
  );

  for (const [name, , refused] of FIELDS) {
    it.each(refused)(`refuses ${name} set to %j`, (value) => {
      expect(patchSettings(null, { [name]: value })).toEqual({
        issues: [{ field: name, code: 'invalid' }],
      });
    });
  }

  it('refuses a list with an element that is not a string, where a read keeps the strings', () => {
    expect(patchSettings(null, { dismissedReminders: ['a', 5] })).toEqual({
      issues: [{ field: 'dismissedReminders', code: 'invalid' }],
    });
    expect(sanitiseSettings({ dismissedReminders: ['a', 5] }).dismissedReminders).toEqual(['a']);
  });

  it('names every field it refuses, in the order the patch gave them, and applies none', () => {
    const result = patchSettings('{"language":"en"}', {
      language: 'uk',
      theme: 'dark',
      period: '1y',
      sidebarCollapsed: true,
    });
    expect(result).toEqual({
      issues: [
        { field: 'theme', code: 'unknown-key' },
        { field: 'period', code: 'invalid' },
      ],
    });
  });
});
