import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_CURSOR_LINE, CHART_TOOLTIP, SERIES } from '../../core/colors';
import { signed } from '../../core/money';
import type { Asset } from '../../core/types';
import type { YieldSeriesPoint } from '../../screens/yield/yield';
import { useFormat } from '../../hooks/useFormat';
import { useTooltipTrigger } from '../../hooks/useTooltipTrigger';

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
  const f = useFormat();
  const trigger = useTooltipTrigger();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
          // Already IN percent and signed by hand, so it is pctPlain (which
          // never signs) wrapped in signed() — not pct(), which takes a
          // fraction. 0 dp: this axis is 40px wide and recharts picks whole
          // numbers for it.
          tickFormatter={(v: number) =>
            v === 0 ? f.pctPlain(0, 0) : signed(v, f.pctPlain(Math.abs(v), 0))
          }
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        {/* S6 / D-b — per-asset cumulative yield exists only here. */}
        <Tooltip
          trigger={trigger}
          labelFormatter={(label) => f.dateShort(String(label))}
          formatter={(v, name) => {
            const n = Number(v);
            return [
              n === 0 ? f.pctPlain(0, 2) : signed(n, f.pctPlain(Math.abs(n), 2)),
              assets.find((a) => a.id === name)?.name ?? String(name),
            ];
          }}
          contentStyle={CHART_TOOLTIP}
          cursor={CHART_CURSOR_LINE}
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
