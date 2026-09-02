import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A47 — THE FORM COULD NOT BE SUBMITTED TWICE, and the reason was that its
// «Сума» field was UNCONTROLLED.
//
// `record`'s `onSuccess` calls `form.reset({ ..., amount: '' })`. For an
// uncontrolled input that clears react-hook-form's state and then writes the
// empty string into the DOM node the field's ref points at — and measured in the
// browser, that ref was neither the live input nor attached to the document at
// all (`_f.ref.value === undefined`). So the state said `''`, the input still
// showed `811`, and the next press validated the empty state and failed on
// `amount`, with nothing highlighted.
//
// **It was intermittent in the most misleading way possible.** Adding one
// unrelated `useRef` + `useEffect` at the top of the component made it vanish,
// and removing them brought it back, twice. react-compiler is wired as a Babel
// plugin in `vite.config.ts`, so the component's hook list changes what it
// memoises and therefore whether that ref is ever re-attached. A fix that
// depends on the compiler's memoisation being favourable is not a fix.
//
// A CONTROLLED field cannot desync: its value is rendered from state on every
// render, so `reset` repaints it by construction, with no imperative DOM write
// and no ref to go stale.
//
// This is a SOURCE test because the suite runs in `environment: 'node'` with no
// jsdom and no testing-library: there is no way to mount the panel here, and
// adding a DOM test environment is not this fix's to smuggle in. It follows
// `transactions-layout.test.ts`, which pins its own contract the same way.
//
// TWO RULES THIS FILE LEARNED FROM ITS OWN REVIEW, both about how a source test
// lies:
//
//   1. ANCHOR THE MATCH. The first cut opened at `<Controller` and closed at the
//      first `/>`, which spanned FOUR controllers — so the assertions were
//      satisfied by the date picker while the amount field could have been
//      reverted to uncontrolled and still passed. Verified by mutation, and it
//      did. Every read below starts at `name="amount"`.
//   2. STRIP THE COMMENTS. `not.toMatch(/register\(['"]amount['"]/)` scanned the
//      whole file, so writing this very rationale into the panel — the natural
//      place for it — would have failed the suite with no behaviour change.
const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8');

/** The file with `//` and block comments removed, so prose cannot pass or fail a test. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The amount field's own JSX: from its `name="amount"` to the end of that Controller. */
function amountField(): string {
  const start = CODE.indexOf('name="amount"');
  expect(start, 'the amount Controller is gone').toBeGreaterThan(-1);
  const end = CODE.indexOf('</div>', start);
  expect(end, 'the amount field is not closed').toBeGreaterThan(start);
  return CODE.slice(start, end);
}

describe('the transaction form survives its own reset', () => {
  it('never registers «Сума» as an uncontrolled input', () => {
    // `register('amount')` is the exact call that made the reset unable to reach
    // the DOM. Any spelling of it is the regression.
    expect(CODE).not.toMatch(/register\(\s*['"]amount['"]/);
  });

  it('renders «Сума» from form state, and writes back on change', () => {
    const field = amountField();
    expect(field).toMatch(/value=\{field\.value\}/);
    expect(field).toMatch(/onChange=\{field\.onChange\}/);
    // A `defaultValue` is the uncontrolled shape wearing a controlled name — it
    // is what the mutation test used to prove the first version of this file
    // was vacuous.
    expect(field).not.toMatch(/defaultValue=/);
  });

  it('marks the field when it is invalid, so the summary has something to point at', () => {
    const field = amountField();
    expect(field).toMatch(/aria-invalid=/);
    expect(field).toMatch(/aria-describedby=/);
    expect(field).toMatch(/inputClass\(fieldState\.invalid\)/);
    // Two messages, because the schema refuses four things and one sentence
    // told someone who typed `0` to enter the amount they had just typed.
    expect(field).toMatch(/amountMissing/);
    expect(field).toMatch(/amountNotPositive/);
  });

  it('gives every other control of this form an invalid state too', () => {
    // The reported defect — a summary naming highlights that do not exist — was
    // reachable through the asset select and the date long after «Сума» was
    // fixed, because neither could say it was at fault.
    expect(CODE).toMatch(/name="assetId"[\s\S]*?invalid=\{fieldState\.invalid\}/);
    expect(CODE).toMatch(/name="date"[\s\S]*?invalid=\{fieldState\.invalid\}/);
  });

  it('lets the summary speak only for fields the reader can see', () => {
    // The quick-create sub-form's fields are unmounted whenever the asset select
    // holds a real asset, so its errors may not raise a line that tells the
    // reader to look at highlights that cannot exist.
    expect(CODE).toMatch(/isNewAsset\s*&&\s*Object\.keys\(assetForm\.formState\.errors\)/);
  });

  it('renders the LEDGER row from the type, not from the stored id (D129)', () => {
    // The visible half of the report, and the only D129 change in this file that
    // fixes rows ALREADY IN THE STORE: nothing migrates them, so a deposit
    // recorded before 2026-09-02 still names whichever asset the picker was
    // showing and would read «Внесок · Inzhur REIT». Verified in the browser
    // against a row written straight into Dexie with `assetId: 'reit'`.
    //
    // `routes-1.md` now states this as fact — «Any deposit/withdrawal row reads
    // «Портфель» whatever its stored assetId says» — so it needs a guard.
    expect(CODE).toMatch(
      /const asset = targetsAsset\(tx\.type\) \? assetById\.get\(tx\.assetId\) : undefined;/,
    );
    // `removeTransaction`'s own lookup is deliberately NOT guarded —
    // `rollbackNextCoupon` refuses anything but an `interest_payout` on its own
    // asset — so the plain form must still exist exactly once.
    expect(CODE.match(/const asset = assetById\.get\(tx\.assetId\);/g)).toHaveLength(1);
  });

  it('keeps the quick-create panel on a bare gate — `Reveal` was tried and reverted', () => {
    // `Reveal` animates opacity and translate, never HEIGHT, so wrapping a 593px
    // panel in it deferred the whole collapse to one frame at t=300 (a bigger
    // snap, later), blanked the fields visibly mid-fade, desynced «Код» from form
    // state on re-entry inside the window, and left ten controls hit-testable
    // while leaving. All four measured in Chrome. The pop is the lesser fault
    // until `Reveal` can animate height and mark its subtree `inert`.
    //
    // ANCHORED ON `AssetFormFields`, because the shape alone certifies nothing:
    // an earlier cut pinned only `<Reveal show={isNewAsset}` and passed with the
    // whole dashed panel deleted from inside it.
    expect(CODE).toMatch(/\{isNewAsset && \([\s\S]{0,900}?<AssetFormFields/);
    expect(CODE).not.toMatch(/<Reveal show=\{isNewAsset\}/);
  });

  it('reveals the asset picker only on the types that target an asset (D129)', () => {
    // Deleting the wrapper leaves every other test in this file green while the
    // «Внесок» form asks for an asset it has no use for — the reported bug.
    // The window is 300 — measured 253 between the two, and narrow enough
    // that no other `name=` can fall inside it (this file's own first
    // lesson: anchor the match, or a neighbouring Controller satisfies it).
    expect(CODE).toMatch(/<Reveal show=\{needsAsset\}[\s\S]{0,300}?name="assetId"/);
    expect(CODE).toMatch(/const needsAsset = targetsAsset\(txType\);/);
  });

  it('clears the asset ERROR when that picker leaves, and never its value', () => {
    // The summary must not name a highlight the reader cannot see — the same
    // defect `it('lets the summary speak only for fields the reader can see')`
    // guards one field over, reachable here by submitting a `buy` with an empty
    // picker and then switching to «Внесок».
    //
    // `useLayoutEffect`, so the clear lands BEFORE the frame in which the
    // leaving Select is painted; a passive effect flashed the red border on a
    // control that was already fading out.
    expect(CODE).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!needsAsset\) form\.clearErrors\('assetId'\);/,
    );
    // The VALUE is never touched: a write into a freshly mounted Radix `Select`
    // is undone by the control itself, so the invariant lives in the schema's
    // transform instead. `setValue('assetId', '')` returning here is a
    // regression, not a tidy-up.
    expect(CODE).not.toMatch(/setValue\('assetId', ''\)/);
  });

  it('separates WHERE THE PICKER IS from whether quick-create is in play', () => {
    // Gating the sub-form reset on `isNewAsset` — which D129 made depend on the
    // TYPE — meant a glance at «Внесок» wiped a half-typed new asset, verified
    // in the browser. The reset must key off the picker alone.
    expect(CODE).toMatch(/const pickedNew = assetId === 'new';/);
    expect(CODE).toMatch(/const isNewAsset = needsAsset && pickedNew;/);
    expect(CODE).toMatch(/if \(!pickedNew\) assetForm\.reset\(assetFormDefaults\(f\)\);/);
  });

  it('restores the picker from the SUBMITTING RENDER, not from a later read', () => {
    // `values.assetId` cannot serve: D129's transform blanks it on a
    // portfolio-level row. Nor can `getValues` — `handleSubmit` awaits the
    // resolver (twice on the quick-create branch), so a picker moved inside that
    // window would be restored over the choice the row was written with. The
    // watched value closes over the render that submitted.
    expect(CODE).toMatch(
      /form\.reset\(\{[\s\S]{0,900}?assetId: newAsset \? newAsset\.id : assetId,/,
    );
    expect(CODE).not.toMatch(/assetId: newAsset \? newAsset\.id : form\.getValues/);
  });

  it('STORES the parsed assetId, which is the only place the blanking is read', () => {
    // The row that reaches Dexie must take `values.assetId` — D129's transform
    // is what empties it on a portfolio-level type, and `values` is where that
    // result lives. Swapping this for the watched `assetId` (which the reset
    // above legitimately uses) would store whatever the hidden picker held and
    // put the original bug back, so the two reads are pinned separately.
    expect(CODE).toMatch(
      /const tx: Transaction = \{[\s\S]{0,400}?assetId: newAsset \? newAsset\.id : values\.assetId,/,
    );
  });

  it("clears the sub-form's ERRORS after a successful record, and never its values", () => {
    // A full value-reset in `onSuccess` wiped a half-typed asset whenever a row
    // was recorded that did not use the sub-form — reachable once the panel
    // stopped closing quick-create on a type change. The values need no reset
    // from here (the `pickedNew` effect owns that); the errors do, or a failed
    // quick-create press leaves red borders over a later success.
    //
    // ANCHORED INSIDE `recordTransaction.mutate`'s `onSuccess`, with a bounded
    // window: an unbounded `[\s\S]*?` after the first `onSuccess` matched the
    // call sitting in `onError` three lines below — verified by mutation, and
    // that placement inverts the behaviour the title states while passing.
    // `deleteTransaction` has an `onSuccess` of its own further down, which is
    // the other thing a loose match drifts into. Measured 2026-09-02: 66 chars
    // from `recordTransaction.mutate(` to its `onSuccess`, 3660 from there to
    // the call — the windows are that plus headroom, not round numbers.
    // ANCHORED THROUGH `recordedToast`, which occurs exactly once in the file and
    // only inside `recordTransaction.mutate`'s `onSuccess`. Two looser anchors
    // were each defeated by a mutation: a window from `onSuccess: () =>` reaches
    // past that block's closing brace, so moving the call into `onError` passed;
    // and one from `form.reset`'s last line only fixed the START of the range, so
    // pasting the call into `deleteTransaction`'s `onSuccess` — which means
    // deleting a ledger row clears the sub-form and recording one never does —
    // passed too. Requiring `recordTransaction.mutate(` FIRST is what excludes
    // the other mutation's callbacks; the second window is the measured 4089
    // plus headroom.
    expect(CODE).toMatch(
      /recordTransaction\.mutate\([\s\S]{0,200}?recordedToast[\s\S]{0,4200}?assetForm\.reset\(undefined, \{\s*keepValues: true/,
    );
    // And nothing resets the sub-form when the write FAILS: the errors that
    // press produced are the ones the user still needs to read.
    expect(CODE).not.toMatch(/onError: \(\) => \{[\s\S]{0,300}?assetForm\./);
    // `reset(undefined, { keepValues })` rather than `clearErrors`, because that
    // one leaves `isSubmitted` set and the sub-form keeps re-validating on every
    // keystroke afterwards. ALL THREE FLAGS: without `keepDirty` this reset
    // empties `dirtyFields`, and `AssetForm` gates the Name→Code derivation on
    // `!dirtyFields.code` — so a hand-typed «Код» would start being overwritten
    // from «Назва» again, which `clearErrors` never did.
    expect(CODE).toMatch(
      /assetForm\.reset\(undefined, \{\s*keepValues: true,\s*keepDefaultValues: true,\s*keepDirty: true,/,
    );
  });

  it('latches the submit path, so two presses inside the async window are one write', () => {
    // `handleSubmit` awaits the resolver — and a second one on the quick-create
    // branch — so `disabled={isPending}` cannot cover the gap: nothing is
    // pending yet. Each press that got through minted its own randomUUID.
    // Checked in the DOM event, before `handleSubmit` awaits anything — and not
    // inside a function handed to `handleSubmit` during render, which is what
    // `react-hooks/refs` refuses.
    expect(CODE).toMatch(/onSubmit=\{\(e\) => \{[\s\S]*?if \(inFlight\.current\)/);
    expect(CODE).toMatch(/inFlight\.current = true;/);
    // Released on both outcomes and when either form refuses — a latch that is
    // never lowered disables the form for the rest of the session.
    expect(CODE).toMatch(/const releaseLatch = \(\) => \{\s*inFlight\.current = false;/);
    expect(CODE.match(/releaseLatch/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(CODE).toMatch(/form\.formState\.isSubmitting/);
  });
});
