import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A SOURCE PIN, because this repo runs vitest with `environment: 'node'` and carries no
// render-testing library: a control's event wiring cannot be exercised, only its shape.
//
// THE DEFECT: `PriceModeSegment` reports which of two meanings the amount field carries and
// `TransactionPanel` CONVERTS the typed number on that event, so with
// `onClick={() => onChange(mode)}` THE ALREADY-ACTIVE SEGMENT FIRED TOO and a press that
// changed nothing ran the conversion anyway — repeated taps multiplied the amount each time.
//
// So the invariant is the control's own contract — `onChange` means the VALUE moved — and it
// has to hold whatever the handler on the other end does with it.
const here = dirname(fileURLToPath(import.meta.url));

/** Not cosmetic: `PriceModeSegment` carries a comment describing the very `onClick` this
 *  file BANS, so an unstripped read turns the guard red with no behaviour change — the trap
 *  `transaction-form-reset.test.ts` records about itself. QUOTE-EXACT AND LINE BY LINE,
 *  because dropping only whole-line `//` comments leaves the trailing ones and one
 *  apostrophe in prose then desynchronises every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// onClick={() => onChange(mode)}` inside `PriceModeSegment`
 *  leaves this green and turns the reader it replaces red. */
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
    expect(
      body,
      'the emit is no longer gated on the value MOVING, so the already-active segment fires ' +
        'too — `mode` is the segment being pressed, `value` the one in effect',
    ).toMatch(/if\s*\(\s*mode\s*!==\s*value\s*\)\s*onChange\(mode\)/);
  });

  it('never calls onChange unconditionally', () => {
    expect(
      segmentSource(),
      'an `onClick` whose whole body is the emit fires on the ALREADY-ACTIVE segment too, ' +
        'which is the exact line that converted the amount on a press that changed nothing',
    ).not.toMatch(/onClick=\{\(\)\s*=>\s*onChange\(mode\)\s*\}/);
  });

  it('still tells assistive tech which segment is a no-op', () => {
    expect(
      segmentSource(),
      '`aria-pressed` no longer says which segment is in effect — it is what SAYS the press ' +
        'does nothing, and the handler agreeing with it is the fix, so the two stay together',
    ).toContain('aria-pressed={value === mode}');
  });
});
