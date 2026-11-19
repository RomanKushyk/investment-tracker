import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declared, stripCss, themeBlocks, type Theme } from './__fixtures__/palette';

// H2 (controls.md § Signed): the toast's close hovers with an `ink` 5 % veil over its own `card`
// fill, folded into one colour as the knob's hover is, and never fades.
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
const SRC = stripTs(readFileSync(join(here, 'app/AppToaster.tsx'), 'utf8'), 'app/AppToaster.tsx');
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

const close = () => {
  const m = SRC.match(/closeButton: `([^`]*)`/);
  expect(m, 'the toaster names no closeButton class').not.toBeNull();
  return m![1].split(/\s+/);
};

describe('the toast’s close button', () => {
  it('hovers to the veiled card and never fades', () => {
    const cls = close();
    expect(cls).toContain('hover:!bg-card-hover');
    expect(cls.filter((c) => /^hover:!?opacity-/.test(c))).toEqual([]);
  });

  it('keeps its rest fill, edge, box and press', () => {
    expect(close()).toEqual(
      expect.arrayContaining([
        '!bg-card',
        '!border-field-border',
        '!size-7',
        '!rounded-[7px]',
        'active:scale-[.97]',
      ]),
    );
  });

  // sonner's own hover paints `--gray2` unlayered; only an important utility outranks it.
  it('builds the hover as an important fill from the token', async () => {
    const compiler = await compile(CSS, { base: here, onDependency: () => {} });
    const built = compiler.build(['hover:!bg-card-hover']);
    expect(built).toMatch(
      /\.hover\\:\\!bg-card-hover:hover\s*\{\s*background-color:\s*var\(--color-card-hover\)\s*!important;/,
    );
  });

  // Two opaque colours mixed in srgb are the first composited over the second at that share
  // (CSS Color 5 § color-mix), so the one fill is the veil over the rest.
  it.each<Theme>(['light', 'dark'])(
    'in %s, the hover is ink at five percent mixed into card',
    (theme) => {
      expect(declared(BLOCKS[theme], 'card-hover').replace(/\s+/g, ' ')).toBe(
        'color-mix(in srgb, var(--color-ink) 5%, var(--color-card))',
      );
    },
  );
});
