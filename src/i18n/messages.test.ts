import { describe, expect, it } from 'vitest';

import { en, uk } from './messages';

// `Dict = typeof en` already makes a missing or extra key a COMPILE error, so
// these tests deliberately cover what the type cannot see:
//  · a key present in both but left in English in `uk` — type-correct, wrong
//  · an interpolation dropped or reordered inside a translated function
//  · a shape that drifted through an `as` cast someone added later
// A test that only re-asserted key equality would pass by construction.

type Node = string | ((...args: never[]) => string) | { [k: string]: Node };

/** Every leaf, as `a.b.c` -> value. */
function leaves(node: Node, prefix = ''): Map<string, Node> {
  const out = new Map<string, Node>();
  if (typeof node !== 'object') {
    out.set(prefix, node);
    return out;
  }
  for (const [k, v] of Object.entries(node)) {
    for (const [key, val] of leaves(v as Node, prefix ? `${prefix}.${k}` : k))
      out.set(key, val);
  }
  return out;
}

const EN = leaves(en as unknown as Node);
const UK = leaves(uk as unknown as Node);

/** Keys whose value is legitimately identical in both languages. */
const SHARED = new Set([
  // A dataset marker, not prose — the same token in both, like the ₴/$ labels.
  'sidebar.demoBadge',
  // Each language names ITSELF in its own script, in both dictionaries — the
  // brief's S2 rule. Identical values here are the requirement, not a miss.
  'settings.language.uk',
  'settings.language.en',
]);

describe('the dictionaries', () => {
  it('have the same leaves', () => {
    expect([...UK.keys()].sort()).toEqual([...EN.keys()].sort());
  });

  it('agree on which leaves are functions', () => {
    for (const [key, value] of EN) {
      expect(typeof UK.get(key), key).toBe(typeof value);
    }
  });

  it('leave nothing untranslated', () => {
    // The failure this catches is a key copied across and never translated,
    // which is type-correct and invisible until it is on screen.
    const untranslated = [...EN]
      .filter(
        ([key, value]) =>
          typeof value === 'string' &&
          // An empty string has nothing to translate — `couponFrequency.none`
          // is the deliberate absence of a frequency word, not a missed one.
          value !== '' &&
          !SHARED.has(key) &&
          UK.get(key) === value,
      )
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });

  it('keep every interpolation a translated function takes', () => {
    // A function string is where a translation can silently drop a value: the
    // arity is typed, but nothing stops a body from ignoring an argument.
    // Feeding distinctive markers in and demanding they come out catches it.
    for (const [key, value] of EN) {
      if (typeof value !== 'function') continue;
      const ukFn = UK.get(key);
      expect(typeof ukFn, key).toBe('function');
      // Marker arguments, tried as plain strings first and then wrapped in
      // arrays: `warning.rowsRemoved` takes a string[] and joins it, so a bare
      // string argument throws rather than producing a probeable sentence.
      const call = (fn: unknown, wrap: boolean) => {
        const args = Array.from({ length: value.length }, (_, i) =>
          wrap ? [`«${i}»`] : `«${i}»`,
        ) as never[];
        return (fn as (...a: never[]) => string)(...args);
      };
      let wrap = false;
      let enOut: string;
      try {
        enOut = call(value, false);
      } catch {
        wrap = true;
        enOut = call(value, true);
      }
      const ukOut = call(ukFn, wrap);
      for (let i = 0; i < value.length; i++) {
        // The rule is "the translation must not drop what the original keeps",
        // NOT "every argument must appear". Some of these strings branch —
        // `problemCount` only mentions its second argument when fewer rows are
        // shown than found — and with marker arguments the comparison that
        // picks the branch is false. Demanding both markers unconditionally
        // would fail a correct pair.
        if (!enOut.includes(`«${i}»`)) continue;
        expect(
          ukOut,
          `${key} — Ukrainian drops «${i}» that English keeps`,
        ).toContain(`«${i}»`);
      }
    }
  });

  it('write Ukrainian in Cyrillic, so a stray English string cannot hide', () => {
    // The test hunts for stray ENGLISH, so the precondition is Latin letters:
    // a leaf with none of them cannot be English, whatever else it contains.
    // That exempts pure figures like the amount placeholder `10 000,00`
    // without needing a hand-maintained list. Short tokens are not evidence
    // either way, and SHARED covers the ones that are deliberately identical.
    for (const [key, value] of UK) {
      if (typeof value !== 'string' || SHARED.has(key) || value.length < 8)
        continue;
      if (!/[A-Za-z]/.test(value)) continue;
      expect(/[а-яіїєґА-ЯІЇЄҐ]/.test(value), `${key}: ${value}`).toBe(true);
    }
  });
});

// Ported from the deleted date-labels.test.ts. `fmtPayoutDate` and MONTH_SHORT
// went with their module — the formatter's `dateShort` IS the Contract 0 form
// of the first, and the months are dictionary data now. The ordinal edge cases
// are the part that had real logic and no other guard.
describe('day-of-month', () => {
  it('formats English ordinal suffixes, including the 11-13 exception', () => {
    const d = en.dates.dayOfMonth;
    expect(d(1)).toBe('1st');
    expect(d(2)).toBe('2nd');
    expect(d(3)).toBe('3rd');
    expect(d(10)).toBe('10th');
    expect(d(11)).toBe('11th'); // not "11st"
    expect(d(12)).toBe('12th');
    expect(d(13)).toBe('13th');
    expect(d(21)).toBe('21st');
    expect(d(25)).toBe('25th');
  });

  it('writes the Ukrainian day with its genitive marker instead', () => {
    expect(uk.dates.dayOfMonth(10)).toBe('10-го');
    expect(uk.dates.dayOfMonth(1)).toBe('1-го');
  });

  it('indexes months by (month - 1), as the chart axes do', () => {
    expect(en.dates.monthShort[1]).toBe('Feb');
    expect(en.dates.monthShort[6]).toBe('Jul');
    expect(uk.dates.monthShort[1]).toBe('лют');
    expect(en.dates.monthFull[5]).toBe('June');
    expect(uk.dates.monthFull[5]).toBe('червень');
  });
});
