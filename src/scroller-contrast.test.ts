// The scroll thumb's body holds 3 : 1 at rest, hovered and dragged, against its rail and against
// the glass it lies on, in both themes (controls.md § Wave 28, Contrast; WCAG 1.4.11). The thumb
// is twice the rail's width, so its sides lie on the card and its middle on the rail.
//
// RECORDED SHORTFALL, NOT PINNED: in light the thumb's lit edge, the white bevel and the start of
// its sheen, falls under 3 : 1 against the card. The body clears it.
//
// The three tokens are the thumb's classes, which `components/ui/scroller.test.tsx` pins.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  composite,
  glassPlanes,
  mixOf,
  ratio,
  resolve,
  stripCss,
  themeBlocks,
  type Theme,
} from './__fixtures__/palette';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

describe.each<Theme>(['light', 'dark'])('the scroll thumb, %s', (theme) => {
  // Read inside the test, so a reader that finds nothing fails as this test and not the file.
  const surfaces = () => {
    // What a bar runs on: the default glass and the dialogs' thicker one, and the opaque planes, the
    // import's `panel` box, the `card` under reduced transparency and the `page` behind the native bar.
    const planes = [
      ...glassPlanes(CSS, theme),
      ...glassPlanes(CSS, theme, {
        fill: 'glass-dialog-fill',
        over: ['card', 'panel'],
        veil: 'scrim',
      }),
      ...['panel', 'card', 'page'].map((name) => resolve(BLOCKS, theme, name)),
    ];
    // The rail's fill, and its edge over the fill.
    const well = mixOf(BLOCKS, theme, 'glass-well');
    const ring = mixOf(BLOCKS, theme, 'scroll-rail-edge');
    const rails = planes.flatMap((plane) => {
      const fill = composite(well, plane);
      return [fill, composite(ring, fill)];
    });
    return [...planes, ...rails];
  };

  it.each([
    ['at rest', 'accent'],
    ['hovered', 'accent-hover'],
    ['dragged', 'accent-pressed'],
  ])('holds 3 : 1 %s against its rail and the glass', (_, token) => {
    const body = resolve(BLOCKS, theme, token);
    const least = Math.min(...surfaces().map((behind) => ratio(body, behind)));
    expect(least).toBeGreaterThanOrEqual(3);
  });
});
