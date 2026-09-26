import { useEffect } from 'react';

import { useSettings } from '../state/settings';

/**
 * Not cosmetic: `<html lang>` is what tells a screen reader which voice to read the
 * page in, and what a browser's translate prompt and hyphenation engine read.
 * `index.html` ships `lang="en"` while the default is Ukrainian, so it is wrong from
 * the first paint — hence this runs in `Root` beside `useTheme`, which owns the
 * other root attribute.
 *
 * The head script does not set it, deliberately: unlike the theme, a wrong `lang` for
 * one frame has no visual effect, and the boot script stays at the one thing that must
 * precede paint.
 */
export function useDocumentLang(): void {
  const language = useSettings((s) => s.language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
}
