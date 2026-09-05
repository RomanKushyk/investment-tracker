import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE IMPORT DROPZONE'S EDGE, PINNED AT THE SAME BAR AS THE FIELD EDGE, THE
// SWITCH AND THE FLOATING SURFACES.
//
// `design/extensions/dropzone-edge.dc.html` (#88) moves the drop target's rest
// off `panel-border` and onto the control-boundary rank. Before it the rest read
// 1.44 inward / 1.74 outward in light and 1.40 / 1.51 in dark — the box that
// says WHERE a file may be dropped was the faintest thing on the screen.
//
// TWO ADJACENCIES, NOT THREE. This box is `bg-panel` inside the Settings Data
// `card`, so it is scored INWARD against its own fill and OUTWARD against the
// card behind it. `page` is not one of its planes and is deliberately absent
// here, which is the difference from `field-border.test.ts`'s three-surface
// sweep: a field is drawn on all three, this box on one.
//
// NO TOKEN IS MINTED. The rest reads `field-border` directly, as #98's seven
// consumers do — it holds no shortfall and no per-theme difference, so a name
// would be the rank's own value drawn twice.
//
// SELF-CONTAINED ON PURPOSE — the house idiom, not an oversight.
// `field-border.test.ts`, `switch-border.test.ts` and `floating-edges.test.ts`
// each carry their own reader, so a guard can be read without opening another.
// Folding these into `field-border.test.ts` would put the dropzone inside the
// FIELD guard, and being a non-field is exactly what let this box go unowned
// through four sheets.
//
// ONE TRAP, RECORDED BECAUSE IT IS INVISIBLE FROM EITHER FILE ALONE.
// `field-border.test.ts` forbids `hover:border-muted` anywhere in a FIELD_FILE,
// reading the WHOLE source; this file requires it in `ImportRow.tsx`. The two
// coexist only because `ImportRow.tsx` carries no `rounded-[9px] h-9` line and
// so is not a FIELD_FILE. Give the import row a standard field — #84's shared
// recipe would — and the two guards become unsatisfiable together. The fix then
// is to scope that ban to field LINES rather than whole files, which is issue
// 100's subject; do not resolve it by weakening either assertion here.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** TS comments out before the markup half reads a source. Not cosmetic: every
 *  file read here is one whose comments discuss the utilities being asserted on —
 *  `ImportRow.tsx` names its own ruling, `Settings.tsx` annotates the row — so a
 *  comment could satisfy an assertion the code fails, or fail one it passes. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

/** CSS comments out, quote-aware. The readers below take the FIRST match in a
 *  block and this stylesheet quotes token declarations inside its comments
 *  constantly — including retired values it tells you not to re-mint. Quote-aware
 *  because `index.css` line 5 holds a literal comment opener inside a string,
 *  and a naive strip swallows from there to the first real terminator, taking
 *  `@theme` with it. */
function stripCss(source: string, what: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      // Loudly, not silently: truncating would let every assertion pass over a
      // partial file. `ruleBody` throws for the same reason.
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

/** sRGB → relative luminance, WCAG 2.x. */
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
 *  are bounded: an unbounded slice would read a token out of a later rule. */
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

/** Follows a `var(--color-x)` chain to the hex at the end of it, THE WAY THE
 *  CASCADE DOES — a name the dark block does not override resolves against
 *  `@theme`. Copied from `switch-border.test.ts`; a literal-hex reader would see
 *  nothing through an alias, and the rank has aliases pointed at it. */
function resolve(theme: 'light' | 'dark', name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle: ${[...seen, name].join(' → ')}`).not.toContain(
    name,
  );
  // Lazily, the way `switch-border.test.ts:131` and `floating-edges.test.ts:196`
  // do it: evaluating the light-block fallback unconditionally rescans the whole
  // `@theme` body a second time for a result already in hand.
  const decl = (block: string) => block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  const found = decl(BLOCKS[theme]) ?? decl(BLOCKS.light);
  expect(found, `--color-${name} is declared in neither block`).not.toBeNull();
  const value = found![1].trim();
  // No fallback group: this palette declares none, and capturing one only to
  // discard it tells the reader a `var(--x, #hex)` would resolve when it throws.
  const alias = value.match(/^var\(\s*--color-([a-z0-9-]+)\s*\)$/);
  if (alias) return resolve(theme, alias[1], [...seen, name]);
  const hex = value.toLowerCase();
  expect(hex, `--color-${name} is neither a hex nor a --color-* alias (got \`${value}\`)`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

const THEMES = ['light', 'dark'] as const;
/** INWARD is the box's own fill, OUTWARD the `Card` it sits in
 *  (`Settings.tsx:487`). A stroke has two adjacencies and judging it on one is a
 *  judgement about half the object — #98 learned that on the Dialog panel. */
const PLANES = { inward: 'panel', outward: 'card' } as const;
/** rest → hover → drag-over, weakest first, EACH WITH THE FILL ITS OWN STATE
 *  PAINTS. The drag arm swaps the fill to `hairline`, so reading its edge
 *  against `panel` would score it on a surface that state never shows — the
 *  measured inward reading is 11.91 light and 12.16 dark, not the 13.23 / 13.66
 *  a common-plane comparison gives. This drives both the ORDER assertions and
 *  the twelve recorded readings below. */
const RUNGS = [
  ['field-border', 'panel'],
  ['muted', 'panel'],
  ['ink', 'hairline'],
] as const;

describe('the dropzone edge clears 3 : 1 on both of its planes, in both themes', () => {
  for (const theme of THEMES) {
    it(`${theme}: the rest edge clears the bar inward and outward`, () => {
      const edge = resolve(theme, 'field-border');
      for (const [side, plane] of Object.entries(PLANES)) {
        const r = ratio(edge, resolve(theme, plane));
        expect(
          r,
          `${theme} rest is ${r.toFixed(2)} : 1 ${side} on \`${plane}\``,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // THE RECORDED READINGS, so a re-value of `panel`, `card` or the rank cannot
  // move the dropzone's figures without saying so here.
  //
  // ROUNDED EQUALITY, NOT `toBeCloseTo`. The matcher's tolerance at 2 digits is
  // 0.005, which is wider than the figure it would pin: dark outward is really
  // 3.935514 and would pass against 3.94 with 0.0045 to spare, so a re-value
  // that changed the recorded 2-dp figure could still slip through. What the
  // ruling records is the printed number, so that is what is compared.
  //
  // ALL THREE STATES, not just the rest. This branch published the hover and
  // drag-over figures in `design/extensions/README.md` and in the sheet's T3, and
  // CLAUDE.md is flat about it: "A figure lives in a test or not at all." Pinning
  // the rest alone would have let a re-value of `muted` drop the hover from 5.28
  // to anything above the rest while every table went on printing 5.28.
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
    // INWARD is each state's own fill — the drag arm paints `hairline`, not
    // `panel`. OUTWARD is the `card` behind the box, the same for all three.
    const against = side === 'inward' ? fill : PLANES.outward;
    const r = ratio(resolve(theme, edge), resolve(theme, against));
    expect(Number(r.toFixed(2))).toBe(expected);
  });

  // THE RANK IS NOT RE-VALUED ON A DARK SURFACE, AND THE HOVER IS. `index.css`'s
  // `[data-dark-surface]` block overrides `muted`, `faint` and `panel-border` but
  // not `field-border`, so before this ruling the dropzone's rest and hover moved
  // there TOGETHER (`panel-border` and `faint`) and now only the hover does. The
  // box is not drawn on such a surface today; if it ever is, this pairing has to
  // be re-derived rather than assumed, and this assertion is what makes the
  // asymmetry visible instead of latent.
  it('leaves the rank alone under `[data-dark-surface]`, where the hover does move', () => {
    const scoped = ruleBody(CSS, '[data-dark-surface]');
    expect(
      scoped,
      'the rank gained a dark-surface value — the ruling needs re-deriving',
    ).not.toMatch(/--color-field-border:/);
    expect(scoped, '`muted` stopped being re-valued there').toMatch(/--color-muted:/);
  });
});

describe('hover leaves the rest behind, and drag-over leaves hover behind', () => {
  // THE DEFECT THIS REPLACES, stated as an ordering rather than a figure. Before
  // #88 the hover was `faint`, which from a `field-border` rest lies on the
  // WRONG SIDE of the edge — 1.75 lighter in light, 1.19 in dark — so the box
  // went quieter under the pointer. `field-border.dc.html` T4-3 refused `muted`
  // on the fields over exactly that shape.
  //
  // An ordering and not three pinned numbers because the property worth holding
  // is that the three states stay TOLD APART. A figure would go stale at the
  // next re-value and say nothing about the state machine.
  for (const theme of THEMES) {
    it(`${theme}: the three states are strictly ordered inward, each on its own fill`, () => {
      const rungs = RUNGS.map(([edge, fill]) => ratio(resolve(theme, edge), resolve(theme, fill)));
      for (let i = 1; i < rungs.length; i++) {
        expect(
          rungs[i],
          `${RUNGS[i][0]} (${rungs[i].toFixed(2)}) must beat ${RUNGS[i - 1][0]} (${rungs[i - 1].toFixed(2)})`,
        ).toBeGreaterThan(rungs[i - 1]);
      }
    });

    // OUTWARD is fill-independent — every state is drawn over the same `card` —
    // so the edges alone have to keep the order there.
    it(`${theme}: the three states are strictly ordered outward on the card`, () => {
      const card = resolve(theme, PLANES.outward);
      const rungs = RUNGS.map(([edge]) => ratio(resolve(theme, edge), card));
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
        luminance(resolve(theme, 'field-border')) < luminance(resolve(theme, restFill));
      for (const [edge, fill] of RUNGS) {
        expect(
          luminance(resolve(theme, edge)) < luminance(resolve(theme, fill)),
          `\`${edge}\` crosses its fill — the state would invert instead of deepening`,
        ).toBe(darker);
      }
    });
  }
});

/* ────────────────────────── the markup half ────────────────────────── */

// REDESIGNED AFTER THE REVIEW CAP, AND THE SHAPE IS THE POINT. Three rounds all
// broke the same joint: every earlier version tried to LOCATE the drop target in
// the source — by line, by the first template that mentions `dragOver`, by the
// template that also carries the radius — and each anchor was a guess about how
// the JSX would be written. Round three's was circular besides: it selected the
// box BY `rounded-2xl` and then asserted `rounded-2xl` was there. There are more
// ways to write the markup than a guard can enumerate, so this one stops trying.
//
// What it keeps is the one structure keyed on BEHAVIOUR rather than on styling:
// the `dragOver ? … : …` conditional, which exists because the component has two
// states and not because of how either is painted. Positives are read off its
// two arms. NEGATIVES ARE READ OVER THE WHOLE FILE, which is where they belong
// — round one narrowed them to the rest arm and round three found the hole that
// opened, because `hover:border-faint` written into the static half applies at
// rest and passed. `ImportRow.tsx` draws one bordered box, so a whole-file
// negative has nothing to collide with; if it ever grows a second, the collision
// is a real question about this ruling and should stop the suite.
//
// NOTHING HERE RUNS AT COLLECTION TIME. A parse that throws while the module is
// evaluated takes the file to "no tests" — with `pnpm test` red, but with the
// twelve pinned ratios above never run, and the failure naming the markup rather
// than the palette. Each test does its own reading.
//
// GEOMETRY IS NOT THIS GUARD'S SUBJECT and the radius is deliberately unpinned.
// This ruling moves two colours; the box's 16 is `navigation-map.md`'s and
// `data-portability.dc.html`'s. An earlier draft asserted `rounded-2xl` while
// also USING it to find the box, so it could never fail for the reason its
// message gave — and respelling it as the identical `rounded-[16px]` took the
// whole file inert. Solidity IS pinned below, because "never dashed" is a claim
// about the boundary this ruling owns.
describe('the markup points at the rank', () => {
  const source = () => strip(read('screens/settings/ImportRow.tsx'));

  /** The two arms of the state conditional, as the ternary writes them. Both
   *  live on ONE line, so a line filter selects the same string for each and
   *  cannot tell them apart — transposing them would ship the rest at `ink`. */
  const arms = (src: string) => {
    const m = src.match(/dragOver\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
    expect(m, 'the `dragOver ? … : …` arms are no longer two string literals').not.toBeNull();
    return { drag: m![1].split(/\s+/), rest: m![2].split(/\s+/) };
  };

  // EXACT MEMBERSHIP, never a regex: `\bbg-panel\b` also matches inside
  // `bg-panel-border` and `\bborder-ink\b` inside `border-ink-hover`.
  it('the rest arm wears the rank, hovers to `muted`, and keeps the `panel` fill', () => {
    const { rest } = arms(source());
    expect(rest, 'the rest edge left the control-boundary rank').toContain('border-field-border');
    expect(rest, 'the hover left `muted`').toContain('hover:border-muted');
    expect(rest, 'the rest fill moved off `panel`, which every inward figure assumes').toContain(
      'bg-panel',
    );
  });

  // ASSERTING THE RANK IS ABSENT HERE is what fails on a transposition, and it
  // is why `ink` was left to this state alone: two states sharing a border are
  // one state.
  it('keeps the drag-over arm on `ink` over a `hairline` fill', () => {
    const { drag } = arms(source());
    expect(drag).toContain('border-ink');
    expect(drag, 'the drag fill moved off `hairline`, which its inward figure assumes').toContain(
      'bg-hairline',
    );
    expect(drag, 'the arms are transposed — the rest edge is now the drag cue').not.toContain(
      'border-field-border',
    );
  });

  // WHOLE FILE, AND BY SUFFIX so a variant prefix cannot slip past: the box
  // already carries `max-sm:p-4`, so `max-sm:border-dashed` is a live spelling
  // and exact-string membership would have accepted it.
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

  // THE FILLS ARE PINNED AS THE ONLY ONES. Every inward figure is read against
  // the fill its own state paints, so a `hover:bg-*` would leave the four
  // recorded hover readings describing a plane the hovered box no longer shows —
  // the same defect the drag arm's `hairline` fill already caused once.
  it('gives the box no fill beyond the two its states declare', () => {
    const fills = source()
      .match(/[\w:[\]/.%-]+/g)!
      .filter((t) => /(^|:)bg-/.test(t));
    expect(new Set(fills), 'a third fill arrived — the recorded readings assume two').toEqual(
      new Set(['bg-panel', 'bg-hairline']),
    );
  });

  // A TRIPWIRE, NOT A PROOF, and named as one. The outward figures were
  // established in the browser against the rendered `card`; this cannot see an
  // interposed wrapper, or a `<Card>` opened in another component, so it catches
  // the row being rehoused wholesale and nothing subtler.
  it('still renders the row inside a `Card` — a tripwire on the outward plane', () => {
    const settings = strip(read('screens/Settings.tsx'));
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
    expect(strip(read('components/ui/Card.tsx')), '`Card` no longer paints `bg-card`').toMatch(
      /\bbg-card\b/,
    );
  });
});
