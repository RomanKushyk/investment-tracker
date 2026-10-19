import { useEffect } from 'react';

import { useT } from '../../i18n/useT';

// Once per page load, not per auth page shown: module-level, as `useReminderToast`'s latch, so a
// remount or StrictMode's second effect says nothing.
let warned = false;

/** The console's self-XSS warning (*Auth model*), in a production build only, as Facebook's and
 *  Discord's are, and only once an auth page `shows`. The headline is styled; the body says the whole
 *  of it in plain text. */
export function useSelfXssWarning(shows: boolean): void {
  const t = useT();
  useEffect(() => {
    if (!import.meta.env.PROD || warned || !shows) return;
    warned = true;
    // A tint and its text, one theme's pair, so the line reads in a console of either theme.
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => root.getPropertyValue(name).trim();
    console.log(
      `%c${t.auth.selfXss.headline}`,
      `background: ${token('--color-neg-tint')}; color: ${token('--color-neg-tint-text')}; font-size: 2em; font-weight: 700; padding: 0.1em 0.3em`,
    );
    console.log(t.auth.selfXss.body);
  }, [t, shows]);
}
