import { en, uk, type Dict } from './messages';
import { useSettings } from '../state/settings';

/**
 * The whole dictionary rather than a `t('some.key')` lookup: `t.screen.yield.title`
 * is checked by the compiler, so a typo cannot reach the screen as a raw key.
 *
 * Module constants, so no memo — the same object identity comes back for as long as
 * the language does not change, which is what a dependency array wants.
 */
export function useT(): Dict {
  return useSettings((s) => s.language) === 'uk' ? uk : en;
}
