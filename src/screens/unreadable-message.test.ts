import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { en, uk } from '../i18n/messages';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...parts: string[]) =>
  readFileSync(join(here, ...parts), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

// A numeric field can now fail for a reason it could not before: the text is not
// a number UNDER THIS LANGUAGE'S GRAMMAR. Every site below answered that with the
// message for a different failure — «has to be a positive number» about a pasted
// `16,5`, which is positive. The schemas already part the two (`invalid_type` vs
// `too_small`, pinned in `core/schemas.test.ts`); what these pin is that each
// picker READS the difference, because no test environment here renders one.
// The five this issue covers. Four more still answer every failure with one
// sentence — the asset form's three percent inputs and `/allocation`'s target
// row — and the quote row answers two of the three with «Enter a number.». That
// is a different list from the one `docs/DECISIONS.md` keeps, which is about
// storing a language-free value, and the two happening to be nearly the same
// fields is a coincidence worth not relying on.
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
    // ONE FAILURE, ONE SENTENCE. Four namespaces carry it — the panel's two, the
    // rate box's and the quote row's own — and a copy-edit to any one of them
    // has to reach the rest or the app says it two ways.
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
    // A withholding is optional — the bond half of this portfolio never carries
    // one — so a "missing" sentence would be a refusal of the normal state.
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
    // ANCHORED to each error block, per the rule at the head of
    // `transaction-form-reset.test.ts`: the identifier appearing ANYWHERE in the
    // file would pass over a branch that can never be taken.
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
    // And it asks CORE which failure it was — inside the arm, not merely imported.
    expect(code).toMatch(/couldNotRead\([^)]*Fault/);
  });

  it('reads it in the rate box, which has no schema to ask', () => {
    // `storedNumber` is `undefined` for text the field could not read, so the
    // distinction is already there — only the message was missing.
    const code = read('Settings.tsx');
    const start = code.indexOf('id={USD_RATE_ERROR_ID}');
    expect(start, 'the rate error block is gone').toBeGreaterThan(-1);
    const block = code.slice(start, code.indexOf('</div>', start));
    expect(block, 'no unreadable arm').toContain('rate.unreadable');
    expect(block, 'lost the range arm').toContain('rate.invalid');
  });
});
