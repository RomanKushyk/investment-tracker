// @vitest-environment jsdom
// THE RUN LOG'S STATUS, a glyph and a word with no box (`docs/superpowers/specs/2026-11-05-layout-refresh/super-admin.md`
// § Signed, S3): the glyph in its status colour, the word in `ink`, and shape and word carry the
// state, never the hue alone.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ratio, resolve, stripCss, themeBlocks } from '../../__fixtures__/palette';
import { uk } from '../../i18n/messages';
import type { ArchiveOperation } from '../../lib/repository';
import { RunLog } from './RunLog';

// The settings store's default language is `uk`, the dictionary read below. The table's
// Scroller is Radix's ScrollArea, which observes its size.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
// A getter, since `useIsDesktop` keeps the first MediaQueryList it is handed: flipping `desktop`
// moves the log between its table and its stacked rows.
let desktop = true;
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') && desktop;
  },
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

const ME = 'me-0000000';
const WORD = uk.archive.runs.state;
type State = keyof typeof WORD;
const STATES = Object.keys(WORD) as State[];

const run = (state: ArchiveOperation['state'], id: string = state): ArchiveOperation => ({
  id,
  mode: 'observe',
  parameters: { source: 'nbu_fv', from: '2026-07-01', to: '2026-07-02' },
  state,
  startedBy: ME,
  startedAt: '2026-07-28T10:40:00.000000Z',
  deadlineAt: '2026-07-28T11:01:00.000000Z',
  finishedAt: state === 'running' ? null : '2026-07-28T10:42:00.000000Z',
  result: state === 'succeeded' ? { dates: 1, written: 1, mismatched: 0 } : null,
  error: state === 'failed' ? { reason: 'capture_failed', message: null } : null,
});

type Log = Parameters<typeof RunLog>[0]['log'];
const logOf = (runs: ArchiveOperation[], pending = true): Log =>
  ({
    pending: pending
      ? [
          {
            key: 'k',
            start: { mode: 'observe', source: 'nbu_fv', from: '2026-07-01', to: '2026-07-02' },
            read: true,
            newest: undefined,
          },
        ]
      : [],
    runs,
    failure: undefined,
    stale: false,
    failedAt: 0,
    moreFailed: false,
    loading: false,
    more: undefined,
    loadingMore: false,
    read: () => {},
    start: async () => ({ kind: 'offline' }),
  }) as unknown as Log;

const mountAll = () =>
  render(
    <RunLog log={logOf([run('running'), run('succeeded'), run('failed')])} me={ME} className="" />,
  );

/** The status line: the element whose own text is the state's word. */
const status = (state: State) => screen.getByText(WORD[state]);
const glyph = (state: State) => status(state).querySelector('svg')!;
const classes = (el: Element) => el.getAttribute('class') ?? '';

const TONE: Record<State, string> = {
  pending: 'muted',
  running: 'info',
  succeeded: 'muted',
  failed: 'warn',
};

describe.each([
  ['the table, at and above md', true],
  ['the stacked rows, below md', false],
])('a run state is a glyph and a word, with no box, in %s', (_, wide) => {
  beforeEach(() => {
    desktop = wide;
  });
  afterAll(() => {
    desktop = true;
  });

  it('draws the layout it names', () => {
    mountAll();
    expect(document.querySelector('table') !== null).toBe(wide);
  });

  it.each(STATES)('%s: no fill, border, padding, ring or radius on the line', (state) => {
    mountAll();
    expect(classes(status(state))).not.toMatch(
      /(^|\s)(bg-|border|p[xytrbl]?-|rounded|ring|outline|shadow)/,
    );
  });

  it.each(STATES)('%s: the glyph takes its status colour, the word `ink`', (state) => {
    mountAll();
    expect(classes(glyph(state)).split(/\s+/)).toContain(`text-${TONE[state]}`);
    expect(classes(status(state)).split(/\s+/)).toContain('text-ink');
  });

  it.each(STATES)('%s: the glyph is 14 px at stroke 2.25', (state) => {
    mountAll();
    expect(glyph(state).getAttribute('width')).toBe('14');
    expect(glyph(state).getAttribute('stroke-width')).toBe('2.25');
  });

  it.each(STATES)('%s: no `pos` or `neg` anywhere in the line', (state) => {
    mountAll();
    for (const el of [status(state), ...status(state).querySelectorAll('*')]) {
      expect(classes(el)).not.toMatch(/(^|[:\s])(text|bg|border|fill|stroke)-(pos|neg)\b/);
    }
  });
});

describe('a running glyph spins only where motion is welcome', () => {
  // jsdom evaluates no media query, so the class is what is pinned; the stand-still itself is
  // the browser check under emulated reduced motion.
  it('running carries `motion-safe:animate-spin` and no bare `animate-spin`', () => {
    mountAll();
    const tokens = classes(glyph('running')).split(/\s+/);
    expect(tokens).toContain('motion-safe:animate-spin');
    expect(tokens).not.toContain('animate-spin');
  });

  it.each(STATES.filter((s) => s !== 'running'))('%s does not spin', (state) => {
    mountAll();
    expect(classes(glyph(state))).not.toMatch(/animate-spin/);
  });
});

describe('a state change cross-fades on a line that keeps its height', () => {
  it('running → succeeded puts a new, fading line in place, both 22 px', () => {
    const view = render(<RunLog log={logOf([run('running', 'r1')], false)} me={ME} className="" />);
    const before = status('running');
    expect(classes(before).split(/\s+/)).toEqual(
      expect.arrayContaining(['h-[22px]', 'animate-in', 'fade-in']),
    );
    view.rerender(<RunLog log={logOf([run('succeeded', 'r1')], false)} me={ME} className="" />);
    const after = status('succeeded');
    expect(after).not.toBe(before);
    expect(before.isConnected).toBe(false);
    expect(classes(after).split(/\s+/)).toEqual(
      expect.arrayContaining(['h-[22px]', 'animate-in', 'fade-in']),
    );
  });
});

describe('each status colour holds 3 : 1 on the card', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const BLOCKS = themeBlocks(
    stripCss(readFileSync(join(here, '../../index.css'), 'utf8'), 'index.css'),
  );
  // Read off the glyphs as drawn, so a tone changed in RunLog is the tone measured here.
  it.each(STATES)('%s, in light and dark', (state) => {
    mountAll();
    const tone = classes(glyph(state)).match(/(?:^|\s)text-([a-z-]+)(?=\s|$)/)?.[1];
    expect(tone, 'the glyph names no status colour').toBeDefined();
    for (const theme of ['light', 'dark'] as const) {
      expect(
        ratio(resolve(BLOCKS, theme, tone!), resolve(BLOCKS, theme, 'card')),
        `${tone} on card, ${theme}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
