import { useEffect } from 'react';

import { useSettings } from '../state/settings';

/**
 * Keeps `<html lang>` in step with the chosen language.
 *
 * Not cosmetic: it is what tells a screen reader which voice to read the page
 * in, and what a browser's translate prompt and hyphenation engine read. The
 * document ships as `lang="en"` in index.html, which was true until Ukrainian
 * became the default and is now wrong from the first paint — so this runs in
 * the layout beside `useTheme`, which owns the other root attribute.
 *
 * The head script does not set it, deliberately: unlike the theme, a wrong
 * `lang` for one frame has no visual effect, and keeping the boot script to
 * the one thing that must precede paint keeps it small.
 */
export function useDocumentLang(): void {
  const language = useSettings((s) => s.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}
