import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '@tailwindcss/node';
import { describe, expect, it } from 'vitest';

import {
  channels,
  composite,
  declared,
  ratio,
  resolve,
  rgbHex,
  stripCss,
  themeBlocks,
  type Theme,
} from '../../__fixtures__/palette';
import { buttonVariants } from './button-variants';

// B4 and H2 (controls.md § Signed): the secondary is the glass knob with `ink` text, and every
// neutral control hovers with an `ink` 5 % veil instead of fading.
const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '../../index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

const classes = (opts: Parameters<typeof buttonVariants>[0]) => buttonVariants(opts).split(/\s+/);

describe('the secondary is the glass knob', () => {
  it('wears the knob at button scale with ink text, and no outline', () => {
    const outline = classes({ variant: 'outline' });
    expect(outline).toEqual(expect.arrayContaining(['glass-button', 'text-ink']));
    expect(outline).not.toContain('border-ink');
    expect(outline).not.toContain('bg-transparent');
    // The base's ring is kept for the isometry, painted transparent as the filled ones paint it.
    expect(outline).toContain('border-transparent');
  });

  // A done backup is the knob natively disabled: the map gives `aria-disabled` no tone, which
  // its call sites own as busy (70 %), so no element ever carries two opacities.
  it('fades a disabled knob as any disabled button, and leaves aria-disabled to its sites', () => {
    expect(classes({ variant: 'outline' })).toContain('disabled:opacity-50');
    expect(buttonVariants({ variant: 'outline' })).not.toMatch(/aria-disabled:/);
    expect(buttonVariants({ variant: 'outline', disabledTone: 'busy' })).not.toMatch(
      /aria-disabled:/,
    );
  });
});

describe('neutral hover is an ink veil, never a fade', () => {
  it('veils the ghost and the knob, and steps the primary along the accent', () => {
    expect(classes({ variant: 'ghost' })).toContain('hover:bg-ink/5');
    expect(classes({ variant: 'outline' })).toContain('hover:bg-glass-button-hover');
    expect(classes({ variant: 'primary' })).toContain('hover:bg-accent-hover');
    for (const variant of ['ghost', 'outline', 'primary'] as const)
      expect(buttonVariants({ variant }), variant).not.toMatch(/hover:opacity-/);
  });

  it('builds the hover after the knob, so the veil wins over the rest fill', async () => {
    const compiler = await compile(CSS, { base: join(here, '../..'), onDependency: () => {} });
    const built = compiler.build(['glass-button', 'hover:bg-glass-button-hover']);
    const rest = built.indexOf('.glass-button {');
    const hover = built.indexOf('.hover\\:bg-glass-button-hover:hover');
    expect(rest, 'the knob is not built').toBeGreaterThan(-1);
    expect(hover, 'the hover is not built').toBeGreaterThan(rest);
  });
});

/* ──────────── #101: the knob's hover inside the import drop target ──────────── */

const FILL = { of: 'card', alpha: 0.92 }; // `@utility glass-button`'s fill
const VEIL = 0.05;

/** `--color-glass-button-hover`, the veil folded into the knob's fill as one colour. */
function hoverFill(theme: Theme) {
  // Whitespace collapsed: the formatter wraps a long value across lines.
  const value = declared(BLOCKS[theme], 'glass-button-hover')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');
  const m = value.match(
    /^color-mix\(in srgb, color-mix\(in srgb, var\(--color-ink\) ([0-9.]+)%, var\(--color-card\)\) ([0-9.]+)%, transparent\)$/,
  );
  expect(m, `--color-glass-button-hover has an unread shape: ${value}`).not.toBeNull();
  const [p, alpha] = [+m![1] / 100, +m![2] / 100];
  const [ink, card] = [
    channels(resolve(BLOCKS, theme, 'ink')),
    channels(resolve(BLOCKS, theme, 'card')),
  ];
  return { ch: ink.map((c, i) => c * p + card[i] * (1 - p)), alpha };
}

const fill = (theme: Theme) => ({
  ch: channels(resolve(BLOCKS, theme, FILL.of)),
  alpha: FILL.alpha,
});

describe('the knob steps on any ground (#101)', () => {
  // At rest the drop target paints `panel`, in drag-over `hairline`; the outline's old hover was
  // `panel` itself, 1.00 : 1 over the first.
  const CASES: [Theme, string][] = [
    ['light', 'panel'],
    ['light', 'hairline'],
    ['dark', 'panel'],
    ['dark', 'hairline'],
  ];

  it.each(CASES)(
    'in %s over `%s`, the hover is the ink veil laid over the rest',
    (theme, ground) => {
      const rest = composite(fill(theme), resolve(BLOCKS, theme, ground));
      const hover = composite(hoverFill(theme), resolve(BLOCKS, theme, ground));
      const veiled = channels(
        composite({ ch: channels(resolve(BLOCKS, theme, 'ink')), alpha: VEIL }, rest),
      );
      channels(hover).forEach((c, i) =>
        expect(Math.abs(c - veiled[i]), rgbHex(veiled)).toBeLessThanOrEqual(1),
      );
    },
  );

  // The floor is the least of the four readings, rounded down: a veil is a light cue by design (H2).
  it.each(CASES)('in %s over `%s`, hover and rest differ by at least 1.09 : 1', (theme, ground) => {
    const rest = composite(fill(theme), resolve(BLOCKS, theme, ground));
    const hover = composite(hoverFill(theme), resolve(BLOCKS, theme, ground));
    expect(ratio(rest, hover)).toBeGreaterThanOrEqual(1.09);
  });
});

/* ──────────── the two geometry axes the asking row and the flush ghost need ──────────── */

describe('the sizes and the inset', () => {
  it('has a dense `xs` at 26 / r7, round(26 × .26), for a control inside a list row', () => {
    const xs = classes({ size: 'xs' });
    expect(xs).toEqual(expect.arrayContaining(['h-[26px]', 'rounded-[7px]']));
    expect(xs.filter((c) => /^p[lr]-/.test(c))).toHaveLength(2);
  });

  it('pads a flush ghost evenly and pulls it back past its border, so the veil has a box', () => {
    const flush = classes({ variant: 'ghost', inset: 'flushLeft' });
    // 1.5px border + 10px padding on each side; the margin takes back the left pair.
    expect(flush).toEqual(expect.arrayContaining(['pl-2.5', 'pr-2.5', '-ml-[11.5px]']));
    expect(flush).not.toContain('border-l-0');
    // One padding per side: two of a kind fight over the generated order.
    expect(flush.filter((c) => /^pl-/.test(c))).toEqual(['pl-2.5']);
    expect(flush.filter((c) => /^pr-/.test(c))).toEqual(['pr-2.5']);
  });
});
