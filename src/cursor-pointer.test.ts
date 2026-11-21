import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __unstable__loadDesignSystem, compile } from '@tailwindcss/node';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { stripCss } from './__fixtures__/palette';
import { REPO, skipped } from './repo-root';

// ONLY A LINK SHOWS THE HAND (Interaction rules): every other pressable keeps the browser's arrow.
// Each class, and the stylesheet, is judged by the CSS Tailwind writes, so every spelling is read.
// TRUST BOUNDARY: classes, the built stylesheet and the text of string and template literals under
// `src` are read; a cursor assembled at run time from other values, and third-party CSS past the
// sonner buttons pinned below, are not.

const CSS = stripCss(readFileSync(join(REPO, 'src/index.css'), 'utf8'), 'index.css');
// Anywhere in the value, so a fallback after an image counts; a custom property can carry
// `pointer` out of sight, so a cursor read through one fails too. An image's own name is not read.
const POINTER = /\bcursor\s*:[^;}]*?(\bpointer\b|var\()/i;
const handIn = (css: string) => POINTER.test(css.replace(/url\([^)]*\)/gi, ''));
const ARROW = /\bcursor\s*:\s*default\b/i;

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

/** A source file, parsed; one that does not parse throws rather than being half read. */
function parse(rel: string) {
  const sf = ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error)
    throw new Error(
      `${rel} does not parse: ${ts.flattenDiagnosticMessageText(error.messageText, ' ')}`,
    );
  return sf;
}

/** Every whitespace-separated word of every string and template part, so a comment is not one,
 *  and every string or template whose text holds a pointer cursor as CSS or ends a value list on
 *  `pointer`, as an inline style, a JSX `cursor` attribute or a `setProperty` writes one. */
function scan(root: ts.Node) {
  const words: string[] = [];
  const inline: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddleOrTemplateTail(n))
      words.push(...n.text.split(/\s+/).filter(Boolean));
    // A template's literal parts joined, each substitution standing as a blank.
    const text = ts.isStringLiteralLike(n)
      ? n.text
      : ts.isTemplateExpression(n)
        ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ')
        : undefined;
    if (
      text !== undefined &&
      (handIn(text) || text.split(',').at(-1)!.trim().toLowerCase() === 'pointer')
    )
      inline.push(n.parent.getText());
    ts.forEachChild(n, visit);
  };
  visit(root);
  return { words, inline };
}

let DS: Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
/** Each distinct word's CSS, in one call for the lot; a word that is not a class has none. */
const cssOf = (words: string[]) => {
  const unique = [...new Set(words)];
  const css = DS.candidatesToCss(unique);
  return new Map(unique.map((w, i) => [w, css[i] ?? '']));
};
const points = (word: string) => handIn(DS.candidatesToCss([word])[0] ?? '');
const build = async (css: string) =>
  stripCss(
    (await compile(css, { base: join(REPO, 'src'), onDependency: () => {} })).build([]),
    'the built stylesheet',
  );

type Pick = (n: ts.Node, sf: ts.SourceFile) => ts.Node | undefined;
const jsxClass =
  (tag: string): Pick =>
  (n, sf) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText(sf) === tag
      ? n.attributes.properties.find(
          (p) => ts.isJsxAttribute(p) && p.name.getText(sf) === 'className',
        )
      : undefined;
const property =
  (name: string): Pick =>
  (n, sf) =>
    ts.isPropertyAssignment(n) && n.name.getText(sf) === name ? n.initializer : undefined;

// The pressables whose arrow the UA stylesheet does not give: a <div>, whose `auto` is the I-beam
// over its words (CSS UI 4), as Radix Themes and shadcn/ui set their select rows to `default`; and
// sonner's buttons, whose own unlayered CSS gives them the hand, so the override takes `!`.
const ARROWS: [rel: string, what: string, pick: Pick][] = [
  ['src/components/ui/Select.tsx', 'a Select row', jsxClass('RadixSelect.Item')],
  ['src/app/AppToaster.tsx', "a toast's close", property('closeButton')],
  ['src/app/AppToaster.tsx', "a toast's action", property('actionButton')],
  ['src/app/AppToaster.tsx', "a toast's cancel", property('cancelButton')],
];

beforeAll(async () => {
  DS = await __unstable__loadDesignSystem(CSS, { base: join(REPO, 'src') });
});

describe('only a link shows the hand', () => {
  it('reads every spelling of a pointer cursor, and nothing else', () => {
    for (const word of [
      'cursor-pointer',
      'hover:cursor-pointer',
      'md:cursor-pointer',
      '!cursor-pointer',
      'enabled:cursor-pointer',
      '[cursor:pointer]',
      '[&>button]:cursor-pointer',
      'cursor-(--hand)',
      '[cursor:var(--hand)]',
      'cursor-[url(h.svg),pointer]',
      '[cursor:url(h.svg)_4_4,pointer]',
    ])
      expect(points(word), word).toBe(true);
    for (const word of [
      'cursor-default',
      'pointer-events-none',
      'pointer',
      'cursor-',
      'cursor-[url(hand-pointer.cur),default]',
    ])
      expect(points(word), word).toBe(false);
    const inline = (code: string) =>
      scan(ts.createSourceFile('a.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX))
        .inline;
    for (const code of [
      `const s = { cursor: 'pointer' };`,
      `el.style.cursor = "pointer";`,
      `el.style['cursor'] = 'pointer';`,
      `const s = { cursor: busy ? 'default' : 'pointer' };`,
      `const x = <rect cursor="pointer" />;`,
      `el.style.setProperty('cursor', \`Pointer\`);`,
      `el.style.cssText = 'color: red; cursor: pointer';`,
      `el.setAttribute('style', 'cursor:pointer');`,
      `const s = { cursor: 'url(h.svg), pointer' };`,
      'el.style.cssText = `cursor: pointer; width: ${w}px`;',
      'el.style.cursor = `${img}, pointer`;',
    ])
      expect(inline(code), code).toHaveLength(1);
    expect(inline(`const s = { cursor: 'default', pointer: 'x' };`)).toEqual([]);
  });

  it('sets no pointer cursor in any source under src', () => {
    const files = walk('src').map((rel) => ({ rel, ...scan(parse(rel)) }));
    const css = cssOf(files.flatMap((f) => f.words));
    const found = files.flatMap(({ rel, words, inline }) => [
      ...words.filter((w) => handIn(css.get(w)!)).map((w) => `${rel}: ${w}`),
      ...inline.map((s) => `${rel}: ${s}`),
    ]);
    expect(found).toEqual([]);
  });

  it.each(ARROWS)('%s keeps the arrow on %s', (rel, what, pick) => {
    const sf = parse(rel);
    const found: ts.Node[] = [];
    const visit = (n: ts.Node) => {
      const hit = pick(n, sf);
      if (hit) found.push(hit);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found, what).toHaveLength(1);
    const { words } = scan(found[0]);
    const css = cssOf(words);
    expect(
      words.some((w) => ARROW.test(css.get(w)!)),
      `${what} sets no \`cursor: default\``,
    ).toBe(true);
  });

  // Sonner gives a disabled close `not-allowed`; the arrow replaces the hand only, so every cursor
  // the close sets stands aside for `data-disabled`.
  it("leaves a disabled toast close sonner's not-allowed", () => {
    const sf = parse('src/app/AppToaster.tsx');
    const found: ts.Node[] = [];
    const visit = (n: ts.Node) => {
      const hit = property('closeButton')(n, sf);
      if (hit) found.push(hit);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const { words } = scan(found[0]);
    const css = cssOf(words);
    const cursors = words.filter((w) => /\bcursor\s*:/.test(css.get(w)!));
    expect(cursors.length, 'the close sets no cursor').toBeGreaterThan(0);
    for (const w of cursors) expect(css.get(w), w).toMatch(/:not\(\[data-disabled="?true"?\]\)/);
  });

  // Built, so an `@apply` and nesting are read as they render.
  it('sets no pointer cursor in the stylesheet', async () => {
    expect(handIn(await build(CSS))).toBe(false);
    expect(await build(`${CSS}\n@layer base { .probe { @apply cursor-pointer; } }`)).toMatch(
      POINTER,
    );
    expect(await build(`${CSS}\n@layer base { .probe { cursor: var(--hand); } }`)).toMatch(POINTER);
  });
});
