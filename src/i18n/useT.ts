import { en, uk, type Dict } from './messages';
import { useSettings } from '../state/settings';

/**
 * The dictionary for the chosen language.
 *
 * Returns the whole object rather than a `t('some.key')` lookup function on
 * purpose: `t.screen.yield.title` is checked by the compiler, autocompletes,
 * and cannot be a typo that only shows up at runtime as a raw key on screen.
 * It also means interpolation is a normal call with typed arguments.
 *
 * The two dictionaries are module constants, so this needs no memo — the same
 * object identity comes back for as long as the language does not change,
 * which is exactly what a dependency array wants.
 */
export function useT(): Dict {
  return useSettings((s) => s.language) === 'uk' ? uk : en;
}
