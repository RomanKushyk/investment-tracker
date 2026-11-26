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

  // The width still animates: the shell keeps its transition and only the collapsed value
  // changes, from a `w-0` mask to a rail that is on screen.
  it('collapses the shell to the drawn 64 and its hairline rather than to nothing', () => {
    // The `<aside>`'s own tag, read whole: the formatter breaks the branch across lines.
    const at = SIDEBAR.indexOf('<aside');
    expect(at, 'the shell is gone').toBeGreaterThan(-1);
    const shell = SIDEBAR.slice(at, SIDEBAR.indexOf('>', at));
    const branch = shell.match(/collapsed\s*\?\s*'([^']*)'\s*:\s*'([^']*)'/);
    expect(branch, 'the shell no longer branches on `collapsed`').not.toBeNull();
    const [, rail, panel] = branch!;
    expect(rail, 'the collapsed shell is still a zero-width mask').not.toBe('w-0');
    // 64 AND ITS HAIRLINE PLUS the inset, never 64 with the inset taken out of it: a 64px shell
    // has no room to give, and a notched phone in landscape is wide enough to BE this shell. The
    // hairline sits outside the 64, as the header's sits under its 56, so the axis is whole.
    expect(rail, 'the collapsed shell is not the drawn 64 and its hairline').toBe(
      'w-[calc(65px+env(safe-area-inset-left))]',
    );
    // The panel's 260 plus the inset it floats at, so one tween moves both (shell.md § Signed).
    expect(panel, 'the expanded shell is not the inset plus 260').toBe(
      'w-[calc(max(16px,env(safe-area-inset-left))+260px)]',
    );
  });

  // THE SURFACE IS THE SHELL'S, NOT THE RAIL'S (rail-and-account-foot.md § Signed, O3): flush, on
  // the glass, with one hairline on the right and square, a full-bleed band (*Shape system*). The
  // band draws no edge of its own, by the owner's ruling on #720, so the hairline is the one edge.
  it('paints the collapsed branch on the glass band, with one right hairline and no corner', () => {
    const at = SIDEBAR.indexOf('{collapsed ? (');
    expect(at, 'the shell no longer branches').toBeGreaterThan(-1);
    const branch = SIDEBAR.slice(at, SIDEBAR.indexOf(') : (', at));
    expect(branch, 'the collapsed branch is not on the glass band').toMatch(/\bglass-band\b/);
    expect(branch, 'the collapsed branch has no right hairline').toMatch(
      /\bborder-r border-hairline\b/,
    );
    expect(branch, 'a full-bleed band takes a corner').not.toMatch(/\brounded-/);
    expect(branch, 'the collapsed branch still paints the wall').not.toMatch(/\bbg-sb-/);
    // AND ITS WIDTH IS SPELLED OUT, never inherited: `w-full` resolves against an `<aside>`
    // easing between two widths, so the whole rail re-flows sideways for the length of the
    // transition instead of arriving whole — invisible to every other pin here.
    expect(branch, 'the wall tracks the animating shell instead of its own width').not.toMatch(
      /\bw-full\b/,
    );
    expect(branch, 'the band is not held at the collapsed width').toMatch(
      /w-\[calc\(65px\+env\(safe-area-inset-left\)\)\]/,
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

  // O3: a 64 × 40 full-bleed strip under the menu, `accent-tint`, the shield 18 in `accent`.
  it('gives the super-admin a 64 x 40 `accent-tint` strip under the menu', () => {
    expect(RAIL.indexOf('<RailRoleBand />'), 'the strip is not under the menu').toBeGreaterThan(
      RAIL.indexOf('id={NAV_TRIGGER_ID}'),
    );
    const at = RAIL.indexOf('function RailRoleBand');
    const strip = RAIL.slice(at, RAIL.indexOf('</Tooltip>', at));
    expect(strip, 'the strip is not 40 tall').toMatch(/\bh-10\b/);
    // The rail's 64 and, on a notched landscape screen, the inset under it, the shield kept on axis.
    expect(strip, 'the strip stops at the inset').toMatch(/-ml-\[env\(safe-area-inset-left\)\]/);
    expect(strip, 'the strip is not full-bleed').toMatch(
      /\bw-\[calc\(100%\+env\(safe-area-inset-left\)\)\]/,
    );
    expect(strip, 'the shield left the axis').toMatch(/\bpl-\[env\(safe-area-inset-left\)\]/);
    expect(strip, 'the strip is not `accent-tint`').toMatch(/\bbg-accent-tint\b/);
    expect(strip, 'the shield is not 18 in `accent`').toMatch(
      /<Shield size=\{18\}[^>]*className="[^"]*\btext-accent\b/,
    );
  });

  // THE FIT POINT, from what the rail draws (rail-and-account-foot.md § Signed, O3, and brand.md's
  // plate): a user's rail is 709 tall, so every item shows from a 709 px window; below that the
  // band scrolls. The browser measured the same.
  it('fits a 709 px window whole', () => {
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

// The band's surface, shared by the rail and the collapsed header: the glass's fill, sheen and
// blur, with the card's ring, bevel and drop shadow off (the owner's ruling on #720).
describe('a full-bleed band wears the glass without its card edge', () => {
  const body = (name: string) => {
    const at = CSS.indexOf(`@utility ${name} {`);
    expect(at, `\`${name}\` is not declared`).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('\n}', at));
  };
  const base = (rule: string) => rule.slice(0, rule.search(/@supports|@media/));

  // Its own utility, never custom properties set on the band: those would inherit into every
  // glass knob and scroll thumb inside it.
  it("draws the glass's fill, sheen and blur", () => {
    const glass = base(body('glass'));
    const band = base(body('glass-band'));
    for (const line of [
      'background-color: var(--glass-fill, var(--color-glass-fill));',
      'background-image: linear-gradient(180deg, var(--color-glass-sheen) 0%, transparent 38%);',
      'backdrop-filter: blur(30px) saturate(180%);',
    ]) {
      expect(glass, `the glass no longer reads ${line}`).toContain(line);
    }
    expect(band).toContain('background-color: var(--color-glass-fill);');
    expect(band).toContain(
      'background-image: linear-gradient(180deg, var(--color-glass-sheen) 0%, transparent 38%);',
    );
    expect(band).toContain('-webkit-backdrop-filter: blur(30px) saturate(180%);');
    expect(band).toContain('backdrop-filter: blur(30px) saturate(180%);');
  });

  it('draws no edge, and falls back to the opaque card', () => {
    const band = body('glass-band');
    expect(band, 'the band draws an edge of its own').not.toMatch(/box-shadow|border/);
    expect(band.match(/background-color: var\(--color-card\);/g)?.length).toBe(2);
  });

  // ONE MATERIAL: each fallback block is the glass's, less the edge the band does not draw.
  it("falls back exactly as the glass does, less the glass's edge", () => {
    const blocks = (rule: string) =>
      (rule.match(/@(?:supports|media)[^{]*\{[^}]*\}/g) ?? []).map((b) =>
        b
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l !== '' && !l.startsWith('box-shadow'))
          .join('\n'),
      );
    const glass = blocks(body('glass'));
    expect(glass.length, 'the glass lost its two fallbacks').toBe(2);
    expect(blocks(body('glass-band'))).toEqual(glass);
  });

  it('is what the rail and the collapsed header wear, and nothing sets the glass variables', () => {
    expect(HEADER).toMatch(/\bmd:glass-band\b/);
    for (const src of [RAIL, SIDEBAR, HEADER]) {
      expect(src).not.toMatch(/\[--(?:glass-edge|color-glass-bevel-\w+|shadow-glass):/);
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
