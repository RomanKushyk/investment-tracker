import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A SOURCE PIN, and the reason it is one: this repo runs vitest with
// `environment: 'node'` and carries no render-testing library, so a control's
// event wiring cannot be exercised. What can be pinned is the shape of the
// wiring, and this particular shape shipped wrong twice.
//
// THE DEFECT. `PriceModeSegment` reports which of two meanings the amount field
// carries, and `TransactionPanel` CONVERTS the typed number on that event. With
// `onClick={() => onChange(mode)}` the already-active segment fired too, so a
// press that changed nothing ran the conversion anyway: measured in Chrome,
// three taps on Σ took «55 694,50» to ₴6 961 812 500 000 000, multiplying by
// the count each time. Owner's report, 2026-09-01: "тогл суми повинен реагувати
// лише на зміну (тогл) а не на клік на іконку."
//
// So the invariant is the control's own contract — `onChange` means the VALUE
// moved — and it has to hold whatever the handler on the other end does with it.
const here = dirname(fileURLToPath(import.meta.url));

/** TS comments out before the panel is read. Not cosmetic: `PriceModeSegment`
 *  carries a comment block describing the very `onClick` this file BANS, and
 *  writing that mistake in its code form rather than in prose would, on an
 *  unstripped read, turn the guard red with no behaviour change — the trap
 *  `transactions-layout.test.ts` and `transaction-form-reset.test.ts` each
 *  record about themselves.
 *
 *  QUOTE-EXACT AND LINE BY LINE, which is the half a regex cannot do: dropping
 *  only whole-line `//` comments leaves the trailing ones, and one apostrophe in
 *  the prose then desynchronises every quote pair after it. Copied from
 *  `floating-edges.test.ts` SIGNATURE AND ALL rather than imported — the house
 *  idiom is that a guard stands alone.
 *
 *  INJECTION-VERIFIED: a trailing `// onClick={() => onChange(mode)}` inside
 *  `PriceModeSegment` leaves this green and turns the reader it replaces
 *  red.
 */
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
const PANEL = stripTs(readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8'));

/** The `PriceModeSegment` body alone, so a match elsewhere cannot satisfy this. */
function segmentSource(): string {
  const start = PANEL.indexOf('function PriceModeSegment(');
  if (start === -1) throw new Error('PriceModeSegment is gone — this pin needs rewriting');
  const next = PANEL.indexOf('\nfunction ', start + 1);
  return PANEL.slice(start, next === -1 ? undefined : next);
}

describe('the price-mode segment reports a CHANGE, not a click', () => {
  it('guards its onClick against the value it already holds', () => {
    const body = segmentSource();
    // `mode` is the segment being pressed, `value` the one in effect.
    expect(body).toMatch(/if\s*\(\s*mode\s*!==\s*value\s*\)\s*onChange\(mode\)/);
  });

  it('never calls onChange unconditionally', () => {
    // The exact line that caused it, and any reformatting of the same mistake:
    // an `onClick` whose whole body is the emit.
    expect(segmentSource()).not.toMatch(/onClick=\{\(\)\s*=>\s*onChange\(mode\)\s*\}/);
  });

  it('still tells assistive tech which segment is a no-op', () => {
    // `aria-pressed` is what says the press does nothing; the handler agreeing
    // with it is the fix, so the two have to stay together.
    expect(segmentSource()).toContain('aria-pressed={value === mode}');
  });
});
