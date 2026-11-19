import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { TAP_44 } from './tap-target';

// H2 (controls.md § Signed): the strip's «N more» hovers with the ghost's `ink` 5 % veil on a
// padded box, pulled back so its text stays where it stood, and never fades.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments cut, so a sentence about a prop cannot answer for the prop. The canonical reader,
 *  copied whole as the house idiom has it (`ts-reader-census.test.ts`). */
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
const SRC = stripTs(readFileSync(join(here, 'ReminderStrip.tsx'), 'utf8'), 'ReminderStrip.tsx');

/** The class list of the `<button>` whose children hold `marker`, bounded by that element, with
 *  its one interpolation, `TAP_44`, read as the classes it holds. */
function classOf(marker: string): string[] {
  const at = SRC.indexOf(marker);
  expect(at, `${marker} is not in ReminderStrip.tsx`).toBeGreaterThan(-1);
  const own = [
    ...SRC.slice(SRC.lastIndexOf('<button', at), at).matchAll(/className=\{`([^`]*)`\}/g),
  ];
  expect(own, `no className template between <button and ${marker}`).not.toHaveLength(0);
  return own.at(-1)![1].replace('${TAP_44}', TAP_44).split(/\s+/);
}

describe('the strip’s «N more»', () => {
  const cls = classOf('moreRemindersLabel(hidden, t)');

  it('hovers with the ink veil and never fades', () => {
    expect(cls).toContain('hover:bg-ink/5');
    expect(cls.filter((c) => /^hover:!?opacity-/.test(c))).toEqual([]);
  });

  // The text stood 4 px in from the strip's edge, so 10 px of padding pulls back 6: a 24 px box at
  // round(24 × .26), at every width.
  it('draws a padded box at its shape radius, its text where it stood', () => {
    expect(cls).toEqual(expect.arrayContaining(['px-2.5', 'py-1', '-ml-1.5', 'rounded-[6px]']));
    expect(cls.filter((c) => c.includes('rounded-'))).toEqual(['rounded-[6px]']);
    expect(cls).not.toContain('px-1');
    expect(cls).not.toContain('py-[2px]');
  });

  // 44 × 44 is hit area, never geometry: below md the overlay takes it, and the margin opens the
  // strip's gap to the (44 − 24) / 2 the overlay owes the banner above.
  it('takes its hit area from the overlay, not its box', () => {
    expect(cls).toEqual(expect.arrayContaining(['max-md:after:size-11', 'max-md:mt-0.5']));
    expect(cls).not.toContain('max-md:min-h-11');
  });

  it('keeps its type, colour and press', () => {
    expect(cls).toEqual(
      expect.arrayContaining(['text-small', 'text-muted', 'self-start', 'active:scale-[.97]']),
    );
  });
});
