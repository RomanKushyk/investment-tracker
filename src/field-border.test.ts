import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE FIELD EDGE, PINNED AT THE BAR THE DESIGN SESSION SET.
//
// `design/extensions/field-border.dc.html` mints `--color-field-border` and
// re-values `--color-pos-border` so no field boundary reads below 3 : 1 (WCAG
// 1.4.11) on any of the three surfaces a field is drawn on. Before it, the
// shipped `hairline` read 1.03 : 1 on `panel` in LIGHT — the lowest reading in
// the survey — and 1.10 in dark.
//
// Two halves need pinning and neither catches the other. THE CSS HALF is
// arithmetic on the tokens: a "tidy the palette" edit can move a hex by two
// digits and put a boundary back under the bar with every test green, because
// nothing else in this repo reads a stylesheet. THE MARKUP HALF is which
// recipes point at the token — eleven are written out separately, there is no
// shared input component (#84), so a twelfth added by copying a tenth lands on
// whatever the tenth used.
//
// THREE SHAPES WERE TRIED FOR THE MARKUP HALF AND TWO FAILED, which is why it
// looks like this:
//
//   A proximity window around `rounded-[9px]` — `Select` computes its edge into
//   `borderClass` 1001 characters above the recipe that uses it, so a ±320
//   window passed it while it was still on `hairline`.
//
//   A blocklist over a hard-coded file list — it matched only a quote-delimited
//   `'border-hairline'`, never the `'border-hairline hover:…'` seven of the
//   eleven actually used, and a field in a file NOT on the list was invisible to
//   every assertion here.
//
// What is here instead: walk the tree, and ask questions that compose. Each is
// verified by injection rather than by argument.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');
/** COMMENTS OUT BEFORE ANY TOKEN IS READ. `token()` below takes the first match
 *  in a block, and this stylesheet's comments quote declarations constantly —
 *  including retired values it tells you not to re-mint — so a comment could
 *  satisfy an assertion the CSS fails, or fail one it passes. Quote-aware, not
 *  `strip` above: `index.css` line 5 holds `/*` inside a string, and the naive
 *  regex swallows from there to the first real terminator, taking `@theme` with
 *  it. `popover-edge.test.ts` carries the same reader for the same reason. */
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

/** sRGB → relative luminance, WCAG 2.x. There is no colour helper to reuse:
 *  `core/` is pure money maths and owns no colour. */
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
 *  are bounded: an unbounded slice let "declared in both blocks" pass on a
 *  token declared in a later, unrelated rule. */
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

/** Computed once — the brace walk is the most expensive thing in this file. */
const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
  darkSurface: ruleBody(CSS, '[data-dark-surface]'),
};

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `--color-${name} is not declared in this block`).not.toBeNull();
  return m![1].toLowerCase();
}

const SURFACES = ['page', 'card', 'panel'] as const;
const THEMES = ['light', 'dark'] as const;

describe('the field edge clears 3 : 1 on every surface, in both themes', () => {
  // `panel` binds: on /transactions six fields sit on `card` inside a `panel`,
  // so the stroke is read against #eceae7 and not the card behind it.
  for (const theme of THEMES) {
    for (const edge of ['field-border', 'pos-border'] as const) {
      it(`${theme} \`${edge}\` is at or above 3 : 1 on page, card and panel`, () => {
        const block = BLOCKS[theme];
        const value = token(block, edge);
        for (const surface of SURFACES) {
          expect(
            ratio(value, token(block, surface)),
            `${edge} on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  // The inversion guard. Repairing the idle edge and leaving the saved one at
  // 1.53 would make a row appear to LOSE its boundary at the moment its value
  // is accepted — the defect the design session exists to prevent.
  for (const theme of THEMES) {
    it(`${theme} saved edge is at least as strong as idle, and within 1.10x`, () => {
      const block = BLOCKS[theme];
      const idle = token(block, 'field-border');
      const saved = token(block, 'pos-border');
      for (const surface of SURFACES) {
        const s = token(block, surface);
        const [ri, rs] = [ratio(idle, s), ratio(saved, s)];
        expect(rs, `saved vs idle on ${surface}`).toBeGreaterThanOrEqual(ri);
        expect(rs / ri, `saved/idle band on ${surface}`).toBeLessThanOrEqual(1.1);
      }
    });
  }

  it('declares `field-border` in `@theme` AND in the dark block', () => {
    expect(BLOCKS.light).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
    expect(BLOCKS.dark).toMatch(/--color-field-border:\s*#[0-9a-fA-F]{6}/);
  });

  // `faint` is a TEXT and INDICATOR rank, not a control boundary. Moving it was
  // tried and rejected: it reverses `Scroller.tsx`'s deliberate sub-3 : 1
  // resting thumb, and blanks the drawer's dragged thumb, because
  // `[data-dark-surface]` overrides `faint` but not `ink`.
  it('leaves `faint` where it was, in all three places it is declared', () => {
    expect(token(BLOCKS.light, 'faint')).toBe('#b3b2ae');
    expect(token(BLOCKS.dark, 'faint')).toBe('#6e6d6a');
    expect(token(BLOCKS.darkSurface, 'faint')).toBe('#6e6d6a');
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** A field is `rounded-[9px]` AND `h-9`. The radius alone is not enough — a
 *  sidebar nav pill and a `Select` option row wear it too, which a first cut of
 *  this file learned by failing on them. The pair matches exactly eleven lines. */
const FIELD_LINE = (line: string) => /rounded-\[9px\]/.test(line) && /\bh-9\b/.test(line);

/** The edges a field may wear — every one a state the design sheet rules on.
 *  `ink` is absent deliberately: it is the HOVER destination, never a rest. */
const FIELD_EDGE = /\bborder-(field-border|neg|pos-border|warn)\b/;

/** The palette's other border colours. One of these in a field's colour arm is
 *  the defect this file exists to catch, so a token that can be spelled
 *  `border-*` and is not a field state belongs here — a field on `toast-edge`
 *  reads 1.19 : 1 on `card` in light and would otherwise be invisible to this
 *  file AND to `popover-edge.test.ts`, whose lines carry no popover shadow.
 *  Hand-kept because the palette gives no way to tell a border rank from a text
 *  one by name; the order is the four greys, then the control edge that is not
 *  a field's (`switch-border`, #87), then the four floating-surface edges, so
 *  the next one added has an obvious place to go. */
const OTHER_EDGE =
  /\bborder-(hairline|faint|panel-border|muted|switch-border|surface-edge|popover-edge|toast-edge|drawer-edge)\b/;

/** A COLOUR ARM: a quoted string of only border/hover utilities — the arm of an
 *  `invalid ? … : …`. A full `className` carrying layout utilities is not one,
 *  which is how the dashed CONTAINERS, legitimately still `faint`, stay out of
 *  scope. The `Switch`'s arms are out for a different reason, and the
 *  difference matters: its arm IS a bare colour arm, but `Switch.tsx` carries
 *  no `rounded-[9px] h-9` line, so it never enters `FIELD_FILES` and nothing
 *  here reads it. Measured: twenty strings across the nine field files, and
 *  every one is a field state. */
const colourArms = (src: string) =>
  (src.match(/'[^']*'/g) ?? [])
    .map((s) => s.slice(1, -1))
    .filter((s) => /^(border-|hover:border-)/.test(s))
    .filter((s) => !/rounded|flex|grid|\bh-\d|\bw-\d|px-|py-/.test(s));

const FIELD_FILES = sourceFiles(here)
  .map((f) => relative(here, f).split(sep).join('/'))
  .filter((f) => strip(read(f)).split('\n').some(FIELD_LINE));

const ALL_FIELD_SOURCE = FIELD_FILES.map((f) => strip(read(f))).join('\n');

describe('every field points at the token', () => {
  it('finds the field files by walking, not from a list', () => {
    // The floor: a signature that stops matching must fail loudly rather than
    // turn this whole describe into an empty pass.
    expect(FIELD_FILES.length, 'no file carries the field radius any more').toBeGreaterThanOrEqual(
      9,
    );
  });

  // INJECTION-VERIFIED: a new `src/screens/Goals.tsx` with one field on
  // `hairline` fails here. The previous hard-coded file list could not see it.
  it.each(FIELD_FILES)('%s carries the token', (file) => {
    expect(strip(read(file)), `${file} has a field but never names the token`).toMatch(
      /\bborder-field-border\b/,
    );
  });

  // INJECTION-VERIFIED with `border-panel-border` as well as `border-hairline`.
  // The previous cut only inspected lines that already said `hairline` or
  // `faint`, so a field on a third token walked straight through; and it read
  // whole lines, so a card or a segmented track tripped it.
  it.each(FIELD_FILES)('%s names no non-field edge in a colour arm', (file) => {
    for (const arm of colourArms(strip(read(file)))) {
      expect(arm, `${file}: a field colour arm names a non-field edge`).not.toMatch(OTHER_EDGE);
    }
  });

  // The no-colour case: a field with no edge class inherits preflight's
  // `currentColor`. A line may defer to an interpolated variable instead —
  // `Select` does, which is what defeated the proximity approach.
  it.each(FIELD_FILES)('%s names an edge on every field line', (file) => {
    for (const line of strip(read(file)).split('\n')) {
      if (!FIELD_LINE(line)) continue;
      expect(
        FIELD_EDGE.test(line) || /\$\{/.test(line) || line.trimEnd().endsWith('+'),
        `${file}: a field names no edge and defers to nothing — it would inherit currentColor`,
      ).toBe(true);
    }
  });

  // A FLOOR, not an equality — the rule `filled-track.test.ts` states in the
  // same words: "Only a vanished one fails here." An exact count would make a
  // correctly-styled twelfth field a suite failure whose only fix is editing a
  // number, which is the rot `index.css`'s own palette-count comment records.
  it('keeps at least the thirteen sites the design session named', () => {
    expect(
      (ALL_FIELD_SOURCE.match(/\bborder-field-border\b/g) ?? []).length,
    ).toBeGreaterThanOrEqual(13);
  });
});

describe('hover leaves the resting edge behind', () => {
  // From the repaired idle edge, `muted` measures 1.45 in light — below the
  // weakest hover shipping today (1.55, the dropzone). `ink` measures 3.93,
  // GENTLER than the 12.19 the three `ink` sites stepped from a `hairline` idle.
  it.each(FIELD_FILES)('%s hovers to neither `faint` nor `muted`', (file) => {
    const src = strip(read(file));
    expect(src, `${file} still hovers to faint`).not.toMatch(/hover:border-faint/);
    expect(src, `${file} still hovers to muted`).not.toMatch(/hover:border-muted/);
  });

  it('the dropzone keeps its `faint` hover — its rest is `panel-border`, not a field', () => {
    expect(strip(read('screens/settings/ImportRow.tsx'))).toMatch(/hover:border-faint/);
  });

  // NAMED RATHER THAN PINNED SILENTLY: thirteen edge sites, twelve hovers. The
  // odd one out is `QuoteRow`'s plain empty arm, which has no hover today and
  // gains none — the sheet rules that adding one is behaviour, not colour. So an
  // empty bond row with a suggestion lights under the pointer and the empty REIT
  // row beside it does not. Deliberate, and worth being able to see here.
  it('has one more edge site than hover, and that one is QuoteRow', () => {
    const edges = (ALL_FIELD_SOURCE.match(/\bborder-field-border\b/g) ?? []).length;
    const hovers = (ALL_FIELD_SOURCE.match(/hover:border-ink\b/g) ?? []).length;
    expect(edges - hovers).toBe(1);
    expect(strip(read('screens/daily-quotes/QuoteRow.tsx'))).toMatch(/: 'border-field-border'\)/);
  });
});

describe('what the ruling deliberately does not touch', () => {
  it('the three dashed CONTAINERS keep `faint`', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
      'screens/TransactionPanel.tsx',
    ]) {
      expect(strip(read(file)), `${file} lost its dashed container edge`).toMatch(
        /border-dashed border-faint/,
      );
    }
  });

  // `Select`'s two arms resolve to one token, so the prop was one behaviour with
  // two spellings. `isNewAsset` is NOT collateral: it gates the quick-create
  // sub-form and `transaction-form-reset.test.ts` pins its declaration.
  it('drops the `borderColor` variant but keeps `isNewAsset`', () => {
    expect(strip(read('components/ui/Select.tsx'))).not.toMatch(/borderColor/);
    expect(strip(read('screens/TransactionPanel.tsx'))).not.toMatch(/borderColor=/);
    expect(read('screens/TransactionPanel.tsx')).toMatch(
      /const isNewAsset = needsAsset && pickedNew;/,
    );
  });

  // Stated as "do not re-token them", not "keep this exact class": their border
  // paints no pixel — no width utility, and a native control the UA draws — so
  // deleting the dead class later is a correct cleanup this must not fail.
  it('leaves the checkboxes off the field token', () => {
    for (const file of [
      'screens/daily-quotes/CouponDueCard.tsx',
      'screens/settings/ImportDialog.tsx',
    ]) {
      const checkbox = strip(read(file))
        .split('\n')
        .filter((l) => /rounded-\[5px\]/.test(l));
      expect(checkbox.length, `${file}: the checkbox line vanished`).toBeGreaterThan(0);
      for (const line of checkbox) expect(line).not.toMatch(/border-field-border/);
    }
  });
});
