// @vitest-environment jsdom
// The checkbox (controls-and-overlays.md § Signed, K2): a native input drawn as a 16 px r4 box,
// a `field-border` edge on `page` when off, an `accent` fill with a 10 px `accent-fg` check when on.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ratio, resolve, stripCss, themeBlocks } from '../../__fixtures__/palette';
import { Checkbox } from './Checkbox';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '..', '..', 'index.css'), 'utf8'), 'index.css');
const BLOCKS = themeBlocks(CSS);

afterEach(cleanup);

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
const box = () => screen.getByRole('checkbox', { name: 'Also reinvest' }) as HTMLInputElement;
const check = () => box().parentElement!.querySelector('svg')!;

function draw(props: Partial<Parameters<typeof Checkbox>[0]> = {}) {
  const onCheckedChange = vi.fn();
  render(
    <label>
      <Checkbox checked={false} onCheckedChange={onCheckedChange} {...props} />
      <span>Also reinvest</span>
    </label>,
  );
  return onCheckedChange;
}

describe('the checkbox', () => {
  it('is a native checkbox, so Space and the label are the platform’s', () => {
    draw();
    expect(box().tagName).toBe('INPUT');
    expect(box().type).toBe('checkbox');
  });

  it('is a field-border edge on page when off, an accent fill and edge when on', () => {
    draw({ checked: false });
    expect(classes(box())).toEqual(expect.arrayContaining(['border-field-border', 'bg-page']));
    expect(classes(box())).not.toContain('bg-accent');
    cleanup();
    draw({ checked: true });
    expect(classes(box())).toEqual(expect.arrayContaining(['border-accent', 'bg-accent']));
    expect(classes(box())).not.toContain('border-field-border');
  });

  it('is drawn 16 px at r4 (Shape system), with no native look', () => {
    draw();
    expect(classes(box())).toEqual(
      expect.arrayContaining(['appearance-none', 'size-4', 'rounded-[4px]', 'border']),
    );
  });

  it('shows the 10 px accent-fg check only when on, hidden from the accessibility tree', () => {
    draw({ checked: true });
    expect(classes(check())).toEqual(expect.arrayContaining(['opacity-100', 'text-accent-fg']));
    expect(check().getAttribute('width')).toBe('10');
    expect(check().getAttribute('stroke-width')).toBe('3.5');
    expect(check().getAttribute('aria-hidden')).toBe('true');
    cleanup();
    draw({ checked: false });
    expect(classes(check())).toContain('opacity-0');
    expect(classes(check())).not.toContain('opacity-100');
  });

  it('announces its state from the prop', () => {
    draw({ checked: true });
    expect(box().checked).toBe(true);
    cleanup();
    draw({ checked: false });
    expect(box().checked).toBe(false);
  });

  it('toggles on a press anywhere on its label', () => {
    const onChange = draw();
    fireEvent.click(screen.getByText('Also reinvest'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('refuses a press when disabled', () => {
    const onChange = draw({ disabled: true });
    expect(box().disabled).toBe(true);
    fireEvent.click(screen.getByText('Also reinvest'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

// WCAG 1.4.11: the box's edge against its own fill and the surfaces it sits on, and the check
// against the fill it is drawn on.
describe('the box and the check hold 3 : 1, in both themes', () => {
  it.each(['light', 'dark'] as const)('%s', (theme) => {
    const at = (token: string) => resolve(BLOCKS, theme, token);
    for (const surface of ['page', 'card', 'panel']) {
      expect(
        ratio(at('field-border'), at(surface)),
        `off edge on ${surface}`,
      ).toBeGreaterThanOrEqual(3);
      expect(ratio(at('accent'), at(surface)), `on fill on ${surface}`).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(at('accent-fg'), at('accent')), 'check on the fill').toBeGreaterThanOrEqual(3);
  });
});
