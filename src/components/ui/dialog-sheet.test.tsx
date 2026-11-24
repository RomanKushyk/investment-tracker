// @vitest-environment jsdom
// Below md every dialog is the signed M2 inset sheet, rising from the bottom; re-authentication
// stays top-anchored with M2's inset (forms-and-dialogs.md § Dialog below md, wave 26 item 5).
// At md and up nothing moves. Each class list is judged by the CSS Tailwind generates for it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __unstable__loadDesignSystem } from '@tailwindcss/node';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ruleBody, stripCss } from '../../__fixtures__/palette';
import { REPO } from '../../repo-root';

const kept = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => kept.get(k) ?? null,
  setItem: (k: string, v: string) => void kept.set(k, v),
  removeItem: (k: string) => void kept.delete(k),
});
// Below md, so the DatePicker mounts its sheet; the panels' classes carry both widths anyway.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
  onchange: null,
}));
// The top anchor's Scroller observes its box.
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

const { AlertDialog, AlertDialogTitle, Dialog, DialogTitle } = await import('./Dialog');
const { DatePicker } = await import('./DatePicker');

const CSS = stripCss(readFileSync(join(REPO, 'src/index.css'), 'utf8'), 'index.css');
let DS: Awaited<ReturnType<typeof __unstable__loadDesignSystem>>;
beforeAll(async () => {
  DS = await __unstable__loadDesignSystem(CSS, { base: join(REPO, 'src') });
});

type Width = 'narrow' | 'wide';
type State = 'open' | 'closed';

/** The declarations a class list resolves to at one width and one Radix state: each class's own
 *  CSS, kept when its media and state selector match, the more specific rule winning, then the
 *  later one in Tailwind's order. */
function resolved(className: string, width: Width, state: State): Record<string, string> {
  const classes = className.split(/\s+/).filter(Boolean);
  const order = new Map(DS.getClassOrder(classes).map(([c, o]) => [c, o ?? -1n]));
  const rules: { spec: number; order: bigint; decls: [string, string][] }[] = [];
  DS.candidatesToCss(classes).forEach((css, i) => {
    expect(css, `${classes[i]} is not a class`).not.toBeNull();
    const body = css!.replace(/@property[^}]*}/g, '');
    const media = body.match(/@media \(([^)]*)\)/)?.[1];
    if (media === 'width < 48rem' && width !== 'narrow') return;
    if (media === 'width >= 48rem' && width !== 'wide') return;
    const sel = body.match(/\[data-state="(\w+)"\]/)?.[1];
    if (sel && sel !== state) return;
    const decls = [...body.matchAll(/([-\w]+):\s*([^;{}]+);/g)].map(
      (m) => [m[1], m[2].trim()] as [string, string],
    );
    rules.push({ spec: sel ? 1 : 0, order: order.get(classes[i])!, decls });
  });
  rules.sort((a, b) => a.spec - b.spec || (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return Object.fromEntries(rules.flatMap((r) => r.decls));
}

// What shipped before the sheet, held as the oracle for md and up: no dialog moves there. Its
// material is #716's dialog glass.
const SHIPPED_SURFACE =
  'glass [--glass-fill:var(--color-glass-dialog-fill)] [--glass-edge:var(--color-field-border)] fixed left-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-3xl p-px data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220';
const SHIPPED = {
  centre: `${SHIPPED_SURFACE} top-1/2 max-h-[calc((100dvh-var(--keyboard-inset,0px))*0.85)] translate-y-[calc(-50%-var(--keyboard-inset,0px)*0.5)] grid grid-rows-[auto_minmax(0,1fr)_auto]`,
  top: `${SHIPPED_SURFACE} top-4 md:top-16`,
  overlay:
    'bg-scrim fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220',
};

const overlay = () => document.body.querySelector('.bg-scrim') as HTMLElement;

function openDialog(width?: 420 | 520) {
  render(
    <Dialog open onOpenChange={() => {}} width={width}>
      <DialogTitle>t</DialogTitle>
    </Dialog>,
  );
  return { panel: screen.getByRole('dialog').className, overlay: overlay().className };
}

function openAlert(anchor: 'centre' | 'top', width?: 420 | 480) {
  render(
    <AlertDialog open onOpenChange={() => {}} anchor={anchor} width={width}>
      <AlertDialogTitle>t</AlertDialogTitle>
    </AlertDialog>,
  );
  return { panel: screen.getByRole('alertdialog').className, overlay: overlay().className };
}

function openDate() {
  render(<DatePicker value="2026-03-02" onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button'));
  return { panel: screen.getByRole('dialog').className, overlay: overlay().className };
}

const SHEET_BOTTOM =
  'max(calc(12px + env(safe-area-inset-bottom)), calc(var(--keyboard-inset,0px) + 12px))';

const sheets = {
  'Dialog 420': () => openDialog(),
  'Dialog 520': () => openDialog(520),
  'AlertDialog 420': () => openAlert('centre'),
  'AlertDialog 480': () => openAlert('centre', 480),
  DatePicker: openDate,
};

describe('below md a dialog is the inset sheet', () => {
  for (const [name, open] of Object.entries(sheets)) {
    it(`${name}: 12 from the sides, above the safe area or the keyboard, r24, capped`, () => {
      const css = resolved(open().panel, 'narrow', 'open');
      expect(css['inset-inline'], 'its sides').toBe('12px');
      expect(css['--sheet-bottom'], 'the safe area or the keyboard, the larger').toBe(SHEET_BOTTOM);
      expect(css.bottom).toBe('var(--sheet-bottom)');
      expect(css['max-height'], 'its top gap holds at 68 whatever the insets').toBe(
        'calc(100dvh - 68px - var(--sheet-bottom))',
      );
      expect(css['border-radius']).toBe('var(--radius-3xl)');
      // Anchored at the bottom: no centring is left to pull it up or across.
      for (const gone of ['top', 'left', 'translate', 'width', 'max-width'])
        expect(css[gone], `${gone} still set below md`).toBeUndefined();
    });

    it(`${name}: rises in and leaves on the sheet's own keyframes`, () => {
      const { panel } = open();
      expect(resolved(panel, 'narrow', 'open').animation).toBe('var(--animate-sheet-in)');
      expect(resolved(panel, 'narrow', 'closed').animation).toBe('var(--animate-sheet-out)');
    });

    it(`${name}: its scrim fades over 220 both ways`, () => {
      const { overlay: o } = open();
      expect(resolved(o, 'narrow', 'open')['--tw-duration']).toBe('220ms');
      expect(resolved(o, 'narrow', 'closed')['--tw-duration']).toBe('220ms');
    });

    // A second tap while it slides out must not land on what it still draws, a date under the
    // finger above all.
    it(`${name}: takes no tap while it leaves`, () => {
      const { panel } = open();
      expect(resolved(panel, 'narrow', 'closed')['pointer-events']).toBe('none');
      expect(resolved(panel, 'narrow', 'open')['pointer-events']).toBeUndefined();
    });
  }

  it('the date sheet is the dialog sheet: one surface, one geometry, one motion', () => {
    const dialog = openDialog().panel;
    cleanup();
    const date = openDate().panel;
    const SHARED = [
      'inset-inline',
      'bottom',
      '--sheet-bottom',
      'max-height',
      'border-radius',
      'background-color',
      'border-color',
      '--tw-shadow',
      'position',
    ];
    for (const state of ['open', 'closed'] as const) {
      const a = resolved(dialog, 'narrow', state);
      const b = resolved(date, 'narrow', state);
      for (const p of [...SHARED, 'animation']) expect(b[p], `${state} ${p}`).toBe(a[p]);
    }
  });

  // The glass draws its edge inside the box, where the border sat: the content keeps its place
  // and stays off the edge, the date sheet at the 9 its popover takes.
  it.each([
    ...Object.entries(sheets).map(
      ([name, open]) => [name, open, name === 'DatePicker' ? '9px' : '1px'] as const,
    ),
    ['AlertDialog top', () => openAlert('top'), '1px'] as const,
  ])('%s: its content sits inside the edge', (_, open, inset) => {
    const { panel } = open();
    for (const width of ['narrow', 'wide'] as const)
      expect(resolved(panel, width, 'open').padding, width).toBe(inset);
  });

  it('re-authentication stays top-anchored, 16 down, with the sheet inset and r24', () => {
    const css = resolved(openAlert('top').panel, 'narrow', 'open');
    expect(css['inset-inline']).toBe('12px');
    expect(css.top).toBe('calc(var(--spacing) * 4)');
    expect(css['border-radius']).toBe('var(--radius-3xl)');
    for (const gone of ['left', 'translate', 'width', 'max-width', 'bottom'])
      expect(css[gone], `${gone} still set below md`).toBeUndefined();
  });
});

describe('at md and up no dialog moves', () => {
  const cases = {
    'Dialog 420': [() => openDialog(), `${SHIPPED.centre} max-w-[420px]`],
    'Dialog 520': [() => openDialog(520), `${SHIPPED.centre} max-w-[520px]`],
    'AlertDialog 420': [() => openAlert('centre'), `${SHIPPED.centre} max-w-[420px]`],
    'AlertDialog 480': [
      () => openAlert('centre', 480),
      `${SHIPPED.centre} max-w-[480px] @container`,
    ],
    'AlertDialog top': [() => openAlert('top'), `${SHIPPED.top} max-w-[420px]`],
  } as const;
  for (const [name, [open, shipped]] of Object.entries(cases)) {
    for (const state of ['open', 'closed'] as const) {
      it(`${name}, ${state}: the panel and its scrim resolve as they shipped`, () => {
        const now = open();
        expect(resolved(now.panel, 'wide', state)).toEqual(resolved(shipped, 'wide', state));
        expect(resolved(now.overlay, 'wide', state)).toEqual(
          resolved(SHIPPED.overlay, 'wide', state),
        );
      });
    }
  }
});

describe("the sheet's motion", () => {
  const THEME = ruleBody(CSS, '@theme');
  it('rises in 260 and leaves in 220, both on ease-soft', () => {
    expect(THEME).toMatch(/--animate-sheet-in:\s*sheet-in 260ms var\(--ease-soft\) both;/);
    expect(THEME).toMatch(/--animate-sheet-out:\s*sheet-out 220ms var\(--ease-soft\) both;/);
  });

  // `100% + 12px` when both insets are 0, so a notched phone does not show the sheet's top edge
  // over its home indicator at the first frame.
  const FROM = /transform:\s*translateY\(calc\(100% \+ var\(--sheet-bottom\)\)\);/;
  it('travels from its full height plus its bottom offset, to 0, and back', () => {
    const block = (name: string) =>
      CSS.match(new RegExp(`@keyframes ${name}\\s*{([^}]*}[^}]*})`))?.[1];
    const inn = block('sheet-in');
    const out = block('sheet-out');
    expect(inn, 'no sheet-in keyframes').toBeDefined();
    expect(out, 'no sheet-out keyframes').toBeDefined();
    expect(inn!.match(/from\s*{([^}]*)}/)?.[1]).toMatch(FROM);
    expect(inn!.match(/to\s*{([^}]*)}/)?.[1]).toMatch(/transform:\s*translateY\(0\);/);
    expect(out!.match(/from\s*{([^}]*)}/)?.[1]).toMatch(/transform:\s*translateY\(0\);/);
    expect(out!.match(/to\s*{([^}]*)}/)?.[1]).toMatch(FROM);
  });

  it('under reduced motion the kill-switch makes every animation one frame', () => {
    const kill = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)}\s*}/)?.[1];
    expect(kill).toMatch(/animation-duration:\s*0\.01ms !important;/);
  });
});
