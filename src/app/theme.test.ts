import { readFileSync, readdirSync } from 'node:fs';
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

/** TS comments out, LINE BY LINE, and the line boundary is the point: a regex
 *  literal may hold a quote, and one desync would switch stripping off for the
 *  rest of the file. Copied from `sidebar-structure.test.ts` SIGNATURE AND ALL,
 *  which is the house idiom — the guards here each carry their own copy. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

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
  const fn = new Function('localStorage', 'matchMedia', 'document', bootScript()) as (
    ls: unknown,
    mm: unknown,
    doc: unknown,
  ) => void;
  fn(
    { getItem: () => stored },
    (q: string) => ({ matches: q.includes('dark') ? osPrefersDark : !osPrefersDark }),
    { documentElement: root },
  );
  return root.dataset.theme ?? '<unset>';
}

/** What the app decides for the same payload, through its own code path. */
function appDecides(stored: string | null, osPrefersDark: boolean): string {
  const parsed: unknown =
    stored === null ? null : (JSON.parse(stored) as { state?: unknown }).state;
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
  const withOs = <T>(prefersDark: boolean, fn: () => T): T => {
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

describe('the charts are kept out of the theme flip', () => {
  // The Phase 5 reference is explicit: the cross-fade animates colour only, so
  // the ONLY way a theme change could replay a chart's grow-in animation is a
  // remount — and the only way to cause one is to put the theme in a React key
  // or make a chart read it. True today by construction, which is exactly when
  // it is cheap to pin: nothing here reads the theme, so nothing announces it
  // when something starts to.
  const CHART_DIR = join(here, '..', 'components', 'charts');

  it('no chart component reads the theme or the data-theme attribute', () => {
    const files = readdirSync(CHART_DIR).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(join(CHART_DIR, file), 'utf8');
      expect(source, `${file} must not depend on the theme`).not.toMatch(
        /useTheme|resolveTheme|data-theme|dataset\.theme|prefers-color-scheme/,
      );
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

// TWO CONTROLS, ONE FIELD — #85's third acceptance criterion.
//
// The sidebar's track and the Appearance card's radiogroup are drawn on
// different planes at different sizes, and the whole point of the pair is that
// they are the same preference seen twice: flip one and the other has already
// moved. That holds only while both write `setTheme` and neither keeps a copy,
// and the way it would break is silent — a sidebar control that resolved
// `system` at write time, or stamped `data-theme` itself, or walked its own
// order, would look right in a screenshot and be a second source of truth.
//
// SOURCE TEXT, because the suite runs `environment: 'node'` with no jsdom and
// no testing-library, the same reason `sidebar-structure.test.ts` and
// `price-mode-segment.test.ts` read files. What it can pin is the wiring; that
// the store then holds the value is `state/settings.test.ts`'s arm.
describe('the sidebar and the Appearance card write the one stored preference', () => {
  const read = (...rel: string[]) => readFileSync(join(here, '..', ...rel), 'utf8');
  const SIDEBAR = read('app', 'Sidebar.tsx');
  const SETTINGS = read('screens', 'Settings.tsx');
  const STORE = read('state', 'settings.ts');

  const CONTROLS = [
    ['the sidebar', SIDEBAR],
    ['the Appearance card', SETTINGS],
  ] as const;

  it.each(CONTROLS)('%s reads and writes the store rather than a copy', (_what, source) => {
    expect(source, 'the control does not write the store').toMatch(/setTheme\(/);
    expect(source, 'the control does not read the store').toMatch(/useSettings\(/);
  });

  // The WRITE, not the name: `setTheme:` appears twice in the store, once in
  // the interface and once in the implementation, and counting both would pass
  // a second implementation that shadowed the first.
  it('leaves exactly one writer in the store', () => {
    expect(
      (STORE.match(/set\(\{ theme \}\)/g) ?? []).length,
      'the field has two writers, or its one write was renamed',
    ).toBe(1);
  });

  it('walks one order, exported once and imported twice', () => {
    expect((STORE.match(/export const THEME_ORDER\b/g) ?? []).length).toBe(1);
    for (const [what, source] of CONTROLS) {
      expect(source, `${what} declares its own theme order`).not.toMatch(
        /(const|let) THEME_ORDER\b/,
      );
      expect(source, `${what} does not import the store's order`).toMatch(/\bTHEME_ORDER\b/);
    }
  });

  // The sidebar is a PREFERENCE writer and nothing else. `useTheme` in this
  // directory owns `data-theme`, the crossfade and the `theme-color` meta, and
  // two writers would be one too many — so the control must not resolve, stamp
  // or listen on its own.
  it('leaves the resolving and the stamping to this directory', () => {
    // COMMENTS OUT, because the file argues the split in prose and would
    // otherwise fail on its own explanation of it. `stripTs` and not a line
    // filter: `Sidebar.tsx` is mostly `{/* … */}`, whose opener starts with `{`
    // and whose continuation lines start with plain words, so a filter keeps
    // the whole block and the first JSX comment to name the attribute breaks
    // the guard against the very sentence it wants written.
    expect(stripTs(SIDEBAR), 'the sidebar took over the theme mechanism').not.toMatch(
      /resolveTheme|data-theme|dataset\.theme|prefers-color-scheme/,
    );
  });
});
