import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declared, ruleBody, stripCss, themeBlocks } from './__fixtures__/palette';

// THE GLASS MATERIAL AND THE GLASS KNOB, as the spec signs them (glass.md and glass-light.md
// § Signed, controls.md § Signed). Each theme's alpha lives in a derived token, so no utility
// knows which theme is on; only the alphas both themes share are written inline.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const CSS = stripCss(read('index.css'), 'index.css');
const BLOCKS = themeBlocks(CSS);

const mix = (of: string, pct: number) =>
  `color-mix(in srgb, var(--color-${of}) ${pct}%, transparent)`;

/** A rule's own declarations, whitespace collapsed; nested blocks are not its own. */
function ownDeclarations(rule: string): Record<string, string> {
  const inner = rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'));
  let depth = 0;
  let flat = '';
  for (const c of inner) {
    // A nested block's prelude runs from the last `;` to its `{`, and is not a declaration.
    if (c === '{' && depth++ === 0) flat = flat.slice(0, flat.lastIndexOf(';') + 1);
    if (depth === 0) flat += c;
    if (c === '}') depth--;
  }
  const out: Record<string, string> = {};
  for (const part of flat.split(';')) {
    const at = part.indexOf(':');
    if (at === -1) {
      expect(part.trim(), `an unparsed line in ${rule.slice(0, 30)}`).toBe('');
      continue;
    }
    out[part.slice(0, at).trim()] = part
      .slice(at + 1)
      .replace(/\s+/g, ' ')
      .trim();
  }
  return out;
}

const utility = (name: string) => ruleBody(CSS, `@utility ${name}`);

const shadowIn = (block: string, name: string) =>
  block
    .match(new RegExp(`--shadow-${name}\\s*:\\s*([^;}]+)`))?.[1]
    .replace(/\s+/g, ' ')
    .trim();

describe('the glass tokens', () => {
  // [name, light, dark]. The rim and the shade are the two signed aliases; the rest is each
  // layer at its theme's own alpha.
  const SIGNED: [string, string, string][] = [
    ['glass-rim', '#ffffff', 'var(--color-ink)'],
    ['glass-shade', 'var(--color-ink)', 'var(--color-page)'],
    ['glass-fill', mix('card', 70), mix('card', 80)],
    ['glass-sheen', mix('glass-rim', 60), mix('glass-rim', 5)],
    ['glass-bevel-top', 'var(--color-glass-rim)', mix('glass-rim', 12)],
    ['glass-bevel-bottom', mix('glass-shade', 16), mix('glass-shade', 60)],
    ['glass-knob-fill', mix('card', 72), mix('card', 82)],
    ['glass-knob-sheen', mix('glass-rim', 62), mix('glass-rim', 6)],
    ['glass-well', mix('glass-shade', 6), mix('glass-shade', 55)],
    // The selected segment's knob: `accent` mixed into `card`, then at the theme's alpha.
    [
      'glass-knob-tint',
      `color-mix(in srgb, color-mix(in srgb, var(--color-accent) 16%, var(--color-card)) 88%, transparent)`,
      `color-mix(in srgb, color-mix(in srgb, var(--color-accent) 22%, var(--color-card)) 92%, transparent)`,
    ],
    // Its label, T2 at sign-off.
    ['segment-label', 'var(--color-accent-pressed)', 'var(--color-accent)'],
  ];

  // Flattened, because the formatter wraps a long `color-mix` over several lines.
  const flat = (v: string) => v.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');

  it.each(SIGNED)('--color-%s takes its signed value in each theme', (name, light, dark) => {
    expect(flat(declared(BLOCKS.light, name))).toBe(light);
    expect(flat(declared(BLOCKS.dark, name))).toBe(dark);
  });

  // The light theme's shade is `ink`, dark's is `page`, so each drop reads the shade alias.
  const DROPS: [string, string, string][] = [
    ['glass', `0 8px 24px ${mix('glass-shade', 7)}`, '0 0 #0000'],
    ['glass-knob', `0 2px 6px ${mix('glass-shade', 12)}`, `0 2px 6px ${mix('glass-shade', 80)}`],
    [
      'glass-well',
      `inset 0 1px 2px ${mix('glass-shade', 14)}`,
      `inset 0 1px 3px ${mix('glass-shade', 90)}`,
    ],
  ];

  it.each(DROPS)('--shadow-%s takes its signed value in each theme', (name, light, dark) => {
    expect(shadowIn(BLOCKS.light, name)).toBe(light);
    expect(shadowIn(BLOCKS.dark, name)).toBe(dark);
  });
});

const BEVEL = [
  'inset 1px 1px 0 var(--color-glass-bevel-top)',
  'inset -1px -1px 0 var(--color-glass-bevel-bottom)',
];
const BLUR = 'blur(30px) saturate(180%)';

describe('the glass material', () => {
  it('declares the fill, the sheen, the blur, the stroke, the bevel and the light-only shadow', () => {
    expect(ownDeclarations(utility('glass'))).toEqual({
      'background-color': 'var(--color-glass-fill)',
      'background-image': 'linear-gradient(180deg, var(--color-glass-sheen) 0%, transparent 38%)',
      '-webkit-backdrop-filter': BLUR,
      'backdrop-filter': BLUR,
      'box-shadow': [
        `inset 0 0 0 1px var(--glass-edge, ${mix('ink', 6)})`,
        ...BEVEL,
        'var(--shadow-glass)',
      ].join(', '),
    });
  });

  // signed-out.md: an outer border moves «Продовжити» at 360. The stroke is the first inset.
  it('draws its stroke inside the box: no border, padding, margin or outline', () => {
    const props = Object.keys(ownDeclarations(utility('glass')));
    expect(props.filter((p) => /^(border|padding|margin|outline)/.test(p))).toEqual([]);
  });

  // Wave 1's signed frames: the opaque card with a hairline, no bevel, sheen or shadow.
  it.each([
    '@supports not (backdrop-filter: blur(1px))',
    '@media (prefers-reduced-transparency: reduce)',
  ])('falls back to the opaque card under %s', (query) => {
    expect(ownDeclarations(ruleBody(utility('glass'), query))).toEqual({
      'background-color': 'var(--color-card)',
      'background-image': 'none',
      '-webkit-backdrop-filter': 'none',
      'backdrop-filter': 'none',
      'box-shadow': 'inset 0 0 0 1px var(--glass-edge, var(--color-hairline))',
    });
  });

  // A fallback is emitted where it sits, and the base rule has the same specificity: a base
  // declaration after either block wins over it, and the fallback is dead.
  it('closes on its two fallbacks, with no declaration after them', () => {
    const rule = utility('glass');
    const tail = rule.slice(rule.indexOf('@', rule.indexOf('{')), rule.lastIndexOf('}'));
    expect(tail.startsWith('@supports not'), 'the fallbacks are no longer nested').toBe(true);
    expect(ownDeclarations(`{${tail}}`)).toEqual({});
  });

  // An override on a dialog must not reach a glass card inside it.
  it('keeps the `--glass-edge` override on the element that sets it', () => {
    expect(ownDeclarations(ruleBody(CSS, '@property --glass-edge'))).toEqual({
      syntax: "'*'",
      inherits: 'false',
    });
  });
});

describe('the glass knob and its well', () => {
  const knob = (fill: string, ...last: string[]) => ({
    'background-color': fill,
    'background-image':
      'linear-gradient(180deg, var(--color-glass-knob-sheen) 0%, transparent 40%)',
    'box-shadow': [
      `inset 0 0 0 1px ${mix('ink', 6)}`,
      ...BEVEL,
      'var(--shadow-glass-knob)',
      ...last,
    ].join(', '),
  });

  it.each([
    ['glass-knob', knob('var(--color-glass-knob-fill)')],
    ['glass-knob-tint', knob('var(--color-glass-knob-tint)')],
    // A button takes focus, so its own shadows end with the ring's halo.
    ['glass-button', knob(mix('card', 92), 'var(--focus-halo)')],
    [
      'glass-well',
      {
        'background-color': 'var(--color-glass-well)',
        'box-shadow': `inset 0 0 0 1px ${mix('ink', 8)}, var(--shadow-glass-well)`,
      },
    ],
  ])('%s declares its signed layers and nothing nested', (name, signed) => {
    const rule = utility(name);
    expect(ownDeclarations(rule)).toEqual(signed);
    expect(rule.slice(rule.indexOf('{') + 1), `${name} nests a block`).not.toMatch(/[@{]/);
  });
});

describe('the build keeps what the utilities read', () => {
  // Tailwind drops a theme variable nothing it builds uses, so a utility with no consumer
  // yet could read a token the build pruned. Built here as a consumer would build it.
  it('declares every glass variable the five utilities use, in the light theme too', async () => {
    const compiler = await compile(CSS, { base: here, onDependency: () => {} });
    const built = compiler.build([
      'glass',
      'glass-knob',
      'glass-knob-tint',
      'glass-button',
      'glass-well',
    ]);
    const GLASS_VAR = /var\((--(?:color|shadow)-glass[\w-]*)/g;
    const used = [...new Set([...built.matchAll(GLASS_VAR)].map((m) => m[1]))].sort();
    expect(used.length, 'the built CSS reads no glass variable').toBeGreaterThanOrEqual(10);
    // The theme layer is `@theme`'s, the light values; the dark block is emitted whatever is used.
    const theme = ruleBody(built, '@layer theme');
    expect(used.filter((name) => !theme.includes(`${name}:`))).toEqual([]);
    expect(built).toContain('@supports not (backdrop-filter: blur(1px))');
    expect(built).toContain('@media (prefers-reduced-transparency: reduce)');
  });
});

/* ────────────────────────── the census ────────────────────────── */

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
    // Fixtures are test code, like the tests: they read the tokens, they paint nothing.
    if (statSync(full).isDirectory()) {
      if (entry !== '__fixtures__') out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** A glass class or token in a class string, whatever its prefix or variant. */
const NAMES_GLASS = /\bglass\b/;

describe('only the surfaces whose issue has landed wear the glass', () => {
  // #688 put the content cards on it; each consumer slice adds its own file. Any other use is a
  // surface painted ahead of its issue.
  // Core is an `@source` of the stylesheet, so a class string there is built too.
  it('no other source under src/ or packages/core/src names a glass class or token', () => {
    const core = sourceFiles(join(here, '../packages/core/src'));
    expect(core.length, 'the walk found almost nothing in core').toBeGreaterThan(10);
    const files = [...sourceFiles(here), ...core];
    expect(files.length, 'the walk found almost nothing').toBeGreaterThan(100);
    const wearing = files
      .filter((file) => NAMES_GLASS.test(stripTs(readFileSync(file, 'utf8'), file)))
      .map((file) => relative(here, file).split(sep).join('/'));
    expect(wearing.sort()).toEqual([
      'components/ui/Card.tsx',
      'components/ui/DatePicker.tsx',
      'components/ui/KpiCard.tsx',
      'components/ui/SegmentedControl.tsx',
      'components/ui/Select.tsx',
      'components/ui/button-variants.ts',
      'screens/daily-quotes/CouponDueCard.tsx',
    ]);
  });

  it('the stylesheet applies no glass utility to anything', () => {
    expect(CSS.match(/@apply[^;]*\bglass\b[^;]*;/g) ?? []).toEqual([]);
  });

  it('is actually looking — it matches a utility, a variant and a token', () => {
    for (const sample of ['rounded-[24px] glass p-6', 'md:glass-knob', 'bg-glass-fill'])
      expect(sample).toMatch(NAMES_GLASS);
    expect('glassy hourglass').not.toMatch(NAMES_GLASS);
  });
});
