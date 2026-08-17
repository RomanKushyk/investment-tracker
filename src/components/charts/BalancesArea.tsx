import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_CURSOR_LINE, CHART_TOOLTIP } from '../../core/colors';
import type { BalanceChartPoint } from '../../screens/balances/balances';
import { useFormat } from '../../hooks/useFormat';
import { useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';

// Design lines 216-222: green area over total capital per complete snapshot,
// with a dot marking the most recent point. Motion (D7): sweeps in on mount,
// animates from the previous shape on data updates (recharts default).
export function BalancesArea({ data }: { data: BalanceChartPoint[] }) {
  const f = useFormat();
  const t = useT();
  // S6 — hover on a pointer, tap-to-pin on a touch screen. This line is the
  // whole of D-b for this chart: every value on the line is inside the tooltip
  // and nowhere else.
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
          stroke={CHART.pos}
          strokeWidth={2.5}
          fill={CHART.posTint}
          fillOpacity={0.7}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
          dot={(props: DotItemDotProps) =>
            props.index === data.length - 1 ? (
              <circle cx={props.cx} cy={props.cy} r={4} fill={CHART.pos} />
            ) : (
              <g />
            )
          }
          activeDot={{ r: 4, fill: CHART.pos }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
