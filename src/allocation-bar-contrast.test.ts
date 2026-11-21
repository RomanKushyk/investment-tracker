// A share printed inside an allocation bar part is near-black or white, whichever reads more on
// that part's fill (`charts.md` § Signed › Forms, A3). The fills are tokens, so the pick is made once
// per slot and theme in the stylesheet, and this reads it back from there for every slot.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { COLOR_KEYS, SERIES } from '@quirenote/core/colors';
import { ratio, resolve, stripCss, themeBlocks } from './__fixtures__/palette';

const here = dirname(fileURLToPath(import.meta.url));
const BLOCKS = themeBlocks(stripCss(readFileSync(join(here, 'index.css'), 'utf8'), 'index.css'));
const token = (paint: string) => paint.match(/^var\(--color-([a-z0-9-]+)\)$/)![1];

describe.each(['light', 'dark'] as const)('the allocation bar’s labels in %s', (theme) => {
  const dark = resolve(BLOCKS, theme, 'on-fill-dark');
  const light = resolve(BLOCKS, theme, 'on-fill-light');

  it('choose between a near-black and white', () => {
    expect(dark).toBe('#1c1a19');
    expect(light).toBe('#ffffff');
  });

  it.each(COLOR_KEYS)('%s takes the one of the two with more contrast on its fill', (key) => {
    const fill = resolve(BLOCKS, theme, token(SERIES[key].main));
    const label = resolve(BLOCKS, theme, token(SERIES[key].label));
    const best = ratio(dark, fill) >= ratio(light, fill) ? dark : light;
    expect(label).toBe(best);
  });
});
