import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { stripCss } from './__fixtures__/palette';

// THE THIRD GEOMETRY. *Two shells, one breakpoint* once refused one, about the MOBILE job,
// and now prescribes this rail as a DESKTOP one: navigation a press away while the rest of
// the width goes back to the content. What that section still rejects is a rail that only
// HIDES. This file holds what the rail draws, not why.
//
// A SEPARATE FILE ON PURPOSE: `sidebar-structure.test.ts` and `nav-glyphs.test.ts` COUNT
// things across `app/Sidebar.tsx` — two `hairline` rules, one `<Icon>` tag, eleven
// route/glyph pairs — and the rail draws a second of each. Its own module is
// what keeps those counts saying what they were written to say.
const here = dirname(fileURLToPath(import.meta.url));

/** Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled. */
function stripTs(source: string, file: string): string {
  const sf = ts.createSourceFile(
    file,
    source,
    // Parsed JSDoc puts a comment's own tokens in the walk: a `//` inside a JSDoc type is then
    // cut on its own, and the rest of the block is left.
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true,
  );
  // Not in the public typings; typescript-estree reads the same field and throws on it too.
  const [error] = (sf as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics;
  if (error) {
    const why = ts.flattenDiagnosticMessageText(error.messageText, ' ');
    throw new Error(`${file} does not parse: ${why}`);
  }
  const cuts: [number, number][] = [];
  // Returns nothing: a truthy return stops TypeScript's iteration.
  const cut = (pos: number, end: number) => {
    cuts.push([pos, end]);
  };
  // Every comment is trivia before some token; JSX text is a token, never trivia.
  const visit = (node: ts.Node): void => {
    if (!ts.isTokenKind(node.kind)) return node.getChildren(sf).forEach(visit);
    if (node.kind === ts.SyntaxKind.JsxText) return;
    ts.forEachTrailingCommentRange(source, node.pos, cut);
    ts.forEachLeadingCommentRange(source, node.pos, cut);
  };
  visit(sf);
  let out = '';
  let at = 0;
  for (const [pos, end] of cuts) {
    // At position 0 the leading scan starts collecting at once and repeats the trailing scan.
    if (pos < at) continue;
    out += source.slice(at, pos) + source.slice(pos, end).replace(/[^\r\n\u2028\u2029]/g, '');
    at = end;
  }
  return out + source.slice(at);
}

const RAIL_PATH = join(here, 'app', 'SidebarRail.tsx');
/** Read defensively so the FIRST failure is "the rail is not written yet" rather than an
 *  ENOENT that collapses the suite before any of it runs. */
const RAIL = existsSync(RAIL_PATH) ? stripTs(readFileSync(RAIL_PATH, 'utf8'), RAIL_PATH) : '';
const SIDEBAR = stripTs(readFileSync(join(here, 'app', 'Sidebar.tsx'), 'utf8'), 'Sidebar.tsx');
const HEADER = stripTs(readFileSync(join(here, 'app', 'AppHeader.tsx'), 'utf8'), 'AppHeader.tsx');
const BADGE = stripTs(
  readFileSync(join(here, 'app', 'CornerBadge.tsx'), 'utf8'),
  'CornerBadge.tsx',
);
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');

const railLines = (re: RegExp) => RAIL.split('\n').filter((l) => re.test(l));

/** A module constant's class string, read whole. */
function constant(src: string, name: string): string {
  const value = src.match(new RegExp(`const ${name} =\\s*'([^']*)'`))?.[1];
  expect(value, `\`${name}\` is not declared`).toBeDefined();
  return value!;
}

/** The route-to-glyph table — the same thirteen `nav-glyphs.test.ts` holds for the
 *  expanded panel, so both files are pinned against one table and neither drifts alone. */
const TABLE = [
  ['/', 'CalendarDays'],
  ['/transactions', 'ArrowDownUp'],
  ['/overview', 'LayoutGrid'],
  ['/balances', 'Wallet'],
  ['/payouts', 'CircleDollarSign'],
  ['/yield', 'ChartLine'],
  ['/attributes', 'Tags'],
  ['/seasonality', 'CalendarRange'],
  ['/portfolio', 'Table'],
  ['/allocation', 'ChartPie'],
  ['/settings', 'Settings'],
  ['/profile', 'CircleUser'],
  ['/admin/archive', 'Archive'],
] as const;

describe('the collapsed shell is a rail, not a masked panel', () => {
  it('is its own module', () => {
    expect(existsSync(RAIL_PATH), '`src/app/SidebarRail.tsx` is not written yet').toBe(true);
  });

  // The width still animates: the aside is the card's inset plus the card in either state, so one
  // tween moves both (rail-and-account-foot.md § Wave 29; shell.md § Signed).
  it('collapses the shell to the 64 card and its 8 inset', () => {
    // The `<aside>`'s own tag, read whole: the formatter breaks the branch across lines.
    const at = SIDEBAR.indexOf('<aside');
    expect(at, 'the shell is gone').toBeGreaterThan(-1);
    const shell = SIDEBAR.slice(at, SIDEBAR.indexOf('>', at));
    const branch = shell.match(/collapsed\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
    expect(branch, 'the shell no longer branches on `collapsed`').not.toBeNull();
    const [, rail, panel] = branch!;
    // The INSET PLUS 64, never 64 with the inset taken out of it: a 64px card has no room to give,
    // and a notched phone in landscape is wide enough to BE this shell.
    expect(rail, 'the collapsed shell is not the 8 inset plus the 64 card').toBe(
      'w-[calc(max(8px,env(safe-area-inset-left))+64px)]',
    );
    expect(panel, 'the expanded shell is not the inset plus 260').toBe(
      'w-[calc(max(16px,env(safe-area-inset-left))+260px)]',
    );
  });

  // ONE CARD IN BOTH STATES (§ Wave 29, B at r22, and M2): the rail floats as the panel does, on the
  // panel's full glass with no band and no hairline, and every term of its geometry tweens, so
  // the card morphs rather than swapping.
  it('floats one glass card, which the tween morphs between the rail and the panel', () => {
    const rail = constant(SIDEBAR, 'CARD_RAIL').split(' ');
    for (const term of [
      'mt-[max(8px,env(safe-area-inset-top))]',
      'ml-[max(8px,env(safe-area-inset-left))]',
      'h-[calc(100dvh-max(8px,env(safe-area-inset-top))-max(8px,env(safe-area-inset-bottom)))]',
      'w-16',
      'rounded-[22px]',
    ]) {
      expect(rail, `the rail's card is not ${term}`).toContain(term);
    }
    const cards = SIDEBAR.split('\n').filter((l) =>
      /\$\{collapsed \? CARD_RAIL : CARD_PANEL\}/.test(l),
    );
    expect(cards.length, 'the two states are not one card').toBe(1);
    const card = cards[0]!;
    expect(card, 'the card is not on the glass').toMatch(/(?<![-\w[])glass(?![-\w])/);
    expect(card, 'the band is back').not.toMatch(/\bglass-band\b/);
    // The tween's own property list names `border-radius`, which is no edge.
    const drawn = `${card.replace(/transition-\[[^\]]*\]/, '')} ${rail.join(' ')}`;
    expect(drawn, 'the card draws a hairline').not.toMatch(/\bborder\b|\bborder-/);
    expect(card, 'the card does not tween its geometry').toMatch(
      /\btransition-\[margin,width,height,border-radius\] duration-\[260ms\] ease-soft\b/,
    );
    expect(card, 'the card does not clip the contents it is leaving').toMatch(
      /\boverflow-hidden\b/,
    );
  });

  // LAID OUT AT THE STATE'S OWN WIDTH, never the card's: the card eases between two widths, so
  // contents that followed it would re-flow sideways for the length of the tween.
  it("lays each state's contents out at its own width", () => {
    expect(constant(SIDEBAR, 'CONTENTS_RAIL').split(' ')).toContain('w-16');
    expect(constant(SIDEBAR, 'CONTENTS_PANEL').split(' ')).toContain('w-[260px]');
    expect(SIDEBAR, 'the contents follow the animating card').not.toMatch(
      /CONTENTS_(?:RAIL|PANEL) =\s*'[^']*\bw-full\b/,
    );
  });

  // § Wave 29, M2, at #799's split of `ease-soft` at 45 % of its progress: the leaving contents fade
  // over its first 30 ms, the arriving over the remaining 230, each on its half of the curve.
  it('cross-fades the contents at 45 % of the tween', () => {
    const leave = constant(SIDEBAR, 'LEAVE').split(' ');
    for (const term of [
      'animate-out',
      'fade-out',
      'duration-30',
      'ease-[cubic-bezier(.3461,.4015,.6695,.7305)]',
      'fill-mode-forwards',
    ]) {
      expect(leave, `the leaving contents are not ${term}`).toContain(term);
    }
    const arrive = constant(SIDEBAR, 'ARRIVE').split(' ');
    for (const term of [
      'animate-in',
      'fade-in',
      'duration-230',
      'delay-30',
      'ease-[cubic-bezier(.1944,1,.4076,1)]',
      'fill-mode-backwards',
      // The kill-switch zeroes durations, not delays: reduced motion is instant only without it.
      'motion-reduce:delay-0',
    ]) {
      expect(arrive, `the arriving contents are not ${term}`).toContain(term);
    }
    expect(SIDEBAR, 'the leaving contents are not held for the tween').toMatch(
      /const MORPH_MS = 260;/,
    );
  });

  // A rail on screen is meant to be reached: `inert` existed to stop a 0-width box holding
  // eleven focusable links, and there is no such box any more. SCOPED TO THE SHELL, because
  // `NavGroup`'s fold keeps its own `inert` and should — a collapsed GROUP really is clipped
  // paint over live links, and a file-wide ban would delete that fix.
  it('leaves no `inert` on a shell the user can see', () => {
    const at = SIDEBAR.indexOf('<aside');
    expect(at, 'the shell is gone').toBeGreaterThan(-1);
    const shell = SIDEBAR.slice(at, SIDEBAR.indexOf('>', at));
    expect(shell, 'the shell is still inert while collapsed').not.toMatch(/inert/);
  });
});

describe('the rail, as drawn', () => {
  // ATTACHED, not merely imported. The eight shared routes reach the rail only through
  // `ANALYTICS.map`, so THAT is what is asserted — accepting the mere word `ANALYTICS`, which
  // the import line satisfies, left eight of eleven cases green when the map was deleted.
  it('renders the eight shared routes from the table it imports', () => {
    expect(RAIL, 'the rail no longer imports the shared table').toMatch(
      /import \{[^}]*\bANALYTICS\b[^}]*\} from '\.\/Sidebar'/,
    );
    expect(RAIL, 'the rail no longer renders the shared table').toMatch(
      /ANALYTICS\.map\(\s*\(\{[^}]*\bIcon\b[^}]*\}\)\s*=>/,
    );
  });

  const INLINE = ['/', '/transactions', '/settings', '/profile', '/admin/archive'];
  it.each(TABLE.filter(([r]) => INLINE.includes(r)))(
    'names %s and its glyph itself',
    (route, icon) => {
      const pair = new RegExp(
        `'${route}'[^\\n]*\\b${icon}\\b|\\b${icon}\\b[^\\n]*'${route}'|` +
          `to="${route}"[\\s\\S]{0,300}?\\b${icon}\\b`,
      );
      expect(pair.test(RAIL), `${route} does not reach the rail`).toBe(true);
    },
  );

  it.each(TABLE.filter(([r]) => !INLINE.includes(r)))(
    'keeps %s in the shared table',
    (route, icon) => {
      const pair = new RegExp(`'${route}'[^\\n]*\\b${icon}\\b`);
      expect(pair.test(SIDEBAR), `${route} left the shared table`).toBe(true);
    },
  );

  // THE LINK'S `className` MUST BE A STRING, and this is the only pin that can see it.
  // `Tooltip` wraps each item in a Radix `Trigger asChild`, whose `Slot` merges props by
  // JOINING className strings — handed `NavLink`'s function form it STRINGIFIES THE
  // CALLBACK, so the attribute becomes `function _temp(t0) { … }` and the active tint and
  // indicator are gone while the source still reads correctly. The state rides the children
  // function instead, which `Slot` does not touch.
  it('keeps the link `className` a string, which the tooltip Slot can merge', () => {
    const at = RAIL.indexOf('<NavLink');
    expect(at, 'the rail no longer renders a `NavLink`').toBeGreaterThan(-1);
    const tag = RAIL.slice(at, RAIL.indexOf('>', at));
    expect(tag, 'the link takes a className CALLBACK, which `asChild` stringifies').not.toMatch(
      /className=\{\s*\(/,
    );
    expect(tag, 'the link has no className').toMatch(/className="/);
  });

  // A glyph that stands alone can afford the larger size and needs it, the label being gone.
  it('draws its glyphs at the drawn 20', () => {
    const tags = RAIL.match(/<Icon\b[\s\S]*?\/>/g) ?? [];
    expect(tags.length, 'the rail does not draw its glyphs through one tag').toBe(1);
    expect(tags[0], 'the rail glyph is not 20px').toMatch(/size=\{20\}/);
    expect(tags[0], 'the rail glyph is not `aria-hidden`').toMatch(
      /aria-hidden(?!\s*=\s*\{?["']?false)/,
    );
  });

  // O3 (rail-and-account-foot.md § Signed): 44 × 44 at r12, the hit areas touching.
  it('sizes its items 44 x 44 at r12', () => {
    const radius = railLines(/rounded-\[12px\]/);
    // FIVE SITES: the box that paints an item, and the route link, the sign-out button and the
    // sign-in link that ring it — one box shared, so the focusables cannot draw it three ways —
    // and the menu, an item of its own.
    expect(
      radius.length,
      'the item radius is not on exactly the box, the two links, the button and the menu',
    ).toBe(5);
    const boxes = radius.filter((l) => /\bsize-11\b/.test(l));
    expect(boxes.length, 'the item box and the menu are not both 44 × 44').toBe(2);
    expect(RAIL, 'an item still draws at the old 40 × 36').not.toMatch(/h-\[36px\]/);
  });

  // THE RING FOLLOWS THE FOCUSABLE ELEMENT, the link and not the box inside it: an outline
  // follows `border-radius`, so a link without one draws a square ring around a rounded
  // item — visible only while tabbing, the traversal least likely to be looked at.
  it('rings the item on its own radius', () => {
    const link = railLines(/<NavLink\b/);
    expect(link.length, 'the rail no longer renders one `NavLink`').toBe(1);
    expect(link[0], 'the link carries no radius, so its focus ring is square').toMatch(
      /rounded-\[12px\]/,
    );
  });

  // Said as the panel's row says it: the tint and the inset indicator, the glyph `accent`.
  it('draws the active item as the row draws it', () => {
    const at = RAIL.indexOf('function RailBox');
    const box = RAIL.slice(at, RAIL.indexOf('</span>', at));
    expect(box, 'the active fill is not the tint').toMatch(
      /isActive\s*\?\s*'bg-accent-tint shadow-\[inset_2px_0_0_var\(--color-sb-indicator\)\]'/,
    );
    expect(box, 'the active glyph is not `accent`').toMatch(/isActive \? 'text-accent' :/);
    expect(box, 'the old wall tint is back').not.toMatch(/sb-item-active-bg|sb-icon-active/);
  });

  // A 40px COLUMN CANNOT RESERVE THE BAR. Every other Scroller pushes content off it; here
  // that leaves too little for the item and the band overflows on a short window. `overlay`
  // floats it instead, which this item can afford because its ink is one centred glyph.
  it('floats the scroll bar rather than reserving a strip it has no room for', () => {
    const band = railLines(/<Scroller\b/);
    expect(band.length, 'the rail band is no longer one `Scroller`').toBe(1);
    expect(band[0], 'the rail reserves the bar a strip 40px cannot spare').toMatch(/\boverlay\b/);
  });

  // O3: one 28 × 1 hairline between the two groups, 2 px clear above and below.
  it('rules the groups apart with one 28 x 1 hairline', () => {
    const rule = railLines(/\bborder-hairline\b/);
    expect(rule.length, 'the rail draws more or less than its one group rule').toBe(1);
    expect(rule[0], 'the rule is not 28 wide').toMatch(/\bw-7\b/);
    expect(rule[0], 'the rule is not 2 px clear').toMatch(/\bmy-\[2px\]/);
    expect(rule[0], 'the rule is not a 1 px top border').toMatch(/\bborder-t\b/);
  });

  // ONE SURFACE: the wall's band, rule and field rank leave the rail with the wall — the
  // capital and the version are refused by arithmetic rather than taste: neither fits the width.
  it('carries no foot band and no wall token, and neither the capital nor the version', () => {
    expect(RAIL, 'the rail still paints a wall token').not.toMatch(
      /\bsb-(?:bg|field|footer-bg|divider|item-active-bg)\b/,
    );
    expect(RAIL, 'the version followed the rail, and it does not fit').not.toMatch(
      /__APP_VERSION__/,
    );
    expect(RAIL, 'the capital followed the rail; the header carries it').not.toMatch(
      /useCapitalCard/,
    );
    // BOTH HALVES OF THE REFUSAL: a lone cycling glyph cannot show the two states it is not
    // in, and `system` is indistinguishable from whichever theme it resolves to, so the rail
    // gets no theme control at all. The writer alone is not enough — a glyph that only
    // DISPLAYED the current theme would pass it and is exactly the button the refusal names.
    expect(RAIL, 'a theme control entered the rail').not.toMatch(/setTheme/);
    for (const glyph of ['Sun', 'Moon', 'Monitor']) {
      expect(RAIL, `${glyph} entered the rail, where no theme control belongs`).not.toMatch(
        new RegExp(`\b${glyph}\b`),
      );
    }
  });

  // THREE SPANS, and NOT an inline svg and NOT a lucide import: an svg would fail
  // `mark.test.ts`, which reads `Sidebar.tsx` RAW, and a lucide `Menu` would fail
  // `nav-glyphs.test.ts`'s exact import set. It is narrower than the header's because three
  // solid bars read as the heaviest thing beside eleven outlines.
  it('draws the burger as bars at the redrawn 14 x 12', () => {
    expect(RAIL, 'the burger became an inline SVG').not.toMatch(/<svg\b/);
    // No trailing `\b`: a `]` followed by a space is not a word boundary, so `w-\[14px\]\b`
    // can never match. The same shape has bitten twice.
    const bars = railLines(/\bw-\[14px\]/);
    expect(bars.length, 'the rail has no 14-wide burger').toBe(1);
    expect(bars[0], 'the burger is not 12 tall').toMatch(/\bh-3\b/);
  });

  // ONE TRIGGER ON SCREEN, ENFORCED RATHER THAN ASSERTED IN PROSE: `Layout` hands focus to
  // `NAV_TRIGGER_ID` by `getElementById`, which returns the FIRST match, so a header trigger
  // merely HIDDEN at desktop would take the handoff from the rail's.
  it('owns the trigger id, and the header renders none beside it', () => {
    expect(railLines(/\bNAV_TRIGGER_ID\b/).length, 'the rail names the trigger id twice').toBe(2);
    expect(HEADER, 'the header no longer gates its trigger on the breakpoint').toMatch(
      /desktop \? null :/,
    );
  });

  // Wave 24 (brand.md § Signed): the 40 plate over the menu. The menu is an item like its
  // neighbours, 44 × 44 at r12 with their hover, by the owner's ruling on #720.
  it('stands the 40 plate over a 44 menu that keeps the trigger id', () => {
    const plate = RAIL.indexOf('<Mark size={40} />');
    const menu = RAIL.indexOf('id={NAV_TRIGGER_ID}');
    expect(plate, 'the plate left the rail head').toBeGreaterThan(-1);
    expect(menu, 'the menu lost the trigger id').toBeGreaterThan(plate);
    const at = RAIL.lastIndexOf('<button', menu);
    const tag = RAIL.slice(at, RAIL.indexOf('>', menu));
    expect(tag, 'the menu is not a 44 item').toMatch(/\bsize-11\b/);
    expect(tag, 'the menu is not at r12').toMatch(/rounded-\[12px\]/);
    expect(tag, "the menu has not the items' hover").toMatch(/hover:bg-sb-item-hover-bg/);
    expect(tag, 'the menu still grows an invisible overlay').not.toMatch(/TAP_RAIL/);
  });

  // O3: a 64 × 40 strip under the menu, `accent-tint`, the shield 18 in `accent`. Across the card's
  // inner width, with no bleed: the card pays the safe area outside itself (§ Wave 29).
  it('gives the super-admin a 64 x 40 `accent-tint` strip under the menu', () => {
    expect(RAIL.indexOf('<RailRoleBand />'), 'the strip is not under the menu').toBeGreaterThan(
      RAIL.indexOf('id={NAV_TRIGGER_ID}'),
    );
    const at = RAIL.indexOf('function RailRoleBand');
    const strip = RAIL.slice(at, RAIL.indexOf('</Tooltip>', at));
    expect(strip, 'the strip is not 40 tall').toMatch(/\bh-10\b/);
    expect(strip, "the strip does not span the card's inner width").toMatch(/\bw-full\b/);
    expect(strip, 'the strip still bleeds under the safe area').not.toMatch(/safe-area/);
    expect(strip, 'the strip is not `accent-tint`').toMatch(/\bbg-accent-tint\b/);
    expect(strip, 'the shield is not 18 in `accent`').toMatch(
      /<Shield size=\{18\}[^>]*className="[^"]*\btext-accent\b/,
    );
  });

  // THE FIT POINT, from what the rail draws (rail-and-account-foot.md § Signed, O3, brand.md's plate,
  // and § Wave 29): a user's rail is 709 tall and its card stands 8 from the top and the bottom, so
  // every item shows from a 725 px window; below that the band scrolls inside the card.
  it('fits a 725 px window whole', () => {
    expect(RAIL, 'the rail is not padded 8 / 0').toMatch(
      /grid-rows-\[auto_minmax\(0,1fr\)_auto\] py-2"/,
    );
    const count = (src: string, name: string) =>
      (src.match(new RegExp(`${name} = \\[([\\s\\S]*?)\\] as const`))?.[1].match(/\{ to:/g) ?? [])
        .length;
    const items = count(RAIL, 'ENTRY') + count(SIDEBAR, 'ANALYTICS');
    expect(items, 'the rail no longer draws ten routes').toBe(10);
    expect(RAIL, 'the currency box is not 32 tall').toMatch(/\bh-8 w-10\b/);
    const pad = 8 + 8;
    const head = 40 + 44;
    const rule = 2 + 1 + 2;
    const foot = 32 + 3 * 44;
    expect(pad + head + items * 44 + rule + foot).toBe(709);
    const card = constant(SIDEBAR, 'CARD_RAIL');
    expect(card, 'the card is not 8 from the top').toMatch(
      /mt-\[max\(8px,env\(safe-area-inset-top\)\)\]/,
    );
    expect(card, 'the card does not leave 8 below it').toMatch(
      /-max\(8px,env\(safe-area-inset-bottom\)\)\)\]/,
    );
    expect(pad + head + items * 44 + rule + foot + 8 + 8).toBe(725);
    // NO GAPS: any margin or gap between the items is a term this sum leaves out.
    expect(RAIL, 'a gap entered the rail').not.toMatch(/\b(?:gap|mt|mb|space-y)-(?!0\b)/);
  });

  // C1 (rail-and-account-foot.md § Signed): a 16 px box at r4, 2 px inside the item's corner,
  // solid `accent` with `accent-fg` text, padded 3 so «99+» grows it to the left.
  it('draws the count solid accent at the corner', () => {
    expect(BADGE, 'the count is not solid accent').toMatch(/\bbg-accent\b/);
    expect(BADGE, 'the count does not read `accent-fg`').toMatch(/\btext-accent-fg\b/);
    expect(BADGE, 'the count is not a 16 box at r4').toMatch(/\bh-4 min-w-4\b[^"]*rounded-\[4px\]/);
    expect(BADGE, 'the count is not padded 3').toMatch(/\bpx-\[3px\]/);
    expect(BADGE, 'the count is not 2 px inside the corner').toMatch(/\bright-\[2px\]/);
    expect(RAIL, 'the rail count is not 2 px from the top').toMatch(
      /<CornerBadge[^>]*top="top-\[2px\]"/,
    );
  });
});

// THE BAND IS RETIRED (§ Wave 29): the rail and the collapsed header were its only wearers, and
// the rail now wears the panel's glass while the header wears nothing.
describe('the glass band is gone', () => {
  it('is declared nowhere, and nothing wears it', () => {
    expect(CSS, '`glass-band` is still declared').not.toMatch(/@utility glass-band\b/);
    for (const src of [RAIL, SIDEBAR, HEADER]) {
      expect(src, 'a shell surface still wears the band').not.toMatch(/\bglass-band\b/);
      expect(src).not.toMatch(/\[--(?:glass-edge|color-glass-bevel-\w+|shadow-glass):/);
    }
  });
});

// J2 (rail-and-account-foot.md § Wave 29): at md and up, while collapsed, the header is dissolved
// into the page, a 56 row 8 from the top that scrolls with the content. Below md the 360 bar holds.
describe('the collapsed header is dissolved into the page', () => {
  const header = () => {
    const at = HEADER.indexOf('<header');
    expect(at, 'the header is gone').toBeGreaterThan(-1);
    const tag = HEADER.slice(at, HEADER.indexOf('>', at));
    const classes = tag.match(/className="([^"]*)"/)?.[1];
    expect(classes, 'the header has no literal className').toBeDefined();
    return classes!.split(' ');
  };

  it('has no fill, no edge and no stickiness at md', () => {
    for (const term of ['md:static', 'md:border-b-0', 'md:bg-transparent']) {
      expect(header(), `the header is not ${term}`).toContain(term);
    }
    expect(
      header().filter((c) => c.startsWith('md:glass')),
      'the header wears a glass',
    ).toEqual([]);
  });

  it("stands 8 from the top, the card's offset, in place of its own safe-area padding", () => {
    expect(header()).toContain('md:mt-[max(8px,env(safe-area-inset-top))]');
    expect(header()).toContain('md:pt-0');
  });

  // The owner's ruling: the plate sits on the header's line. Both are read off what draws them.
  it("puts its centre line on the plate's", () => {
    expect(HEADER, 'the row is not 56 tall').toMatch(/className="flex h-14 /);
    const row = 8 + 56 / 2;
    expect(constant(SIDEBAR, 'CARD_RAIL')).toMatch(/mt-\[max\(8px,/);
    expect(RAIL, 'the rail is not padded 8 / 0').toMatch(/\bpy-2"/);
    expect(RAIL, 'the plate is not 40').toMatch(/<Mark size=\{40\} \/>/);
    const plate = 8 + 8 + 40 / 2;
    expect(row).toBe(plate);
    expect(row).toBe(36);
  });

  it('keeps its arrival, and the 360 bar below md', () => {
    for (const term of [
      'md:duration-220',
      'md:ease-soft',
      'md:fade-in',
      'md:slide-in-from-top-1',
      'sticky',
      'top-0',
      'border-b',
      'border-hairline',
      'bg-page',
      'pt-[env(safe-area-inset-top)]',
    ]) {
      expect(header(), `the header lost ${term}`).toContain(term);
    }
  });
});

// ONE ORDER IN BOTH STATES: the currency above Settings, as its track sits above Settings in the
// panel, and the sign-out last
// (`docs/superpowers/specs/2026-11-05-layout-refresh/rail-and-account-foot.md` § Signed).
describe("the rail's foot reads in the panel's order", () => {
  it('draws the currency box, then Settings, then the account', () => {
    const currency = RAIL.indexOf('h-8 w-10');
    const settings = RAIL.indexOf('to="/settings"');
    const account = RAIL.indexOf('<RailAccount ');
    expect(currency, 'the currency box is gone').toBeGreaterThan(-1);
    expect(settings, 'Settings moved above the currency box').toBeGreaterThan(currency);
    expect(account, 'the account is not last in the foot band').toBeGreaterThan(settings);
  });

  // O3: the currency box is 40 × 32 at r9, edged `field-border`, with no fill of its own.
  it('draws the currency box 40 x 32 at r9 on a `field-border` edge', () => {
    const box = railLines(/\bh-8 w-10\b/);
    expect(box.length, 'the currency box is not one element').toBe(1);
    expect(box[0], 'the box is not at r9').toMatch(/rounded-\[9px\]/);
    expect(box[0], 'the box has no `field-border` edge').toMatch(/\bborder border-field-border\b/);
    expect(box[0], 'the box paints a fill').not.toMatch(/\bbg-/);
  });

  // O3 and its render: signed out, «Увійти» alone replaces the profile and «Вийти».
  it('draws no profile glyph signed out', () => {
    const at = RAIL.indexOf('function RailProfile');
    expect(at, '`RailProfile` is gone').toBeGreaterThan(-1);
    const profile = RAIL.slice(at, RAIL.indexOf('\n}', at));
    expect(profile, 'the signed-out profile glyph is still drawn').not.toMatch(/\bstill\b/);
    expect(profile, 'the profile is drawn signed out').toMatch(/rows === 'entry'\s*\?\s*null/);
  });

  // ONE SIGN-OUT FOR THE FOOT: its latch is the hook instance's, so the profile beside «Вийти»
  // reads the same rows, or it drops to the signed-out glyph while the pressed sign-out leaves.
  it('draws the profile and the account from one sign-out', () => {
    expect(RAIL.match(/\buseSignOut\(\)/g)?.length, 'the foot holds two sign-outs').toBe(1);
  });

  // NAMED, because the tooltip only describes; a STRING className, because the tooltip's Slot
  // stringifies a callback; the item's radius, because the focus ring follows the button; and
  // busy without `disabled`, which would drop the focus the retry needs.
  it('signs out from a named button on the item radius that keeps its focus while busy', () => {
    const at = RAIL.indexOf('function RailAccount');
    expect(at, '`RailAccount` is gone').toBeGreaterThan(-1);
    // Bounded by the markup's own close: a stripped JSX comment can leave a bare `}` at a
    // line's start, so the function's closing brace is not a bound that can be found.
    const end = RAIL.indexOf('</AccountFold>', at);
    expect(end, '`RailAccount` no longer closes its fold').toBeGreaterThan(at);
    // The button's own markup: the entry before it is ringed on the same radius, so a read of
    // the whole item would pass on the link's classes alone.
    const item = RAIL.slice(at, end);
    const from = item.search(/<button\b/);
    expect(from, 'the sign-out is not a button').toBeGreaterThan(-1);
    const button = item.slice(from, item.indexOf('</button>', from));
    expect(button, 'the sign-out has no name of its own').toMatch(
      /aria-label=\{t\.auth\.signOut\}/,
    );
    expect(button, 'the button is not ringed on the item radius').toMatch(
      /className="[^"]*rounded-\[12px\]/,
    );
    expect(button, 'busy no longer announces itself').toMatch(/aria-disabled=/);
    expect(button, 'busy disables the button and drops its focus').not.toMatch(/\sdisabled=/);
  });

  // SIGNED OUT, «Увійти» IN THE SAME SLOT: a plain `Link` and never `RailItem`'s `NavLink`, since
  // `/sign-in/x` falls into the shell; named, because the tooltip only describes; a STRING
  // className on the item radius; hover only, as its neighbours.
  it('offers a named sign-in link on the item radius, with no press scale', () => {
    const at = RAIL.indexOf('function RailAccount');
    const end = RAIL.indexOf('</AccountFold>', at);
    const item = RAIL.slice(at, end);
    const start = item.search(/<Link\s+to="\/sign-in"/);
    expect(start, 'the entry is not a link to /sign-in').toBeGreaterThan(-1);
    expect(item, 'the entry has no name of its own').toMatch(/aria-label=\{t\.auth\.signInEntry\}/);
    expect(item, 'the entry lost its glyph').toMatch(/Icon=\{LogIn\}/);
    expect(item, 'a NavLink would mark /sign-in/x current').not.toMatch(/<NavLink\b/);
    expect(item, 'the rail item took a press scale').not.toMatch(/active:scale/);
    expect(item, 'the entry no longer answers the signed-out state').toMatch(/rows === 'entry' \?/);
    const link = item.slice(start, item.indexOf('</Link>', start));
    expect(link, 'the link is not ringed on the item radius').toMatch(
      /className="[^"]*rounded-\[12px\]/,
    );
  });
});
