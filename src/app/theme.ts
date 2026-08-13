import { useEffect } from 'react';

import { useSettings, type Theme } from '../state/settings';

/** What the page can actually wear. `system` is a preference, never this. */
export type ResolvedTheme = 'light' | 'dark';

/** The `page` token in each theme — the browser chrome is matched to it. */
const CHROME: Record<ResolvedTheme, string> = {
  light: '#f6f5f3',
  dark: '#141416',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The one place a preference becomes a theme. `system` asks the OS; the other
 * two answer for themselves.
 *
 * Kept separate from the store on purpose: if `system` resolved at write time
 * we would have to rewrite the user's stored choice every time the OS flipped,
 * and "follow the system" would decay into "whatever the system was when I last
 * looked".
 */
export function resolveTheme(pref: Theme): ResolvedTheme {
  if (pref !== 'system') return pref;
  return matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * Applies the resolved theme to the document and keeps it applied.
 *
 * Mounted once, in Layout. Two writers would be one too many: index.html's head
 * script stamps the FIRST paint and then never runs again, and this owns every
 * subsequent write. Nothing else may touch `data-theme`.
 */
export function useTheme(): void {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(theme);
      document.documentElement.dataset.theme = resolved;
      // The chrome cannot follow a CSS attribute, so it is written here. Left
      // alone it would keep the light tint above a dark page — a seam exactly
      // where the app meets the browser.
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', CHROME[resolved]);
    };

    apply();

    // Only `system` listens. A user who has chosen light or dark has said the
    // OS is not the input, and a listener left attached would quietly override
    // that the next time they changed their OS setting.
    if (theme !== 'system') return;
    const mq = matchMedia(DARK_QUERY);
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}
