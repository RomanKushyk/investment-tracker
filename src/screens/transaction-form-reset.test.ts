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
