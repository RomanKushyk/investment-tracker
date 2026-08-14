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
    for (const [key, val] of leaves(v as Node, prefix ? `${prefix}.${k}` : k)) out.set(key, val);
  }
  return out;
}

const EN = leaves(en as unknown as Node);
const UK = leaves(uk as unknown as Node);

/** Keys whose value is legitimately identical in both languages. */
const SHARED = new Set([
  // A dataset marker, not prose — the same token in both, like the ₴/$ labels.
  'sidebar.demoBadge',
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
      .filter(([key, value]) => typeof value === 'string' && !SHARED.has(key) && UK.get(key) === value)
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
      const args = Array.from({ length: value.length }, (_, i) => `«${i}»`) as never[];
      const enOut = (value as (...a: never[]) => string)(...args);
      const ukOut = (ukFn as (...a: never[]) => string)(...args);
      for (let i = 0; i < args.length; i++) {
        expect(enOut, `${key} — English drops «${i}»`).toContain(`«${i}»`);
        expect(ukOut, `${key} — Ukrainian drops «${i}»`).toContain(`«${i}»`);
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
      if (typeof value !== 'string' || SHARED.has(key) || value.length < 8) continue;
      if (!/[A-Za-z]/.test(value)) continue;
      expect(/[а-яіїєґА-ЯІЇЄҐ]/.test(value), `${key}: ${value}`).toBe(true);
    }
  });
});
