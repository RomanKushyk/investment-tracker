import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A RECORDED WITHHOLDING HAS TO BE READABLE BACK, and until #138 it was not:
// #136 wrote the field, stored it on the row and derived `taxesPaidByAsset`,
// `payoutsNetByAsset` and `incomeReceivedNet` from it, while no screen rendered
// it as itself. The bound check `tax_withheld < amount` catches a decimal
// slipped UP and deliberately not one slipped DOWN — 6,544 for 65,44 is a
// plausible figure no constraint can refuse — so a wrong one silently
// understated the tax, overstated the net and lifted that asset's XIRR with
// nothing on screen to check against a statement.
//
// This pins the two read surfaces the drawing gives it. A source test for the
// reason `transaction-form-reset.test.ts` states: the suite is
// `environment: 'node'` with no jsdom and no testing-library, so there is no
// way to mount either screen here. The browser verified the behaviour; this
// keeps the shape.
const here = dirname(fileURLToPath(import.meta.url));
/** COMMENTS STRIPPED BEFORE MATCHING — the lesson `transactions-layout.test.ts`
 *  and `ledger-delete.test.ts` both record: rationale prose naming a class must
 *  not be able to pass or fail a test.
 *
 *  QUOTE-EXACT AND LINE BY LINE, which is the half a regex cannot do: dropping
 *  only whole-line `//` comments leaves the trailing ones, and one apostrophe in
 *  the prose then desynchronises every quote pair after it. Copied from
 *  `floating-edges.test.ts` SIGNATURE AND ALL rather than imported — the house
 *  idiom is that a guard stands alone.
 *
 *  INJECTION-VERIFIED: a trailing `// tx.taxWithheld ||` in the panel
 *  leaves this green and turns the reader it replaces red.
 */
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
const PANEL = stripTs(readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8'));
const PAYOUTS = stripTs(readFileSync(join(here, 'Payouts.tsx'), 'utf8'));

describe('the withholding on the ledger row', () => {
  it('draws a line when there is one, and NOTHING when there is none', () => {
    // Absence is the normal state — seven of the eight seeded payouts, and the
    // bond half of this portfolio permanently, ОВДП coupons being exempt. So no
    // empty line, no dash, no zero, exactly as the note already refuses them.
    // `!== undefined` rather than truthiness, matching the note beneath it and
    // the store's own shape: a withholding is `> 0` at all four doors (the form
    // schema, the backup envelope, `transaction_tax_sign_ck` and the type), so
    // absence is the only other state and a truthiness test would merely be a
    // second spelling of the same check with a worse failure mode.
    expect(PANEL).toMatch(/\{!asking && tx\.taxWithheld !== undefined && \(/);
    expect(PANEL).not.toMatch(/tx\.taxWithheld \?\?[^)]/);
    expect(PANEL).not.toMatch(/tx\.taxWithheld \|\|/);
  });

  it('signs the withholding through the app’s one signing helper', () => {
    // `signed()` pins U+2212 in exactly one place (D8). The line reads as a
    // deduction from the amount above it, so the glyph is load-bearing — and
    // typing an ASCII hyphen into the message would put a second convention in
    // the app with nothing to catch it.
    expect(PANEL).toMatch(/f\.signedMoney\(-tx\.taxWithheld\)/);
  });

  it('puts the line ABOVE the note, on its own full-width row', () => {
    // THE CAP AND THIS LINE ARE ONE DECISION. The note's 100 characters is a
    // DRAWN number that `transaction_note_ck` enforces in SQL, derived from a
    // hundred characters wrapping to three lines at the row's 280 px. A line
    // that SHARED the note's would narrow it and re-derive that number; a
    // full-width line above it does not — measured, the note still wraps to
    // three at 360 and two at 1280.
    const withholding = PANEL.indexOf('tx.taxWithheld !== undefined');
    const note = PANEL.indexOf('tx.note !== undefined');
    expect(withholding).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(-1);
    expect(withholding).toBeLessThan(note);
  });

  it('never truncates, and is not given the note’s wrapping', () => {
    // ANCHORED ON THE ELEMENT THAT RENDERS IT, not on the class string it
    // happens to carry — the lesson this branch just applied next door in
    // `ledger-delete.test.ts`. Matching the literal class list and then asking
    // whether that literal contains `truncate` proves nothing: the capture has
    // to come off the document.
    //
    // It takes `truncate` from nowhere — a figure the row hides is the defect
    // this issue exists to close — and it does not take the note's
    // `overflow-wrap:anywhere` either, having no long unbroken token to break.
    const line = PANEL.match(/className="([^"]*)"[^>]*>\s*\{t\.transaction\.withheldAndNet\(/);
    expect(line).not.toBeNull();
    expect(line![1]).toContain('text-[11px]');
    expect(line![1]).toContain('leading-4');
    expect(line![1]).toContain('text-muted');
    expect(line![1]).not.toContain('overflow-wrap');
    expect(line![1]).not.toContain('truncate');
  });
});

describe('the withholding on the payout log', () => {
  it('carries the withheld and the net as their own columns', () => {
    expect(PAYOUTS).toMatch(/t\.analytics\.withheldUah/);
    expect(PAYOUTS).toMatch(/t\.analytics\.netOfTaxUah/);
    expect(PAYOUTS).toMatch(/row\.taxWithheld/);
    expect(PAYOUTS).toMatch(/row\.net/);
  });

  it('leaves both cells empty on a row that carries none', () => {
    // BOTH, the net included. Such a row's net IS the Сума column, so printing
    // it would repeat one figure on seven of the eight seeded rows and teach the
    // reader that the column adds nothing.
    // EACH CELL IS GATED SEPARATELY, and the count is exact rather than a
    // floor: at `>= 2` the net cell's own gate could be deleted and the column
    // would print on all seven untaxed rows with this test still green — the
    // precise behaviour it is named for. Three gates: two table cells and the
    // card's pair.
    const gates = PAYOUTS.match(/row\.taxWithheld !== undefined/g) ?? [];
    expect(gates).toHaveLength(3);
    // The net cell is gated on the WITHHOLDING's presence, not on its own
    // value — `net` is always a number, so testing it would never be false.
    expect(PAYOUTS).toMatch(/row\.taxWithheld !== undefined \? f\.num\(row\.net\) : ''/);
    expect(PAYOUTS).not.toMatch(/row\.taxWithheld \?\?/);
    expect(PAYOUTS).not.toMatch(/row\.net \?\?/);
  });

  it('widens the table to the seven columns’ own width', () => {
    // Measured: seven columns need 717,86 of max-content against a bound
    // written for five. At 768 the table already scrolls at five columns, so
    // leaving 560 would cramp the two new ones rather than letting the
    // horizontal Scroller do the job it is there for.
    expect(PAYOUTS).toMatch(/min-w-\[720px\]/);
    expect(PAYOUTS).not.toMatch(/min-w-\[560px\]/);
  });

  it('gives the 360 card the table’s own headers, verbatim', () => {
    // `RecordCard` requires it in as many words: every column header becomes a
    // `dt` VERBATIM, because the two forms are one screen seen at two widths and
    // a reader who learns a column name on a laptop must find it again on a
    // phone. So the Facts read the same two keys the `th`s do.
    const facts = PAYOUTS.match(/<Fact label=\{t\.analytics\.\w+\}/g) ?? [];
    expect(facts).toContain('<Fact label={t.analytics.withheldUah}');
    expect(facts).toContain('<Fact label={t.analytics.netOfTaxUah}');
  });
});
