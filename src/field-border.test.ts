import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// THE FIELD EDGE, at the bar `design/extensions/field-border.dc.html` set: no field
// boundary reads below 3 : 1 (WCAG 1.4.11) on any of the three surfaces a field is drawn
// on. Two halves and neither catches the other — the CSS half is arithmetic on tokens no
// other test in the repo reads, and the markup half is which recipes point at the token,
// written out eleven times separately because there is no shared input component (#84).
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** COMMENTS OUT BEFORE ANY TOKEN IS READ: `token()` takes the first match in a block and
 *  this stylesheet quotes declarations constantly, retired values included. Quote-aware,
 *  because `index.css` holds `/*` inside a string and a naive reader takes `@theme` with it. */
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

/** sRGB → relative luminance, WCAG 2.x. There is no colour helper to reuse: `core/colors.ts`
 *  owns the chart SERIES and no contrast maths. */
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

/** The span of a `selector { … }` rule, matched on its own braces. BOTH sides are
 *  bounded: unbounded, "declared in both blocks" passed on a later, unrelated rule. */
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

const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `--color-${name} is not declared in this block`).not.toBeNull();
  return m![1].toLowerCase();
}

/** `panel` binds: on /transactions six fields sit on `card` inside a `panel`. Named and
 *  never quoted as a hex — a hex goes stale the moment the plane moves, and it did. */
const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the field edge clears 3 : 1 on every surface, in both themes', () => {
  for (const theme of THEMES) {
    for (const edge of ['field-border', 'pos-border'] as const) {
      it(`${theme} \`${edge}\` is at or above 3 : 1 on page, card and panel`, () => {
        const block = BLOCKS[theme];
        const value = token(block, edge);
        for (const surface of SURFACES) {
          expect(
            ratio(value, token(block, surface)),
            `${edge} reads under 3 : 1 on ${surface} — the boundary is gone at the bar`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  for (const theme of THEMES) {
    it(`${theme} saved edge is at least as strong as idle, and within 1.10x`, () => {
      const block = BLOCKS[theme];
      const idle = token(block, 'field-border');
      const saved = token(block, 'pos-border');
      for (const surface of SURFACES) {
        const s = token(block, surface);
        const [ri, rs] = [ratio(idle, s), ratio(saved, s)];
        expect(
          rs,
          `on ${surface} a row LOSES its boundary the moment its value is accepted`,
        ).toBeGreaterThanOrEqual(ri);
        // AND WITHIN A BAND, which catches the opposite drift: a saved edge pulled far ahead
        // of idle makes accepting a value a restyle rather than a confirmation.
        expect(
          rs / ri,
          `on ${surface} the saved edge has pulled away from the idle one`,
        ).toBeLessThanOrEqual(1.1);
      }
    });
  }

  it('declares `field-border` in `@theme` AND in the dark block', () => {
    expect(BLOCKS.light).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
    expect(BLOCKS.dark).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
  });

  // `faint` is a TEXT and INDICATOR rank, and LIGHT MUST STAY UNDER 3 : 1: `Scroller.tsx`
  // rests its thumb below the bar deliberately and argues it, so lifting this token blanks
  // the drawer's dragged thumb. Pinned by hex rather than by ratio for that reason.
  it('leaves `faint` at the rank it was derived for, in both blocks', () => {
    expect(
      token(BLOCKS.light, 'faint'),
      'light `faint` was lifted to a control rank, which blanks the drawer\u2019s dragged thumb',
    ).toBe('#b4aa9a');
    expect(token(BLOCKS.dark, 'faint')).toBe('#6e6a65');
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

/** Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** A field is `rounded-[9px]` AND `h-9`. The radius alone conscripts a sidebar nav pill
 *  and a `Select` option row, which a first cut of this file learned by failing on them. */
const FIELD_LINE = (line: string) => /rounded-\[9px\]/.test(line) && /\bh-9\b/.test(line);

/** The palette's other border colours — one in a field's colour arm is the defect this
 *  file exists to catch, so any token spellable `border-*` that is not a field state
 *  belongs here. Hand-kept, because the palette gives no way to tell a border rank from a
 *  text one by name; the order is the four greys, then the control edge that is not a
 *  field's, then the floating-surface edge, so the next one added has an obvious place. */
const OTHER_EDGE = /\bborder-(hairline|faint|panel-border|muted|switch-border|drawer-edge)\b/;

/** The edges a field may wear, every one a state the design sheet rules on. `ink` is
 *  absent deliberately: it is the HOVER destination, never a rest. */
const FIELD_EDGE = /\bborder-(field-border|neg|pos-border|warn)\b/;

/** A FIELD SITE: one `className` attribute carrying the recipe. Asked of the TSX tree,
 *  not the text — which element a class name belongs to is a question about the tree, and
 *  no reading of the joined string tells a ternary's arms from the part every state
 *  wears. AN EXPRESSION THE RESOLVER CANNOT MODEL YIELDS NO SITE, and nothing here goes
 *  red for it — the walk floor sits far below the count. That hole is stated in full below
 *  and #125 carries it. */
function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** Is this operator a STATE rather than a join? `a && 'border-x'` draws nothing when `a` is
 *  false, which is a state exactly as a ternary's other arm is. */
const isStateOperator = (n: ts.BinaryExpression) =>
  n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
  n.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
  n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken;

/** Nearest declaration before `at`, never the union: two components in one file may each
 *  have a `const edge`, and unioning them makes one answer for the other both ways. */
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

/** `conditional: false` skips a state's branches — what separates a class list's SHARED
 *  part from its arms. */
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
    // CONCATENATED, NOT LISTED: a span abuts the text beside it, so listing the two halves
    // let a joined read see `border-` and `hairline` as separate words.
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
    // `&&` draws its right side or nothing; `||` and `??` draw one side OR THE OTHER, so both
    // of those are alternatives and both have to be read — reading only the right one made
    // the ban blind on that side and invented an empty state.
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
    const target = ts.isPropertyAccessExpression(node.expression)
      ? node.expression.expression
      : node.expression;
    return [...go(target), ...node.arguments.flatMap(go)];
  }
  if (ts.isIdentifier(node)) return declarationsOf(node.text, sf, at).flatMap(go);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    // `CLASSES.field` is the ONE property, never its siblings — a sibling answering for a
    // field is how a class map hid a field that drew no edge.
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

/** A field draws an edge in EVERY state, or it inherits `currentColor` in one of them. */
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
      // `&&` draws nothing when the flag is false, and nothing is what has to be caught.
      out.push(
        n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
          ? // `['']` and not `[]`: a state that draws NOTHING is known, where an empty
            // result means the resolver could not read the expression at all.
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

/** A field in SOME STATE, never the union of states it never wears at once: a button
 *  switching `h-9 rounded-[5px]` for `h-11 rounded-[9px]` is a field in neither. */
const isField = (l: ClassList) =>
  l.branches.length === 0
    ? FIELD_LINE(l.parts.join(' '))
    : l.branches.some((states) => states.some((s) => FIELD_LINE([...l.shared, ...s].join(' '))));

const parsed = new Map<string, ClassList[]>();
function fieldSites(file: string): ClassList[] {
  const hit = parsed.get(file);
  if (hit) return hit;
  const sites = classLists(file).filter(isField);
  parsed.set(file, sites);
  return sites;
}

/** Asked of the TREE: a recipe split across two source lines is a field here, and was
 *  invisible to the line-based discovery this replaced. */
const FIELD_FILES = sourceFiles(here)
  .map((f) => relative(here, f).split(sep).join('/'))
  .filter((f) => fieldSites(f).length > 0);

/** The one site with no hover, named rather than counted: the sheet rules that giving
 *  `QuoteRow`'s empty plain arm a hover is behaviour and not colour. */
const UNHOVERED = { file: 'screens/daily-quotes/QuoteRow.tsx', arm: 'border-field-border' };

const SITES_BY_FILE = new Map(FIELD_FILES.map((f) => [f, fieldSites(f)]));
const ALL_SITES = [...SITES_BY_FILE].flatMap(([file, sites]) => sites.map((l) => ({ file, ...l })));
describe('every field points at the token', () => {
  // INJECTION-VERIFIED: a new `src/screens/Goals.tsx` with one field on `hairline` fails here,
  // where the hard-coded file list this replaced could not see it.
  it('finds the field files by walking, not from a list', () => {
    expect(FIELD_FILES.length, 'no file draws a field any more').toBeGreaterThanOrEqual(3);
  });

  // A floor with headroom, not an equality: #84's shared component will legitimately
  // collapse `AssetForm`'s six sites to one.
  it('keeps the walk from going quiet', () => {
    expect(ALL_SITES.length, 'no field site survives the walk').toBeGreaterThanOrEqual(5);
  });

  // THE HOLE LEFT, named rather than inferred: a shape the resolver does not model — a
  // class list in an imported constant, a name shadowed in a callback — yields no strings
  // and the field is not a site. Telling that from "read and correct" needs a type
  // checker, and #125 carries it.

  // EVERY STATE DRAWS AN EDGE, which the site total cannot answer: a field whose rest arm
  // is `bg-page` while the token sits in its invalid arm has the token SOMEWHERE and no
  // boundary at rest. Which strings are ALTERNATIVES only the parse knows.
  it.each(FIELD_FILES)('%s draws an edge in every state of every field', (file) => {
    for (const { shared, branches } of SITES_BY_FILE.get(file) ?? []) {
      // THE SHARED PART, asked of the tree: an arm that happens to carry the recipe is
      // still an arm, and using it as a proxy for "unconditional" excused this very check.
      if (FIELD_EDGE.test(shared.join(' '))) continue;
      for (const ternary of branches) {
        // ONLY A TERNARY ABOUT THE EDGE: `bg === 'page' ? 'bg-page' : 'bg-card'` names no
        // boundary by design, and one branch naming a border COLOUR is what says these
        // alternatives are edges.
        const named = new RegExp(`${FIELD_EDGE.source}|${OTHER_EDGE.source}`);
        if (!ternary.some((b) => named.test(b.join(' ')))) continue;
        for (const branch of ternary) {
          // UNKNOWN IS NOT EMPTY: a branch that resolved to no strings is one the resolver
          // could not read, and calling that "draws no edge" fails correct code (#125).
          if (branch.length === 0) continue;
          expect(
            FIELD_EDGE.test(branch.join(' ')),
            `${file}: one state of a field draws no edge — it inherits currentColor there`,
          ).toBe(true);
        }
      }
    }
  });

  // THE RANK, stricter than "an edge": `neg`, `pos-border` and `warn` are states a field
  // passes through, so a site naming only one of them draws nothing at rest.
  // INJECTION-VERIFIED: a field stripped of its rest edge fails here; a popover losing the
  // token does not, and fails `floating-edges.test.ts` instead.
  it.each(FIELD_FILES)('%s names the rank on every field it draws', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(site, `${file}: a field draws no edge at rest`).toMatch(/\bborder-field-border\b/);
    }
  });

  it.each(FIELD_FILES)('%s names no non-field edge on a field', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(
        site,
        `${file}: a field names a non-field edge. Asked per SITE, because read whole-file ` +
          'one wearing `border-panel-border` beside the token passed every assertion here',
      ).not.toMatch(OTHER_EDGE);
    }
  });
});

describe('hover leaves the resting edge behind', () => {
  // A FIELD HOVERS TO `ink` BECAUSE A FIELD TAKES FOCUS: the hover has to be told apart
  // from a 2px `ink` focus ring on the same edge, and only the top of the ladder manages it.
  //
  // PER SITE IS WHY THIS CANNOT COLLIDE WITH `dropzone-edge.test.ts`, which REQUIRES the
  // `hover:border-muted` this bans. Whole-file, the two coexisted only while `ImportRow.tsx`
  // carried no `rounded-[9px] h-9` line; a dropzone is no field, so per site they never meet.
  it.each(FIELD_FILES)('%s hovers to neither `faint` nor `muted` on a field', (file) => {
    for (const { parts } of SITES_BY_FILE.get(file) ?? []) {
      const site = parts.join(' ');
      expect(site, `${file}: a field still hovers to faint`).not.toMatch(/hover:border-faint/);
      expect(site, `${file}: a field still hovers to muted`).not.toMatch(/hover:border-muted/);
    }
  });

  // PER ARM: netted over a whole site, a hover on the `neg` arm cancelled a missing one on
  // the rest arm and the field never lit. SORTED, not positional — `readdirSync` is
  // alphabetical on NTFS and hash order on the ext4 CI runs on.
  it('pairs every field rest edge with an `ink` hover, except the named one', () => {
    const unhovered: string[] = [];
    for (const { file, parts, shared } of ALL_SITES) {
      // Hoisted is the SHARED part carrying the hover, which covers every arm; a hover in a
      // sibling ARM covers nothing, and one joined string cannot tell the two apart.
      const hoisted = /hover:border-ink\b/.test(shared.join(' '));
      for (const part of parts) {
        if (!/\bborder-field-border\b/.test(part)) continue;
        if (/hover:border-ink\b/.test(part) || hoisted) continue;
        unhovered.push(file);
      }
    }
    expect(unhovered.sort(), 'a field rest edge lost its `ink` hover').toEqual([UNHOVERED.file]);
    const arms = (SITES_BY_FILE.get(UNHOVERED.file) ?? []).flatMap((l) => l.parts);
    expect(
      arms,
      'QuoteRow no longer carries the one arm that is the token alone — read off the ' +
        "field's own site, so no other string in the file can stand in for it",
    ).toContain(UNHOVERED.arm);
  });
});

describe('what the ruling deliberately does not touch', () => {
  it('the three dashed CONTAINERS keep `faint`', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
      'screens/TransactionPanel.tsx',
    ]) {
      expect(stripTs(read(file), file), `${file} lost its dashed container edge`).toMatch(
        /border-dashed border-faint/,
      );
    }
  });

  // `Select`'s two arms resolve to one token, so the prop was one behaviour with two
  // spellings. `isNewAsset` is NOT collateral: `transaction-form-reset.test.ts` pins it.
  it('drops the `borderColor` variant but keeps `isNewAsset`', () => {
    expect(stripTs(read('components/ui/Select.tsx'), 'components/ui/Select.tsx')).not.toMatch(
      /borderColor/,
    );
    expect(
      stripTs(read('screens/TransactionPanel.tsx'), 'screens/TransactionPanel.tsx'),
    ).not.toMatch(/borderColor=/);
    expect(stripTs(read('screens/TransactionPanel.tsx'), 'screens/TransactionPanel.tsx')).toMatch(
      /const isNewAsset = needsAsset && pickedNew;/,
    );
  });

  // "Do not re-token them", not "keep this exact class": their border paints no pixel — no
  // width utility, a native control the UA draws — so deleting the dead class is correct.
  it('leaves the checkboxes off the field token', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
    ]) {
      const checkbox = stripTs(read(file), file)
        .split('\n')
        .filter((l) => /rounded-\[5px\]/.test(l));
      expect(checkbox.length, `${file}: the checkbox line vanished`).toBeGreaterThan(0);
      for (const line of checkbox) expect(line).not.toMatch(/border-field-border/);
    }
  });

  // THE ONE SITE THE FIELD CENSUS DOES NOT SEE, pinned so its coverage is not lost with it:
  // `QuoteRow`'s OfferLine button wears the rank at `rounded-[7px]` and no `h-9`, so it is a
  // control boundary and not a field.
  it('keeps the OfferLine button on the rank, though it is no field', () => {
    // THE RADIUS PAIRED WITH AN EDGE, the way `FIELD_LINE` pairs it with `h-9`: most
    // `rounded-[7px]` uses are pills and icon buttons carrying no border at all.
    const offer = classLists('screens/daily-quotes/QuoteRow.tsx')
      .map((l) => l.parts.join(' '))
      .filter((l) => /rounded-\[7px\]/.test(l) && /\bborder-dashed\b/.test(l));
    expect(offer.length, 'the OfferLine button lost its own radius').toBeGreaterThanOrEqual(1);
    for (const site of offer) {
      expect(site, 'the OfferLine button left the control-boundary rank').toMatch(
        /\bborder-field-border\b/,
      );
      // THE BAN AS WELL AS THE PRESENCE: pinning only that the rank is there hands back the
      // "added beside the token" defect on the one control the field census no longer sees.
      expect(site, 'the OfferLine button names a non-field edge').not.toMatch(OTHER_EDGE);
    }
  });
});
