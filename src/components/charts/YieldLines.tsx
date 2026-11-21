import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_CURSOR_LINE, SERIES } from '@quirenote/core/colors';
import { signed } from '@quirenote/core/money';
import type { Asset } from '@quirenote/core/types';
import type { YieldSeriesPoint } from '@quirenote/core/view/yield';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { CHART_MOTION, TICK, ringed } from './anatomy';
import { ChartTooltip } from './ChartTooltip';

// Each line gets its OWN end dot: an asset purchased later has a shorter series,
// so the chart's last index is not that line's last point.
function lastDefinedIndex(data: YieldSeriesPoint[], assetId: string): number {
  let idx = -1;
  data.forEach((p, i) => {
    if (p[assetId] !== undefined) idx = i;
  });
  return idx;
}

export function YieldLines({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  const f = useFormat();
  const pin = useTooltipTrigger(data);
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
        onClick={pin.onClick}
      >
        <TapPinPlot probe={pin.probe} />
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={f.dateShort}
          tick={TICK}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          minTickGap={48}
        />
        <YAxis
          // Already IN percent, so `pctPlain` wrapped in `signed()` and never
          // `pct()`, which takes a fraction. No decimals: the axis is too narrow
          // for them and recharts picks whole numbers for it anyway.
          tickFormatter={(v: number) =>
            v === 0 ? f.pctPlain(0, 0) : signed(v, f.pctPlain(Math.abs(v), 0))
          }
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        {/* A cumulative return reads against zero (`charts.md` § Signed › Anatomy). */}
        <ReferenceLine y={0} stroke={CHART.fieldBorder} strokeWidth={1} />
        {/* Per-asset cumulative yield exists ONLY here, so the tooltip has to
            be reachable by tap as well as by hover. */}
        <ChartTooltip
          pin={pin}
          cursor={CHART_CURSOR_LINE}
          formatLabel={(label) => f.dateShort(String(label))}
          formatValue={(n) => (n === 0 ? f.pctPlain(0, 2) : signed(n, f.pctPlain(Math.abs(n), 2)))}
          formatName={(e) => assets.find((a) => a.id === e.dataKey)?.name ?? String(e.name)}
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
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              {...CHART_MOTION}
              activeDot={pin.released ? false : ringed(color)}
              dot={(props: DotItemDotProps) =>
                props.index === lastIdx ? (
                  <circle cx={props.cx} cy={props.cy} {...ringed(color)} />
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
