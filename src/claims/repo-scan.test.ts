import { describe, expect, it } from 'vitest';
import { PARSE_ERROR_PREFIX } from './comments';
import { isDeclaredDamage } from './repo-scan';

describe('isDeclaredDamage', () => {
  it('recognizes an unclosed Markdown code fence — codeRanges own declared failure mode', () => {
    expect(isDeclaredDamage('unclosed code fence opened on line 71 — reached end of file')).toBe(
      true,
    );
  });

  it('recognizes a TypeScript parse rejection — commentRanges own declared failure mode', () => {
    expect(isDeclaredDamage(`${PARSE_ERROR_PREFIX} '</' expected.`)).toBe(true);
  });

  it('does NOT recognize an unrelated error — it must propagate, not be hidden as pre-existing damage', () => {
    // The exact real-bug shape scanRepo's catch exists to let through: a
    // malformed escape-hatch marker throwing from deep inside scanFile.
    expect(
      isDeclaredDamage(
        'x.md:2: looks like the unchecked-hatch marker but does not parse — needs a colon',
      ),
    ).toBe(false);
    expect(isDeclaredDamage('TypeError: Cannot read properties of undefined')).toBe(false);
  });
});
