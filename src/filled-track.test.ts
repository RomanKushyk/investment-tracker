import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PAIRING D114 LEAVES UNGUARDED, made to fail instead.
//
// A filled segmented track is `bg-ink`, and the focus ring resolves to
// `var(--color-ink)` — so a filled track without `data-filled-track` paints the
// ring on its own colour at 1.00:1 and keyboard focus disappears. That is not a
// hypothetical: it is what shipped on all seven controls until the rule was
// added, and in the rail it was the SECOND time the same bug landed there.
//
// The attribute is invisible in a way the fill is not. Someone adding a control
// copies the part they can see — `border border-ink bg-ink` — and nothing else
// fails: lint, typecheck, the suite and format:check all pass while the control
// has no visible focus. So the pairing needs a test rather than a count in a
// decision file.
//
// BOTH HALVES ARE PINNED HERE, and the second was missing at first. The markup
// half is the attribute; the CSS half is the rule the attribute selects. Nothing
// else in this repo reads a stylesheet, so deleting `[data-filled-track]` from
// `index.css` as apparently-unused markup would leave all 1346 tests green and
// put every one of these controls back to ink-on-ink at 1.00:1.
//
// SOURCE TEXT, not a render: this repo runs vitest with `environment: 'node'`
// and carries no render-testing library, which is the same reason
// `price-mode-segment.test.ts` and `transactions-layout.test.ts` read files.
const here = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments stripped, so example markup written in prose cannot satisfy or break
 *  the pairing — measured, that removes one `<div>` mention each from
 *  `AssetForm.tsx`, `Select.tsx` and `TransactionPanel.tsx` and two from
 *  `RecordCard.tsx`. (It is NOT the rail that needs this: the rail's track is
 *  `bg-sidebar-inset`, never the fill pair, and its comment sits between
 *  elements rather than inside a tag.) */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[\t ]*\/\/.*$/gm, '');

/**
 * OPENING TAGS, BRACE-AWARE — and a regex cannot do this.
 *
 * A JSX opening tag does not end at the first `>`: `onKeyDown={(e) => …}` and
 * `className={n > 2 ? a : b}` both put one inside the braces. The first version
 * of this file scanned `<(?:div|label)\b[^>]*?>` and so truncated any such
 * element to `<div onKeyDown={(e) =>`, dropping it from BOTH assertions. That
 * failed in the one direction a guard must not: a new filled track with a
 * roving-focus handler would ship with no visible ring, the pairing test would
 * report nothing, and the floor below would still pass on the untouched six.
 *
 * ANY element name, not `div|label`. A track authored as `<fieldset>` — natural
 * for a radiogroup — or `<span>`, or a wrapper component, is a filled track too;
 * the signature is the class pair, not the tag.
 */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] !== '<' || !/[A-Za-z]/.test(source[i + 1] ?? '')) continue;
    let depth = 0;
    let quote: string | null = null;
    for (let j = i + 1; j < source.length; j += 1) {
      const c = source[j];
      if (quote !== null) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (depth === 0 && (c === '>' || c === '<')) {
        if (c === '>') tags.push(source.slice(i, j + 1));
        i = j;
        break;
      }
    }
  }
  return tags;
}

/**
 * A FILLED TRACK, by the signature D114 actually gives it: `bg-ink` AND
 * `border-ink` on the same element. The border draws nothing on a fill of its
 * own colour — it is a 1px geometric spacer, part of D56's concentric gap — so
 * the PAIR is what separates a track from any other use of the fill token.
 * Matching on `bg-ink` alone reported `Allocation.tsx`'s 2px target marker as an
 * unguarded control.
 */
function filledTracks(source: string): string[] {
  return openingTags(source).filter(
    (tag) => /\bbg-ink\b/.test(tag) && /\bborder-ink\b/.test(tag) && !isControlItself(tag),
  );
}

/**
 * THE ONE EXCEPTION, and it is a real distinction rather than a suppression.
 *
 * `Switch.tsx` takes `border-ink bg-ink` when checked, so it carries a track's
 * signature — but it is not a track, and D114's rule would do nothing for it.
 * A track's ring lands on the FILL because the focused thing is a CHILD sitting
 * on it: `index.css` selects with a DESCENDANT combinator, and its own comment
 * measures the base `outline-offset: 2px` as reaching 2→4px INTO a track whose
 * padding is 4 (`p-1`) or even 2 (`p-[2px]`). The Switch has no focusable child
 * — it IS the control — so the same offset draws its ring 2px OUTSIDE the
 * element, on the surrounding `card`/`panel`, where ink reads at full contrast.
 *
 * So adding `data-filled-track` here would change nothing: the selector needs a
 * descendant and there is none. Named rather than silently dropped, and the test
 * below fails if the Switch ever stops matching — an exception nobody re-checks
 * is how a guard quietly narrows.
 */
const isControlItself = (tag: string) => /<RadixSwitch\.Root\b/.test(tag);

describe('a filled segmented track carries data-filled-track', () => {
  const files = sourceFiles(here).filter((f) => !/\.test\.tsx?$/.test(f));

  it('finds the tracks at all, so an empty pass cannot look like a green one', () => {
    // The anchor. If the fill token is ever renamed, this fails loudly rather
    // than letting the real assertion below pass over zero elements.
    //
    // SIX, where D114 counted seven. The seventh was `KindSegment`, the asset
    // form's Fund/Bond control, and D116 DELETED it: an Inzhur bond is an OVDP
    // and everything else the provider lists is a fund, so the control could
    // only agree with the yield type or contradict it. The floor moved because a
    // control went away, not because the rule weakened.
    //
    // A FLOOR, not an equality, and deliberately: a seventh filled control must
    // pass this and be caught by the pairing test below instead. Only a vanished
    // one fails here.
    const all = files.flatMap((f) => filledTracks(strip(readFileSync(f, 'utf8'))));
    expect(all.length).toBeGreaterThanOrEqual(6);
  });

  it('pairs every one of them with the attribute', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const track of filledTracks(strip(readFileSync(file, 'utf8')))) {
        if (!track.includes('data-filled-track')) {
          missing.push(
            `${file.slice(here.length + 1)}: ${track.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('exercises the exception, so it cannot rot into a rule nobody re-checks', () => {
    // The Switch must still LOOK like a track — same class pair — or the
    // exception above describes something that no longer exists.
    const src = strip(readFileSync(join(here, 'components/ui/Switch.tsx'), 'utf8'));
    const looksLikeTrack = openingTags(src).filter(
      (tag) => /\bbg-ink\b/.test(tag) && /\bborder-ink\b/.test(tag),
    );
    expect(looksLikeTrack).toHaveLength(1);
    expect(looksLikeTrack.every(isControlItself)).toBe(true);
  });

  it('keeps the CSS half the attribute exists to select', () => {
    // The attribute is inert on its own. This is the rule it selects, and
    // without this assertion the markup half above can stay green while the
    // behaviour it guards is gone.
    const css = readFileSync(join(here, 'index.css'), 'utf8');
    expect(css).toContain('[data-filled-track] :focus-visible');
    expect(css).toMatch(
      /\[data-filled-track\] :focus-visible \{[^}]*outline-color:\s*var\(--color-page\)/,
    );
  });
});
