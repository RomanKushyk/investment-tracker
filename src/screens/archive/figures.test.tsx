// @vitest-environment jsdom
// THE ARCHIVE'S FIGURES, the wave-7 hero (`docs/superpowers/specs/2026-11-05-layout-refresh/super-admin.md`
// § Signed, K2): per source the caps label, the empty days as the hero, the sentence as a caption,
// then gaps and captures · size as a fact grid with no hairline.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  declaredIn,
  glassPlanes,
  ratio,
  resolve,
  stripCss,
  themeBlocks,
} from '../../__fixtures__/palette';
import { uk } from '../../i18n/messages';
import type { ArchiveDiagnosis, ArchiveGroup } from '../../lib/repository';
import { Figures } from './Figures';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '../../index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

afterEach(cleanup);

const group = (source: string, emptyDays: number, gaps: number): ArchiveGroup => ({
  instrument_ref: `${source}-${emptyDays}`,
  basis: 'quote',
  source,
  dates: '10',
  measured_from: '2026-01-01',
  last_as_of: '2026-11-15',
  publishedDays: '10',
  gaps,
  importedDays: '0',
  emptyDays,
  emptyDates: [],
});

// Inzhur has two empty days in one of its two groups; the NBU's one group has none.
const ANSWER: ArchiveDiagnosis = {
  size: { rows: '0', total_bytes: '0' },
  bySource: [
    { source: 'inzhur', n: '81', bytes: '3040870' },
    { source: 'nbu_fv', n: '6700', bytes: '35337830' },
  ],
  observations: [group('inzhur', 2, 2), group('inzhur', 0, 0), group('nbu_fv', 0, 0)],
  sample: [],
};

/** The two cards, Inzhur's first. */
function cards(answer: ArchiveDiagnosis | undefined): HTMLElement[] {
  const { container } = render(<Figures answer={answer} className="" />);
  return [...container.firstElementChild!.children] as HTMLElement[];
}

const classes = (el: Element) => el.getAttribute('class')?.split(/\s+/) ?? [];

/** The colour token an element's text takes: its own `text-<colour>` class, or the nearest
 *  ancestor's. */
function colourOf(el: Element | null): string {
  for (; el; el = el.parentElement) {
    const token = classes(el)
      .map((c) => /^text-([a-z-]+)$/.exec(c)?.[1])
      .find((name) => name !== undefined && declaredIn(BLOCKS.light, name) !== undefined);
    if (token) return token;
  }
  throw new Error('no colour token on the element or above it');
}

describe('each source leads with its empty days, then the caption, then the facts', () => {
  it.each([
    [0, 'inzhur'],
    [1, 'nbu_fv'],
  ] as const)('card %i (%s)', (i, source) => {
    const card = cards(ANSWER)[i];
    const [label, hero, caption, facts] = [...card.children];
    expect(card.children).toHaveLength(4);
    expect(label.textContent).toBe(uk.archive.source[source]);
    expect(classes(label)).toEqual(expect.arrayContaining(['text-label-caps', 'uppercase']));
    expect(classes(hero)).toContain('text-display-hero');
    expect(classes(caption)).toEqual(expect.arrayContaining(['text-label', 'text-muted']));
    expect(facts.tagName).toBe('DL');
    expect([...facts.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual([
      uk.archive.kpi.gaps,
      uk.archive.kpi.size,
    ]);
    expect(card.querySelector('.bg-hairline, .h-px')).toBeNull();
  });

  it('reads the summed gaps and the captures with their size', () => {
    const [inzhur, nbu] = cards(ANSWER).map((c) =>
      [...c.querySelectorAll('dd')].map((dd) => dd.textContent),
    );
    // The figures' spaces are the Ukrainian grouping and unit NBSP.
    expect(inzhur).toEqual(['2', '81 · 2,9 МБ']);
    expect(nbu).toEqual(['0', '6 700 · 33,7 МБ']);
  });
});

describe('the warn state belongs to a source with an empty day', () => {
  it('Inzhur, with two empty days, reads them in `warn-tint-text` beside a 26 px TriangleAlert', () => {
    const hero = cards(ANSWER)[0].children[1];
    expect(hero.textContent).toBe('2 дні');
    expect(classes(hero)).toContain('text-warn-tint-text');
    const glyph = hero.querySelector('svg');
    expect(glyph).not.toBeNull();
    expect(classes(glyph!)).toContain('lucide-triangle-alert');
    expect(glyph!.getAttribute('width')).toBe('26');
    expect(cards(ANSWER)[0].children[2].textContent).toBe(uk.archive.kpi.emptySub(1, 2, 0));
  });

  it('the NBU, with none, reads «0 днів» plain, with no glyph', () => {
    const [, hero, caption] = [...cards(ANSWER)[1].children];
    expect(hero.textContent).toBe('0 днів');
    expect(classes(hero)).not.toContain('text-warn-tint-text');
    expect(hero.querySelector('svg')).toBeNull();
    expect(colourOf(hero)).toBe('ink');
    expect(caption.textContent).toBe(uk.archive.kpi.noEmpty);
  });
});

describe('while the first read is out, each card holds its shape with «—»', () => {
  it.each([0, 1])('card %i', (i) => {
    const card = cards(undefined)[i];
    const [label, hero, caption, facts] = [...card.children];
    expect(card.children).toHaveLength(4);
    expect(label.textContent).toBe(uk.archive.source[i === 0 ? 'inzhur' : 'nbu_fv']);
    expect(classes(hero)).toContain('text-display-hero');
    expect(hero.textContent).toBe('—');
    expect(caption.textContent).toBe('—');
    expect([...facts.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['—', '—']);
  });
});

// WCAG 1.4.3: each card's figure and caption are text on the glass, wherever the glow puts it. The
// tokens are read off the rendered card, so a colour change here is judged here.
describe('the figures and the captions read on the glass', () => {
  it.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      [0, 1].flatMap((card) =>
        [
          ['figure', 1],
          ['caption', 2],
        ].map(([what, child]) => [theme, card, what, child] as const),
      ),
    ),
  )(
    '%s: card %i, its %s, clears 4.5 : 1 on its least contrasting plane',
    (theme, card, _what, child) => {
      const token = colourOf(cards(ANSWER)[card].children[child as number]);
      const text = resolve(BLOCKS, theme, token);
      const least = Math.min(...glassPlanes(CSS, theme).map((plane) => ratio(text, plane)));
      expect(least, token).toBeGreaterThanOrEqual(4.5);
    },
  );
});
