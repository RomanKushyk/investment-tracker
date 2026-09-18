import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PALETTE HAS THREE COPIES OF ONE VALUE, AND TWO OF THEM ARE NOT CSS. `--color-page` is
// duplicated in `src/app/theme.ts`'s `CHROME` map, which writes the `theme-color` meta, and
// in `index.html`'s seed that the map overwrites. NEITHER CAN BE REACHED FROM A STYLESHEET —
// the browser chrome does not follow a custom property — so the duplication is necessary and
// was guarded by nothing at all: a palette could move underneath them and the only symptom
// would be a seam where the app meets the browser, in one theme, on one device.
//
// So the assertion is not "CHROME holds these hexes" but "CHROME holds whatever `index.css`
// holds", which survives the next re-valuing without an edit here.
//
// The second half is a MIGRATION GUARD AND ITS LIST IS CLOSED — a record of one migration,
// not a register to append to. The way a re-valuing goes wrong is not a missing name, which
// `floating-edges.test.ts` catches, but a value left behind in a declaration or in a
// sentence about one.
//
// SELF-CONTAINED ON PURPOSE, the house idiom — a guard stands alone. `core/colors.ts` owns
// the chart SERIES and nothing else: no contrast maths lives there, so there is no shared
// helper to import even though `core/` is not colour-free.
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

/** CSS comments out, quote-aware. `index.css` line 5 holds a literal comment
 *  opener inside a string, so a regex strip swallows `@theme` with it. Copied
 *  from `floating-edges.test.ts`'s `stripCss()`, which learned that by failing. */
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
    } else {
      out += c;
    }
  }
  return out;
}

/** The complement of `stripCss` — every comment body, and nothing else. Same
 *  quote-awareness, for the same reason. */
function cssProse(source: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new Error('index.css has an unterminated /* comment');
      out += `${source.slice(i + 2, end)}\n`;
      i = end + 1;
    }
  }
  return out;
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

const FILES = {
  'src/index.css': read('index.css'),
  'src/app/theme.ts': read('app/theme.ts'),
  'index.html': read('../index.html'),
} as const;

const CSS = stripCss(FILES['src/index.css'], 'index.css');
const BLOCKS = {
  light: ruleBody(CSS, '@theme'),
  dark: ruleBody(CSS, "[data-theme='dark']"),
};

function page(block: keyof typeof BLOCKS): string {
  const m = BLOCKS[block].match(/--color-page:\s*(#[0-9a-fA-F]{6});/);
  expect(m, `--color-page is not declared as a hex in the ${block} block`).not.toBeNull();
  return m![1].toLowerCase();
}

/** The two values `CHROME` holds, read as source text — this file must not
 *  import from the app, whose module graph pulls React in for one object. */
function chrome(): { light: string; dark: string } {
  const body = FILES['src/app/theme.ts'].match(/const CHROME[^=]*=\s*\{([^}]*)\}/);
  expect(body, 'CHROME is no longer an object literal in theme.ts').not.toBeNull();
  const pick = (key: string) => {
    const m = body![1].match(new RegExp(`${key}:\\s*'(#[0-9a-fA-F]{6})'`));
    expect(m, `CHROME.${key} is not a hex literal`).not.toBeNull();
    return m![1].toLowerCase();
  };
  return { light: pick('light'), dark: pick('dark') };
}

describe('the browser chrome mirrors `--color-page`, in both themes', () => {
  it('`CHROME` holds what `index.css` holds, and is not its own source', () => {
    expect(chrome().light, 'CHROME.light vs @theme --color-page').toBe(page('light'));
    expect(chrome().dark, 'CHROME.dark vs the dark block --color-page').toBe(page('dark'));
  });

  // The seed is what paints before `useTheme` runs, so a stale one is a flash of
  // the OLD palette on every cold load — the failure the boot script exists to
  // prevent, reintroduced one meta tag lower.
  it('the `index.html` seed is the light `--color-page`', () => {
    const m = FILES['index.html'].match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/);
    expect(m, 'the theme-color meta is gone or is no longer a hex').not.toBeNull();
    expect(m![1].toLowerCase()).toBe(page('light'));
  });
});

// EVERY VALUE THE PARCHMENT PALETTE REPLACED: the whole of the previous palette as it was
// declared, plus the two chrome mirrors of the old `page`. Two hexes came through unchanged
// and are therefore absent.
const RETIRED = [
  '#0f0f11',
  '#141416',
  '#1c1c1f',
  '#1c1c20',
  '#20272d',
  '#22301f',
  '#232327',
  '#26262a',
  '#2a2a2e',
  '#33261d',
  '#332714',
  '#333338',
  '#33333a',
  '#3a211b',
  '#3d3d42',
  '#4a4a55',
  '#4c5a48',
  '#525c64',
  '#5c7355',
  '#5c7f53',
  '#5f5e5a',
  '#693f35',
  '#696865',
  '#6b5527',
  '#6d5a53',
  '#6e6d6a',
  '#6f8567',
  '#747169',
  '#84827d',
  '#8b8a90',
  '#8ba283',
  '#8f6b33',
  '#8fb184',
  '#96959b',
  '#98a3ad',
  '#9b9a96',
  '#9dbb93',
  '#a3a19b',
  '#a8695a',
  '#a8b6c2',
  '#a9c79f',
  '#adaba5',
  '#b3b2ae',
  '#b3c1cd',
  '#b9cdb4',
  '#c2a189',
  '#c4c3c0',
  '#cfcecb',
  '#d1a55f',
  '#d8b394',
  '#d9907e',
  '#dcbb80',
  '#dedcd8',
  '#e0bfa4',
  '#e3eadf',
  '#e4e8eb',
  '#e5a996',
  '#e8e7e4',
  '#e9e8e6',
  '#efe4e0',
  '#f0cec7',
  '#f0e6cb',
  '#f6f5f3',
  '#ffffff',
] as const;

describe('the palette and its two mirrors carry no retired value', () => {
  // COMMENTS INCLUDED, DELIBERATELY: `index.css` argues from its own hexes beside nearly
  // every token, so a comment left behind states something false about the file it sits in —
  // the form this migration was always going to rot in.
  //
  // THE THREE FILES ARE THE WHOLE SCOPE, and the title says so rather than claiming the
  // repo. Widening the sweep onto the mark's own files is deliberately NOT done here: the
  // owner ruled it its own issue, since it guards a different thing from the palette's two
  // mirrors. `mark.test.ts` keeps those honest meanwhile, reading their colours out of
  // `index.css` rather than freezing them.
  it.each(Object.keys(FILES) as (keyof typeof FILES)[])('%s holds none of them', (file) => {
    const source = FILES[file].toLowerCase();
    const found = RETIRED.filter((hex) => source.includes(hex));
    expect(found, `${file} still carries retired values`).toEqual([]);
  });

  // IS THE SWEEP ACTUALLY LOOKING? An absence guard passes on a tree where nothing is left
  // to find, and this one is already there: no value in `RETIRED` appears in any of the
  // three files. A positive control held OUTSIDE the swept set is what keeps the needles
  // provably live, the pattern `infra/src/__fixtures__/retired-lifetime-prose.txt` set. A
  // `.txt` because the same words in a swept file would make the control the first offender.
  it('is actually looking — every retired value still matches the record', () => {
    const record = read('__fixtures__/retired-palette-prose.txt').toLowerCase();
    expect(RETIRED.filter((hex) => !record.includes(hex))).toEqual([]);
  });
});

/* ─────────── the figures `index.css` records beside its values ─────────── */

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

/** A token's hex in a block, following a `var()` chain the way the cascade
 *  does — a name the dark block does not override resolves against `@theme`. */
function resolve(block: keyof typeof BLOCKS, name: string, seen: string[] = []): string {
  expect(seen, `--color-${name} resolves in a cycle`).not.toContain(name);
  // Sliced rather than matched: a name interpolated into a `RegExp` is one stray escape
  // from a pattern that matches the wrong thing and still passes. The `:` in the needle is
  // what keeps `--color-info` off `--color-info-tint`.
  const needle = `--color-${name}:`;
  const decl = (b: string) => {
    const at = b.indexOf(needle);
    return at === -1 ? undefined : b.slice(at + needle.length, b.indexOf(';', at)).trim();
  };
  const value = decl(BLOCKS[block]) ?? decl(BLOCKS.light);
  expect(value, `--color-${name} is declared in neither block`).toBeDefined();
  const alias = value!.match(/^var\(\s*--color-([a-z0-9-]+)\s*\)$/);
  if (alias) return resolve(block, alias[1], [...seen, name]);
  return value!.toLowerCase();
}

// A FIGURE LIVES IN A TEST OR NOT AT ALL, and *Design pipeline* pulls the other way for one
// class of figure — anything still under the bar carries "its reason or its open issue where
// the value is declared" — so `index.css` keeps the recorded shortfalls in prose beside the
// tokens. This block is what stops that prose rotting: every number the stylesheet states
// about a pair is recomputed here from the values it declares.
//
// These are DESCRIPTIVE, not floors. Each is a reading the owner ruled on or a margin the
// sheet flagged, so a change to any of them is a palette decision that cannot happen quietly.
describe('the recorded readings still read as recorded', () => {
  const RECORDED: [string, keyof typeof BLOCKS, string, string, number][] = [
    // The four the owner ruled on: the values stand and the figures are recorded.
    [
      'accent on panel, under 4.5 — rule 2 makes it every link in light',
      'light',
      'accent',
      'panel',
      4.445,
    ],
    ['warn from accent — a caution and the brand are one colour', 'light', 'warn', 'accent', 1.013],
    [
      'sb-label on its wall — the nav group captions, 11px since #107',
      'light',
      'sb-label',
      'sb-bg',
      3.091,
    ],
    ['sb-label on its wall, dark', 'dark', 'sb-label', 'sb-bg', 4.325],
    // THE SAME TOKEN, TWO PLANES FURTHER DOWN, with a consumer on each: the capital strip's
    // caption on the `sb-field` recess, the version badge on the footer band. Both recorded
    // and neither repaired — `sb-label` is the caption rank throughout this panel, and a
    // second grey for one caption is the re-mint the palette forbids.
    ['sb-label on the capital strip, light', 'light', 'sb-label', 'sb-field', 3.476],
    ['sb-label on the capital strip, dark', 'dark', 'sb-label', 'sb-field', 4.053],
    [
      'sb-label on the footer band — the version, light',
      'light',
      'sb-label',
      'sb-footer-bg',
      2.867,
    ],
    ['sb-label on the footer band — the version, dark', 'dark', 'sb-label', 'sb-footer-bg', 4.139],
    // THE SUCCESSOR OF THE `brand-sand` ROW, and the improvement is most of the way rather
    // than all of it: that sand was drawn for a plate dark in both themes, and the mark
    // takes the three per-theme `logo-*` names now. Five of its six readings clear; the
    // lighter pill in light does not, and it is the same `reit` hue as the row below.
    ['logo-pill-a on the wall, light', 'light', 'logo-pill-a', 'sb-bg', 2.812],
    // Two more the sheet records at their values.
    [
      'reit on panel — ColorDot and ShareBar paint the bare hue there',
      'light',
      'reit',
      'panel',
      2.785,
    ],
    [
      "the switch's OFF edge on its own track, dark",
      'dark',
      'switch-border',
      'switch-track',
      2.046,
    ],
  ];

  // The nine the sheet prints beside the tokens. The two it does not print are the dark
  // halves of the capital strip and the footer band; the set is frozen rather than derived,
  // so a figure added to or removed from the stylesheet has to move this list with it.
  const STATED_IN_THE_SHEET = [
    'accent on panel, under 4.5 — rule 2 makes it every link in light',
    'warn from accent — a caution and the brand are one colour',
    'sb-label on its wall — the nav group captions, 11px since #107',
    'sb-label on its wall, dark',
    'sb-label on the capital strip, light',
    'sb-label on the footer band — the version, light',
    'logo-pill-a on the wall, light',
    'reit on panel — ColorDot and ShareBar paint the bare hue there',
    "the switch's OFF edge on its own track, dark",
  ];

  // TO TWO DECIMALS, against the reading rather than the rounded figure the prose prints.
  // ONE DECIMAL CANNOT FAIL FOR ANY PAIR: a contrast ratio floors at 1.0, so
  // `toBeCloseTo(1.01, 1)` accepts anything under 1.06 and the warn/accent collision would
  // have been guarded by nothing.
  it.each(RECORDED)('%s', (_label, block, a, b, expected) => {
    expect(ratio(resolve(block, a), resolve(block, b))).toBeCloseTo(expected, 2);
  });

  // AND THE OTHER HALF OF THAT SENTENCE, which was asserted by nothing: the block above
  // recomputes what the sheet states, but never checked the sheet still states it. The
  // stylesheet prints these to two decimals, so a reading is "stated" when its own rounding
  // appears IN A COMMENT — the declarations carry decimals of their own and would match by
  // accident. Nine of the eleven are stated; the set is frozen, so deleting one or reverting
  // one to an older figure moves it and reddens here.
  it('index.css still states the readings it records, beside the tokens', () => {
    const stated = RECORDED.filter(([, , , , expected]) =>
      cssProse(FILES['src/index.css']).includes(expected.toFixed(2)),
    ).map(([label]) => label);
    expect(stated).toEqual(STATED_IN_THE_SHEET);
  });

  // The DEMO badge is on `page` as well as on the wall, since the header carries one
  // wherever it is mounted, and neither the sheet's table nor the arm below covers that
  // plane. Its edge is what makes it a chip rather than floating text, so 1.4.11 binds at 3.
  it.each(['light', 'dark'] as const)('%s: the DEMO edge identifies itself on `page`', (block) => {
    expect(ratio(resolve(block, 'warn'), resolve(block, 'page'))).toBeGreaterThanOrEqual(3);
  });

  // NOT a shortfall — the opposite, and that is why it needs pinning: `warn` clears 1.4.3 on
  // the binding plane by a hair, so a nudge to EITHER token in EITHER direction puts the
  // Σ≠100 pill, the DEMO badge and every stale chip under the bar.
  it('keeps `warn` above 4.5 on `panel`, where it has 0.003 to spare', () => {
    expect(ratio(resolve('light', 'warn'), resolve('light', 'panel'))).toBeGreaterThanOrEqual(4.5);
  });

  // THE OTHER FIVE PARTS OF THE MARK, a floor rather than five readings: one recorded
  // shortfall is the whole of what the mark is allowed, and without this the stylesheet's
  // sentence is the only thing holding it. `logo-pill-a` in light is that exception,
  // recorded above at its value.
  it.each([
    ['logo-outline', 'light'],
    ['logo-pill-b', 'light'],
    ['logo-outline', 'dark'],
    ['logo-pill-a', 'dark'],
    ['logo-pill-b', 'dark'],
  ] as [string, keyof typeof BLOCKS][])('`%s` clears 3 : 1 on the wall in %s', (name, block) => {
    expect(ratio(resolve(block, name), resolve(block, 'sb-bg'))).toBeGreaterThanOrEqual(3);
  });

  // The identities `index.css` records beside the minted families. They are the
  // sheet's own and were declined for resolution there, so what is guarded is
  // that they stay KNOWN — a later session that separates them should have to
  // delete a line here and say so.
  it.each([
    ['accent', 'energy', 'light'],
    ['accent', 'energy', 'dark'],
    ['accent', 'logo-outline', 'light'],
    ['accent', 'logo-outline', 'dark'],
    ['logo-pill-a', 'reit', 'light'],
    ['logo-pill-b', 'reit', 'dark'],
    ['info', 'ovdp8976', 'light'],
    ['info', 'ovdp8976', 'dark'],
    ['info-tint', 'ovdp8976-tint', 'light'],
    ['info-tint', 'ovdp8976-tint', 'dark'],
  ] as [string, string, keyof typeof BLOCKS][])('`%s` is still `%s` in %s', (a, b, block) => {
    expect(resolve(block, a)).toBe(resolve(block, b));
  });
});

// THE FOCUS RING, AND THE TOKEN IS HALF OF IT: `:focus-visible` reads `focus`, an alias of
// the accent in both blocks. A focus indicator is bound by WCAG 1.4.11 at 3 : 1 against what
// it is drawn on, and the base rule is unqualified, so that is every plane the app has —
// including the WALL, where the rail's currency toggle lives.
//
// BOTH HALVES, the reason `filled-track.test.ts` gives about its own attribute: a token is
// inert without the rule that reads it. Nothing else here would notice `--color-focus` being
// deleted, so the CSS half is what stops the arithmetic guarding a value no ring resolves.
describe('the focus ring is the accent, and clears 1.4.11 on every plane', () => {
  it.each(['light', 'dark'] as const)('`focus` is declared in the %s block', (block) => {
    expect(
      BLOCKS[block],
      'the block declares no `focus` of its own. DECLARED, not merely resolvable: ' +
        '`resolve()` falls back to `@theme` for a name the dark block omits, so a light-only ' +
        'mint would pass every reading below',
    ).toContain('--color-focus:');
  });

  it.each(['light', 'dark'] as const)('`focus` is the accent in %s', (block) => {
    expect(
      resolve(block, 'focus'),
      'the focus ring has been separated from the accent. The alias IS the decision, so ' +
        'that is a palette move and should cost a deleted line here plus a sentence',
    ).toBe(resolve(block, 'accent'));
  });

  // `sb-bg` and `sb-field` are the wall and its field rank: `Sidebar.tsx` states that the
  // footer band's two tracks take NO `data-filled-track`, because their ground is the active
  // route's tint rather than the plane's foreground, so their segments are served by the
  // BASE rule. This is the half that keeps that sentence true after a re-valuing.
  it.each([
    ['page', 'light'],
    ['card', 'light'],
    ['panel', 'light'],
    ['sb-bg', 'light'],
    ['sb-field', 'light'],
    ['page', 'dark'],
    ['card', 'dark'],
    ['panel', 'dark'],
    ['sb-bg', 'dark'],
    ['sb-field', 'dark'],
  ] as [string, keyof typeof BLOCKS][])('reads on `%s` in %s', (plane, block) => {
    expect(ratio(resolve(block, 'focus'), resolve(block, plane))).toBeGreaterThanOrEqual(3);
  });

  it('declares the two `chart-` aliases the capital chart resolves through', () => {
    // ONCE, in `@theme`, following the base tokens by `var()` — which is why
    // `floating-edges.test.ts`'s parity test filters `chart-` out, so nothing else asserts
    // these two exist.
    //
    // ON THE STRIPPED TEXT, the point of asserting it here: this stylesheet argues from its
    // own token text on nearly every line, so a raw `toContain` is satisfied by a comment
    // quoting the declaration while the declaration itself is gone.
    expect(CSS).toContain('--color-chart-accent: var(--color-accent);');
    expect(CSS).toContain('--color-chart-accent-tint: var(--color-accent-tint);');
    expect(
      CSS,
      'the gain pair is back beside the aliases that replaced it, leaving two answers for ' +
        'one line',
    ).not.toContain('--color-chart-pos');
  });

  it('keeps the rule that reads the token', () => {
    // NOT the filled-track override, which `filled-track.test.ts` pins. This is the base
    // rule, and it must name the TOKEN rather than the accent directly, or the alias is one
    // the app declares and nothing consumes.
    expect(ruleBody(CSS, ':focus-visible')).toMatch(/outline:\s*2px solid var\(--color-focus\)/);
  });

  it('leaves the filled track its own ring, which the accent cannot give it', () => {
    // The pairing's REASON, computed rather than asserted in prose: a segmented track is
    // `bg-ink` and the accent on ink is under 3 : 1, so the override is load-bearing rather
    // than a leftover from when the base ring was ink.
    for (const block of ['light', 'dark'] as const) {
      expect(ratio(resolve(block, 'focus'), resolve(block, 'ink'))).toBeLessThan(3);
    }
    expect(ruleBody(CSS, '[data-filled-track] :focus-visible')).toContain(
      'outline-color: var(--color-page)',
    );
  });
});
