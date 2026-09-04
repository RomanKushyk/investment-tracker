import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE FLOATING SURFACES' BOUNDARY, PINNED AT THE SAME BAR AS THE FIELD EDGE.
//
// Dark zeroes `--shadow-popover`, so a popover is #1c1c1f on #1c1c1f with a
// #2a2a2e edge at 1.19 : 1 and nothing else. The worst case is not that: an
// `AssetForm` `Select` opens INSIDE a `Dialog`, so a `bg-card` popover lands on
// a `bg-card` plane — a 1.00 : 1 fill step. WCAG 1.4.11 governs "the visual
// information required to identify user interface components", and a listbox
// popover is a component.
//
// Two halves need pinning and neither catches the other — the split
// `field-border.test.ts` records. THE CSS HALF is arithmetic on the tokens:
// nothing else in this repo reads a stylesheet, so a "tidy the palette" edit can
// put a boundary back under the bar with every test green. THE MARKUP HALF is
// which surfaces point at the token; there is no shared popover component, so a
// fourth floating surface added by copying a third lands on whatever the third
// used — which is exactly how the toast ended up on its own edge.
//
// THE VALUES ARE ALIASES, AND THAT IS THE POINT. Not one declaration holds a
// hex, so no grey is minted and no boundary can drift from the token it was
// measured as — the trade `--color-drawer-edge` states in the same words.
// `resolve()` is the one helper here that is new, and it exists for exactly
// that: `field-border.test.ts`'s `token()` matches a literal hex and would see
// nothing.
//
// THREE NAMES, ONE DARK VALUE, THREE LIGHT ONES. That is the ruling and not an
// accident: in dark none of these surfaces has a shadow left, so all three take
// `field-border`; in light they differ, and each keeps exactly what it already
// drew — the drawings' `hairline` for the popovers and the date sheet,
// `panel-border` for the toast and the chart tooltip, which arrived with edges
// of their own from sonner and recharts, and `transparent` for the `Dialog`
// panel and the rail, which have a real shadow there. So light does not move at
// all, which is what makes this a plain fix rather than a design session.
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

/** sRGB → relative luminance, WCAG 2.x. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
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

const SURFACES = ['page', 'card', 'panel'] as const;
/** `surface-edge` is worn by two things and neither sits on those three: the
 *  desktop rail is a `sidebar` plane, and `Dialog` floats over the scrim. The
 *  rail's boundary is read against its OWN fill, so `sidebar` has to be in the
 *  set or lightening it would erase that edge from the inside, silently. */
const PLANES = {
  'popover-edge': SURFACES,
  'toast-edge': SURFACES,
  'surface-edge': [...SURFACES, 'sidebar'],
} as const;
/** Derived, so a fourth edge cannot be given planes and then never measured. */
const EDGES = Object.keys(PLANES) as (keyof typeof PLANES)[];

describe('a floating surface clears 3 : 1 in dark, where its shadow is zeroed', () => {
  // `card` binds twice over: it is the popover's own fill AND, inside a Dialog,
  // the plane behind it. `panel` is the weakest plane a popover opens over.
  for (const edge of EDGES) {
    it(`dark \`${edge}\` is at or above 3 : 1 on every plane it is drawn on`, () => {
      const value = resolve(BLOCKS.dark, edge);
      for (const surface of PLANES[edge]) {
        expect(
          ratio(value, resolve(BLOCKS.dark, surface)),
          `${edge} on ${surface}`,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  // LIGHT DOES NOT MOVE AT ALL, and that is the whole reason there are three
  // names for one dark grey. Each group keeps the light value it already
  // shipped, so this is a dark-only repair — which is what makes it a plain fix
  // rather than a design session (*Design pipeline*). Repairing light means an
  // opaque 3 : 1 stroke on surfaces ten merged drawings draw, and that is #86.
  //
  // A `toBe` against the token it must equal, not a hex: the assertion is "this
  // did not move", and it stays true if `hairline` or `panel-border` is itself
  // re-derived later for its own reasons.
  it('light keeps every group on the value it already had', () => {
    expect(resolve(BLOCKS.light, 'popover-edge'), 'the popovers and the date sheet').toBe(
      resolve(BLOCKS.light, 'hairline'),
    );
    expect(resolve(BLOCKS.light, 'toast-edge'), 'the toast and the chart tooltip').toBe(
      resolve(BLOCKS.light, 'panel-border'),
    );
    // `Dialog` and the rail carry a real shadow in light, so an outline there is
    // decoration nothing asked for — the reason this one is half transparent.
    expect(declared(BLOCKS.light, 'surface-edge'), 'the Dialog panel and the rail').toBe(
      'transparent',
    );
  });

  // The three are one value in dark and three in light, so a "tidy the palette"
  // pass that collapses them would silently move a light edge. Pinned as the
  // shape of the ruling rather than as three hexes.
  it('is one stroke in dark and three in light, which is why the names differ', () => {
    const dark = EDGES.map((e) => resolve(BLOCKS.dark, e));
    expect(new Set(dark).size, `dark should be one value, got ${dark.join(', ')}`).toBe(1);
    const light = EDGES.map((e) => declared(BLOCKS.light, e));
    expect(new Set(light).size, `light should be three values, got ${light.join(', ')}`).toBe(3);
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
    // would be the hand-kept figure this test exists to replace.
    expect(light.length, 'the palette suddenly has almost nothing in it').toBeGreaterThanOrEqual(
      40,
    );
    // The names this ruling actually depends on, including the three light
    // values the edges alias — deleting `hairline` would take a light edge with
    // it and the set equality would not notice.
    for (const name of [...EDGES, 'hairline', 'panel-border', 'field-border'])
      expect(light).toContain(name);
  });

  // Inlining the hex would still pass the ratios above and then stop tracking
  // `field-border` the next time it moves. The alias IS the guard — so what is
  // pinned is that the value is READ and not copied, not the exact spelling of
  // the chain, which `resolve()` is deliberately relaxed about.
  it('reads the repaired edge through a token, never as a copy of its hex', () => {
    for (const name of EDGES) {
      expect(declared(BLOCKS.dark, name), `dark ${name} inlines a hex`).toMatch(
        /^var\(--color-[a-z0-9-]+\)$/,
      );
      expect(resolve(BLOCKS.dark, name)).toBe(resolve(BLOCKS.dark, 'field-border'));
      // Light is read through a token too, so the group it belongs to can be
      // re-derived once without three call sites having to be found again.
      if (declared(BLOCKS.light, name) !== 'transparent') {
        expect(declared(BLOCKS.light, name), `light ${name} inlines a hex`).toMatch(
          /^var\(--color-[a-z0-9-]+\)$/,
        );
      }
    }
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

  it('names `popover-edge` on every one of them', () => {
    const missing = POPOVERS.filter(
      (p) => !/\bborder-popover-edge\b/.test(p.line) && !DEFERS(p.line),
    ).map((p) => `${p.file}: ${p.line.trim().slice(0, 90)}`);
    expect(missing).toEqual([]);
  });

  // THE COMPENSATING HALF FOR `DEFERS`. Without it a surface that builds its
  // className from a template literal is exempt from the line check and
  // invisible to everything else — and `Select.tsx` is exactly the file that
  // computed its edge 1000 characters from the recipe before #80, so the shape
  // is live here rather than hypothetical.
  it.each(POPOVER_FILES)('%s names the token somewhere, however it composes', (file) => {
    expect(source(file), `${file} holds a floating surface but never names the token`).toMatch(
      /\bborder-popover-edge\b/,
    );
  });

  // `hairline` keeps dividers and grid lines. On a floating surface it is the
  // defect: it reads 1.19 : 1 on card once the shadow is gone.
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
    expect(main).toContain("border: '1px solid var(--color-toast-edge)'");
    // Anchored to the DECLARATION, not the file: a sonner action button that
    // legitimately reads `panel-border` must not fail as a border regression.
    expect(main, 'the toast is back on its own edge').not.toContain(
      "border: '1px solid var(--color-panel-border)'",
    );
    expect(source('core/colors.ts'), 'the chart tooltip lost the token').toContain(
      '1px solid var(--color-toast-edge)',
    );
  });

  it('keeps at least the five sites the ruling named', () => {
    expect(
      (ALL_SOURCE.match(/--color-(?:popover|toast)-edge|\bborder-popover-edge\b/g) ?? []).length,
    ).toBeGreaterThanOrEqual(5);
  });

  // Neither is a popover, but both ride the token this branch re-values, so a
  // silent drift off it would put them back under the bar with no test failing.
  // ON THE ELEMENT, not merely in the file: `Sidebar.tsx` is 590 lines, and a
  // whole-file match would stay green with the token on any sibling of the rail.
  it('keeps the `Dialog` panel and the rail on `surface-edge`', () => {
    const panel = source('components/ui/Dialog.tsx')
      .split('\n')
      .filter((l) => /shadow-\(--shadow-dialog\)/.test(l));
    expect(panel.length, 'the Dialog panel line vanished').toBeGreaterThan(0);
    for (const line of panel) expect(line).toMatch(/\bborder-surface-edge\b/);

    const rail = source('app/Sidebar.tsx')
      .split('\n')
      .filter((l) => /w-\[244px\]/.test(l));
    expect(rail.length, 'the rail line vanished').toBeGreaterThan(0);
    expect(
      rail.some((l) => /\bborder-surface-edge\b/.test(l)),
      'the rail left the token',
    ).toBe(true);
  });
});
