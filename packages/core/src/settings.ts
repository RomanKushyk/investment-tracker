// The account's settings: the choices that follow a person from device to device, and the one rule
// for each (*Persistence today*). The server keeps them as one JSON text on `app_user` and the app
// reads its persisted copy through the same rules, so a value a write accepts is read back as
// written. Plain TypeScript, no schema library: the app's first render imports it.
import { PERIOD_OPTIONS, type PeriodOption } from './period';
import { DEFAULT_LEAD_DAYS, isLeadDays } from './reminders';

export const CURRENCIES = ['UAH', 'USD'] as const;
export const LANGUAGES = ['uk', 'en'] as const;

export interface AccountSettings {
  defaultCurrency: (typeof CURRENCIES)[number];
  language: (typeof LANGUAGES)[number];
  autoQuoteSuggest: boolean;
  couponSuggest: boolean;
  remindersEnabled: boolean;
  reminderLeadDays: number;
  dismissedReminders: string[];
  collapsedNavGroups: string[];
  sidebarCollapsed: boolean;
  period: PeriodOption;
}

/** `accepts` is the field's rule. `salvage` is what a READ keeps of a value the rule refuses, where
 *  something of it is worth keeping: the strings of a list. A write salvages nothing: a patched value
 *  is accepted whole or refused, and a stored one is kept as stored. */
type Rule<T> = {
  fallback: T;
  accepts: (value: unknown) => value is T;
  salvage?: (value: unknown) => T | undefined;
};

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter(isString) : undefined;
/** A literal is matched whole: `uk-UA` is not `uk`, and `ALL` is not `all`. */
const oneOf =
  <T extends string>(allowed: readonly T[]) =>
  (value: unknown): value is T =>
    allowed.includes(value as T);

// The fields in the order they are stored in. Every field is declared here, so the compiler asks for
// the rule of a new one.
const RULES: { [K in keyof AccountSettings]: Rule<AccountSettings[K]> } = {
  defaultCurrency: { fallback: 'UAH', accepts: oneOf(CURRENCIES) },
  // No `system`: the language drives every number and date format (*Language, numbers, fonts*).
  language: { fallback: 'uk', accepts: oneOf(LANGUAGES) },
  autoQuoteSuggest: { fallback: true, accepts: isBoolean },
  couponSuggest: { fallback: true, accepts: isBoolean },
  remindersEnabled: { fallback: true, accepts: isBoolean },
  reminderLeadDays: { fallback: DEFAULT_LEAD_DAYS, accepts: isLeadDays },
  // Never pruned: an id expires once its occurrence leaves the walk, and a corrupt entry would hide
  // a banner nothing can restore, so only strings survive a read.
  dismissedReminders: { fallback: [], accepts: isStrings, salvage: strings },
  // No whitelist: an unknown group key collapses a group that does not exist, and nothing else.
  collapsedNavGroups: { fallback: [], accepts: isStrings, salvage: strings },
  sidebarCollapsed: { fallback: false, accepts: isBoolean },
  // A whitelist, unlike the nav groups: an unknown period would reach `resolveWindow`.
  period: { fallback: 'all', accepts: oneOf(PERIOD_OPTIONS) },
};

export const SETTING_NAMES = Object.keys(RULES) as (keyof AccountSettings)[];

/** Read, never written: a list is copied on the way out. */
export const SETTINGS_DEFAULTS: Readonly<AccountSettings> = Object.freeze(
  Object.fromEntries(
    SETTING_NAMES.map((name) => [name, RULES[name].fallback]),
  ) as unknown as AccountSettings,
);

const isName = (field: string): field is keyof AccountSettings => Object.hasOwn(RULES, field);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The fields of `raw` the rules keep, as it names them and no others. */
function explicit(raw: unknown): Partial<AccountSettings> {
  const kept: Record<string, unknown> = {};
  if (!isObject(raw)) return kept as Partial<AccountSettings>;
  for (const name of SETTING_NAMES) {
    if (!Object.hasOwn(raw, name)) continue;
    const rule: Rule<unknown> = RULES[name];
    const value = raw[name];
    const sane = rule.accepts(value) ? value : rule.salvage?.(value);
    if (sane !== undefined) kept[name] = sane;
  }
  return kept as Partial<AccountSettings>;
}

/** Whatever shape is on disk, the known fields onto the defaults and the rest dropped, so the
 *  person's choices survive a build that knows more or fewer fields. */
export function sanitiseSettings(raw: unknown): AccountSettings {
  // A list is copied, so nobody holds the defaults' own.
  const defaults = Object.fromEntries(
    SETTING_NAMES.map((name) => {
      const value = SETTINGS_DEFAULTS[name];
      return [name, Array.isArray(value) ? [...value] : value];
    }),
  ) as unknown as AccountSettings;
  return { ...defaults, ...explicit(raw) };
}

const parsed = (stored: string | null): unknown => {
  if (stored === null) return undefined;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
};

/** The column as it reads: NULL, and text that is no object of settings, as the defaults. */
export function settingsOf(stored: string | null): AccountSettings {
  return sanitiseSettings(parsed(stored));
}

/** A field a patch cannot apply, by its name and a code, never prose. */
export interface SettingsIssue {
  field: string;
  code: 'unknown-key' | 'invalid';
}

/** `text` is what the column holds afterwards: NULL once it holds no member. */
export type Patched =
  { text: string | null; settings: AccountSettings } | { issues: SettingsIssue[] };

/**
 * RFC 7396 over the stored members: a field the patch names takes its value, `null` removes it, one
 * it leaves out stays as it was. A patch is applied whole or refused whole, and refuses a name that
 * is no account setting (a theme, a rate, a dataset) even to reset it, and a value its field's rule
 * does not accept: unlike a read, a write salvages nothing. The text is written in the fields' own
 * order, so it is the same for the same settings however they were reached. A stored member the
 * patch does not name stays as it was, a value its field's rule refuses and a member no field is for
 * included, the latter after the fields: a build that accepts less, or knows fewer fields, than
 * the one that wrote them deletes nothing it wrote.
 */
export function patchSettings(stored: string | null, patch: Record<string, unknown>): Patched {
  const issues: SettingsIssue[] = [];
  for (const [field, value] of Object.entries(patch)) {
    if (!isName(field)) issues.push({ field, code: 'unknown-key' });
    else if (value !== null && !RULES[field].accepts(value))
      issues.push({ field, code: 'invalid' });
  }
  if (issues.length > 0) return { issues };

  const current = parsed(stored);
  const merged: Record<string, unknown> = isObject(current) ? current : {};
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) delete merged[field];
    else merged[field] = value;
  }
  const fields = SETTING_NAMES.filter((name) => Object.hasOwn(merged, name)).map((name) => [
    name,
    merged[name],
  ]);
  const others = Object.entries(merged).filter(([name]) => !isName(name));
  // `fromEntries`, not an assignment: a member named `__proto__` is kept as an own member.
  const members = Object.fromEntries([...fields, ...others]);
  return {
    text: Object.keys(members).length === 0 ? null : JSON.stringify(members),
    settings: sanitiseSettings(members),
  };
}
