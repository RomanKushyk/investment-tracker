import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  channels,
  composite,
  declaredHex,
  luminance,
  ratio,
  resolve,
  rgbHex,
  ruleBody,
  stripCss,
  themeBlocks,
  veilOf,
} from './__fixtures__/palette';
import { REPO, skipped } from './repo-root';

// ONE PALETTE READER: the colour guards import it from `__fixtures__/palette.ts`, so a fix to
// the stripper or a reader lands once and every guard asks the stylesheet the same question.
//
// A TAINT CENSUS, the shape `ts-reader-census.test.ts` gives its question: naming `index.css` as
// a path is the source, the module's `stripCss` the sanitizer, and a module that names it is a
// reader of the palette. THE TRUST BOUNDARY: those modules, through the read and copy shapes
// pinned in `SNIPPETS` below. A copy in a module that never reads the file reads nothing of the
// palette, and a census cannot prove no copy exists — it refuses the shapes it knows.

const HOME = 'src/__fixtures__/palette.ts';
/** The module's names, refused as an implementation in a module that reads `index.css`. */
const NAMES = new Set([
  'luminance',
  'ratio',
  'ruleBody',
  'stripCss',
  'resolve',
  'declared',
  'declaredIn',
  'declaredHex',
  'themeBlocks',
  'veilOf',
  'channels',
  'rgbHex',
  'composite',
]);
/** Where a name may be imported from without being a copy: the module, and `node:path`'s
 *  `resolve`, which a read of the stylesheet may use to build its path. */
const IMPORTABLE = /^(.*\/__fixtures__\/palette(\.ts)?|node:path|path)$/;
/** WCAG 2.x luminance's own constants, which a copy carries under any name. */
const WCAG = new Set(['0.03928', '12.92', '0.2126', '0.7152', '0.0722']);
/** The stripper's throw, which an inlined copy carries even when it has no name. */
const STRIPPER_THROW = /unterminated (\/\* )?comment/;
/** What follows a token name in a declaration reader's needle: `:` or a regex's `\s*:`. */
const NEEDLE_TAIL = /^(\\s\*)?:/;
/** A regex literal that captures a token's VALUE: `--color-(…)` or `--color-[…]`, then `:`,
 *  then a group. A scan of names alone captures nothing after the `:`. */
const VALUE_SCAN = /--color-[([][^/]*:[^/]*\(/;
/** The stylesheet named as a path, `?raw` included. */
const STYLESHEET = /(^|\/)index\.css(\?raw)?$/;

/** Every exception, once per occurrence: the census must find exactly these, so a new one
 *  and a stale one both fail. */
const ALLOWED: [offence: string, why: string][] = [
  [
    'src/palette-mirror.test.ts: names index.css outside `stripCss`, at `FILES`',
    'the retired-hex sweep reads comments on purpose, and `cssProse` reads only them',
  ],
  [
    'src/palette-mirror.test.ts: carries a CSS comment stripper, at `cssProse`',
    'keeps the comments `stripCss` drops: the complement, one copy',
  ],
  ['src/palette-mirror.test.ts: scans for a comment close, at `cssProse`', 'the same'],
  [
    'src/ui-face.test.ts: names index.css outside `stripCss`, at `leave no trace of the face that had them by default`',
    'prose naming the previous face is what it catches, so it reads comments on purpose',
  ],
  [
    'src/floating-edges.test.ts: builds a token needle, at `does not re-mint the three retired names, anywhere in the stylesheet`',
    'refuses a second declaration; reads no value',
  ],
  [
    'src/sidebar-plane.test.ts: builds a token needle, at `the inverted plane is gone from the stylesheet`',
    'refuses a retired declaration; reads no value',
  ],
  [
    'src/ui-face.test.ts: declares `declared`',
    'reads `--font-*`, which the palette module does not',
  ],
];

const MODULE = /\.[cm]?[jt]sx?$/;
const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    // Dot directories are tool output (`.aws-sam` bundles).
    if (e.isDirectory()) {
      return skipped(e.name) || e.name.startsWith('.') ? [] : walk(rel);
    }
    return MODULE.test(e.name) ? [rel] : [];
  });

const scriptKind = (rel: string) =>
  /\.[cm]?tsx$/.test(rel)
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/.test(rel)
      ? ts.ScriptKind.TS
      : /x$/.test(rel)
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;

const parse = (rel: string, text: string) =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, scriptKind(rel));

/** The innermost function or test around a node, else the variable it sits in. */
function anchor(node: ts.Node): string | undefined {
  let variable: string | undefined;
  for (let n = node.parent; n; n = n.parent) {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) {
      return n.name.getText();
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) variable ??= n.name.text;
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ['it', 'test', 'describe'].includes(n.expression.text) &&
      n.arguments[0] &&
      (ts.isStringLiteral(n.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(n.arguments[0]))
    ) {
      return n.arguments[0].text;
    }
  }
  return variable;
}

const isText = (node: ts.Node): node is ts.StringLiteral | ts.TemplateLiteralLikeNode =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node);

/** The stylesheet named as a path: handed to a call or `new`, listed, concatenated, or imported
 *  as text. A property key, a comparison or `import './index.css'` (the app's styles) is not. */
function namesStylesheet(node: ts.Node): boolean {
  const last = ts.isTemplateExpression(node)
    ? node.templateSpans[node.templateSpans.length - 1].literal.text
    : ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : undefined;
  if (last === undefined || !STYLESHEET.test(last)) return false;
  const p = node.parent;
  if (ts.isImportDeclaration(p)) return last.endsWith('?raw');
  return (
    ((ts.isCallExpression(p) || ts.isNewExpression(p)) && !!p.arguments?.some((a) => a === node)) ||
    ts.isArrayLiteralExpression(p) ||
    (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.PlusToken)
  );
}

/** Anywhere inside a `stripCss(…)` call: its read, or its label. */
const insideStripper = (node: ts.Node) => {
  for (let n: ts.Node = node; n.parent; n = n.parent) {
    const p = n.parent;
    if (
      ts.isCallExpression(p) &&
      ts.isIdentifier(p.expression) &&
      p.expression.text === 'stripCss' &&
      p.arguments.some((a) => a === n)
    ) {
      return true;
    }
  }
  return false;
};

/** The name an implementation introduces. A parameter implements nothing, and an import is a
 *  copy only when aliased or taken from somewhere else than `IMPORTABLE`. */
function implementedName(node: ts.Node): string | undefined {
  if (ts.isImportSpecifier(node)) {
    const from = node.parent.parent.parent.moduleSpecifier;
    const home = ts.isStringLiteral(from) && IMPORTABLE.test(from.text);
    return home && !node.propertyName ? undefined : node.name.text;
  }
  const name =
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isClassDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isBindingElement(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isImportClause(node) ||
    ts.isNamespaceImport(node)
      ? node.name
      : undefined;
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

/** `--color-${name}:` as a template, `String.raw` included, or as a `+` chain. */
function isNeedle(node: ts.Node): boolean {
  if (ts.isTemplateExpression(node)) {
    const literals = [node.head, ...node.templateSpans.map((s) => s.literal)];
    const forms = (l: ts.TemplateLiteralLikeNode) => [l.text, l.rawText ?? l.text];
    return literals.some(
      (l, i) =>
        forms(l).some((t) => t.endsWith('--color-')) &&
        !!literals[i + 1] &&
        forms(literals[i + 1]).some((t) => NEEDLE_TAIL.test(t)),
    );
  }
  const plus = (n: ts.Node): n is ts.BinaryExpression =>
    ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken;
  if (!plus(node) || plus(node.parent)) return false;
  const parts: ts.Node[] = [];
  const flatten = (n: ts.Node): void => {
    if (plus(n)) {
      flatten(n.left);
      flatten(n.right);
    } else parts.push(n);
  };
  flatten(node);
  const text = (n: ts.Node | undefined) => (n && ts.isStringLiteral(n) ? n.text : undefined);
  return parts.some(
    (p, i) => text(p)?.endsWith('--color-') && NEEDLE_TAIL.test(text(parts[i + 2]) ?? ''),
  );
}

/** Whether a module reads the palette: it names the stylesheet as a path. */
function readsPalette(sf: ts.SourceFile): boolean {
  let reads = false;
  const visit = (node: ts.Node) => {
    if (namesStylesheet(node)) reads = true;
    else ts.forEachChild(node, visit);
  };
  visit(sf);
  return reads;
}

function offencesIn(sf: ts.SourceFile): string[] {
  const found: string[] = [];
  const offend = (node: ts.Node, what: string) => {
    const at = anchor(node);
    found.push(`${sf.fileName}: ${what}${at ? `, at \`${at}\`` : ''}`);
  };
  const visit = (node: ts.Node) => {
    const name = implementedName(node);
    if (name && NAMES.has(name)) offend(node, `declares \`${name}\``);
    if (namesStylesheet(node) && !insideStripper(node)) {
      offend(node, 'names index.css outside `stripCss`');
    }
    if (ts.isNumericLiteral(node) && WCAG.has(node.text)) offend(node, 'computes WCAG luminance');
    if (isNeedle(node)) offend(node, 'builds a token needle');
    if (ts.isRegularExpressionLiteral(node) && VALUE_SCAN.test(node.text)) {
      offend(node, 'scans token values');
    }
    if (isText(node) && STRIPPER_THROW.test(node.text)) {
      offend(node, 'carries a CSS comment stripper');
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'indexOf' &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '*/'
    ) {
      offend(node, 'scans for a comment close');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The modules that read the palette, read straight into the parser — which is what
 *  `ts-reader-census.test.ts` lets a census do. */
const READERS = walk('')
  .filter((rel) => rel !== HOME)
  .map((rel) =>
    ts.createSourceFile(
      rel,
      readFileSync(join(REPO, rel), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      scriptKind(rel),
    ),
  )
  .filter(readsPalette);

/** The census's own logic, pinned: each shape the reviews raised, and what it must say. A
 *  snippet that reads nothing is no reader, so each one that should be checked reads first. */
const READ = "const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');\n";
const SNIPPETS: [label: string, source: string, offences: string[]][] = [
  ['the house read', READ, []],
  ['the app importing its styles is no reader', "import './index.css';\nfunction ratio() {}\n", []],
  [
    'a raw read',
    "const css = readFileSync(join(here, 'index.css'), 'utf8');\n",
    ['names index.css outside `stripCss`, at `css`'],
  ],
  [
    'a raw read through new URL',
    "const css = readFileSync(new URL('./index.css', import.meta.url));\n",
    ['names index.css outside `stripCss`, at `css`'],
  ],
  [
    'a raw read from a list',
    "for (const f of ['index.css']) read(f);\n",
    ['names index.css outside `stripCss`'],
  ],
  [
    'a raw read by concatenation',
    "const css = readFileSync(here + '/index.css');\n",
    ['names index.css outside `stripCss`, at `css`'],
  ],
  ['a ?raw import', "import css from './index.css?raw';\n", ['names index.css outside `stripCss`']],
  [
    'a nested function',
    READ + 'describe(`x`, () => { function luminance() {} });\n',
    ['declares `luminance`, at `x`'],
  ],
  [
    'an object method',
    READ + 'const css = { ruleBody() {} };\n',
    ['declares `ruleBody`, at `css`'],
  ],
  ['an arrow property', READ + 'const m = { ratio: () => 1 };\n', ['declares `ratio`, at `m`']],
  [
    'a veil composite',
    READ + 'const composite = (v: V, b: string) => b;\n',
    ['declares `composite`'],
  ],
  ['a destructured binding', READ + 'const { resolve } = lib;\n', ['declares `resolve`']],
  [
    'an aliased import',
    READ + "import { basename as stripCss } from 'node:path';\n",
    ['declares `stripCss`'],
  ],
  [
    'an import from another copy',
    READ + "import { ruleBody } from './my-reader';\n",
    ['declares `ruleBody`'],
  ],
  [
    '`resolve` from node:path builds a path',
    READ + "import { join, resolve } from 'node:path';\n",
    [],
  ],
  ['a promise resolver is a parameter', READ + 'new Promise((resolve) => resolve(1));\n', []],
  [
    'a needle',
    READ + 'const n = (x: string) => `--color-${x}:`;\n',
    ['builds a token needle, at `n`'],
  ],
  [
    'a needle in a later span',
    READ + 'const n = (i: string, x: string) => `${i}--color-${x}:`;\n',
    ['builds a token needle, at `n`'],
  ],
  [
    'a needle before \\s*:',
    READ + 'const n = (x: string) => `--color-${x}\\\\s*:`;\n',
    ['builds a token needle, at `n`'],
  ],
  [
    'a String.raw needle',
    READ + 'const n = (x: string) => String.raw`--color-${x}\\s*:`;\n',
    ['builds a token needle, at `n`'],
  ],
  [
    'a needle by concatenation',
    READ + "const n = (x: string) => '--color-' + x + ':';\n",
    ['builds a token needle, at `n`'],
  ],
  ['a message is no needle', READ + 'const m = (x: string) => `--color-${x} is missing`;\n', []],
  [
    'a regex that scans values',
    READ + 'const all = /--color-([a-z-]+):\\s*([^;]+)/g;\n',
    ['scans token values, at `all`'],
  ],
  ['a regex that scans names', READ + 'const all = /--color-([a-z-]+):/g;\n', []],
  [
    'WCAG maths',
    READ + 'const lum = (c: number) => 0.2126 * c;\n',
    ['computes WCAG luminance, at `lum`'],
  ],
  [
    'a stripper by its throw',
    READ + "function strip() { throw new Error('x has an unterminated /* comment'); }\n",
    ['carries a CSS comment stripper, at `strip`'],
  ],
  [
    'a stripper by its scan',
    READ + "function strip(s: string) { return s.indexOf('*/'); }\n",
    ['scans for a comment close, at `strip`'],
  ],
];

describe('the colour guards share one palette reader', () => {
  it('finds the guards that read `index.css`', () => {
    expect(READERS.length, 'the census lost its readers').toBeGreaterThan(10);
  });

  it(`a module that reads \`index.css\` reads it through ${HOME} and carries no copy of it`, () => {
    const found = READERS.flatMap(offencesIn).sort();
    expect(found, 'import it from src/__fixtures__/palette.ts instead').toEqual(
      ALLOWED.map(([offence]) => offence).sort(),
    );
  });

  for (const [label, source, offences] of SNIPPETS) {
    it(`census snippet: ${label}`, () => {
      const sf = parse('probe.ts', source);
      expect(offences.length === 0 || readsPalette(sf), 'the snippet is no reader').toBe(true);
      expect(readsPalette(sf) ? offencesIn(sf) : []).toEqual(offences.map((o) => `probe.ts: ${o}`));
    });
  }
});

describe('stripCss', () => {
  it('drops comments and keeps the rules around them', () => {
    expect(stripCss('a { x: 1; } /* gone */ b { y: 2; }', 't.css')).toBe(
      'a { x: 1; }  b { y: 2; }',
    );
  });

  it('keeps a comment opener that sits inside a string, in either quote', () => {
    expect(stripCss(`a { content: "/*"; } /* c */ b {}`, 't.css')).toBe(
      `a { content: "/*"; }  b {}`,
    );
    expect(stripCss(`a { content: '/*'; } /* c */ b {}`, 't.css')).toBe(
      `a { content: '/*'; }  b {}`,
    );
  });

  it('does not end a string at an escaped quote', () => {
    const source = String.raw`a { content: "\"/*"; } /* c */ b {}`;
    expect(stripCss(source, 't.css')).toBe(String.raw`a { content: "\"/*"; }  b {}`);
  });

  it('throws on a comment that never closes instead of returning a partial file', () => {
    expect(() => stripCss('a {} /* never closed', 't.css')).toThrow(
      /^t\.css has an unterminated \/\* comment$/,
    );
  });
});

describe('stripCss refuses a string that never closes', () => {
  it('at a raw newline, which a CSS string cannot hold', () => {
    expect(() => stripCss("a { content: 'x; }\n/* c */ b {}", 't.css')).toThrow(
      /^t\.css has an unterminated string$/,
    );
  });

  it('but not at an escaped line break, CR LF included, which continues the string', () => {
    for (const nl of ['\n', '\r\n']) {
      expect(stripCss(`a { content: 'x\\${nl}y'; } /* c */`, 't.css')).toBe(
        `a { content: 'x\\${nl}y'; } `,
      );
    }
  });

  it('at a raw form feed, which CSS reads as a newline', () => {
    expect(() => stripCss("a { content: 'x\fy'; }", 't.css')).toThrow(
      /^t\.css has an unterminated string$/,
    );
  });

  it('at the end of the file', () => {
    expect(() => stripCss("a { content: 'x; }", 't.css')).toThrow(
      /^t\.css has an unterminated string$/,
    );
  });
});

describe('ruleBody', () => {
  it('returns one rule, bounded on both sides by its own braces', () => {
    const css = '@theme { --a: 1; @keyframes k { to { x: 1; } } } .x { --a: 2; }';
    expect(ruleBody(css, '@theme')).toBe('@theme { --a: 1; @keyframes k { to { x: 1; } } }');
  });
});

describe('the two readers', () => {
  const blocks = themeBlocks(
    [
      '@theme { --color-base: #AABBCC; --color-alias: var(--color-base); --color-loop: var(--color-loop); --color-word: transparent; }',
      "[data-theme='dark'] { --color-base: #112233; }",
    ].join('\n'),
  );

  it('`resolve` follows an alias and falls back to @theme the way the cascade does', () => {
    expect(resolve(blocks, 'light', 'alias')).toBe('#aabbcc');
    expect(resolve(blocks, 'dark', 'alias')).toBe('#112233');
  });

  it('`resolve` refuses a cycle and a value that is not a hex', () => {
    expect(() => resolve(blocks, 'light', 'loop')).toThrow(/cycle/);
    expect(() => resolve(blocks, 'light', 'word')).toThrow(/neither a hex/);
  });

  it('`declaredHex` reads the literal and refuses an alias', () => {
    expect(declaredHex(blocks, 'dark', 'base')).toBe('#112233');
    expect(() => declaredHex(blocks, 'dark', 'alias')).toThrow(/not a plain hex/);
  });

  it('both take the last declaration, as the cascade does, even one without its `;`', () => {
    const twice = themeBlocks(
      "@theme { --color-x: #111111; --color-x: #222222 } [data-theme='dark'] { }",
    );
    expect(resolve(twice, 'light', 'x')).toBe('#222222');
    expect(declaredHex(twice, 'dark', 'x')).toBe('#222222');
  });

  it("a nested rule's declaration is not the block's own", () => {
    const nested = themeBlocks(
      "@theme { --color-x: #111111; @media (x) { a { --color-x: #999999; } } } [data-theme='dark'] { }",
    );
    expect(resolve(nested, 'light', 'x')).toBe('#111111');
  });

  it('a brace inside a string value opens no rule', () => {
    const quoted = themeBlocks(
      "@theme { --color-page: #eeeeee; } [data-theme='dark'] { --x: '{'; --color-page: #111111; }",
    );
    expect(declaredHex(quoted, 'dark', 'page')).toBe('#111111');
  });

  it('a name neither block declares says so', () => {
    expect(() => resolve(blocks, 'dark', 'absent')).toThrow(/declared in neither dark nor @theme/);
  });
});

describe('the veil reader', () => {
  const blocks = themeBlocks(
    [
      '@theme { --color-scrim: rgba(28, 26, 25, 0.5); --color-tint: rgba(1, 2, 3, 0.12); --color-base: #aabbcc; }',
      "[data-theme='dark'] { --color-tint: rgba(4, 5, 6, 0.14); }",
    ].join('\n'),
  );

  it("reads a theme's own veil, and @theme's where the dark block omits it, as the cascade does", () => {
    expect(veilOf(blocks, 'dark', 'tint')).toEqual({ ch: [4, 5, 6], alpha: 0.14 });
    expect(veilOf(blocks, 'dark', 'scrim')).toEqual({ ch: [28, 26, 25], alpha: 0.5 });
  });

  it('refuses a value that is not an rgba(…)', () => {
    expect(() => veilOf(blocks, 'light', 'base')).toThrow(/not an rgba/);
  });

  it('the channel maths round-trips a hex', () => {
    expect(channels('#1c1a19')).toEqual([28, 26, 25]);
    expect(rgbHex([28, 26.4, 24.6])).toBe('#1c1a19');
  });

  it('composites a veil over an opaque plane, source-over', () => {
    expect(composite({ ch: [0, 0, 0], alpha: 0.5 }, '#ffffff')).toBe('#808080');
    // Unequal channels and alpha ≠ 0.5, so swapped weights or a crossed channel cannot pass.
    expect(composite({ ch: [200, 100, 0], alpha: 0.25 }, '#204080')).toBe('#4a4960');
  });
});

describe('contrast maths', () => {
  it('WCAG 2.x: white on black is 21 : 1, and a colour on itself is 1 : 1', () => {
    expect(ratio('#ffffff', '#000000')).toBe(21);
    expect(ratio('#847e77', '#847e77')).toBe(1);
    expect(luminance('#ffffff')).toBe(1);
  });
});
