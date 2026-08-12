import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_TOOLTIP, SERIES } from '../../core/colors';
import { fmtDateShort, signed } from '../../core/money';
import type { Asset } from '../../core/types';
import type { YieldSeriesPoint } from '../../screens/yield/yield';

// The index of an asset's last defined (non-undefined) point — each line gets
// its OWN end dot, since assets purchased later (…6475) have shorter series.
function lastDefinedIndex(data: YieldSeriesPoint[], assetId: string): number {
  let idx = -1;
  data.forEach((p, i) => {
    if (p[assetId] !== undefined) idx = i;
  });
  return idx;
}

// Design lines 314-322: 4 cumulative-% lines in asset colors, a dot at each
// line's own last point. Motion (D7): sweeps in on mount, redraws animated on
// data updates (recharts default — never a cold redraw).
export function YieldLines({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
          tickFormatter={(v: number) => (v === 0 ? '0%' : signed(v, `${Math.abs(v)}%`))}
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          labelFormatter={(label) => fmtDateShort(String(label))}
          formatter={(v, name) => {
            const n = Number(v);
            return [
              n === 0 ? '0.00%' : signed(n, `${Math.abs(n).toFixed(2)}%`),
              assets.find((a) => a.id === name)?.name ?? String(name),
            ];
          }}
          contentStyle={CHART_TOOLTIP}
        />
        {assets.map((asset) => {
          const color = SERIES[asset.colorKey].main;
          const lastIdx = lastDefinedIndex(data, asset.id);
          return (
            <Line
              key={asset.id}
              type="monotone"
              dataKey={asset.id}
              stroke={color}
              strokeWidth={2.5}
              isAnimationActive
              animationDuration={900}
              animationEasing="ease-out"
              activeDot={{ r: 5, fill: color }}
              dot={(props: DotItemDotProps) =>
                props.index === lastIdx ? (
                  <circle cx={props.cx} cy={props.cy} r={4} fill={color} />
                ) : (
                  <g />
                )
              }
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
