import { useIsDesktop } from './useIsDesktop';

/**
 * TAP TO PIN — decision D-b in `design/extensions/mobile.dc.html`.
 *
 * A chart's per-point value lives inside a hover tooltip, and hover does not
 * exist on touch: on a phone those values are simply unreachable. Below the
 * breakpoint the tooltip is therefore triggered by a TAP, which pins it to the
 * nearest point; a tap elsewhere in the plot moves it, and a tap outside the
 * chart releases it.
 *
 * The value stays reachable by keyboard in both shells without anything here:
 * recharts 3 turns its `accessibilityLayer` on by default, which makes the plot
 * focusable and walks the tooltip with the arrow keys.
 *
 * WIRED TO THREE CHARTS, NOT THE FOUR THE EXTENSION COUNTS: Allocation declares no
 * `<Tooltip>` at all, so it never had a hover-only value to reach. Seasonality is
 * the fifth, which the extension already excludes — it draws its values on the bars
 * themselves, so a tap adds nothing.
 */
export function useTooltipTrigger(): 'hover' | 'click' {
  return useIsDesktop() ? 'hover' : 'click';
}
