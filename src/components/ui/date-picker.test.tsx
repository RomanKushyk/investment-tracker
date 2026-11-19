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

  it('rests its trigger on the shared field on `page` when the caller names no fill', () => {
    render(<DatePicker value="" onChange={() => {}} />);
    expect(classes(screen.getByRole('button'))).toEqual(
      expect.arrayContaining(['h-9', 'rounded-[9px]', 'bg-page']),
    );
  });
});
