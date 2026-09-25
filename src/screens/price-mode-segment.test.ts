import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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
 *  `transaction-form-reset.test.ts` records about itself.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}
const PANEL = stripTs(
  readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8'),
  'TransactionPanel.tsx',
);

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
