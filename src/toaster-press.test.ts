import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A TOAST TAKES ITS OWN PRESSES, EVEN UNDER A MODAL (`design/extensions/sign-out.dc.html`, T4).
// The toaster turns pointer events back on, so every MODAL dialog that closes on an outside press
// must not count a press on a toast as one — a popover is not modal, and a toast press always
// reached it; and the drawer publishes its band's height so a toast raised there stands above
// «Вийти».
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
const read = (rel: string) => stripTs(readFileSync(join(here, rel), 'utf8'), rel);

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

describe('a press on a toast', () => {
  // AN ALERT DIALOG IS EXEMPT: it never closes on an outside press, so there is nothing to keep.
  // Scanned under EVERY NAME the `radix-ui` Dialog is imported as, and the sites are named, so a
  // new dialog or a new alias fails here until it is looked at.
  it('closes no modal dialog that an outside press would close', () => {
    const tags = sources(here).flatMap((file) => {
      const src = stripTs(readFileSync(file, 'utf8'), file);
      const aliases = [...src.matchAll(/import \{([^}]*)\} from 'radix-ui'/g)]
        .flatMap((m) => m[1]!.split(','))
        .map((name) => name.trim())
        .filter((name) => /^Dialog\b/.test(name))
        .map((name) => name.split(/\s+as\s+/)[1] ?? name);
      return aliases.flatMap((alias) =>
        [...src.matchAll(new RegExp(`<${alias}\\.Content\\b[\\s\\S]*?>`, 'g'))].map((m) => ({
          file: relative(here, file).split(sep).join('/'),
          tag: m[0],
        })),
      );
    });
    expect(
      tags.map(({ file }) => file).sort(),
      'a modal dialog appeared or vanished — guard it, then name it here',
    ).toEqual(['app/Sidebar.tsx', 'components/ui/DatePicker.tsx', 'components/ui/Dialog.tsx']);
    // A spread after the guard could hand the prop back to whatever the caller passes.
    const unguarded = tags
      .filter(({ tag }) => !/onInteractOutside=\{keepOpenForToasts\}(?![\s\S]*\{\.\.\.)/.test(tag))
      .map(({ file }) => file);
    expect(unguarded, 'a modal dialog closes when a toast above it is pressed').toEqual([]);
  });

  it('reaches the toast, which names its close button in the language on screen', () => {
    const toaster = read('app/AppToaster.tsx');
    expect(toaster, 'a toast under a modal lets its presses fall through').toMatch(
      /style=\{\{ pointerEvents: 'auto' \}\}/,
    );
    expect(toaster, "the close button takes sonner's English name").toMatch(
      /closeButtonAriaLabel: t\.toast\.close/,
    );
  });
});

describe("a toast raised in the drawer stands on the drawer's band", () => {
  it('is lifted by the band on both of sonner’s offsets', () => {
    const toaster = read('app/AppToaster.tsx');
    const lifts = toaster.match(/calc\(var\(--drawer-band-h, 0px\) \+ 14px\)/g) ?? [];
    expect(lifts.length, 'an offset no longer stands the toast on the band').toBe(2);
  });

  it('is told the band’s height while the drawer is open, and forgets it after', () => {
    const sidebar = read('app/Sidebar.tsx');
    expect(sidebar, 'the drawer no longer publishes its band').toMatch(
      /setProperty\('--drawer-band-h'/,
    );
    expect(sidebar, 'a closed drawer would keep lifting every toast').toMatch(
      /removeProperty\('--drawer-band-h'\)/,
    );
  });
});
