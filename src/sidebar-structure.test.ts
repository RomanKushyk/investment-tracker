import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PANEL IS FOUR BANDS AND TWO OF ITS TOKENS HAD NO CONSUMER UNTIL NOW.
//
// `design/extensions/parchment-sidebar.dc.html` is #106's drawing and `:1201` is
// its work order for this issue: an 11 px sentence-case header, one `sb-divider`
// rule between the groups, Settings out of the scrolling band and into a
// `sb-footer-bg` band bled to the shell's edge at radius 29 with the version
// under it, the capital card re-planed as a bled 56 px `sb-field` strip, and
// `SidebarDecor` deleted. This transcribes those values rather than deriving
// them, the way every guard in this directory transcribes its drawing.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the suite down with ENOENT the moment vitest is given a different root.
const here = dirname(fileURLToPath(import.meta.url));

/** TS comments out, LINE BY LINE, and the line boundary is the point: a regex
 *  literal may hold a quote, and one desync would switch stripping off for the
 *  rest of the file. Copied from `sidebar-plane.test.ts` SIGNATURE AND ALL,
 *  which is the house idiom — the guards here each carry their own copy. Not
 *  cosmetic here either: `Sidebar.tsx` argues the band and the deleted blob in
 *  prose, so an unstripped read would let a comment answer for the markup. */
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
  // `sb-footer-bg` is one band, not a plane — `:1123` reads its fill step at
  // 1.08 / 1.05 against the wall, which identifies nothing on its own, so the
  // `sb-divider` rule along its top edge is what says a band begins. Both go on
  // one element, and asserting them together is what keeps the pair honest.
  it('paints one band on `sb-footer-bg`, ruled on `sb-divider` along its top', () => {
    const band = linesWith(/\bbg-sb-footer-bg\b/);
    expect(band.length, 'the footer band is not one element').toBe(1);
    expect(band[0], 'the band has no rule along its top edge').toMatch(/\bborder-t\b/);
    expect(band[0], "the band's top edge is not `sb-divider`").toMatch(/\bborder-sb-divider\b/);
  });

  // Bled to the SHELL's edges, not the panel's padding box, and concentric with
  // the shell's own 30 minus its 1 px border — `:913`, bottom-right only,
  // because that is the only corner the band meets.
  //
  // THE BLEED MUST CANCEL THE PADDING IT ACTUALLY HAS, and that padding is not a
  // flat 16: both shells write `max(16px, env(safe-area-inset-*))` on the sides a
  // notch can reach. A `-mx-4` here is right only while the inset is 0, and on a
  // notched phone in landscape it left a stripe of wall down the band's edge. The
  // two sides that can grow take the same expression; the right is 16 in both
  // shells and stays `-mr-4`.
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

  // SPENT TWICE AND NO MORE — T10: "`sb-divider` — spent — between groups, and
  // along the band's top edge." One rule separates the two nav groups; the
  // second is the band's. A third would mean a rule appeared somewhere the
  // drawing does not put one.
  it('spends `sb-divider` exactly twice — one group rule and the band', () => {
    expect(linesWith(/\bborder-sb-divider\b/).length, '`sb-divider` moved off its two sites').toBe(
      2,
    );
  });

  // A rule, not a drawing. `mark.test.ts` reads this file RAW and asserts the
  // mark's `d=`, `stroke*=` and `fill=` attributes as whole-file ordered lists,
  // so an SVG line here would fail the mark's pin rather than this one.
  it('draws the rule as a border, leaving the mark the only inline SVG', () => {
    expect((SIDEBAR.match(/<svg\b/g) ?? []).length, 'a second inline SVG entered the file').toBe(1);
  });

  // THE ROW'S REGIONS MUST TILE WITH THE PILL'S BELOW THE BREAKPOINT, and this
  // is the one line that makes them. A 22px segment's `TAP_44` overlay reaches
  // 11px past its box and the pill's reaches 3.85, so the pair needs 14.85 of
  // clearance; the drawn 8 plus the track's 2 of padding gives 10, and measured
  // in the drawer the segment's region crossed a pixel into the pill's DRAWN box
  // and won the tap at `z-10`. A thumb aimed at the top of Settings flipped the
  // currency. 16 below `md` puts the clearance at 18. Above it `TAP_44` does not
  // apply and the drawn 8 stands, which is why the utility is `max-md:`.
  //
  // ON THE ROW, NOT ON A TRACK, since #85: the two tracks sit side by side and
  // the margin belongs to what holds them. Asserted as "no track carries one" as
  // well, or the pair could drift back to a margin each and read the same.
  it('clears the two tracks of the Settings pill below the breakpoint', () => {
    // The tint names three things now — the active pill's arm inside
    // `pillClass` and both tracks — so a track is identified by its radius too.
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

// #85's control, and the drawing is `parchment-sidebar.dc.html` T5 (`:754-892`)
// with its work order at `:1203`: three 22px glyph segments at radius 6 on a
// track at radius 8, no edge, on the active route's own tint, beside the
// currency track at `flex:1` each — "one object at two widths".
//
// MARKUP, NOT COLOUR. `sidebar-plane.test.ts` reads what the two grounds
// measure; this reads which recipe the row actually paints, and neither catches
// the other — the tokens can be perfect while the track is still one segment
// short or the thumb still travels half a track.
describe('the footer band carries two tracks on one row, and the theme one is a radiogroup', () => {
  it('draws the theme track as three radios inside a radiogroup', () => {
    expect(SIDEBAR, 'the theme track is not a radiogroup').toMatch(/role="radiogroup"/);
    expect(
      (SIDEBAR.match(/role="radio"/g) ?? []).length,
      'the theme track is not three segments',
    ).toBe(1);
    // One `role="radio"` in the source, three at run time: the segments are
    // mapped off `THEME_ORDER`, which is the store's own list and the same one
    // the Appearance card walks. `theme.test.ts` holds that half.
    expect(SIDEBAR, 'the segments are not mapped off the store\u2019s order').toMatch(
      /THEME_ORDER\.map\(/,
    );
    expect(SIDEBAR, 'a segment does not announce its stored value').toMatch(/aria-checked=/);
  });

  // The refusal `index.css` argues at its `[data-filled-track]` rule: that
  // attribute repaints the ring for a track painted in the plane's FOREGROUND,
  // and a 12% tint is not one. Both tracks are served by the base accent ring.
  it('gives neither track `data-filled-track`', () => {
    expect(SIDEBAR, 'a tinted track took the filled track\u2019s ring').not.toMatch(
      /data-filled-track/,
    );
  });

  // T5 hands the tap arithmetic to this issue (its F-2) and the sheet's own
  // widths are the 244px panel's, where `TAP_44` is inert. Below the breakpoint
  // the shell is the 280px drawer and the band gives the row 240 — the sheet
  // reads 248, which is the PANEL's content width before the band cancels its
  // 16 of padding and pays 20 of its own. There the three theme segments would
  // be ~36.7 wide and two `TAP_44` overlays that both reach 3.65 past a 1px gap
  // hand each other taps. 44 drawn is the fix `tap-target.ts` names when a gap
  // cannot be made: 3 x 44 + 2 + 4 = 138 and 2 x 44 + 1 + 4 = 93, plus the drawn
  // 8, is 239 against the 239 the band measures there — flex cannot shrink under
  // its content minimum, so it fits, and exactly.
  // TIED TO THE RECIPE, NOT COUNTED: the theme track's three segments are one
  // mapped line, so a count of lines is three where the row draws five. What has
  // to hold is that nothing wearing the segment's drawn height is missing the
  // width — the height is the signature of the thing `TAP_44` overlays here.
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

  // An EXACT fit is not a fit with room: a left safe-area inset takes the band's
  // 239 down, which is reachable in landscape below the breakpoint, and a row
  // that overflowed would be CLIPPED by the drawer's `overflow-hidden`. It wraps
  // instead — measured at a 250px drawer, two full-width lines and no clipping —
  // and 22 is what two stacked 22px tracks need between them.
  it('wraps rather than clipping where the band gives less than 239', () => {
    const row = linesWith(/max-md:mb-4\b/)[0] ?? '';
    expect(row, 'the row cannot wrap, so a narrower band clips it').toMatch(/max-md:flex-wrap\b/);
    expect(row, 'a wrapped row has no clearance between its two lines').toMatch(
      /max-md:gap-y-\[22px\]/,
    );
  });

  // THE THUMB'S GEOMETRY IS THE TRACK'S OWN, re-derived for three rather than
  // copied from two. A thumb is absolutely positioned, so its percentages
  // resolve against the track's PADDING box: with p-0.5 (2) and gap-px (1) a
  // segment is (T - 4 - 2) / 3, i.e. 33.333% - 2px, and one step is that width
  // plus the gap. The two-segment track's 50% - 2.5px is the same derivation.
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

  // `:259-262`: "Settings leaves the scrolling band, so the third group header
  // goes with it: one item needs no caption." Two groups, so two headers.
  it('leaves two nav groups, so two captions', () => {
    expect(linesWith(/<NavGroup\b/).length, 'the nav no longer has exactly two groups').toBe(2);
    expect(SIDEBAR, 'the Settings group caption survived its group').not.toMatch(/groupSettings/);
  });

  // The version sits INSIDE the band, under Settings — `.ver` at `:77`. Outside
  // it, it would read on the wall and the band would end at a link.
  it('keeps the version inside the band, under Settings', () => {
    const band = SIDEBAR.indexOf('bg-sb-footer-bg');
    expect(band, 'the footer band is gone').toBeGreaterThan(-1);
    expect(SIDEBAR.indexOf('__APP_VERSION__'), 'the version left the band').toBeGreaterThan(band);
  });
});

describe('the group caption is the sheet its own size, and no longer shouts', () => {
  // 11 px sentence case at `.02em` (`.grp`, `:63`), against the shipped 10 px
  // uppercase at `.12em`. `:1081` records that eleven pixels is still small
  // text, so `sb-label`'s 3.09 / 4.33 shortfall stands and is not repaired here.
  it('sets the caption at 11px on the drawn tracking', () => {
    const header = linesWith(/\btext-sb-label\b/).filter((l) => /h-\[18px\]/.test(l));
    expect(header.length, 'the group caption row is gone').toBe(1);
    expect(header[0], 'the caption is not 11px').toMatch(/text-\[11px\]/);
    expect(header[0], 'the caption kept the shipped .12em tracking').toMatch(/tracking-\[\.02em\]/);
    expect(header[0], 'the caption still shouts').not.toMatch(/\buppercase\b/);
  });
});

describe('the head carries the capital as a strip, and the blob is gone', () => {
  // `.capband` `:55` — 56 tall, bled, `sb-field`, NO radius and NO edge. `:634`
  // reads the fill step at 1.12 / 1.07 and refuses the edge on the instruction
  // that this is a strip; `Shape system` licenses it — "a full-bleed bar takes
  // square corners".
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

  // `:743-751` — the 200px blob reads 1.09 / 1.04 against the wall, identifies
  // nothing, and now sits under the band anyway. #107 deletes it outright
  // rather than redrawing it, so neither the component nor its two call sites
  // survive. `CLAUDE.md`'s shape invariant loses it as an exception in the same
  // commit.
  it('deletes `SidebarDecor` and both call sites', () => {
    expect(SIDEBAR, '`SidebarDecor` is still in the file').not.toMatch(/SidebarDecor/);
  });
});
