import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declaredHex, stripCss, themeBlocks } from '../__fixtures__/palette';

// THE LOGO, THE «q» KNOCKED INTO A PLATE, IS DRAWN IN FOUR PLACES (*Brand*): `Mark` in
// ./Sidebar.tsx, ../../public/favicon.svg (the tab's own 16-grid drawing),
// ../../scripts/build-touch-icon.mjs, and the PNGs it writes. Comparing a raster to an SVG needs
// a renderer vitest does not have, so each PNG is pinned through its GENERATOR and then READ
// BACK, because nothing re-runs that command and a corrected script would otherwise go green
// over a stale icon. The geometry below is the signed spec's (brand.md), pinned by hand and never
// derived from the copies it checks: derived, it would agree with whatever they draw.
//
// Paths resolve from THIS file, not `process.cwd()`, or the suite goes down with ENOENT the
// moment vitest is given a different root.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments out of the two copies that are code. Not cosmetic: `Sidebar.tsx` annotates the
 *  mark it draws and the script transcribes the geometry in prose, so an unstripped read
 *  lets a comment answer for a drawing.
 *
 *  THE FAVICON IS READ RAW and must stay that way: it is XML, and the well-formedness arm
 *  below reads its `<!-- -->` comments as its subject.
 *
 *  Copied SIGNATURE AND ALL rather than imported:
 *  `ts-reader-census.test.ts` holds every copy to one text. */
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
const SIDEBAR = stripTs(readFileSync(join(here, 'Sidebar.tsx'), 'utf8'), 'Sidebar.tsx');
const RAIL = stripTs(readFileSync(join(here, 'SidebarRail.tsx'), 'utf8'), 'SidebarRail.tsx');
const SIGNED_OUT = stripTs(
  readFileSync(join(here, 'SignedOutShell.tsx'), 'utf8'),
  'SignedOutShell.tsx',
);
const FAVICON = readFileSync(join(here, '..', '..', 'public', 'favicon.svg'), 'utf8');
const SCRIPT = stripTs(
  readFileSync(join(here, '..', '..', 'scripts', 'build-touch-icon.mjs'), 'utf8'),
  'build-touch-icon.mjs',
);
/** The script's touch-icon half, from its first const to the mail's. */
const TOUCH_SCRIPT = SCRIPT.slice(
  SCRIPT.indexOf('const TOUCH_PX'),
  SCRIPT.indexOf('const MAIL_PLATE_LIGHT'),
);
const ICON = readFileSync(join(here, '..', '..', 'public', 'apple-touch-icon.png'));

const CSS = stripCss(readFileSync(join(here, '..', 'index.css'), 'utf8'), 'index.css');

const BLOCKS = themeBlocks(CSS);

/** The plate and the «q», per theme. */
const PAIR = (theme: 'light' | 'dark') => [
  declaredHex(BLOCKS, theme, 'logo-outline'),
  declaredHex(BLOCKS, theme, 'card'),
];

/** F2, the signed form in its 120 box, as `x y w h r` rounded rects (brand.md, *Signed*). */
const BOWL = [32, 21, 56, 56, 15];
const COUNTER = [48, 37, 22, 24, 6];
const STEM = [70, 49, 18, 50, 5];
const VIEW_BOX = '0 0 120 120';

/** A rounded rect as one closed path, clockwise from the top edge. */
function roundRect([x, y, w, h, r]: number[]): string {
  return `M${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h - r} A${r} ${r} 0 0 1 ${x + w - r} ${y + h} H${x + r} A${r} ${r} 0 0 1 ${x} ${y + h - r} V${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}

/** The bowl with the counter cut out of it (even-odd), then the stem: two paths, because the
 *  stem overlaps the bowl and inside one even-odd path the overlap would be cut too. */
const DRAWING = [`${roundRect(BOWL)} ${roundRect(COUNTER)}`, roundRect(STEM)];

/** T3, the tab's own drawing on the 16 grid, transcribed from brand.md, *Signed*. */
const TAB = [
  'M6 3 H10 A2 2 0 0 1 12 5 V8 A2 2 0 0 1 10 10 H6 A2 2 0 0 1 4 8 V5 A2 2 0 0 1 6 3 Z M7 5 H9 A1 1 0 0 1 10 6 V7 A1 1 0 0 1 9 8 H7 A1 1 0 0 1 6 7 V6 A1 1 0 0 1 7 5 Z',
  'M10 6 H12 V12 A1 1 0 0 1 11 13 A1 1 0 0 1 10 12 Z',
];

/** Every `d="…"` in source order. */
function paths(source: string): string[] {
  return [...source.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
}

/** One presentation attribute's values in source order, camel or kebab — JSX
 *  writes `fillRule`, the two plain files write `fill-rule`. */
function attr(source: string, name: string): string[] {
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return [...source.matchAll(new RegExp(`\\b(?:${name}|${kebab})="([^"]+)"`, 'g'))].map(
    (m) => m[1],
  );
}

/** The plate sizes `Mark` takes, as `[side, corner, «q» box]` in px, read off its table. */
function plates(): number[][] {
  return [
    ...SIDEBAR.matchAll(
      /(\d+):\s*\{\s*plate:\s*'size-\[(\d+)px\] rounded-\[(\d+)px\]',\s*q:\s*'size-\[(\d+)px\]',?\s*\}/g,
    ),
  ].map((m) => {
    expect(Number(m[2]), `the ${m[1]} entry draws a plate of another size`).toBe(Number(m[1]));
    return [Number(m[1]), Number(m[3]), Number(m[4])];
  });
}

/** The sizes a file asks `Mark` for, in source order. */
function markSizes(source: string): number[] {
  return [...source.matchAll(/<Mark size=\{(\d+)\}/g)].map((m) => Number(m[1]));
}

/** A non-interlaced 8-bit RGB PNG to raw pixels, or RGBA for the mail's mark — the five
 *  unfiltering cases of the spec, against a whole image dependency for a few questions about
 *  checked-in files. Written narrow on purpose: anything but the format the script emits
 *  throws rather than being decoded approximately. */
function decode(png: Buffer, alpha = false): Buffer {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24], 'the icon is no longer 8 bits a channel').toBe(8);
  expect(
    png[25],
    alpha
      ? 'the mail mark lost its alpha channel — its corners must take the card behind them'
      : 'the icon grew an alpha channel — iOS needs it opaque',
  ).toBe(alpha ? 6 : 2);
  expect(png[28], 'the icon is interlaced, which this walk does not undo').toBe(0);
  const idat: Buffer[] = [];
  for (let i = 8; i < png.length;) {
    const len = png.readUInt32BE(i);
    if (png.toString('ascii', i + 4, i + 8) === 'IDAT') idat.push(png.subarray(i + 8, i + 8 + len));
    i += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = alpha ? 4 : 3;
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

/** One numeric const out of the script. Its sizes and offsets are figures, so they are
 *  recomputed here rather than restated — the icon is checked against what the script says,
 *  not against a number typed twice. */
function scriptNum(name: string): number {
  const m = SCRIPT.match(new RegExp(`^const ${name} = (-?[\\d.]+);$`, 'm'));
  expect(m, `${name} is no longer a plain number in build-touch-icon.mjs`).not.toBeNull();
  return Number(m![1]);
}

/** One `'x y w h r'` rect const out of the script. */
function scriptRect(name: string): number[] {
  const m = SCRIPT.match(new RegExp(`^const ${name} = '([\\d ]+)';$`, 'm'));
  expect(m, `${name} is no longer a rect const in build-touch-icon.mjs`).not.toBeNull();
  return m![1].split(' ').map(Number);
}

/** One named const, so a colour is compared to the stylesheet rather than to a substring of
 *  the whole file — `toContain('#…')` passes on a hex surviving only in a comment. */
function scriptConst(name: string): string {
  const m = SCRIPT.match(new RegExp(`^const ${name} = '(#[0-9a-fA-F]{6})';$`, 'm'));
  expect(m, `${name} is no longer a hex const in build-touch-icon.mjs`).not.toBeNull();
  return m![1].toLowerCase();
}

/** A path flattened to points, in viewBox units. Absolute `M`/`A`/`H`/`V`/`Z` only;
 *  anything else stops the walk, because a command it cannot read is a drawing it cannot
 *  measure.
 *
 *  ARCS ARE SAMPLED, NOT ASSUMED: AN ARC'S ENDPOINTS DO NOT BOUND IT. `A16 16 0 1 1` from
 *  (72,56) to (56,72) paints 16 units past both of them — so the arc is converted to its
 *  centre form (SVG F.6.5) and walked, and the drawing can be anything. */
function flatten(d: string): [number, number][] {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: [number, number][] = [];
  let x = 0;
  let y = 0;
  let start: [number, number] = [0, 0];
  for (let i = 0; i < tokens.length;) {
    const cmd = tokens[i++];
    const n = () => Number(tokens[i++]);
    if (cmd === 'M') {
      x = n();
      y = n();
      start = [x, y];
    } else if (cmd === 'Z') {
      // SVG 2 closepath: the current point returns to the subpath's initial point.
      [x, y] = start;
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

/** The painted extent of filled paths: all fill and no stroke, so the outline is the paint. */
function ink(drawing: string[]) {
  const points = drawing.flatMap(flatten);
  return { xs: points.map(([x]) => x), ys: points.map(([, y]) => y) };
}

describe('the «q» is one drawing, F2, in every copy drawn from it', () => {
  it('draws the bowl with its counter cut out, then the stem, in the sidebar copy', () => {
    expect(paths(SIDEBAR)).toEqual(DRAWING);
    expect(attr(SIDEBAR, 'fillRule'), 'the counter is filled in').toEqual(['evenodd']);
    expect(SIDEBAR).toContain(`viewBox="${VIEW_BOX}"`);
  });

  it('draws the same rects in the script, which writes the touch icon and the mail', () => {
    expect([scriptRect('Q_BOWL'), scriptRect('Q_COUNTER'), scriptRect('Q_STEM')]).toEqual([
      BOWL,
      COUNTER,
      STEM,
    ]);
    // AND THE SCRIPT'S EXPANSION IS THIS ONE: a rect pinned here says nothing about the path
    // the template draws from it.
    const body = SCRIPT.match(/^const roundRect = \(rect\) => \{([\s\S]*?)^\};$/m);
    expect(body, 'roundRect is no longer the script’s rect expansion').not.toBeNull();
    const expand = new Function('rect', body![1]) as (rect: string) => string;
    expect(expand(BOWL.join(' '))).toBe(roundRect(BOWL));
    expect(expand(STEM.join(' '))).toBe(roundRect(STEM));
  });

  // THE PAINT IS CENTRED IN ITS BOX, which is why every copy centres the box and none nudges
  // it: a «q» riding off-centre on its plate would need a per-copy offset.
  it('paints inside the 120 box, centred on it', () => {
    const [vx, vy, vw, vh] = VIEW_BOX.split(' ').map(Number);
    const { xs, ys } = ink(DRAWING);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(vx);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(vy);
    expect(Math.max(...xs)).toBeLessThanOrEqual(vx + vw);
    expect(Math.max(...ys)).toBeLessThanOrEqual(vy + vh);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(vx + vw / 2, 6);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(vy + vh / 2, 6);
  });
});

describe('the sidebar copy is the «q» on its plate, at the lockup’s two sizes', () => {
  // K1: the larger plate in the sidebar and the rail, the smaller in the signed-out header. The
  // corner is the shape system's rule, the «q» the lockup's ratio of the side.
  it('sizes each plate by the shape rule, with the «q» at 22/40', () => {
    expect(plates()).toEqual([
      [40, 10, 22],
      [28, 7, 15],
    ]);
    for (const [side, corner, q] of plates()) {
      expect(corner, `the ${side} plate's corner`).toBe(Math.round(side * 0.26));
      expect(q, `the ${side} plate's «q»`).toBe(Math.round((side * 22) / 40));
    }
  });

  it('draws the 40 in the sidebar and the rail, and the 28 in the signed-out header', () => {
    expect(markSizes(SIDEBAR)).toEqual([40]);
    expect(markSizes(RAIL)).toEqual([40]);
    expect(markSizes(SIGNED_OUT)).toEqual([28]);
  });

  it('takes the plate and the «q» from their tokens, never a hex, and stays decorative', () => {
    // Naming both is what makes the logo follow the theme; neither part may inherit
    // `currentColor`. The wordmark beside it says the brand, so the copy is `aria-hidden`.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('function Mark('));
    const body = block.slice(0, block.indexOf('\n}'));
    expect(body).toContain('bg-logo-outline');
    expect(
      body.match(/\bfill-card\b/g),
      'each of the two paths is filled from `card`',
    ).toHaveLength(2);
    expect(body).toContain('aria-hidden="true"');
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });
});

describe('the tab is T3, its own drawing on the 16 grid', () => {
  it('draws the signed paths on a 16 plate at r4', () => {
    expect(FAVICON).toContain('viewBox="0 0 16 16"');
    expect(FAVICON).toMatch(/<rect class="plate" width="16" height="16" rx="4"\s*\/>/);
    expect(paths(FAVICON)).toEqual(TAB);
    expect(attr(FAVICON, 'fillRule'), 'the counter is filled in').toEqual(['evenodd']);
    expect(attr(FAVICON, 'class')).toEqual(['plate', 'q', 'q']);
  });

  // Primer: "Align the outer edge of shapes to pixel boundaries when possible".
  it('keeps every coordinate on the pixel grid, inside the box', () => {
    for (const d of TAB)
      for (const n of d.match(/-?\d+(?:\.\d+)?/g)!) expect(Number.isInteger(Number(n))).toBe(true);
    const { xs, ys } = ink(TAB);
    expect(Math.min(...xs, ...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs, ...ys)).toBeLessThanOrEqual(16);
  });

  it('paints the light pair by default and the dark pair under the dark query', () => {
    // A fixed colour goes invisible in one theme, and the tab is painted by the browser, so
    // the file carries the query itself. Read PER BRANCH, because a pair landing in the wrong
    // branch is what a flat `toContain` cannot see. The default branch has to be the light
    // one: Safari ignores the query entirely.
    //
    // THE COMMENT IS CUT OUT FIRST: this repository argues from its hexes in prose, so
    // scanning the raw prefix would fail the next author who explains a value here.
    const style = FAVICON.replace(/<!--[\s\S]*?-->/g, '');
    const at = style.indexOf('@media (prefers-color-scheme: dark)');
    expect(at, 'the favicon no longer carries a dark branch').toBeGreaterThan(-1);
    const fills = (part: string) =>
      [...part.matchAll(/\.(plate|q) \{ fill: (#[0-9a-fA-F]{6}) \}/g)].map((m) => [
        m[1],
        m[2].toLowerCase(),
      ]);
    const [plate, q] = PAIR('light');
    const [darkPlate, darkQ] = PAIR('dark');
    expect(fills(style.slice(0, at))).toEqual([
      ['plate', plate],
      ['q', q],
    ]);
    expect(fills(style.slice(at))).toEqual([
      ['plate', darkPlate],
      ['q', darkQ],
    ]);
  });

  // THIS TEST EXISTS BECAUSE THE FAVICON WAS SHIPPED BLANK ONCE and nothing else noticed. A
  // double hyphen cannot appear inside an XML comment, so a comment naming a custom property
  // in full makes the file not well-formed and the browser draws NOTHING — while every
  // assertion above passes, since they read it as text and prettier has no `.svg` parser.
  // The trap is specific to this repository: every colour it owns is a custom property.
  it('keeps the favicon well-formed, so it does not render blank', () => {
    const comments = [...FAVICON.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
    expect(
      comments.length,
      'no comment to check — a vacuous pass is worse than none',
    ).toBeGreaterThan(0);
    for (const body of comments) expect(body).not.toContain('--');
    expect(
      FAVICON.match(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g),
      'the favicon holds a bare `&`, which is an entity start — the other classic way to ' +
        'kill an SVG',
    ).toBeNull();
  });
});

describe('the touch icon is I1: the copper plate, full-bleed, the «q» at 22/40', () => {
  // One image for every iOS appearance, since iOS has no query to answer: the LIGHT pair, from
  // the stylesheet, because this is the copy furthest from the app and a re-valuing leaves a
  // raster behind silently.
  it('paints the light pair, read from the stylesheet', () => {
    expect([scriptConst('TOUCH_PLATE'), scriptConst('TOUCH_Q')]).toEqual(PAIR('light'));
  });

  it('sizes the plate at 180 and the «q» box at 22/40 of it', () => {
    const px = scriptNum('TOUCH_PX');
    expect(px, 'Apple’s apple-touch-icon size').toBe(180);
    expect(scriptNum('TOUCH_Q_PX')).toBe((px * 22) / 40);
  });

  it('spends each const in the template, on an unmasked opaque square', () => {
    for (const hole of [
      'width:${TOUCH_PX}px;height:${TOUCH_PX}px',
      'background:${TOUCH_PLATE}',
      'width:${TOUCH_Q_PX}px;height:${TOUCH_Q_PX}px',
      'd="${roundRect(Q_BOWL)} ${roundRect(Q_COUNTER)}" fill-rule="evenodd" fill="${TOUCH_Q}"',
      'd="${roundRect(Q_STEM)}" fill="${TOUCH_Q}"',
    ])
      expect(TOUCH_SCRIPT, `the template no longer spends ${hole}`).toContain(hole);
    // iOS applies the mask; a corner drawn here would be masked twice.
    expect(TOUCH_SCRIPT).not.toContain('border-radius');
  });

  // THE RASTER ITSELF, not just the script that writes it: nothing re-runs the script — no
  // gate, no CI step — so a corrected script goes green over an icon still painting the old
  // drawing. The size, the opaque plate to the corners, the counter, and where the «q» lands.
  it('ships a touch icon the current script would write', () => {
    const size = scriptNum('TOUCH_PX');
    expect(ICON.readUInt32BE(16), 'the icon is not the width the script writes').toBe(size);
    expect(ICON.readUInt32BE(20), 'the icon is not the height the script writes').toBe(size);
    const pixels = decode(ICON);
    const at = (x: number, y: number) =>
      `#${[0, 1, 2]
        .map((k) => pixels[(y * size + x) * 3 + k].toString(16).padStart(2, '0'))
        .join('')}`;
    const plate = scriptConst('TOUCH_PLATE');
    const q = scriptConst('TOUCH_Q');
    for (const [x, y] of [
      [0, 0],
      [size - 1, 0],
      [0, size - 1],
      [size - 1, size - 1],
    ])
      expect(at(x, y), `the plate is not full-bleed at ${x},${y}`).toBe(plate);

    // Where the «q» lands follows from its box, drawn TOUCH_Q_PX wide and centred.
    const unit = scriptNum('TOUCH_Q_PX') / 120;
    const inset = (size - scriptNum('TOUCH_Q_PX')) / 2;
    const onPlate = (v: number) => v * unit + inset;
    const [cx, cy, cw, ch] = COUNTER;
    expect(
      at(Math.floor(onPlate(cx + cw / 2)), Math.floor(onPlate(cy + ch / 2))),
      'the counter is filled in',
    ).toBe(plate);

    // EVERY PIXEL OFF THE PLATE, antialiased ones included: the 99 box's 40.5 inset is snapped
    // to a whole pixel, so the first pixel in the «q»'s exact colour can sit past the slack.
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
    expect([...painted], 'the icon never paints the «q»').toContain(q);
    const { xs, ys } = ink(DRAWING);
    // One pixel of slack, for the antialiased edge.
    for (const [side, got, want] of [
      ['left', edge.minX, onPlate(Math.min(...xs))],
      ['right', edge.maxX + 1, onPlate(Math.max(...xs))],
      ['top', edge.minY, onPlate(Math.min(...ys))],
      ['bottom', edge.maxY + 1, onPlate(Math.max(...ys))],
    ] as [string, number, number][])
      expect(
        Math.abs(got - want),
        `the «q»'s ${side} edge is at ${got}, not ${want} — regenerate the touch icon`,
      ).toBeLessThanOrEqual(1);
  });
});

// THE MAIL'S MARK is the sidebar's plate at 2×, one PNG per theme with transparent corners, drawn
// from the same rects; the two PNGs are read back as the touch icon is.
describe("the mail's mark is the «q» on its plate, in both themes", () => {
  const THEMES = [
    ['light', 'MAIL_PLATE_LIGHT', 'MAIL_Q_LIGHT'],
    ['dark', 'MAIL_PLATE_DARK', 'MAIL_Q_DARK'],
  ] as const;

  it('draws the bowl with its counter cut out, and the stem', () => {
    expect(SCRIPT).toContain(
      'd="${roundRect(Q_BOWL)} ${roundRect(Q_COUNTER)}" fill-rule="evenodd"',
    );
    expect(SCRIPT).toContain('d="${roundRect(Q_STEM)}"');
  });

  it('paints the plate in `logo-outline` and the «q» in `card`, per theme', () => {
    for (const [theme, plate, q] of THEMES) {
      expect(scriptConst(plate), `${theme} plate`).toBe(declaredHex(BLOCKS, theme, 'logo-outline'));
      expect(scriptConst(q), `${theme} «q»`).toBe(declaredHex(BLOCKS, theme, 'card'));
      expect(SCRIPT).toContain(`['${theme}', ${plate}, ${q}]`);
    }
    for (const hole of ['background:${plate}', 'fill="${q}"', 'border-radius:${MAIL_RADIUS}px'])
      expect(SCRIPT, `the template no longer spends ${hole}`).toContain(hole);
  });

  it('sizes the 40 plate at 2×, with the shape system’s corner and the «q» at 22/40', () => {
    const px = scriptNum('MAIL_PX');
    expect(px).toBe(80);
    expect(scriptNum('MAIL_RADIUS')).toBe(2 * Math.round(40 * 0.26));
    expect(scriptNum('MAIL_Q_PX')).toBe((px * 22) / 40);
  });

  it.each(THEMES)('ships a %s PNG the current script would write', (theme, plateName, qName) => {
    const png = readFileSync(join(here, '..', '..', 'public', 'email', `mark-${theme}.png`));
    const size = scriptNum('MAIL_PX');
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    const pixels = decode(png, true);
    const at = (x: number, y: number) => {
      const i = (y * size + x) * 4;
      const hex = `#${[0, 1, 2].map((k) => pixels[i + k].toString(16).padStart(2, '0')).join('')}`;
      return { hex, alpha: pixels[i + 3] };
    };
    const plate = scriptConst(plateName);
    const q = scriptConst(qName);
    expect(at(0, 0).alpha, 'the corner is painted — it must take the card behind it').toBe(0);
    expect(at(size - 1, size - 1).alpha).toBe(0);
    expect(at(size / 2, 4)).toEqual({ hex: plate, alpha: 255 });

    // Where the «q» lands follows from its box, drawn MAIL_Q_PX wide and centred on the plate.
    const unit = scriptNum('MAIL_Q_PX') / 120;
    const inset = (size - scriptNum('MAIL_Q_PX')) / 2;
    const onPlate = (v: number) => v * unit + inset;
    const [bx, by, bw, bh] = scriptRect('Q_BOWL');
    const [cx, cy, cw, ch] = scriptRect('Q_COUNTER');
    const [sx, sy, sw, sh] = scriptRect('Q_STEM');
    // The counter shows the plate: the even-odd cut is what makes it a «q» and not a block.
    const counter = at(Math.floor(onPlate(cx + cw / 2)), Math.floor(onPlate(cy + ch / 2)));
    expect(counter, 'the counter is filled in').toEqual({ hex: plate, alpha: 255 });

    const edge = { minX: size, maxX: -1, minY: size, maxY: -1 };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const p = at(x, y);
        if (p.hex !== q || p.alpha !== 255) continue;
        edge.minX = Math.min(edge.minX, x);
        edge.maxX = Math.max(edge.maxX, x);
        edge.minY = Math.min(edge.minY, y);
        edge.maxY = Math.max(edge.maxY, y);
      }
    // One pixel of slack, for the antialiased edge.
    for (const [side, got, want] of [
      ['left', edge.minX, onPlate(Math.min(bx, sx))],
      ['right', edge.maxX + 1, onPlate(Math.max(bx + bw, sx + sw))],
      ['top', edge.minY, onPlate(Math.min(by, sy))],
      ['bottom', edge.maxY + 1, onPlate(Math.max(by + bh, sy + sh))],
    ] as [string, number, number][])
      expect(
        Math.abs(got - want),
        `the «q»'s ${side} edge is at ${got}, not ${want} — regenerate the mail's mark`,
      ).toBeLessThanOrEqual(1);
  });
});
