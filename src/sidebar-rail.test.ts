import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE THIRD GEOMETRY. *Two shells, one breakpoint* once refused one, about the MOBILE job,
// and now prescribes this rail as a DESKTOP one: navigation a press away while the rest of
// the width goes back to the content. What that section still rejects is a rail that only
// HIDES. This file holds what `design/extensions/parchment-sidebar.dc.html` draws, not why.
//
// A SEPARATE FILE ON PURPOSE: `sidebar-structure.test.ts` and `nav-glyphs.test.ts` COUNT
// things across `app/Sidebar.tsx` — one footer band, two `sb-divider` sites, one `<Icon>`
// tag, eleven route/glyph pairs — and the rail draws a second of each. Its own module is
// what keeps those counts saying what they were written to say.
const here = dirname(fileURLToPath(import.meta.url));

/** LINE BY LINE, and the line boundary is the point: a regex literal may hold a quote, and
 *  one desync would switch stripping off for the rest of the file.
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

const RAIL_PATH = join(here, 'app', 'SidebarRail.tsx');
/** Read defensively so the FIRST failure is "the rail is not written yet" rather than an
 *  ENOENT that collapses the suite before any of it runs. */
const RAIL = existsSync(RAIL_PATH) ? stripTs(readFileSync(RAIL_PATH, 'utf8')) : '';
const SIDEBAR = stripTs(readFileSync(join(here, 'app', 'Sidebar.tsx'), 'utf8'));
const HEADER = stripTs(readFileSync(join(here, 'app', 'AppHeader.tsx'), 'utf8'));

const railLines = (re: RegExp) => RAIL.split('\n').filter((l) => re.test(l));

/** The sheet's table, transcribed — the same eleven `nav-glyphs.test.ts` holds for the
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
] as const;

describe('the collapsed shell is a rail, not a masked panel', () => {
  it('is its own module', () => {
    expect(existsSync(RAIL_PATH), '`src/app/SidebarRail.tsx` is not written yet').toBe(true);
  });

  // The width still animates: the shell keeps its transition and only the collapsed value
  // changes, from a `w-0` mask to a rail that is on screen.
  it('collapses the shell to the drawn 56 rather than to nothing', () => {
    const shell = SIDEBAR.split('\n').filter(
      (l) => /collapsed \?/.test(l) && /w-\[244px\]/.test(l),
    );
    expect(shell.length, 'the shell no longer branches on `collapsed`').toBe(1);
    expect(shell[0], 'the collapsed shell is still a zero-width mask').not.toMatch(/'w-0'/);
    // 56 PLUS the inset, never 56 with the inset taken out of it: a 56px shell has no room
    // to give, and a notched phone in landscape is wide enough to BE this shell.
    expect(shell[0], 'the collapsed shell is not the drawn 56').toMatch(
      /w-\[calc\(56px\+env\(safe-area-inset-left\)\)\]/,
    );
  });

  // THE WALL IS THE SHELL'S, NOT THE RAIL'S, and both branches must wear it: rendered bare
  // the rail draws on `page` with no edge, and every contrast arm compositing over `sb-bg`
  // would be describing a plane the app never shows.
  it('paints the collapsed branch on the wall, with the shell edge and corner', () => {
    const at = SIDEBAR.indexOf('{collapsed ? (');
    expect(at, 'the shell no longer branches').toBeGreaterThan(-1);
    const branch = SIDEBAR.slice(at, SIDEBAR.indexOf(') : (', at));
    expect(branch, 'the collapsed branch has no wall').toMatch(/\bbg-sb-bg\b/);
    expect(branch, 'the collapsed branch has no right edge').toMatch(
      /\bborder-r border-field-border\b/,
    );
    expect(branch, 'the collapsed branch has no corner').toMatch(/rounded-r-\[30px\]/);
    // AND ITS WIDTH IS SPELLED OUT, never inherited: `w-full` resolves against an `<aside>`
    // easing between two widths, so the whole rail re-flows sideways for the length of the
    // transition instead of arriving whole — invisible to every other pin here.
    expect(branch, 'the wall tracks the animating shell instead of its own width').not.toMatch(
      /\bw-full\b/,
    );
    expect(branch, 'the wall is not held at the collapsed width').toMatch(
      /w-\[calc\(56px\+env\(safe-area-inset-left\)\)\]/,
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

describe('the rail draws what the sheet draws', () => {
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

  it.each(TABLE.filter(([r]) => r === '/' || r === '/transactions' || r === '/settings'))(
    'names %s and its glyph itself',
    (route, icon) => {
      const pair = new RegExp(
        `'${route}'[^\\n]*\\b${icon}\\b|\\b${icon}\\b[^\\n]*'${route}'|` +
          `to="${route}"[\\s\\S]{0,300}?\\b${icon}\\b`,
      );
      expect(pair.test(RAIL), `${route} does not reach the rail`).toBe(true);
    },
  );

  it.each(TABLE.filter(([r]) => !['/', '/transactions', '/settings'].includes(r)))(
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
  it('draws its glyphs at the drawn 18', () => {
    const tags = RAIL.match(/<Icon\b[\s\S]*?\/>/g) ?? [];
    expect(tags.length, 'the rail does not draw its glyphs through one tag').toBe(1);
    expect(tags[0], 'the rail glyph is not 18px').toMatch(/size=\{18\}/);
    expect(tags[0], 'the rail glyph is not `aria-hidden`').toMatch(
      /aria-hidden(?!\s*=\s*\{?["']?false)/,
    );
  });

  // `h-[36px]` AND NOT `h-9`, WHICH RENDERS IDENTICALLY: `field-border.test.ts` calls a line
  // carrying both `rounded-[9px]` and `h-9` a FIELD, and would conscript this file into a
  // suite asserting an edge-minus-hover count across it. Do not "tidy" it.
  it('sizes its items 40 x 36 at the drawn radius, and stays out of the field scope', () => {
    const radius = railLines(/rounded-\[9px\]/);
    // TWO SITES, both the item: the box that paints it and the link that rings it.
    expect(radius.length, 'the drawn item radius is not on exactly the box and its link').toBe(2);
    const item = radius.filter((l) => /\bw-10\b/.test(l));
    expect(item.length, 'the rail item is not one element').toBe(1);
    expect(item[0], 'the rail item is not 36 tall').toMatch(/h-\[36px\]/);
    expect(item[0], 'the rail item wears `h-9`, which makes this file a field file').not.toMatch(
      /\bh-9\b/,
    );
  });

  // THE RING FOLLOWS THE FOCUSABLE ELEMENT, the link and not the box inside it: an outline
  // follows `border-radius`, so a link without one draws a square ring around a rounded
  // item — visible only while tabbing, the traversal least likely to be looked at.
  it('rings the item on its own radius', () => {
    const link = railLines(/<NavLink\b/);
    expect(link.length, 'the rail no longer renders one `NavLink`').toBe(1);
    expect(link[0], 'the link carries no radius, so its focus ring is square').toMatch(
      /rounded-\[9px\]/,
    );
  });

  // A 40px COLUMN CANNOT RESERVE THE BAR. Every other Scroller pushes content off it; here
  // that leaves too little for the item and the band overflows on a short window. `overlay`
  // floats it instead, which this item can afford because its ink is one centred glyph.
  it('floats the scroll bar rather than reserving a strip it has no room for', () => {
    const band = railLines(/<Scroller\b/);
    expect(band.length, 'the rail band is no longer one `Scroller`').toBe(1);
    expect(band[0], 'the rail reserves the bar a strip 40px cannot spare').toMatch(/\boverlay\b/);
  });

  // SPENT TWICE, exactly as the panel spends it: once between the two groups and once along
  // the foot band's top edge, which is what identifies a band whose fill barely steps off
  // the wall.
  it('spends `sb-divider` twice — the group rule and the band', () => {
    const rule = railLines(/\bborder-sb-divider\b/);
    expect(rule.length, '`sb-divider` moved off its two sites in the rail').toBe(2);
  });

  // The foot band carries Settings and the currency box and nothing else — the capital and
  // the version are refused by arithmetic rather than taste: neither fits the drawn width.
  it('carries a foot band, and neither the capital nor the version', () => {
    expect(railLines(/\bbg-sb-footer-bg\b/).length, 'the rail has no foot band').toBe(1);
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
    expect(RAIL, 'a theme control entered the rail, which T2 refuses').not.toMatch(/setTheme/);
    for (const glyph of ['Sun', 'Moon', 'Monitor']) {
      expect(RAIL, `${glyph} entered the rail, where no theme control belongs`).not.toMatch(
        new RegExp(`\b${glyph}\b`),
      );
    }
  });

  // THREE SPANS, and NOT an inline svg and NOT a lucide import: an svg would fail
  // `mark.test.ts`, which reads `Sidebar.tsx` RAW, and a lucide `Menu` would fail
  // `nav-glyphs.test.ts`'s exact import set. The sheet draws it narrower than the header's
  // because three solid bars read as the heaviest thing beside eleven outlines.
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

  // BOTH SIDEBAR SHELLS KEEP THE CAUTION: gating the panel's badge on the expanded variant
  // takes it out of the DRAWER, whose lockup row is the same row, and the header's copy is
  // `aria-hidden` behind the scrim while the drawer is open — so the mobile drawer would be
  // left with no dataset caution at all.
  it('leaves the DEMO badge in both sidebar shells', () => {
    const gate = SIDEBAR.split('\n').filter((l) => /\{demo &&/.test(l));
    expect(gate.length, 'the panel draws its badge on more than one gate').toBe(1);
    expect(gate[0], 'the badge is gated on the shell variant, so the drawer loses it').not.toMatch(
      /\b(panel|drawer|rail)\b/,
    );
  });
});
