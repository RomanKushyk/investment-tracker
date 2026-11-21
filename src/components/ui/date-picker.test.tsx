// @vitest-environment jsdom
// The date picker's md-and-up popover on the signed glass (controls.md § Signed, P2), and its
// trigger on the shared field at rest on `page`. Below md it is a sheet, which is #715's.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: query.includes('min-width'),
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const { DatePicker } = await import('./DatePicker');

const classes = (el: Element) => el.className.split(/\s+/);

describe('the date picker above md', () => {
  it('opens a glass popover at r16 on the `field-border` edge, with no solid fill or border', () => {
    render(<DatePicker value="2026-03-02" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    const popover = screen.getByRole('dialog');
    const list = classes(popover);
    expect(list).toEqual(
      expect.arrayContaining(['glass', 'rounded-2xl', '[--glass-edge:var(--color-field-border)]']),
    );
    for (const solid of ['bg-card', 'border', 'border-field-border', 'shadow-(--shadow-popover)'])
      expect(list, solid).not.toContain(solid);
  });

  // The popover's own controls hover with the neutral `ink` 5 % veil (*Interaction rules*).
  // 2006 widens the span to start there, so January 2006 and the first year page sit at its edge.
  const VEIL = 'hover:bg-ink/5';
  const openAt = (value: string) => {
    render(<DatePicker value={value} onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    const captions = () => [...dialog.querySelectorAll('button[aria-expanded]')];
    // The arrows are the only buttons that draw a glyph.
    const arrows = () =>
      [...dialog.querySelectorAll('button')].filter((b) => b.querySelector('svg'));
    return { dialog, captions, arrows };
  };

  it('hovers the captions, the arrows and an idle day with the veil, and the chosen day stays ink', () => {
    const { dialog, captions, arrows } = openAt('2006-01-15');
    for (const el of [...captions(), ...arrows()]) {
      expect(classes(el), el.outerHTML).toContain(VEIL);
      expect(classes(el), el.outerHTML).not.toContain('hover:bg-page');
    }
    const idle = dialog.querySelector('td:not([aria-selected]) button')!;
    expect(classes(idle)).toContain(VEIL);
    expect(classes(idle)).not.toContain('hover:bg-page');
    expect(classes(dialog.querySelector('td[aria-selected="true"]')!)).toContain(
      '[&>button:hover]:bg-ink',
    );
  });

  // 2200 widens the span to end there, so December 2200 sits at its far edge.
  it.each([
    ['2006-01-15', 0],
    ['2200-12-15', 1],
  ])('keeps no hover on a day-view arrow at the span edge from %s', (value, side) => {
    const { arrows } = openAt(value);
    const edge = arrows()[side];
    expect(edge.getAttribute('aria-disabled'), `${value} opens at the span edge`).toBe('true');
    expect(classes(edge)).toContain('aria-disabled:hover:bg-transparent');
  });

  it.each([0, 1])(
    'veils the idle cells of caption %i, and its open caption and shown cell keep their marks',
    (i) => {
      const { dialog, captions, arrows } = openAt('2006-01-15');
      fireEvent.click(captions()[i]);
      const [open, closed] = i === 0 ? captions() : [...captions()].reverse();
      expect(classes(open)).toContain('bg-page');
      expect(classes(open)).not.toContain(VEIL);
      expect(classes(closed)).toContain(VEIL);
      const cells = [...dialog.querySelectorAll('button:not([aria-expanded])')].filter(
        (b) => !b.querySelector('svg'),
      );
      const shown = cells.find((b) => b.getAttribute('aria-current') === 'true')!;
      expect(classes(shown)).toContain('bg-ink');
      expect(classes(shown).filter((c) => c.startsWith('hover:'))).toEqual([]);
      const idle = cells.find((b) => !b.hasAttribute('aria-current'))!;
      expect(classes(idle)).toContain(VEIL);
      expect(classes(idle)).not.toContain('hover:bg-page');
      // The year page opens at the span's start, so its back arrow is the disabled one.
      if (i === 1) {
        const edge = arrows().find((b) => (b as HTMLButtonElement).disabled);
        expect(edge, 'the first year page opens at the span start').toBeDefined();
        expect(classes(edge!)).toContain('disabled:hover:bg-transparent');
      }
    },
  );

  it('rests its trigger on the shared field on `page` when the caller names no fill', () => {
    render(<DatePicker value="" onChange={() => {}} />);
    expect(classes(screen.getByRole('button'))).toEqual(
      expect.arrayContaining(['h-9', 'rounded-[9px]', 'bg-page']),
    );
  });
});
