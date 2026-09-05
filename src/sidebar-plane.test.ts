import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE WALL FOLLOWS THE THEME, AND THE ACTIVE ROUTE IS SAID TWICE.
//
// Until #92 the sidebar was a DARK plane inside a light theme, and four things
// were built on that: `text-white` on the capital card, `bg-sidebar/40` on two
// overlays, `pos-on-dark`, and the `[data-dark-surface]` scope that forced dark
// furniture onto a rail the light theme drew dark anyway. The parchment sheet
// replaces the premise — the sidebar is a step deeper than the canvas, a wall
// rather than a surface — so it is #e8e1d6 under #efeae2 in light and #0d0d0c
// under #111110 in dark, and every one of those four loses its reason.
//
// THE ACTIVE ITEM IS THE OTHER HALF, and it is an accessibility ruling rather
// than a repaint: a light lozenge says "current" with colour alone, which 1.4.1
// does not accept. The sheet draws a tint PLUS a 2px inset left edge, and the
// indicator is the half that survives a colour-blind reading.
//
// TWO HALVES, NEITHER CATCHING THE OTHER — the split `field-border.test.ts` and
// `floating-edges.test.ts` both record. THE CSS HALF is arithmetic on the
// tokens: a "tidy the palette" edit could put the wall's foreground back under
// the bar with every other test green. THE MARKUP HALF is which recipe the rail
// actually paints; the tokens can be perfect and the pill still carry the old
// lozenge, because nothing else reads `Sidebar.tsx` for colour.
//
// WHAT IS DELIBERATELY NOT HERE: `sb-label`, at 3.09 : 1 light and 4.33 dark on
// the nav group headers and the version badge. It is under 1.4.3 and it ships —
// the design session's own value, costed against two alternatives (darken three
// steps; move the consumers onto `sb-item`) and ruled by the owner in #90, with
// the sheet telling #92 by name to adopt it and not "fix" it in passing.
// `palette-mirror.test.ts` records it AT its value, which is where a shortfall
// with a reason belongs; a floor here would be this branch quietly overruling
// that. Same for `sb-border`, `sb-icon`, `sb-icon-active`, `sb-divider`,
// `sb-badge`, `sb-badge-bg` and `sb-footer-bg`: declared, and this app has
// nothing to draw with them.
//
// SELF-CONTAINED ON PURPOSE, the house idiom — the primitives below are the
// same ones `floating-edges.test.ts` carries, copied rather than shared.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** CSS comments out, quote-aware. Not cosmetic: `index.css` quotes token
 *  declarations in its prose constantly, so a comment could otherwise satisfy an
 *  assertion the stylesheet fails. Quote-aware because the file's `@source` line
 *  holds a literal comment opener inside a string, and a naive regex swallows
 *  `@theme` along with it. */
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
      if (end === -1) throw new Error(`${what} has an unterminated comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** TS comments out, LINE BY LINE, and the line boundary is the point: a regex
 *  literal may hold a quote, and one desync would switch stripping off for the
 *  rest of the file and let a commented-out token satisfy the markup half. */
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

const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbHex = (ch: number[]) =>
  '#' + ch.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');

/** sRGB → relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const ch = channels(hex).map((c) => c / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function ratio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The span of a `selector { … }` rule, matched on its own braces. */
function ruleBody(source: string, opener: string): string {
  const at = source.indexOf(opener + ' {');
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
const THEMES = ['light', 'dark'] as const;

function declaredIn(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** Follows a `var(--color-x)` chain to the hex at the end of it, the way the
 *  cascade does: a name the dark block does not override resolves against
 *  `@theme`, so looking only in one block would fail a token the browser
 *  renders. */
function resolve(block: string, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle: ${[...seen, name].join(' → ')}`).not.toContain(
    name,
  );
  const value = declaredIn(block, name) ?? declared(BLOCKS.light, name);
  const alias = value.match(/^var\(\s*--color-([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (alias) return resolve(block, alias[1], [...seen, name]);
  const hex = value.toLowerCase();
  expect(hex, `--color-${name} is neither a hex nor a --color-* alias (got ${value})`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

/** THE ACTIVE AND HOVER GROUNDS ARE DECLARED TRANSLUCENT, so a reading against
 *  one has to composite it first. Reading the bare wall instead would flatter
 *  the figures: the active label sits on its own 12 % tint, which is LIGHTER
 *  than the wall in light and darker in dark, and in light that costs 0.6 of a
 *  ratio point. The sheet scores it on its own ground and so does this. */
function tint(block: string, name: string): { ch: number[]; alpha: number } {
  const value = declaredIn(block, name) ?? declared(BLOCKS.light, name);
  const m = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/);
  expect(m, `--color-${name} is not an rgba(…) — this pin composites a tint`).not.toBeNull();
  return { ch: [+m![1], +m![2], +m![3]], alpha: +m![4] };
}

const over = (veil: { ch: number[]; alpha: number }, behind: string) =>
  rgbHex(veil.ch.map((c, i) => c * veil.alpha + channels(behind)[i] * (1 - veil.alpha)));

describe('the wall carries its own foreground, in whichever theme is on', () => {
  // 4.5, because these are LABELS. An idle route name is the most-read text on
  // the plane and 1.4.3 binds it; the wall is what it is drawn on, with nothing
  // in between.
  it.each(THEMES)('%s: an idle route clears 4.5 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-item'), resolve(BLOCKS[theme], 'sb-bg')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // EXACT, NOT A FLOOR, because this is a ruled shortfall and the file treats
  // those one way. The active label sits on its own 12% tint rather than the
  // bare wall, and there it reads 3.88 in light — under 1.4.3's 4.5 for 13.5px
  // text, where the lozenge it replaced cleared with room. What buys it is
  // 1.4.1: the lozenge said the state in colour alone, and the 2px indicator is
  // the half that answers that. The indicator does nothing for 1.4.3, so this
  // number is a cost and is written down as one.
  //
  // A FLOOR HERE WAS THE FIRST DRAFT AND WAS WRONG in the way this file itself
  // argues two describes below: `>= 3` lets a later palette edit walk the label
  // from 3.88 to 3.001 with the suite green and nothing recording what was
  // actually accepted. Pinned, both a repair and a drift have to come here.
  it.each([
    ['light', 3.88],
    ['dark', 8.283],
  ] as const)('%s: the active label on its own tint, at the ruled value', (theme, expected) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-active-bg'), resolve(BLOCKS[theme], 'sb-bg'));
    expect(ratio(resolve(BLOCKS[theme], 'sb-item-active'), ground)).toBeCloseTo(expected, 2);
  });

  // THE HALF THAT SURVIVES A COLOUR-BLIND READING. Non-text, so 1.4.11's 3 : 1
  // binds, and it is read against the WALL rather than the tint: the 2px inset
  // edge is drawn at the item's own left edge, where the tint's own ground stops.
  it.each(THEMES)('%s: the 2px indicator clears 3 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-indicator'), resolve(BLOCKS[theme], 'sb-bg')),
    ).toBeGreaterThanOrEqual(3);
  });

  // Hover is a GROUND and the state is the text lifting to `sb-item-hover`, so
  // the pair has to be read composited or the reading is of a colour nothing
  // paints.
  it.each(THEMES)('%s: a hovered route clears 4.5 : 1 on its own ground', (theme) => {
    const wall = resolve(BLOCKS[theme], 'sb-bg');
    expect(
      ratio(
        resolve(BLOCKS[theme], 'sb-item-hover'),
        over(tint(BLOCKS[theme], 'sb-item-hover-bg'), wall),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the wall's field rank carries the figures drawn on it", () => {
  // The capital card and the currency track are this app's two `sb-field` boxes —
  // the sheet's own Mapping says so, having drawn a search field there that this
  // app does not have.
  it.each(THEMES)('%s: the capital figure and its gain clear 4.5 : 1 on `sb-field`', (theme) => {
    const field = resolve(BLOCKS[theme], 'sb-field');
    expect(ratio(resolve(BLOCKS[theme], 'ink'), field), 'the figure').toBeGreaterThanOrEqual(4.5);
    // `pos`, not `pos-on-dark`: the plane is no longer dark in both themes, so
    // the gain follows the theme like every other delta in the app.
    expect(ratio(resolve(BLOCKS[theme], 'pos'), field), 'the gain').toBeGreaterThanOrEqual(4.5);
  });

  // THE WALL IS ALSO A CARD PLANE, on two screens, and the pair drawn there is
  // not the pair drawn on `sb-field`. `KpiCard`'s `wall` tone borrows the rail's
  // plane for one headline card per screen, so `/overview` and `/payouts` paint
  // `ink` and `pos` on `sb-bg` — neither of which the `sb-field` readings above
  // can speak for. Without this a re-value of `pos`, or one step on the wall,
  // takes those sub-lines under 4.5 with the suite green.
  it.each(THEMES)('%s: the wall-toned KPI card clears 4.5 : 1 on `sb-bg`', (theme) => {
    const wall = resolve(BLOCKS[theme], 'sb-bg');
    expect(ratio(resolve(BLOCKS[theme], 'ink'), wall), 'the value').toBeGreaterThanOrEqual(4.5);
    expect(ratio(resolve(BLOCKS[theme], 'pos'), wall), 'the gain sub-line').toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(resolve(BLOCKS[theme], 'sb-item'), wall), 'the label').toBeGreaterThanOrEqual(4.5);
  });

  // THE SELECTED SEGMENT'S LABEL SITS ON THE ACCENT, NOT ON THE WALL, and the
  // token that names it is `accent-fg` rather than `sb-bg`: `sb-item-active` IS
  // `accent` in both themes, and `sb-bg` on it reads 4.489 in light — under the
  // bar by a hundredth, on 12px bold text. `accent-fg` is the foreground the
  // palette mints for exactly this fill, and it clears with room.
  it.each(THEMES)('%s: the selected currency clears 4.5 : 1 on its thumb', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'accent-fg'), resolve(BLOCKS[theme], 'sb-item-active')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// A RULED SHORTFALL, RECORDED AT ITS VALUE — the house pattern for a reading the
// owner has accepted, and the reason it is here rather than in
// `palette-mirror.test.ts` is that the ground is a COMPOSITE and that file's
// table resolves two token names.
//
// The drawer floats over `scrim`, so what identifies it is its fill against that
// veil. Light used to read 5.10 — the figure #98 used to rule that the drawer
// needs no stroke in light, which is why `--color-drawer-edge` is `transparent`
// there. #92 gave the wall to the theme and the same reading is 2.94, two per
// cent under 1.4.11's 3 : 1. The owner ruled the value stands rather than
// putting an `ink` hairline around a parchment drawer.
//
// PINNED EXACTLY, NOT AS A FLOOR. A floor would pin the shortfall as the
// expected state and go red on a repair; an exact reading says "this is the
// number that was ruled on", so both a repair and a drift are visible and
// whoever changes it has to come here and say why.
describe('the drawer over its veil, at the value the owner ruled', () => {
  it.each([
    ['light', 2.936],
    ['dark', 1.029],
  ] as const)('%s: the drawer fill against the composited scrim', (theme, expected) => {
    const veil = tint(BLOCKS[theme], 'scrim');
    const ground = over(veil, resolve(BLOCKS[theme], 'page'));
    expect(ratio(resolve(BLOCKS[theme], 'sb-bg'), ground)).toBeCloseTo(expected, 2);
  });

  // Dark is 1.03 and always was: there the drawer is identified by its EDGE, not
  // its fill, which is the whole reason `drawer-edge` holds a value in one theme
  // and `transparent` in the other. That edge is the control-boundary rank and
  // reads 4.20 on the veil — so the asymmetry the token exists for is intact,
  // and light is the half now carrying a recorded miss instead of a margin.
  it('keeps the drawer edge on in dark, where the fill cannot identify it', () => {
    const veil = tint(BLOCKS.dark, 'scrim');
    const ground = over(veil, resolve(BLOCKS.dark, 'page'));
    expect(ratio(resolve(BLOCKS.dark, 'drawer-edge'), ground)).toBeGreaterThanOrEqual(3);
    expect(declaredIn(BLOCKS.light, 'drawer-edge')).toBe('transparent');
  });
});

describe('the inverted plane is gone from the stylesheet', () => {
  // THE WHOLE STYLESHEET, not the two palette blocks: a name re-minted under
  // `:root`, a media query or a new scope would be just as real and invisible to
  // a two-block check — the reason `floating-edges.test.ts` guards its own three
  // retirements the same way.
  const RETIRED = ['sidebar', 'sidebar-text', 'sidebar-muted', 'sidebar-inset', 'sidebar-nav'];

  it.each(RETIRED)('declares no `--color-%s` anywhere', (name) => {
    expect(CSS).not.toMatch(new RegExp(`--color-${name}\\s*:`));
  });

  // Retired with them, and for their reason rather than as a tidy-up: it existed
  // for "the one plane that is dark in both themes", and after this branch there
  // is no such plane. The capital card and both wall-toned KPI cards read `pos`.
  it('declares no `--color-pos-on-dark`', () => {
    expect(CSS).not.toMatch(/--color-pos-on-dark\s*:/);
  });

  // `[data-dark-surface]` gave a light theme's rail dark furniture and a light
  // focus ring. Both were right while the wall was dark in both themes and both
  // are wrong now: the ring falls back to `ink`, which inverts per theme and is
  // correct on either wall, and the Scroller's furniture follows the theme like
  // everything else drawn on a plane the theme owns. STRIPPED, like every other
  // reading here: prose may go on explaining what the scope was and why it went.
  it('has no `[data-dark-surface]` scope left', () => {
    expect(CSS).not.toContain('[data-dark-surface]');
  });
});

/* ───────────────────────── the markup half ───────────────────────── */

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const SOURCES = new Map(
  sourceFiles(here)
    .map((f) => relative(here, f).split(sep).join('/'))
    .map((f) => [f, stripTs(read(f))] as const),
);
const source = (f: string) => {
  const s = SOURCES.get(f);
  expect(s, `${f} is gone — this pin needs rewriting`).toBeDefined();
  return s!;
};
const wearing = (re: RegExp) =>
  [...SOURCES.entries()].filter(([, s]) => re.test(s)).map(([f]) => f);

describe('the rail paints the recipe the sheet draws', () => {
  /** `pillClass`'s body alone. The active arm is three utilities inside one
   *  returned template string, and a whole-file match would go green with any of
   *  them on the capital card or the currency toggle instead. */
  const pillClass = () => {
    const src = source('app/Sidebar.tsx');
    const at = src.indexOf('function pillClass(');
    expect(
      at,
      '`pillClass` is gone — the nav recipe moved and this pin must follow',
    ).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('\n}', at));
  };

  /** The two arms of the `isActive` ternary, separately — which is the whole
   *  point of splitting them out. Every utility that is NOT inside an arm is
   *  shared by both pills, and a `hover:` in the shared part outranks the active
   *  arm it sits beside: one specificity class higher and emitted later. */
  const arms = () => {
    const body = pillClass();
    const q = body.match(/'[^']*'/g) ?? [];
    expect(
      q.length,
      'the two arms of `pillClass` are no longer two strings',
    ).toBeGreaterThanOrEqual(2);
    const active = q.find((a) => a.includes('sb-item-active'));
    expect(active, 'no arm names the active state').toBeDefined();
    // Everything before the first arm: the template literal both pills take and
    // the ternary that chooses between them. Comments are already stripped, so
    // an apostrophe in prose cannot be mistaken for the start of an arm.
    return { body, active: active!, shared: body.slice(0, body.indexOf("'")) };
  };

  it('says the active route twice — a tint and an indicator', () => {
    const { active } = arms();
    expect(active, 'the active fill').toContain('bg-sb-item-active-bg');
    // `text-`, not the bare name: `bg-sb-item-active-bg` CONTAINS `sb-item-active`,
    // so a name-only check here was satisfied by the line above it and the label
    // could have been deleted with this test green.
    expect(active, 'the active label').toContain('text-sb-item-active');
    // The inset edge, not merely the token: a `text-sb-indicator` somewhere would
    // satisfy a name-only check while drawing no indicator at all.
    expect(active, 'the 2px inset left edge').toMatch(
      /shadow-\[inset_2px_0_0_[^\]]*sb-indicator[^\]]*\]/,
    );
  });

  // THE REGRESSION NAMED, NOT A DEAD TOKEN. This asserted `bg-sidebar-text` was
  // absent, which cannot fail: the stylesheet half above proves that name is
  // declared nowhere, so no class built on it could render under any spelling.
  // What the rail must not grow back is an OPAQUE fill on the active pill — the
  // lozenge was one — and the tint is the only `bg-` the arm is allowed.
  it('leaves no opaque fill on the active pill', () => {
    const fills = arms().active.match(/(?:^|[\s'])(bg-[a-z0-9-]+)/g) ?? [];
    expect(
      fills.map((f) => f.trim().replace(/^'/, '')),
      'the active arm paints a fill that is not the tint',
    ).toEqual(['bg-sb-item-active-bg']);
  });

  it('lifts a hovered route onto its own ground rather than fading the pill', () => {
    const { body } = arms();
    expect(body, 'the hover ground').toContain('sb-item-hover-bg');
    // `opacity-85` dimmed the whole pill, label and fill together, which is not a
    // state the palette can score. The sheet's hover is a ground plus a text lift
    // and both halves are readable values.
    expect(body, 'the pill still fades instead of lifting').not.toContain('hover:opacity-85');
  });

  // THE COLLISION THIS FILE SHIPPED ONCE. `hover:` beats the active arm's plain
  // utilities — higher specificity, later in the sheet — so a hover in the SHARED
  // part of the recipe repaints the current route as an idle one under the
  // pointer, taking away the tint and the accent label together. Nothing renders
  // in this suite, so it is pinned structurally: the shared prefix carries no
  // `hover:` at all.
  it('keeps hover out of the part both pills share', () => {
    expect(arms().shared).not.toMatch(/hover:/);
  });
});

describe('nothing still assumes a plane that is dark in both themes', () => {
  // A literal that cannot invert. It was correct while the only planes wearing it
  // were dark in both themes; both have followed the theme since this branch.
  it.each(['app/Sidebar.tsx', 'components/ui/KpiCard.tsx'])('%s carries no `text-white`', (f) => {
    expect(source(f)).not.toMatch(/\btext-white\b/);
  });

  it('paints no `pos-on-dark` anywhere in `src/`', () => {
    expect(wearing(/\bpos-on-dark\b/)).toEqual([]);
  });

  // The overlays read `scrim`, a veil declared per theme, instead of 40 % of a
  // wall that used to be dark in both and is not any more — at which point the
  // same class would have LIGHTENED the light theme's backdrop.
  it('opens no overlay on `bg-sidebar/40`', () => {
    expect(wearing(/\bbg-sidebar\/40\b/)).toEqual([]);
  });

  it('stamps `data-dark-surface` on nothing', () => {
    expect(wearing(/data-dark-surface/)).toEqual([]);
  });
});
