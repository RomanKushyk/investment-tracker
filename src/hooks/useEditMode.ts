import { useCallback, useEffect, useState } from 'react';
import { useBlocker } from 'react-router';

/**
 * Whether a screen is being edited, and the one guard that stops unsaved work
 * being dropped silently (brief § G-3, § G-4).
 *
 * EPHEMERAL, AND THAT IS A DECISION RATHER THAN AN OMISSION. Being in edit mode
 * is not a preference: it resets on reload, it does not survive navigation, and
 * nothing about it reaches `quirenote-settings`. It is the same line A21 drew
 * for the currency toggle three days earlier, for the same reason — an
 * arrangement someone chose and a state they are passing through are different
 * kinds of thing. (A33's collapsed sidebar groups go the other way, and the
 * contrast is deliberate.)
 *
 * ONE PAGE AT A TIME follows from the state living here, in the page, rather
 * than in a store: leaving unmounts it.
 *
 * `dirty` is a BOOLEAN the page computes, not a callback. A function would
 * change identity every render and drag the blocker's memoisation with it, and
 * the page already knows the answer — it owns the draft.
 *
 * The discard dialog has TWO sources — a `Cancel`/`Escape` press and a blocked
 * navigation — and the confirm must either close the editor or let the
 * navigation through, which are not the same act. Only the first source needs
 * state: the second IS state already, on the blocker, so `asking` is DERIVED
 * from both rather than mirrored into an effect. Copying it would be the
 * cascading-render pattern `react-hooks/set-state-in-effect` exists to stop,
 * and it would give two answers to one question for a frame.
 */
export interface EditMode {
  editing: boolean;
  /** Enter edit mode. */
  start: () => void;
  /** Leave, asking first if there is unsaved work. `Cancel` and `Escape`. */
  requestExit: () => void;
  /** Leave now, no question. What a successful save calls. */
  exit: () => void;
  /** True while the discard dialog should be open. */
  asking: boolean;
  /** The dialog's "Keep editing". */
  keepEditing: () => void;
  /** The dialog's "Discard". */
  discard: () => void;
}

export function useEditMode(dirty = false): EditMode {
  const [editing, setEditing] = useState(false);
  const [askingExit, setAskingExit] = useState(false);

  // A boolean, which react-router accepts directly — no callback identity to
  // keep stable. Blocking stops at the moment the work stops being unsaved, so
  // a saved page navigates freely.
  const blocker = useBlocker(editing && dirty);
  const blocked = blocker.state === 'blocked';

  const exit = useCallback(() => {
    setEditing(false);
    setAskingExit(false);
  }, []);

  const requestExit = useCallback(() => {
    if (dirty) setAskingExit(true);
    else exit();
  }, [dirty, exit]);

  // Escape is the same act as Cancel, so it goes through the same guard rather
  // than a second path that could answer differently.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, requestExit]);

  const keepEditing = useCallback(() => {
    setAskingExit(false);
    // Only a blocked navigation has anything to release; `reset` is undefined
    // on an unblocked blocker.
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
    asking: askingExit || blocked,
    keepEditing,
    discard,
  };
}
