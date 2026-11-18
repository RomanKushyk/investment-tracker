import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { en, uk } from '../../i18n/messages';

// The brief (controls-and-overlays.md § Settled by the brief): after a backup the danger dialog's
// button is the disabled knob with a check, not a muted outline of its own.
const here = dirname(fileURLToPath(import.meta.url));

/** Copied SIGNATURE AND ALL rather than imported:
 *  `ts-reader-census.test.ts` holds every copy to one text. */
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

const CODE = stripTs(readFileSync(join(here, 'DangerZone.tsx'), 'utf8'), 'DangerZone.tsx');

describe('«Backup done»', () => {
  // The Button that downloads, from its opening tag to its close.
  const at = CODE.indexOf('backup.download()');
  const button = CODE.slice(CODE.lastIndexOf('<Button', at), CODE.indexOf('</Button>', at));

  // Natively disabled, as the asset dialog's same button is: no key can download it again.
  it('is the knob, disabled once the backup is done', () => {
    expect(button).toContain('variant="outline"');
    expect(button).toMatch(/disabled=\{backup\.pending \|\| backedUp\}/);
    expect(button).not.toMatch(/aria-disabled|tabIndex/);
    expect(CODE).not.toMatch(/outlineMuted/);
  });

  // The check is the copy's own, in both languages; a glyph beside it would draw it twice.
  it('shows the check once the backup is done', () => {
    expect(CODE).toMatch(/backedUp \? t\.danger\.backupDone : t\.danger\.backupFirst/);
    for (const t of [en, uk]) expect(t.danger.backupDone).toMatch(/✓$/);
    expect(button).not.toMatch(/<Check\b/);
  });
});
