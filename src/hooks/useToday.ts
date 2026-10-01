import { useEffect, useState } from 'react';

import { todayIso } from '@quirenote/core/dates';

// A minute, not a timeout at midnight: a timer that fires early or after the machine
// sleeps would miss the day it was set for, and an unchanged date stops before any child renders.
const POLL_MS = 60_000;

/** Today's local date as STATE, so a memo keyed on it moves on at midnight: the compiler
 *  caches a `const today = todayIso()` that reads nothing reactive once per mount. */
export function useToday(): string {
  const [today, setToday] = useState(todayIso);
  useEffect(() => {
    const id = setInterval(() => setToday(todayIso()), POLL_MS);
    return () => clearInterval(id);
  }, []);
  return today;
}
