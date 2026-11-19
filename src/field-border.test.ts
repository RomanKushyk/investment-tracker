import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { ratio, resolve, stripCss, themeBlocks } from './__fixtures__/palette';
import { FIELD_EDGES, FIELD_FILLS, fieldVariants } from './components/ui/field-variants';

// THE FIELD EDGE, at its bar
// (`docs/superpowers/specs/2026-11-05-layout-refresh/forms-and-dialogs.md` § Signed): no field
// boundary reads below 3 : 1 (WCAG 1.4.11) on any of the three surfaces a field is drawn on. Two
// halves and neither catches the other — the CSS half is arithmetic on tokens no other test in
// the repo reads, and the markup half is the one recipe that points at the token,
// `fieldVariants`, which no file may copy.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

const BLOCKS = themeBlocks(CSS);

/** `panel` binds: on /transactions six fields sit on `card` inside a `panel`. Named and
 *  never quoted as a hex — a hex goes stale the moment the plane moves, and it did. */
const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the field edge clears 3 : 1 on every surface, in both themes', () => {
  for (const theme of THEMES) {
    for (const edge of ['field-border', 'pos-border'] as const) {
      it(`${theme} \`${edge}\` is at or above 3 : 1 on page, card and panel`, () => {
        const value = resolve(BLOCKS, theme, edge);
        for (const surface of SURFACES) {
          expect(
            ratio(value, resolve(BLOCKS, theme, surface)),
            `${edge} reads under 3 : 1 on ${surface} — the boundary is gone at the bar`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  for (const theme of THEMES) {
    it(`${theme} saved edge is at least as strong as idle, and within 1.10x`, () => {
      const idle = resolve(BLOCKS, theme, 'field-border');
      const saved = resolve(BLOCKS, theme, 'pos-border');
      for (const surface of SURFACES) {
        const s = resolve(BLOCKS, theme, surface);
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
      resolve(BLOCKS, 'light', 'faint'),
      'light `faint` was lifted to a control rank, which blanks the drawer\u2019s dragged thumb',
    ).toBe('#b4aa9a');
    expect(resolve(BLOCKS, 'dark', 'faint')).toBe('#6e6a65');
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

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

/** The edges a field may wear, every one a state. `ink` is absent deliberately: it is the
 *  HOVER destination, never a rest. */
const FIELD_EDGE = /\bborder-(field-border|neg|pos-border|warn)\b/;

/** A FIELD SITE: one `className` attribute carrying the recipe. Asked of the TSX tree,
 *  not the text — which element a class name belongs to is a question about the tree, and
 *  no reading of the joined string tells a ternary's arms from the part every state
 *  wears. AN EXPRESSION THE RESOLVER CANNOT MODEL YIELDS NO SITE, and nothing here goes
 *  red for it — a copy held in an imported constant or behind a shadowed name passes the ban.
 *  #125 carries that hole. */
const trees = new Map<string, ts.SourceFile>();
function parse(file: string): ts.SourceFile {
  const hit = trees.get(file);
  if (hit) return hit;
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, kind);
  trees.set(file, sf);
  return sf;
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

/** Every `.tsx` the walk reads, as a path relative to `src/`. */
const SOURCES = sourceFiles(here).map((f) => relative(here, f).split(sep).join('/'));

/** A placeholder draws the box a field will fill, in the field's size and radius, and is no
 *  field — which makes it the walk's live positive control. */
const PLACEHOLDERS = 'screens/placeholders.tsx';

const RECIPE = 'components/ui/field-variants.ts';

/** Every non-test `.ts` module under `src/`. */
function moduleFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...moduleFiles(full));
    else if (/\.ts$/.test(entry) && !/\.(test|d)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}
const MODULES = moduleFiles(here).map((f) => relative(here, f).split(sep).join('/'));

/** Every string a file spells, a template's literal text joined. */
function literals(file: string): string[] {
  const sf = parse(file);
  const out: string[] = [];
  sf.forEachChild(function visit(n) {
    if (ts.isStringLiteralLike(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      out.push([n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' '));
    }
    n.forEachChild(visit);
  });
  return out;
}

/** Every file but the recipe's own that the call walk reads. */
const READ = [...SOURCES, ...MODULES].filter((f) => f !== RECIPE);

/** The files that import the recipe's FUNCTION as a value, asked of their import declarations:
 *  a type-only import of `FieldFill` calls nothing. */
const IMPORTERS = READ.filter((f) =>
  parse(f).statements.some(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      /\/field-variants$/.test(s.moduleSpecifier.text) &&
      !s.importClause?.isTypeOnly &&
      s.importClause?.namedBindings !== undefined &&
      ts.isNamedImports(s.importClause.namedBindings) &&
      s.importClause.namedBindings.elements.some(
        (e) => !e.isTypeOnly && (e.propertyName ?? e.name).text === 'fieldVariants',
      ),
  ),
);

interface RecipeCall {
  className: string[];
  edge: string[];
  /** A spread, or an argument that is no object literal: what it passes cannot be read. */
  unreadable: boolean;
}

const calls = new Map<string, RecipeCall[]>();
/** Each `fieldVariants(…)` call in a file: what its `className` and its `edge` can be. */
function recipeCalls(file: string): RecipeCall[] {
  const hit = calls.get(file);
  if (hit) return hit;
  const sf = parse(file);
  const out: RecipeCall[] = [];
  sf.forEachChild(function visit(n) {
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'fieldVariants'
    ) {
      const [arg] = n.arguments;
      const object = arg && ts.isObjectLiteralExpression(arg) ? arg : undefined;
      const prop = (name: string) =>
        (object?.properties ?? []).flatMap((p) =>
          ts.isPropertyAssignment(p) && p.name.getText(sf) === name
            ? classStrings(p.initializer, sf, n.pos)
            : ts.isShorthandPropertyAssignment(p) && p.name.text === name
              ? classStrings(p.name, sf, n.pos)
              : [],
        );
      out.push({
        className: prop('className'),
        edge: prop('edge'),
        unreadable:
          (arg !== undefined && !object) ||
          (object?.properties.some(ts.isSpreadAssignment) ?? false),
      });
    }
    n.forEachChild(visit);
  });
  calls.set(file, out);
  return out;
}

/** The files that call the recipe, asked of the calls themselves. */
const CALLERS = READ.filter((f) => recipeCalls(f).length > 0);

/** A class the recipe owns — its edge, fill, height or radius — written where CSS order picks
 *  between it and the recipe's own. Only a GEOMETRY change at a breakpoint is the caller's,
 *  winning by its media query: that is how QuoteRow's 44 px box below md is drawn. An edge or a
 *  fill at a breakpoint is still a second edge or fill. */
const ownedClass = (token: string) => {
  const parts = token.split(':');
  const utility = parts.pop()!.replace(/^!/, '');
  const responsive = parts.some((p) => /^(max-)?(sm|md|lg|xl|2xl)$/.test(p));
  if (/^(border(-|$)|bg-)/.test(utility)) return true;
  return !responsive && /^(h-|rounded(-|$))/.test(utility);
};

describe('the field recipe lives in one place', () => {
  // WITHOUT THIS THE BAN BELOW PASSES ON A BROKEN WALK: a walk that recognises nothing finds
  // no copy anywhere.
  it('still recognises a field-shaped class list', () => {
    expect(
      fieldSites(PLACEHOLDERS).length,
      'the walk no longer sees the field-shaped placeholder boxes',
    ).toBeGreaterThanOrEqual(1);
  });

  // Asked of the TREE, so a recipe split across lines or held in a local constant is a copy.
  it('no file spells the field recipe instead of calling `fieldVariants`', () => {
    const copies = SOURCES.filter((f) => f !== PLACEHOLDERS).filter(
      (f) => fieldSites(f).length > 0,
    );
    expect(copies, 'these files draw a field by hand — call `fieldVariants`').toEqual([]);
  });

  // The walk above reads `className` attributes only, so a recipe held in a constant — in a
  // `.ts` module like `tap-target.ts`, or exported from a `.tsx` — would pass it.
  it('no string anywhere holds the field recipe but `field-variants.ts`', () => {
    const copies = [...MODULES, ...SOURCES]
      .filter((f) => f !== RECIPE && f !== PLACEHOLDERS)
      .filter((f) => literals(f).some(FIELD_LINE));
    expect(copies, 'these files hold a second field recipe').toEqual([]);
  });

  // WITHOUT THIS THE CHECKS BELOW PASS ON A WALK THAT READS NO CALL.
  it('finds a call in every file that imports the recipe', () => {
    expect(CALLERS.length, 'the walk reads no `fieldVariants` call').toBeGreaterThan(0);
    expect(IMPORTERS.filter((f) => !CALLERS.includes(f))).toEqual([]);
  });

  // A SPREAD OR A FORWARDED OPTIONS OBJECT IS RED: the walk cannot read it, and it would clear
  // every check below with nothing checked. THE TRUST BOUNDARY: a property the walk cannot
  // resolve — a class passed in through a component's own `className` prop (Select,
  // DatePicker), an imported constant, a recipe split across concatenated literals — reads as
  // empty and passes. Closing it needs a resolver that follows values across files (#125).
  it.each(CALLERS)('%s passes the recipe a readable object', (file) => {
    for (const { unreadable } of recipeCalls(file)) {
      expect(unreadable, `${file} spreads or forwards the recipe's options`).toBe(false);
    }
  });

  // THE EDGE, FILL, HEIGHT AND RADIUS ARE THE RECIPE'S: the same property in a caller's
  // `className` sits beside the recipe's own, and generated-CSS order picks which one paints.
  it.each(CALLERS)('%s passes no class the recipe owns', (file) => {
    for (const { className } of recipeCalls(file)) {
      const owned = className.flatMap((c) => c.split(/\s+/)).filter(ownedClass);
      expect(owned, `${file} restates the recipe in its className`).toEqual([]);
    }
  });

  // The one state with no hover, named rather than counted: giving `QuoteRow`'s empty plain
  // arm a hover is behaviour and not colour.
  it('keeps `quiet` to QuoteRow', () => {
    const users = CALLERS.filter((f) => recipeCalls(f).some((c) => c.edge.includes('quiet')));
    expect(users, '`quiet` spread past the one field that has no hover').toEqual([
      'screens/daily-quotes/QuoteRow.tsx',
    ]);
  });
});

const classes = (c: string) => c.split(/\s+/).filter(Boolean);

describe('the one field recipe', () => {
  it.each(FIELD_FILLS)('is 36 px at r9 with a 1 px edge on `%s`', (fill) => {
    for (const edge of FIELD_EDGES) {
      expect(classes(fieldVariants({ fill, edge }))).toEqual(
        expect.arrayContaining(['h-9', 'rounded-[9px]', 'border', `bg-${fill}`]),
      );
    }
  });

  it('rests on `page` and the rest edge when a caller names neither', () => {
    expect(classes(fieldVariants())).toEqual(
      expect.arrayContaining(['bg-page', 'border-field-border', 'hover:border-ink']),
    );
    expect(fieldVariants()).not.toMatch(/\bbg-card\b/);
  });

  // P2: the Select's and the date picker's triggers are wave 8's field, on `page`. The rendered
  // classes are pinned beside each component; this holds the default the callers lean on.
  it.each(['components/ui/Select.tsx', 'components/ui/DatePicker.tsx'])(
    '%s rests its trigger on `page` when a caller names no fill',
    (file) => {
      expect(stripTs(read(file), file)).toMatch(/\bbg = 'page'/);
    },
  );

  // cva reads `null` as "no class for this variant", so a field would inherit `currentColor`.
  // The recipe's type refuses it; the directive below fails `pnpm typecheck` if that lapses.
  it('takes no `null` state', () => {
    // @ts-expect-error `null` is no state
    const refused = () => fieldVariants({ edge: null });
    expect(refused).toBeTypeOf('function');
  });

  // EVERY STATE DRAWS AN EDGE, or the field inherits `currentColor` in it (WCAG 1.4.11 holds
  // per state).
  it.each(FIELD_EDGES)('`%s` draws a field edge and no other', (edge) => {
    const c = fieldVariants({ edge });
    expect(c, `${edge} draws no field edge`).toMatch(FIELD_EDGE);
    expect(c, `${edge} names a non-field edge`).not.toMatch(OTHER_EDGE);
  });

  // A FIELD HOVERS TO `ink` BECAUSE A FIELD TAKES FOCUS: the hover has to be told apart from a
  // 2px `ink` focus ring on the same edge, and only the top of the ladder manages it.
  it.each(FIELD_EDGES)('`%s` never hovers to `faint` or `muted`', (edge) => {
    expect(fieldVariants({ edge })).not.toMatch(/hover:border-(faint|muted)\b/);
  });

  // The #3 bug: `hover:border-ink` outranks `border-neg` on specificity, so a hover on the
  // invalid state replaced the only error cue with ink.
  it('hovers to `ink` from rest and proposed only', () => {
    const hovering = FIELD_EDGES.filter((edge) => /hover:border-/.test(fieldVariants({ edge })));
    expect(hovering).toEqual(['rest', 'proposed']);
    for (const edge of hovering) expect(fieldVariants({ edge })).toMatch(/hover:border-ink\b/);
  });

  it('says proposed with a dash, and no other state does', () => {
    const dashed = FIELD_EDGES.filter((edge) => /\bborder-dashed\b/.test(fieldVariants({ edge })));
    expect(dashed).toEqual(['proposed']);
  });

  it('rests on `field-border`, fails on `neg` and saves on `pos-border`', () => {
    expect(fieldVariants({ edge: 'rest' })).toMatch(/\bborder-field-border\b/);
    expect(fieldVariants({ edge: 'quiet' })).toMatch(/\bborder-field-border\b/);
    expect(fieldVariants({ edge: 'invalid' })).toMatch(/\bborder-neg\b/);
    expect(fieldVariants({ edge: 'saved' })).toMatch(/\bborder-pos-border\b/);
  });
});

// K2 (controls-and-overlays.md § Signed): one checkbox, its off edge on the field token.
describe('the checkbox', () => {
  it('puts the checkbox on the field token, and both sites on the checkbox', () => {
    const own = 'components/ui/Checkbox.tsx';
    const off = stripTs(read(own), own)
      .split('\n')
      .filter((l) => /\bbg-page\b/.test(l));
    expect(off.length, `${own}: the off arm vanished`).toBeGreaterThan(0);
    for (const line of off) expect(line).toMatch(/\bborder-field-border\b/);

    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
    ]) {
      const src = stripTs(read(file), file);
      expect(src, `${file} draws its own checkbox`).not.toMatch(/type="checkbox"/);
      expect(src, `${file} does not use the checkbox`).toMatch(/<Checkbox\b/);
    }
    const inked = SOURCES.filter((f) => /\baccent-ink\b/.test(stripTs(read(f), f)));
    expect(inked, 'these files tint a native control in ink').toEqual([]);
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
