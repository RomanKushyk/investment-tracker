import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A LEDGER ROW CAN BE DELETED, and the property worth pinning is not that it can
// — it is that the ✕ ASKS. A delete here is not undoable: `useDeleteTransaction`
// removes the row from Dexie, and every derived figure in the app (invested,
// capital, payouts, the coupon dedupe) recomputes from what is left. One
// mis-click on a hover-revealed glyph would be a silent loss of money data.
//
// So the ✕ may only ever change WHICH ROW IS ASKING. The mutation belongs to the
// confirm button alone, and this file fails if a later refactor wires the glyph
// straight to `mutate` — which is the shape a "simplification" would take.
//
// A source test, for the reason `transactions-layout.test.ts` gives: the suite is
// `environment: 'node'`, so there is no way to mount the panel and press
// anything. The browser is what verified the behaviour (37 rows → ask → confirm →
// 36 rows, toast «Транзакцію видалено»); this keeps the shape.
const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8');
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('deleting a ledger row', () => {
  it('gives a confirmed coupon its occurrence back', () => {
    // The card's confirm writes the payout AND rolls `asset.nextCoupon` forward.
    // Deleting only the transaction left the pointer ahead of it, and the grid
    // walk never looks behind the pointer — the occurrence left the ledger, the
    // due cards, the reminders and income at once. This is the guard for that.
    expect(CODE).toMatch(/rollbackNextCoupon\(/);
    expect(CODE).toMatch(
      /updateAsset\.mutate\(\{ id: asset\.id, patch: \{ nextCoupon: reopened \} \}\)/,
    );
    // The remaining ledger is what decides it, so the deleted row cannot settle
    // its own occurrence.
    expect(CODE).toMatch(/transactions\.filter\(\(t\) => t\.id !== tx\.id\)/);
    // And the toast says the schedule moved, not only the ledger.
    expect(CODE).toMatch(/couponReopenedToast/);
  });

  it('names the record in the question, and announces it', () => {
    // The asking state replaces the row, so its label, amount and date are gone
    // at the moment of confirming something unrecoverable.
    expect(CODE).toMatch(/role="alert"/);
    expect(CODE).toMatch(/delete\.ask\(f\.money\(tx\.amount\), f\.dateShort\(tx\.date\)\)/);
  });

  it('gives the labelled buttons the overlay, never the squared box', () => {
    // `TAP_44_BOX` squares a control to 44 x 44 below `md`; «Видалити» has no wrap
    // opportunity inside 44 px and spills out of its own border. `tap-target.ts`
    // reserves the box for a control that draws none.
    const asking = CODE.slice(CODE.indexOf('role="alert"'), CODE.indexOf('delete.cancel'));
    expect(asking).toContain('${TAP_44}');
    expect(asking).not.toContain('TAP_44_BOX');
    // The keyboard stays on the question it just asked.
    expect(asking).toContain('autoFocus');
  });

  it('asks first — the ✕ only marks the row, it never deletes', () => {
    // The glyph's handler, isolated: it sets the asking id and nothing else.
    const glyph = CODE.match(/aria-label=\{t\.transaction\.delete\.aria\}[\s\S]*?\/>/);
    expect(glyph, 'the delete glyph is gone').not.toBeNull();
    expect(glyph![0]).toMatch(/onClick=\{\(\) => setConfirmingId\(tx\.id\)\}/);
    expect(glyph![0]).not.toMatch(/removeTransaction|\.mutate\(/);
  });

  it('deletes from the confirm button only, and there is exactly one caller', () => {
    expect(CODE).toMatch(/onClick=\{\(\) => removeTransaction\(tx\)\}/);
    // `removeTransaction` is the single path to the mutation, and it is called
    // from one place: the confirm.
    expect((CODE.match(/removeTransaction\(/g) ?? []).length).toBe(2); // the definition + one call
    expect((CODE.match(/deleteTransaction\.mutate\(/g) ?? []).length).toBe(1);
  });

  it('keeps the asking row asking when the delete fails', () => {
    // `onSuccess` clears it; `onError` deliberately does not, so the answer is
    // still one press away instead of lost with the toast.
    const call = CODE.slice(CODE.indexOf('deleteTransaction.mutate('));
    const body = call.slice(0, call.indexOf('\n  }'));
    expect(body).toMatch(/onSuccess: \(\) => \{[\s\S]*?setConfirmingId\(undefined\)/);
    const onError = body.slice(body.indexOf('onError'));
    expect(onError).not.toMatch(/setConfirmingId/);
  });

  it('draws a separator between RECORDS, and none above the first', () => {
    // `divide-y` was the obvious spelling and produced no rule in this build —
    // measured, the colour applied and the width stayed 0 — so the row carries
    // its own hairline, which is also what `/payouts`' table does.
    //
    // THE ANCHOR MOVED WITH THE NOTE, deliberately, and the old one would not
    // have noticed: it matched `className="group flex…"`, which still matches
    // the inner line textually — so a rule drawn between a record's own two
    // halves would have passed. The boundary belongs to the wrapper, and the
    // wrapper is the element that is NOT a flex row.
    const record = CODE.match(/className="group animate-in[^"]*"/);
    expect(record).not.toBeNull();
    expect(record![0]).toContain('border-t border-hairline');
    expect(record![0]).toContain('first:border-t-0');
    expect(record![0]).not.toContain('flex');
    // And the line inside it carries neither, or the note would sit under a rule.
    const line = CODE.match(/className="flex items-center justify-between[^"]*"/);
    expect(line).not.toBeNull();
    expect(line![0]).not.toContain('border-t');
    expect(CODE).not.toContain('divide-y');
  });

  it('shows a note under the line, and NOTHING when there is none', () => {
    // The absent case is the normal one — eighteen of eighteen seeded rows —
    // so it must draw no empty line, no dash and no placeholder. An `undefined`
    // check rather than a truthiness one: `''` never reaches the store, and a
    // truthy test would hide a note somebody typed as a single space if one
    // ever did.
    expect(CODE).toMatch(/\{!asking && tx\.note !== undefined && \(/);
    expect(CODE).not.toMatch(/tx\.note \?\?/);
    expect(CODE).not.toMatch(/tx\.note \|\|/);
    // It wraps rather than truncating, and runs the full width — no reserved
    // column for the ✕, which sits on the line above.
    const note = CODE.match(/className="mt-0\.5 text-\[11px\][^"]*"/);
    expect(note).not.toBeNull();
    expect(note![0]).toContain('overflow-wrap:anywhere');
    expect(note![0]).not.toContain('truncate');
    expect(note![0]).not.toContain('pr-');
  });

  it('reveals the glyph on hover and leaves it visible on touch', () => {
    // A hover-only control does not exist on a phone, where there is no hover to
    // have; eighteen always-on glyphs are noise on a desktop. `focus-visible`
    // keeps it reachable by keyboard, which hover alone never is.
    const glyph = CODE.match(/aria-label=\{t\.transaction\.delete\.aria\}[\s\S]*?\/>/)![0];
    for (const part of [
      'opacity-0',
      'group-hover:opacity-100',
      'focus-visible:opacity-100',
      'max-md:opacity-100',
    ]) {
      expect(glyph, `the glyph lost \`${part}\``).toContain(part);
    }
    expect(CODE).toMatch(/className="group animate-in/); // the hover group it belongs to
  });
});
