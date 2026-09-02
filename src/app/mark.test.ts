import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The logo mark exists in THREE copies, and only two of them are text:
//   1. `Mark` in ./Sidebar.tsx        — JSX, so its arc inherits `currentColor`
//   2. ../../public/favicon.svg       — a file, because a favicon is a URL
//   3. ../../public/apple-touch-icon.png — a raster, because iOS wants one
// This pins 1 against 2. Copy 3 cannot be pinned here (comparing a raster to an
// SVG needs a renderer vitest does not have), so it has a checked-in
// regeneration step instead — `node scripts/build-touch-icon.mjs` — and
// public/README.md names all three in its change-together rule.
//
// D131 replaced mark 04 with the Q-arrow mark, and with it everything this file
// used to assert. The bars' invariant was PARITY: an even centre and an even
// stroke put a bar's edges on whole device pixels at 16px. An arc has no edge to
// align — every tangent meets the grid at a different angle — so there is no
// parity left to check, and the geometry that replaced it is the drawing's own
// construction: one circle, one 45° diagonal, one perpendicular base. Those are
// what the three geometry tests below ask.
//
// THE TWO KINDS OF TEST HERE CATCH DIFFERENT THINGS, and it is worth being
// precise about which, because an earlier version of this comment overpromised.
// The string equality is the STRICTER gate and it runs first: the paths must be
// byte-identical in both copies, so a re-export that draws the same curve a
// different way (`A32 32 0 10 79.61 42.99` is the same arc, legal SVG, compactly
// flagged) fails there and never reaches the geometry. That is deliberate — the
// two copies being ONE drawing is the property most worth keeping, and a
// re-export is a thing to review, not to wave through. What the geometry tests
// add is the case string equality cannot see: an edit applied to BOTH copies
// consistently, which passes equality and can still be geometric nonsense. They
// also state the construction, so the next author knows which numbers are free
// and which are load-bearing.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the whole suite down with ENOENT the moment vitest is run from a
// subdirectory or given a different root.
const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, 'Sidebar.tsx'), 'utf8');
const FAVICON = readFileSync(join(here, '..', '..', 'public', 'favicon.svg'), 'utf8');

/** Every `d="…"` in source order — arc, shaft, arrowhead. */
function paths(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

/** Every stroke width in source order, camel or kebab. */
function strokeWidths(source: string): string[] {
  return [...source.matchAll(/stroke-?[Ww]idth="([^"]+)"/g)].map((m) => m[1]);
}

/** Every number in a path string, in order. `M52 44 74 22` → [52, 44, 74, 22]. */
function numbers(d: string): number[] {
  return [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
}

const ARC = 'M53 16.39A32 32 0 1 0 79.61 42.99';
const SHAFT = 'M52 44 74 22';
const HEAD = 'M79.78 31.78 64.22 16.22 86 10Z';

describe('the logo mark is one drawing, kept in two text copies', () => {
  it('draws the same three paths in both', () => {
    const sidebar = paths(SIDEBAR);
    expect(sidebar).toEqual([ARC, SHAFT, HEAD]);
    expect(paths(FAVICON)).toEqual(sidebar);
  });

  it('strokes them the same way in both', () => {
    const sidebar = strokeWidths(SIDEBAR);
    expect(sidebar).toEqual(['13', '13', '3']);
    expect(strokeWidths(FAVICON)).toEqual(sidebar);
  });

  // Cropped to the ink, which is what replaces the even-centre rule: the arc
  // spans [9.5, 86.5] on both axes and the arrowhead reaches x 87.5 / y 8.5, so
  // 78 × 78 at (9.5, 8.5) is the drawing's own bounding box. It is load-bearing
  // twice — a 36px sidebar mark is then 36px of drawing, the diameter the
  // retired disc had, and a 16px tab gets 2.67px of stroke instead of 2.17px.
  it('keeps both copies on the same ink-cropped box', () => {
    expect(SIDEBAR).toContain('viewBox="9.5 8.5 78 78"');
    expect(FAVICON).toContain('viewBox="9.5 8.5 78 78"');
  });
});

describe('the drawing is built the way D131 says it is', () => {
  // The `Q`. Both endpoints sit on one circle centred in the box, and the radius
  // written into the arc command agrees with the distance actually spanned — a
  // pair that cannot both be satisfied by a typo. `toBeCloseTo(_, 1)` allows
  // 0.05 of slack and the endpoints' rounding to two decimals spends 0.0046 of
  // it; moving either endpoint by one unit costs 0.375, well outside.
  it('draws an arc that is a true circle, r32 about the box centre', () => {
    for (const source of [SIDEBAR, FAVICON]) {
      const n = numbers(paths(source)[0]);
      // Count first, so a re-flagged arc fails as a PARSE and not as a radius.
      // `A32 32 0 1 0 x y` yields nine numbers; the compact `A32 32 0 10 x y`
      // yields eight, and the endpoint would silently destructure to undefined
      // — `Math.hypot(NaN)` then fails the assertion below with a message about
      // the circle, sending the reader to the geometry instead of the syntax.
      expect(n).toHaveLength(9);
      const [x1, y1, rx, ry, , , , x2, y2] = n;
      expect([rx, ry]).toEqual([32, 32]);
      expect(Math.hypot(x1 - 48, y1 - 48)).toBeCloseTo(rx, 1);
      expect(Math.hypot(x2 - 48, y2 - 48)).toBeCloseTo(ry, 1);
    }
  });

  // The arrow is one 45° gesture, and every point that defines it lands on the
  // same diagonal: the shaft's two ends, the head's tip, and the midpoint of the
  // head's base. Exact, not approximate — this is how the drawing was set out.
  it('builds the arrow on the x + y = 96 diagonal', () => {
    for (const source of [SIDEBAR, FAVICON]) {
      const [sx1, sy1, sx2, sy2] = numbers(paths(source)[1]);
      const [bx1, by1, bx2, by2, tx, ty] = numbers(paths(source)[2]);
      const onDiagonal = [
        [sx1, sy1],
        [sx2, sy2],
        [tx, ty],
        [(bx1 + bx2) / 2, (by1 + by2) / 2],
      ];
      for (const [x, y] of onDiagonal) expect(x + y).toBe(96);
    }
  });

  it('sets the arrowhead base square to the shaft', () => {
    for (const source of [SIDEBAR, FAVICON]) {
      const [sx1, sy1, sx2, sy2] = numbers(paths(source)[1]);
      const [bx1, by1, bx2, by2] = numbers(paths(source)[2]);
      const dot = (bx2 - bx1) * (sx2 - sx1) + (by2 - by1) * (sy2 - sy1);
      expect(dot).toBe(0);
    }
  });
});

describe('each copy keeps what only it can carry', () => {
  it('leaves the favicon theme-aware, so it survives a dark browser chrome', () => {
    // A fixed colour goes invisible in one theme; the tab is painted by the
    // browser, not by the app, so the file has to carry the query itself. Four
    // literals since D131, not two — the arrow is a second colour, and its
    // light-ground value is the DARKER of the sand pair.
    expect(FAVICON).toContain('prefers-color-scheme: dark');
    for (const hex of ['#26262a', '#e9e8e6', '#9c683a', '#d8b494']) {
      expect(FAVICON).toContain(hex);
    }
  });

  // THIS TEST EXISTS BECAUSE THE FAVICON WAS SHIPPED BLANK ONCE, on this very
  // branch, and nothing else noticed. A double hyphen cannot appear inside an
  // XML comment, so a comment mentioning `--color-brand-sand` by its real name
  // makes the whole file not well-formed and the browser draws NOTHING. Every
  // assertion above still passed: they read the file as text, prettier has no
  // parser for `.svg`, and the touch icon is generated from an independent
  // transcription. The trap is specific to this repository — every colour it
  // owns is a `--custom-property`, and the favicon is the one file where naming
  // one inside a comment is fatal — so it is worth a check of its own rather
  // than a dependency on an XML parser the suite does not have.
  it('keeps the favicon well-formed, so it does not render blank', () => {
    const comments = [...FAVICON.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    expect(comments.length).toBeGreaterThan(0); // a vacuous pass would be worse than none
    for (const body of comments) expect(body).not.toContain('--');
    // The other classic way to kill an SVG: a bare `&` is an entity start.
    expect(FAVICON.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g)).toBeNull();
  });

  it('leaves the sidebar copy decorative, so the wordmark is not read twice', () => {
    expect(SIDEBAR).toContain('aria-hidden="true"');
  });

  it('leaves the sidebar arc inheriting its plane', () => {
    // The arc is `currentColor` so the same component works on any plane; only
    // the arrow is a fixed brand colour.
    expect(SIDEBAR).toContain('stroke="currentColor"');
  });

  it('takes the sidebar arrow from the token, never a hex', () => {
    // "No ad-hoc hex in components" (CLAUDE.md) is the rule an SVG is most
    // tempted to break, since a designer's file arrives full of them. The
    // favicon has to hold literals — it is a standalone file with no token
    // to read — and the component must not.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('function Mark('));
    const body = block.slice(0, block.indexOf('\n}'));
    expect(body).toContain('brand-sand');
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
});
