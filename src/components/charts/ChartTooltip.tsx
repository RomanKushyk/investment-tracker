// The one chart tooltip (`docs/superpowers/specs/2026-11-05-layout-refresh/charts.md` § Signed ›
// Anatomy, Tooltip): glass, the date, then a row per series sorted by value.
import type { ReactNode } from 'react';
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
}

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
        rows.map((e) => (
          <div
            key={String(e.dataKey ?? e.name)}
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
        ))}
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
