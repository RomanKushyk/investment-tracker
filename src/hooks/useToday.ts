import { useSyncExternalStore } from 'react';

import { todayIso } from '@quirenote/core/dates';

// A minute, not a timeout at midnight: a timer that fires early or after the machine
// sleeps would miss the day it was set for, and an unchanged date notifies no reader.
const POLL_MS = 60_000;

// One clock for every reader, so two figures on one screen never change day a tick apart.
let today = todayIso();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};
const advance = (): boolean => {
  const now = todayIso();
  if (now === today) return false;
  today = now;
  return true;
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(() => {
      if (advance()) notify();
    }, POLL_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

// Every read checks the clock, so no render is cut at a day that has passed; a new day found
// in a render reaches the readers already mounted on the next microtask, not the next poll.
const read = () => {
  if (advance() && listeners.size > 0) queueMicrotask(notify);
  return today;
};

/** Today's local date as STATE, so a memo keyed on it moves on at midnight: the compiler
 *  caches a `const today = todayIso()` that reads nothing reactive once per mount. */
export function useToday(): string {
  return useSyncExternalStore(subscribe, read, read);
}
