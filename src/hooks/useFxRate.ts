import type { Fx } from '@quirenote/core/view/serve';
import { useView } from './queries';
import { selectFx } from './slices';

/** The official rate under the day it is NBU's for, as `/view` serves it, or none
 *  (*External sources*). */
export function useFx(): Fx | null {
  return useView(selectFx);
}

/**
 * The rate a $ figure is converted at: `/view`'s, which the server stores for each day and serves
 * under its own (*External sources*). With none it is NaN, so every conversion of it is NaN and
 * every formatter ends in «—» (*Metric families and windows*): a figure with no rate says so, and
 * is never converted at a rate made up.
 */
export function useFxRate(): number {
  return useFx()?.rate ?? NaN;
}
