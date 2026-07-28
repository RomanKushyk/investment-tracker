import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART } from '../../core/colors';
import { fmtDateShort, fmtProse } from '../../core/money';
import type { BalanceChartPoint } from '../../screens/balances/balances';

// Design lines 216-222: green area over total capital per complete snapshot,
// with a dot marking the most recent point. Motion (D7): sweeps in on mount,
// animates from the previous shape on data updates (recharts default).
export function BalancesArea({ data }: { data: BalanceChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={fmtDateShort}
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
          formatter={(v) => [fmtProse(Number(v)), 'Total capital']}
          labelFormatter={(label) => fmtDateShort(String(label))}
          contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.hairline}`, fontSize: 12 }}
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
