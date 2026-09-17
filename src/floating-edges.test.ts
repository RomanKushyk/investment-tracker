import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE FLOATING SURFACES' BOUNDARY, ON THE SAME TOKEN AS THE FIELD EDGE (`floating-edges.
// dc.html` T4). An `AssetForm` `Select` opens INSIDE a `Dialog`, so a `bg-card` popover
// lands on a `bg-card` plane — and WCAG 1.4.11 governs "the visual information required to
// identify user interface components", which a listbox popover is.
//
// Two halves and neither catches the other, the split `field-border.test.ts` records. With
// no shared popover component a fourth surface added by copying a third lands on whatever
// the third used, which is how the toast got its own edge.
//
// SELF-CONTAINED ON PURPOSE, the house idiom rather than a necessity: a guard stands alone.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
/** `declared()` takes the FIRST match in a block and this stylesheet's comments quote token
 *  declarations constantly, so a comment could satisfy an assertion the CSS fails.
 *  Quote-aware rather than a regex, which this file learned by failing: `index.css` line 5
 *  holds a comment opener inside a string, and a naive reader takes `@theme` with it. */
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
      // Loudly, not silently: truncating would let every assertion pass over a partial file.
      if (end === -1) throw new Error(`${what} has an unterminated /* comment`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

/** LINE BY LINE, and the line boundary is the point: a whole-file scanner cannot be exact
 *  without parsing TypeScript, because a regex literal may hold a quote —
 *  `src/core/backup/csv.ts` has one — and that desynchronises quote tracking for the REST
 *  OF THE FILE, silently switching stripping off. Per line, a desync cannot outlive it. */
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

/** `undefined` is not an error on its own: the cascade falls back to `@theme` for anything
 *  the dark block does not override. */
function declaredIn(block: string, name: string): string | undefined {
  const m = block.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : undefined;
}

function declared(block: string, name: string): string {
  const value = declaredIn(block, name);
  expect(value, `--color-${name} is not declared in this block`).toBeDefined();
  return value!;
}

/** Follows a `var(--color-x)` chain THE WAY THE CASCADE DOES, so a name the dark block does
 *  not override resolves against `@theme`. A PLANE may be an alias — `drawer-edge` is one
 *  of this very rank in dark — where `field-border.test.ts`'s hex-matching `token()` sees
 *  nothing. */
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

/** TWO GROUPS, not one union. Collapsing them would demand the rank clear the bar on the
 *  wall for surfaces never drawn there and on `card` for a rail that never touches it, so
 *  re-planing the wall would fail this test about six surfaces it cannot affect. `card`
 *  binds twice over — a popover's own fill AND, inside a `Dialog`, the plane behind it. */
const DRAWN_ON = {
  'the floating surfaces': ['page', 'card', 'panel'],
  'the desktop rail': ['sb-bg'],
} as const;
const THEMES = ['light', 'dark'] as const;
/** Not a token list — a list of what must NOT come back. */
const RETIRED = ['popover-edge', 'toast-edge', 'surface-edge'] as const;

describe('a floating surface clears 3 : 1 on every plane it is drawn on', () => {
  for (const theme of THEMES) {
    for (const group of Object.keys(DRAWN_ON) as (keyof typeof DRAWN_ON)[]) {
      it(`${theme}: the rank clears the bar under ${group}`, () => {
        const value = resolve(BLOCKS[theme], 'field-border');
        for (const surface of DRAWN_ON[group]) {
          expect(
            ratio(value, resolve(BLOCKS[theme], surface)),
            `field-border reads under 3 : 1 on ${surface} — the surface is unidentifiable`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }

  // THE OVERLAY ADJACENCY IS A SEPARATE READING, not a plane above: the panel and the date
  // sheet float over the overlay, so what identifies them is that composite.
  //
  // ANCHORED ON `inset-0`, not on the first `bg-` in the file. While the veil was
  // `bg-<token>/<n>` its alpha made the class unique; `bg-scrim` is not, and a bare `bg-`
  // match reads `DatePicker`'s `hover:bg-page` three hundred lines above the overlay —
  // which it did, silently, until this was anchored. Either quote, because `Dialog` holds
  // its string in a const and `DatePicker` writes the attribute inline.
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
    expect(
      overlayOf('components/ui/Dialog.tsx'),
      'the two overlays drifted apart — read separately because `OVERLAY_CLASS` is not ' +
        'exported and `DatePicker` hand-copies the string',
    ).toEqual(overlayOf('components/ui/DatePicker.tsx'));
  });

  // EITHER BOUNDARY, AT THE REAL BAR. 1.4.11 asks for the information that IDENTIFIES a
  // component, not for a stroke, and a panel offers two candidates: its FILL against the
  // composite, and its STROKE. The veil moves them in opposite directions — light
  // identifies by fill, dark by stroke — so neither alone holds in both themes and the max
  // of the two does. #99 keeps the question the arithmetic cannot answer: whether the light
  // stroke should stay at all. Compositing is plain sRGB and exact: Tailwind mixes in
  // oklab, but mixing with `transparent` only sets alpha.
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

  // Three names for one step is what T4 ruled out, and nothing else in the repo would fail
  // if a "give the toast its own edge" edit put one back. THE WHOLE STYLESHEET, not the two
  // palette blocks: a re-mint under `:root`, under a media query or inside a new scope is
  // just as real and invisible to a two-block check.
  it('does not re-mint the three names T4 retired, anywhere in the stylesheet', () => {
    for (const name of RETIRED) {
      expect(CSS, `--color-${name} is declared again`).not.toMatch(
        new RegExp(`--color-${name}\\s*:`),
      );
    }
  });

  // THE RAIL'S EDGE, CLOSED RATHER THAN DESCRIBED: overriding `field-border` under any
  // scope containing the rail moves that edge while every ratio above goes on resolving
  // `@theme`. Written for ANY such scope rather than the ones it knows about.
  it('leaves the rail edge to `@theme`, not to a scope that contains the rail', () => {
    const palette = [BLOCKS.light, BLOCKS.dark];
    const strays = [...CSS.matchAll(/([^{}]*)\{([^{}]*--color-field-border\s*:[^{}]*)\}/g)]
      .filter((m) => !palette.some((block) => block.includes(m[2])))
      .map((m) => m[1].trim().split('\n').pop()!.trim());
    expect(
      strays,
      'the rail reads `field-border` from `@theme`; declaring it elsewhere moves that edge',
    ).toEqual([]);
  });

  // THE PALETTE'S OWN INVARIANT, ENFORCED RATHER THAN COUNTED BY HAND. Deleting a token
  // from one block passed every gate before this. The chart aliases are excluded: they are
  // declared once and follow the base tokens through `var()`.
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
    // An ANTI-EMPTY floor and nothing more: two empty lists agree with each other. NOT a
    // completeness check — a number here would be the hand-kept figure this test replaces,
    // and it sits FAR below the count or it is a census wearing a floor's name.
    expect(light.length, 'the palette suddenly has almost nothing in it').toBeGreaterThanOrEqual(
      60,
    );
    // One name per family: the set equality above catches a half-deleted family, a whole
    // one going is what this stops. The parchment families were minted ahead of any
    // consumer, so the floor would not have noticed one going.
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

/** `.ts` as well as `.tsx`: the chart tooltip's edge is a string in `core/colors.ts`, and
 *  a `.tsx`-only walk could not see it. */
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
const FILES = [...SOURCES.keys()];
const source = (f: string) => {
  const s = SOURCES.get(f);
  expect(s, `${f} is gone — this pin needs rewriting`).toBeDefined();
  return s!;
};
const ALL_SOURCE = [...SOURCES.values()].join('\n');

/** Line-based is enough where `filled-track.test.ts` needed a brace scanner — the border
 *  and the shadow live in one `className` string, not in two attributes. A line deferring
 *  its edge to an interpolation OR A CONCATENATION is exempt — the two arms of `DEFERS` —
 *  and the `it` below holds that exemption empty. */
const POPOVER_LINE = (line: string) => /shadow-\(--shadow-popover\)/.test(line);
const DEFERS = (line: string) => /\$\{/.test(line) || line.trimEnd().endsWith('+');

const POPOVERS = FILES.flatMap((f) =>
  source(f)
    .split('\n')
    .filter(POPOVER_LINE)
    .map((line) => ({ file: f, line })),
);
const POPOVER_FILES = [...new Set(POPOVERS.map((p) => p.file))];

// NOT "every floating surface" — this cannot know what one is. Two of the five paint from a
// style object with no utility to match on, so the class is named site by site and the
// floor below fails when one is dropped. Closing it properly means one shared recipe (#84).
describe('the floating surfaces point at the token', () => {
  it('finds the class-based ones by walking, so an empty pass cannot look green', () => {
    expect(
      POPOVERS.length,
      'no surface names `shadow-(--shadow-popover)` any more — a floor, so a sixth surface ' +
        'passes here and is caught by the assertions below instead',
    ).toBeGreaterThanOrEqual(3);
  });

  // NO `DEFERS` EXEMPTION HERE: the `it` two below holds that exemption empty, so exempting
  // a line here could only hide the very surface that one fails about.
  it('names `field-border` on every one of them', () => {
    const missing = POPOVERS.filter((p) => !/\bborder-field-border\b/.test(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(missing).toEqual([]);
  });

  // THE COMPENSATING HALF FOR `DEFERS`: without it a surface building its className from a
  // template literal is exempt from the line check and invisible to everything else.
  it.each(POPOVER_FILES)('%s names the token somewhere, however it composes', (file) => {
    expect(source(file), `${file} holds a floating surface but never names the token`).toMatch(
      /\bborder-field-border\b/,
    );
  });

  // AND THE COMPENSATOR IS WEAKER THAN IT LOOKS, asserted rather than hidden: `Select.tsx`
  // and `DatePicker.tsx` hold a trigger FIELD on the same shared rank, so a listbox that
  // deferred its className would satisfy the per-file check through the trigger while its
  // own popover had no boundary at all.
  it('has no floating surface relying on the escape hatch', () => {
    const deferring = POPOVERS.filter((p) => DEFERS(p.line)).map((p) => p.file);
    expect(
      deferring,
      'a floating surface defers its edge — the per-file check cannot tell it from a field',
    ).toEqual([]);
  });

  it('leaves none of them on `hairline`', () => {
    const stale = POPOVERS.filter((p) => /\bborder-hairline\b/.test(p.line)).map(
      (p) => `${p.file}: ${p.line.trim().slice(0, 90)}`,
    );
    expect(
      stale,
      'a floating surface is back on `hairline`, which is far under the bar on every plane ' +
        'once the shadow is gone — the token keeps dividers and grid lines, not surfaces',
    ).toEqual([]);
  });

  // The two the utility assertions are blind to, and why the class is listed rather than
  // detected. Both reached `panel-border` by their own route, which is what a class with no
  // shared recipe does.
  it('carries the toast and the chart tooltip, which paint from style objects', () => {
    const main = source('main.tsx');
    expect(main, 'the toast no longer reads the popover shadow').toContain(
      "boxShadow: 'var(--shadow-popover)'",
    );
    expect(main).toContain("border: '1px solid var(--color-field-border)'");
    expect(
      main,
      'the toast is back on the rank it left — matched on the DECLARATION, so a sonner ' +
        'action button legitimately reading `panel-border` is not a border regression',
    ).not.toContain("border: '1px solid var(--color-panel-border)'");
    expect(source('core/colors.ts'), 'the chart tooltip lost the token').toContain(
      '1px solid var(--color-field-border)',
    );
  });

  // Neither is a popover, but both ride this token. ON THE ELEMENT, not merely in the file:
  // a whole-file match stays green with the token on any sibling of the rail. EVERY line
  // for the panel, ANY for the rail, deliberately — `PANEL_CLASS` is consumed by `Dialog`
  // and `AlertDialog`, so split per dialog kind ALL of them must have an edge, while the
  // rail's anchor is a WIDTH `Sidebar.tsx` could write on a sibling that needs none.
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

  // The markup half of the retirement guard, and comments are stripped from `ALL_SOURCE` so
  // it is about what the app READS: pointing at a name the palette no longer declares
  // renders as no border at all rather than as a failure.
  it('reads none of the three retired names', () => {
    for (const name of RETIRED) {
      expect(ALL_SOURCE, `something still reads \`${name}\``).not.toMatch(
        new RegExp(`\\bborder-${name}\\b|--color-${name}\\b`),
      );
    }
  });
});
