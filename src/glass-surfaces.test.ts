// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createElement as h } from 'react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  glassPlanes,
  ratio,
  resolve,
  stripCss,
  themeBlocks,
  type Theme,
} from './__fixtures__/palette';
import { ScreenFailure } from './app/Boundaries';
import { MORE_SHEET } from './app/Sidebar';
import { Card } from './components/ui/Card';
import { AlertDialog, AlertDialogTitle, Dialog, DialogTitle, SHEET } from './components/ui/Dialog';
import { KpiCard } from './components/ui/KpiCard';
import { RecordCard } from './components/ui/RecordCard';

// EVERY CONTENT CARD WEARS THE ONE GLASS (glass.md § Signed, X3; open-values-shell-controls.md
// § Signed, "Tones on glass"): no tone, no tint, and no screen paints a card of its own.
const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);
const THEMES: Theme[] = ['light', 'dark'];

/** The fills the glass replaced, and the shadow it brings its own of. */
const RETIRED = ['bg-card', 'bg-sb-bg', 'bg-pos-tint', 'shadow-(--shadow-card)'];

afterEach(cleanup);
// The top-anchored dialog's Scroller observes its box.
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);
afterAll(() => vi.unstubAllGlobals());

describe('the content cards wear the glass', () => {
  const wears = (el: Element | null) => {
    expect(el, 'no card rendered').not.toBeNull();
    const classes = el!.className.split(/\s+/);
    expect(classes).toContain('glass');
    for (const fill of RETIRED) expect(classes, fill).not.toContain(fill);
  };

  it('`Card`', () => {
    wears(render(h(Card, null, 'x')).container.firstElementChild);
  });

  it('`KpiCard`', () => {
    wears(render(h(KpiCard, { label: 'l', value: 'v', sub: 's' })).container.firstElementChild);
  });

  it('`RecordCard`', () => {
    wears(render(h(RecordCard, { title: 't', children: 'x' })).container.firstElementChild);
  });

  it('the boundaries’ card', () => {
    wears(render(h(ScreenFailure)).container.querySelector('.glass, [class*="rounded-3xl"]'));
  });
});

// THE DIALOGS' THICKER GLASS (open-values-shell-controls.md § Signed, item 6), with wave 8's
// `field-border` edge in place of the glass stroke; the date sheet below md is the same surface.
describe('every dialog surface wears the dialog glass', () => {
  const DIALOG_GLASS = [
    'glass',
    '[--glass-fill:var(--color-glass-dialog-fill)]',
    '[--glass-edge:var(--color-field-border)]',
  ];
  /** What the opaque panel painted, each of which would override the glass or double its edge,
   *  under any variant. */
  const OPAQUE = /(?:^|:)(?:bg-|border|shadow-)/;
  const wears = (className: string) => {
    const classes = className.split(/\s+/);
    for (const c of DIALOG_GLASS) expect(classes, c).toContain(c);
    expect(classes.filter((c) => OPAQUE.test(c))).toEqual([]);
  };
  const panel = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]')!;

  it('`Dialog`', () => {
    render(h(Dialog, { open: true, onOpenChange: () => {}, children: h(DialogTitle, null, 't') }));
    wears(panel().className);
  });

  it.each(['centre', 'top'] as const)('`AlertDialog`, %s', (anchor) => {
    render(
      h(AlertDialog, {
        open: true,
        onOpenChange: () => {},
        anchor,
        children: h(AlertDialogTitle, null, 't'),
      }),
    );
    wears(panel().className);
  });

  it('the date sheet', () => {
    wears(SHEET);
  });
});

// The «Ще» sheet over the scrim takes the dialogs' fill, for the reason they do: on the plain glass
// its rows' and labels' grey fell under 4.5 : 1 in light (mobile-bar-and-sheet.md, § Implementation
// amendment). Its fill is read off its own class, so the class and the reading cannot part.
describe('the «Ще» sheet reads on its glass over the scrim', () => {
  const fill = /\[--glass-fill:var\(--color-([\w-]+)\)\]/.exec(MORE_SHEET)?.[1] ?? 'glass-fill';

  it('wears the glass', () => {
    expect(MORE_SHEET.split(/\s+/)).toContain('glass');
  });

  it.each(
    THEMES.flatMap((theme) =>
      (
        [
          ['ink', 'the title and the active row'],
          ['muted', 'the group labels'],
          ['sb-item', 'the rows'],
        ] as const
      ).map(([token, role]) => [theme, token, role] as const),
    ),
  )('%s: `%s` (%s) clears 4.5 : 1 on its least contrasting plane', (theme, token) => {
    const text = resolve(BLOCKS, theme, token);
    const planes = glassPlanes(CSS, theme, { fill, over: ['card', 'panel'], veil: 'scrim' });
    expect(Math.min(...planes.map((plane) => ratio(text, plane)))).toBeGreaterThanOrEqual(4.5);
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

const name = (file: string) => relative(here, file).split(sep).join('/');

/** A card's corner with a fill of its own in one class string: a card painted by hand. */
const HAND_ROLLED = /(["'`])(?=[^"'`]*\brounded-(?:3xl|\[2\dpx\]))(?=[^"'`]*\bbg-)[^"'`]*\1/g;

/** A utility that writes what the glass declares: its fill, its box-shadow stack or its filter. */
const OVERRIDES_GLASS = /\b(?:bg|shadow|inset-shadow|ring|inset-ring|backdrop)-/;

/** Each `className` that hands one of the glass-wearing components such a utility. */
function handedFills(file: string, text: string): string[] {
  const found: string[] = [];
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ['Card', 'KpiCard', 'RecordCard'].includes(node.tagName.getText(sf))
    )
      for (const attr of node.attributes.properties)
        if (
          ts.isJsxAttribute(attr) &&
          attr.name.getText(sf) === 'className' &&
          OVERRIDES_GLASS.test(attr.initializer?.getText(sf) ?? '')
        )
          found.push(attr.getText(sf));
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('no card is painted off the glass', () => {
  const texts = sourceFiles(here).map((file) => [file, stripTs(readFileSync(file, 'utf8'), file)]);

  it('walks the app', () => {
    expect(texts.length, 'the walk found almost nothing').toBeGreaterThan(100);
  });

  it('every card is a `Card`, a `KpiCard` or a `RecordCard`', () => {
    const found = texts.flatMap(([file, text]) =>
      [...text.matchAll(HAND_ROLLED)].map((m) => `${name(file)}: ${m[0]}`),
    );
    expect(found).toEqual([]);
  });

  // Passed in, it would fight the glass's own over generated-CSS order.
  it('none of them is handed a utility that overrides the glass', () => {
    const found = texts.flatMap(([file, text]) =>
      handedFills(file, text).map((a) => `${name(file)}: ${a}`),
    );
    expect(found).toEqual([]);
  });

  it('is actually looking', () => {
    expect('<div className="animate-in rounded-3xl bg-pos-tint px-[22px]">').toMatch(HAND_ROLLED);
    expect('"rounded-[24px] bg-panel"').toMatch(HAND_ROLLED);
    expect("cn('rounded-[20px]', 'x') bg-card").not.toMatch(HAND_ROLLED);
    expect('"rounded-3xl p-4"').not.toMatch(HAND_ROLLED);
    const planted = [
      '<Card radius={24} className="bg-panel p-4">x</Card>',
      '<KpiCard label="l" value="v" className={`shadow-(--x) ${y}`} />',
      '<RecordCard title="t" className="p-4 ring-1">x</RecordCard>',
      '<Card className="p-4 backdrop-blur-none">x</Card>',
      '<Card className="p-4 rounded-3xl">x</Card>',
    ].join('\n');
    expect(handedFills('x.tsx', planted)).toHaveLength(4);
  });
});

/* ────────────────────────── contrast ────────────────────────── */

// A KPI card's text inks on the glass, wherever the glow can put it (WCAG 1.4.3). The held «—» is
// `faint`, decoration by the signed loading state (empty-loading-error.md § Signed), not text.
describe('a KPI card reads on the glass over the glow', () => {
  it.each(
    THEMES.flatMap((theme) =>
      (
        [
          ['ink', 'the value'],
          ['pos', 'a gain'],
          ['muted', 'the label'],
          ['neg', 'a loss'],
          ['warn-tint-text', 'a caution'],
        ] as const
      ).map(([token, role]) => [theme, token, role] as const),
    ),
  )('%s: `%s` (%s) clears 4.5 : 1 on its least contrasting plane', (theme, token) => {
    const text = resolve(BLOCKS, theme, token);
    const least = Math.min(...glassPlanes(CSS, theme).map((plane) => ratio(text, plane)));
    expect(least).toBeGreaterThanOrEqual(4.5);
  });
});

// A dialog's text inks on its glass over the scrim, wherever the page behind can put it: the
// page and each glow peak, a card or the panel under the veil (WCAG 1.4.3). The light dialog's
// `muted` is the reading wave 26 thickened the fill for (open-values-shell-controls.md § Signed).
describe('a dialog reads on its glass over the scrim', () => {
  it.each(
    THEMES.flatMap((theme) =>
      (
        [
          ['ink', 'the title and fields'],
          ['muted', 'labels and the description'],
        ] as const
      ).map(([token, role]) => [theme, token, role] as const),
    ),
  )('%s: `%s` (%s) clears 4.5 : 1 on its least contrasting plane', (theme, token) => {
    const text = resolve(BLOCKS, theme, token);
    const planes = glassPlanes(CSS, theme, {
      fill: 'glass-dialog-fill',
      over: ['card', 'panel'],
      veil: 'scrim',
    });
    expect(Math.min(...planes.map((plane) => ratio(text, plane)))).toBeGreaterThanOrEqual(4.5);
  });
});
