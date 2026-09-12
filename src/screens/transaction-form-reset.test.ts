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
const strip = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const CODE = strip(RAW);

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

  it('reaches the DOM node through the shared field, which is now two hops', () => {
    // The defect this file exists for was react-hook-form holding a ref that was
    // not the live input. `NumberField` sits between them now, so the chain has
    // a second link: the panel hands it `field.ref`, and it has to pass that on
    // to the element it renders as well as keeping its own. Drop either half and
    // `_f.ref` is a component that was never mounted — the same silent failure,
    // one file further away.
    const field = amountField();
    expect(field).toMatch(/<NumberField/);
    expect(field).toMatch(/ref=\{field\.ref\}/);

    // Comment-stripped like every other read here (rule 2 at the head of this
    // file): `// ref(el)` in a comment is not a ref.
    const shared = strip(
      readFileSync(join(here, '..', 'components', 'ui', 'NumberField.tsx'), 'utf8'),
    );
    expect(shared, 'NumberField declares no ref prop').toMatch(/ref\?: Ref<HTMLInputElement>/);
    expect(shared, 'NumberField never passes the ref on').toMatch(/ref\(el\)/);
    // The half the first cut of this test missed: it also has to KEEP one, or
    // every caret restore becomes a silent no-op on a null element.
    expect(shared, 'NumberField keeps no handle of its own').toMatch(/input\.current = el/);
    // And the half BOTH earlier cuts missed: none of it matters unless the
    // callback is actually attached to the element that gets rendered.
    expect(shared, 'NumberField never attaches its ref callback').toMatch(
      /<input[\s\S]*ref=\{hold\}/,
    );
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

describe('the two controls #136 adds obey the panel\u2019s own rules', () => {
  /**
   * ONE Controller's JSX — opened at the `<Controller` that owns the name and
   * closed at the self-closing tag sitting at that SAME INDENT. Nothing else
   * marks its end: `</div>` finds the Reveal's, `/>` alone finds the
   * `NumberField`'s, and the next `name=` finds whatever comes next in the file.
   *
   * Both of the obvious boundaries were tried and both were wrong, in opposite
   * directions. `</div>` is safe for the amount only because its cell IS a div;
   * the withholding renders a FRAGMENT inside a `Reveal`, so its first `</div>`
   * is the Reveal's, 67 lines and a whole Source Controller later — every
   * assertion then held against two fields at once. Closing at the next `name=`
   * fixed that one and broke the note, which is the LAST name in the file: its
   * window ran to the end, swallowing the submit, the summary and the entire
   * ledger card. The indent is the only thing that describes the actual node.
   */
  function field(name: string): string {
    const at = CODE.indexOf(`name="${name}"`);
    expect(at, `the ${name} Controller is gone`).toBeGreaterThan(-1);
    const open = CODE.lastIndexOf('<Controller', at);
    expect(open, `${name} is not inside a Controller`).toBeGreaterThan(-1);
    const indent = CODE.slice(CODE.lastIndexOf('\n', open) + 1, open);
    const close = CODE.indexOf(`\n${indent}/>`, at);
    expect(close, `the ${name} Controller is not closed at its own indent`).toBeGreaterThan(at);
    const window = CODE.slice(open, close);
    // Not a tautology the way a count over a slice ENDING at the next name was:
    // this window's end is structural, so a second field inside it is a real
    // possibility and a real failure.
    expect(window.match(/name="/g)?.length ?? 0, `${name}: the window is not one field`).toBe(1);
    return window;
  }

  it('renders both from form state, never as uncontrolled inputs', () => {
    // `register()` is the exact call that made the reset unable to reach the
    // DOM for «Сума». Both new fields clear on a successful record, so both
    // depend on the same thing.
    expect(CODE).not.toMatch(/register\(\s*['"]taxWithheld['"]/);
    expect(CODE).not.toMatch(/register\(\s*['"]note['"]/);
    for (const name of ['taxWithheld', 'note']) {
      const f = field(name);
      expect(f, `${name}: not bound to form state`).toMatch(/value=\{field\.value \?\? ''\}/);
      expect(f, `${name}: does not write back`).toMatch(/onChange=\{field\.onChange\}/);
      expect(f, `${name}: lost its ref`).toMatch(/ref=\{field\.ref\}/);
      expect(f, `${name}: carries a defaultValue`).not.toMatch(/defaultValue/);
    }
  });

  it('links each error to its input rather than folding it into the name', () => {
    // A message inside a <label> becomes part of the input's accessible NAME.
    // Both use `htmlFor` + `aria-describedby`, the anatomy the amount uses.
    for (const [name, errorId] of [
      ['taxWithheld', 'WITHHOLDING_ERROR_ID'],
      ['note', 'NOTE_ERROR_ID'],
    ] as const) {
      const f = field(name);
      expect(f, `${name}: no aria-invalid`).toMatch(/aria-invalid=\{fieldState\.invalid/);
      expect(f, `${name}: error not linked`).toContain(errorId);
      expect(f, `${name}: lost the invalid border`).toMatch(
        /className=\{inputClass\(fieldState\.invalid\)\}/,
      );
    }
  });

  it('reveals the withholding on the payout pair and clears it when it leaves', () => {
    // The schema REFUSES a withholding on a type that takes none rather than
    // normalizing it away, so without the clear the refusal would point at a
    // control no longer on screen — the defect the units' own effect exists to
    // prevent.
    expect(CODE).toMatch(/const takesWithholding = isPayout\(txType\)/);
    // Whitespace-tolerant: prettier wraps the tag once the class list grows, and
    // a pin that breaks on a reformat teaches the next reader to loosen it.
    expect(CODE).toMatch(/<Reveal\s+show=\{takesWithholding\}/);
    // The cell carries `min-w-0` for the reason `inputClass` states: a grid
    // item's `min-width` is `auto`, so a cell holding an input sizes its column
    // to the input's intrinsic min-content instead of to the cell.
    expect(CODE).toMatch(/show=\{takesWithholding\}[\s\S]{0,120}min-w-0/);
    expect(CODE).toMatch(/if \(takesWithholding\) return;/);
    expect(CODE).toMatch(/form\.setValue\('taxWithheld', ''\)/);
    expect(CODE).toMatch(/form\.clearErrors\('taxWithheld'\)/);
  });

  it('never hides the note, and never caps it in the DOM', () => {
    // It is asked on all eight types, so it has no revealed state. And a
    // `maxLength` would make the refusal unreachable — the cap's reason is
    // visual, so the sentence is what carries it.
    //
    // Through `field()` like everything else here: this read its own `</div>`
    // window, which is the exact boundary the helper's docblock spends a
    // paragraph refusing. The assertion is negative, so the wide window was
    // conservative rather than vacuous — and a footgun a file warns about
    // should not be loaded in that file.
    expect(field('note')).not.toContain('maxLength');
    // WHICH OPENER IS NEAREST, not how far away one is. A 200-character window
    // was the first spelling and could not fail: the gap between the note's
    // Controller and the last `<Reveal` measures 2 928. Ask the question
    // structurally instead — wrap the note and the Reveal becomes the nearer
    // opening tag, which this trips on.
    const at = CODE.indexOf('name="note"');
    expect(CODE.lastIndexOf('<div', at), 'the note is inside a Reveal').toBeGreaterThan(
      CODE.lastIndexOf('<Reveal', at),
    );
  });

  it('stores both ABSENT rather than empty, and clears both on a record', () => {
    // Dexie stores `undefined` as a present key and `json.ts` round-trips the
    // object, so an absent field must be ABSENT — spread, never assigned.
    expect(CODE).toMatch(
      /\.\.\.\(values\.taxWithheld === undefined \? \{\} : \{ taxWithheld: values\.taxWithheld \}\)/,
    );
    expect(CODE).toMatch(/\.\.\.\(values\.note === undefined \? \{\} : \{ note: values\.note \}\)/);
    // Both are per-row facts and neither survives a record, unlike type/source.
    expect(CODE).toMatch(/taxWithheld: '',\s*note: '',\s*priceMode: values\.priceMode/);
  });

  it('hands Source the second column back only when nothing else has it', () => {
    // The rule is "whoever takes the second column pushes Source down", and
    // units are no longer the only one who can.
    expect(CODE).toMatch(
      /group-has-\[#tx-quantity\]:col-span-2 group-has-\[#tx-withholding\]:col-span-2/,
    );
  });
});
