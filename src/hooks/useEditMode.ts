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

  /**
   * A BLOCKED BLOCKER WITH NO REASON LEFT TO BLOCK IS RELEASED — declaratively,
   * because the imperative version was wrong twice (A30 review, then again in
   * the browser).
   *
   * react-router does NOT release a blocked blocker when its predicate goes
   * false: `getBlocker` only swaps the predicate, and `state.blockers` keeps
   * `state === 'blocked'`. So a save that completed while a navigation was
   * blocked left the discard dialog open over a page that was already saved and
   * out of edit mode.
   *
   * The obvious fix — calling `blocker.reset()` inside `exit()` — does not
   * work, and it is worth saying why. `exit` runs from a promise callback, so
   * whatever version of `blocker` it captured came from the render where Save
   * was PRESSED; the navigation blocks after that and produces a NEW blocker
   * object. The captured one was still `unblocked`, its `reset` was
   * `undefined`, and `reset?.()` silently did nothing. That fix passed lint,
   * typecheck and 679 tests and was reproduced as broken in the browser.
   *
   * Stated as a condition instead, there is no stale closure to be wrong about:
   * whenever the blocker is blocked and the page is no longer dirty-and-editing,
   * it is released. Not `setState` in an effect — this synchronises an external
   * system (the router) with React state, which is what effects are for.
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
   * Escape is the same act as Cancel, so it goes through the same guard rather
   * than a second path that could answer differently.
   *
   * BUG, found in review: THE DIALOG COULD NOT BE CLOSED WITH ESCAPE. Radix's
   * `DismissableLayer` listens on `document` in the CAPTURE phase, so it runs
   * before this bubble listener, closes the dialog and calls
   * `event.preventDefault()` — but never `stopPropagation()`. This handler then
   * ran anyway, saw the page still dirty, and re-opened the dialog in the same
   * React batch. Worse when the dialog came from a blocked navigation:
   * `keepEditing` had already released the blocker, so the pending navigation
   * was silently dropped and a later Discard pushed a no-op.
   *
   * `defaultPrevented` is the guard that matters — it defers to whatever layer
   * already handled the key, not only to our own dialog. `asking` beside it
   * states the same intent locally and covers a layer that forgets to prevent.
   *
   * The listener re-binds when `dirty` flips, and that is ACCEPTED rather than
   * solved: the review proposed a latest-value ref, and
   * `react-hooks/immutability` rejects writing one that was built from hook
   * arguments. Adding and removing a keydown listener is not a cost worth a
   * pattern the linter refuses.
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
    // Releasing the blocker is the effect's job (above): clearing this flag
    // makes the page clean-or-not-editing again only when the user's own exit
    // was the source, and the effect settles the navigation case on its own.
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
