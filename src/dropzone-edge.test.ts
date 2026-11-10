import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { luminance, ratio, resolve, stripCss, themeBlocks } from './__fixtures__/palette';

// THE IMPORT DROPZONE'S EDGE, at the same bar as the field edge, the switch and the
// floating surfaces (`docs/superpowers/specs/2026-11-05-layout-refresh/forms-and-dialogs.md`
// § Перенесено, #88): the box that says WHERE a file may be dropped used to be the faintest
// thing on the screen.
//
// TWO ADJACENCIES, NOT THREE. This box is `bg-panel` inside the Settings Data `card`, so it
// is scored INWARD against its own fill and OUTWARD against the card behind it. `page` is
// not one of its planes, which is the difference from `field-border.test.ts`'s
// three-surface sweep: a field is drawn on all three, this box on one.
//
// NO TOKEN IS MINTED — the rest reads `field-border` directly, holding no shortfall and no
// per-theme difference, so a name would be the rank's own value drawn twice.
//
// A GUARD OF ITS OWN ON PURPOSE: folding this into `field-border.test.ts` would put the
// dropzone inside the FIELD guard — being a non-field is exactly what let this box go
// unowned.
//
// READ THIS FILE WITH `field-border.test.ts`: its `hover:border-muted` ban is scoped per
// field SITE and a dropzone is no field, so the two cannot collide — but a field landing in
// `ImportRow.tsx` still answers this file's WHOLE-FILE assertions, the fill census and the
// `border-dashed` ban. Never resolve such a collision by weakening an assertion: the scope
// belongs to whichever guard owns the subject.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** Not cosmetic: every file read here is one whose comments discuss the utilities being
 *  asserted on, so a comment could satisfy an assertion the code fails or fail one it
 *  passes.
 *
 *  Copied SIGNATURE AND ALL rather than imported:
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

const THEMES = ['light', 'dark'] as const;
/** INWARD is the box's own fill, OUTWARD the `Card` it sits in. A stroke has two adjacencies
 *  and judging it on one is a judgement about half the object. */
const PLANES = { inward: 'panel', outward: 'card' } as const;
/** rest → hover → drag-over, weakest first, EACH WITH THE FILL ITS OWN STATE PAINTS. The
 *  drag arm swaps the fill to `hairline`, so reading its edge against `panel` would score it
 *  on a surface that state never shows. This drives both the ORDER assertions and the
 *  recorded readings below. */
const RUNGS = [
  ['field-border', 'panel'],
  ['muted', 'panel'],
  ['ink', 'hairline'],
] as const;

describe('the dropzone edge clears 3 : 1 on both of its planes, in both themes', () => {
  for (const theme of THEMES) {
    it(`${theme}: the rest edge clears the bar inward and outward`, () => {
      const edge = resolve(BLOCKS, theme, 'field-border');
      for (const [side, plane] of Object.entries(PLANES)) {
        const r = ratio(edge, resolve(BLOCKS, theme, plane));
        expect(
          r,
          `${theme} rest is ${r.toFixed(2)} : 1 ${side} on \`${plane}\``,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // THE RECORDED READINGS, so a re-value of `panel`, `card` or the rank cannot move the
  // dropzone's figures without saying so here.
  //
  // ROUNDED EQUALITY, NOT `toBeCloseTo`: the matcher's tolerance at 2 digits is 0.005, wider
  // than the figure it would pin, so a re-value that changed the recorded 2-dp number could
  // still slip through. What the ruling records is the PRINTED number, so that is compared.
  //
  // ALL THREE STATES, not just the rest, because the edge has all three and a figure
  // lives in a test or not at all. Pinning the rest alone would let a re-value of `muted`
  // move the hover anywhere above it while every table went on printing the old number.
  it.each([
    ['light', 'rest', 'inward', 3.06],
    ['light', 'rest', 'outward', 3.69],
    ['dark', 'rest', 'inward', 3.65],
    ['dark', 'rest', 'outward', 3.94],
    ['light', 'hover', 'inward', 5.28],
    ['light', 'hover', 'outward', 6.36],
    ['dark', 'hover', 'inward', 6.36],
    ['dark', 'hover', 'outward', 6.87],
    ['light', 'drag', 'inward', 11.91],
    ['light', 'drag', 'outward', 15.93],
    ['dark', 'drag', 'inward', 12.16],
    ['dark', 'drag', 'outward', 14.74],
  ] as const)('%s %s reads %s at %s : 1, as the ruling records', (theme, state, side, expected) => {
    const [edge, fill] = RUNGS[{ rest: 0, hover: 1, drag: 2 }[state]];
    const against = side === 'inward' ? fill : PLANES.outward;
    const r = ratio(resolve(BLOCKS, theme, edge), resolve(BLOCKS, theme, against));
    expect(
      Number(r.toFixed(2)),
      'this reading moved off the figure the ruling records, and nothing else records it',
    ).toBe(expected);
  });

  // The box is drawn on `panel` inside a `card` and nowhere else, which the two adjacencies
  // above cover. A scope re-valuing `muted`, `faint` or `panel-border` but NOT the rank
  // would move the rest and the hover apart, and nothing guards that in general —
  // `sidebar-plane.test.ts` holds only that the one scope it retired stays absent.
});

describe('hover leaves the rest behind, and drag-over leaves hover behind', () => {
  // THE DEFECT THIS REPLACES, stated as an ordering rather than a figure: the hover used to
  // lie on the WRONG SIDE of the rest edge, so the box went QUIETER under the pointer. An
  // ordering, because the property worth holding is that the three states stay TOLD APART —
  // a figure goes stale at the next re-value and says nothing about the state machine.
  for (const theme of THEMES) {
    it(`${theme}: the three states are strictly ordered inward, each on its own fill`, () => {
      const rungs = RUNGS.map(([edge, fill]) =>
        ratio(resolve(BLOCKS, theme, edge), resolve(BLOCKS, theme, fill)),
      );
      for (let i = 1; i < rungs.length; i++) {
        expect(
          rungs[i],
          `${RUNGS[i][0]} (${rungs[i].toFixed(2)}) must beat ${RUNGS[i - 1][0]} (${rungs[i - 1].toFixed(2)})`,
        ).toBeGreaterThan(rungs[i - 1]);
      }
    });

    // OUTWARD is fill-independent — every state is drawn over the same `card` — so the
    // edges alone have to keep the order there.
    it(`${theme}: the three states are strictly ordered outward on the card`, () => {
      const card = resolve(BLOCKS, theme, PLANES.outward);
      const rungs = RUNGS.map(([edge]) => ratio(resolve(BLOCKS, theme, edge), card));
      for (let i = 1; i < rungs.length; i++) {
        expect(
          rungs[i],
          `${RUNGS[i][0]} (${rungs[i].toFixed(2)}) must beat ${RUNGS[i - 1][0]} (${rungs[i - 1].toFixed(2)})`,
        ).toBeGreaterThan(rungs[i - 1]);
      }
    });

    it(`${theme}: every state's edge sits on the same side of its own fill`, () => {
      const [, restFill] = RUNGS[0];
      const darker =
        luminance(resolve(BLOCKS, theme, 'field-border')) <
        luminance(resolve(BLOCKS, theme, restFill));
      for (const [edge, fill] of RUNGS) {
        expect(
          luminance(resolve(BLOCKS, theme, edge)) < luminance(resolve(BLOCKS, theme, fill)),
          `\`${edge}\` crosses its fill — the state would invert instead of deepening`,
        ).toBe(darker);
      }
    });
  }
});

/* ────────────────────────── the markup half ────────────────────────── */

// KEYED ON BEHAVIOUR, NEVER ON STYLING, and the shape is the point. Every earlier version
// tried to LOCATE the drop target in the source — by line, by the first template mentioning
// `dragOver`, by the template carrying the radius — and each anchor was a guess about how
// the JSX would be written. One was circular besides: it selected the box BY `rounded-2xl`
// and then asserted `rounded-2xl` was there, so it could never fail for the reason its
// message gave. There are more ways to write the markup than a guard can enumerate.
//
// So the anchor is the `dragOver ? … : …` conditional, which exists because the component
// has two states and not because of how either is painted, and positives are read off its
// two arms. NEGATIVES ARE READ OVER THE WHOLE FILE: narrowed to the rest arm, a
// `hover:border-faint` written into the static half applies at rest and passed.
// `ImportRow.tsx` draws one bordered box, so a whole-file negative has nothing to collide
// with; if it grows a second, that collision is a real question about this ruling.
//
// NOTHING HERE RUNS AT COLLECTION TIME. A parse that throws during module evaluation takes
// the file to "no tests" — `pnpm test` red, the pinned ratios above never run, and the
// failure naming the markup rather than the palette. Each test does its own reading.
//
// GEOMETRY IS NOT THIS GUARD'S SUBJECT: the radius is deliberately unpinned, and respelling
// it as the identical `rounded-[16px]` once took the whole file inert. Solidity IS pinned
// below, because "never dashed" is a claim about the boundary this ruling owns.
describe('the markup points at the rank', () => {
  const source = () =>
    stripTs(read('screens/settings/ImportRow.tsx'), 'screens/settings/ImportRow.tsx');

  /** The two arms of the state conditional. Both live on ONE line, so a line filter selects
   *  the same string for each and cannot tell them apart — transposing them would ship the
   *  rest at `ink`. */
  const arms = (src: string) => {
    const m = src.match(/dragOver\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
    expect(m, 'the `dragOver ? … : …` arms are no longer two string literals').not.toBeNull();
    return { drag: m![1].split(/\s+/), rest: m![2].split(/\s+/) };
  };

  // EXACT MEMBERSHIP, never a regex: `\bbg-panel\b` also matches inside `bg-panel-border`,
  // and `\bborder-ink\b` inside `border-ink-hover`.
  it('the rest arm wears the rank, hovers to `muted`, and keeps the `panel` fill', () => {
    const { rest } = arms(source());
    expect(rest, 'the rest edge left the control-boundary rank').toContain('border-field-border');
    expect(rest, 'the hover left `muted`').toContain('hover:border-muted');
    expect(rest, 'the rest fill moved off `panel`, which every inward figure assumes').toContain(
      'bg-panel',
    );
  });

  it('keeps the drag-over arm on `ink` over a `hairline` fill', () => {
    const { drag } = arms(source());
    expect(drag).toContain('border-ink');
    expect(drag, 'the drag fill moved off `hairline`, which its inward figure assumes').toContain(
      'bg-hairline',
    );
    expect(
      drag,
      'the arms are transposed — the rest edge is now the drag cue. Asserting the rank is ' +
        'ABSENT here is what catches that, and why `ink` is left to this state alone: two ' +
        'states sharing a border are one state',
    ).not.toContain('border-field-border');
  });

  // WHOLE FILE, AND BY SUFFIX so a variant prefix cannot slip past: the box already carries
  // `max-sm:p-4`, so `max-sm:border-dashed` is a live spelling that exact-string membership
  // would have accepted.
  it.each([
    ['border-panel-border', 'the token the rest edge left is back'],
    ['border-faint', 'the inverting hover is back — it lies on the wrong side of the new rest'],
    ['border-dashed', 'the drop target went dashed, which navigation-map.md forbids'],
  ])('names no `%s` anywhere in the file', (utility, why) => {
    const named = source()
      .match(/[\w:[\]/.%-]+/g)!
      .filter((t) => t === utility || t.endsWith(`:${utility}`));
    expect(named, why).toEqual([]);
  });

  it('gives the box no fill beyond the two its states declare', () => {
    const fills = source()
      .match(/[\w:[\]/.%-]+/g)!
      .filter((t) => /(^|:)bg-/.test(t));
    expect(
      new Set(fills),
      'a third fill arrived — every inward figure is read against the fill its own state ' +
        'paints, so a `hover:bg-*` leaves the recorded hover readings describing a plane ' +
        'the hovered box no longer shows',
    ).toEqual(new Set(['bg-panel', 'bg-hairline']));
  });

  // A TRIPWIRE, NOT A PROOF, and named as one: this cannot see an interposed wrapper or a
  // `<Card>` opened in another component, so it catches the row being rehoused wholesale
  // and nothing subtler.
  it('still renders the row inside a `Card` — a tripwire on the outward plane', () => {
    const settings = stripTs(read('screens/Settings.tsx'), 'screens/Settings.tsx');
    const at = settings.indexOf('<ImportRow');
    expect(at, 'Settings no longer renders the import row').toBeGreaterThan(-1);
    const before = settings.slice(0, at);
    const opened = (before.match(/<Card\b/g) ?? []).length;
    const selfClosed = (before.match(/<Card\b[^>]*\/>/g) ?? []).length;
    const closed = (before.match(/<\/Card>/g) ?? []).length;
    expect(
      opened - selfClosed - closed,
      'the import row left its `Card` — every outward figure describes `card`',
    ).toBeGreaterThan(0);
    expect(
      stripTs(read('components/ui/Card.tsx'), 'components/ui/Card.tsx'),
      '`Card` no longer paints `bg-card`',
    ).toMatch(/\bbg-card\b/);
  });
});
