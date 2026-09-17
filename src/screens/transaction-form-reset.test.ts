import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A CONTROLLED «Сума» IS THE FIX, and the reason is that the uncontrolled one failed
// INTERMITTENTLY. `reset({ amount: '' })` cleared react-hook-form's state and wrote into
// the DOM node the field's ref pointed at — a node that was neither the live input nor
// attached to the document — so the state said `''`, the input still showed a figure, and
// the next press validated the empty state with nothing highlighted. Adding one unrelated
// `useRef` made it vanish and removing it brought it back: react-compiler is a Babel plugin
// here, so the component's hook list decides what it memoises and therefore whether that ref
// is re-attached. A fix that depends on the compiler being favourable is not a fix. A
// controlled field renders its value from state every render and cannot desync.
//
// A SOURCE TEST because the suite runs `environment: 'node'` with no jsdom and no
// testing-library: there is no way to mount the panel here, and adding a DOM environment is
// not this fix's to smuggle in.
//
// TWO RULES THIS FILE LEARNED FROM ITS OWN REVIEW, both about how a source test lies:
//   1. ANCHOR THE MATCH: every read below starts at `name="amount"`. A window opened at
//      `<Controller` and closed at the first `/>` spans FOUR controllers, so the date
//      picker satisfies assertions about the amount.
//   2. STRIP THE COMMENTS, or writing this very rationale into the panel — the natural
//      place for it — fails the suite with no behaviour change.
const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, 'TransactionPanel.tsx'), 'utf8');

/** QUOTE-EXACT AND LINE BY LINE, which is the half a regex cannot do: dropping only
 *  whole-line `//` comments leaves the trailing ones, and one apostrophe in prose then
 *  desynchronises every quote pair after it. Copied from
 *  `floating-edges.test.ts` SIGNATURE AND ALL — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// register('amount'` in the panel leaves this green and turns
 *  the reader it replaces red. Rule 2 above already held for prose written on its own line, which
 *  is how rationale is written; the hole this closes is the comment that trails code. */
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
    expect(
      CODE,
      '«Сума» is registered as an uncontrolled input again — the exact call that made the ' +
        'reset unable to reach the DOM',
    ).not.toMatch(/register\(\s*['"]amount['"]/);
  });

  it('renders «Сума» from form state, and writes back on change', () => {
    const field = amountField();
    expect(field).toMatch(/value=\{field\.value\}/);
    expect(field).toMatch(/onChange=\{field\.onChange\}/);
    expect(
      field,
      'a `defaultValue` is the uncontrolled shape wearing a controlled name',
    ).not.toMatch(/defaultValue=/);
  });

  it('reaches the DOM node through the shared field, which is now two hops', () => {
    // `NumberField` sits between the panel and the input, so the chain has a second link.
    // Drop either half and `_f.ref` is a component that was never mounted — the same silent
    // failure, one file further away.
    const field = amountField();
    expect(field).toMatch(/<NumberField/);
    expect(field).toMatch(/ref=\{field\.ref\}/);

    // Comment-stripped like every other read here (rule 2 above): the four assertions below
    // are substring matches, and `// ref(el)` in a comment is not a ref.
    const shared = stripTs(
      readFileSync(join(here, '..', 'components', 'ui', 'NumberField.tsx'), 'utf8'),
    );
    expect(shared, 'NumberField declares no ref prop').toMatch(/ref\?: Ref<HTMLInputElement>/);
    expect(shared, 'NumberField never passes the ref on').toMatch(/ref\(el\)/);
    expect(
      shared,
      'NumberField keeps no handle of its own — every caret restore is a no-op on null',
    ).toMatch(/input\.current = el/);
    expect(
      shared,
      'NumberField never attaches its ref callback, so none of the rest matters',
    ).toMatch(/<input[\s\S]*ref=\{hold\}/);
  });

  it('marks the field when it is invalid, so the summary has something to point at', () => {
    const field = amountField();
    expect(field).toMatch(/aria-invalid=/);
    expect(field).toMatch(/aria-describedby=/);
    expect(field).toMatch(/inputClass\(fieldState\.invalid\)/);
    // Two messages, because the schema refuses four things and one sentence told someone
    // who typed `0` to enter the amount they had just typed.
    expect(field).toMatch(/amountMissing/);
    expect(field).toMatch(/amountNotPositive/);
  });

  it('gives every other control of this form an invalid state too', () => {
    expect(
      CODE,
      'a summary naming highlights that do not exist stays reachable through this control',
    ).toMatch(/name="assetId"[\s\S]*?invalid=\{fieldState\.invalid\}/);
    expect(CODE).toMatch(/name="date"[\s\S]*?invalid=\{fieldState\.invalid\}/);
  });

  it('lets the summary speak only for fields the reader can see', () => {
    // The quick-create sub-form's fields are unmounted whenever the asset select holds a
    // real asset, so its errors may not raise a line pointing at highlights that cannot exist.
    expect(CODE).toMatch(/isNewAsset\s*&&\s*Object\.keys\(assetForm\.formState\.errors\)/);
  });

  it('renders the LEDGER row from the type, not from the stored id', () => {
    // The only change here that fixes rows ALREADY IN THE STORE: nothing migrates them, so
    // an old deposit still names whichever asset the picker was showing. `navigation-map.md`
    // states it as fact — any deposit/withdrawal row reads «Портфель» whatever its stored
    // `assetId` says. *Persistence today*
    expect(CODE).toMatch(
      /const asset = targetsAsset\(tx\.type\) \? assetById\.get\(tx\.assetId\) : undefined;/,
    );
    expect(
      CODE.match(/const asset = assetById\.get\(tx\.assetId\);/g),
      "`removeTransaction`'s plain lookup is gone or doubled. It is deliberately NOT " +
        'guarded, because `rollbackNextCoupon` refuses anything but an `interest_payout` ' +
        'on its own asset',
    ).toHaveLength(1);
  });

  it('keeps the quick-create panel on a bare gate — `Reveal` was tried and reverted', () => {
    // `Reveal` animates opacity and translate, never HEIGHT, so wrapping the panel deferred
    // the whole collapse to one frame, blanked the fields mid-fade, desynced «Код» from form
    // state on re-entry, and left ten controls hit-testable while leaving. The pop is the
    // lesser fault until `Reveal` can animate height and mark its subtree `inert`.
    //
    // ANCHORED ON `AssetFormFields`, because the shape alone certifies nothing: pinning only
    // `<Reveal show={isNewAsset}` passed with the whole dashed panel deleted from inside it.
    expect(CODE).toMatch(/\{isNewAsset && \([\s\S]{0,900}?<AssetFormFields/);
    expect(CODE).not.toMatch(/<Reveal show=\{isNewAsset\}/);
  });

  it('reveals the asset picker only on the types that target an asset', () => {
    // The window is the measured gap plus headroom, and narrow enough that no other `name=`
    // falls inside it — the real gap is a little over 250 characters. Widen it and the match
    // reaches the next Controller and passes about the wrong field, which is Rule 1 above.
    expect(
      CODE,
      'deleting the wrapper leaves every other test here green while «Внесок» asks for an ' +
        'asset it has no use for — the reported bug',
    ).toMatch(/<Reveal show=\{needsAsset\}[\s\S]{0,300}?name="assetId"/);
    expect(CODE).toMatch(/const needsAsset = targetsAsset\(txType\);/);
  });

  it('clears the asset ERROR when that picker leaves, and never its value', () => {
    expect(
      CODE,
      'the clear is a passive effect, so it flashes the red border on a control already ' +
        'fading out — `useLayoutEffect` lands it before that frame is painted',
    ).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(!needsAsset\) form\.clearErrors\('assetId'\);/);
    // The VALUE is never touched: a write into a freshly mounted Radix `Select` is undone by
    // the control itself, so the invariant lives in the schema's transform instead.
    expect(CODE, '`setValue` on the picker is a regression, not a tidy-up').not.toMatch(
      /setValue\('assetId', ''\)/,
    );
  });

  it('separates WHERE THE PICKER IS from whether quick-create is in play', () => {
    expect(CODE).toMatch(/const pickedNew = assetId === 'new';/);
    expect(CODE).toMatch(/const isNewAsset = needsAsset && pickedNew;/);
    expect(
      CODE,
      'the sub-form reset is gated on something other than the picker. On `isNewAsset`, ' +
        'which depends on the TYPE, a glance at «Внесок» wipes a half-typed new asset',
    ).toMatch(/if \(!pickedNew\) assetForm\.reset\(assetFormDefaults\(f\)\);/);
  });

  it('restores the picker from the SUBMITTING RENDER, not from a later read', () => {
    // `values.assetId` cannot serve: the transform blanks it on a portfolio-level row. Nor
    // can `getValues` — `handleSubmit` awaits the resolver, twice on the quick-create
    // branch, so a picker moved inside that window would be restored over the choice the row
    // was written with. The watched value closes over the render that submitted.
    expect(CODE).toMatch(
      /form\.reset\(\{[\s\S]{0,900}?assetId: newAsset \? newAsset\.id : assetId,/,
    );
    expect(CODE).not.toMatch(/assetId: newAsset \? newAsset\.id : form\.getValues/);
  });

  it('STORES the parsed assetId, which is the only place the blanking is read', () => {
    expect(
      CODE,
      "the stored row no longer takes `values.assetId`, where the transform's blanking " +
        'lives — the watched `assetId` the reset uses stores whatever the hidden picker held',
    ).toMatch(
      /const tx: Transaction = \{[\s\S]{0,400}?assetId: newAsset \? newAsset\.id : values\.assetId,/,
    );
  });

  it("clears the sub-form's ERRORS after a successful record, and never its values", () => {
    // The values need no reset from here — the `pickedNew` effect owns that, and a full
    // value-reset in `onSuccess` wiped a half-typed asset whenever a row was recorded that
    // did not use the sub-form. The errors do, or a failed quick-create press leaves red
    // borders over a later success.
    //
    // ANCHORED THROUGH `recordedToast`, which occurs exactly once and only inside
    // `recordTransaction.mutate`'s `onSuccess`. Two looser anchors were each defeated by a
    // mutation: a window from `onSuccess: () =>` reaches past that block's closing brace, so
    // moving the call into `onError` passed; and one fixing only the START let the call be
    // pasted into `deleteTransaction`'s `onSuccess` — deleting a row clears the sub-form and
    // recording one never does. Requiring `recordTransaction.mutate(` FIRST is what excludes
    // the other mutation's callbacks.
    expect(CODE).toMatch(
      /recordTransaction\.mutate\([\s\S]{0,200}?recordedToast[\s\S]{0,4200}?assetForm\.reset\(undefined, \{\s*keepValues: true/,
    );
    expect(
      CODE,
      'a failed write resets the sub-form — those errors are what the user still needs',
    ).not.toMatch(/onError: \(\) => \{[\s\S]{0,300}?assetForm\./);
    // `reset(undefined, { keepValues })` rather than `clearErrors`, which leaves
    // `isSubmitted` set and re-validates on every keystroke afterwards. ALL THREE FLAGS:
    // without `keepDirty` this empties `dirtyFields`, and `AssetForm` gates the Name→Code
    // derivation on `!dirtyFields.code`, so a hand-typed «Код» starts being overwritten.
    expect(CODE).toMatch(
      /assetForm\.reset\(undefined, \{\s*keepValues: true,\s*keepDefaultValues: true,\s*keepDirty: true,/,
    );
  });

  it('latches the submit path, so two presses inside the async window are one write', () => {
    // `handleSubmit` awaits the resolver — and a second one on the quick-create branch — so
    // `disabled={isPending}` cannot cover the gap: nothing is pending yet, and each press
    // that got through minted its own randomUUID. Checked in the DOM event, before
    // `handleSubmit` awaits anything, and not inside a function handed to it during render,
    // which `react-hooks/refs` refuses.
    expect(CODE).toMatch(/onSubmit=\{\(e\) => \{[\s\S]*?if \(inFlight\.current\)/);
    expect(CODE).toMatch(/inFlight\.current = true;/);
    expect(
      CODE,
      'a latch that is never lowered disables the form for the rest of the session',
    ).toMatch(/const releaseLatch = \(\) => \{\s*inFlight\.current = false;/);
    expect(CODE.match(/releaseLatch/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(CODE).toMatch(/form\.formState\.isSubmitting/);
  });
});

describe('the two controls #136 adds obey the panel\u2019s own rules', () => {
  /**
   * ONE Controller's JSX — opened at the `<Controller` that owns the name and closed at the
   * self-closing tag sitting at that SAME INDENT. Nothing else marks its end, and both
   * obvious boundaries were tried and both were wrong in opposite directions. `</div>` is
   * safe for the amount only because its cell IS a div; the withholding renders a FRAGMENT
   * inside a `Reveal`, so its first `</div>` is the Reveal's, a whole Controller later.
   * Closing at the next `name=` fixed that and broke the note, which is the LAST name in the
   * file: its window ran to EOF, swallowing the submit, the summary and the ledger card.
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
    // Not a tautology the way a count over a slice ENDING at the next name was: this
    // window's end is structural, so a second field inside it is a real failure.
    expect(window.match(/name="/g)?.length ?? 0, `${name}: the window is not one field`).toBe(1);
    return window;
  }

  it('renders both from form state, never as uncontrolled inputs', () => {
    // Both new fields clear on a successful record, so both depend on what «Сума» depends on.
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
    // A message inside a <label> becomes part of the input's accessible NAME. Both use
    // `htmlFor` + `aria-describedby`, the anatomy the amount uses.
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
    expect(
      CODE,
      'the payout pair no longer decides who takes a withholding. The schema REFUSES one on ' +
        'a type that takes none rather than normalizing it away, so the refusal then points ' +
        'at a control no longer on screen',
    ).toMatch(/const takesWithholding = isPayout\(txType\)/);
    // Whitespace-tolerant: prettier wraps the tag once the class list grows, and a pin that
    // breaks on a reformat teaches the next reader to loosen it.
    expect(CODE, 'the withholding is no longer revealed on the payout pair').toMatch(
      /<Reveal\s+show=\{takesWithholding\}/,
    );
    // `min-w-0` for the reason `inputClass` states: a grid item's `min-width` is `auto`, so
    // a cell holding an input sizes its column to the input's min-content.
    expect(CODE).toMatch(/show=\{takesWithholding\}[\s\S]{0,120}min-w-0/);
    expect(CODE).toMatch(/if \(takesWithholding\) return;/);
    expect(CODE).toMatch(/form\.setValue\('taxWithheld', ''\)/);
    expect(CODE).toMatch(/form\.clearErrors\('taxWithheld'\)/);
  });

  it('never hides the note, and never caps it in the DOM', () => {
    expect(
      field('note'),
      "a `maxLength` makes the refusal unreachable — the cap's reason is visual, so the " +
        'sentence is what carries it',
    ).not.toContain('maxLength');
    // WHICH OPENER IS NEAREST, not how far away one is: a fixed-width window could not fail,
    // because the gap between the note's Controller and the last `<Reveal` is far wider than
    // any figure worth writing. Wrap the note and the Reveal becomes the nearer opening tag.
    const at = CODE.indexOf('name="note"');
    expect(CODE.lastIndexOf('<div', at), 'the note is inside a Reveal').toBeGreaterThan(
      CODE.lastIndexOf('<Reveal', at),
    );
  });

  it('stores both ABSENT rather than empty, and clears both on a record', () => {
    // Dexie stores `undefined` as a present key and `json.ts` round-trips the object, so an
    // absent field must be ABSENT — spread, never assigned.
    expect(CODE).toMatch(
      /\.\.\.\(values\.taxWithheld === undefined \? \{\} : \{ taxWithheld: values\.taxWithheld \}\)/,
    );
    expect(CODE).toMatch(/\.\.\.\(values\.note === undefined \? \{\} : \{ note: values\.note \}\)/);
    expect(
      CODE,
      'a per-row fact survived a record — unlike type and source, neither of these may',
    ).toMatch(/taxWithheld: '',\s*note: '',\s*priceMode: values\.priceMode/);
  });

  it('hands Source the second column back only when nothing else has it', () => {
    expect(
      CODE,
      'Source keeps the second column when something else has taken it — units are no ' +
        'longer the only control that can',
    ).toMatch(/group-has-\[#tx-quantity\]:col-span-2 group-has-\[#tx-withholding\]:col-span-2/);
  });
});
