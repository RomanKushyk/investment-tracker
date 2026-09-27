import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// `/sign-in` SAYS SO ONCE, ON A SIGN-OUT'S ARRIVAL (`sign-out-landing.dc.html`): the half
// `auth/signed-out.test.ts` cannot reach — who hands the fact over, and how the page draws it.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments cut, so a sentence about the fact cannot answer for the fact. The canonical reader,
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

/** From `start` to the first `end` after it, or a failure naming what went missing. */
function slice(source: string, start: string, end: string): string {
  const at = source.indexOf(start);
  expect(at, `\`${start}\` is gone`).toBeGreaterThan(-1);
  const to = source.indexOf(end, at);
  expect(to, `nothing closes \`${start}\``).toBeGreaterThan(at);
  return source.slice(at, to);
}

describe('both sign-outs that land on `/sign-in` hand it the fact', () => {
  it("the shell's «Вийти»", () => {
    expect(read('hooks/useSignOut.ts')).toMatch(
      /navigate\('\/sign-in', \{ flushSync: true, state: SIGNED_OUT \}\)/,
    );
  });

  it("an answer's «Вийти», and never its way to `/apply`", () => {
    const answer = read('screens/sign-in/Answer.tsx');
    expect(answer, 'the navigation drops the state it is given').toMatch(
      /navigate\(to, \{ flushSync: true, state \}\)/,
    );
    expect(answer, 'the sign-out no longer hands it').toMatch(/leave\('\/sign-in', SIGNED_OUT\)/);
    expect(answer, '"Sign out and apply" hands it too').toMatch(/leave\('\/apply'\)/);
  });
});

describe('`/sign-in` reads it once and uses it up', () => {
  const signIn = read('screens/sign-in/SignIn.tsx');

  it('reads it at mount, so the visit keeps what it read', () => {
    expect(signIn).toMatch(/useState[^;]*\(\(\) =>\s*arrivedSignedOut\(location\.state\)/);
  });

  it('replaces its own entry on arrival, since the browser keeps `history.state`', () => {
    expect(signIn).toMatch(
      /useEffect\(\(\) => \{\s*if \(arrivedSignedOut\(location\.state\)\) void navigate\(\.\.\.usedUp\(location\)\);\s*\}, \[location, navigate\]\);/,
    );
  });

  it('opens the address step with the line, above the title', () => {
    const step = slice(signIn, "step.name === 'address' &&", '</form>');
    const note = step.indexOf('<SignedOutNote');
    expect(note, 'the address step draws no line').toBeGreaterThan(-1);
    expect(note, 'the line is not above the title').toBeLessThan(
      step.indexOf('<Title>{t.auth.signIn.title}</Title>'),
    );
    expect(step, 'the line says something else').toMatch(/\{t\.auth\.signedOut\}<\/SignedOutNote>/);
  });

  it('holds the line on submit, and a new step has none', () => {
    expect(slice(signIn, 'function submitAddress', 'passkeyFirst(address)')).toMatch(
      /setNote\(\(before\) => before && 'held'\)/,
    );
    expect(slice(signIn, 'function go(', 'setStep(next)')).toMatch(/setNote\(undefined\)/);
  });
});

describe('the line', () => {
  const note = () => slice(read('screens/sign-in/parts.tsx'), 'function SignedOutNote', '</div>');

  it('is a status box that mounts before its words, so they are announced', () => {
    expect(note(), 'not a status').toMatch(/role="status"/);
    expect(note(), 'the words mount with their box').toMatch(
      /setTimeout\(\(\) => setTold\(true\), REGION_SETTLES_MS\)/,
    );
  });

  it('keeps its line when held, and its words leave the accessibility tree', () => {
    expect(note(), 'the box does not keep its line').toMatch(/min-h-\[19\.5px\]/);
    expect(note(), 'held words stay in the tree').toMatch(/held \? 'invisible opacity-0'/);
  });
});
