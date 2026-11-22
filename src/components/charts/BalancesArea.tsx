import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, YAxis } from 'recharts';
import type { DotItemDotProps } from 'recharts';

import { CHART, CHART_CURSOR_LINE } from '@quirenote/core/colors';
import type { BalanceChartPoint } from '@quirenote/core/view/balances';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';
import { CHART_MOTION, TICK, ringed } from './anatomy';
import { capitalAxis } from './axis-ticks';
import { ChartTooltip } from './ChartTooltip';
import { DateAxis } from './DateAxis';

// The line and its fill are the ACCENT, not the gain green: a total has no
// direction, and gain and loss belong to deltas. *Interaction rules*
export function BalancesArea({ data }: { data: BalanceChartPoint[] }) {
  const f = useFormat();
  const t = useT();
  // Hover on a pointer, tap-to-pin on a touch screen: every value on the line
  // is inside the tooltip and nowhere else.
  const pin = useTooltipTrigger(data);
  const fillId = useId();
  const axis = capitalAxis(data.map((p) => p.total));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
        onClick={pin.onClick}
      >
        <TapPinPlot probe={pin.probe} />
        {/* The area's own box: the line's peak to the baseline. `charts.md` § Signed › Anatomy */}
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={CHART.accent} stopOpacity={0.32} />
            <stop offset="1" stopColor={CHART.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        {/* Lines on the ticks alone: the cropped domain's top edge is no multiple of the step. */}
        <CartesianGrid stroke={CHART.hairline} vertical={false} syncWithTicks />
        <DateAxis data={data} />
        <YAxis
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={(v: number) => `₴${Math.round(v / 1000)}k`}
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <ChartTooltip
          pin={pin}
          cursor={CHART_CURSOR_LINE}
          formatLabel={(label) => f.dateShort(String(label))}
          formatValue={(v) => f.money(v)}
          formatName={() => t.analytics.overview.totalCapital}
        />
        <Area
          type="monotone"
          dataKey="total"
          stroke={CHART.accent}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          fill={`url(#${fillId})`}
          // 1, because recharts defaults it to 0.6 and it multiplies with the stops.
          fillOpacity={1}
          {...CHART_MOTION}
          dot={(props: DotItemDotProps) =>
            props.index === data.length - 1 ? (
              <circle cx={props.cx} cy={props.cy} {...ringed(CHART.accent)} />
            ) : (
              <g />
            )
          }
          // The ring's own stroke, because recharts seeds this dot `stroke: '#fff'` and spreads the
          // caller's props after it: a dot without one keeps a white ring on a themed card.
          activeDot={pin.released ? false : ringed(CHART.accent)}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
