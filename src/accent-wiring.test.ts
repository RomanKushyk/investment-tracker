import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE ACCENT'S CONSUMERS, WHICH ARE THE HALF A CONTRAST TEST CANNOT SEE.
// `palette-mirror.test.ts` proves the family holds its values; nothing there notices if the
// primary button goes back to `bg-ink` or the capital line back to gain green, since the
// tokens would still be declared and still clear their bars.
//
// NO COLOUR MATHS HERE, DELIBERATELY: `luminance`/`ratio`/`resolve` are already copied
// across five guards, and every assertion below is about which token a file NAMES rather
// than what the value reads — so this one carries no reader and adds no sixth copy.
//
// SOURCE TEXT, the house idiom: vitest runs `environment: 'node'` with no render library.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** QUOTE-EXACT and line by line. The comments these files carry NAME every token asserted
 *  below, so an unstripped match is satisfied by prose about a token instead of the token.
 *  A reader that drops only whole-line `//` comments leaves the trailing ones, and
 *  `CouponDueCard.tsx` carries one whose apostrophe then desynchronises every quote pair
 *  after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// pos:` on a line inside `colors.ts`'s CHART map leaves this
 *  green and turns the reader it replaces red. */
function stripTs(source: string): string {
  const out: string[] = [];
  let inBlock = false;
  for (const raw of source.split('\n')) {
    let line = '';
    let quote = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (inBlock) {
        if (c === '*' && raw[i + 1] === '/') {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (quote) {
        line += c;
        if (c === '\\') line += raw[++i] ?? '';
        else if (c === quote) quote = '';
      } else if (c === '"' || c === "'" || c === '`') {
        quote = c;
        line += c;
      } else if (c === '/' && raw[i + 1] === '*') {
        inBlock = true;
        i++;
      } else if (c === '/' && raw[i + 1] === '/') {
        break;
      } else {
        line += c;
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

describe('the primary button is the accent', () => {
  const variants = stripTs(read('components/ui/button-variants.ts'));

  /** An anchor rather than a whole-file match: `bg-accent` anywhere in this file would
   *  satisfy a bare search, including on the `outline` arm, which must not have it.
   *
   *  RESOLVED INSIDE EACH `it`, NEVER IN THE DESCRIBE BODY. An `expect()` that runs while
   *  vitest COLLECTS the file throws before any test registers, so a renamed anchor would
   *  take every other guard here down with it instead of failing one assertion. */
  const primary = () => {
    const m = variants.match(/\bprimary:\s*'([^']*)'/);
    expect(
      m,
      "the `primary` variant is no longer a single-quoted class string — this file's anchor is gone",
    ).not.toBeNull();
    return m![1];
  };

  it.each([
    ['the fill', 'bg-accent'],
    ['the label', 'text-accent-fg'],
    ['the hover step', 'hover:bg-accent-hover'],
    ['the pressed step', 'active:bg-accent-pressed'],
  ])('takes %s from the accent family (`%s`)', (_label, utility) => {
    expect(primary().split(/\s+/)).toContain(utility);
  });

  it('is off `ink`, which stays in this file for the tracks and the outline edge', () => {
    // TOKEN-EXACT: a `\b` is satisfied by a hyphen, so `/\bbg-ink\b/` also matches inside
    // `hover:bg-ink-hover`, and two regexes that read as independent floors were one.
    const utilities = primary().split(/\s+/);
    expect(utilities).not.toContain('bg-ink');
    expect(utilities).not.toContain('hover:bg-ink-hover');
  });
});

describe("the coupon card does not spend the screen's one accent fill", () => {
  // `/` IS THE SCREEN THAT HAD TWO: its main CTA and the coupon-due card carried the same
  // filled variant, and both are at rest whenever a bond's next coupon date has passed — so
  // one main CTA per screen was broken BY THE CLOCK rather than by a click.
  //
  // A SOURCE GUARD BECAUSE THE BROWSER CHECK IS NOT A GATE: the card only renders on some
  // dates, so a later reading might not reproduce it.
  //
  // THIS PINS ONE CONTROL, NOT THE INVARIANT. While `primary` stays the Button's default
  // variant a bare `<Button>` can spend a screen's fill without naming it — #115 has both
  // halves.
  const card = stripTs(read('screens/daily-quotes/CouponDueCard.tsx'));

  it('leaves the coupon card the outline, not the fill', () => {
    const confirm = card.match(/<Button[^>]*onClick=\{handleConfirm\}[^>]*>/);
    expect(
      confirm,
      'the coupon card no longer has a confirm Button — the anchor is gone',
    ).not.toBeNull();
    expect(confirm![0]).toContain('variant="outline"');
  });

  it('keeps its way out a ghost, so the pair still reads as trigger and escape', () => {
    // An outline beside an outline is a different control: if the skip takes an edge too, the
    // card has two equal buttons and the demotion cost the confirm its emphasis.
    const skip = card.match(/<Button[^>]*onClick=\{onSkip\}[^>]*>/);
    expect(skip, 'the coupon card no longer has a skip Button').not.toBeNull();
    expect(skip![0]).toContain('variant="ghost"');
  });
});

describe('the capital area chart is the accent', () => {
  const colors = stripTs(read('core/colors.ts'));
  const area = stripTs(read('components/charts/BalancesArea.tsx'));

  /** Scoped, because `colors.ts` also holds `SERIES` and the tooltip objects: a whole-file
   *  `not.toMatch(/pos:/)` fails on a `pos:` key added to any of those. */
  const chartMap = () => {
    const at = colors.indexOf('export const CHART = {');
    expect(at, 'the `CHART` object is no longer declared as it was').toBeGreaterThan(-1);
    return colors.slice(at, colors.indexOf('};', at));
  };

  it('gives `CHART` an accent pair and takes the gain pair away', () => {
    // Gain and loss belong to DELTAS (*Interaction rules*): total capital over time has no
    // direction to report, so the line was a green saying "up" about the axis.
    const map = chartMap();
    expect(map).toMatch(/\baccent:\s*'var\(--color-chart-accent\)'/);
    expect(map).toMatch(/\baccentTint:\s*'var\(--color-chart-accent-tint\)'/);
    expect(map).not.toMatch(/\bpos:/);
    expect(map).not.toMatch(/\bposTint:/);
  });

  it('paints the line, both dots and the fill from that pair', () => {
    // FOUR READS, COUNTED rather than merely present: three are the same token, so a bare
    // `toContain` passes with two of the three reverted.
    expect(area.match(/CHART\.accent\b/g) ?? []).toHaveLength(3);
    expect(area.match(/CHART\.accentTint\b/g) ?? []).toHaveLength(1);
    expect(area).not.toMatch(/CHART\.pos/);
  });

  it('keeps the seeded white ring off the hover dot', () => {
    expect(
      area,
      "`activeDot` IS SPREAD AFTER recharts' own white ring, so passing `r` and `fill` alone " +
        'leaves a literal white ring on a card that follows the theme',
    ).toMatch(/activeDot=\{\{[^}]*strokeWidth:\s*0/);
  });

  it('lets the tint be the only alpha the fill has', () => {
    // `accent-tint` IS ALREADY AN RGBA, where the tint it replaced was an opaque hex whose
    // only alpha was this attribute — left as it was, the two multiply and the area reads as
    // no fill at all.
    expect(area).toMatch(/fillOpacity=\{1\}/);
  });

  // The two `chart-` aliases are asserted in `palette-mirror.test.ts`, which owns the CSS
  // stripper this file does not: `index.css` argues from its own token text on nearly every
  // line, so an unstripped `toContain` there is satisfied by a comment.
});
