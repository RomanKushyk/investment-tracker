// The one chart tooltip (`docs/superpowers/specs/2026-11-05-layout-refresh/charts.md` § Signed ›
// Anatomy, Tooltip): glass, the date, then a row per series sorted by value.
import { Fragment, type ReactNode } from 'react';
import { Tooltip, useActiveTooltipCoordinate, usePlotArea } from 'recharts';

import { CHART_CURSOR_FILL, CHART_CURSOR_LINE, CHART_TOOLTIP_ITEM } from '@quirenote/core/colors';
import type { TooltipPin } from '../../hooks/useTooltipTrigger';
import { tooltipPlacement, type TooltipEntry } from './anatomy';

interface Format {
  formatLabel: (label: string | number) => string;
  formatValue: (value: number, entry: TooltipEntry) => string;
  formatName?: (entry: TooltipEntry) => string;
  /** A row's key in place of the colour mark: «Разом» keys by its glyph (wave 14). */
  keyOf?: (entry: TooltipEntry) => ReactNode;
  /** The focused series' dataKey: its row bold, the others dimmed (wave 14, H2). */
  focused?: string;
  /** What a series row sums, listed under it by amount (wave 27, step 3 A), and the counted noun
   *  the overflow row prints after its «+»: one prop, so the cap never hides rows unsaid. */
  parts?: {
    of: (entry: TooltipEntry) => readonly { name: string; value: number }[];
    more: (n: number) => string;
  };
}

// Past five, the fifth row counts the rest: a long list would cover the plot (wave 27).
const MAX_PARTS = 5;
// The series row's 12 px key and its 8 px gap, so an asset's name starts under the series name.
const PART_INDENT = 20;

export function ChartTooltipContent({
  active,
  payload,
  label,
  maxWidth,
  accessibilityLayer,
  formatLabel,
  formatValue,
  formatName,
  keyOf,
  focused,
  parts: partsFormat,
}: Format & {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: string | number;
  maxWidth?: number;
  /** recharts' own content announces the keyboard walk under this layer; so does this one. */
  accessibilityLayer?: boolean;
}) {
  // `type: 'none'` is recharts' own opt-out, which its default content honours too.
  const rows = (payload ?? [])
    .filter(
      (e): e is TooltipEntry & { value: number } =>
        typeof e.value === 'number' && e.type !== 'none',
    )
    .sort((a, b) => b.value - a.value);
  // A date with no row names nothing: a /yield panel over a date its own asset has no point on.
  if (active && rows.length === 0) return null;
  return (
    <div
      data-chart-tooltip
      {...(accessibilityLayer ? { role: 'status', 'aria-live': 'assertive' as const } : {})}
      className="rounded-[12px] glass px-3 py-[9px] font-mono text-small"
      style={maxWidth === undefined ? undefined : { maxWidth }}
    >
      {active && label !== undefined && (
        <div data-tooltip-date className="text-label text-muted">
          {formatLabel(label)}
        </div>
      )}
      {active &&
        rows.map((e) => {
          // Sorted here, as the series rows are, so no chart's order can override the rule.
          const parts = [...(partsFormat?.of(e) ?? [])].sort((a, b) => b.value - a.value);
          const shown = parts.length > MAX_PARTS ? parts.slice(0, MAX_PARTS - 1) : parts;
          const more = parts.length - shown.length;
          return (
            <Fragment key={String(e.dataKey ?? e.name)}>
              <div
                data-tooltip-row
                // A row keeps its node as the focus moves, so the dimming fades.
                className={`flex items-center gap-2 ${keyOf ? 'transition-opacity duration-150 ease-soft' : ''}`}
                style={{
                  color: CHART_TOOLTIP_ITEM.color,
                  ...(focused === undefined
                    ? {}
                    : e.dataKey === focused
                      ? { fontWeight: 700 }
                      : { opacity: 0.55 }),
                }}
              >
                {keyOf ? (
                  <span data-tooltip-key aria-hidden className="flex shrink-0">
                    {keyOf(e)}
                  </span>
                ) : (
                  <span
                    data-tooltip-key
                    aria-hidden
                    className="shrink-0"
                    style={{ width: 12, height: 2, backgroundColor: e.color }}
                  />
                )}
                <span data-tooltip-name className="flex-1">
                  {formatName ? formatName(e) : String(e.name)}
                </span>
                <span data-tooltip-value style={{ fontWeight: 700 }}>
                  {formatValue(e.value, e)}
                </span>
              </div>
              {shown.map((p, i) => (
                <div
                  key={i}
                  data-tooltip-part
                  className="flex items-center gap-2"
                  style={{ color: CHART_TOOLTIP_ITEM.color, paddingLeft: PART_INDENT }}
                >
                  <span data-tooltip-name className="flex-1">
                    {p.name}
                  </span>
                  <span data-tooltip-value>{formatValue(p.value, e)}</span>
                </div>
              ))}
              {more > 0 && partsFormat && (
                <div data-tooltip-more className="text-muted" style={{ paddingLeft: PART_INDENT }}>
                  +{partsFormat.more(more)}
                </div>
              )}
            </Fragment>
          );
        })}
    </div>
  );
}

/** recharts' `<Tooltip>` with the shared content and placement; rendered inside the chart, where
 *  its hooks read the plot and the crosshair. */
export function ChartTooltip({
  pin,
  cursor,
  ...format
}: Format & {
  pin?: Pick<TooltipPin, 'trigger' | 'active'>;
  cursor: typeof CHART_CURSOR_LINE | typeof CHART_CURSOR_FILL;
}) {
  const plot = usePlotArea();
  const at = useActiveTooltipCoordinate();
  const { maxWidth, ...placement } = tooltipPlacement(plot, at?.x);
  return (
    <Tooltip
      trigger={pin?.trigger}
      active={pin?.active}
      cursor={cursor}
      {...placement}
      content={(p) => (
        <ChartTooltipContent
          active={p.active}
          payload={p.payload}
          label={p.label}
          maxWidth={maxWidth}
          accessibilityLayer={p.accessibilityLayer}
          {...format}
        />
      )}
    />
  );
}
