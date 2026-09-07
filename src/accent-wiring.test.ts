import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE ACCENT'S CONSUMERS, WHICH ARE THE HALF A CONTRAST TEST CANNOT SEE.
//
// `palette-mirror.test.ts` proves the accent family holds its values and that
// the focus ring reads them. Nothing there notices if the primary button goes
// back to `bg-ink` or the capital line back to gain green — the tokens would
// still be declared, still clear their bars, and still be consumed by the
// sidebar alone, which is the state #91 shipped and #95 exists to leave.
//
// NO COLOUR MATHS HERE, deliberately. `luminance`/`ratio`/`resolve` are already
// copied across five guards — #102's whole subject — and every assertion below
// is about which token a file NAMES, not what the value reads. So this file
// carries no reader and adds no sixth copy.
//
// SOURCE TEXT, the house idiom: vitest runs `environment: 'node'` here with no
// render library, the same reason `filled-track.test.ts` and
// `price-mode-segment.test.ts` read files.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** Line comments out. The comments these files carry name every token asserted
 *  below — the primary variant's argues its fill by name, and `index.css` keeps
 *  the accent's record beside it — so an unstripped match would be satisfied by
 *  prose about a token instead of the token. `filled-track.test.ts:50` is the
 *  same guard against the same trap. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

describe('the primary button is the accent', () => {
  const variants = strip(read('components/ui/button-variants.ts'));

  /** The `primary:` arm's class string, and an anchor rather than a whole-file
   *  match: `bg-accent` appearing ANYWHERE in this file would satisfy a bare
   *  search — including on the `outline` arm, which must not have it.
   *
   *  RESOLVED INSIDE EACH `it`, never in the describe body. An `expect()` that
   *  runs while vitest COLLECTS the file throws before any test registers, so a
   *  renamed anchor would take the chart guards and the coupon-card guards down
   *  with it instead of failing one assertion. */
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
    // TOKEN-EXACT, like the positive assertions above. A `\b` is satisfied by a
    // hyphen, so `/\bbg-ink\b/` also matches inside `hover:bg-ink-hover` — the
    // two regexes this replaces read as independent floors and were one.
    const utilities = primary().split(/\s+/);
    expect(utilities).not.toContain('bg-ink');
    expect(utilities).not.toContain('hover:bg-ink-hover');
  });
});

describe("the coupon card does not spend the screen's one accent fill", () => {
  // `/` IS THE SCREEN THAT HAD TWO. Its main CTA is "Save snapshot" — the daily
  // ritual the route exists for — and the coupon-due card in the side rail
  // carried the same filled variant. Both are at rest whenever a bond's next
  // coupon date has passed, which is a calendar fact and not a user action, so
  // the sheet's "один головний CTA на екран" was broken by the clock rather
  // than by a click. Measured at 1280 before the demotion: two `bg-accent`
  // controls inside `main`.
  //
  // A SOURCE GUARD BECAUSE THE BROWSER CHECK IS NOT A GATE. The count that
  // caught this was a one-off reading; nothing would fail if the variant came
  // back, and the card only renders on some dates, so a later reading might not
  // even reproduce it.
  //
  // THIS PINS ONE CONTROL, NOT THE INVARIANT. Counting fills per screen is what
  // would hold the rule everywhere, and while `primary` stays the Button's
  // default variant a bare `<Button>` can spend a screen's fill without naming
  // it — #115 carries both halves.
  const card = strip(read('screens/daily-quotes/CouponDueCard.tsx'));

  it('leaves the coupon card the outline, not the fill', () => {
    const confirm = card.match(/<Button[^>]*onClick=\{handleConfirm\}[^>]*>/);
    expect(
      confirm,
      'the coupon card no longer has a confirm Button — the anchor is gone',
    ).not.toBeNull();
    expect(confirm![0]).toContain('variant="outline"');
  });

  it('keeps its way out a ghost, so the pair still reads as trigger and escape', () => {
    // Named because an outline beside an outline is a different control: if the
    // skip ever takes an edge too, the card has two equal buttons and the
    // demotion above has cost the confirm its emphasis rather than moved it.
    const skip = card.match(/<Button[^>]*onClick=\{onSkip\}[^>]*>/);
    expect(skip, 'the coupon card no longer has a skip Button').not.toBeNull();
    expect(skip![0]).toContain('variant="ghost"');
  });
});

describe('the capital area chart is the accent', () => {
  const colors = strip(read('core/colors.ts'));
  const area = strip(read('components/charts/BalancesArea.tsx'));

  /** The `CHART` object's own body. Scoped, because `colors.ts` also holds
   *  `SERIES` and the tooltip objects: a whole-file `not.toMatch(/pos:/)` would
   *  fail on a `pos:` key added to any of those, for a reason with nothing to
   *  do with the chart pair. */
  const chartMap = () => {
    const at = colors.indexOf('export const CHART = {');
    expect(at, 'the `CHART` object is no longer declared as it was').toBeGreaterThan(-1);
    return colors.slice(at, colors.indexOf('};', at));
  };

  it('gives `CHART` an accent pair and takes the gain pair away', () => {
    // Gain and loss belong to DELTAS (*Interaction rules*). Total capital over
    // time has no direction to report, so the line was a green that said "up"
    // about the axis rather than the value.
    const map = chartMap();
    expect(map).toMatch(/\baccent:\s*'var\(--color-chart-accent\)'/);
    expect(map).toMatch(/\baccentTint:\s*'var\(--color-chart-accent-tint\)'/);
    expect(map).not.toMatch(/\bpos:/);
    expect(map).not.toMatch(/\bposTint:/);
  });

  it('paints the line, both dots and the fill from that pair', () => {
    // FOUR READS, counted rather than merely present: the stroke, the
    // last-point dot, the active dot and the area fill. Three of them are the
    // same token, so a bare `toContain` would pass with two of the three
    // reverted.
    expect(area.match(/CHART\.accent\b/g) ?? []).toHaveLength(3);
    expect(area.match(/CHART\.accentTint\b/g) ?? []).toHaveLength(1);
    expect(area).not.toMatch(/CHART\.pos/);
  });

  it('keeps the seeded white ring off the hover dot', () => {
    // `activeDot` is spread AFTER recharts' own `{ stroke: '#fff',
    // strokeWidth: 2 }`, so passing `r` and `fill` alone leaves a 2px literal
    // white ring on a card that follows the theme. The static dot has no ring;
    // this is what keeps the pair matching.
    expect(area).toMatch(/activeDot=\{\{[^}]*strokeWidth:\s*0/);
  });

  it('lets the tint be the only alpha the fill has', () => {
    // `accent-tint` IS an rgba — declared as the alpha because it lies over
    // more than one plane — where the gain tint it replaced was an opaque hex
    // whose only alpha was this attribute. Left at 0.7 the two multiply and the
    // area lands near 8 %, which reads as no fill at all.
    expect(area).toMatch(/fillOpacity=\{1\}/);
  });

  // The two `chart-` aliases the pair resolves through are asserted in
  // `palette-mirror.test.ts`, which owns the quote-aware CSS stripper this file
  // does not: `index.css` argues from its own token text on nearly every line,
  // so an unstripped `toContain` there is satisfied by a comment.
});
