import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  composite,
  glassSaturation,
  mixOf,
  ratio,
  resolve,
  saturate,
  stripCss,
  themeBlocks,
  veilOf,
} from './__fixtures__/palette';

// THE FLOATING SURFACES' BOUNDARY, ON THE SAME TOKEN AS THE FIELD EDGE. An `AssetForm`
// `Select` opens INSIDE a `Dialog`, so a `bg-card` popover lands on a `bg-card` plane — and
// WCAG 1.4.11 governs "the visual information required to identify user interface components",
// which a listbox popover is.
//
// Two halves and neither catches the other, the split `field-border.test.ts` records. With
// no shared popover component a fourth surface added by copying a third lands on whatever
// the third used, which is how the toast got its own edge.
//
// The colour maths and token readers are the shared `__fixtures__/palette.ts`; the TypeScript
// reader below is a copy, held to one text by `ts-reader-census.test.ts`.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
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
const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

const BLOCKS = themeBlocks(CSS);

/** `card` binds twice over — a popover's own fill AND, inside a `Dialog`, the plane behind it.
 *  The collapsed rail left the rank for the glass band's hairline (rail-and-account-foot.md
 *  § Signed, O3), so it has no group here. */
const DRAWN_ON = {
  'the floating surfaces': ['page', 'card', 'panel'],
} as const;
const THEMES = ['light', 'dark'] as const;
/** Not a token list — a list of what must NOT come back. */
const RETIRED = ['popover-edge', 'toast-edge', 'surface-edge'] as const;

describe('a floating surface clears 3 : 1 on every plane it is drawn on', () => {
  for (const theme of THEMES) {
    for (const group of Object.keys(DRAWN_ON) as (keyof typeof DRAWN_ON)[]) {
      it(`${theme}: the rank clears the bar under ${group}`, () => {
        const value = resolve(BLOCKS, theme, 'field-border');
        for (const surface of DRAWN_ON[group]) {
          expect(
            ratio(value, resolve(BLOCKS, theme, surface)),
            `field-border reads under 3 : 1 on ${surface} — the surface is unidentifiable`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  // THE OVERLAY ADJACENCY IS A SEPARATE READING, not a plane above: the panel and the date
  // sheet float over the overlay, so what identifies them is that composite.
  //
  // ANCHORED ON `inset-0`, not on the first `bg-` in the file: `bg-scrim` is not a unique
  // class, and a bare `bg-` match reads one of `DatePicker`'s hover fills, far above the
  // overlay. Either quote, because `Dialog` holds its string in a const and `DatePicker`
  // writes the attribute inline.
  const overlayOf = (file: string) => {
    const m = source(file).match(/['"][^'"]*\binset-0\b[^'"]*['"]/);
    expect(m, `${file} no longer paints an overlay this can read`).not.toBeNull();
    const token = m![0].match(/\bbg-([a-z-]+)\b/);
    expect(token, `${file}'s overlay names no fill`).not.toBeNull();
    return token![1];
  };

  it('the panel and the date sheet paint one veil, so one reading covers both', () => {
    expect(
      overlayOf('components/ui/Dialog.tsx'),
      'the two overlays drifted apart — read separately because `OVERLAY_CLASS` is not ' +
        'exported and `DatePicker` hand-copies the string',
    ).toEqual(overlayOf('components/ui/DatePicker.tsx'));
  });

  // EITHER BOUNDARY, NO SHADOW COUNTED. 1.4.11 asks for the information that IDENTIFIES a
  // component, not for a stroke, and the glass offers two candidates: its fill composited
  // over the saturated veil, and its stroke. Least contrasting area: no sheen, saturate in
  // both spaces. Mixing with `transparent` only sets alpha, so sRGB compositing is exact.
  const identifies = (theme: (typeof THEMES)[number]) => {
    const veil = veilOf(BLOCKS, theme, overlayOf('components/ui/Dialog.tsx'));
    const edge = resolve(BLOCKS, theme, 'field-border');
    const fill = mixOf(BLOCKS, theme, 'glass-dialog-fill');
    const s = glassSaturation(CSS);
    return (['page', 'card', 'panel'] as const).map((plane) => {
      const ground = composite(veil, resolve(BLOCKS, theme, plane));
      const glass = Math.min(
        ...(['srgb', 'linear'] as const).map((space) =>
          ratio(composite(fill, saturate(ground, s, space)), ground),
        ),
      );
      return { plane, best: Math.max(glass, ratio(edge, ground)) };
    });
  };

  it('dark: the panel and the date sheet stay identifiable on their veil', () => {
    for (const { plane, best } of identifies('dark')) {
      expect(
        best,
        `neither the glass nor its stroke identifies it over ${plane}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  // A RULED SHORTFALL, RECORDED AT ITS VALUE (#99): in light the stroke adds nothing over the
  // veil and the glass reads just under 3 : 1 over a veiled `card`. A dialog is a container,
  // not a control, and its title and actions identify it; the owner ruled the value stands.
  it('light: the glass over its veil, at the value the owner ruled', () => {
    expect(Math.min(...identifies('light').map((r) => r.best))).toBeCloseTo(2.947, 2);
  });

  // The glass's fallback (no blur support, reduced transparency) is the opaque `card`, and that
  // one clears the bar by its fill in light and its stroke in dark.
  for (const theme of THEMES) {
    it(`${theme}: the opaque fallback stays identifiable on its veil`, () => {
      const veil = veilOf(BLOCKS, theme, overlayOf('components/ui/Dialog.tsx'));
      const edge = resolve(BLOCKS, theme, 'field-border');
      const fill = resolve(BLOCKS, theme, 'card');
      for (const plane of ['page', 'card', 'panel'] as const) {
        const ground = composite(veil, resolve(BLOCKS, theme, plane));
        expect(
          Math.max(ratio(fill, ground), ratio(edge, ground)),
          `neither the fallback's fill nor its stroke identifies it over ${plane}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // Three names for one step is what was ruled out, and nothing else in the repo would fail
  // if a "give the toast its own edge" edit put one back. THE WHOLE STYLESHEET, not the two
  // palette blocks: a re-mint under `:root`, under a media query or inside a new scope is
  // just as real and invisible to a two-block check.
  it('does not re-mint the three retired names, anywhere in the stylesheet', () => {
    for (const name of RETIRED) {
      expect(CSS, `--color-${name} is declared again`).not.toMatch(
        new RegExp(`--color-${name}\\s*:`),
      );
    }
  });

  // THE RAIL'S EDGE, CLOSED RATHER THAN DESCRIBED: overriding `field-border` under any
  // scope containing the rail moves that edge while every ratio above goes on resolving
  // `@theme`. Written for ANY such scope rather than the ones it knows about.
  it('leaves the rail edge to `@theme`, not to a scope that contains the rail', () => {
    const palette = [BLOCKS.light, BLOCKS.dark];
    const strays = [...CSS.matchAll(/([^{}]*)\{([^{}]*--color-field-border\s*:[^{}]*)\}/g)]
      .filter((m) => !palette.some((block) => block.includes(m[2])))
      .map((m) => m[1].trim().split('\n').pop()!.trim());
    expect(
      strays,
      'the rail reads `field-border` from `@theme`; declaring it elsewhere moves that edge',
    ).toEqual([]);
  });

  // THE PALETTE'S OWN INVARIANT, ENFORCED RATHER THAN COUNTED BY HAND. Deleting a token
  // from one block passed every gate before this. The chart aliases are excluded: they are
  // declared once and follow the base tokens through `var()`.
  it('declares the same palette in `@theme` and in the dark block, one for one', () => {
    const names = (block: string) =>
      [
        ...new Set(
          [...block.matchAll(/--color-([a-z0-9-]+):/g)]
            .map((m) => m[1])
            .filter((n) => !n.startsWith('chart-')),
        ),
      ].sort();
    const [light, dark] = [names(BLOCKS.light), names(BLOCKS.dark)];
    expect(
      light.filter((n) => !dark.includes(n)),
      'declared in @theme, missing in dark',
    ).toEqual([]);
    expect(
      dark.filter((n) => !light.includes(n)),
      'declared in dark, missing in @theme',
    ).toEqual([]);
    // An ANTI-EMPTY floor and nothing more: two empty lists agree with each other. NOT a
    // completeness check — a number here would be the hand-kept figure this test replaces,
    // and it sits FAR below the count or it is a census wearing a floor's name.
    expect(light.length, 'the palette suddenly has almost nothing in it').toBeGreaterThanOrEqual(
      60,
    );
    // One name per family: the set equality above catches a half-deleted family, a whole
    // one going is what this stops. The parchment families were minted ahead of any
    // consumer, so the floor would not have noticed one going.
    for (const name of [
      'hairline',
      'panel-border',
      'field-border',
      'accent',
      'accent-fg',
      'selection',
      'info',
      'info-tint-text',
      'logo-outline',
      'sb-bg',
      'sb-item-active',
      'sb-indicator',
      'sb-label',
      'glass-rim',
      'glass-shade',
      'glow-1',
    ])
      expect(light).toContain(name);
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

/** `.ts` as well as `.tsx`: several edges are strings in plain modules and a `.tsx`-only walk
 *  could not see them. The walk is `src/` alone — the chart tooltip's edge moved to the domain
 *  package and is read by name below, because widening this sweep to the package would pull in
 *  sixty modules that paint nothing. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = new Map(
  sourceFiles(here)
    .map((f) => relative(here, f).split(sep).join('/'))
    .map((f) => [f, stripTs(read(f), f)] as const),
);
const FILES = [...SOURCES.keys()];
const source = (f: string) => {
  const s = SOURCES.get(f);
  expect(s, `${f} is gone — this pin needs rewriting`).toBeDefined();
  return s!;
};
/** Outside the walk above, and deliberately so — see `sourceFiles`. */
const CHART_COLORS = stripTs(
  read('../packages/core/src/colors.ts'),
  '../packages/core/src/colors.ts',
);

// AND IT IS IN HERE TOO, not only in the one positive assertion it was read for: the retirement
// sweep at the foot of this file reads `ALL_SOURCE`, and this is the only module outside `src/`
// that names palette tokens. Left out, that guard goes on passing because it stopped looking.
const ALL_SOURCE = [...SOURCES.values(), CHART_COLORS].join('\n');

/** Line-based is enough: the border and the shadow live in one `className` string, not in
 *  two attributes. A line deferring its edge to an interpolation OR A CONCATENATION is
 *  exempt — the two arms of `DEFERS` — and the `it` below holds that exemption empty. */
const GLASS = /(?<![\w-])glass(?![\w-])/;
/** A glass surface draws its edge as an inset shadow, so it names the token through the override. */
const GLASS_EDGE = /\[--glass-edge:var\(--color-field-border\)\]/;
const POPOVER_LINE = (line: string) =>
  /shadow-\(--shadow-popover\)/.test(line) || (/\bz-50\b/.test(line) && GLASS.test(line));
const NAMES_TOKEN = (text: string) => /\bborder-field-border\b/.test(text) || GLASS_EDGE.test(text);
const DEFERS = (line: string) => /\$\{/.test(line) || line.trimEnd().endsWith('+');

const POPOVERS = FILES.flatMap((f) =>
  source(f)
    .split('\n')
    .filter(POPOVER_LINE)
    .map((line) => ({ file: f, line })),
);
const POPOVER_FILES = [...new Set(POPOVERS.map((p) => p.file))];

// NOT "every floating surface" — this cannot know what one is. The toast paints from a
// style object with no utility to match on, and the chart tooltip is glass outside the
// popovers' line shape, so each is named site by site and the floor below fails when one
// is dropped. Closing it properly means one shared recipe (#84).
describe('the floating surfaces point at the token', () => {
  it('finds the class-based ones by walking, so an empty pass cannot look green', () => {
    expect(
      POPOVERS.length,
      'no surface names `shadow-(--shadow-popover)` or the glass any more — a floor, so a ' +
        'sixth surface passes here and is caught by the assertions below instead',
    ).toBeGreaterThanOrEqual(3);
  });

  // P2: the Select list and the md-and-up date popover are the glass, on the field edge; so is
  // the dialog (D2), on its own fill.
  it('puts the Select list, the date popover and the dialog on the glass', () => {
    const glass = POPOVERS.filter((p) => GLASS.test(p.line)).map((p) => p.file);
    expect(glass.sort()).toEqual([
      'components/ui/DatePicker.tsx',
      'components/ui/Dialog.tsx',
      'components/ui/Select.tsx',
    ]);
    // The utility, not its override or a sibling utility.
    expect('z-50 glass p-2').toMatch(GLASS);
    expect('[--glass-edge:var(--x)] glass-knob md:glass-well').not.toMatch(GLASS);
  });

  // NO `DEFERS` EXEMPTION HERE: the `it` two below holds that exemption empty, so exempting
  // a line here could only hide the very surface that one fails about.
  it('names `field-border` on every one of them', () => {
    const missing = POPOVERS.filter((p) => !NAMES_TOKEN(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(missing).toEqual([]);
  });

  // THE COMPENSATING HALF FOR `DEFERS`: without it a surface building its className from a
  // template literal is exempt from the line check and invisible to everything else.
  it.each(POPOVER_FILES)('%s names the token somewhere, however it composes', (file) => {
    expect(
      NAMES_TOKEN(source(file)),
      `${file} holds a floating surface but never names the token`,
    ).toBe(true);
  });

  // AND THE COMPENSATOR IS WEAKER THAN IT LOOKS, asserted rather than hidden: `Select.tsx`
  // and `DatePicker.tsx` hold a trigger FIELD on the same shared rank, so a listbox that
  // deferred its className would satisfy the per-file check through the trigger while its
  // own popover had no boundary at all.
  it('has no floating surface relying on the escape hatch', () => {
    const deferring = POPOVERS.filter((p) => DEFERS(p.line)).map((p) => p.file);
    expect(
      deferring,
      'a floating surface defers its edge — the per-file check cannot tell it from a field',
    ).toEqual([]);
  });

  it('leaves none of them on `hairline`', () => {
    const stale = POPOVERS.filter((p) => /\bborder-hairline\b/.test(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(
      stale,
      'a floating surface is back on `hairline`, which is far under the bar on every plane ' +
        'once the shadow is gone — the token keeps dividers and grid lines, not surfaces',
    ).toEqual([]);
  });

  // The two the utility assertions are blind to, named rather than detected.
  // Wave 25 (`open-values-charts-type.md` § Signed): the chart tooltip wears the glass edge as
  // wave 15 left it, `ink` 6 % and the bevel; `field-border` is not its edge.
  it('puts the chart tooltip on the glass, with the glass edge', () => {
    const tooltip = source('components/charts/ChartTooltip.tsx');
    expect(tooltip).toMatch(GLASS);
    expect(tooltip, 'the chart tooltip overrides the glass edge').not.toMatch(/--glass-edge/);
    expect(CHART_COLORS, 'the old panel tooltip is back').not.toContain('var(--color-panel)');
  });

  it('carries the toast, which paints from a style object', () => {
    const main = source('app/AppToaster.tsx');
    expect(main, 'the toast no longer reads the popover shadow').toContain(
      "boxShadow: 'var(--shadow-popover)'",
    );
    expect(main).toContain("border: '1px solid var(--color-field-border)'");
    expect(
      main,
      'the toast is back on the rank it left — matched on the DECLARATION, so a sonner ' +
        'action button legitimately reading `panel-border` is not a border regression',
    ).not.toContain("border: '1px solid var(--color-panel-border)'");
  });

  // Not a popover, but it rides this token. ON THE ELEMENT, not merely in the file: EVERY
  // line, deliberately — `PANEL_CLASS` is consumed by `Dialog` and `AlertDialog`, so split per
  // dialog kind ALL of them must have an edge. The panel is glass, so its edge is the glass's
  // stroke swapped for the token.
  const PANEL_AND_RAIL: [string, RegExp, RegExp, 'every' | 'some'][] = [
    [
      'components/ui/Dialog.tsx',
      /(?<![-\w[])glass(?![-\w]).*\brounded-3xl\b/,
      /\[--glass-edge:var\(--color-field-border\)\]/,
      'every',
    ],
  ];
  it.each(PANEL_AND_RAIL)('keeps %s on `field-border`', (file, anchor, token, quantifier) => {
    const lines = source(file)
      .split('\n')
      .filter((l) => anchor.test(l));
    expect(lines.length, `the ${file} line vanished`).toBeGreaterThan(0);
    const named = lines.filter((l) => token.test(l)).length;
    expect(named, `${file} left the token`).toBeGreaterThan(0);
    if (quantifier === 'every') {
      expect(named, `${file} has a panel line without the token`).toBe(lines.length);
    }
  });

  // The markup half of the retirement guard, and comments are stripped from `ALL_SOURCE` so
  // it is about what the app READS: pointing at a name the palette no longer declares
  // renders as no border at all rather than as a failure.
  it('reads none of the three retired names', () => {
    for (const name of RETIRED) {
      expect(ALL_SOURCE, `something still reads \`${name}\``).not.toMatch(
        new RegExp(`\\bborder-${name}\\b|--color-${name}\\b`),
      );
    }
  });
});
