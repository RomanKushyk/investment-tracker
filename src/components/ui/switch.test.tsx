// @vitest-environment jsdom
// The switch (controls.md § Signed, S2 with D2's knob): an `accent` track with a check in the
// tinted knob when on, the well when off, and disabled and busy on the component.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripCss } from '../../__fixtures__/palette';
import { Switch } from './Switch';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '..', '..', 'index.css'), 'utf8'), 'index.css');

afterEach(cleanup);

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
const root = () => screen.getByRole('switch');
const knob = () => root().querySelector('span')!;
const check = () => knob().querySelector('svg')!;

function draw(props: Partial<Parameters<typeof Switch>[0]> = {}) {
  const onCheckedChange = vi.fn();
  render(<Switch checked={false} onCheckedChange={onCheckedChange} label="Auto" {...props} />);
  return onCheckedChange;
}

describe('the switch', () => {
  it('is an accent fill and edge when on, the well with a field-border edge when off', () => {
    draw({ checked: true });
    expect(classes(root())).toEqual(expect.arrayContaining(['switch-on', 'border-accent']));
    expect(classes(root())).not.toContain('switch-well');
    cleanup();
    draw({ checked: false });
    expect(classes(root())).toEqual(expect.arrayContaining(['switch-well', 'border-field-border']));
    expect(classes(root())).not.toContain('switch-on');
  });

  it.each([true, false])('wears the tinted knob when checked is %s', (checked) => {
    draw({ checked });
    expect(classes(knob())).toContain('switch-knob');
  });

  it('shows the 10 px accent check only when on, so state is never colour alone', () => {
    draw({ checked: true });
    expect(classes(check())).toEqual(expect.arrayContaining(['opacity-100', 'text-accent']));
    expect(check().getAttribute('width')).toBe('10');
    cleanup();
    draw({ checked: false });
    expect(classes(check())).toContain('opacity-0');
    expect(classes(check())).not.toContain('opacity-100');
    expect(check().getAttribute('aria-hidden')).toBe('true');
  });

  it('reads 50 % when disabled and ignores a press', () => {
    const onChange = draw({ disabled: true });
    expect((root() as HTMLButtonElement).disabled).toBe(true);
    expect(classes(root())).toContain('disabled:opacity-50');
    fireEvent.click(root());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads 70 % when busy, and ignores a press too', () => {
    const onChange = draw({ busy: true });
    expect((root() as HTMLButtonElement).disabled).toBe(true);
    expect(classes(root())).toContain('disabled:opacity-70');
    expect(classes(root())).not.toContain('disabled:opacity-50');
    fireEvent.click(root());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads 50 % when both disabled and busy: a switch you may never press says so', () => {
    draw({ disabled: true, busy: true });
    expect(classes(root())).toContain('disabled:opacity-50');
    expect(classes(root())).not.toContain('disabled:opacity-70');
  });

  it('takes a press when enabled', () => {
    const onChange = draw();
    expect((root() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(root());
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('slides the knob 18 on ease-soft', () => {
    draw({ checked: true });
    expect(classes(knob())).toEqual(
      expect.arrayContaining(['transition-transform', 'ease-soft', 'translate-x-[18px]']),
    );
    cleanup();
    draw({ checked: false });
    expect(classes(knob())).toContain('translate-x-0');
  });

  // The slide is a transition, so the global reduced-motion rule is what stops it.
  it('moves at once under reduced motion', () => {
    expect(CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.01ms !important/,
    );
  });
});
