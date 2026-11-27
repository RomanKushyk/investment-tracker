// @vitest-environment jsdom
// Whether the on-screen keyboard is up, read as Ionic reads it: a field that takes text holds focus
// and the visual viewport has lost more than 150 px (open-values-shell-controls.md § Signed, item 4).
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardOpen } from './keyboard-inset';

/** A visual viewport whose height the case sets, telling its listeners as a browser does. */
class Viewport extends EventTarget {
  height = window.innerHeight;
  width = window.innerWidth;
  offsetTop = 0;
  drop(px: number) {
    this.height = window.innerHeight - px;
    this.dispatchEvent(new Event('resize'));
  }
}
let vv: Viewport;

const seen: boolean[] = [];
function Probe() {
  seen.push(useKeyboardOpen());
  return null;
}

/** Two quote fields, a button, and a field inside a modal dialog. */
function mount() {
  document.body.innerHTML = `
    <input id="a" /><input id="b" inputmode="decimal" /><button id="go">go</button>
    <div role="dialog"><input id="modal" /></div>`;
  render(<Probe />, { container: document.body.appendChild(document.createElement('div')) });
}
const focus = (id: string) => act(() => document.getElementById(id)!.focus());
const now = () => seen.at(-1);

beforeEach(() => {
  vv = new Viewport();
  vi.stubGlobal('visualViewport', vv);
  seen.length = 0;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('useKeyboardOpen', () => {
  it('is open with a field focused and the viewport down by more than 150', async () => {
    mount();
    await focus('a');
    expect(now()).toBe(false);
    await act(() => vv.drop(300));
    expect(now()).toBe(true);
  });

  it('is closed for a drop of 150 or less: a toolbar, not a keyboard', async () => {
    mount();
    await focus('a');
    await act(() => vv.drop(150));
    expect(now()).toBe(false);
  });

  it('is closed with no field focused, so a pinch-zoom is never a keyboard', async () => {
    mount();
    await act(() => vv.drop(300));
    expect(now()).toBe(false);
    await focus('go');
    expect(now()).toBe(false);
  });

  // A modal's own sheet rides the keyboard; the page's bar would mount behind its veil.
  it('is closed for a field inside a modal dialog', async () => {
    mount();
    await act(() => vv.drop(300));
    await focus('modal');
    expect(now()).toBe(false);
  });

  // iOS scrolls the page within the visual viewport while the keyboard is up, moving its top.
  it('stays open while the page scrolls under the keyboard', async () => {
    mount();
    await focus('a');
    await act(() => vv.drop(300));
    await act(() => {
      vv.offsetTop = 300;
      vv.dispatchEvent(new Event('scroll'));
    });
    expect(now()).toBe(true);
  });

  // A pinch narrows the visual viewport as it shortens it; a keyboard leaves its width alone.
  it('is closed for a pinch-zoom, even with a field focused', async () => {
    mount();
    await focus('a');
    await act(() => {
      vv.width = window.innerWidth / 2;
      vv.drop(window.innerHeight / 2);
    });
    expect(now()).toBe(false);
  });
});
