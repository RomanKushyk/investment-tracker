import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_CURSOR_LINE, CHART_TOOLTIP } from '@quirenote/core/colors';
import type { BalanceChartPoint } from '@quirenote/core/view/balances';
import { useFormat } from '../../hooks/useFormat';
import { useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';

// Drawn at `design/Investment Tracker.dc.html:216-222`. The line and its fill
// are the ACCENT, not the gain green: a total has no direction, and gain and
// loss belong to deltas. *Interaction rules*
export function BalancesArea({ data }: { data: BalanceChartPoint[] }) {
  const f = useFormat();
  const t = useT();
  // Hover on a pointer, tap-to-pin on a touch screen: every value on the line
  // is inside the tooltip and nowhere else.
  const trigger = useTooltipTrigger();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={f.dateShort}
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          domain={['dataMin - 5000', 'dataMax + 2000']}
          tickFormatter={(v: number) => `₴${Math.round(v / 1000)}k`}
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          trigger={trigger}
          formatter={(v) => [f.money(Number(v)), t.analytics.overview.totalCapital]}
          labelFormatter={(label) => f.dateShort(String(label))}
          contentStyle={CHART_TOOLTIP}
          cursor={CHART_CURSOR_LINE}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke={CHART.accent}
          strokeWidth={2.5}
          fill={CHART.accentTint}
          // 1, because `accent-tint` IS ALREADY an alpha — it lies over more
          // than one plane. This attribute multiplies with it, so the 0.7 the
          // opaque tint here used to want would land the area near 8 % in light
          // and just under 10 % in dark, which reads as no fill.
          fillOpacity={1}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
          dot={(props: DotItemDotProps) =>
            props.index === data.length - 1 ? (
              <circle cx={props.cx} cy={props.cy} r={4} fill={CHART.accent} />
            ) : (
              <g />
            )
          }
          // `strokeWidth: 0` because recharts seeds this dot `stroke: '#fff'`
          // and spreads the caller's props after `r` and `fill` only — leaving a
          // pure white ring on a card that moves with the theme.
          activeDot={{ r: 4, fill: CHART.accent, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
