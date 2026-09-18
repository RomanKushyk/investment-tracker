import { useMemo } from 'react';

import { makeFormat, type Format } from '../core/money';
import { useSettings } from '../state/settings';

/**
 * The one seam between the pure formatters and the language preference.
 *
 * `core/money.ts` may not read state, so it takes the language as a parameter and
 * this binds it once per render. Call it at the top of a component and use the
 * returned object — `f.money(x)`, `f.date(iso)` — rather than importing the
 * formatters directly, or that component will not re-render on a language switch.
 *
 * Memoised on the language alone, so the returned object is safe in a dependency
 * array.
 */
export function useFormat(): Format {
  const language = useSettings((s) => s.language);
  return useMemo(() => makeFormat(language), [language]);
}
