// @vitest-environment jsdom
// The Select on the signed popover (controls.md § Signed, P2): a glass list on the `field-border`
// edge, the chosen option's `accent` check, the highlighted row's `ink` 5 % veil (the owner's
// ruling on #704), and the trigger on the shared field at rest on `page`.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { Select } from './Select';

// Radix's Select asks for these, which jsdom does not carry.
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta', hint: 'second' },
  { value: 'c', label: 'Gamma' },
];

// The attribute, since an SVG's `className` is no string.
const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

function open(props: Partial<Parameters<typeof Select>[0]> = {}) {
  render(<Select value="b" onValueChange={() => {}} options={OPTIONS} {...props} />);
  const trigger = screen.getByRole('combobox');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  return trigger;
}

describe('the list', () => {
  it('is the glass at r14 on the `field-border` edge, with no solid fill, border or shadow', () => {
    open();
    const list = classes(screen.getByRole('listbox'));
    expect(list).toEqual(
      expect.arrayContaining([
        'glass',
        'rounded-[14px]',
        '[--glass-edge:var(--color-field-border)]',
      ]),
    );
    for (const solid of ['bg-card', 'border', 'border-field-border', 'shadow-(--shadow-popover)'])
      expect(list, solid).not.toContain(solid);
    // The edge is an inset shadow, painted under the rows: a pixel of padding keeps a scrolled
    // row from crossing it, as the border's box used to.
    expect(list).toContain('p-px');
  });

  it('marks the chosen option alone with a 14 px `accent` check after its text', () => {
    open();
    const [a, b, c] = screen.getAllByRole('option');
    for (const other of [a, c]) expect(other.querySelector('svg')).toBeNull();
    const check = b.querySelector('svg');
    expect(check, 'the chosen option has no check').not.toBeNull();
    expect(check!.getAttribute('width')).toBe('14');
    expect(classes(check!)).toContain('text-accent');
    // At the row's end: the label and its hint come first.
    expect(b.textContent).toBe('Beta · second');
    expect(b.lastElementChild!.contains(check)).toBe(true);
  });

  it('highlights a row with the `ink` 5 % veil, never the `page` fill', () => {
    open();
    for (const option of screen.getAllByRole('option')) {
      expect(classes(option)).toContain('data-[highlighted]:bg-ink/5');
      expect(option.className).not.toMatch(/\bbg-page\b/);
    }
  });
});

describe('the trigger', () => {
  it('is the shared field at rest on `page` when the caller names no fill', () => {
    render(<Select value="a" onValueChange={() => {}} options={OPTIONS} />);
    expect(classes(screen.getByRole('combobox'))).toEqual(
      expect.arrayContaining(['h-9', 'rounded-[9px]', 'bg-page']),
    );
  });

  it('reads 50 % and cannot open when disabled', () => {
    const trigger = open({ disabled: true });
    expect(trigger).toHaveProperty('disabled', true);
    expect(classes(trigger)).toContain('disabled:opacity-50');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('reads 70 % and cannot open when busy', () => {
    const trigger = open({ disabled: true, disabledTone: 'busy' });
    expect(classes(trigger)).toContain('disabled:opacity-70');
    expect(classes(trigger)).not.toContain('disabled:opacity-50');
    expect(trigger.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('is neither when enabled', () => {
    const trigger = open();
    expect(trigger.getAttribute('aria-busy')).toBeNull();
    expect(screen.queryByRole('listbox')).not.toBeNull();
  });
});
