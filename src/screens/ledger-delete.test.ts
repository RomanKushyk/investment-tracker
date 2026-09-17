import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A LEDGER ROW CAN BE DELETED, and the property worth pinning is not that it can — it is
// that the ✕ ASKS. A DELETE HERE IS NOT UNDOABLE: the row leaves Dexie and every derived
// figure recomputes from what is left, so one mis-click on a hover-revealed glyph is a
// silent loss of money data.
//
// So the ✕ may only ever change WHICH ROW IS ASKING; the mutation belongs to the confirm
// button alone, and this file fails if a later refactor wires the glyph straight to
// `mutate` — the shape a "simplification" would take.
//
// A source test: the suite is `environment: 'node'`, so there is no way to mount the panel
// and press anything.
const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8');

/** COMMENTS STRIPPED BEFORE MATCHING: the prose above names `mutate` and the confirm button,
 *  so an unstripped read lets a comment answer for the wiring. QUOTE-EXACT AND LINE BY LINE,
 *  because dropping only whole-line `//` comments leaves the trailing ones and one apostrophe
 *  in prose then desynchronises every quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// removeTransaction(` in the panel leaves this green and
 *  turns the reader it replaces red on the caller count. */
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
const CODE = stripTs(RAW);

describe('deleting a ledger row', () => {
  it('gives a confirmed coupon its occurrence back', () => {
    // The card's confirm writes the payout AND rolls `asset.nextCoupon` forward, and THE GRID
    // WALK NEVER LOOKS BEHIND THE POINTER — so deleting only the transaction took the
    // occurrence out of the ledger, the due cards, the reminders and income at once.
    expect(CODE).toMatch(/rollbackNextCoupon\(/);
    expect(CODE).toMatch(
      /updateAsset\.mutate\(\{ id: asset\.id, patch: \{ nextCoupon: reopened \} \}\)/,
    );
    expect(
      CODE,
      'the deleted row can settle its own occurrence — the REMAINING ledger is what decides it',
    ).toMatch(/transactions\.filter\(\(t\) => t\.id !== tx\.id\)/);
    expect(CODE, 'the toast reports the ledger alone, not that the schedule moved').toMatch(
      /couponReopenedToast/,
    );
  });

  it('names the record in the question, and announces it', () => {
    // The asking state REPLACES the row, so its label, amount and date are gone at the moment
    // of confirming something unrecoverable.
    expect(CODE).toMatch(/role="alert"/);
    expect(CODE).toMatch(/delete\.ask\(f\.money\(tx\.amount\), f\.dateShort\(tx\.date\)\)/);
  });

  it('gives the labelled buttons the overlay, never the squared box', () => {
    // `TAP_44_BOX` squares a control below `md` and «Видалити» has no wrap opportunity inside
    // it, spilling out of its own border. `tap-target.ts` reserves that box for a control
    // that draws none.
    const asking = CODE.slice(CODE.indexOf('role="alert"'), CODE.indexOf('delete.cancel'));
    expect(asking).toContain('${TAP_44}');
    expect(asking).not.toContain('TAP_44_BOX');
    expect(asking, 'the keyboard leaves the question it just asked').toContain('autoFocus');
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
    // `removeTransaction` is the single path to the mutation, called from one place.
    expect((CODE.match(/removeTransaction\(/g) ?? []).length).toBe(2); // the definition + one call
    expect((CODE.match(/deleteTransaction\.mutate\(/g) ?? []).length).toBe(1);
  });

  it('keeps the asking row asking when the delete fails', () => {
    // `onSuccess` clears it; `onError` deliberately does not, so the answer is still one
    // press away instead of lost with the toast.
    const call = CODE.slice(CODE.indexOf('deleteTransaction.mutate('));
    const body = call.slice(0, call.indexOf('\n  }'));
    expect(body).toMatch(/onSuccess: \(\) => \{[\s\S]*?setConfirmingId\(undefined\)/);
    const onError = body.slice(body.indexOf('onError'));
    expect(onError).not.toMatch(/setConfirmingId/);
  });

  it('draws a separator between RECORDS, and none above the first', () => {
    // `divide-y` was the obvious spelling and produced no rule in this build, so the row
    // carries its own hairline — which is what `/payouts`' table does too.
    //
    // THE BOUNDARY BELONGS TO THE WRAPPER, and the wrapper is the element that is NOT a flex
    // row: an anchor on `className="group flex…"` still matches the inner line textually, so
    // a rule drawn between a record's own two halves would pass.
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
    // The ABSENT case is the normal one, so it must draw no empty line, no dash and no
    // placeholder. An `undefined` check rather than a truthiness one: `''` never reaches the
    // store, and a truthy test would hide a note typed as a single space if one ever did.
    expect(CODE).toMatch(/\{!asking && tx\.note !== undefined && \(/);
    expect(CODE).not.toMatch(/tx\.note \?\?/);
    expect(CODE).not.toMatch(/tx\.note \|\|/);
    // It wraps rather than truncating and runs the full width — no reserved column for the ✕,
    // which sits on the line above.
    //
    // ANCHORED ON THE ELEMENT THAT RENDERS `{tx.note}`, which is what makes the match
    // structural rather than positional: the withholding line above it opens with the very
    // same utilities, so a class-string pattern found the WITHHOLDING and then asserted the
    // note's wrapping about it.
    const note = CODE.match(/className="(mt-0\.5 text-\[11px\][^"]*)">\s*\{tx\.note\}/);
    expect(note).not.toBeNull();
    expect(note![1]).toContain('overflow-wrap:anywhere');
    expect(note![1]).not.toContain('truncate');
    expect(note![1]).not.toContain('pr-');
  });

  it('reveals the glyph on hover and leaves it visible on touch', () => {
    // A hover-only control does not exist on a phone, and always-on glyphs are noise on a
    // desktop. `focus-visible` keeps it reachable by keyboard, which hover alone never is.
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
