import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE GLYPH AND THE IMPORT ARE ONE OBJECT, WHICH IS WHY THIS PIN EXISTS: the sheet hands
// over an import NAME per route rather than a shape to copy, so a glyph cannot be re-picked
// inside a component — the failure *Design pipeline* names for hexes. The record names TWO
// icon states and no third, and where the drawing beside it paints a hovered glyph the
// record wins.
//
// Paths resolve from THIS file, not from `process.cwd()`.
const here = dirname(fileURLToPath(import.meta.url));

/** LINE BY LINE, and the line boundary is the point: a regex literal may hold a quote, and
 *  one desync would switch stripping off for the rest of the file. Not cosmetic —
 *  `Sidebar.tsx`'s own prose names the sheet's icon states.
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

/** `design/extensions/parchment-5h.dc.html`'s table, route by route and in its order. The
 *  two glyphs it also names — `Search` for ⌘K and `FileText` for «Податки» — belong to
 *  furniture it lists as non-shipping, so they are deliberately absent. */
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

/** The glyphs that name no route: they are CONTROLS — a chevron folds a group or collapses
 *  the shell, and the theme track's three are segments — which is why the sheet keeps group
 *  headers glyphless. Listed so the import assertion can tell a control from an icon. */
const CONTROLS = ['ChevronDown', 'ChevronLeft', 'Monitor', 'Moon', 'Sun'];

/** Matched TO ITS OWN `/>` rather than the first `>`: an arbitrary variant may hold one
 *  (`[&>path]:…`), and a tag cut short there fails the anatomy checks on correct markup
 *  while answering the hover check with a fragment that cannot contain a hover. */
const DRAWN = /<Icon\b[\s\S]*?\/>/g;

/** A slice bound that FAILS RATHER THAN WIDENS: `indexOf` returning -1 makes `slice(a, -1)`
 *  mean "to the end", which is how a bounded read quietly becomes an unbounded one. */
function until(from: number, mark: string, what: string): string {
  const end = SIDEBAR.indexOf(mark, from);
  expect(end, `${what}: \`${mark}\` is gone, so this pin has no bound`).toBeGreaterThan(-1);
  return SIDEBAR.slice(from, end);
}

/** Uniqueness asserted rather than assumed: every check below shares this precondition, so
 *  none can pass vacuously on a file that draws no glyph at all. */
function one(): string {
  const tags = SIDEBAR.match(DRAWN) ?? [];
  expect(tags.length, 'the glyphs are no longer drawn through one tag').toBe(1);
  return tags[0]!;
}

/** Matched whole rather than by scanning back for a brace, which latches onto unrelated code
 *  above a default or namespace import. Type-only members are dropped: a type is not a glyph. */
function imported(): string[] {
  const m = SIDEBAR.match(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/);
  expect(m, 'the named `lucide-react` import is gone').not.toBeNull();
  return m![1]!
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n !== '' && !n.startsWith('type '));
}

/** Each read from a BOUNDED block rather than by proximity: the sheet's one table lives in
 *  two shapes here, and a window-based match lets one block's glyph answer for its
 *  neighbour's route on any edit that shortens the first block. */
function pairs(): string[][] {
  const out: string[][] = [];
  const from = SIDEBAR.indexOf('const ANALYTICS = [');
  expect(from, '`ANALYTICS` is gone').toBeGreaterThan(-1);
  const table = until(from, '] as const', '`ANALYTICS`');
  for (const m of table.matchAll(/\{\s*to:\s*'([^']+)'[^}]*?\bIcon:\s*(\w+)\s*\}/g)) {
    out.push([m[1]!, m[2]!]);
  }
  // Each block is cut at its own closing tag, so the next `NavLink`'s glyph is out of reach.
  // `to` is matched as a LITERAL, so the `ANALYTICS`-driven row — which carries `to={to}` —
  // contributes no pair here and is read from the table instead. That is why three inline
  // plus eight mapped is eleven rather than a double count.
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

/** Read separately because `pairs()` takes the eight from the DECLARATION: a correct table
 *  proves nothing if the render hands every route the same glyph. */
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

  it('still imports the controls, which are not icons on routes', () => {
    const names = imported();
    for (const control of CONTROLS) expect(names, `${control} left the import`).toContain(control);
  });

  // ATTACHED, not merely imported: an icon on the wrong route is the defect a name-only
  // check cannot see.
  it('attaches all eleven to their own routes', () => {
    expect(
      pairs()
        .map((p) => p.join(' '))
        .sort(),
      'a route and its glyph came apart',
    ).toEqual(TABLE.map((p) => p.join(' ')).sort());
  });

  // AND THE EIGHT REACH THE ROW FROM THE TABLE: the assertion above reads them out of the
  // declaration, so a render handing every analytics route one hard-coded glyph satisfies it.
  it('renders the analytics eight from their own row, not one fixed glyph', () => {
    const block = mapped();
    expect(block, '`ANALYTICS.map` no longer destructures `Icon`').toMatch(
      /\(\s*\{[^}]*\bIcon\b[^}]*\}\s*\)\s*=>/,
    );
    expect(block, 'the mapped row takes a glyph other than its own row').toMatch(/\bIcon=\{Icon\}/);
  });

  // ONE DRAWING SITE, so the anatomy cannot drift per item. The sheet's item glyph differs
  // between idle and active in stroke COLOUR only.
  it('draws all eleven through one tag — 16px, stroke 2, aria-hidden', () => {
    const tag = one();
    expect(tag, 'the glyph is not 16px').toMatch(/size=\{16\}/);
    expect(tag, 'the glyph left the drawn stroke weight').toMatch(/strokeWidth=\{2\}/);
    // The BARE attribute: `aria-hidden="false"` contains the substring and puts the glyph
    // back in the tree, which is the defect this line catches.
    expect(tag, 'the glyph is not `aria-hidden`, or is hidden={false}').toMatch(
      /aria-hidden(?!\s*=\s*\{?["']?false)/,
    );
    expect(tag, 'the glyph can be squeezed — it left `flex-none`').toMatch(/\bflex-none\b/);
  });

  // THE ROW IS AN ORDER AND A GAP, both of which `navigation-map.md` records as this route's
  // expected value. Without this the glyph can move after the label or lose its gap with
  // every other assertion still green.
  it('puts the glyph before the label, on the drawn 10px gap', () => {
    const at = SIDEBAR.indexOf('function NavItem');
    expect(at, '`NavItem` is gone — the row moved and this pin must follow').toBeGreaterThan(-1);
    // Bounded on the RETURNED JSX, never on a brace: the destructured signature closes with
    // `}: {` and `}) {` before the JSX starts, and A STRIPPED JSX COMMENT ENDING `*/}` LEAVES
    // A BARE `}` AT COLUMN 0 — both cut a brace-hunting bound short.
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

  // BOUND TO THE STATE, not merely present in the tag: asserting both names appear is
  // satisfied by a tag that SWAPS them, painting the current route muted and the rest accent.
  it('binds `sb-icon-active` to the current route and `sb-icon` to the rest', () => {
    expect(one(), 'the two colours are not bound to `isActive` in that order').toMatch(
      /isActive\s*\?\s*'text-sb-icon-active'\s*:\s*'text-sb-icon'/,
    );
  });

  // `pillClass`'s idle arm hangs the hover on the ANCHOR, so a `hover:` here would reach a
  // fourth state the record does not name.
  it('keeps hover off the glyph, where the record has no state for it', () => {
    expect(one(), 'the glyph took a hover of its own').not.toMatch(/hover:/);
  });
});
