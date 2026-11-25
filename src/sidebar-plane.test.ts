import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  channels,
  composite,
  declaredIn,
  glassPlanes,
  knobTintOf,
  mixOf,
  ratio,
  resolve,
  stripCss,
  themeBlocks,
  veilOf,
} from './__fixtures__/palette';

// THE WALL FOLLOWS THE THEME, AND THE ACTIVE ROUTE IS SAID TWICE. The sidebar is a step
// deeper than the canvas in BOTH themes, so nothing here may assume a plane that is dark in
// either. The active item is an accessibility ruling rather than a repaint: a light lozenge
// says "current" with colour alone, which 1.4.1 does not accept, so the active item takes a tint
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

/** Copied SIGNATURE AND ALL rather than imported:
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

const CSS = stripCss(read('index.css'), 'index.css');

/* ─────────────────────────── the CSS half ─────────────────────────── */

const BLOCKS = themeBlocks(CSS);
const THEMES = ['light', 'dark'] as const;

// The active and hover grounds are translucent, so every reading composites them first: the
// bare wall would flatter the label.

describe('the wall carries its own foreground, in whichever theme is on', () => {
  it.each(THEMES)('%s: an idle route clears 4.5 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-item'), resolve(BLOCKS, theme, 'sb-bg')),
      'an idle route name is unreadable on the wall it is drawn straight onto — the ' +
        'most-read text on the plane, and 1.4.3 binds it',
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the 2px indicator clears 3 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-indicator'), resolve(BLOCKS, theme, 'sb-bg')),
      'the indicator is unreadable on the wall, and it is the half that survives a ' +
        "colour-blind reading — read against the WALL, where the tint's own ground stops",
    ).toBeGreaterThanOrEqual(3);
  });

  // Hover is a GROUND and the state is the text lifting to `sb-item-hover`, so the pair is
  // read composited or the reading is of a colour nothing paints.
  it.each(THEMES)('%s: a hovered route clears 4.5 : 1 on its own ground', (theme) => {
    const wall = resolve(BLOCKS, theme, 'sb-bg');
    expect(
      ratio(
        resolve(BLOCKS, theme, 'sb-item-hover'),
        composite(veilOf(BLOCKS, theme, 'sb-item-hover-bg'), wall),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// THE ROWS STAND ON TWO GROUNDS: the floating panel's glass, read at its opaque fallback `card`
// (glass.md § Signed: the default is built to pass on its own), and the drawer's `sb-bg` until
// #721 retires it. The active row is `accent-tint` with its label in `ink` 700 and its glyph in
// `accent` (shell.md § Signed, G1).
describe('the rows read on the panel and on the drawer', () => {
  const GROUNDS = ['card', 'sb-bg'] as const;
  const cases = THEMES.flatMap((theme) => GROUNDS.map((ground) => [theme, ground] as const));
  const onTint = (theme: (typeof THEMES)[number], ground: (typeof GROUNDS)[number]) =>
    composite(veilOf(BLOCKS, theme, 'accent-tint'), resolve(BLOCKS, theme, ground));

  it.each(cases)('%s on %s: an idle route clears 4.5 : 1', (theme, ground) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-item'), resolve(BLOCKS, theme, ground)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('%s on %s: the active label clears 4.5 : 1 on its tint', (theme, ground) => {
    expect(ratio(resolve(BLOCKS, theme, 'ink'), onTint(theme, ground))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(cases)('%s on %s: the active glyph clears 3 : 1 on its tint', (theme, ground) => {
    expect(ratio(resolve(BLOCKS, theme, 'accent'), onTint(theme, ground))).toBeGreaterThanOrEqual(
      3,
    );
  });

  it.each(cases)('%s on %s: the 2px indicator clears 3 : 1', (theme, ground) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-indicator'), resolve(BLOCKS, theme, ground)),
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(cases)('%s on %s: a hovered route clears 4.5 : 1 on its ground', (theme, ground) => {
    const hovered = composite(
      veilOf(BLOCKS, theme, 'sb-item-hover-bg'),
      resolve(BLOCKS, theme, ground),
    );
    expect(ratio(resolve(BLOCKS, theme, 'sb-item-hover'), hovered)).toBeGreaterThanOrEqual(4.5);
  });

  // The capital line is 11 px text under the wordmark, the panel's alone.
  it.each(THEMES)('%s: the capital line and its change clear 4.5 : 1 on `card`', (theme) => {
    const card = resolve(BLOCKS, theme, 'card');
    for (const token of ['muted', 'pos', 'neg'] as const) {
      expect(ratio(resolve(BLOCKS, theme, token), card), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The super-admin's role band: the shield on `ink` 5 % over the panel.
  it.each(cases)('%s on %s: the role band shield clears 3 : 1', (theme, ground) => {
    const band = composite(
      { ch: channels(resolve(BLOCKS, theme, 'ink')), alpha: 0.05 },
      resolve(BLOCKS, theme, ground),
    );
    expect(ratio(resolve(BLOCKS, theme, 'sb-icon-active'), band)).toBeGreaterThanOrEqual(3);
  });
});

// AND ON THE GLASS ITSELF, wherever the glow can put it: the fallback above is what Safari's
// unreported reduced transparency may still show, this is what every blurring browser paints
// (glass.md § Signed: the default must pass on its own). The same planes the KPI cards read on.
describe('the panel reads on its glass over the glow', () => {
  const least = (theme: (typeof THEMES)[number], ink: string, veil?: string) =>
    Math.min(
      ...glassPlanes(CSS, theme).map((plane) =>
        ratio(ink, veil ? composite(veilOf(BLOCKS, theme, veil), plane) : plane),
      ),
    );

  it.each(
    THEMES.flatMap((theme) =>
      (
        [
          ['sb-item', 'an idle route'],
          ['muted', 'the capital line and the captions'],
          ['pos', 'a gain on the capital line'],
          ['neg', 'a loss on the capital line'],
        ] as const
      ).map(([token, role]) => [theme, token, role] as const),
    ),
  )('%s: `%s` (%s) clears 4.5 : 1 on its least contrasting plane', (theme, token) => {
    expect(least(theme, resolve(BLOCKS, theme, token))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the active label clears 4.5 : 1 on its tint', (theme) => {
    expect(least(theme, resolve(BLOCKS, theme, 'ink'), 'accent-tint')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: the active glyph and the indicator clear 3 : 1', (theme) => {
    expect(least(theme, resolve(BLOCKS, theme, 'accent'), 'accent-tint')).toBeGreaterThanOrEqual(3);
    expect(least(theme, resolve(BLOCKS, theme, 'sb-indicator'))).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: a hovered route clears 4.5 : 1 on its ground', (theme) => {
    expect(
      least(theme, resolve(BLOCKS, theme, 'sb-item-hover'), 'sb-item-hover-bg'),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // The super-admin's role band, `ink` 5 % over the glass.
  it.each(THEMES)('%s: the role band reads, its word 4.5 : 1 and its shield 3 : 1', (theme) => {
    const band = (ink: string) =>
      Math.min(
        ...glassPlanes(CSS, theme).map((plane) =>
          ratio(
            ink,
            composite({ ch: channels(resolve(BLOCKS, theme, 'ink')), alpha: 0.05 }, plane),
          ),
        ),
      );
    expect(band(resolve(BLOCKS, theme, 'ink')), 'the word').toBeGreaterThanOrEqual(4.5);
    expect(band(resolve(BLOCKS, theme, 'sb-icon-active')), 'the shield').toBeGreaterThanOrEqual(3);
  });
});

// A GLYPH THAT STANDS ALONE IS BOUND BY 1.4.11, which is what separates the rail from the
// expanded pills: beside its own visible label a glyph is decorative, and the rail has no
// labels — the name is an `aria-label` and the tooltip is for the pointer — so the glyph is
// the whole of what identifies a route.
describe('the rail draws its glyphs alone, so they are held to 1.4.11', () => {
  it.each(THEMES)('%s: an idle rail glyph clears 3 : 1 on the wall', (theme) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-icon'), resolve(BLOCKS, theme, 'sb-bg')),
    ).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: the active glyph clears 3 : 1 on its tint', (theme) => {
    const ground = composite(
      veilOf(BLOCKS, theme, 'sb-item-active-bg'),
      resolve(BLOCKS, theme, 'sb-bg'),
    );
    expect(ratio(resolve(BLOCKS, theme, 'sb-icon-active'), ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: a hovered rail glyph clears 3 : 1 on its ground', (theme) => {
    const ground = composite(
      veilOf(BLOCKS, theme, 'sb-item-hover-bg'),
      resolve(BLOCKS, theme, 'sb-bg'),
    );
    expect(ratio(resolve(BLOCKS, theme, 'sb-icon'), ground)).toBeGreaterThanOrEqual(3);
  });

  it.each(THEMES)('%s: the rail currency symbol clears 4.5 : 1 on its tint', (theme) => {
    const ground = composite(
      veilOf(BLOCKS, theme, 'sb-item-active-bg'),
      resolve(BLOCKS, theme, 'sb-bg'),
    );
    expect(
      ratio(resolve(BLOCKS, theme, 'ink'), ground),
      'the rail currency symbol is unreadable on its tint — it shows a value rather than ' +
        'offering two, so it is TEXT and reads `ink`, not the expanded track\u2019s `sb-item`',
    ).toBeGreaterThanOrEqual(4.5);
  });
});

// THE RAIL'S FOOT IS A SECOND GROUND: its Settings and account glyphs sit on a `sb-footer-bg`
// band until #720 redraws the rail.
describe("the rail's foot band is a second ground, and its glyphs read on it", () => {
  const band = (theme: (typeof THEMES)[number]) => resolve(BLOCKS, theme, 'sb-footer-bg');

  it.each(THEMES)('%s: the glyph on the band clears 3 : 1', (theme) => {
    expect(ratio(resolve(BLOCKS, theme, 'sb-icon'), band(theme))).toBeGreaterThanOrEqual(3);
  });

  // THE BAND IDENTIFIES ITSELF BY ITS RULE, NOT ITS FILL.
  it.each(THEMES)('%s: the band is a step, not a boundary', (theme) => {
    expect(
      ratio(band(theme), resolve(BLOCKS, theme, 'sb-bg')),
      'the fill now does the identifying — a re-valuing has to come and change this rule',
    ).toBeLessThan(1.1);
  });
});

// The foot's two sets are the one segmented control (controls.md § Signed, D2), on the panel's
// ground (the glass's `card` fallback) and on the drawer's `sb-bg`: the glass well over the
// ground, the selected segment the tinted knob over the well.
describe("the foot's segmented control reads on the panel and on the drawer", () => {
  type Ground = 'card' | 'sb-bg';
  const well = (theme: (typeof THEMES)[number], ground: Ground) =>
    composite(mixOf(BLOCKS, theme, 'glass-well'), resolve(BLOCKS, theme, ground));
  const knob = (theme: (typeof THEMES)[number], ground: Ground) =>
    composite(knobTintOf(BLOCKS, theme), well(theme, ground));
  const cases = THEMES.flatMap((theme) =>
    (['card', 'sb-bg'] as const).map((ground) => [theme, ground] as const),
  );

  // The ruled shortfall the band's ground gave (4.42 : 1 in light) is repaired by leaving it.
  it.each(cases)(
    '%s on %s: the idle currency symbol clears 4.5 : 1 on the well',
    (theme, ground) => {
      expect(ratio(resolve(BLOCKS, theme, 'muted'), well(theme, ground))).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  // The same label under H2's `ink` 5 % hover veil, RECORDED AT ITS VALUE: the drawer's light
  // reading stays under 1.4.3 until #721 retires the drawer.
  it.each([
    ['light', 'card', 5.15],
    ['light', 'sb-bg', 4.33],
    ['dark', 'card', 6.38],
    ['dark', 'sb-bg', 6.76],
  ] as const)(
    '%s on %s: the hovered currency symbol on the veiled well, at its value',
    (theme, ground, expected) => {
      const veiled = composite(
        { ch: channels(resolve(BLOCKS, theme, 'ink')), alpha: 0.05 },
        well(theme, ground),
      );
      expect(ratio(resolve(BLOCKS, theme, 'muted'), veiled)).toBeCloseTo(expected, 2);
    },
  );

  it.each(cases)('%s on %s: the selected label clears 4.5 : 1 on the knob', (theme, ground) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'segment-label'), knob(theme, ground)),
    ).toBeGreaterThanOrEqual(4.5);
  });

  // A theme segment is a GLYPH with no visible word, so 1.4.11 asks 3 of it, not 1.4.3's 4.5.
  it.each(cases)('%s on %s: an idle theme glyph clears 3 : 1 on the well', (theme, ground) => {
    expect(ratio(resolve(BLOCKS, theme, 'muted'), well(theme, ground))).toBeGreaterThanOrEqual(3);
  });
});

// The wall's field rank has one consumer left: the rail's super-admin strip, a shield that
// names the role on its own (its word is the tooltip), so 1.4.11 holds it to 3.
describe("the rail's role strip reads on the wall's field rank", () => {
  it.each(THEMES)('%s: the shield clears 3 : 1 on `sb-field`', (theme) => {
    expect(
      ratio(resolve(BLOCKS, theme, 'sb-icon-active'), resolve(BLOCKS, theme, 'sb-field')),
    ).toBeGreaterThanOrEqual(3);
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
    const veil = veilOf(BLOCKS, theme, 'scrim');
    const ground = composite(veil, resolve(BLOCKS, theme, 'page'));
    expect(ratio(resolve(BLOCKS, theme, 'sb-bg'), ground)).toBeCloseTo(expected, 2);
  });

  it('keeps the drawer edge on in dark, where the fill cannot identify it', () => {
    const veil = veilOf(BLOCKS, 'dark', 'scrim');
    const ground = composite(veil, resolve(BLOCKS, 'dark', 'page'));
    expect(
      ratio(resolve(BLOCKS, 'dark', 'drawer-edge'), ground),
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
    .map((f) => [f, stripTs(read(f), f)] as const),
);
const source = (f: string) => {
  const s = SOURCES.get(f);
  expect(s, `${f} is gone — this pin needs rewriting`).toBeDefined();
  return s!;
};
const wearing = (re: RegExp) =>
  [...SOURCES.entries()].filter(([, s]) => re.test(s)).map(([f]) => f);

describe('the rail paints its pill recipe', () => {
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
    const active = q.find((a) => a.includes('accent-tint'));
    expect(active, 'no arm names the active state').toBeDefined();
    // Everything before the first arm. Comments are already stripped, so an apostrophe in
    // prose cannot be mistaken for the start of one.
    return { body, active: active!, shared: body.slice(0, body.indexOf("'")) };
  };

  it('says the active route twice — a tint and an indicator', () => {
    const { active } = arms();
    expect(active, 'the active fill').toContain('bg-accent-tint');
    // The label is `ink` 700 (shell.md § Signed, G1); the glyph's `accent` is `nav-glyphs`'.
    expect(active, 'the active label').toMatch(/\btext-ink\b/);
    expect(active, 'the active label is not 700').toMatch(/\bfont-bold\b/);
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
    ).toEqual(['bg-accent-tint']);
  });

  // G1 (shell.md § Signed): 44 tall at r12, padding 0 12, one recipe for every row.
  it('draws every row 44 tall at r12 with 12 px sides', () => {
    // The template both arms extend, not `shared`, which stops at the signature's own quotes.
    expect(arms().body, 'the row is not padded 0 12').toMatch(/`block w-full[^`]*\spx-3\s/);
    const src = source('app/Sidebar.tsx');
    expect(src, 'the row is not 44 tall at r12').toMatch(
      /const ROW = pillClass\('py-\[13px\]', 'rounded-\[12px\]'\);/,
    );
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

// THE PANEL FLOATS ON THE GLASS (shell.md § Signed, G1; glass.md § Signed): 260 wide, 16 from the
// top, the left and the bottom, r26, padding 16 14 12. The glass utility carries the opaque
// fallback, so the panel names the utility and nothing that would override its edge.
describe('the expanded panel is a floating glass card', () => {
  const panel = () => {
    const src = source('app/Sidebar.tsx');
    const lines = src.split('\n').filter((l) => /\bw-\[260px\]/.test(l));
    expect(lines.length, 'the 260 panel is not one element').toBe(1);
    return lines[0]!;
  };

  it('wears the glass at r26, with no edge or fill of its own', () => {
    expect(panel()).toMatch(/(?<![-\w[])glass(?![-\w])/);
    expect(panel()).toMatch(/\brounded-\[26px\]/);
    expect(panel(), 'the panel overrides the glass edge').not.toMatch(/--glass-edge|\bborder\b/);
    expect(panel(), 'the panel paints a fill over the glass').not.toMatch(/\bbg-/);
  });

  it('stands 16 from the top, the left and the bottom', () => {
    expect(panel()).toMatch(/\bmt-4\b/);
    expect(panel()).toMatch(/\bml-\[max\(16px,env\(safe-area-inset-left\)\)\]/);
    expect(panel()).toMatch(
      /\bh-\[calc\(100dvh-16px-max\(16px,env\(safe-area-inset-bottom\)\)\)\]/,
    );
  });

  it('is padded 16 14 12', () => {
    expect(panel()).toMatch(/\bpt-4\b/);
    expect(panel()).toMatch(/\bpx-3\.5\b/);
    expect(panel()).toMatch(/\bpb-3\b/);
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
