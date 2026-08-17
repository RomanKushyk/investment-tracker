import { useIsDesktop } from './useIsDesktop';

/**
 * S6 / DECISION D-b — TAP TO PIN.
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
 * WIRED TO THREE CHARTS, NOT FOUR. The extension says four of the five hide a
 * value behind hover; measured against the code it is three. Seasonality is
 * excluded there for the right reason and this confirms it — `makeIncomeLabel`
 * draws BOTH the actual and the expected amount on the bar itself, joined into
 * one line, so a tap adds nothing. Allocation is the one the count is off by: it
 * declares no `<Tooltip>` at all, so it has never had a hover-only value to
 * reach.
 */
export function useTooltipTrigger(): 'hover' | 'click' {
  return useIsDesktop() ? 'hover' : 'click';
}
