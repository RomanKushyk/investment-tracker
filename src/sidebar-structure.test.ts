import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PANEL IS FOUR BANDS, transcribed from `design/extensions/parchment-sidebar.dc.html`
// rather than derived, the way every guard in this directory transcribes its drawing.
//
// WHICH RECIPE THE ROW PAINTS, where `sidebar-plane.test.ts` reads what the grounds MEASURE
// — neither catches the other, since the tokens can be perfect while the track is still one
// segment short or the thumb still travels half a track.
//
// Paths resolve from THIS file, not from `process.cwd()`.
const here = dirname(fileURLToPath(import.meta.url));

/** LINE BY LINE, and the line boundary is the point: a regex literal may hold a quote, and
 *  one desync would switch stripping off for the rest of the file. Not cosmetic —
 *  `Sidebar.tsx` argues the band in prose, so an unstripped read lets a comment answer for
 *  the markup.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
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

const SIDEBAR = stripTs(readFileSync(join(here, 'app', 'Sidebar.tsx'), 'utf8'));

/** Every line carrying `re`, so a pin can say WHICH element wears a token and
 *  not merely that the file mentions it somewhere. */
const linesWith = (re: RegExp) => SIDEBAR.split('\n').filter((l) => re.test(l));

describe('the wall carries a footer band, and the tokens for it stop being idle', () => {
  // THE BAND IS IDENTIFIED BY ITS TOP RULE, NOT ITS FILL: the fill step off the wall
  // identifies nothing on its own, so the `sb-divider` along its top edge is what says a
  // band begins. Both go on one element, and asserting them together keeps the pair honest.
  it('paints one band on `sb-footer-bg`, ruled on `sb-divider` along its top', () => {
    const band = linesWith(/\bbg-sb-footer-bg\b/);
    expect(band.length, 'the footer band is not one element').toBe(1);
    expect(band[0], 'the band has no rule along its top edge').toMatch(/\bborder-t\b/);
    expect(band[0], "the band's top edge is not `sb-divider`").toMatch(/\bborder-sb-divider\b/);
  });

  // Bled to the SHELL's edges, not the panel's padding box, and concentric with the shell's
  // own radius minus its border — bottom-right only, the one corner the band meets.
  //
  // THE BLEED MUST CANCEL THE PADDING IT ACTUALLY HAS, AND THAT IS NOT A FLAT 16: both
  // shells write `max(16px, env(safe-area-inset-*))` on the sides a notch can reach, so a
  // `-mx-4` is right only while the inset is 0 and a notched phone in landscape leaves a
  // stripe of wall down the band's edge. The right side is 16 in both shells and stays `-mr-4`.
  it('bleeds the band by the padding it cancels, at the drawn radius 29', () => {
    const band = linesWith(/\bbg-sb-footer-bg\b/)[0] ?? '';
    expect(band, 'the band does not cancel the left inset').toMatch(
      /ml-\[calc\(-1\*max\(16px,env\(safe-area-inset-left\)\)\)\]/,
    );
    expect(band, 'the band does not cancel the bottom inset').toMatch(
      /mb-\[calc\(-1\*max\(16px,env\(safe-area-inset-bottom\)\)\)\]/,
    );
    expect(band, 'the band does not bleed to the right edge').toMatch(/-mr-4\b/);
    expect(band, 'the band is not concentric with the shell at 29').toMatch(/rounded-br-\[29px\]/);
  });

  // SPENT TWICE AND NO MORE: one rule between the two nav groups, one along the band's top
  // edge. A third means a rule appeared somewhere the drawing does not put one.
  it('spends `sb-divider` exactly twice — one group rule and the band', () => {
    expect(linesWith(/\bborder-sb-divider\b/).length, '`sb-divider` moved off its two sites').toBe(
      2,
    );
  });

  // A rule, not a drawing: `mark.test.ts` reads this file RAW and asserts the mark's `d=`,
  // `stroke*=` and `fill=` attributes as whole-file ORDERED LISTS, so an SVG line here would
  // fail the mark's pin rather than this one.
  it('draws the rule as a border, leaving the mark the only inline SVG', () => {
    expect((SIDEBAR.match(/<svg\b/g) ?? []).length, 'a second inline SVG entered the file').toBe(1);
  });

  // THE ROW'S REGIONS MUST TILE WITH THE PILL'S BELOW THE BREAKPOINT, and this is the one
  // line that makes them: the drawn gap does not clear the two `TAP_44` overlays, so the
  // segment's region crossed into the pill's DRAWN box and won the tap at `z-10` — a thumb
  // aimed at the top of Settings flipped the currency. Above the breakpoint `TAP_44` does not
  // apply and the drawn gap stands, which is why the utility is `max-md:`.
  //
  // ON THE ROW, NOT ON A TRACK: the two tracks sit side by side and the margin belongs to
  // what holds them. Asserted as "no track carries one" as well, or the pair drifts back to
  // a margin each and reads the same.
  it('clears the two tracks of the Settings pill below the breakpoint', () => {
    // The tint names three things — the active pill's arm and both tracks — so a track is
    // identified by its radius too.
    const tracks = linesWith(/\bbg-sb-item-active-bg\b/).filter((l) => /rounded-\[8px\]/.test(l));
    expect(tracks.length, 'the footer band is not carrying two tracks').toBe(2);
    for (const track of tracks) {
      expect(track, 'a track took the row\u2019s own bottom margin').not.toMatch(/\bmb-\d/);
    }
    const row = linesWith(/max-md:mb-4\b/);
    expect(row.length, 'the clearance is not on one element').toBe(1);
    expect(row[0], 'the clearance left the row that holds the two tracks').toMatch(
      /\bflex\b[\s\S]*\bgap-2\b/,
    );
  });
});

// Three glyph segments on a track with no edge, on the active route's own tint, beside the
// currency track at `flex:1` each — one object at two widths.
describe('the footer band carries two tracks on one row, and the theme one is a radiogroup', () => {
  it('draws the theme track as three radios inside a radiogroup', () => {
    expect(SIDEBAR, 'the theme track is not a radiogroup').toMatch(/role="radiogroup"/);
    expect(
      (SIDEBAR.match(/role="radio"/g) ?? []).length,
      'the theme track is not three segments',
    ).toBe(1);
    // One `role="radio"` in the source, three at run time: the segments are mapped off
    // `THEME_ORDER`, and `theme.test.ts` holds that half.
    expect(SIDEBAR, 'the segments are not mapped off the store\u2019s order').toMatch(
      /THEME_ORDER\.map\(/,
    );
    expect(SIDEBAR, 'a segment does not announce its stored value').toMatch(/aria-checked=/);
  });

  // The refusal `index.css` argues at its `[data-filled-track]` rule: that attribute repaints
  // the ring for a track painted in the plane's FOREGROUND, and a tint is not one.
  it('gives neither track `data-filled-track`', () => {
    expect(SIDEBAR, 'a tinted track took the filled track\u2019s ring').not.toMatch(
      /data-filled-track/,
    );
  });

  // The sheet's widths are the panel's, where `TAP_44` is inert. In the DRAWER the segments
  // shrink until two overlays hand each other taps, and a real 44 box is the fix
  // `tap-target.ts` names when a gap cannot be made.
  //
  // TIED TO THE DRAWN HEIGHT, NOT COUNTED: the theme track's three segments are ONE MAPPED
  // LINE, so counting lines gives three where the row draws five. What has to hold is that
  // nothing wearing the segment's drawn height is missing the width.
  it('gives every segment 44 of width below the breakpoint', () => {
    const segments = linesWith(/\bh-\[22px\]/);
    expect(segments.length, 'the 22px segment recipe is gone from the row').toBe(3);
    for (const segment of segments) {
      expect(segment, 'a segment keeps an overlay it is too narrow for').toMatch(
        /max-md:min-w-11\b/,
      );
      expect(segment, 'a segment lost the overlay the width is sized for').toMatch(/TAP_44/);
    }
  });

  // THE FIT IS EXACT, NOT ROOMY — the drawn 44 boxes plus their gaps come to the width the
  // band measures, with nothing spare. A left safe-area inset takes that width down, which
  // is reachable in landscape below the breakpoint, and a row that overflowed would be
  // CLIPPED by the drawer's `overflow-hidden`. It wraps instead, and the gap below is what
  // two stacked tracks need between them.
  it('wraps rather than clipping where the band gives less than 239', () => {
    const row = linesWith(/max-md:mb-4\b/)[0] ?? '';
    expect(row, 'the row cannot wrap, so a narrower band clips it').toMatch(/max-md:flex-wrap\b/);
    expect(row, 'a wrapped row has no clearance between its two lines').toMatch(
      /max-md:gap-y-\[22px\]/,
    );
  });

  // THE THUMB'S GEOMETRY IS THE TRACK'S OWN, re-derived for three rather than copied from
  // two: a thumb is absolutely positioned, so its percentages resolve against the track's
  // PADDING box and the padding and gap come out of every segment.
  it('re-derives the sliding thumb for three segments', () => {
    expect(SIDEBAR, 'the three-segment thumb is not a third of its track').toMatch(
      /w-\[calc\(\(100%-6px\)\/3\)\]/,
    );
    expect(SIDEBAR, 'the three-segment thumb does not travel a segment plus the gap').toMatch(
      /\$\{index\} \* \(100% \+ 1px\)/,
    );
    expect(
      (SIDEBAR.match(/data-owns-motion/g) ?? []).length,
      'a thumb that moves through a theme flip lost its opt-out',
    ).toBe(2);
  });
});

describe('Settings leaves the scrolling band, and its caption goes with it', () => {
  it('renders the Settings link after the `Scroller` closes', () => {
    const close = SIDEBAR.indexOf('</Scroller>');
    expect(close, 'the nav band no longer goes through `Scroller`').toBeGreaterThan(-1);
    const settings = SIDEBAR.indexOf('to="/settings"');
    expect(settings, 'the Settings link is gone').toBeGreaterThan(-1);
    expect(settings, 'Settings is still inside the scrolling band').toBeGreaterThan(close);
  });

  // Settings leaves the scrolling band, so the third group header goes with it: one item
  // needs no caption.
  it('leaves two nav groups, so two captions', () => {
    expect(linesWith(/<NavGroup\b/).length, 'the nav no longer has exactly two groups').toBe(2);
    expect(SIDEBAR, 'the Settings group caption survived its group').not.toMatch(/groupSettings/);
  });

  // The version sits INSIDE the band, under Settings: outside it, it would read on the wall
  // and the band would end at a link.
  it('keeps the version inside the band, under Settings', () => {
    const band = SIDEBAR.indexOf('bg-sb-footer-bg');
    expect(band, 'the footer band is gone').toBeGreaterThan(-1);
    expect(SIDEBAR.indexOf('__APP_VERSION__'), 'the version left the band').toBeGreaterThan(band);
  });
});

describe('the group caption is the sheet its own size, and no longer shouts', () => {
  // Sentence case, against the uppercase it replaces. Still small text, so `sb-label`'s
  // recorded shortfall stands and is not repaired here.
  it('sets the caption at 11px on the drawn tracking', () => {
    const header = linesWith(/\btext-sb-label\b/).filter((l) => /h-\[18px\]/.test(l));
    expect(header.length, 'the group caption row is gone').toBe(1);
    expect(header[0], 'the caption is not 11px').toMatch(/text-\[11px\]/);
    expect(header[0], 'the caption kept the shipped .12em tracking').toMatch(/tracking-\[\.02em\]/);
    expect(header[0], 'the caption still shouts').not.toMatch(/\buppercase\b/);
  });
});

describe('the head carries the capital as a strip, and the blob is gone', () => {
  // Bled, `sb-field`, NO radius and NO edge: the sheet refuses the edge on the instruction
  // that this is a strip, and *Shape system* licenses the corners — a full-bleed band takes
  // square ones.
  it('re-planes the capital as a bled 56px `sb-field` strip with no corner', () => {
    const band = linesWith(/\bbg-sb-field\b/);
    expect(band.length, 'the capital strip is not the file one `sb-field` box').toBe(1);
    expect(band[0], 'the strip is not 56 tall').toMatch(/\bh-14\b/);
    expect(band[0], 'the strip does not cancel the left inset').toMatch(
      /ml-\[calc\(-1\*max\(16px,env\(safe-area-inset-left\)\)\)\]/,
    );
    expect(band[0], 'the strip does not bleed to the right edge').toMatch(/-mr-4\b/);
    expect(band[0], 'the strip took a radius the drawing refuses').not.toMatch(/rounded/);
    expect(band[0], 'the strip took an edge the drawing refuses').not.toMatch(/\bborder\b/);
  });

  // The decor blob identified nothing against the wall and sat under the band anyway, so it
  // was deleted outright rather than redrawn — neither the component nor its two call sites
  // survive, and the shape invariant lost it as an exception.
  it('deletes `SidebarDecor` and both call sites', () => {
    expect(SIDEBAR, '`SidebarDecor` is still in the file').not.toMatch(/SidebarDecor/);
  });
});
