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

  // THE TRACK'S REGIONS MUST TILE WITH THE PILL'S BELOW THE BREAKPOINT, and this
  // is the one line that makes them. A 22px segment's `TAP_44` overlay reaches
  // 11px past its box and the pill's reaches 3.85, so the pair needs 14.85 of
  // clearance; the drawn 8 plus the track's 2 of padding gives 10, and measured
  // in the drawer the segment's region crossed a pixel into the pill's DRAWN box
  // and won the tap at `z-10`. A thumb aimed at the top of Settings flipped the
  // currency. 16 below `md` puts the clearance at 18. Above it `TAP_44` does not
  // apply and the drawn 8 stands, which is why the utility is `max-md:`.
  it('clears the currency track of the Settings pill below the breakpoint', () => {
    // The tint names two things — the active pill's arm inside `pillClass` and
    // this track — so the track is identified by its own radius as well.
    const track = linesWith(/\bbg-sb-item-active-bg\b/).filter((l) => /rounded-\[8px\]/.test(l));
    expect(track.length, 'the currency track is not one element').toBe(1);
    expect(track[0], 'the track kept the drawn 8 below the breakpoint, where 8 collides').toMatch(
      /max-md:mb-4\b/,
    );
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
