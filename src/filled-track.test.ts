import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PAIRING *Interaction rules* LEAVES UNGUARDED, made to fail instead. A filled segmented
// track is `bg-ink` and the focus ring resolves to `var(--color-ink)`, so a track without
// `data-filled-track` paints the ring on its own colour and keyboard focus disappears —
// which is what shipped on every one of these controls until the rule was added.
//
// THE ATTRIBUTE IS INVISIBLE IN A WAY THE FILL IS NOT. Someone adding a control copies the
// part they can see, `border border-ink bg-ink`, and nothing else fails: lint, typecheck,
// the suite and format:check all pass while the control has no visible focus.
//
// BOTH HALVES ARE PINNED HERE — the markup half is the attribute, the CSS half is the rule
// it selects. Nothing else in this repo reads a stylesheet, so deleting `[data-filled-track]`
// as apparently-unused markup would leave the whole suite green and put every one of these
// controls back to ink on ink.
//
// SOURCE TEXT, not a render: this repo runs vitest with `environment: 'node'` and carries no
// render-testing library.
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

/** Comments stripped, so example markup written in prose cannot satisfy or break the
 *  pairing — a comment drawing a `bg-ink`/`border-ink` tag reads as an unguarded track.
 *  QUOTE-EXACT AND LINE BY LINE, the half a regex cannot do: dropping only whole-line `//`
 *  comments leaves the trailing ones, and one apostrophe in prose then desynchronises every
 *  quote pair after it.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing comment drawing a `bg-ink`/`border-ink` tag in `Switch.tsx`
 *  leaves this green and turns the reader it replaces red — the comment reads as an unguarded
 *  track. */
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

/**
 * OPENING TAGS, BRACE-AWARE — AND A REGEX CANNOT DO THIS. A JSX opening tag does not end at
 * the first `>`: `onKeyDown={(e) => …}` and `className={n > 2 ? a : b}` both put one inside
 * the braces, so a `[^>]*?>` scan truncates such an element and drops it from BOTH
 * assertions — failing in the one direction a guard must not, since a new filled track with
 * a roving-focus handler would ship with no ring while the floor still passed on the rest.
 *
 * ANY element name: a track authored as `<fieldset>`, `<span>` or a wrapper component is a
 * filled track too. The signature is the class pair, not the tag.
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
 * A FILLED TRACK IS THE `bg-ink` + `border-ink` PAIR on one element. The border draws nothing
 * on a fill of its own colour — it is a 1px geometric spacer, part of *Shape system*'s
 * concentric gap — so the PAIR is what separates a track from any other use of the fill
 * token: matching on `bg-ink` alone reported a 2px target marker as an unguarded control.
 */
function filledTracks(source: string): string[] {
  return openingTags(source).filter(
    (tag) => /\bbg-ink\b/.test(tag) && /\bborder-ink\b/.test(tag) && !isControlItself(tag),
  );
}

/**
 * THE ONE EXCEPTION, AND A REAL DISTINCTION RATHER THAN A SUPPRESSION. `Switch.tsx` takes
 * `border-ink bg-ink` when checked, so it carries a track's signature — but a track's ring
 * lands on the FILL because the focused thing is a CHILD sitting on it, and `index.css`
 * SELECTS WITH A DESCENDANT COMBINATOR. The Switch has no focusable child, it IS the
 * control, so the same offset draws its ring OUTSIDE the element where ink reads at full
 * contrast, and adding the attribute here would change nothing.
 *
 * Named rather than silently dropped, and the test below fails if the Switch ever stops
 * matching — an exception nobody re-checks is how a guard quietly narrows.
 */
const isControlItself = (tag: string) => /<RadixSwitch\.Root\b/.test(tag);

describe('a filled segmented track carries data-filled-track', () => {
  const files = sourceFiles(here).filter((f) => !/\.test\.tsx?$/.test(f));

  it('finds the tracks at all, so an empty pass cannot look like a green one', () => {
    // A FLOOR, not an equality, and deliberately: another filled control must pass this and
    // be caught by the pairing test below instead. Only a vanished one fails here. THE
    // NUMBER MOVES WHEN A CONTROL GOES, never when the rule weakens — it was one higher
    // until the asset form's Fund/Bond segment was deleted outright.
    const all = files.flatMap((f) => filledTracks(stripTs(readFileSync(f, 'utf8'))));
    expect(
      all.length,
      'the filled tracks are disappearing from the walk — at zero every assertion below ' +
        'passes over nothing, which is what this floor exists to catch',
    ).toBeGreaterThanOrEqual(6);
  });

  it('pairs every one of them with the attribute', () => {
    const missing: string[] = [];
    for (const file of files) {
      for (const track of filledTracks(stripTs(readFileSync(file, 'utf8')))) {
        if (!track.includes('data-filled-track')) {
          missing.push(
            `${file.slice(here.length + 1)}: ${track.replace(/\s+/g, ' ').slice(0, 90)}`,
          );
        }
      }
    }
    expect(
      missing,
      'a filled track carries no `data-filled-track`, so its focus ring paints ink on ink',
    ).toEqual([]);
  });

  it('exercises the exception, so it cannot rot into a rule nobody re-checks', () => {
    const src = stripTs(readFileSync(join(here, 'components/ui/Switch.tsx'), 'utf8'));
    const looksLikeTrack = openingTags(src).filter(
      (tag) => /\bbg-ink\b/.test(tag) && /\bborder-ink\b/.test(tag),
    );
    expect(
      looksLikeTrack,
      'the Switch is no longer the one element wearing a track\u2019s class pair, so the ' +
        'exception above describes something that is not there — or is there twice',
    ).toHaveLength(1);
    expect(
      looksLikeTrack.every(isControlItself),
      'the class pair has moved off `RadixSwitch.Root` onto an inner element, which is the ' +
        'shape the exception does not cover',
    ).toBe(true);
  });

  it('keeps the CSS half the attribute exists to select', () => {
    const css = readFileSync(join(here, 'index.css'), 'utf8');
    expect(
      css,
      'the attribute is inert on its own — without this rule the markup half above stays ' +
        'green while the behaviour it guards is gone',
    ).toContain('[data-filled-track] :focus-visible');
    expect(css, 'the override no longer moves the ring off the fill').toMatch(
      /\[data-filled-track\] :focus-visible \{[^}]*outline-color:\s*var\(--color-page\)/,
    );
  });
});
