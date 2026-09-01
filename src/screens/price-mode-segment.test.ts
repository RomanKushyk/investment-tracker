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
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');
const PANEL = strip(readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8'));

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
