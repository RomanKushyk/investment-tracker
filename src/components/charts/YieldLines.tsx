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
import type { Asset } from '@quirenote/core/types';
import type { YieldSeriesPoint } from '@quirenote/core/view/yield';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { CHART_MOTION, TICK, ringed } from './anatomy';
import { ChartTooltip } from './ChartTooltip';
import { yieldAxisWidth, yieldTickLabel, yieldValueLabel } from './yield-axis';
import { lastDefinedIndex, sharedAxis } from './yield-lines';

/** «Разом»: every asset on one chart, on the panels' y domain. */
export function YieldLines({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  const f = useFormat();
  const pin = useTooltipTrigger(data);
  const axis = sharedAxis(data, assets);
  const label = yieldTickLabel(f, axis.decimals);
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
          domain={axis.domain}
          ticks={axis.ticks}
          interval={0}
          tickFormatter={label}
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={yieldAxisWidth(axis.ticks.map(label))}
        />
        {/* A cumulative return reads against zero (`charts.md` § Signed › Anatomy). */}
        <ReferenceLine y={0} stroke={CHART.fieldBorder} strokeWidth={1} />
        {/* Per-asset cumulative yield exists ONLY here, so the tooltip has to
            be reachable by tap as well as by hover. */}
        <ChartTooltip
          pin={pin}
          cursor={CHART_CURSOR_LINE}
          formatLabel={(label) => f.dateShort(String(label))}
          formatValue={yieldValueLabel(f)}
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
