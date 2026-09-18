import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { en, uk } from '../i18n/messages';

const here = dirname(fileURLToPath(import.meta.url));
/** Not cosmetic: the prose here and in the pickers names the very message keys asserted
 *  below, so an unstripped read lets a comment answer for the sentence a field shows.
 *  QUOTE-EXACT AND LINE BY LINE, because dropping only whole-line `//` comments leaves the
 *  trailing ones and one apostrophe in prose then desynchronises every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// withholdingMissing` inside the withholding span leaves this
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
const read = (...parts: string[]) => stripTs(readFileSync(join(here, ...parts), 'utf8'));

// A numeric field can fail for a reason it could not before: THE TEXT IS NOT A NUMBER UNDER
// THIS LANGUAGE'S GRAMMAR. Every site below answered that with the message for a different
// failure — «has to be a positive number» about a pasted `16,5`, which is positive. The
// schemas already part the two, and what these pin is that each picker READS the difference,
// because no test environment here renders one.
//
// WHAT IS NOT CLOSED: the asset form's three percent inputs and `/allocation`'s target row
// still answer every failure with one sentence, and the quote row answers two of its three
// with «Enter a number.».
describe('an unreadable value says so, in the six fields this issue covers', () => {
  it('carries the message in both dictionaries', () => {
    for (const dict of [en, uk]) {
      expect(dict.transaction.amountUnreadable.length).toBeGreaterThan(0);
      expect(dict.transaction.quantityUnreadable.length).toBeGreaterThan(0);
      expect(dict.settings.rate.unreadable.length).toBeGreaterThan(0);
    }
    // Each says something different from the sign message it used to borrow.
    expect(en.transaction.amountUnreadable).not.toBe(en.transaction.amountNotPositive);
    expect(uk.transaction.amountUnreadable).not.toBe(uk.transaction.amountNotPositive);
    // ONE FAILURE, ONE SENTENCE: four namespaces carry it, and a copy-edit to any one of
    // them has to reach the rest or the app says it two ways.
    for (const dict of [en, uk]) {
      const said = dict.dailyQuotes.unreadable;
      expect(dict.transaction.amountUnreadable).toBe(said);
      expect(dict.transaction.quantityUnreadable).toBe(said);
      expect(dict.transaction.withholdingUnreadable).toBe(said);
      expect(dict.settings.rate.unreadable).toBe(said);
    }
  });

  it('reads the withholding\u2019s failures — three arms, and no MISSING one', () => {
    const code = read('TransactionPanel.tsx');
    const start = code.indexOf('id={WITHHOLDING_ERROR_ID}');
    expect(start, 'the withholding span is gone').toBeGreaterThan(-1);
    const span = code.slice(start, code.indexOf('</span>', start));
    expect(span, 'no unreadable arm').toContain('withholdingUnreadable');
    expect(span, 'lost the sign arm').toContain('withholdingNotPositive');
    expect(span, 'lost the bound arm').toContain('withholdingAboveAmount');
    // A withholding is OPTIONAL, so a "missing" sentence would refuse the normal state.
    expect(span, 'invented a missing arm').not.toContain('withholdingMissing');
    expect(span, 'hand-wrote the zod code').toContain('UNREADABLE');
  });

  it('reads the failure in the transaction panel, per field', () => {
    const code = read('TransactionPanel.tsx');
    // Between each field's error id and the end of that span, all three arms.
    for (const [id, unreadable, missing, notPositive] of [
      ['AMOUNT_ERROR_ID', 'amountUnreadable', 'amountMissing', 'amountNotPositive'],
      ['QUANTITY_ERROR_ID', 'quantityUnreadable', 'quantityMissing', 'quantityNotPositive'],
    ] as const) {
      const start = code.indexOf(`id={${id}}`);
      expect(start, `${id} span is gone`).toBeGreaterThan(-1);
      const span = code.slice(start, code.indexOf('</span>', start));
      expect(span, `${id}: no unreadable arm`).toContain(unreadable);
      expect(span, `${id}: lost the missing arm`).toContain(missing);
      expect(span, `${id}: lost the sign arm`).toContain(notPositive);
      // Asks CORE which failure it was, rather than hand-writing zod's code.
      expect(span, `${id}: does not ask core which failure it was`).toContain('UNREADABLE');
    }
  });

  it('reads it in the coupon card, for both of its fields', () => {
    // ANCHORED to each error block: the identifier appearing ANYWHERE in the file would pass
    // over a branch that can never be taken.
    const code = read('daily-quotes', 'CouponDueCard.tsx');
    for (const [id, unreadable, missing, notPositive] of [
      ['errorId', 'amountUnreadable', 'amountMissing', 'amountNotPositive'],
      ['unitsErrorId', 'quantityUnreadable', 'quantityMissing', 'quantityNotPositive'],
    ] as const) {
      const start = code.indexOf(`id={${id}}`);
      expect(start, `${id} block is gone`).toBeGreaterThan(-1);
      const block = code.slice(start, code.indexOf('</div>', start));
      expect(block, `${id}: no unreadable arm`).toContain(unreadable);
      expect(block, `${id}: lost the missing arm`).toContain(missing);
      expect(block, `${id}: lost the sign arm`).toContain(notPositive);
    }
    expect(
      code,
      'the arm no longer asks CORE which failure it was — imported is not the same as used',
    ).toMatch(/couldNotRead\([^)]*Fault/);
  });

  it('reads it in the rate box, which has no schema to ask', () => {
    // `storedNumber` is `undefined` for text the field could not read, so the distinction was
    // already there and only the message was missing.
    const code = read('Settings.tsx');
    const start = code.indexOf('id={USD_RATE_ERROR_ID}');
    expect(start, 'the rate error block is gone').toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf('</div>', start));
    expect(block, 'no unreadable arm').toContain('rate.unreadable');
    expect(block, 'lost the range arm').toContain('rate.invalid');
  });
});
