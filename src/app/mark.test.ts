import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE LOGO MARK SHIPS IN THREE COPIES AND IS DRAWN IN FOUR PLACES: `Mark` in ./Sidebar.tsx,
// ../../public/favicon.svg, ../../public/apple-touch-icon.png, and the
// ../../scripts/build-touch-icon.mjs that writes that raster. Comparing a raster to an SVG
// needs a renderer vitest does not have, so the PNG is pinned through its GENERATOR — and
// THEN READ BACK, because nothing re-runs that command and a corrected script would
// otherwise go green over a stale icon. The drawing is transcribed from
// `design/extensions/parchment-5h.dc.html`, never re-derived: that would invent a second
// authority beside the sheet.
//
// STRING EQUALITY RUNS FIRST AND IS THE STRICTER GATE — a re-export drawing the same curve
// a different way fails there and never reaches the geometry, because the three copies being
// ONE drawing is the property most worth keeping. The geometric test underneath is the case
// equality cannot see: a box that clips the ink.
//
// Paths resolve from THIS file, not `process.cwd()`, or the suite goes down with ENOENT the
// moment vitest is given a different root.
const here = dirname(fileURLToPath(import.meta.url));
/** Comments out of the two copies that are code. Not cosmetic: `Sidebar.tsx` annotates the
 *  mark it draws and the script transcribes the geometry in prose, so an unstripped read
 *  lets a comment answer for a drawing. QUOTE-EXACT AND LINE BY LINE, the half a regex
 *  cannot do — dropping only whole-line `//` comments leaves the trailing ones, and one
 *  apostrophe in prose then desynchronises every quote pair after it.
 *
 *  THE FAVICON IS READ RAW and must stay that way: it is XML, and the well-formedness arm
 *  below reads its `<!-- -->` comments as its subject.
 *
 *  Copied SIGNATURE AND ALL rather than imported — the house idiom is a guard that stands
 *  alone, and a copy that drifts in shape cannot be folded back if they are ever pooled.
 *  INJECTION-VERIFIED: a trailing `// d="M0 0"` in `Sidebar.tsx` leaves this green and turned it
 *  red while the copy was read unstripped — a comment drew a fourth path. */
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
const SIDEBAR = stripTs(readFileSync(join(here, 'Sidebar.tsx'), 'utf8'));
const FAVICON = readFileSync(join(here, '..', '..', 'public', 'favicon.svg'), 'utf8');
const SCRIPT = stripTs(
  readFileSync(join(here, '..', '..', 'scripts', 'build-touch-icon.mjs'), 'utf8'),
);
const ICON = readFileSync(join(here, '..', '..', 'public', 'apple-touch-icon.png'));

/** `index.css` line 5 holds a literal comment opener inside a string, so a plain regex strip
 *  swallows `@theme` with it. Stripping is not tidiness here: this file reads the stylesheet
 *  at MODULE scope, so a hex written in prose does not fail one assertion — it collapses the
 *  suite before the favicon-blank guard has run.
 *
 *  Copied from `palette-mirror.test.ts` SIGNATURE AND ALL — the guards in this directory each
 *  carry their own copy, and one that drifts in shape cannot be folded back if they are ever
 *  pooled. This one HAS drifted: `} else out += c;` against the braced form next door. */
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

/** What `index.css` DECLARES for one colour, so the two files holding the mark as literals
 *  cannot become a third opinion about the palette: the assertion is "the favicon holds
 *  whatever index.css holds", which survives the next re-valuing. SLICED rather than
 *  matched, since a name interpolated into a `RegExp` is one stray escape from a pattern
 *  that matches the wrong thing and still passes. LAST declaration, and `@theme` behind the
 *  dark block, because that is what the browser does.
 *
 *  A `var()` ALIAS FAILS HERE RATHER THAN RESOLVING, unlike the `resolve()` the sibling
 *  guards carry — none of these four is one, and a red test naming the day that stopped is
 *  better than a silent half-read. */
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

/** The script INTERPOLATES its paths, so `paths(SCRIPT)` reads back the holes and the
 *  drawing lives in three consts; both halves are checked below. `=\s*` and not `= `,
 *  because prettier puts a long path on its own line under the `const` and a space-only
 *  matcher silently found two paths of three. */
function scriptPaths(): string[] {
  return [...SCRIPT.matchAll(/^const (?:LOOP|PILL_A|PILL_B) =\s*'([^']+)';$/gm)].map((m) => m[1]);
}

/** A non-interlaced 8-bit RGB PNG to raw pixels — the five unfiltering cases of the spec,
 *  against a whole image dependency for two questions about one checked-in file. Written
 *  narrow on purpose: anything but the format the script emits throws rather than being
 *  decoded approximately. */
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

/** One numeric const out of the script. Its sizes and offsets are figures, so they are
 *  recomputed here rather than restated — the icon is checked against what the script says,
 *  not against a number typed twice. */
function scriptNum(name: string): number {
  const m = SCRIPT.match(new RegExp(`^const ${name} = (-?[\\d.]+);$`, 'm'));
  expect(m, `${name} is no longer a plain number in build-touch-icon.mjs`).not.toBeNull();
  return Number(m![1]);
}

/** One named const, so a colour is compared to the stylesheet rather than to a substring of
 *  the whole file — `toContain('#…')` passes on a hex surviving only in a comment. */
function scriptConst(name: string): string {
  const m = SCRIPT.match(new RegExp(`^const ${name} = '(#[0-9a-fA-F]{6})';$`, 'm'));
  expect(m, `${name} is no longer a hex const in build-touch-icon.mjs`).not.toBeNull();
  return m![1].toLowerCase();
}

/** The three paths flattened to points, in viewBox units. Absolute `M`/`A`/`H`/`V` only;
 *  anything else stops the walk, because a command it cannot read is a drawing it cannot
 *  measure.
 *
 *  ARCS ARE SAMPLED, NOT ASSUMED: AN ARC'S ENDPOINTS DO NOT BOUND IT. `A16 16 0 1 1` from
 *  (72,56) to (56,72) paints 16 units past both of them, and `A30 4 0 0 1` from (88,54) to
 *  (96,62) swings 26 past — so the arc is converted to its centre form (SVG F.6.5) and
 *  walked, and the drawing can be anything. */
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

// THE TOUCH ICON CENTRES THE INK, NOT THE BOX: the drawing is not centred inside its
// viewBox, so a flex-centred box leaves the mark riding high on a plate iOS then masks to a
// squircle.
describe('the logo mark is one drawing, kept in three text copies', () => {
  it('draws the same three paths in all of them', () => {
    expect(paths(SIDEBAR)).toEqual(DRAWING);
    expect(paths(FAVICON)).toEqual(DRAWING);
    expect(scriptPaths()).toEqual(DRAWING);
    expect(
      paths(SCRIPT),
      'the template no longer spends those consts in order — the assertions above then ' +
        'agree about a drawing the PNG is not made from',
    ).toEqual(['${LOOP}', '${PILL_A}', '${PILL_B}']);
  });

  it('strokes them the same way in all of them', () => {
    for (const source of [SIDEBAR, FAVICON, SCRIPT]) {
      expect(attr(source, 'strokeWidth')).toEqual(WIDTHS);
      // The join is on the LOOP alone — the only path with a corner to turn. A join on a
      // two-point line is inert, so a second one is a copy drifting, not a rendering change.
      expect(attr(source, 'strokeLinecap')).toEqual(['round', 'round', 'round']);
      expect(attr(source, 'strokeLinejoin')).toEqual(['round']);
      // `fill="none"` IS LOAD-BEARING and the loudest way to lose the mark: SVG fills black
      // by default and implicitly closes every subpath, so a loop losing it renders as a
      // solid blob — and nothing else here reads `fill`.
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
    // The script converts units to pixels against its own `BOX`, so that has to be the box
    // the drawing is on or the nudge is scaled by the wrong ratio — silently, since the two
    // are equal today.
    expect(num('BOX'), 'the script converts units against the wrong box').toBe(vw);
    expect(num('NUDGE_X')).toBe(nudge(vx, vw, xs));
    expect(num('NUDGE_Y')).toBe(nudge(vy, vh, ys));
  });

  // `getBBox()` measures geometry and ignores stroke, so a box cropped to the bounding box
  // is half a stroke short on every side and clips the loop's caps and the lower pill.
  // Containment rather than four numbers: the box may have margin, not a deficit.
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
    // A fixed colour goes invisible in one theme, and the tab is painted by the browser, so
    // the file carries the query itself. Read PER BRANCH rather than as one set, because a
    // trio landing in the wrong branch is what a flat `toContain` cannot see. The default
    // branch has to be the light one: Safari ignores the query entirely.
    //
    // THE COMMENT IS CUT OUT FIRST, and that is not tidiness: this repository argues from
    // its hexes in prose constantly, so scanning the raw prefix would make the next author
    // who explains a value here fail a test about the light trio.
    const style = FAVICON.replace(/<!--[\s\S]*?-->/g, '');
    const at = style.indexOf('@media (prefers-color-scheme: dark)');
    expect(at, 'the favicon no longer carries a dark branch').toBeGreaterThan(-1);
    const hexes = (part: string) =>
      [...part.matchAll(/#[0-9a-fA-F]{6}/g)].map((m) => m[0].toLowerCase());
    expect(hexes(style.slice(0, at))).toEqual(LIGHT);
    expect(hexes(style.slice(at))).toEqual(DARK);
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

  it('leaves the sidebar copy decorative, so the wordmark is not read twice', () => {
    expect(SIDEBAR).toContain('aria-hidden="true"');
  });

  it('takes the sidebar copy from the three tokens, never a hex', () => {
    // "No ad-hoc hex in components" is the rule an SVG is most tempted to break, since a
    // designer's file arrives full of them. The favicon and the script have to hold
    // literals — neither has a token to read — and the component must not. Naming all three
    // is also what makes the mark follow the theme, no part of it inheriting `currentColor`.
    const block = SIDEBAR.slice(SIDEBAR.indexOf('function Mark('));
    const body = block.slice(0, block.indexOf('\n}'));
    for (const token of ['stroke-logo-outline', 'stroke-logo-pill-a', 'stroke-logo-pill-b'])
      expect(body).toContain(token);
    expect(body.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('paints the touch icon in the dark trio, on the plate iOS needs', () => {
    // One image for both themes — iOS has no query to answer — so it takes the dark values
    // FROM THE STYLESHEET: this is the copy furthest from the app and the only one a
    // re-valuing leaves behind silently, since a raster fails no assertion by looking wrong.
    expect([scriptConst('INK_LOOP'), scriptConst('INK_A'), scriptConst('INK_B')]).toEqual(DARK);
    expect(
      scriptConst('PLATE'),
      'the plate left the stylesheet, and iOS composites home-screen icons — a transparent ' +
        'PNG lands on whatever the springboard puts behind it',
    ).toBe(declared('dark', 'card'));
    // AND THE TEMPLATE HAS TO SPEND THEM, EACH ON ITS OWN PATH: pinning a const's value says
    // nothing about where it is used, and checking the inks merely appear in order still
    // passes when the loop and a pill trade colours. The PAIRING is what is asserted.
    for (const hole of [
      'd="${LOOP}" fill="none" stroke="${INK_LOOP}"',
      'd="${PILL_A}" fill="none" stroke="${INK_A}"',
      'd="${PILL_B}" fill="none" stroke="${INK_B}"',
      'background:${PLATE}',
      'translate(${NUDGE_X * UNIT}px,${NUDGE_Y * UNIT}px)',
    ])
      expect(SCRIPT, `the template no longer spends ${hole}`).toContain(hole);
  });

  // THE RASTER ITSELF, not just the script that writes it: everything above keeps the
  // GENERATOR honest, and nothing re-runs it — no gate, no CI step — so a corrected script
  // goes green over an icon still painting the old drawing. Three questions of the file on
  // disk: is it the size the script writes, are the inks current, and is the mark where the
  // current geometry puts it. The last is what catches a stale icon after the DRAWING moves
  // rather than the palette.
  it('ships a touch icon the current script would write', () => {
    const size = scriptNum('PLATE_PX');
    expect(ICON.readUInt32BE(16), 'the icon is not the width the script writes').toBe(size);
    expect(ICON.readUInt32BE(20), 'the icon is not the height the script writes').toBe(size);
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

    // The svg is centred on the plate and then nudged, so where the ink lands follows from
    // `ink()` and the script's own numbers. One pixel of slack, for the antialiased edge.
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
