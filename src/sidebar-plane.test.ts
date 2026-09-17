import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE WALL FOLLOWS THE THEME, AND THE ACTIVE ROUTE IS SAID TWICE. The sidebar is a step
// deeper than the canvas in BOTH themes, so nothing here may assume a plane that is dark in
// either. The active item is an accessibility ruling rather than a repaint: a light lozenge
// says "current" with colour alone, which 1.4.1 does not accept, so the sheet draws a tint
// PLUS a 2px inset left edge.
//
// TWO HALVES, NEITHER CATCHING THE OTHER — the split `field-border.test.ts` records. The
// tokens can be perfect and the pill still carry the old lozenge, because nothing else
// reads `Sidebar.tsx` for colour.
//
// WHAT DELIBERATELY TAKES NO FLOOR HERE: `sb-label`, a shortfall the owner ruled on and
// `palette-mirror.test.ts` records AT its value — a floor here would be this file quietly
// overruling it. Same for `sb-border`, `sb-badge` and `sb-badge-bg`, declared with nothing
// in this app drawing them.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** `index.css` quotes token declarations in its prose constantly, so a comment could
 *  otherwise satisfy an assertion the stylesheet fails. Quote-aware because the file's
 *  `@source` line holds a comment opener inside a string, and a naive regex takes `@theme`
 *  along with it. */
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

/** LINE BY LINE, and the line boundary is the point: a regex literal may hold a quote, and
 *  one desync would switch stripping off for the rest of the file. */
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

/** Follows a `var(--color-x)` chain the way the cascade does: a name the dark block does
 *  not override resolves against `@theme`, so one block alone would fail a token the
 *  browser renders. */
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

/** THE ACTIVE AND HOVER GROUNDS ARE DECLARED TRANSLUCENT, so every reading against one
 *  composites it first. THE BARE WALL FLATTERS THE FIGURE: the active label sits on its own
 *  12 % tint, lighter than the wall in light and darker in dark. The sheet scores it on its
 *  own ground and so does this. */
function tint(block: string, name: string): { ch: number[]; alpha: number } {
  const value = declaredIn(block, name) ?? declared(BLOCKS.light, name);
  const m = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/);
  expect(m, `--color-${name} is not an rgba(…) — this pin composites a tint`).not.toBeNull();
  return { ch: [+m![1], +m![2], +m![3]], alpha: +m![4] };
}

const over = (veil: { ch: number[]; alpha: number }, behind: string) =>
  rgbHex(veil.ch.map((c, i) => c * veil.alpha + channels(behind)[i] * (1 - veil.alpha)));

describe('the wall carries its own foreground, in whichever theme is on', () => {
  it.each(THEMES)('%s: an idle route clears 4.5 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-item'), resolve(BLOCKS[theme], 'sb-bg')),
      'an idle route name is unreadable on the wall it is drawn straight onto — the ' +
        'most-read text on the plane, and 1.4.3 binds it',
    ).toBeGreaterThanOrEqual(4.5);
  });

  // EXACT, NOT A BOUND, and this is how the file treats every ruled shortfall. The active
  // label is under 1.4.3 on its own tint; what buys it is 1.4.1, since the lozenge it
  // replaced said the state in colour alone. A `>=` bound would let a later palette edit
  // walk the label down to it with the suite green and nothing recording what was accepted,
  // and a bound asserting the label STAYS short would go red on a repair. An exact reading
  // makes both a repair and a drift come here and say why.
  it.each([
    ['light', 3.88],
    ['dark', 8.283],
  ] as const)('%s: the active label on its own tint, at the ruled value', (theme, expected) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-active-bg'), resolve(BLOCKS[theme], 'sb-bg'));
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-item-active'), ground),
      'the ruled reading moved — a repair and a drift both have to come here and say why',
    ).toBeCloseTo(expected, 2);
  });

  it.each(THEMES)('%s: the 2px indicator clears 3 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-indicator'), resolve(BLOCKS[theme], 'sb-bg')),
      'the indicator is unreadable on the wall, and it is the half that survives a ' +
        "colour-blind reading — read against the WALL, where the tint's own ground stops",
    ).toBeGreaterThanOrEqual(3);
  });

  // Hover is a GROUND and the state is the text lifting to `sb-item-hover`, so the pair is
  // read composited or the reading is of a colour nothing paints.
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

// A GLYPH THAT STANDS ALONE IS BOUND BY 1.4.11, which is what separates the rail from the
// expanded pills: beside its own visible label a glyph is decorative, and the rail has no
// labels — the name is an `aria-label` and the tooltip is for the pointer — so the glyph is
// the whole of what identifies a route.
describe('the rail draws its glyphs alone, so they are held to 1.4.11', () => {
  it.each(THEMES)('%s: an idle rail glyph clears 3 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-icon'), resolve(BLOCKS[theme], 'sb-bg')),
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: the active glyph clears 3 : 1 on its tint', (theme) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-active-bg'), resolve(BLOCKS[theme], 'sb-bg'));
    expect(ratio(resolve(BLOCKS[theme], 'sb-icon-active'), ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: a hovered rail glyph clears 3 : 1 on its ground', (theme) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-hover-bg'), resolve(BLOCKS[theme], 'sb-bg'));
    expect(ratio(resolve(BLOCKS[theme], 'sb-icon'), ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: the rail currency symbol clears 4.5 : 1 on its tint', (theme) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-active-bg'), resolve(BLOCKS[theme], 'sb-bg'));
    expect(
      ratio(resolve(BLOCKS[theme], 'ink'), ground),
      'the rail currency symbol is unreadable on its tint — it shows a value rather than ' +
        'offering two, so it is TEXT and reads `ink`, not the expanded track\u2019s `sb-item`',
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// THE ELEVENTH ROUTE IS ON A DIFFERENT GROUND, AND EVERY READING ABOVE IS OF THE OTHER TEN:
// Settings sits on a `sb-footer-bg` band, and the arms above composite over `sb-bg` so they
// would go on asserting a plane the app stopped painting.
describe('the footer band is a second ground, and the eleventh route reads on it', () => {
  const band = (theme: (typeof THEMES)[number]) => resolve(BLOCKS[theme], 'sb-footer-bg');

  // The same exact-value treatment as the wall's active label, for the same reason: a ruled
  // shortfall, not a floor to drift under. Repairing it means moving `sb-item-active`, a
  // palette decision this file has no standing to make.
  it.each([
    ['light', 3.62],
    ['dark', 7.75],
  ] as const)('%s: the active label on its tint over the band, at its value', (theme, expected) => {
    const ground = over(tint(BLOCKS[theme], 'sb-item-active-bg'), band(theme));
    expect(ratio(resolve(BLOCKS[theme], 'sb-item-active'), ground)).toBeCloseTo(expected, 2);
  });

  it.each(THEMES)('%s: the idle route on the band clears 4.5 : 1', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-item'), band(theme)),
      'the idle route is unreadable on the band — ordinary body text on a new plane, so ' +
        '1.4.3 binds it with no excuse',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the glyph on the band clears 3 : 1', (theme) => {
    expect(ratio(resolve(BLOCKS[theme], 'sb-icon'), band(theme))).toBeGreaterThanOrEqual(3);
  });

  // THE BAND IDENTIFIES ITSELF BY ITS RULE, NOT ITS FILL, which is why the drawing puts a
  // `sb-divider` along its top edge and `sidebar-structure.test.ts` asserts the two together.
  it.each(THEMES)('%s: the band is a step, not a boundary', (theme) => {
    expect(
      ratio(band(theme), resolve(BLOCKS[theme], 'sb-bg')),
      'the fill now does the identifying — a re-valuing has to come and change this rule',
    ).toBeLessThan(1.1);
  });

  // THE PRICE OF THE NEW GROUND, exact rather than a floor like the active label above: the
  // rank above `sb-item` here is the hover state itself, so lifting the symbol spends the
  // one step the track has left, and the drawing takes the reading instead.
  it.each([
    ['light', 4.3],
    ['dark', 5.81],
  ] as const)('%s: the idle currency symbol on its track, at its value', (theme, expected) => {
    const track = over(
      tint(BLOCKS[theme], 'sb-item-active-bg'),
      resolve(BLOCKS[theme], 'sb-footer-bg'),
    );
    expect(ratio(resolve(BLOCKS[theme], 'sb-item'), track)).toBeCloseTo(expected, 2);
  });

  it.each(THEMES)('%s: the selected chip identifies itself on the tinted track', (theme) => {
    const track = over(tint(BLOCKS[theme], 'sb-item-active-bg'), band(theme));
    expect(ratio(resolve(BLOCKS[theme], 'accent'), track)).toBeGreaterThanOrEqual(3);
    expect(
      ratio(resolve(BLOCKS[theme], 'accent-fg'), resolve(BLOCKS[theme], 'accent')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // THE OTHER TRACK ON THE SAME ROW, and the split is why it takes a different token from
  // its neighbour: a currency symbol is a character and 1.4.3 asks 4.5, a theme segment is a
  // GLYPH with no label of its own and 1.4.11 asks 3. A FLOOR rather than the exact value
  // beside it, because this one clears its bar.
  it.each(THEMES)('%s: an idle theme glyph clears 3 : 1 on its track', (theme) => {
    const track = over(tint(BLOCKS[theme], 'sb-item-active-bg'), band(theme));
    expect(ratio(resolve(BLOCKS[theme], 'sb-icon'), track)).toBeGreaterThanOrEqual(3);
  });
});

describe("the wall's field rank carries the figures drawn on it", () => {
  // TWO CONSUMERS, ONE READING, AND THE TEXT ONE SETS THE BAR: `sb-item` carries the bare
  // collapse chevron, a non-text indicator held to 3, and the strip's dash when there is no
  // figure yet, which is text and asks 4.5. A separate 3 arm could never fail on its own.
  it.each(THEMES)('%s: `sb-item` clears 4.5 : 1 on `sb-field`, for both its uses', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'sb-item'), resolve(BLOCKS[theme], 'sb-field')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: a negative delta clears 4.5 : 1 on `sb-field`', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'neg'), resolve(BLOCKS[theme], 'sb-field')),
      'a negative delta is unreadable on `sb-field` — a loss is as drawable as a gain, and ' +
        '`neg` is the half nothing else holds',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the capital figure and its gain clear 4.5 : 1 on `sb-field`', (theme) => {
    const field = resolve(BLOCKS[theme], 'sb-field');
    expect(ratio(resolve(BLOCKS[theme], 'ink'), field), 'the figure').toBeGreaterThanOrEqual(4.5);
    // `pos`, not `pos-on-dark`: the plane is no longer dark in both themes, so the gain
    // follows the theme like every other delta in the app.
    expect(ratio(resolve(BLOCKS[theme], 'pos'), field), 'the gain').toBeGreaterThanOrEqual(4.5);
  });

  // THE WALL IS ALSO A CARD PLANE: `KpiCard`'s `wall` tone borrows the rail's plane for one
  // headline card per screen, which the `sb-field` readings above cannot speak for.
  it.each(THEMES)('%s: the wall-toned KPI card clears 4.5 : 1 on `sb-bg`', (theme) => {
    const wall = resolve(BLOCKS[theme], 'sb-bg');
    expect(ratio(resolve(BLOCKS[theme], 'ink'), wall), 'the value').toBeGreaterThanOrEqual(4.5);
    expect(ratio(resolve(BLOCKS[theme], 'pos'), wall), 'the gain sub-line').toBeGreaterThanOrEqual(
      4.5,
    );
    expect(ratio(resolve(BLOCKS[theme], 'sb-item'), wall), 'the label').toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the selected currency clears 4.5 : 1 on its thumb', (theme) => {
    expect(
      ratio(resolve(BLOCKS[theme], 'accent-fg'), resolve(BLOCKS[theme], 'sb-item-active')),
      'the selected currency is unreadable on its thumb. The label sits on the ACCENT, not ' +
        'the wall: `sb-bg` on it misses the bar by a hundredth, and `accent-fg` is what the ' +
        'palette mints for this fill',
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// A RULED SHORTFALL, RECORDED AT ITS VALUE, and here rather than in `palette-mirror.test.ts`
// because the ground is a COMPOSITE and that file's table resolves two token names. Giving
// the wall to the theme took light under 1.4.11, and the owner ruled the value stands rather
// than putting an `ink` hairline around a parchment drawer.
describe('the drawer over its veil, at the value the owner ruled', () => {
  it.each([
    ['light', 2.936],
    ['dark', 1.029],
  ] as const)('%s: the drawer fill against the composited scrim', (theme, expected) => {
    const veil = tint(BLOCKS[theme], 'scrim');
    const ground = over(veil, resolve(BLOCKS[theme], 'page'));
    expect(ratio(resolve(BLOCKS[theme], 'sb-bg'), ground)).toBeCloseTo(expected, 2);
  });

  it('keeps the drawer edge on in dark, where the fill cannot identify it', () => {
    const veil = tint(BLOCKS.dark, 'scrim');
    const ground = over(veil, resolve(BLOCKS.dark, 'page'));
    expect(
      ratio(resolve(BLOCKS.dark, 'drawer-edge'), ground),
      'the dark drawer has lost the edge that identifies it — its fill cannot, which is why ' +
        'this token holds a value in one theme and `transparent` in the other',
    ).toBeGreaterThanOrEqual(3);
    expect(declaredIn(BLOCKS.light, 'drawer-edge')).toBe('transparent');
  });
});

describe('the inverted plane is gone from the stylesheet', () => {
  // THE WHOLE STYLESHEET, not the two palette blocks: a name re-minted under `:root`, a
  // media query or a new scope would be just as real and invisible to a two-block check.
  const RETIRED = ['sidebar', 'sidebar-text', 'sidebar-muted', 'sidebar-inset', 'sidebar-nav'];

  it.each(RETIRED)('declares no `--color-%s` anywhere', (name) => {
    expect(CSS).not.toMatch(new RegExp(`--color-${name}\\s*:`));
  });

  // Retired for their reason rather than as a tidy-up: it existed for "the one plane that is
  // dark in both themes", and there is no such plane.
  it('declares no `--color-pos-on-dark`', () => {
    expect(CSS).not.toMatch(/--color-pos-on-dark\s*:/);
  });

  // `[data-dark-surface]` gave a light theme's rail dark furniture and a light focus ring,
  // both right while the wall was dark in both themes and both wrong now. STRIPPED, like
  // every other reading here: prose may go on explaining what the scope was and why it went.
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
  /** `pillClass`'s body alone: the active arm is three utilities inside one returned
   *  template string, and a whole-file match would go green with any of them on the capital
   *  card or the currency toggle instead. */
  const pillClass = () => {
    const src = source('app/Sidebar.tsx');
    const at = src.indexOf('function pillClass(');
    expect(
      at,
      '`pillClass` is gone — the nav recipe moved and this pin must follow',
    ).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('\n}', at));
  };

  /** The two arms of the `isActive` ternary, separately. Every utility NOT inside an arm is
   *  shared by both pills, and a `hover:` in the shared part outranks the active arm beside
   *  it: one specificity class higher, emitted later. */
  const arms = () => {
    const body = pillClass();
    const q = body.match(/'[^']*'/g) ?? [];
    expect(
      q.length,
      'the two arms of `pillClass` are no longer two strings',
    ).toBeGreaterThanOrEqual(2);
    const active = q.find((a) => a.includes('sb-item-active'));
    expect(active, 'no arm names the active state').toBeDefined();
    // Everything before the first arm. Comments are already stripped, so an apostrophe in
    // prose cannot be mistaken for the start of one.
    return { body, active: active!, shared: body.slice(0, body.indexOf("'")) };
  };

  it('says the active route twice — a tint and an indicator', () => {
    const { active } = arms();
    expect(active, 'the active fill').toContain('bg-sb-item-active-bg');
    // `text-`, not the bare name: `bg-sb-item-active-bg` CONTAINS `sb-item-active`, so a
    // name-only check was satisfied by the line above it and the label could have been
    // deleted with this test green.
    expect(active, 'the active label').toContain('text-sb-item-active');
    // The inset edge, not merely the token: a `text-sb-indicator` somewhere would satisfy a
    // name-only check while drawing no indicator at all.
    expect(active, 'the 2px inset left edge').toMatch(
      /shadow-\[inset_2px_0_0_[^\]]*sb-indicator[^\]]*\]/,
    );
  });

  // THE REGRESSION NAMED, NOT A DEAD TOKEN. Asserting `bg-sidebar-text` was absent cannot
  // fail: the stylesheet half above proves that name is declared nowhere. What the rail must
  // not grow back is an OPAQUE fill on the active pill, and the tint is the only `bg-` the
  // arm is allowed.
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
    // `opacity-85` dimmed label and fill together, which is not a state the palette can
    // score; a ground plus a text lift is two readable values.
    expect(body, 'the pill still fades instead of lifting').not.toContain('hover:opacity-85');
  });

  // THE COLLISION THIS FILE SHIPPED ONCE: `hover:` beats the active arm's plain utilities —
  // higher specificity, later in the sheet — so a hover in the SHARED part repaints the
  // current route as an idle one under the pointer, taking the tint and the accent label
  // together. Nothing renders in this suite, so it is pinned structurally.
  it('keeps hover out of the part both pills share', () => {
    expect(arms().shared).not.toMatch(/hover:/);
  });
});

describe('nothing still assumes a plane that is dark in both themes', () => {
  it.each(['app/Sidebar.tsx', 'components/ui/KpiCard.tsx'])('%s carries no `text-white`', (f) => {
    expect(
      source(f),
      'a `text-white` is back on a plane that follows the theme — a literal that cannot ' +
        'invert, correct only while this plane was dark in both',
    ).not.toMatch(/\btext-white\b/);
  });

  it('paints no `pos-on-dark` anywhere in `src/`', () => {
    expect(wearing(/\bpos-on-dark\b/)).toEqual([]);
  });

  it('opens no overlay on `bg-sidebar/40`', () => {
    expect(
      wearing(/\bbg-sidebar\/40\b/),
      'an overlay is back on a fraction of the wall, which LIGHTENS the light backdrop ' +
        'instead of veiling it now that the wall follows the theme; `scrim` is the per-theme veil',
    ).toEqual([]);
  });

  it('stamps `data-dark-surface` on nothing', () => {
    expect(wearing(/data-dark-surface/)).toEqual([]);
  });
});
