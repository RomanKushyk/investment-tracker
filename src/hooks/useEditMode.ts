import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router';

/**
 * Whether a screen is being edited, and the guard that stops unsaved work being dropped
 * silently. EPHEMERAL BY DECISION: edit mode is a state someone is passing through
 * rather than an arrangement they chose, so nothing about it is persisted — the
 * collapsed nav groups go the other way, deliberately.
 *
 * `asking` is DERIVED from both of the dialog's two sources rather than mirrored into
 * an effect: the blocked navigation IS state already, on the blocker, and copying it
 * would give two answers to one question for a frame.
 */
export interface EditMode {
  editing: boolean;
  start: () => void;
  /** Leave, asking first if there is unsaved work. `Cancel` and `Escape`. */
  requestExit: () => void;
  /** Leave now, no question. What a successful save calls. */
  exit: () => void;
  asking: boolean;
  keepEditing: () => void;
  discard: () => void;
}

export function useEditMode(dirty = false): EditMode {
  const [editing, setEditing] = useState(false);
  const [askingExit, setAskingExit] = useState(false);

  // A boolean, which react-router takes directly, so there is no identity to keep stable.
  const blocker = useBlocker(editing && dirty);
  const blocked = blocker.state === 'blocked';

  /**
   * A BLOCKED BLOCKER WITH NO REASON LEFT TO BLOCK IS RELEASED, stated as a CONDITION
   * because both imperative forms are wrong: react-router does not release one when its
   * predicate goes false, and `blocker.reset()` inside `exit()` captures the blocker
   * from the render where Save was pressed, still `unblocked`, so it does nothing.
   */
  useEffect(() => {
    if (blocked && !(editing && dirty)) blocker.reset();
  }, [blocked, editing, dirty, blocker]);

  const exit = useCallback(() => {
    setEditing(false);
    setAskingExit(false);
  }, []);

  const requestExit = useCallback(() => {
    if (dirty) setAskingExit(true);
    else exit();
  }, [dirty, exit]);

  const asking = askingExit || blocked;

  /**
   * Escape is the same act as Cancel, and IT MUST DEFER TO `defaultPrevented`: Radix's
   * `DismissableLayer` listens on `document` in the CAPTURE phase and calls
   * `preventDefault()` but never `stopPropagation()`, so without the guard this runs
   * anyway, sees the page dirty and re-opens the dialog in the same batch.
   */
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (event.defaultPrevented || asking) return;
      requestExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, asking, requestExit]);

  const keepEditing = useCallback(() => {
    // Releasing the blocker is the effect's job; this flag covers the user's own exit.
    setAskingExit(false);
    blocker.reset?.();
  }, [blocker]);

  const discard = useCallback(() => {
    setEditing(false);
    setAskingExit(false);
    blocker.proceed?.();
  }, [blocker]);

  return {
    editing,
    start: useCallback(() => setEditing(true), []),
    requestExit,
    exit,
    asking,
    keepEditing,
    discard,
  };
}
