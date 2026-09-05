import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The logo mark ships in THREE copies, and the third is a raster:
//   1. `Mark` in ./Sidebar.tsx            — JSX, so its parts take Tailwind classes
//   2. ../../public/favicon.svg           — a file, because a favicon is a URL
//   3. ../../public/apple-touch-icon.png  — a raster, because iOS wants one
// Comparing a raster to an SVG needs a renderer vitest does not have, so the PNG
// is pinned THROUGH ITS GENERATOR: ../../scripts/build-touch-icon.mjs is text,
// holds the same drawing, and `node scripts/build-touch-icon.mjs` writes the
// icon from it. That makes three text sources here — and then the raster is
// read back and checked against them, because nothing re-runs that command and
// a corrected script would otherwise go green over a stale icon.
//
// THE DRAWING IS THE SHEET'S. `design/extensions/parchment-5h.dc.html` draws the
// 5h mark at 28 sites — a rounded loop and two pills, all stroke, no fill — and
// this file transcribes it rather than deriving it. What was the Q-arrow's
// construction (an r32 circle, a 45° diagonal, a perpendicular base) went with
// the Q-arrow; re-deriving a drawing this repository did not set out would be
// inventing a second authority beside the sheet.
//
// SO THE TWO KINDS OF TEST HERE CATCH DIFFERENT THINGS. The string equality is
// the STRICTER gate and it runs first: the paths must be byte-identical in all
// three copies, so a re-export that draws the same curve a different way
// (`A16 16 0 01 56 72` is the same arc, legal SVG, compactly flagged) fails
// there and never reaches the geometry. That is deliberate — the three copies
// being ONE drawing is the property most worth keeping, and a re-export is a
// thing to review, not to wave through. The one geometric test underneath is
// the case equality cannot see, and it is the failure the sheet warns this
// issue about by name: a box that clips the ink.
//
// Paths resolve from THIS file, not from `process.cwd()`: a cwd-relative read
// takes the whole suite down with ENOENT the moment vitest is run from a
// subdirectory or given a different root.
const here = dirname(fileURLToPath(import.meta.url));
const SIDEBAR = readFileSync(join(here, 'Sidebar.tsx'), 'utf8');
const FAVICON = readFileSync(join(here, '..', '..', 'public', 'favicon.svg'), 'utf8');
const SCRIPT = readFileSync(join(here, '..', '..', 'scripts', 'build-touch-icon.mjs'), 'utf8');
const ICON = readFileSync(join(here, '..', '..', 'public', 'apple-touch-icon.png'));

/** CSS comments out, quote-aware. `index.css` line 5 holds a literal comment
 *  opener inside a string, so a plain regex strip swallows `@theme` with it.
 *  Copied from `palette-mirror.test.ts` SIGNATURE AND ALL, which is the point:
 *  the guards in this directory each carry their own copy — that file states
 *  the idiom — and a copy that drifts in shape is one that cannot be folded
 *  back if they are ever pooled.
 *  Stripping is not tidiness here. This file reads the stylesheet at MODULE
 *  scope, so a hex written in prose does not fail one assertion, it collapses
 *  the suite before the favicon-blank guard has run. */
function stripCss(source: string, what: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
      out += c;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else out += c;
  }
  return out;
}

const CSS = stripCss(readFileSync(join(here, '..', 'index.css'), 'utf8'), 'index.css');

/** The span of a `selector { … }` rule, matched on its own braces. */
function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(`${opener} {`);
  expect(at, `${opener} must be findable — index.css's shape changed`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = source.indexOf('{', at); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`${opener} is never closed`);
}

const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

/** What `index.css` DECLARES for one colour, in one theme. The two files that
 *  hold the mark as literals cannot read a token — one is standalone, the other
 *  renders in a throwaway page — and this is what stops those literals becoming
 *  a third opinion about the palette. The idiom is `palette-mirror.test.ts`'s,
 *  in its own words: the assertion is not "the favicon holds these hexes" but
 *  "the favicon holds whatever index.css holds", which survives the next
 *  re-valuing with no edit here.
 *
 *  SLICED RATHER THAN MATCHED, which `palette-mirror.test.ts:231` records as a
 *  mistake it made once: a name interpolated into a `RegExp` is one stray escape
 *  from a pattern that matches the wrong thing and still passes.
 *
 *  LAST DECLARATION, AND `@theme` BEHIND THE DARK BLOCK — both because that is
 *  what the browser does. A re-valuing that appends a line rather than editing
 *  one leaves two, and CSS takes the second; a token the dark block does not
 *  override resolves against the light one, so demanding it be present there
 *  would fail this whole file over a redundant line correctly deleted.
 *  A `var()` alias fails rather than resolving — none of these four is one, and
 *  a red test naming the day that stopped is better than a silent half-read. */
function declared(block: keyof typeof BLOCKS, name: string): string {
  const needle = `--color-${name}:`;
  const from = BLOCKS[block].lastIndexOf(needle) >= 0 ? BLOCKS[block] : BLOCKS.light;
  const at = from.lastIndexOf(needle);
  expect(at, `--color-${name} is declared in neither ${block} nor @theme`).toBeGreaterThan(-1);
  const value = from.slice(at + needle.length, from.indexOf(';', at)).trim();
  expect(value, `--color-${name} is not a plain hex in ${block} — resolve the alias here`).toMatch(
    /^#[0-9a-fA-F]{6}$/,
  );
  return value.toLowerCase();
}

const LOGO = ['logo-outline', 'logo-pill-a', 'logo-pill-b'];
const LIGHT = LOGO.map((n) => declared('light', n));
const DARK = LOGO.map((n) => declared('dark', n));

const LOOP =
  'M72 56 A16 16 0 0 1 56 72 H36 A16 16 0 0 1 20 56 V36 A16 16 0 0 1 36 20 H56 A16 16 0 0 1 72 36 V70 M72 62 A8 8 0 0 1 80 54 H88 A8 8 0 0 1 96 62 V70';
const PILL_A = 'M72 48 V70';
const PILL_B = 'M96 70 V88';
/** The loop, then the two pills — the order all three copies draw them in. */
const DRAWING = [LOOP, PILL_A, PILL_B];
const WIDTHS = ['11', '15', '15'];
const VIEW_BOX = '0 0 120 120';

/** Every `d="…"` in source order — loop, pill A, pill B. */
function paths(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

/** One presentation attribute's values in source order, camel or kebab — JSX
 *  writes `strokeWidth`, the two plain files write `stroke-width`. */
function attr(source: string, name: string): string[] {
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return [...source.matchAll(new RegExp(`\\b(?:${name}|${kebab})="([^"]+)"`, 'g'))].map(
    (m) => m[1],
  );
}

/** The script INTERPOLATES its paths, so `paths(SCRIPT)` reads back the holes
 *  and the drawing itself lives in three consts. Both halves are checked below:
 *  these hold it, and the template spends them in order.
 *
 *  `=\s*` and not `= `: the loop is 149 characters, so prettier puts it on its
 *  own line under the `const`, and a space-only matcher silently found two
 *  paths of three — a pin that passes on a partial read. */
function scriptPaths(): string[] {
  return [...SCRIPT.matchAll(/^const (?:LOOP|PILL_A|PILL_B) =\s*'([^']+)';$/gm)].map((m) => m[1]);
}

/** A non-interlaced 8-bit RGB PNG to raw pixels. `zlib` is node's, and the
 *  unfiltering is the five cases of the spec — twenty lines, against a whole
 *  image dependency for two questions about one checked-in file. It is written
 *  narrow on purpose: anything but the format the script emits should throw
 *  here rather than be decoded approximately. */
function decode(png: Buffer): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24], 'the icon is no longer 8 bits a channel').toBe(8);
  expect(png[25], 'the icon grew an alpha channel — iOS needs it opaque').toBe(2);
  expect(png[28], 'the icon is interlaced, which this walk does not undo').toBe(0);
  const idat: Buffer[] = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp + 1;
  const out = Buffer.alloc(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    for (let x = 0; x < width * bpp; x++) {
      const a = x >= bpp ? out[y * width * bpp + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * width * bpp + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * width * bpp + x - bpp] : 0;
      let v = raw[y * stride + 1 + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter} on row ${y}`);
      out[y * width * bpp + x] = v & 255;
    }
  }
  return out;
}

/** One named const out of the script, so a colour can be compared to the
 *  stylesheet instead of to a substring of the whole file — `toContain('#…')`
 *  passes on a hex that survives only in a comment. */
/** One numeric const out of the script. Its sizes and offsets are figures, so
 *  they are recomputed here rather than restated — the icon is checked against
 *  what the script currently says, not against a number typed twice. */
function scriptNum(name: string): number {
  const m = SCRIPT.match(new RegExp(`^const ${name} = (-?[\\d.]+);$`, 'm'));
  expect(m, `${name} is no longer a plain number in build-touch-icon.mjs`).not.toBeNull();
  return Number(m![1]);
}

function scriptConst(name: string): string {
  const m = SCRIPT.match(new RegExp(`^const ${name} = '(#[0-9a-fA-F]{6})';$`, 'm'));
  expect(m, `${name} is no longer a hex const in build-touch-icon.mjs`).not.toBeNull();
  return m![1].toLowerCase();
}

/** The three paths flattened to points, in viewBox units. Absolute
 *  `M`/`A`/`H`/`V` only; anything else stops the walk rather than being
 *  skipped, because a command it cannot read is a drawing it cannot measure.
 *
 *  ARCS ARE SAMPLED, NOT ASSUMED. Two earlier drafts of this file tried to
 *  measure an arc by its endpoints and defend that with a premise — first
 *  that the flags were `0 0 1`, then that the endpoints sat a radius apart.
 *  Neither holds: `A16 16 0 1 1` from (72,56) to (56,72) satisfies the second
 *  and paints 16 units past both, and `A30 4 0 0 1` from (88,54) to (96,62)
 *  satisfies the first and swings 26 past. So the arc is converted to its
 *  centre form (SVG F.6.5) and walked, and the drawing can be anything. */
function flatten(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (cmd === 'M') {
      x = n();
      y = n();
    } else if (cmd === 'A') {
      const [rx, ry, rotation, large, sweep] = [n(), n(), n(), n(), n()];
      expect(rotation, 'a rotated ellipse needs the full F.6.5 rotation terms').toBe(0);
      const [x2, y2] = [n(), n()];
      out.push(...arc(x, y, rx, ry, large, sweep, x2, y2));
      x = x2;
      y = y2;
    } else if (cmd === 'H') x = n();
    else if (cmd === 'V') y = n();
    else throw new Error(`the drawing grew a "${cmd}" command this walk cannot read`);
    out.push([x, y]);
  }
  return out;
}

/** An unrotated elliptical arc, endpoint form to points along it. */
function arc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  large: number,
  sweep: number,
  x2: number,
  y2: number,
): [number, number][] {
  const [hx, hy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const over = (hx * hx) / (rx * rx) + (hy * hy) / (ry * ry);
  if (over > 1) {
    rx *= Math.sqrt(over);
    ry *= Math.sqrt(over);
  }
  const top = rx * rx * ry * ry - rx * rx * hy * hy - ry * ry * hx * hx;
  const bottom = rx * rx * hy * hy + ry * ry * hx * hx;
  const c = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, top / bottom));
  const cx = (c * rx * hy) / ry + (x1 + x2) / 2;
  const cy = (-c * ry * hx) / rx + (y1 + y2) / 2;
  const t1 = Math.atan2((y1 - cy) / ry, (x1 - cx) / rx);
  let span = Math.atan2((y2 - cy) / ry, (x2 - cx) / rx) - t1;
  if (sweep === 0 && span > 0) span -= 2 * Math.PI;
  if (sweep === 1 && span < 0) span += 2 * Math.PI;
  // 256 steps over at most a full turn: under a hundredth of a unit of chord
  // error at these radii, where the box has whole units of margin to spare.
  return Array.from({ length: 257 }, (_, i) => {
    const t = t1 + (span * i) / 256;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as [number, number];
  });
}

/** The painted union of the three paths — every point grown by half its own
 *  stroke, which is the whole difference between this and a bounding box. */
function ink() {
  const corners = DRAWING.flatMap((d, i) => {
    const half = Number(WIDTHS[i]) / 2;
    return flatten(d).flatMap(([x, y]) => [
      [x - half, y - half],
      [x + half, y + half],
    ]);
  });
  return { xs: corners.map(([x]) => x), ys: corners.map(([, y]) => y) };
}

// THE TOUCH ICON CENTRES THE INK, NOT THE BOX, and the two nudges that do it
// are figures — so they live here rather than in the script's own head. The
// drawing is not centred inside its viewBox, so a flex-centred box leaves the
// mark riding high on a plate that iOS then masks to a squircle. The sheet's
// tile inherits that offset; on the icon it is worth the one line.
describe('the logo mark is one drawing, kept in three text copies', () => {
  it('draws the same three paths in all of them', () => {
    expect(paths(SIDEBAR)).toEqual(DRAWING);
    expect(paths(FAVICON)).toEqual(DRAWING);
    expect(scriptPaths()).toEqual(DRAWING);
    // The template has to SPEND those consts, in order, or the two assertions
    // above agree about a drawing the PNG is not made from.
    expect(paths(SCRIPT)).toEqual(['${LOOP}', '${PILL_A}', '${PILL_B}']);
  });

  it('strokes them the same way in all of them', () => {
    for (const source of [SIDEBAR, FAVICON, SCRIPT]) {
      expect(attr(source, 'strokeWidth')).toEqual(WIDTHS);
      // Round caps on all three, and the join on the LOOP alone — it is the
      // only path with a corner to turn. A join on a two-point line is inert,
      // so a second one here is a copy drifting, not a rendering difference.
      expect(attr(source, 'strokeLinecap')).toEqual(['round', 'round', 'round']);
      expect(attr(source, 'strokeLinejoin')).toEqual(['round']);
      // `fill="none"` IS LOAD-BEARING and the loudest way to lose the mark.
      // SVG fills black by default and implicitly closes every subpath, so a
      // loop that loses this attribute renders as a solid blob with a wedge
      // beside it — and nothing else in this file reads `fill`, so every other
      // assertion here would still pass on it.
      expect(attr(source, 'fill')).toEqual(['none', 'none', 'none']);
    }
  });

  it('keeps all three copies on the same box', () => {
    for (const source of [SIDEBAR, FAVICON, SCRIPT])
      expect(source).toContain(`viewBox="${VIEW_BOX}"`);
  });
});

describe('the box holds the whole drawing', () => {
  it('nudges the touch icon by the gap between the box centre and the ink centre', () => {
    const [vx, vy, vw, vh] = VIEW_BOX.split(' ').map(Number);
    const { xs, ys } = ink();
    const nudge = (lo: number, size: number, v: number[]) =>
      lo + size / 2 - (Math.min(...v) + Math.max(...v)) / 2;
    const num = scriptNum;
    // The script converts units to pixels against its own `BOX`, so that has to
    // be the box the drawing is actually on or the nudge is scaled by the wrong
    // ratio — silently, since the two are equal today.
    expect(num('BOX'), 'the script converts units against the wrong box').toBe(vw);
    expect(num('NUDGE_X')).toBe(nudge(vx, vw, xs));
    expect(num('NUDGE_Y')).toBe(nudge(vy, vh, ys));
  });

  // THE ONE MISTAKE THE SHEET WARNS THIS ISSUE ABOUT BY NAME. `getBBox()`
  // measures geometry and ignores stroke, so a box cropped to the bounding box
  // is half a stroke short on every side and clips the loop's caps and the
  // lower pill. Containment rather than four numbers: the box may have margin —
  // the sheet's does — it may not have a deficit.
  it('paints nothing outside the box, at any size', () => {
    const [vx, vy, vw, vh] = VIEW_BOX.split(' ').map(Number);
    const { xs, ys } = ink();
    expect(Math.min(...xs), 'the drawing is clipped on the left').toBeGreaterThanOrEqual(vx);
    expect(Math.min(...ys), 'the drawing is clipped at the top').toBeGreaterThanOrEqual(vy);
    expect(Math.max(...xs), 'the drawing is clipped on the right').toBeLessThanOrEqual(vx + vw);
    expect(Math.max(...ys), 'the drawing is clipped at the bottom').toBeLessThanOrEqual(vy + vh);
  });
});

describe('each copy keeps what only it can carry', () => {
  it('leaves the favicon theme-aware, so it survives a dark browser chrome', () => {
    // A fixed colour goes invisible in one theme; the tab is painted by the
    // browser, not by the app, so the file has to carry the query itself. SIX
    // literals since the 5h mark — three parts, two themes — read PER BRANCH
    // rather than as one set, because a trio landing in the wrong branch is
    // exactly what a flat `toContain` cannot see. The default branch is the
    // light one and it has to be: Safari ignores the query entirely.
    //
    // THE COMMENT IS CUT OUT FIRST, and that is not tidiness. This repository
    // argues from its hexes in prose constantly — index.css does it on nearly
    // every token, and this file's own retired comment named one — so scanning
    // the raw prefix makes the next author who explains a value here fail a
    // test about the light trio, with nothing wrong with the light trio.
    const style = FAVICON.replace(/<!--[\s\S]*?-->/g, '');
    const at = style.indexOf('@media (prefers-color-scheme: dark)');
    expect(at, 'the favicon no longer carries a dark branch').toBeGreaterThan(-1);
    const hexes = (part: string) =>
      [...part.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
    expect(hexes(style.slice(0, at))).toEqual(LIGHT);
    expect(hexes(style.slice(at))).toEqual(DARK);
  });

  // THIS TEST EXISTS BECAUSE THE FAVICON WAS SHIPPED BLANK ONCE and nothing
  // else noticed. A double hyphen cannot appear inside an XML comment, so a
  // comment naming a custom property in full makes the whole file not
  // well-formed and the browser draws NOTHING. Every assertion above still
  // passed: they read the file as text, prettier has no parser for `.svg`, and
  // the touch icon is generated from an independent transcription. The trap is
  // specific to this repository — every colour it owns is a custom property,
  // and the favicon is the one file where naming one inside a comment is fatal
  // — so it is worth a check of its own rather than a dependency on an XML
  // parser the suite does not have.
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

  it('takes the sidebar copy from the three tokens, never a hex', () => {
    // "No ad-hoc hex in components" (CLAUDE.md) is the rule an SVG is most
    // tempted to break, since a designer's file arrives full of them. The
    // favicon and the script have to hold literals — one is standalone and the
    // other renders in a throwaway page, so neither has a token to read — and
    // the component must not. Naming all three is also what makes the mark
    // follow the theme, now that no part of it inherits `currentColor`.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('function Mark('));
    const body = block.slice(0, block.indexOf('\n}'));
    for (const token of ['stroke-logo-outline', 'stroke-logo-pill-a', 'stroke-logo-pill-b'])
      expect(body).toContain(token);
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('paints the touch icon in the dark trio, on the plate iOS needs', () => {
    // The icon is one image for both themes — iOS has no query to answer — so
    // it takes the dark values, and it takes them FROM THE STYLESHEET: this is
    // the copy furthest from the app and the only one a re-valuing would leave
    // behind silently, since a raster fails no assertion by looking wrong.
    expect([scriptConst('INK_LOOP'), scriptConst('INK_A'), scriptConst('INK_B')]).toEqual(DARK);
    // Opaque, because iOS composites home-screen icons: a transparent PNG lands
    // on whatever the springboard puts behind it. The plate is the sheet's own
    // ground for the mark on a tile, which is the app's dark `card`.
    expect(scriptConst('PLATE')).toBe(declared('dark', 'card'));
    // AND THE TEMPLATE HAS TO SPEND THEM, EACH ON ITS OWN PATH. Pinning a
    // const's value says nothing about where it is used, and checking the three
    // inks merely appear, in order, still passes when the loop and a pill trade
    // colours. So the PAIRING is what is asserted, path by path.
    for (const hole of [
      'd="${LOOP}" fill="none" stroke="${INK_LOOP}"',
      'd="${PILL_A}" fill="none" stroke="${INK_A}"',
      'd="${PILL_B}" fill="none" stroke="${INK_B}"',
      'background:${PLATE}',
      'translate(${NUDGE_X * UNIT}px,${NUDGE_Y * UNIT}px)',
    ])
      expect(SCRIPT, `the template no longer spends ${hole}`).toContain(hole);
  });

  // THE RASTER ITSELF, and not just the script that writes it. Everything above
  // keeps the GENERATOR honest, and nothing re-runs it — no gate, no CI step —
  // so a corrected script goes green over an icon still painting last year's
  // drawing. Three questions of the file on disk: is it the size the script
  // writes, are the inks the current ones, and is the mark where the current
  // geometry puts it. The last is what catches a stale icon after the DRAWING
  // moves rather than the palette, which the first two would not see.
  it('ships a touch icon the current script would write', () => {
    const size = scriptNum('PLATE_PX');
    expect(ICON.readUInt32BE(16), 'the icon is not the width the script writes').toBe(size);
    expect(ICON.readUInt32BE(20), 'the icon is not the height the script writes').toBe(size);
    // The sheet draws the mark on a tile at 64 of 96 — the inset is a figure,
    // so it is asserted here rather than written out as arithmetic over there.
    expect(scriptNum('SVG_PX'), "the mark has left the sheet's tile ratio").toBe((size * 2) / 3);

    const pixels = decode(ICON);
    const at = (x: number, y: number) =>
      `#${[0, 1, 2]
        .map((k) => pixels[(y * size + x) * 3 + k].toString(16).padStart(2, '0'))
        .join('')}`;
    const plate = scriptConst('PLATE');
    for (const corner of [
      [1, 1],
      [size - 2, size - 2],
    ])
      expect(at(corner[0], corner[1]), `the plate is wrong at ${corner}`).toBe(plate);

    const painted = new Set<string>();
    const edge = { minX: size, maxX: -1, minY: size, maxY: -1 };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const hex = at(x, y);
        painted.add(hex);
        if (hex === plate) continue;
        edge.minX = Math.min(edge.minX, x);
        edge.maxX = Math.max(edge.maxX, x);
        edge.minY = Math.min(edge.minY, y);
        edge.maxY = Math.max(edge.maxY, y);
      }
    for (const hex of DARK) expect([...painted], `the icon never paints ${hex}`).toContain(hex);

    // The svg is centred on the plate and then nudged, so where the ink lands
    // follows from `ink()` and the script's own numbers. One pixel of slack
    // each way, for the antialiased edge.
    const unit = scriptNum('SVG_PX') / scriptNum('BOX');
    const inset = (size - scriptNum('SVG_PX')) / 2;
    const [vx, vy] = VIEW_BOX.split(' ').map(Number);
    const { xs, ys } = ink();
    const onPlate = (v: number, origin: number, nudge: number) =>
      (v - origin) * unit + inset + nudge * unit;
    const nx = scriptNum('NUDGE_X');
    const ny = scriptNum('NUDGE_Y');
    for (const [side, got, want] of [
      ['left', edge.minX, onPlate(Math.min(...xs), vx, nx)],
      ['right', edge.maxX, onPlate(Math.max(...xs), vx, nx)],
      ['top', edge.minY, onPlate(Math.min(...ys), vy, ny)],
      ['bottom', edge.maxY, onPlate(Math.max(...ys), vy, ny)],
    ] as [string, number, number][])
      expect(
        Math.abs(got - want),
        `the icon's ${side} edge is at ${got}, not the ${want} the mark now needs — regenerate it`,
      ).toBeLessThanOrEqual(1);
  });
});
