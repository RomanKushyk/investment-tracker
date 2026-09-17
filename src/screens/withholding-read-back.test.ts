import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A RECORDED WITHHOLDING HAS TO BE READABLE BACK. The field is stored on the row and three
// derivations read it, while the bound check `tax_withheld < amount` catches a decimal
// slipped UP and DELIBERATELY NOT ONE SLIPPED DOWN — a figure ten times too small is
// plausible and no constraint can refuse it — so a wrong one silently understates the tax,
// overstates the net and lifts that asset's XIRR with nothing on screen to check against a
// statement.
//
// A source test: the suite is `environment: 'node'` with no jsdom, so there is no way to
// mount either screen here.
const here = dirname(fileURLToPath(import.meta.url));
/** COMMENTS STRIPPED BEFORE MATCHING: rationale prose naming a class must not be able to
 *  pass or fail a test. QUOTE-EXACT AND LINE BY LINE, because dropping only whole-line `//`
 *  comments leaves the trailing ones and one apostrophe in prose then desynchronises every
 *  quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// tx.taxWithheld ||` in the panel leaves this green and turns
 *  the reader it replaces red. */
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
    // ABSENCE IS THE NORMAL STATE — the bond half of this portfolio permanently, ОВДП coupons
    // being exempt — so no empty line, no dash, no zero. `!== undefined` rather than
    // truthiness: a withholding is `> 0` at all four doors, so absence is the only other
    // state and a truthiness test is a second spelling with a worse failure mode.
    expect(
      PANEL,
      'the row no longer gates the line on the withholding being present at all',
    ).toMatch(/\{!asking && tx\.taxWithheld !== undefined && \(/);
    expect(PANEL, 'a coalescing read prints a zero for the absent case').not.toMatch(
      /tx\.taxWithheld \?\?[^)]/,
    );
    expect(PANEL, 'a truthiness read prints a zero for the absent case').not.toMatch(
      /tx\.taxWithheld \|\|/,
    );
  });

  it('signs the withholding through the app’s one signing helper', () => {
    // `signed()` pins U+2212 in exactly ONE place (*Core is pure*). The line reads as a
    // deduction from the amount above it, so the glyph is load-bearing, and an ASCII hyphen
    // typed into the message would put a second convention in the app with nothing to catch it.
    expect(
      PANEL,
      'the line stopped reading as a deduction from the amount above it — `signed()` pins ' +
        'U+2212 in one place, and a hyphen typed into the message is a second convention ' +
        'with nothing to catch it',
    ).toMatch(/f\.signedMoney\(-tx\.taxWithheld\)/);
  });

  it('puts the line ABOVE the note, on its own full-width row', () => {
    // THE CAP AND THIS LINE ARE ONE DECISION: the note's character cap is a DRAWN number that
    // `transaction_note_ck` enforces in SQL, derived from how it wraps at the row's width. A
    // line SHARING the note's row would narrow it and re-derive that number; a full-width one
    // above it does not.
    const withholding = PANEL.indexOf('tx.taxWithheld !== undefined');
    const note = PANEL.indexOf('tx.note !== undefined');
    expect(withholding, 'the withholding line is gone').toBeGreaterThan(-1);
    expect(note, 'the note line is gone').toBeGreaterThan(-1);
    expect(
      withholding,
      'the withholding fell below the note, where it would share the row the note\u2019s ' +
        'character cap was derived from',
    ).toBeLessThan(note);
  });

  it('never truncates, and is not given the note’s wrapping', () => {
    // ANCHORED ON THE ELEMENT THAT RENDERS IT, never on the class string it happens to carry:
    // matching a literal class list and then asking whether that literal contains `truncate`
    // proves nothing, since the capture has to come off the document.
    //
    // It takes `truncate` from nowhere — a figure the row hides is the defect this closes —
    // and not the note's `overflow-wrap`, having no long unbroken token to break.
    const line = PANEL.match(/className="([^"]*)"[^>]*>\s*\{t\.transaction\.withheldAndNet\(/);
    expect(line, 'the element that renders the withholding is gone').not.toBeNull();
    expect(line![1]).toContain('text-[11px]');
    expect(line![1]).toContain('leading-4');
    expect(line![1]).toContain('text-muted');
    expect(
      line![1],
      'it took the note\u2019s wrapping, having no long token to break',
    ).not.toContain('overflow-wrap');
    expect(
      line![1],
      'the line truncates — a figure the row hides is the defect this exists to close',
    ).not.toContain('truncate');
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
    // BOTH, the net included: an untaxed row's net IS the Сума column, so printing it would
    // repeat one figure on most rows and teach the reader that the column adds nothing.
    //
    // THREE GATES: the two table cells and the card's pair. EXACT rather than a floor,
    // because at `>=` the net cell's own gate could be deleted and the column would print on
    // every untaxed row with this test still green — the precise behaviour it is named for.
    // A FOURTH is a legitimate new cell arriving, and the count is what says which.
    const gates = PAYOUTS.match(/row\.taxWithheld !== undefined/g) ?? [];
    expect(
      gates,
      'the gate count moved: one fewer and the column prints on every untaxed row, one more ' +
        'and a new cell arrived that this count has not been told about',
    ).toHaveLength(3);
    // Gated on the WITHHOLDING's presence, not on its own value: `net` is always a number, so
    // testing it would never be false.
    expect(
      PAYOUTS,
      'the net cell is gated on its own value, which is always a number and so never false',
    ).toMatch(/row\.taxWithheld !== undefined \? f\.num\(row\.net\) : ''/);
    expect(PAYOUTS).not.toMatch(/row\.taxWithheld \?\?/);
    expect(PAYOUTS).not.toMatch(/row\.net \?\?/);
  });

  it('widens the table to the seven columns’ own width', () => {
    // Seven columns need more max-content than a bound written for five, and the table
    // already scrolls at the narrow end — so the old bound would cramp the two new columns
    // rather than letting the horizontal Scroller do the job it is there for.
    expect(PAYOUTS).toMatch(/min-w-\[720px\]/);
    expect(PAYOUTS).not.toMatch(/min-w-\[560px\]/);
  });

  it('gives the 360 card the table’s own headers, verbatim', () => {
    // Every column header becomes a `dt` VERBATIM, because the two forms are ONE SCREEN SEEN
    // AT TWO WIDTHS and a reader who learns a column name on a laptop must find it again on
    // a phone.
    const facts = PAYOUTS.match(/<Fact label=\{t\.analytics\.\w+\}/g) ?? [];
    expect(facts).toContain('<Fact label={t.analytics.withheldUah}');
    expect(facts).toContain('<Fact label={t.analytics.netOfTaxUah}');
  });
});
