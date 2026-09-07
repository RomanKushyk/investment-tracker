import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE GLYPH AND THE IMPORT ARE ONE OBJECT, WHICH IS WHY THIS PIN EXISTS: the
// sheet hands over an import NAME per route rather than a shape to copy, so a
// glyph cannot be re-picked inside a component — the failure *Design pipeline*
// names for hexes (`parchment-5h.dc.html:970-983`, and `:221-224` for the why).
// The record also names two icon states and no third, while the drawing beside
// it paints a hovered glyph `:279-282` flags against itself; the record wins.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the suite down with ENOENT the moment vitest is given a different root.
const here = dirname(fileURLToPath(import.meta.url));

/** TS comments out, LINE BY LINE, and the line boundary is the point: a regex
 *  literal may hold a quote, and one desync would switch stripping off for the
 *  rest of the file. Copied from `sidebar-plane.test.ts` SIGNATURE AND ALL,
 *  which is the house idiom — the guards here each carry their own copy.
 *  Not cosmetic: `Sidebar.tsx`'s own prose names the sheet's icon states, so an
 *  unstripped read would let a comment satisfy an assertion the markup fails. */
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

/** The sheet's table, `parchment-5h.dc.html:970-983`, route by route and in its
 *  order. The two glyphs it also names — `Search` for ⌘K and `FileText` for
 *  «Податки» — belong to furniture the sheet lists as non-shipping, so they are
 *  deliberately absent. */
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

/** The two the file already had before any route took a glyph. They are
 *  CONTROLS — `ChevronDown` folds a group, `ChevronLeft` collapses the shell —
 *  and the sheet keeps group headers glyphless for exactly that reason
 *  (`:984-986`: "the app draws a chevron there and that is a control, not a
 *  label"). Listed so the import assertion can tell a control from an icon. */
const CONTROLS = ['ChevronDown', 'ChevronLeft'];

/** The one tag all eleven are drawn through, matched TO ITS OWN `/>` rather
 *  than to the first `>`: an arbitrary variant may hold one (`[&>path]:…`), and
 *  a tag cut short there would fail the anatomy checks on correct markup while
 *  answering the hover check with a fragment that cannot contain a hover. */
const DRAWN = /<Icon\b[\s\S]*?\/>/g;

/** A slice bound that FAILS rather than widens. `indexOf` returning -1 makes
 *  `slice(a, -1)` mean "to the end", which is how a bounded read quietly
 *  becomes an unbounded one — the exact defect this file exists to not have. */
function until(from: number, mark: string, what: string): string {
  const end = SIDEBAR.indexOf(mark, from);
  expect(end, `${what}: \`${mark}\` is gone, so this pin has no bound`).toBeGreaterThan(-1);
  return SIDEBAR.slice(from, end);
}

/** That tag, with its uniqueness asserted rather than assumed — every check
 *  below shares this precondition, so none of them can pass vacuously on a
 *  file that draws no glyph at all. */
function one(): string {
  const tags = SIDEBAR.match(DRAWN) ?? [];
  expect(tags.length, 'the glyphs are no longer drawn through one tag').toBe(1);
  return tags[0]!;
}

/** Every value name in the file's `lucide-react` import. The statement is
 *  matched whole rather than by scanning back for a brace, which would latch
 *  onto unrelated code above a default or namespace import. Type-only members
 *  are dropped: the row needs `LucideIcon` to type its prop, and a type is not
 *  a glyph. */
function imported(): string[] {
  const m = SIDEBAR.match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/);
  expect(m, 'the named `lucide-react` import is gone').not.toBeNull();
  return m![1]!
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '' && !n.startsWith('type '));
}

/** The route/glyph pairs AS THE SOURCE STATES THEM, each read from a BOUNDED
 *  block rather than by proximity. The sheet's one table lives in two shapes
 *  here — eight in `ANALYTICS`, three written on their own `NavLink` — and a
 *  window-based match would let one block's glyph answer for its neighbour's
 *  route, silently, on any edit that shortened the first block. */
function pairs(): string[][] {
  const out: string[][] = [];
  const from = SIDEBAR.indexOf('const ANALYTICS = [');
  expect(from, '`ANALYTICS` is gone').toBeGreaterThan(-1);
  const table = until(from, '] as const', '`ANALYTICS`');
  for (const m of table.matchAll(/\{\s*to:\s*'([^']+)'[^}]*?\bIcon:\s*(\w+)\s*\}/g)) {
    out.push([m[1]!, m[2]!]);
  }
  // The three written inline. Each block is cut at its own closing tag, so the
  // next `NavLink`'s glyph is out of reach; the `ANALYTICS`-driven one carries
  // `to={to}` rather than a literal and is read from the table above instead.
  for (const block of SIDEBAR.split('<NavLink').slice(1)) {
    const close = block.indexOf('</NavLink>');
    expect(close, 'a `NavLink` no longer closes — its block has no bound').toBeGreaterThan(-1);
    const body = block.slice(0, close);
    const to = body.match(/^\s*to="([^"]+)"/);
    // `\bIcon=` so a second glyph prop (`ActiveIcon=`, `TrailingIcon=`) cannot
    // answer for the route's own.
    const icon = body.match(/\bIcon=\{(\w+)\}/);
    if (to && icon) out.push([to[1]!, icon[1]!]);
  }
  return out;
}

/** The `ANALYTICS.map` block, which is where the table's eight reach the row.
 *  Read separately because `pairs()` takes those eight from the DECLARATION:
 *  a table that is right about `/balances` proves nothing if the render hands
 *  every route the same glyph. */
function mapped(): string {
  const at = SIDEBAR.indexOf('ANALYTICS.map(');
  expect(at, '`ANALYTICS.map` is gone — the eight no longer render from the table').toBeGreaterThan(
    -1,
  );
  return until(at, '</NavLink>', '`ANALYTICS.map`');
}

describe('every route wears the glyph the sheet gave it', () => {
  it('imports the eleven the table names, and no glyph it does not', () => {
    expect(
      imported()
        .filter((n) => !CONTROLS.includes(n))
        .sort(),
      'the import and the sheet disagree',
    ).toEqual(TABLE.map(([, icon]) => icon).sort());
  });

  it('still imports the two chevrons, which are controls rather than icons', () => {
    const names = imported();
    for (const control of CONTROLS) expect(names, `${control} left the import`).toContain(control);
  });

  // ATTACHED, not merely imported: an icon on the wrong route is the defect a
  // name-only check cannot see. Read as exact pairs off the source, so this
  // says which glyph belongs to which route and not merely that both appear
  // somewhere near each other.
  it('attaches all eleven to their own routes', () => {
    expect(
      pairs()
        .map((p) => p.join(' '))
        .sort(),
      'a route and its glyph came apart',
    ).toEqual(TABLE.map((p) => p.join(' ')).sort());
  });

  // AND THE EIGHT REACH THE ROW FROM THE TABLE. The assertion above reads them
  // out of the `ANALYTICS` declaration, so a correct table plus a render that
  // hands every analytics route one hard-coded glyph would satisfy it and draw
  // seven wrong icons.
  it('renders the analytics eight from their own row, not one fixed glyph', () => {
    const block = mapped();
    expect(block, '`ANALYTICS.map` no longer destructures `Icon`').toMatch(
      /\(\s*\{[^}]*\bIcon\b[^}]*\}\s*\)\s*=>/,
    );
    expect(block, 'the mapped row takes a glyph other than its own row').toMatch(/\bIcon=\{Icon\}/);
  });

  // ONE DRAWING SITE, so the anatomy cannot drift per item. 16 and stroke 2 are
  // the sheet's item glyph (`parchment-5h.dc.html:362-365`, which differs
  // between idle and active in stroke COLOUR only); `aria-hidden` is this
  // issue's own requirement, the drawing having no links to hide a glyph from.
  it('draws all eleven through one tag — 16px, stroke 2, aria-hidden', () => {
    const tag = one();
    expect(tag, 'the glyph is not 16px').toMatch(/size=\{16\}/);
    expect(tag, 'the glyph left the drawn stroke weight').toMatch(/strokeWidth=\{2\}/);
    // The BARE attribute, or anything but a false one: `aria-hidden="false"`
    // contains the substring and puts the glyph back in the tree, which is the
    // defect this line exists to catch.
    expect(tag, 'the glyph is not `aria-hidden`, or is hidden={false}').toMatch(
      /aria-hidden(?!\s*=\s*\{?["']?false)/,
    );
    expect(tag, 'the glyph can be squeezed — it left `flex-none`').toMatch(/\bflex-none\b/);
  });

  // THE ROW IS AN ORDER AND A GAP: `navigation-map.md` records "a 16px glyph
  // LEFT of its label, gap 10" as this route's expected value, and the drawing
  // sets both (`parchment-sidebar.dc.html:65`). Without this the glyph can move
  // after the label or lose its gap with every other assertion still green.
  it('puts the glyph before the label, on the drawn 10px gap', () => {
    const at = SIDEBAR.indexOf('function NavItem');
    expect(at, '`NavItem` is gone — the row moved and this pin must follow').toBeGreaterThan(-1);
    // Bounded on the RETURNED JSX, not on a brace: the destructured signature
    // closes with `}: {` and `}) {` before the JSX starts, and a stripped JSX
    // comment ending `*/}` leaves a bare `}` at column 0 — both of which cut a
    // brace-hunting bound short and left this pin reading half a row.
    const open = SIDEBAR.indexOf('return (', at);
    expect(open, '`NavItem` no longer returns JSX').toBeGreaterThan(-1);
    const body = until(open, '\n  );', '`NavItem`');
    expect(body, 'the row lost the drawn 10px gap').toMatch(/gap-2\.5\b/);
    expect(body.indexOf('<Icon'), 'the glyph is no longer drawn in the row').toBeGreaterThan(-1);
    expect(
      body.indexOf('<Icon') < body.indexOf('{label}'),
      'the glyph no longer comes before the label',
    ).toBe(true);
  });

  // BOUND TO THE STATE, not merely present in the tag: asserting that both
  // names appear is satisfied just as well by a tag that swaps them, painting
  // the current route muted and the other ten in the accent.
  it('binds `sb-icon-active` to the current route and `sb-icon` to the rest', () => {
    expect(one(), 'the two colours are not bound to `isActive` in that order').toMatch(
      /isActive\s*\?\s*'text-sb-icon-active'\s*:\s*'text-sb-icon'/,
    );
  });

  // `pillClass`'s idle arm hangs `hover:text-sb-item-hover` on the anchor, so a
  // `hover:` here would reach the fourth state the record does not name.
  it('keeps hover off the glyph, where the record has no state for it', () => {
    expect(one(), 'the glyph took a hover of its own').not.toMatch(/hover:/);
  });
});
