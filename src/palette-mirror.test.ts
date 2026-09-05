import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// THE PALETTE HAS THREE COPIES OF ONE VALUE, AND TWO OF THEM ARE NOT CSS.
//
// `--color-page` is duplicated in `src/app/theme.ts` (the `CHROME` map, which
// writes the `theme-color` meta on every resolve) and in `index.html` (the seed
// that value overwrites). Neither can be reached from a stylesheet — the browser
// chrome does not follow a CSS custom property — so the duplication is necessary
// and was, until this file, guarded by nothing at all. A palette could move
// underneath them and the only symptom would be a seam where the app meets the
// browser, in one theme, on one device.
//
// So the assertion is not "CHROME holds these hexes" but "CHROME holds whatever
// `index.css` holds": the stylesheet is the source and these two are mirrors.
// That survives the next re-valuing without an edit here.
//
// The second half is a MIGRATION GUARD and its list is closed. `parchment-5h`
// re-valued every token in both blocks, and the way that goes wrong is not a
// missing name — `floating-edges.test.ts` catches those — but a value left behind,
// in a declaration or in a sentence about one.
//
// SELF-CONTAINED ON PURPOSE, the house idiom — `field-border.test.ts:72` gives
// the reason there is no shared colour helper to import.
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

// EVERY VALUE THE PARCHMENT PALETTE REPLACED, and the list is CLOSED — a record
// of one migration, not a register to append to. Only `#d8b494` (then
// `brand-sand`, since #93 the dark `accent` and `logo-outline`)
// and `#eceae7` (dark `ink`) came through unchanged, so this is the whole of the
// previous palette as it was declared, plus the two chrome mirrors of the old
// `page`.
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
  // COMMENTS INCLUDED, deliberately. `index.css` argues from its own hexes on
  // nearly every token, so a comment left behind states something false about
  // the file it sits in — and that is the form this migration was always going
  // to rot in.
  //
  // THE THREE FILES ARE THE WHOLE SCOPE, and the title says so rather than
  // claiming the repo. `public/favicon.svg`, `scripts/build-touch-icon.mjs` and
  // `src/app/mark.test.ts` held `#26262a` / `#e9e8e6` while the Q-arrow did,
  // and #93 redrew the mark, so they carry no retired value any more and the
  // exemption they had is spent. Widening the sweep onto them is deliberately
  // NOT done here — the owner ruled it its own issue, since it guards a
  // different thing from the palette's two mirrors and would arrive with no
  // failing case behind it. `mark.test.ts` is what keeps those three files
  // honest meanwhile, and it reads their colours out of `index.css` rather
  // than freezing them.
  it.each(Object.keys(FILES) as (keyof typeof FILES)[])('%s holds none of them', (file) => {
    const source = FILES[file].toLowerCase();
    const found = RETIRED.filter((hex) => source.includes(hex));
    expect(found, `${file} still carries retired values`).toEqual([]);
  });
});

/* ─────────── the figures `index.css` records beside its values ─────────── */

/** sRGB → relative luminance, WCAG 2.x. Triplicated across the guards on
 *  purpose — `field-border.test.ts:72`: "There is no colour helper to reuse:
 *  `core/` is pure money maths and owns no colour." */
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
  // Sliced rather than matched: a name interpolated into a `RegExp` is one
  // stray escape away from a pattern that matches the wrong thing and still
  // passes, which this line did on its first draft. The `:` in the needle is
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

// A FIGURE LIVES IN A TEST OR NOT AT ALL (CLAUDE.md). *Design pipeline* pulls
// the other way for one class of figure — "anything still under it carries its
// reason or its open issue WHERE THE VALUE IS DECLARED" — so `index.css` keeps
// the recorded shortfalls in prose beside the tokens. This block is what stops
// that prose rotting: every number the stylesheet states about a pair is
// recomputed here from the values it actually declares.
//
// These are DESCRIPTIVE, not floors. Each one is a reading the owner ruled on
// in #90 or a margin the sheet flagged; a change to any of them is a palette
// decision, and the point of the assertion is that it cannot happen quietly.
describe('the recorded readings still read as recorded', () => {
  const RECORDED: [string, keyof typeof BLOCKS, string, string, number][] = [
    // The four the owner ruled on in #90: the values stand, the figures are
    // recorded, and these are the assertions that keep the record honest.
    [
      'accent on panel, under 4.5 — rule 2 makes it every link in light',
      'light',
      'accent',
      'panel',
      4.445,
    ],
    ['warn from accent — a caution and the brand are one colour', 'light', 'warn', 'accent', 1.013],
    [
      'sb-label on its wall — nav group headers are 9.5-10px text',
      'light',
      'sb-label',
      'sb-bg',
      3.091,
    ],
    ['sb-label on its wall, dark', 'dark', 'sb-label', 'sb-bg', 4.325],
    // THE SUCCESSOR OF THE `brand-sand` ROW, and the improvement is most of the
    // way rather than all of it. That sand read 1.487 on the light wall because
    // it was drawn for a plate dark in both themes; the mark takes the three
    // per-theme `logo-*` names now, and five of its six readings clear — 4.49
    // and 7.74 in light, 10.07 / 15.06 / 5.33 in dark. The lighter pill in
    // light does not, and it is the same `reit` hue as the row below.
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

  // TO TWO DECIMALS, against the reading rather than against the rounded figure
  // the prose prints. One decimal was tried and is wrong for at least one row:
  // a contrast ratio floors at 1.0, so `toBeCloseTo(1.01, 1)` accepts anything
  // under 1.06 and cannot fail for ANY pair — the warn/accent collision would
  // have been guarded by nothing. Two decimals costs an exact expected value
  // here and buys an assertion that bites on every row.
  it.each(RECORDED)('%s', (_label, block, a, b, expected) => {
    expect(ratio(resolve(block, a), resolve(block, b))).toBeCloseTo(expected, 2);
  });

  // NOT a shortfall — the opposite, and that is why it needs pinning. `warn`
  // clears 1.4.3 on the binding plane by 0.003, so a nudge to EITHER token in
  // EITHER direction puts the Σ≠100 pill, the DEMO badge, the drift chip and
  // every stale chip under the bar. Asserted as a floor, not a reading.
  it('keeps `warn` above 4.5 on `panel`, where it has 0.003 to spare', () => {
    expect(ratio(resolve('light', 'warn'), resolve('light', 'panel'))).toBeGreaterThanOrEqual(4.5);
  });

  // THE OTHER FIVE PARTS OF THE MARK, and a floor rather than five readings —
  // `index.css` says they clear, and one recorded shortfall is the whole of
  // what the mark is allowed. Without this the stylesheet's sentence is the
  // only thing holding it, and a re-valued `sb-bg` could put a second part
  // under 1.4.11 with every gate green. `logo-pill-a` in light is the
  // exception, recorded above at its value.
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
