// Whether a screen held unsaved work when the account was forgotten: the reset unmounts the screen
// and its guard, so the fact is taken before it, and `/sign-in` says the work went too.
const holds = new Set<object>();
let taken = false;

/** Held while a screen's unsaved-work guard would ask; returns the release. */
export function holdUnsaved(): () => void {
  const hold = {};
  holds.add(hold);
  return () => void holds.delete(hold);
}

/** Records whether any work is unsaved now; called as the account is forgotten. */
export function takeUnsaved(): void {
  taken = holds.size > 0;
}

/** What the last forget recorded. */
export function unsavedTaken(): boolean {
  return taken;
}
