import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { migrateSettings } from '../state/settings';
import { resolveTheme } from './theme';

// The FOUC-free boot in index.html has to duplicate two things it cannot
// import — the storage key and the light/dark/system validity rule — because
// importing anything would make it a module, and a module is deferred, which is
// the very property that would put the white flash back.
//
// So this pins the duplication BY BEHAVIOUR rather than by matching its text:
// the script is extracted and actually run against a table of stored payloads,
// and its answer is compared with what the app itself would decide via
// migrateSettings + resolveTheme. A regex would pass while the two disagreed;
// this cannot.
const here = dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = readFileSync(join(here, '..', '..', 'index.html'), 'utf8');

/** The inline boot script's body, taken from the <head> of index.html. */
function bootScript(): string {
  const scripts = [...INDEX_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const boot = scripts.find((s) => s.includes('dataset.theme'));
  if (!boot) throw new Error('index.html no longer carries an inline theme boot script');
  return boot;
}

/** Runs the real script with fakes, and reports the attribute it stamped. */
function runBoot(stored: string | null, osPrefersDark: boolean): string {
  const root = { dataset: {} as { theme?: string } };
  const fn = new Function(
    'localStorage',
    'matchMedia',
    'document',
    bootScript(),
  ) as (ls: unknown, mm: unknown, doc: unknown) => void;
  fn(
    { getItem: () => stored },
    (q: string) => ({ matches: q.includes('dark') ? osPrefersDark : !osPrefersDark }),
    { documentElement: root },
  );
  return root.dataset.theme ?? '<unset>';
}

/** What the app decides for the same payload, through its own code path. */
function appDecides(stored: string | null, osPrefersDark: boolean): string {
  const parsed: unknown = stored === null ? null : (JSON.parse(stored) as { state?: unknown }).state;
  const original = globalThis.matchMedia;
  (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({
    matches: q.includes('dark') ? osPrefersDark : !osPrefersDark,
  });
  try {
    return resolveTheme(migrateSettings(parsed).theme);
  } finally {
    (globalThis as { matchMedia?: unknown }).matchMedia = original;
  }
}

const payload = (theme: unknown) => JSON.stringify({ state: { theme }, version: 1 });

/** Everything the stored value can be, including the shapes that are not it. */
const STORED_CASES: [label: string, stored: string | null][] = [
  ['an explicit light', payload('light')],
  ['an explicit dark', payload('dark')],
  ['an explicit system', payload('system')],
  ['no profile at all', null],
  ['a profile with no theme yet', JSON.stringify({ state: { currency: 'UAH' }, version: 1 })],
  ['an unknown value', payload('solarized')],
  ['a null theme', payload(null)],
  ['a numeric theme', payload(3)],
  ['an object theme', payload({ mode: 'dark' })],
];

describe('the boot script and the app resolve the theme identically', () => {
  for (const [label, stored] of STORED_CASES) {
    for (const osPrefersDark of [true, false]) {
      const os = osPrefersDark ? 'a dark OS' : 'a light OS';
      it(`agrees on ${label} under ${os}`, () => {
        expect(runBoot(stored, osPrefersDark)).toBe(appDecides(stored, osPrefersDark));
      });
    }
  }

  it('stamps an attribute for every case, so nothing is ever left unset', () => {
    for (const [, stored] of STORED_CASES) {
      for (const osPrefersDark of [true, false]) {
        expect(runBoot(stored, osPrefersDark)).toMatch(/^(light|dark)$/);
      }
    }
  });

  it('falls back to light when localStorage itself throws', () => {
    // Private mode and locked-down browsers throw on access rather than
    // returning null. The script must not take the boot down with it.
    const root = { dataset: {} as { theme?: string } };
    const fn = new Function('localStorage', 'matchMedia', 'document', bootScript()) as (
      ls: unknown,
      mm: unknown,
      doc: unknown,
    ) => void;
    fn(
      {
        getItem: () => {
          throw new Error('SecurityError');
        },
      },
      () => ({ matches: true }),
      { documentElement: root },
    );
    expect(root.dataset.theme).toBe('light');
  });

  it('reads the same localStorage key the app writes', () => {
    // Not a style check: a drifted key would make the script silently resolve
    // every user to `system` while their real choice sat unread.
    expect(bootScript()).toContain("'quirenote-settings'");
  });

  it('reads state.theme top-level, which persist doctrine #2 pins for it', () => {
    expect(bootScript()).toMatch(/\.state\.theme/);
  });
});

describe('resolveTheme', () => {
  const withOs = <T,>(prefersDark: boolean, fn: () => T): T => {
    const original = globalThis.matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: prefersDark });
    try {
      return fn();
    } finally {
      (globalThis as { matchMedia?: unknown }).matchMedia = original;
    }
  };

  it('answers for itself when the preference is explicit, whatever the OS says', () => {
    expect(withOs(true, () => resolveTheme('light'))).toBe('light');
    expect(withOs(false, () => resolveTheme('dark'))).toBe('dark');
  });

  it('asks the OS only for `system`', () => {
    expect(withOs(true, () => resolveTheme('system'))).toBe('dark');
    expect(withOs(false, () => resolveTheme('system'))).toBe('light');
  });

  it('never returns `system` — a preference is not a theme', () => {
    for (const prefersDark of [true, false]) {
      for (const pref of ['light', 'dark', 'system'] as const) {
        expect(withOs(prefersDark, () => resolveTheme(pref))).toMatch(/^(light|dark)$/);
      }
    }
  });
});

describe('the theme survives the persist contract', () => {
  it('defaults to system, so a first-time user follows the OS', () => {
    expect(migrateSettings({}).theme).toBe('system');
  });

  it('is listed in partialize, or it would silently reset on every reload', () => {
    // Doctrine #1 in state/settings.ts. Checked against the source rather than
    // by round-tripping a store, because the failure it guards is a MISSING
    // line, and a store test would pass by hydrating the default.
    const source = readFileSync(join(here, '..', 'state', 'settings.ts'), 'utf8');
    const partialize = /partialize: \(s\) => \(\{([\s\S]*?)\}\)/.exec(source)?.[1] ?? '';
    expect(partialize).toContain('theme: s.theme');
  });
});
