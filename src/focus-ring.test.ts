import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

import { ratio, resolve, ruleBody, stripCss, themeBlocks } from './__fixtures__/palette';
import { REPO, skipped } from './repo-root';

// *Focus ring* (controls.md F2), each class judged by the CSS Tailwind generates for it, so a
// recipe, a variant or an arbitrary value reads as what it does.

const CSS = stripCss(readFileSync(join(REPO, 'src/index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);
const HALO = 'var(--focus-halo)';

/** One rule's declarations, whitespace collapsed; nested blocks are not read. */
const decls = (rule: string) =>
  Object.fromEntries(
    [
      ...rule
        .slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))
        .replace(/\{[^{}]*\}/g, '')
        .matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+);/g),
    ].map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]),
  );

const scriptKind = (name: string) => (/x$/.test(name) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const walk = (dir: string): string[] =>
  readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return skipped(e.name) || e.name === '__fixtures__' ? [] : walk(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });

/** Every whitespace-separated word of every string and template part, so a comment is not one. */
function words(rel: string): string[] {
  const sf = ts.createSourceFile(
    rel,
    readFileSync(join(REPO, rel), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(rel),
  );
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddleOrTemplateTail(n)) {
      out.push(...n.text.split(/\s+/).filter(Boolean));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const FILES = walk('src');
const WORDS = FILES.map((rel) => ({ rel, words: words(rel) }));

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
let DS: DesignSystem;
/** A class's own declarations as Tailwind writes them, `!important` off; null for a non-class. */
const classCss = (token: string) => {
  const css = DS.candidatesToCss([token])[0];
  if (css === null) return null;
  return Object.fromEntries(
    [...css.matchAll(/(--[\w-]+|[a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => [
      m[1],
      m[2].replace(/\s*!important$/, '').trim(),
    ]),
  );
};
const list = (value: string) => value.split(',').map((p) => p.trim());

beforeAll(async () => {
  DS = await __unstable__loadDesignSystem(CSS, { base: join(REPO, 'src') });
});

describe('the base ring', () => {
  it('is the accent outline at offset 2, with the card halo painted on its own', () => {
    const base = decls(ruleBody(CSS, ':focus-visible'));
    expect(base.outline).toBe('2px solid var(--color-focus)');
    expect(base['outline-offset']).toBe('2px');
    expect(base['--focus-halo']).toBe('0 0 0 2px var(--color-card)');
    expect(base['box-shadow']).toBe(HALO);
  });

  it('registers the halo so it neither inherits nor paints unfocused', () => {
    const prop = decls(ruleBody(CSS, '@property --focus-halo'));
    expect(prop.inherits).toBe('false');
    expect(prop['initial-value']).toBe('0 0 #0000');
  });

  // The halo's plane is what the ring is read against, so it must clear 1.4.11 on it.
  it.each(['light', 'dark'] as const)('reads at 3 : 1 on its halo in %s', (block) => {
    const plane = decls(ruleBody(CSS, ':focus-visible'))['--focus-halo']?.match(
      /var\(--color-([\w-]+)\)/,
    )?.[1];
    expect(plane).toBe('card');
    expect(
      ratio(resolve(BLOCKS, block, 'focus'), resolve(BLOCKS, block, plane ?? 'card')),
    ).toBeGreaterThanOrEqual(3);
  });
});

describe('a control with a shadow of its own', () => {
  it('keeps the sidebar pill indicator under focus and lists the halo after it', () => {
    const own = WORDS.find((f) => f.rel === 'src/app/Sidebar.tsx')!
      .words.map((t) => classCss(t)?.['--tw-shadow'])
      .filter((v): v is string => v?.includes('sb-indicator') ?? false);
    expect(own).toEqual([
      `inset 2px 0 0 var(--tw-shadow-color, var(--color-sb-indicator)), ${HALO}`,
    ]);
  });

  // NOT FOCUSABLE, or focused only as a fallback with its own edge: each owner is named, and the
  // map is compared exactly, so a new shadow on a control fails until it lists the halo.
  const NO_HALO: Record<string, [owner: string, count: number]> = {
    'switch-knob': ['the Switch thumb, a span inside the focusable root', 1],
    'shadow-(--shadow-dialog)': ['the dialog surfaces, focused only when nothing in them is', 1],
    'shadow-(--shadow-popover)': ['the date sheet below md, the same fallback; Tooltip', 2],
    'shadow-[0_0_0_1px_var(--color-card)]': ['Coverage KEYLINE, on divs', 1],
    'shadow-[1px_0_0_var(--color-table-band)]': ['the table head, a th', 1],
    'last:shadow-none': ['the table head, a th', 1],
    'shadow-[inset_2px_0_0_var(--color-sb-indicator)]': ['the rail span inside its link', 1],
    glass: ['Card and KpiCard, divs; the Select and DatePicker lists, the same fallback', 4],
    'glass-well': ['the segmented root, which hands its focus to the checked radio at once', 1],
    'glass-knob-tint': ['the segmented knob, an aria-hidden div', 1],
  };

  it('ends every other box-shadow class in src with the halo', () => {
    const seen: Record<string, number> = {};
    for (const { words: ws } of WORDS) {
      for (const t of ws) {
        const css = classCss(t);
        if (!css || !('box-shadow' in css || '--tw-shadow' in css)) continue;
        const last = css['--tw-shadow'] ?? css['box-shadow'];
        if (last.endsWith(HALO)) continue;
        seen[t] = (seen[t] ?? 0) + 1;
      }
    }
    expect(
      Object.fromEntries(Object.entries(seen).sort()),
      'a shadow class with no halo: list the halo last, or name its non-focusable owner here',
    ).toEqual(
      Object.fromEntries(
        Object.entries(NO_HALO)
          .map(([t, [, n]]) => [t, n])
          .sort(),
      ),
    );
  });
});

describe('the ring arrives at full colour', () => {
  // Each built-in has a twin that differs by `outline-color` alone, so no site's list widens.
  it.each([
    ['transition', 'transition-control'],
    ['transition-colors', 'transition-control-colors'],
  ])('gives %s’s list to %s without outline-color', (builtIn, twin) => {
    const tw = classCss(builtIn)!;
    const own = classCss(twin)!;
    expect(list(tw['transition-property'])).toContain('outline-color');
    expect(list(own['transition-property'])).toEqual(
      list(tw['transition-property']).filter((p) => p !== 'outline-color'),
    );
    expect(own['transition-timing-function']).toBe(tw['transition-timing-function']);
    expect(own['transition-duration']).toBe(tw['transition-duration']);
  });

  // An element that hides the ring hides the halo with it, or a lone `card` box shows.
  it('turns the ring off only through focus-ring-none, which drops the halo too', () => {
    const own = classCss('focus-ring-none')!;
    expect(own['outline-style']).toBe('none');
    expect(own['--focus-halo']).toBe('0 0 #0000');
    const offenders = WORDS.flatMap(({ rel, words: ws }) =>
      ws.filter((t) => hidesRingKeepsHalo(t)).map((t) => `${rel} | ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  // Sonner focuses its list on its hotkey; the list hides the outline in unlayered CSS.
  it('gives the toaster list focus-ring-none, as the census cannot read sonner’s CSS', () => {
    const rel = 'src/app/AppToaster.tsx';
    const sf = ts.createSourceFile(
      rel,
      readFileSync(join(REPO, rel), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const classes: string[] = [];
    const visit = (n: ts.Node) => {
      if (
        (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) &&
        n.tagName.getText(sf) === 'Toaster'
      ) {
        for (const a of n.attributes.properties) {
          if (ts.isJsxAttribute(a) && a.name.getText(sf) === 'className' && a.initializer) {
            if (ts.isStringLiteral(a.initializer)) classes.push(...a.initializer.text.split(/\s+/));
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(classes).toContain('focus-ring-none');
  });

  it('lets no class in src transition the outline', () => {
    const offenders = WORDS.flatMap(({ rel, words: ws }) =>
      ws.filter((t) => fadesRing(t)).map((t) => `${rel} | ${t}`),
    );
    expect(offenders).toEqual([]);
  });

  // The two readers above, calibrated on classes src does not hold today.
  it.each(['outline-none', 'outline-0', 'outline-transparent', 'focus-visible:outline-none'])(
    'reads %s as hiding the ring',
    (t) => expect(hidesRingKeepsHalo(t)).toBe(true),
  );
  it.each(['transition', 'transition-colors', 'transition-all', 'transition-[outline]'])(
    'reads %s as fading the ring',
    (t) => expect(fadesRing(t)).toBe(true),
  );
});

function hidesRingKeepsHalo(token: string): boolean {
  const css = classCss(token);
  if (!css) return false;
  const off =
    css['outline-style'] === 'none' ||
    /^none\b/.test(css.outline ?? '') ||
    /^0(px)?$/.test(css['outline-width'] ?? '') ||
    css['outline-color'] === 'transparent';
  return off && css['--focus-halo'] !== '0 0 #0000';
}

function fadesRing(token: string): boolean {
  const p = classCss(token)?.['transition-property'];
  return p !== undefined && list(p).some((x) => /^(outline(-color)?|all)$/.test(x));
}
