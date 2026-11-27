import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __unstable__loadDesignSystem, compile } from '@tailwindcss/node';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { stripCss } from '../../__fixtures__/palette';
import { REPO, skipped } from '../../repo-root';

// NO CONTROL FADES ON HOVER (H2, controls.md § Signed): a fade reads as "less available", the
// opposite of a hover, so a neutral control takes the `ink` 5 % veil instead. Each class, and the
// stylesheet, is judged by the CSS Tailwind writes, so every spelling of a hover reads as it acts.

const CSS = stripCss(readFileSync(join(REPO, 'src/index.css'), 'utf8'), 'index.css');

/** Every class that sets an opacity under a hover in `src`, once per occurrence, by file, with
 *  its owner. A new one, or one gone from its site, fails. */
const ALLOWED: Record<string, { classes: string[]; why: string }> = {
  'src/components/ui/button-variants.ts': {
    classes: ['hover:opacity-90'],
    why: '`danger`, held by B4 (controls.md § Signed)',
  },
  // The ✕ glyphs rest at the signed .85 (notices-and-toasts.md) and brighten: the reverse of a fade.
  'src/components/ui/ReminderStrip.tsx': {
    classes: ['hover:opacity-100'],
    why: 'a banner’s ✕ brightens from its signed .85',
  },
  'src/screens/daily-quotes/QuoteRow.tsx': {
    classes: ['hover:opacity-100'],
    why: 'the offer’s ✕ brightens from its signed .85',
  },
  // A row's hover shows its hidden delete: an appearance, not the control fading.
  'src/screens/TransactionPanel.tsx': {
    classes: ['group-hover:opacity-100'],
    why: 'a ledger row reveals its delete (ledger-delete.test.ts)',
  },
};

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

/** Every whitespace-separated word of every string and template part, so a comment is not one.
 *  A file that does not parse throws, rather than being read up to its error. */
function words(rel: string): string[] {
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
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddleOrTemplateTail(n)) {
      out.push(...n.text.split(/\s+/).filter(Boolean));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/* ─────────── the CSS, as a tree ─────────── */

// TRUST BOUNDARY: an opacity set under a hover is read; an opacity reached through an animation's
// keyframes, or through a custom property a rest rule feeds to `opacity`, is not.

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
/** Tailwind's own node (`candidatesToAst`), which the stylesheet reader writes too. */
type Node = ReturnType<DesignSystem['candidatesToAst']>[number][number];

/** The built stylesheet as that tree: `compile` hands back text only. Its comments are cut first
 *  (`read`); strings and escapes are taken whole, so a brace or semicolon inside one is not
 *  structure; a brace that does not balance throws rather than misplacing every rule after it. */
function parseCss(css: string): Node[] {
  const root: Node = { kind: 'at-root', nodes: [] };
  const stack: { nodes: Node[] }[] = [root];
  let text = '';
  const flush = () => {
    const m = text.match(/^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]+?)\s*$/);
    if (m) {
      stack.at(-1)!.nodes.push({
        kind: 'declaration',
        property: m[1],
        value: m[2],
        important: false,
      });
    }
    text = '';
  };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '\\') text += ch + (css[++i] ?? '');
    else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      if (j >= css.length) throw new Error('parseCss: an unclosed string');
      text += css.slice(i, j + 1);
      i = j;
    } else if (ch === '{') {
      const prelude = text.trim();
      const node: Node = prelude.startsWith('@')
        ? { kind: 'at-rule', name: prelude.split(/\s/)[0], params: prelude, nodes: [] }
        : { kind: 'rule', selector: prelude, nodes: [] };
      stack.at(-1)!.nodes.push(node);
      stack.push(node);
      text = '';
    } else if (ch === ';') flush();
    else if (ch === '}') {
      flush();
      if (stack.length === 1) throw new Error('parseCss: an unmatched }');
      stack.pop();
    } else text += ch;
  }
  if (stack.length !== 1) throw new Error('parseCss: an unclosed block');
  return root.nodes;
}

/** A selector with every `:not(…)` cut, its parentheses balanced, and every escape dropped, so a
 *  class's own escaped name (`.\[\&\:hover\]`) and a negated hover are not read as a hover. */
function ownSelector(selector: string): string {
  let out = '';
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '\\') {
      i++;
      continue;
    }
    if (selector.slice(i, i + 5).toLowerCase() === ':not(') {
      let depth = 0;
      for (i += 4; i < selector.length; i++) {
        if (selector[i] === '\\') i++;
        else if (selector[i] === '(') depth++;
        else if (selector[i] === ')' && --depth === 0) break;
      }
      continue;
    }
    out += selector[i];
  }
  return out;
}

// Only a selector says the pointer is over something; `@media (hover: hover)` asks what the device
// can do, and a rule inside it is a rest state on a desktop. Radix marks the item under the
// pointer `data-highlighted`, the hover the Select's rows take their veil on.
const isHover = (n: Node) =>
  n.kind === 'rule' && /:hover\b|\[data-highlighted\b/i.test(ownSelector(n.selector));
// An opacity, the enter and exit opacities `tw-animate-css` animates, or a filter's `opacity()`.
const setsOpacity = (n: Node) => {
  if (n.kind !== 'declaration') return false;
  const property = n.property.toLowerCase();
  return (
    property === 'opacity' ||
    /^--tw-(enter|exit)-opacity$/.test(property) ||
    (/filter$/.test(property) && /\bopacity\(/i.test(n.value ?? ''))
  );
};

/** Each declaration that sets an opacity under a hover, with the selectors above it. */
function fadesIn(nodes: Node[], under: string[] = [], hovered = false): string[] {
  return nodes.flatMap((n) => {
    if (n.kind === 'declaration')
      return setsOpacity(n) && hovered
        ? [`${under.join(' › ')} { ${n.property}: ${n.value} }`]
        : [];
    if (n.kind === 'comment') return [];
    const at = n.kind === 'rule' ? [...under, n.selector] : under;
    return fadesIn(n.nodes, at, hovered || isHover(n));
  });
}

let DS: DesignSystem;
let BUILT: Node[];
const JUDGED = new Map<string, boolean>();
/** Each word judged once, in one call for the lot; a word that is not a class never fades. */
function judge(all: string[]) {
  const fresh = [...new Set(all)].filter((w) => !JUDGED.has(w));
  DS.candidatesToAst(fresh).forEach((ast, i) => JUDGED.set(fresh[i], fadesIn(ast).length > 0));
}
const fades = (word: string) => {
  judge([word]);
  return JUDGED.get(word)!;
};
/** Generated CSS as a tree, its comments cut by the shared reader (Tailwind keeps `/*!` ones). */
const read = (css: string) => parseCss(stripCss(css, 'the built stylesheet'));
const build = async (css: string) =>
  read((await compile(css, { base: join(REPO, 'src'), onDependency: () => {} })).build([]));

beforeAll(async () => {
  DS = await __unstable__loadDesignSystem(CSS, { base: join(REPO, 'src') });
  BUILT = await build(CSS);
});

describe('no control fades on hover', () => {
  it('reads every spelling of a hover fade, and nothing else', () => {
    for (const word of [
      'hover:opacity-85',
      'hover:!opacity-85',
      'max-md:hover:opacity-85',
      'hover:opacity-(--x)',
      'hover:[opacity:.85]',
      '[&:hover]:opacity-85',
      '[&:HOVER]:opacity-50',
      '[&>button:hover]:opacity-50',
      'group-hover:opacity-60',
      'in-hover:opacity-60',
      'data-[highlighted]:opacity-85',
      'data-highlighted:opacity-85',
      'hover:fade-out',
      'hover:[filter:opacity(.5)]',
    ])
      expect(fades(word), word).toBe(true);
    for (const word of [
      'hover:bg-ink/5',
      'data-[highlighted]:bg-ink/5',
      'opacity-85',
      'focus-visible:opacity-100',
      'not-hover:opacity-85',
      '[&:not(:hover)]:opacity-85',
      'not-group-hover:opacity-50',
      'not-peer-hover:opacity-50',
      '[@media(hover:hover)]:opacity-85',
      'hover:',
    ])
      expect(fades(word), word).toBe(false);
  });

  // Tailwind's output keeps a hover rule the declaration's own parent; a nested one is read too.
  it('carries a hover down to the rules nested under it', () => {
    const decl: Node = { kind: 'declaration', property: 'opacity', value: '.5', important: false };
    const inner: Node = { kind: 'rule', selector: '.b', nodes: [decl] };
    expect(fadesIn([{ kind: 'rule', selector: '.a:hover', nodes: [inner] }])).toHaveLength(1);
  });

  it('leaves only the named sites an opacity under a hover, once each', () => {
    const files = walk('src').map((rel) => ({ rel, words: words(rel) }));
    judge(files.flatMap((f) => f.words));
    const found: Record<string, string[]> = {};
    for (const { rel, words: ws } of files) {
      const hits = ws.filter((w) => JUDGED.get(w));
      if (hits.length) found[rel] = hits;
    }
    const allowed = Object.fromEntries(Object.entries(ALLOWED).map(([f, a]) => [f, a.classes]));
    expect(found).toEqual(allowed);
  });

  // Built, so its `@apply`, `@variant` and nesting are read as they render.
  it('sets no opacity under a hover in the stylesheet', () => {
    expect(fadesIn(BUILT)).toEqual([]);
  });

  // The stylesheet's reader, on planted rules: six fades it must report, and two it must not.
  it.each([
    ['an `@apply` under a hover', '.probe:hover { @apply opacity-50; }', 1],
    ['a descendant of a hovered element', '.probe:hover { .inner { opacity: .5; } }', 1],
    ['a brace in a double-quoted string', '.probe:hover::after { content: "}"; opacity: .5; }', 1],
    ['a brace in a single-quoted string', ".probe:hover::after { content: '}'; opacity: .5; }", 1],
    ['a property in capitals', '.probe:hover { OPACITY: .5; }', 1],
    ['an escaped parenthesis in a :not()', '.probe:not(.a\\():hover { opacity: .5; }', 1],
    ['a rest state on a hovering device', '@media (hover: hover) { .probe { opacity: .5; } }', 0],
    ['a dimmed rest, the reverse of a fade', '.probe:not(:hover) { opacity: .5; }', 0],
  ])('reads %s in the built stylesheet', async (_, rule, count) => {
    expect(fadesIn(await build(`${CSS}\n@layer base { ${rule} }`))).toHaveLength(count);
  });

  // The shared reader refuses an escaped quote outside a string, loudly, as every colour guard
  // does on `index.css`; the tree reader's own escape branch still reads one past it.
  it('skips a comment, reads an escape, and throws on what it cannot read', () => {
    expect(fadesIn(read('/* { */ .p:hover { opacity: .5; }'))).toHaveLength(1);
    expect(fadesIn(parseCss(".p\\'x:hover { opacity: .5; }"))).toHaveLength(1);
    expect(() => read(".p\\'x:hover { opacity: .5; }")).toThrow('an unterminated string');
    expect(() => parseCss('.p { opacity: .5; } }')).toThrow('an unmatched }');
    expect(() => parseCss('.p:hover { opacity: .5;')).toThrow('an unclosed block');
  });
});
