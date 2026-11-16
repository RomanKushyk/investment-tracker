// The header band and the zebra row keep 4.5 : 1 for their text (tables.md § Signed,
// Accessibility): `muted` on the band, `ink` 7 % mixed into `card`, and body `ink` on a zebra row
// over every plane the glass card can show. The tints are read from the stylesheet and the anatomy,
// so a retuned one is checked, not a copy of it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  channels,
  composite,
  glassPlanes,
  ratio,
  resolve,
  stripCss,
  themeBlocks,
  type Theme,
} from './__fixtures__/palette';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);
/** Copied SIGNATURE AND ALL rather than imported: `ts-reader-census.test.ts` holds every copy to one
 *  text. The anatomy's comments name its classes, so an unstripped match could read prose. */
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

const ANATOMY_FILE = 'components/ui/table-anatomy.ts';
const ANATOMY = stripTs(readFileSync(join(here, ANATOMY_FILE), 'utf8'), ANATOMY_FILE);

const alpha = (source: string, pattern: RegExp) => {
  const m = source.match(pattern);
  expect(m, String(pattern)).not.toBeNull();
  return Number(m![1]) / 100;
};

describe.each<Theme>(['light', 'dark'])('table contrast, %s', (theme) => {
  const ink = resolve(BLOCKS, theme, 'ink');
  const veil = (a: number) => ({ ch: channels(ink), alpha: a });

  it('keeps the muted header at 4.5 : 1 on the band', () => {
    expect(ANATOMY).toMatch(/\bbg-table-band\b/);
    // Each theme declares the band itself (`floating-edges.test.ts`), so each is read in its own block.
    const tint = alpha(
      BLOCKS[theme],
      /--color-table-band:\s*color-mix\(in srgb, var\(--color-ink\) (\d+)%, var\(--color-card\)\)/,
    );
    const band = composite(veil(tint), resolve(BLOCKS, theme, 'card'));
    expect(ratio(resolve(BLOCKS, theme, 'muted'), band)).toBeGreaterThanOrEqual(4.5);
  });

  // The zebra and the hover veil, under body `ink` and under the `muted` cells /yield's basis reads in.
  it.each([
    ['zebra', /group-even\/row:bg-ink\/(\d+)/],
    ['hover', /group-hover\/row:bg-ink\/(\d+)/],
  ])('keeps ink and muted at 4.5 : 1 on a %s row over every plane of the glass', (_, pattern) => {
    const tint = veil(alpha(ANATOMY, pattern));
    for (const text of [ink, resolve(BLOCKS, theme, 'muted')]) {
      const least = Math.min(
        ...glassPlanes(CSS, theme).map((plane) => ratio(text, composite(tint, plane))),
      );
      expect(least).toBeGreaterThanOrEqual(4.5);
    }
  });
});
