// @vitest-environment jsdom
// The one segmented control (controls.md § Signed, D2): a radiogroup on the glass well, the
// selected segment the tinted knob, sliding.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { stripCss } from '../../__fixtures__/palette';
import { SegmentedControl } from './SegmentedControl';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = stripCss(readFileSync(join(here, '..', '..', 'index.css'), 'utf8'), 'index.css');

afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const;
type Letter = (typeof OPTIONS)[number]['value'];

function Harness({
  onChange,
  initial = 'a',
}: {
  onChange?: (v: Letter) => void;
  initial?: Letter;
}) {
  const [value, setValue] = useState<Letter>(initial);
  return (
    <>
      <SegmentedControl
        aria-label="Letters"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange?.(v);
        }}
        options={OPTIONS}
      />
      {/* Another writer of the same value, as the sidebar's theme is to Settings'. */}
      <button type="button" onClick={() => setValue('c')}>
        elsewhere
      </button>
    </>
  );
}

const radios = () => screen.getAllByRole('radio');
const classes = (el: Element) => el.className.split(/\s+/);

/** An arrow pressed and released, as Radix reads it: held during the focus move it checks. */
async function arrow(from: HTMLElement, key: string) {
  fireEvent.keyDown(from, { key });
  await waitFor(() => expect(document.activeElement).not.toBe(from));
  fireEvent.keyUp(document.activeElement!, { key });
}

describe('the segmented control is a radiogroup with arrow keys', () => {
  // Radix's roving focus: arriving on the group lands on the checked radio, which is the one radio
  // in the tab order.
  it('is one named radiogroup, entered on the checked radio, the only radio in the tab order', () => {
    render(<Harness initial="b" />);
    const group = screen.getByRole('radiogroup', { name: 'Letters' });
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    act(() => group.focus());
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(document.querySelector('[aria-pressed]')).toBeNull();
  });

  it('moves and checks with the arrows, wrapping, and tells the owner each time', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    act(() => radios()[0].focus());
    await arrow(radios()[0], 'ArrowRight');
    expect(document.activeElement).toBe(radios()[1]);
    expect(radios()[1].getAttribute('aria-checked')).toBe('true');
    await arrow(radios()[1], 'ArrowLeft');
    await arrow(radios()[0], 'ArrowLeft');
    expect(document.activeElement).toBe(radios()[2]);
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(['b', 'a', 'c']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  // Radix moves its tab stop only when a radio takes focus, so a value written from elsewhere
  // left Shift+Tab landing on a radio that is not checked.
  it('keeps the checked radio the tab stop when the value changes from elsewhere', () => {
    render(<Harness />);
    act(() => radios()[1].focus());
    fireEvent.click(screen.getByRole('button', { name: 'elsewhere' }));
    expect(radios().map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    expect(radios().map((r) => r.tabIndex)).toEqual([-1, -1, 0]);
  });

  // The root is focusable for Radix's hand-off; a press on its padding or a gap would park focus
  // there, unseen and deaf to the arrows.
  it('takes no focus from a press on the well between the segments', () => {
    render(<Harness />);
    expect(fireEvent.mouseDown(screen.getByRole('radiogroup')), 'the well took the press').toBe(
      false,
    );
    expect(fireEvent.mouseDown(radios()[1]), 'a segment lost its press').toBe(true);
  });

  it('selects on a press', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.getByRole('radio', { name: 'Gamma' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('the segmented control is drawn as signed', () => {
  it('sits on the glass well, 12 round with a 5 px gap to the 7-round segments', () => {
    render(<Harness />);
    const well = screen.getByRole('radiogroup');
    expect(classes(well)).toEqual(
      expect.arrayContaining(['glass-well', 'rounded-[12px]', 'p-[5px]']),
    );
    expect(classes(well)).not.toEqual(expect.arrayContaining(['bg-ink']));
    expect(well.hasAttribute('data-filled-track')).toBe(false);
    for (const r of radios())
      expect(classes(r)).toEqual(expect.arrayContaining(['h-7', 'rounded-[7px]', 'text-small']));
  });

  it('marks the selected segment with the tinted knob and its 700 label, the rest muted 600', () => {
    render(<Harness />);
    const knob = document.querySelector('[data-owns-motion]')!;
    expect(knob.getAttribute('aria-hidden')).toBe('true');
    expect(classes(knob)).toEqual(expect.arrayContaining(['glass-knob-tint', 'rounded-[7px]']));
    const [on, ...off] = radios();
    expect(classes(on)).toEqual(expect.arrayContaining(['font-bold', 'text-segment-label']));
    expect(classes(on)).not.toContain('hover:bg-ink/5');
    for (const r of off)
      expect(classes(r)).toEqual(
        expect.arrayContaining(['font-semibold', 'text-muted', 'hover:bg-ink/5']),
      );
    // H1, the fade, is the rejected hover.
    for (const r of radios()) expect(r.className).not.toMatch(/opacity/);
  });

  it('slides the knob 300 ms on ease-soft to the checked segment, with a .97 press', () => {
    render(<Harness />);
    const knob = document.querySelector<HTMLElement>('[data-owns-motion]')!;
    expect(classes(knob)).toEqual(
      expect.arrayContaining(['transition-transform', 'duration-300', 'ease-soft']),
    );
    expect(knob.style.transform).toBe('translateX(calc(0 * (100% + 4px)))');
    fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));
    expect(knob.style.transform).toBe('translateX(calc(2 * (100% + 4px)))');
    // jsdom, like a browser, serialises the division as a product.
    expect(knob.style.width).toMatch(/^calc\(0\.333+ \* \(100% - 10px - 8px\)\)$/);
    for (const r of radios()) expect(classes(r)).toContain('active:scale-[.97]');
  });

  // The knob's slide is a transition, so the global reduced-motion rule is what stops it.
  it('moves at once under reduced motion', () => {
    expect(CSS).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*\*::before,\s*\*::after\s*\{[^}]*transition-duration:\s*0\.01ms !important/,
    );
  });
});
