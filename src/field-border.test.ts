import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE FIELD EDGE, PINNED AT THE BAR THE DESIGN SESSION SET.
//
// `design/extensions/field-border.dc.html` mints `--color-field-border` and
// re-values `--color-pos-border` so no field boundary reads below 3 : 1 (WCAG
// 1.4.11) on any of the three surfaces a field is drawn on. Before it, the
// shipped `hairline` read 1.03 : 1 on `panel` in LIGHT — the lowest reading in
// the survey — and 1.10 in dark.
//
// Two halves need pinning and neither catches the other. THE CSS HALF is
// arithmetic on the tokens: a "tidy the palette" edit can move a hex by two
// digits and put a boundary back under the bar with every test green, because
// nothing else in this repo reads a stylesheet. THE MARKUP HALF is which
// recipes point at the token — eleven are written out separately, there is no
// shared input component (#84), so a twelfth added by copying a tenth lands on
// whatever the tenth used.
//
// FOUR SHAPES WERE TRIED FOR THE MARKUP HALF AND THREE FAILED, which is why it
// looks like this:
//
//   A proximity window around `rounded-[9px]` — `Select` computes its edge into
//   `borderClass` 1001 characters above the recipe that uses it, so a ±320
//   window passed it while it was still on `hairline`.
//
//   A blocklist over a hard-coded file list — it matched only a quote-delimited
//   `'border-hairline'`, never the `'border-hairline hover:…'` seven of the
//   eleven actually used, and a field in a file NOT on the list was invisible to
//   every assertion here.
//
//   COUNTING THE TOKEN ACROSS THE FIELD FILES — it stopped meaning counting a
//   FIELD when `field-border` became the shared control-boundary rank, and the
//   questions were asked of whole files, where a field on `border-panel-border`
//   could pass every one of them.
//
// What is here instead: walk the tree, ask questions of one FIELD SITE at a
// time, and let the answers compose. Each is verified by injection rather than
// by argument.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** COMMENTS OUT BEFORE ANY TOKEN IS READ. `token()` below takes the first match
 *  in a block, and this stylesheet's comments quote declarations constantly —
 *  including retired values it tells you not to re-mint — so a comment could
 *  satisfy an assertion the CSS fails, or fail one it passes. Quote-aware rather
 *  than a regex: `index.css` line 5 holds `/*` inside a string, and a naive
 *  reader swallows from there to the first real terminator, taking `@theme` with
 *  it. `floating-edges.test.ts` carries the same reader for the same reason. */
const CSS = (() => {
  const src = read('index.css');
  let out = '';
  let quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      out += c;
      if (c === '\\') out += src[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) throw new Error('index.css has an unterminated /* comment');
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
})();

/* ─────────────────────────── the CSS half ─────────────────────────── */

/** sRGB → relative luminance, WCAG 2.x. There is no colour helper to reuse:
 *  `core/` is pure money maths and owns no colour. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The span of a `selector { … }` rule, matched on its own braces. BOTH sides
 *  are bounded: an unbounded slice let "declared in both blocks" pass on a
 *  token declared in a later, unrelated rule. */
function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(opener + ' {');
  expect(at, `${opener} must be findable — index.css's shape changed`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${opener} is never closed`);
}

/** Computed once — the brace walk is the most expensive thing in this file. */
const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `--color-${name} is not declared in this block`).not.toBeNull();
  return m![1].toLowerCase();
}

const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the field edge clears 3 : 1 on every surface, in both themes', () => {
  // `panel` binds: on /transactions six fields sit on `card` inside a `panel`,
  // so the stroke is read against `panel` and not the card behind it. Named,
  // not quoted as a hex — a hex here goes stale the moment the plane moves, and
  // it did.
  for (const theme of THEMES) {
    for (const edge of ['field-border', 'pos-border'] as const) {
      it(`${theme} \`${edge}\` is at or above 3 : 1 on page, card and panel`, () => {
        const block = BLOCKS[theme];
        const value = token(block, edge);
        for (const surface of SURFACES) {
          expect(
            ratio(value, token(block, surface)),
            `${edge} on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  // The inversion guard. Repairing the idle edge and leaving the saved one at
  // 1.53 would make a row appear to LOSE its boundary at the moment its value
  // is accepted — the defect the design session exists to prevent.
  for (const theme of THEMES) {
    it(`${theme} saved edge is at least as strong as idle, and within 1.10x`, () => {
      const block = BLOCKS[theme];
      const idle = token(block, 'field-border');
      const saved = token(block, 'pos-border');
      for (const surface of SURFACES) {
        const s = token(block, surface);
        const [ri, rs] = [ratio(idle, s), ratio(saved, s)];
        expect(rs, `saved vs idle on ${surface}`).toBeGreaterThanOrEqual(ri);
        expect(rs / ri, `saved/idle band on ${surface}`).toBeLessThanOrEqual(1.1);
      }
    });
  }

  it('declares `field-border` in `@theme` AND in the dark block', () => {
    expect(BLOCKS.light).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
    expect(BLOCKS.dark).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
  });

  // `faint` is a TEXT and INDICATOR rank, not a control boundary, and LIGHT
  // MUST STAY UNDER 3 : 1: `Scroller.tsx` rests its thumb below the bar
  // deliberately and argues it, so lifting this token reverses that and blanks
  // the drawer's dragged thumb. Pinned by hex rather than by ratio for exactly
  // that reason. The parchment palette re-derived both to hold the same
  // readings (#91).
  // TWO PLACES, WHERE THIS PINNED THREE. The third was `[data-dark-surface]`,
  // which gave the rail the dark values while the app was in light; #92 retired
  // the scope with the plane that needed it, so the drawer's thumb now reads
  // whichever of these two its theme declares — which is what every other
  // surface in the app already did.
  it('leaves `faint` at the rank it was derived for, in both blocks', () => {
    expect(token(BLOCKS.light, 'faint')).toBe('#b4aa9a');
    expect(token(BLOCKS.dark, 'faint')).toBe('#6e6a65');
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

/** TS comments out, QUOTE-EXACT and line by line. A regex reader that drops only
 *  whole-line `//` comments leaves the trailing ones, and then one apostrophe in
 *  English prose desynchronises every quote pair after it — which is what made
 *  this file blind in two of its nine sources. Copied from
 *  `floating-edges.test.ts` SIGNATURE AND ALL rather than imported, which is the
 *  house idiom: a guard stands alone and can be read without opening another. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i += 1) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i += 1;
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
        i += 1;
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** A field is `rounded-[9px]` AND `h-9`. The radius alone is not enough — a
 *  sidebar nav pill and a `Select` option row wear it too, which a first cut of
 *  this file learned by failing on them. The pair matches exactly eleven lines. */
const FIELD_LINE = (line: string) => /rounded-\[9px\]/.test(line) && /\bh-9\b/.test(line);

/** The palette's other border colours. One of these in a field's colour arm is
 *  the defect this file exists to catch, so a token that can be spelled
 *  `border-*` and is not a field state belongs here — a field on `panel-border`
 *  reads 1.44 : 1 on `panel` in light, its worst plane, and would otherwise be
 *  invisible to this file AND to `floating-edges.test.ts`, whose lines carry no
 *  popover shadow.
 *  Hand-kept because the palette gives no way to tell a border rank from a text
 *  one by name; the order is the four greys, then the control edge that is not
 *  a field's (`switch-border`, #87), then the one floating-surface edge left
 *  after #98, so the next one added has an obvious place to go. */
const OTHER_EDGE = /\bborder-(hairline|faint|panel-border|muted|switch-border|drawer-edge)\b/;

/** The edges a field may wear — every one a state the design sheet rules on.
 *  `ink` is absent deliberately: it is the HOVER destination, never a rest. */
const FIELD_EDGE = /\bborder-(field-border|neg|pos-border|warn)\b/;

/**
 * A FIELD SITE: one `className` attribute whose class list carries the recipe.
 *
 * ASKED OF THE SYNTAX, because three textual definitions each failed on a shape
 * prettier produces for free — arms above the recipe, `[…].join(' ')`, a
 * paren-grouped ternary, a class map whose sibling answered for the field. Which
 * element a class name belongs to is a question about the tree, so this reads the
 * tree: `typescript` is already a devDependency and parses TSX.
 *
 * A LIST IT CANNOT READ IS A FAILURE, NOT A SILENCE, and that is the rule the
 * whole file rests on. Every dangerous gap here is the same shape — an
 * expression the resolver does not model yields no strings, the recipe is not
 * found, and the field quietly stops being a field. So there is no node budget
 * and no fallback: an unread field yields no site, and `every field the tree
 * shows is a site the parse could read` below turns that into a red test naming
 * the file. A guard that cannot answer says so.
 */
function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Is this operator a STATE rather than a join? `a && 'border-x'` draws nothing
 *  when `a` is false, which is a state exactly as a ternary's other arm is. */
const isStateOperator = (n: ts.BinaryExpression) =>
  n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
  n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
  n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;

/** What a name is bound to, nearest declaration before `at` — two components in
 *  one file may each have a `const edge`, and unioning them makes one answer for
 *  the other in both directions. */
function declarationsOf(name: string, sf: ts.SourceFile, at: number): ts.Node[] {
  const found: { pos: number; node: ts.Node }[] = [];
  sf.forEachChild(function visit(n) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name) {
      if (n.initializer) found.push({ pos: n.pos, node: n.initializer });
    } else if (ts.isFunctionDeclaration(n) && n.name?.text === name) {
      found.push({ pos: n.pos, node: n });
    }
    n.forEachChild(visit);
  });
  const before = found.filter((f) => f.pos < at);
  const pick = before.length > 0 ? before[before.length - 1] : found[0];
  return pick ? [pick.node] : [];
}

/**
 * Every string an expression can produce. `at` is the reference position, so a
 * name resolves the way the compiler would; `seen` stops a cycle. When
 * `conditional` is false the walk skips the branches of a state — that is what
 * separates a class list's SHARED part from its arms, which no reading of the
 * joined text could tell apart.
 */
function classStrings(
  node: ts.Node | undefined,
  sf: ts.SourceFile,
  at: number,
  conditional = true,
  seen = new Set<ts.Node>(),
): string[] {
  if (!node || seen.has(node)) return [];
  seen.add(node);
  const go = (n: ts.Node | undefined) => classStrings(n, sf, at, conditional, seen);

  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    // CONCATENATED, NOT LISTED. A span abuts the text beside it, so
    // `` `border-${tone}` `` is one class name and listing the two halves let a
    // joined read see `border-` and `hairline` as separate words — a field on
    // `border-hairline` passed every assertion in this file.
    let out = node.head.text;
    const spans: string[] = [];
    for (const s of node.templateSpans) {
      const values = go(s.expression);
      if (values.length === 1) out += values[0] + s.literal.text;
      else {
        spans.push(...values);
        out += ` ${s.literal.text}`;
      }
    }
    return [out, ...spans];
  }
  if (ts.isConditionalExpression(node)) {
    return conditional ? [...go(node.whenTrue), ...go(node.whenFalse)] : [];
  }
  if (ts.isBinaryExpression(node)) {
    // `&&` draws its right side or nothing; `||` and `??` draw one side or the
    // other, so BOTH are alternatives and both have to be read — dropping the
    // left one made the ban blind on that side and invented an empty state.
    if (isStateOperator(node)) {
      if (!conditional) return [];
      const bothSides = node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken;
      return bothSides ? [...go(node.left), ...go(node.right)] : go(node.right);
    }
    return [...go(node.left), ...go(node.right)];
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return go(node.expression);
  if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(go);
  if (ts.isJsxExpression(node)) return go(node.expression);
  if (ts.isCallExpression(node)) {
    // `.join(' ')` and `cn(…)` alike: the arguments are the list, and a call to a
    // local helper is the list its `return`s produce.
    const target = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.expression
      : node.expression;
    return [...go(target), ...node.arguments.flatMap(go)];
  }
  if (ts.isIdentifier(node)) return declarationsOf(node.text, sf, at).flatMap(go);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    // `CLASSES.field` is the ONE property, never its siblings — a sibling
    // answering for a field is how a class map hid a field that drew no edge.
    // `CLASSES[state]` names no property at parse time, so every value is a
    // candidate and every one is held to the rules.
    const key = ts.isPropertyAccessExpression(node) ? node.name.text : undefined;
    const objects = ts.isIdentifier(node.expression)
      ? declarationsOf(node.expression.text, sf, at)
      : [];
    return objects.flatMap((o) =>
      ts.isObjectLiteralExpression(o)
        ? o.properties.flatMap((p) =>
            ts.isPropertyAssignment(p) && (key === undefined || p.name.getText(sf) === key)
              ? go(p.initializer)
              : [],
          )
        : [],
    );
  }
  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (node.body && !ts.isBlock(node.body)) return go(node.body);
    const out: string[] = [];
    node.body?.forEachChild(function visit(n) {
      if (ts.isReturnStatement(n)) out.push(...go(n.expression));
      else n.forEachChild(visit);
    });
    return out;
  }
  return [];
}

/** The branches of every state inside one class list — a ternary's two arms, or
 *  a `&&`'s string and the nothing it draws when the flag is false. A field
 *  draws an edge in EVERY state or it inherits `currentColor` in one of them. */
function stateBranches(
  node: ts.Node | undefined,
  sf: ts.SourceFile,
  at: number,
  seen = new Set<string>(),
): string[][][] {
  if (!node) return [];
  const out: string[][][] = [];
  const visit = (n: ts.Node) => {
    if (ts.isConditionalExpression(n)) {
      out.push([classStrings(n.whenTrue, sf, at), classStrings(n.whenFalse, sf, at)]);
    } else if (ts.isBinaryExpression(n) && isStateOperator(n)) {
      // `&&` draws nothing when the flag is false, and nothing is what has to be
      // caught. `||` and `??` always draw one side or the other, so neither
      // state is empty and both are alternatives.
      out.push(
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? // `['']` and not `[]`: a state that draws NOTHING is known, where an
            // empty result means the resolver could not read the expression at
            // all. The check below turns on that difference.
            [classStrings(n.right, sf, at), ['']]
          : [classStrings(n.left, sf, at), classStrings(n.right, sf, at)],
      );
    } else if (ts.isIdentifier(n) && !seen.has(n.text)) {
      seen.add(n.text);
      for (const d of declarationsOf(n.text, sf, at)) out.push(...stateBranches(d, sf, at, seen));
    }
    n.forEachChild(visit);
  };
  visit(node);
  return out;
}

interface ClassList {
  /** Every string the list can produce, arms included. */
  parts: string[];
  /** Only the unconditional strings — the part every state wears. */
  shared: string[];
  /** One entry per state, each holding that state's alternatives. */
  branches: string[][][];
}

/** Every `className` attribute in a file, as its own class list. */
function classLists(file: string): ClassList[] {
  const sf = parse(file);
  const out: ClassList[] = [];
  sf.forEachChild(function visit(n) {
    if (ts.isJsxAttribute(n) && n.name.getText(sf) === 'className') {
      const at = n.pos;
      out.push({
        parts: classStrings(n.initializer, sf, at),
        shared: classStrings(n.initializer, sf, at, false),
        branches: stateBranches(n.initializer, sf, at),
      });
    }
    n.forEachChild(visit);
  });
  return out;
}

/** A field in SOME STATE, not in the union of states it never wears at once: a
 *  button switching `h-9 rounded-[5px]` for `h-11 rounded-[9px]` is a field in
 *  neither, and reading the union conscripted it and then failed it three ways. */
const isField = (l: ClassList) =>
  l.branches.length === 0
    ? FIELD_LINE(l.parts.join(' '))
    : l.branches.some((states) => states.some((s) => FIELD_LINE([...l.shared, ...s].join(' '))));

/** Memoised, so the claim below is true: `FIELD_FILES` asks every `.tsx` in the
 *  tree and the assertions ask the survivors again. */
const parsed = new Map<string, ClassList[]>();
function fieldSites(file: string): ClassList[] {
  const hit = parsed.get(file);
  if (hit) return hit;
  const sites = classLists(file).filter(isField);
  parsed.set(file, sites);
  return sites;
}

/** Files the TREE says hold a field, which is the set every assertion runs over
 *  — a recipe split across two source lines is a field here and was invisible to
 *  the line-based discovery this replaced. */
const FIELD_FILES = sourceFiles(here)
  .map((f) => relative(here, f).split(sep).join('/'))
  .filter((f) => fieldSites(f).length > 0);

/** The one site with no hover, named rather than counted. The sheet rules that
 *  giving `QuoteRow`'s empty plain arm a hover is behaviour and not colour, so
 *  an empty bond row with a suggestion lights under the pointer and the empty
 *  REIT row beside it does not. Deliberate, and worth being able to see here. */
const UNHOVERED = { file: 'screens/daily-quotes/QuoteRow.tsx', arm: 'border-field-border' };

/** Parsed once. */
const SITES_BY_FILE = new Map(FIELD_FILES.map((f) => [f, fieldSites(f)]));
const ALL_SITES = [...SITES_BY_FILE].flatMap(([file, sites]) => sites.map((l) => ({ file, ...l })));
describe('every field points at the token', () => {
  it('finds the field files by walking, not from a list', () => {
    // The floor: a signature that stops matching must fail loudly rather than
    // turn this whole describe into an empty pass.
    expect(FIELD_FILES.length, 'no file draws a field any more').toBeGreaterThanOrEqual(3);
  });

  // INJECTION-VERIFIED: a new `src/screens/Goals.tsx` with one field on
  // `hairline` fails here. The previous hard-coded file list could not see it.
  //
  // A floor and not an equality — the rule `filled-track.test.ts` states in the
  // same words, "Only a vanished one fails here." An exact count would make a
  // correctly-styled twelfth field a suite failure whose only fix is editing a
  // number, which is the rot `index.css`'s own palette-count comment records.
  // WITH HEADROOM, because the number this guard would like to pin is the one
  // #84 is going to reduce: one shared field component collapses `AssetForm`'s
  // six sites to one, correctly, and a floor at today's seventeen would go red
  // on the refactor with no defect present. What a floor is for is an empty
  // pass, so it sits well below the count and says so.
  it('keeps the walk from going quiet', () => {
    expect(ALL_SITES.length, 'no field site survives the walk').toBeGreaterThanOrEqual(5);
  });

  // WHAT THIS GUARD DOES NOT CLOSE, named here because it is the one hole left
  // and a reader deserves to know rather than infer it. The resolver models the
  // shapes this app writes; a shape it does not model — a class list held in an
  // imported constant, a name shadowed in a callback — yields no strings, the
  // recipe is not found, and the field is not a site. A line-based tripwire over
  // the parse was tried and removed: it unions a ternary's arms exactly as the
  // reader this file replaced did, so it fails a control that is a field in no
  // single state. Distinguishing "cannot read" from "read and correct" needs a
  // type checker rather than a resolver, and #125 carries it.

  // EVERY STATE DRAWS AN EDGE, which the site total cannot answer: a field whose
  // rest arm is `bg-page` while the token sits in its invalid arm has the token
  // SOMEWHERE and no boundary at rest, so it inherits preflight's `currentColor`
  // exactly when nothing is wrong with it. The previous shapes of this file all
  // passed that, because the question is which strings are ALTERNATIVES — and
  // only the parse knows. The shared part may carry the edge for all of them.
  it.each(FIELD_FILES)('%s draws an edge in every state of every field', (file) => {
    for (const { shared, branches } of SITES_BY_FILE.get(file) ?? []) {
      // THE SHARED PART, asked of the tree: an arm that happens to carry the
      // recipe is still an arm, and using it as a proxy for "unconditional" let a
      // recipe written into the arms excuse the very check this test is named for.
      if (FIELD_EDGE.test(shared.join(' '))) continue;
      for (const ternary of branches) {
        // ONLY A TERNARY ABOUT THE EDGE. A field also switches its fill and its
        // size on state, and `bg === 'page' ? 'bg-page' : 'bg-card'` names no
        // boundary in either branch by design. One branch naming a border COLOUR
        // is what says the alternatives are edges.
        const named = new RegExp(`${FIELD_EDGE.source}|${OTHER_EDGE.source}`);
        if (!ternary.some((b) => named.test(b.join(' ')))) continue;
        for (const branch of ternary) {
          // UNKNOWN IS NOT EMPTY, and the difference is the honest limit of this
          // guard. A branch that resolved to no strings is one the resolver could
          // not read — a parameter, an import, a call it does not model — and
          // calling that "draws no edge" fails correct code. A branch that
          // resolved to strings with no edge in them is a real defect. Telling an
          // unreadable branch from one that genuinely draws nothing needs a type
          // checker, not a resolver; what is left unread is recorded in #125.
          if (branch.length === 0) continue;
          expect(
            FIELD_EDGE.test(branch.join(' ')),
            `${file}: one state of a field draws no edge — it inherits currentColor there`,
          ).toBe(true);
        }
      }
    }
  });

  // THE RANK, which is stricter than "an edge": `neg`, `pos-border` and `warn`
  // are states a field passes through, so a site naming only one of those draws
  // nothing at rest and would inherit preflight's `currentColor`. The `${`
  // escape hatch this needed is gone, because a deferral is followed now — and
  // to the NEAREST declaration, or a same-named decoy earlier in the file stands
  // in for the real one.
  //
  // INJECTION-VERIFIED: a field stripped of its rest edge fails; a popover
  // losing the token does not, and fails `floating-edges.test.ts` instead.
  it.each(FIELD_FILES)('%s names the rank on every field it draws', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(site, `${file}: a field draws no edge at rest`).toMatch(/\bborder-field-border\b/);
    }
  });

  // THE ASSERTION #100 EXISTS FOR, and the one the site scope buys. Whole-file,
  // it was blind wherever the arm reader desynchronised: a field wearing
  // `border-panel-border` beside the token passed every assertion in this file.
  // The site text is read whole, so an arm is covered by being part of it.
  it.each(FIELD_FILES)('%s names no non-field edge on a field', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(site, `${file}: a field names a non-field edge`).not.toMatch(OTHER_EDGE);
    }
  });
});

describe('hover leaves the resting edge behind', () => {
  // A FIELD HOVERS TO `ink` BECAUSE A FIELD TAKES FOCUS: its hover has to be
  // told apart from a 2px `ink` focus ring sitting on the same edge, and only
  // the top of the ladder manages that.
  //
  // THE ORIGINAL ARGUMENT IS SUPERSEDED, and saying so is the point of this
  // note. `field-border.dc.html:165` ruled `muted` out by a floor — "the weakest
  // hover shipping today, 1.55 light and 2.42 dark" — whose only member was the
  // import dropzone. #88 moved that box onto the rank with a `muted` hover, so
  // the floor has no member left, and its figures were pre-parchment besides.
  // The ruling stands on focus, which is the reason that survives; the dropzone
  // is not a field, takes no focus, and its own guard is `dropzone-edge.test.ts`.
  //
  // THAT BAN AND THE DROPZONE'S GUARD USED TO COLLIDE, and #100 is why they no
  // longer can. Both read whole files: this one banned `hover:border-muted`
  // across every FIELD_FILE and `dropzone-edge.test.ts` REQUIRES it in
  // `ImportRow.tsx`, so the two coexisted only while that file carried no
  // `rounded-[9px] h-9` line. #84's shared recipe would have ended that.
  // PER SITE the two bans never meet: the dropzone is not a field, so this file
  // has nothing to say about its hover however that file grows.
  //
  // WHAT IS AND IS NOT CLOSED, stated exactly, because two earlier notes here
  // each claimed more than the injection showed. A real field in `ImportRow.tsx`
  // leaves THIS file green. It still meets that file's own WHOLE-FILE
  // assertions: the fill census, which counts the two fills the dropzone
  // declares and a field carries a third; and the `border-dashed` ban, which a
  // field wearing QuoteRow's dashed suggestion arm would trip with a message
  // about the drop target. Those are one guard's contract answering a real
  // change, not two guards contradicting each other — but they are not nothing,
  // and a field landing there means reading them too.
  it.each(FIELD_FILES)('%s hovers to neither `faint` nor `muted` on a field', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(site, `${file}: a field still hovers to faint`).not.toMatch(/hover:border-faint/);
      expect(site, `${file}: a field still hovers to muted`).not.toMatch(/hover:border-muted/);
    }
  });

  // NAMED RATHER THAN COUNTED, which is the other half of #100. It was
  // `edges - hovers === 1` over a concatenation of nine files plus a literal pin
  // on `QuoteRow`'s source — two figures that moved whenever the token did. Now
  // it is a rule with one exception, and the exception has to be spelled exactly
  // where it lives, so losing it fails here rather than passing quietly.
  //
  // SORTED, not positional: `sourceFiles` walks `readdirSync` with no `sort`,
  // which is alphabetical on NTFS and hash order on the ext4 the deploy gate
  // runs on, so a positional array would go red on CI alone the moment a second
  // exception is ruled.
  // PER ARM, and the parser is what makes an arm well defined: each part of a
  // site is one ternary branch or one list member. Netted over the whole site, a
  // hover on the `neg` arm cancelled a missing one on the rest arm and the field
  // never lit; counted per part, a hover written ONCE in the shared flat list
  // still covers the arm that carries the edge, which is a legitimate shape.
  it('pairs every field rest edge with an `ink` hover, except the named one', () => {
    const unhovered: string[] = [];
    for (const { file, parts, shared } of ALL_SITES) {
      // Hoisted means the SHARED part — the one carrying the recipe — carries the
      // hover, which covers every arm. A hover in a sibling ARM covers nothing,
      // and reading the whole site as one string could not tell the two apart.
      const hoisted = /hover:border-ink\b/.test(shared.join(' '));
      for (const part of parts) {
        if (!/\bborder-field-border\b/.test(part)) continue;
        if (/hover:border-ink\b/.test(part) || hoisted) continue;
        unhovered.push(file);
      }
    }
    expect(unhovered.sort(), 'a field rest edge lost its `ink` hover').toEqual([UNHOVERED.file]);
    // The arm itself, read off the field's own site: the whole-file question is
    // the one this issue replaced, and it would let any string in
    // `QuoteRow.tsx` spelled `border-field-border` — the OfferLine button's, if
    // it were ever trimmed — stand in for the field's own deleted one.
    const arms = (SITES_BY_FILE.get(UNHOVERED.file) ?? []).flatMap((l) => l.parts);
    expect(arms, 'QuoteRow no longer carries the one arm that is the token alone').toContain(
      UNHOVERED.arm,
    );
  });
});

describe('what the ruling deliberately does not touch', () => {
  it('the three dashed CONTAINERS keep `faint`', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
      'screens/TransactionPanel.tsx',
    ]) {
      expect(stripTs(read(file)), `${file} lost its dashed container edge`).toMatch(
        /border-dashed border-faint/,
      );
    }
  });

  // `Select`'s two arms resolve to one token, so the prop was one behaviour with
  // two spellings. `isNewAsset` is NOT collateral: it gates the quick-create
  // sub-form and `transaction-form-reset.test.ts` pins its declaration.
  it('drops the `borderColor` variant but keeps `isNewAsset`', () => {
    expect(stripTs(read('components/ui/Select.tsx'))).not.toMatch(/borderColor/);
    expect(stripTs(read('screens/TransactionPanel.tsx'))).not.toMatch(/borderColor=/);
    expect(read('screens/TransactionPanel.tsx')).toMatch(
      /const isNewAsset = needsAsset && pickedNew;/,
    );
  });

  // Stated as "do not re-token them", not "keep this exact class": their border
  // paints no pixel — no width utility, and a native control the UA draws — so
  // deleting the dead class later is a correct cleanup this must not fail.
  it('leaves the checkboxes off the field token', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
    ]) {
      const checkbox = stripTs(read(file))
        .split('\n')
        .filter((l) => /rounded-\[5px\]/.test(l));
      expect(checkbox.length, `${file}: the checkbox line vanished`).toBeGreaterThan(0);
      for (const line of checkbox) expect(line).not.toMatch(/border-field-border/);
    }
  });

  // THE ONE SITE THAT LEFT THE CENSUS WITH #100, pinned so the coverage is not
  // lost with it. `QuoteRow`'s OfferLine accept button wears the rank at
  // `rounded-[7px]` and no `h-9`, so it is a control boundary and not a field —
  // it was the thirteenth of #98's thirteen, and the field census reads twelve
  // without it. Anchored on its own recipe rather than on a line number.
  it('keeps the OfferLine button on the rank, though it is no field', () => {
    // THE RADIUS PAIRED WITH AN EDGE, the way `FIELD_LINE` pairs it with `h-9`:
    // twelve of the fourteen `rounded-[7px]` uses in `src/` are segmented pills
    // and icon buttons carrying no border at all, so the radius alone would
    // conscript the next one added here and fail about a button it is not.
    const offer = classLists('screens/daily-quotes/QuoteRow.tsx')
      .map((l) => l.parts.join(' '))
      .filter((l) => /rounded-\[7px\]/.test(l) && /\bborder-dashed\b/.test(l));
    expect(offer.length, 'the OfferLine button lost its own radius').toBeGreaterThanOrEqual(1);
    for (const site of offer) {
      expect(site, 'the OfferLine button left the control-boundary rank').toMatch(
        /\bborder-field-border\b/,
      );
      // THE BAN AS WELL AS THE PRESENCE. Whole-file, the old colour-arm pass
      // covered this button too; pinning only that the rank is there would hand
      // back the "added beside the token" defect on the one control the field
      // census no longer sees. A floor and a loop, not `toBe(1)`: a second
      // `rounded-[7px]` control would otherwise fail with a message about a lost
      // radius and go unguarded besides.
      expect(site, 'the OfferLine button names a non-field edge').not.toMatch(OTHER_EDGE);
    }
  });
});
