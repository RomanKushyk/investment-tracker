// @vitest-environment jsdom
// Crossing md with a dialog open moves its buttons, never relabels them: a focused «Скасувати»
// must not become the action under the keyboard.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterAll, afterEach, expect, it, vi } from 'vitest';

// A getter and live listeners, so a test can cross the breakpoint with the row mounted.
let wide = true;
const listeners = new Set<() => void>();
vi.stubGlobal('matchMedia', (query: string) => ({
  get matches() {
    return query.includes('min-width') ? wide : false;
  },
  media: query,
  addEventListener: (_: string, l: () => void) => listeners.add(l),
  removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
afterAll(() => vi.unstubAllGlobals());
afterEach(cleanup);

const { DialogActions } = await import('./Dialog');

it.each([true, false])('keeps each button its own node across md (from desktop %s)', (from) => {
  wide = from;
  render(
    <DialogActions cancel={<button type="button">Скасувати</button>}>
      <button type="button">Відхилити</button>
    </DialogActions>,
  );
  const cancel = screen.getByRole('button', { name: 'Скасувати' });
  const action = screen.getByRole('button', { name: 'Відхилити' });
  // The part that leads is the one React moves; its commit gives the moved node its focus back.
  const moved = from ? cancel : action;
  moved.focus();

  act(() => {
    wide = !from;
    listeners.forEach((l) => l());
  });

  expect(document.activeElement).toBe(moved);
  expect(cancel.textContent).toBe('Скасувати');
  expect(action.textContent).toBe('Відхилити');
  expect([...cancel.parentElement!.children].map((b) => b.textContent)).toEqual(
    from ? ['Відхилити', 'Скасувати'] : ['Скасувати', 'Відхилити'],
  );
});
