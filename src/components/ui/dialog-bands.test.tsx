// @vitest-environment jsdom
// The dialog's three bands line up: the header and the footer sit outside the Scroller, so their
// inline padding must be the inset the body's Scroller gives its content, not a copy of it.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DialogBody, DialogFooter, DialogHeader } from './Dialog';
import { RING } from './scroller-geometry';

// The body's Scroller observes its box; jsdom has no observer, and no bar needs to mount here.
vi.stubGlobal(
  'ResizeObserver',
  globalThis.ResizeObserver ??
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
);

afterEach(cleanup);

// The body's content stands the root's gutter plus the viewport's ring allowance in.
const bodyInset = (root: HTMLElement) =>
  parseFloat(root.style.getPropertyValue('--rail-gutter')) + RING;

describe('the dialog bands', () => {
  it.each([
    ['header', DialogHeader],
    ['footer', DialogFooter],
  ] as const)('pads the %s to the body content’s inline inset', (_, Band) => {
    const { container } = render(
      <>
        <Band>band</Band>
        <DialogBody>body</DialogBody>
      </>,
    );
    const band = container.children[0] as HTMLElement;
    const root = container.children[1].firstElementChild as HTMLElement;
    expect(bodyInset(root)).toBe(22);
    expect(band.style.paddingLeft).toBe(`${bodyInset(root)}px`);
    expect(band.style.paddingRight).toBe(`${bodyInset(root)}px`);
  });
});
