import { useEffect, useRef, type FocusEvent } from 'react';

/**
 * HTML's focus fixup, kept on this page: when focus falls to the body, it goes back to the page's
 * control that last held it, or, that control gone, to its row's place (clamped), else the
 * filter (WAI-ARIA APG, Dialog: "the invoking element no longer exists"). Rows mark their actions
 * `data-row-actions`; «Показати ще», `data-more`, holds the place of the first row it brings.
 */
export function useFocusFixup<T extends HTMLElement>() {
  const root = useRef<T>(null);
  /** Whether focus is the page's: the user moving it elsewhere in the window ends it. */
  const inside = useRef(false);
  /** The page's control that last held focus, and its row's place when it took it. */
  const last = useRef<Element | null>(null);
  const place = useRef<number | undefined>(undefined);
  /** What the fixup focused, so a later hand-back can tell it from the user's own move. */
  const landed = useRef<Element | null>(null);
  const moves = useRef(0);

  const placeOf = (el: Element): number | undefined => {
    const rows = [...(root.current?.querySelectorAll('[data-row-actions]') ?? [])];
    const row = el.closest('[data-row-actions]');
    if (row !== null) return rows.indexOf(row);
    return el.closest('[data-more]') === null ? undefined : rows.length;
  };

  // After every commit, and after Radix's own restore, which runs in a timeout of its own.
  useEffect(() => {
    const timer = setTimeout(() => {
      const held = last.current;
      const active = document.activeElement;
      if (!inside.current || (active !== null && active !== document.body && active.isConnected)) {
        return;
      }
      let into: Element | null | undefined = held?.isConnected ? held : undefined;
      if (into === undefined) {
        const rows = root.current?.querySelectorAll('[data-row-actions]') ?? [];
        const at = place.current;
        const row = at === undefined ? undefined : rows[Math.min(at, rows.length - 1)];
        into = row?.querySelector('button') ?? root.current?.querySelector('[role="combobox"]');
      }
      (into as HTMLElement | null | undefined)?.focus();
      landed.current = document.activeElement;
    }, 0);
    return () => clearTimeout(timer);
  });

  // React's focus events bubble through portals, so a dialog's or a listbox's focus is the page's.
  const onFocus = (event: FocusEvent) => {
    moves.current += 1;
    inside.current = true;
    const el = event.target;
    if (root.current === null || !root.current.contains(el)) return;
    last.current = el;
    place.current = placeOf(el);
  };
  const onBlur = (event: FocusEvent) => {
    const at = moves.current;
    const el = event.target;
    // A control that left took focus with it, and a window switch keeps it; a control still here
    // in a focused window lost it to the user's own move.
    setTimeout(() => {
      if (moves.current === at && el.isConnected && document.hasFocus()) inside.current = false;
    }, 0);
  };
  return { props: { ref: root, onFocus, onBlur }, landed };
}
