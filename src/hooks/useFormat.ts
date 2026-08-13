import { useMemo } from 'react';

import { makeFormat, type Format } from '../core/money';
import { useSettings } from '../state/settings';

/**
 * The one seam between the pure formatters and the language preference.
 *
 * `core/money.ts` may not read state (G1), so it takes the language as a
 * parameter; this binds it once per render. Call it at the top of a component
 * and use the returned object — `f.money(x)`, `f.date(iso)` — rather than
 * importing the formatters directly, or that component will not re-render when
 * the language changes, and the brief pins that swap as INSTANT (Surface 2).
 *
 * Memoised on the language alone: the returned object is stable while it does
 * not change, so it is safe in a dependency array.
 */
export function useFormat(): Format {
  const language = useSettings((s) => s.language);
  return useMemo(() => makeFormat(language), [language]);
}
