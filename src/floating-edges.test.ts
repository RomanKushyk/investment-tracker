import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE FLOATING SURFACES' BOUNDARY, PINNED AT THE SAME BAR AS THE FIELD EDGE —
// AND ON THE SAME TOKEN, WHICH IS THE RULING (floating-edges.dc.html T4).
//
// A popover is `card` on `card` with a faint edge and nothing else — a boundary
// in name only. The worst case is not even that: an `AssetForm` `Select` opens
// INSIDE a `Dialog`, so a `bg-card` popover lands on a `bg-card` plane — a
// 1.00 : 1 fill step. WCAG 1.4.11 governs "the visual information required to
// identify user interface components", and a listbox popover is a component.
//
// Two halves need pinning and neither catches the other — the split
// `field-border.test.ts` records. THE CSS HALF is arithmetic on the tokens:
// nothing else in this repo reads a stylesheet, so a "tidy the palette" edit can
// put a boundary back under the bar with every test green. THE MARKUP HALF is
// which surfaces point at the token; there is no shared popover component, so a
// fourth floating surface added by copying a third lands on whatever the third
// used — which is exactly how the toast ended up on its own edge.
//
// THERE IS NO FLOATING-EDGE FAMILY ANY MORE, AND THE ORDER OF THE ARGUMENT IS
// EASY TO GET BACKWARDS. `popover-edge`, `toast-edge` and `surface-edge` each
// held TWO values — a light one and `field-border` in dark — so the redundancy
// was not the premise. The premise is 1.4.11: light needed an opaque 3 : 1
// stroke on these surfaces, and `field-border` is the only rung that clears it.
// Moving light there is what left all three holding one value in both blocks,
// and only then does `index.css`'s retired `--color-label` comment bite — "Two
// tokens that must hold the same value to be legible are one step drawn twice …
// Do not re-mint." Hence retired rather than kept as three aliases of one rank.
// `--color-drawer-edge` survives the same test because its light value never had
// to move; `--color-switch-border` because its name holds a recorded shortfall.
//
// `resolve()` follows a `var()` chain because a PLANE may be one — `field-border`
// and the four surfaces are hexes today, and `drawer-edge` is an alias of this
// very rank in dark. `field-border.test.ts`'s `token()` matches a literal hex
// and would see nothing.
//
// THE RAIL'S EDGE IS READ FROM `@theme`, and nothing scopes it any more: #92
// retired `[data-dark-surface]`, the one block that re-valued surface furniture
// under the rail, because its premise was a dark plane inside a light theme and
// the wall follows the theme now. Declaring the token under any scope that
// contains the rail would move that edge while every assertion here went on
// reading `@theme`; the guard below closes that rather than this paragraph
// merely naming it, and it is written for ANY such scope rather than that one.
//
// SELF-CONTAINED ON PURPOSE, which is the house idiom rather than a technical
// necessity: `filled-track.test.ts` and `field-border.test.ts` already each
// carry their own walker and stripper, so a guard stands alone and can be read
// without opening another one.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** CSS comments out, quote-aware. Not cosmetic: `declared()` takes the FIRST
 *  match in a block and this stylesheet's comments quote token declarations
 *  constantly, so a comment could otherwise satisfy an assertion the CSS fails
 *  — or fail one it passes. Quote-aware because a regex is not enough, which
 *  this file learned by failing: `index.css` line 5 is `@source not '**` +
 *  `/*.test.ts';`, whose string holds a literal comment opener, and a naive
 *  `/\*[\s\S]*?\*\// ` swallows from there to the first real `*\/` — taking
 *  `@theme` with it. CSS has only the one comment form and no regex literals,
 *  so this is exact. */
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
      // Loudly, not silently: truncating would let every assertion pass over a
      // partial file. `ruleBody` throws for the same reason.
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** TS comments out, LINE BY LINE, and the line boundary is the point.
 *
 *  A whole-file scanner cannot be exact here without parsing TypeScript: a
 *  regex literal may contain a quote — `src/core/backup/csv.ts` has
 *  `/["\r\n]/` — and one of those desynchronises quote tracking for the whole
 *  REST OF THE FILE, so comment stripping silently switches off and a
 *  commented-out token satisfies the markup half. Per line, a desync cannot
 *  outlive the line it started on, and the only cost of getting one line wrong
 *  is that line's trailing comment surviving.
 *
 *  Block comments are handled across lines because they are how this repo
 *  writes its long explanations, but a `/*` only OPENS one when it is outside
 *  quotes on its own line, so a string cannot open a block that eats the file. */
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

/** `#rrggbb` → the three channels, 0-255, and back. Both exist for the overlay
 *  composite below; nothing else here needs to take a colour apart. */
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

/** The declaration as written — a hex, a keyword, or a `var()`. `undefined` when
 *  the block does not declare it, which is not an error on its own: the cascade
 *  falls back to `@theme` for anything the dark block does not override. */
function declaredIn(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** Follows a `var(--color-x)` chain to the hex at the end of it, THE WAY THE
 *  CASCADE DOES: a name the dark block does not override resolves against
 *  `@theme`, so looking only in one block would fail a token the browser
 *  renders. Chains, a `var(…, fallback)` and digits in a name are all fine —
 *  none of them is the defect this guards, resolving to the WRONG VALUE is. */
function resolve(block: string, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle: ${[...seen, name].join(' → ')}`).not.toContain(
    name,
  );
  const value = declaredIn(block, name) ?? declared(BLOCKS.light, name);
  const alias = value.match(/^var\(\s*--color-([a-z0-9-]+)\s*(?:,\s*(.+))?\)$/);
  if (alias) return resolve(block, alias[1], [...seen, name]);
  const hex = value.toLowerCase();
  expect(hex, `--color-${name} is neither a hex nor a --color-* alias (got \`${value}\`)`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

/** TWO GROUPS, not three and not one. T4 left a single token, so the old
 *  per-name split had two of its three entries asserting the same thing — but
 *  collapsing to one union list is the opposite error: it would demand the rank
 *  clear the bar on the wall for surfaces never drawn there and on `card` for a
 *  rail that never touches it, so #92 re-planing the wall would have failed this
 *  test in the name of six surfaces it cannot affect. It did re-plane it, the
 *  split held, and the group moved by one token name.
 *
 *  `card` binds twice over — a popover's own fill AND, inside a `Dialog`, the
 *  plane behind it. `panel` is the weakest plane a popover opens over. `sb-bg`
 *  is the rail's own wall, read from the inside so lightening it cannot erase
 *  that edge silently — which is no longer hypothetical: light IS the lighter
 *  half of that token now, and this is the assertion that costed it. */
const DRAWN_ON = {
  'the floating surfaces': ['page', 'card', 'panel'],
  'the desktop rail': ['sb-bg'],
} as const;
const THEMES = ['light', 'dark'] as const;
/** The names T4 retired. Not a token list — a list of what must NOT come back. */
const RETIRED = ['popover-edge', 'toast-edge', 'surface-edge'] as const;

describe('a floating surface clears 3 : 1 on every plane it is drawn on', () => {
  // BOTH THEMES, where this file used to assert dark only. Light was the half
  // #86 deliberately left and #98 closed, so there is no longer an asymmetry for
  // a theme-shaped `it` to describe.
  for (const theme of THEMES) {
    for (const group of Object.keys(DRAWN_ON) as (keyof typeof DRAWN_ON)[]) {
      it(`${theme}: the rank clears the bar under ${group}`, () => {
        const value = resolve(BLOCKS[theme], 'field-border');
        for (const surface of DRAWN_ON[group]) {
          expect(
            ratio(value, resolve(BLOCKS[theme], surface)),
            `field-border on ${surface}`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  // THE OVERLAY ADJACENCY IS A SEPARATE READING, not a plane above. The `Dialog`
  // panel and the mobile date sheet float over the overlay, so what they are
  // identified against is that composite — the reason the `it` above cannot
  // speak for them.
  //
  // IT USED TO BE A SPLIT FLOOR AND IS NOW THE BAR, because #92 moved the veil
  // and moving it exposed that the old test was measuring the wrong thing. It
  // read the STROKE only, and held light to a floor under its own worst reading
  // because the stroke had never cleared 3 : 1 there. Then both overlays went
  // from 40 % of a wall that was dark in both themes to `scrim`, and the two
  // readings moved in opposite directions: the fill step went 2.85 / 2.65 / 3.08
  // -> 3.50 / 3.25 / 3.75 over page / card / panel and started clearing where
  // two of three had failed, while the stroke went 1.294 / 1.394 / 1.200 ->
  // 1.053 / 1.134 / 1.016 and stopped reading at all. Dark barely moved
  // (4.27 / 4.10 / 3.95 -> 4.20 / 4.10 / 4.03) and is carried by its stroke,
  // its fill being 1.02-1.07.
  //
  // Keeping the stroke-only shape would have meant a light floor of 1.01 against
  // a worst of 1.016 — 0.6 % of headroom, which cannot tell a drift from the
  // status quo and is the "census wearing a floor's name" this file's parity
  // guard argues against. So the assertion asks the question 1.4.11 actually
  // asks — is the component identifiable — and takes the better of the two
  // boundaries at the real bar, which holds in both themes on all three planes.
  // #99 keeps the design question the arithmetic cannot answer: whether a border
  // reading 1.05 against its own backdrop should stay in light at all.
  //
  // The token is read from the components, never typed, and BOTH overlays are
  // read because `Dialog`'s `OVERLAY_CLASS` is not exported and `DatePicker`
  // hand-copies the same string — so this covers the sheet it claims to. Read
  // through `source()`, the same stripped text every assertion in the markup
  // half uses — so a `bg-<token>` written in a comment cannot be matched instead
  // of the class, and there is no second stripping path that could drift from
  // the one the rest of the file trusts.
  //
  // THE ALPHA MOVED FROM THE CLASS INTO THE TOKEN (#92). It used to be
  // `bg-sidebar/40`, a utility-level opacity over an opaque hue, and this read
  // the `/40`; `scrim` carries its own per-theme alpha instead, so the veil is
  // an `rgba(…)` and the reading takes both halves from one declaration. Which
  // is the better shape for what it measures — a veil whose density differs by
  // theme cannot be said in a utility without a `dark:` variant.
  //
  // Compositing is plain sRGB and that is exact: Tailwind mixes in oklab, but
  // mixing with `transparent` only sets alpha, and the blend against the
  // backdrop happens in the device space either way — verified against the
  // browser's own rendering, which gave the same three composites.
  // ANCHORED ON `inset-0`, not on the first `bg-` in the file. While the veil
  // was `bg-<token>/<n>` the alpha made the class unique; `bg-scrim` is not, and
  // a bare `bg-` match reads `DatePicker`'s `hover:bg-page` three hundred lines
  // above the overlay — which it did, silently, until this line was anchored.
  // An overlay is the thing that covers the viewport, so that is what it is
  // identified by. Either quote, because `Dialog` holds its string in a const
  // and `DatePicker` writes the attribute inline.
  const overlayOf = (file: string) => {
    const m = source(file).match(/['"][^'"]*\binset-0\b[^'"]*['"]/);
    expect(m, `${file} no longer paints an overlay this can read`).not.toBeNull();
    const token = m![0].match(/\bbg-([a-z-]+)\b/);
    expect(token, `${file}'s overlay names no fill`).not.toBeNull();
    return token![1];
  };

  /** The veil's own channels and alpha, from an `rgba(…)` declaration. */
  const veilOf = (theme: (typeof THEMES)[number], token: string) => {
    const value = declared(BLOCKS[theme], token);
    const m = value.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/);
    expect(m, `--color-${token} is not an rgba(…) veil (got ${value})`).not.toBeNull();
    return { ch: [+m![1], +m![2], +m![3]], alpha: +m![4] };
  };

  it('the panel and the date sheet paint one veil, so one reading covers both', () => {
    expect(overlayOf('components/ui/Dialog.tsx')).toEqual(
      overlayOf('components/ui/DatePicker.tsx'),
    );
  });

  // EITHER BOUNDARY, AT THE REAL BAR — which is what this became once #92 moved
  // the veil, and it is a better test than the split floor it replaces. 1.4.11
  // asks for the visual information that IDENTIFIES a component, not for a
  // stroke specifically, and a panel offers two candidates: its own FILL against
  // the composite, and its STROKE. The denser veil moves them in opposite
  // directions — light identifies by fill (3.50 / 3.25 / 3.75 over page / card /
  // panel, where it was 2.85 / 2.65 / 3.08 and two of three failed), dark by
  // stroke (4.20 / 4.10 / 4.03, its fill being 1.02-1.07). Neither alone holds
  // in both themes; the max of the two holds in both, on every plane, at 3.
  //
  // THE SPLIT FLOOR THIS REPLACES WAS A CENSUS. It read the stroke only, so
  // after the move its light arm had to sit at 1.01 against a worst reading of
  // 1.016 — 0.6% of headroom, which cannot tell a drift from the status quo and
  // is exactly what this file's own parity comment calls "a census wearing a
  // floor's name". The bar here is 3 in both themes because the invariant is now
  // true at 3 in both themes, and #99 is the open question of whether the light
  // stroke should stay at all given the fill carries it.
  for (const theme of THEMES) {
    it(`${theme}: the panel and the date sheet stay identifiable on their veil`, () => {
      const { ch, alpha } = veilOf(theme, overlayOf('components/ui/Dialog.tsx'));
      const edge = resolve(BLOCKS[theme], 'field-border');
      const fill = resolve(BLOCKS[theme], 'card');
      for (const plane of ['page', 'card', 'panel'] as const) {
        const behind = channels(resolve(BLOCKS[theme], plane));
        const veil = rgbHex(ch.map((c, i) => c * alpha + behind[i] * (1 - alpha)));
        const best = Math.max(ratio(fill, veil), ratio(edge, veil));
        expect(
          best,
          `neither the panel's fill nor its stroke identifies it over ${plane}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // THE RETIREMENT GUARD, and the reason this file kept a CSS half at all once
  // the arithmetic above collapsed onto one token. Three names for one step is
  // what T4 ruled out, and nothing else in the repo would fail if a later
  // "give the toast its own edge" edit put one back — it would simply be a
  // second name holding a third copy of the same value.
  //
  // THE WHOLE STYLESHEET, not the two palette blocks: a re-mint under `:root`,
  // under a media query or inside a new scope would be just as real and
  // invisible to a two-block check. `[data-dark-surface]` was the standing
  // example until #92 retired it, which is the case for keeping the guard
  // scope-agnostic rather than naming the scopes it knows about.
  it('does not re-mint the three names T4 retired, anywhere in the stylesheet', () => {
    for (const name of RETIRED) {
      expect(CSS, `--color-${name} is declared again`).not.toMatch(
        new RegExp(`--color-${name}\\s*:`),
      );
    }
  });

  // THE RAIL'S EDGE, CLOSED RATHER THAN DESCRIBED. It faces outward at the page
  // and takes `@theme`'s value, which is the pair the sheet costed. Overriding
  // `field-border` under any scope containing the rail would move that edge
  // silently — every ratio above resolves against `@theme` and would go on
  // asserting a value the browser no longer paints for the rail.
  it('leaves the rail edge to `@theme`, not to a scope that contains the rail', () => {
    // THE WHOLE STYLESHEET, for the reason the guard above gives. A block that
    // contains the rail — however its selector is spelled — would move the edge
    // with every ratio here still resolving `@theme`. Any declaration of this
    // token outside the two palette blocks is the defect, whatever carries it.
    const palette = [BLOCKS.light, BLOCKS.dark];
    const strays = [...CSS.matchAll(/([^{}]*)\{([^{}]*--color-field-border\s*:[^{}]*)\}/g)]
      .filter((m) => !palette.some((block) => block.includes(m[2])))
      .map((m) => m[1].trim().split('\n').pop()!.trim());
    expect(
      strays,
      'the rail reads `field-border` from `@theme`; declaring it elsewhere moves that edge',
    ).toEqual([]);
  });

  // THE PALETTE'S OWN INVARIANT, ENFORCED AT LAST. `index.css` calls the
  // one-for-one equality "the real invariant" and adds that "the number is just
  // how it is counted, and the number is what rots" — and then the count was
  // maintained by hand anyway, wrongly three times over by its own admission.
  // Deleting a token from one block passed every gate before this. The chart
  // aliases are excluded because they are declared once and follow the base
  // tokens through `var()`, which the same paragraph explains.
  it('declares the same palette in `@theme` and in the dark block, one for one', () => {
    const names = (block: string) =>
      [
        ...new Set(
          [...block.matchAll(/--color-([a-z0-9-]+):/g)]
            .map((m) => m[1])
            .filter((n) => !n.startsWith('chart-')),
        ),
      ].sort();
    const [light, dark] = [names(BLOCKS.light), names(BLOCKS.dark)];
    expect(
      light.filter((n) => !dark.includes(n)),
      'declared in @theme, missing in dark',
    ).toEqual([]);
    expect(
      dark.filter((n) => !light.includes(n)),
      'declared in dark, missing in @theme',
    ).toEqual([]);
    // An ANTI-EMPTY floor and nothing more — two empty lists agree with each
    // other, so the equality above needs something under it. It is deliberately
    // NOT a completeness check: what stops a live token being deleted from both
    // blocks is something rendering it, not a number here, and a number here
    // would be the hand-kept figure this test exists to replace. #91 set it to
    // 60 rather than 70 precisely because #92 was going to retire the five
    // `sidebar-*` and `pos-on-dark`, and 70 would have failed on a planned
    // retirement for a reason with nothing to do with the invariant. It did,
    // the floor absorbed it, and that is the argument for leaving it here: a
    // floor sits FAR below the count or it is a census wearing a floor's name.
    expect(light.length, 'the palette suddenly has almost nothing in it').toBeGreaterThanOrEqual(
      60,
    );
    // The names this ruling actually depends on. `field-border` is the whole of
    // it now — the three edge names were here too until T4 retired them, and
    // `RETIRED` above is what watches that side. The parchment families are here
    // for the opposite reason: NOTHING RENDERS THEM YET, so until #92, #93 and
    // #95 arrive there is no component to notice their deletion, and the floor
    // above would not either. One name per family is enough — the set equality
    // catches a half-deleted family, and a whole one going is what this stops.
    for (const name of [
      'hairline',
      'panel-border',
      'field-border',
      'accent',
      'accent-fg',
      'selection',
      'info',
      'info-tint-text',
      'logo-outline',
      'sb-bg',
      'sb-item-active',
      'sb-indicator',
      'sb-label',
    ])
      expect(light).toContain(name);
  });
});

/* ────────────────────────── the markup half ────────────────────────── */

/** `.ts` as well as `.tsx`: the chart tooltip's edge is a string in
 *  `core/colors.ts`, and a `.tsx`-only walk could not see it. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Read and stripped ONCE. Everything below reads this map. */
const SOURCES = new Map(
  sourceFiles(here)
    .map((f) => relative(here, f).split(sep).join('/'))
    .map((f) => [f, stripTs(read(f))] as const),
);
const FILES = [...SOURCES.keys()];
const source = (f: string) => {
  const s = SOURCES.get(f);
  expect(s, `${f} is gone — this pin needs rewriting`).toBeDefined();
  return s!;
};
const ALL_SOURCE = [...SOURCES.values()].join('\n');

/** A floating surface names the shadow that dark zeroes. Line-based, which is
 *  enough where `filled-track.test.ts` needed a brace scanner — the border and
 *  the shadow live in one `className` string, not in two attributes. A line that
 *  defers its edge to an interpolation or a concatenation is exempt, the escape
 *  hatch `field-border.test.ts` needs for the same reason. */
const POPOVER_LINE = (line: string) => /shadow-\(--shadow-popover\)/.test(line);
const DEFERS = (line: string) => /\$\{/.test(line) || line.trimEnd().endsWith('+');

const POPOVERS = FILES.flatMap((f) =>
  source(f)
    .split('\n')
    .filter(POPOVER_LINE)
    .map((line) => ({ file: f, line })),
);
/** The files that hold one, so a deferred className can be checked per FILE
 *  when it cannot be checked per line — the compensating half
 *  `field-border.test.ts` pairs with its own escape hatch. */
const POPOVER_FILES = [...new Set(POPOVERS.map((p) => p.file))];

// NOT "every floating surface" — this cannot know what a floating surface is.
// Two of the five paint from a style object with no utility to match on, and one
// of those, the chart tooltip, has no shadow in either theme. So the class is
// named site by site, and the inventory floor below is what fails when one is
// dropped. Closing that properly means one shared recipe instead of five
// hand-written ones, which is #84.
describe('the floating surfaces point at the token', () => {
  it('finds the class-based ones by walking, so an empty pass cannot look green', () => {
    // A FLOOR, not an equality — the rule `filled-track.test.ts` states in the
    // same words: "Only a vanished one fails here." A sixth surface must pass
    // this and be caught by the assertions below instead.
    expect(
      POPOVERS.length,
      'no surface names `shadow-(--shadow-popover)` any more',
    ).toBeGreaterThanOrEqual(3);
  });

  // NO `DEFERS` EXEMPTION HERE ANY MORE. It was the escape hatch for a line that
  // composes its className elsewhere, and the assertion below establishes that
  // no floating surface uses one — so exempting them here could only hide, from
  // this test, the very surface that one is failing about.
  it('names `field-border` on every one of them', () => {
    const missing = POPOVERS.filter((p) => !/\bborder-field-border\b/.test(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(missing).toEqual([]);
  });

  // THE COMPENSATING HALF FOR `DEFERS`. Without it a surface that builds its
  // className from a template literal is exempt from the line check and
  // invisible to everything else — and `Select.tsx` is exactly the file that
  // computed its edge 1000 characters from the recipe before #80, so the shape
  // is live here rather than hypothetical.
  it.each(POPOVER_FILES)('%s names the token somewhere, however it composes', (file) => {
    expect(source(file), `${file} holds a floating surface but never names the token`).toMatch(
      /\bborder-field-border\b/,
    );
  });

  // AND THE COMPENSATOR IS WEAKER THAN IT LOOKS SINCE #98, which this asserts
  // rather than hides. `Select.tsx` and `DatePicker.tsx` hold a trigger FIELD on
  // the same shared rank, so if a listbox ever deferred its className the
  // per-file check above would be satisfied by the trigger and a popover with no
  // boundary at all would pass — the hole `field-border.test.ts` closed in the
  // mirror direction. Nothing defers today, so the per-line check covers all
  // three; when one does, this fails and says the check needs strengthening
  // before the escape hatch can be used.
  it('has no floating surface relying on the escape hatch', () => {
    const deferring = POPOVERS.filter((p) => DEFERS(p.line)).map((p) => p.file);
    expect(
      deferring,
      'a floating surface defers its edge — the per-file check cannot tell it from a field',
    ).toEqual([]);
  });

  // `hairline` keeps dividers and grid lines. On a floating surface it is the
  // defect: once the shadow is gone it is far under the bar on every plane,
  // which is why the popovers left it.
  it('leaves none of them on `hairline`', () => {
    const stale = POPOVERS.filter((p) => /\bborder-hairline\b/.test(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(stale).toEqual([]);
  });

  // The two the utility assertions above are blind to, and the reason the class
  // is listed rather than detected. Both reached `panel-border` by their own
  // route, which is what a class with no shared recipe does.
  it('carries the toast and the chart tooltip, which paint from style objects', () => {
    const main = source('main.tsx');
    expect(main, 'the toast no longer reads the popover shadow').toContain(
      "boxShadow: 'var(--shadow-popover)'",
    );
    expect(main).toContain("border: '1px solid var(--color-field-border)'");
    // Anchored to the DECLARATION, not the file: a sonner action button that
    // legitimately reads `panel-border` must not fail as a border regression.
    expect(main, 'the toast is back on the rank it left').not.toContain(
      "border: '1px solid var(--color-panel-border)'",
    );
    expect(source('core/colors.ts'), 'the chart tooltip lost the token').toContain(
      '1px solid var(--color-field-border)',
    );
  });

  // Neither is a popover, but both ride the token this branch moves them to, so
  // a silent drift off it would put them back under the bar with no test
  // failing. ON THE ELEMENT, not merely in the file: `Sidebar.tsx` is 590 lines,
  // and a whole-file match would stay green with the token on any sibling of the
  // rail.
  //
  // The `Dialog` panel is repaired INWARD only, against its own `card` fill.
  // Outward against the overlay it still fails, and that is #99's — the two
  // overlay assertions in the CSS half hold those readings.
  // EVERY matching line for the panel, ANY of them for the rail, and the
  // asymmetry is deliberate rather than an oversight. `PANEL_CLASS` is consumed
  // twice — by `Dialog` and by `AlertDialog` — so if it is ever split per dialog
  // kind, "one of the panels has an edge" is not the invariant; all of them
  // must. The rail's anchor is a WIDTH, which `Sidebar.tsx` writes on the rail
  // and could legitimately write on a sibling that needs no edge.
  const PANEL_AND_RAIL: [string, RegExp, 'every' | 'some'][] = [
    ['components/ui/Dialog.tsx', /shadow-\(--shadow-dialog\)/, 'every'],
    ['app/Sidebar.tsx', /w-\[244px\]/, 'some'],
  ];
  it.each(PANEL_AND_RAIL)('keeps %s on `field-border`', (file, anchor, quantifier) => {
    const lines = source(file)
      .split('\n')
      .filter((l) => anchor.test(l));
    expect(lines.length, `the ${file} line vanished`).toBeGreaterThan(0);
    const named = lines.filter((l) => /\bborder-field-border\b/.test(l)).length;
    expect(named, `${file} left the token`).toBeGreaterThan(0);
    if (quantifier === 'every') {
      expect(named, `${file} has a panel line without the token`).toBe(lines.length);
    }
  });

  // The markup half of the retirement guard — the CSS half is the palette one
  // above. Comments are stripped from `ALL_SOURCE`, so this is about what the
  // app READS: a component cannot point at a name the palette no longer
  // declares, which renders as no border at all rather than as a failure.
  it('reads none of the three retired names', () => {
    for (const name of RETIRED) {
      expect(ALL_SOURCE, `something still reads \`${name}\``).not.toMatch(
        new RegExp(`\\bborder-${name}\\b|--color-${name}\\b`),
      );
    }
  });
});
