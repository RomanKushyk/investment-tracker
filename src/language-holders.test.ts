import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

// Trailing comments too, not only whole lines: `x = 1; // setLanguage(…)` would
// otherwise read as a caller and redden the suite over a comment.
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const CODE = sourceFiles(here).map((path) => ({
  name: path.slice(here.length + 1).replace(/\\/g, '/'),
  text: strip(readFileSync(path, 'utf8')),
}));

// The store is where the language is DEFINED and written; every other file is
// what this guards.
const CALLERS = CODE.filter(({ name }) => name !== 'state/settings.ts');

// WHY A TEST AND NOT A COMMENT. A language switch rewrites nothing: a field
// holding an unsaved STRING keeps it, and reads it from then on under a grammar
// it was not written in. Four fields still hold one — the asset form's
// `expectedPct`, `targetPct` and `couponRatePct`, and `/allocation`'s target row
// — and they are safe today for one reason only: the control that changes the
// language lives on `/settings`, so each has unmounted before it can move. The
// transaction panel and the coupon card are NOT among them; both are on
// `NumberField` and derive their display.
//
// That is an invariant about a CALL SITE, which no type holds and no comment
// enforces. Put a language control where those four stay mounted — the sidebar
// carries theme and currency already, so it is the obvious next step — and they
// start misreading their own text silently: `expectedPct` is unbounded, so a
// Ukrainian «16,400» read as English stores 16400 and drives `dailyAccrual`,
// `couponProjection` and `/yield` with it.
describe('only one control can change the language', () => {
  it('calls setLanguage from exactly one place', () => {
    // CALL SITES, not files: a second radiogroup added inside Settings.tsx is
    // the same hazard as one added elsewhere, and counting files would miss it.
    const sites = CALLERS.flatMap(({ name, text }) =>
      (text.match(/\bsetLanguage\s*\(/g) ?? []).map(() => name),
    ).sort();
    expect(
      sites,
      'A second language control makes every mounted field a holder: give the ' +
        'four that keep their own string a way to follow the switch first.',
    ).toEqual(['screens/Settings.tsx']);
  });

  it('has no second way to write the language either', () => {
    // `setLanguage(` is not the only spelling a writer could take — the store is
    // exported, so `setState` reaches the field without ever naming the action,
    // in an object OR an updater, and a plain assignment reaches it too.
    const around = CALLERS.filter(
      ({ text }) =>
        /setState\([\s\S]{0,200}?\blanguage\s*[,:}]/.test(text) || /\.language\s*=[^=]/.test(text),
    )
      .map(({ name }) => name)
      .sort();
    expect(around, 'the language is being written around setLanguage').toEqual([]);
  });

  it('leaves the fields that DERIVE their display free of that constraint', () => {
    // `NumberField` holds a language-free value and formats it per render, so a
    // switch is a re-render for every site on it — which is why the five
    // groupable inputs and the rate box are absent from the warning above.
    const field = CODE.find(({ name }) => name.endsWith('NumberField.tsx'));
    expect(field?.text).toMatch(/groupedForInput\(value, language\)/);
    // BOUNDED: no other tag may open between the two, or this passes on any
    // NumberField anywhere above a plain `<input id="usd-rate">`.
    const settings = CODE.find(({ name }) => name === 'screens/Settings.tsx');
    expect(settings?.text, 'the rate box went back to holding its own writing').toMatch(
      /<NumberField[^<>]*\sid="usd-rate"/,
    );
  });
});
