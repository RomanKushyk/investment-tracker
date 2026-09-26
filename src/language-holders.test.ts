import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Trailing comments too, not only whole lines: `x = 1; // setLanguage(…)` would otherwise
 *  read as a caller and redden the suite over a comment. QUOTE-EXACT, because `//` inside a
 *  STRING is not a comment and a bare `/\/\/.*$/` truncates its own line at the first URL —
 *  which also MISSES a real `setLanguage(` call written after one.
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

const CODE = sourceFiles(here).map((path) => ({
  name: path.slice(here.length + 1).replace(/\\/g, '/'),
  text: stripTs(readFileSync(path, 'utf8'), path),
}));

// The store is where the language is DEFINED; every other file is what this guards.
const CALLERS = CODE.filter(({ name }) => name !== 'state/settings.ts');

// WHY A TEST AND NOT A COMMENT. A language switch rewrites nothing: a field
// holding an unsaved STRING keeps it, and reads it from then on under a grammar
// it was not written in. Four fields still hold one — the asset form's
// `expectedPct`, `targetPct` and `couponRatePct`, and `/allocation`'s target row
// — and they are safe today for one reason only: the control that changes the
// language lives on `/settings` and in the signed-out shell, so each has
// unmounted before it can move. The transaction panel and the coupon card are
// NOT among them; both are on `NumberField` and derive their display.
//
// That is an invariant about a CALL SITE, which no type holds and no comment
// enforces. Put a language control where those four stay mounted — the sidebar
// carries theme and currency already, so it is the obvious next step — and they
// start misreading their own text silently: `expectedPct` is unbounded, so a
// Ukrainian «16,400» read as English stores 16400 and drives `dailyAccrual`,
// `couponProjection` and `/yield` with it.
describe('only one control can change the language', () => {
  it('calls setLanguage from exactly one place', () => {
    // CALL SITES, not files: a second radiogroup inside `LanguageControl.tsx` is the same hazard
    // as one added elsewhere, and counting files would miss it.
    const sites = CALLERS.flatMap(({ name, text }) =>
      (text.match(/\bsetLanguage\s*\(/g) ?? []).map(() => name),
    ).sort();
    expect(
      sites,
      'A second language control makes every mounted field a holder: give the ' +
        'four that keep their own string a way to follow the switch first.',
    ).toEqual(['components/LanguageControl.tsx']);
  });

  it('renders that control only where none of the four is mounted', () => {
    // `/settings`, and the signed-out shell, which renders outside `<Layout />` and so beside no
    // portfolio screen at all.
    const sites = CODE.filter(({ text }) => /<LanguageControl\b/.test(text))
      .map(({ name }) => name)
      .sort();
    expect(sites).toEqual(['app/SignedOutShell.tsx', 'screens/Settings.tsx']);
  });

  it('has no second way to write the language either', () => {
    // The store is exported, so `setState` reaches the field without ever naming the action —
    // in an object OR an updater — and a plain assignment reaches it too.
    const around = CALLERS.filter(
      ({ text }) =>
        /setState\([\s\S]{0,200}?\blanguage\s*[,:}]/.test(text) || /\.language\s*=[^=]/.test(text),
    )
      .map(({ name }) => name)
      .sort();
    expect(around, 'the language is being written around setLanguage').toEqual([]);
  });

  it('leaves the fields that DERIVE their display free of that constraint', () => {
    // `NumberField` holds a language-free value and formats it per render, so a switch is a
    // re-render for every site on it — which is why those inputs are absent from the four.
    const field = CODE.find(({ name }) => name.endsWith('NumberField.tsx'));
    expect(field?.text).toMatch(/groupedForInput\(value, language\)/);
    // BOUNDED: no other tag may open between the two, or this passes on any `NumberField`
    // anywhere above a plain `<input id="usd-rate">`.
    const settings = CODE.find(({ name }) => name === 'screens/Settings.tsx');
    expect(settings?.text, 'the rate box went back to holding its own writing').toMatch(
      /<NumberField[^<>]*\sid="usd-rate"/,
    );
  });
});
