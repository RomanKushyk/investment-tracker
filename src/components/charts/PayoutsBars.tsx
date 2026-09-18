import type { ComponentProps } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';

import { CHART, CHART_CURSOR_FILL, CHART_TOOLTIP, SERIES } from '../../core/colors';
import { useFormat } from '../../hooks/useFormat';
import { useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';

export interface PayoutsChartPoint {
  monthLabel: string;
  dividends: number;
  coupons: number;
  totalLabel: string; // pre-formatted table string ("1 763,70") for the top label
}

// What a Bar's LabelList content function actually RECEIVES at runtime: no
// `payload`, and `index` maps back into the chart's own data array. Recharts'
// own `content` type is shared with <Label>, which takes a viewBox instead.
interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  index: number;
}

// A grand total above the WHOLE stack, attached to BOTH bars because recharts
// skips a LabelList's content fn at any index where its own bar is 0. Coupons
// is stacked on top, so whenever it renders it IS the top of the stack and
// draws unconditionally; dividends draws only where coupons is 0, at which
// point dividends is the top segment and its own y needs no adjustment.
// Anchoring on dividends alone got a month with coupons and no dividends wrong.
function makeSegmentLabel(data: PayoutsChartPoint[], alwaysTop: boolean) {
  return function TotalLabel({ x, y, width, index }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || index === undefined) {
      return null;
    }
    const point = data[index];
    if (!point) return null;
    if (!alwaysTop && point.coupons > 0) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={10.5}
        fontWeight={700}
        fill={CHART.ink}
      >
        {point.totalLabel}
      </text>
    );
  };
}

// Drawn at `design/Investment Tracker.dc.html:249-260`.
export function PayoutsBars({ data }: { data: PayoutsChartPoint[] }) {
  const f = useFormat();
  const t = useT();
  const trigger = useTooltipTrigger();
  const dividendsLabel = makeSegmentLabel(data, false);
  const couponsLabel = makeSegmentLabel(data, true);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 28, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="monthLabel"
          tick={{ fontSize: 10.5, fill: CHART.muted }}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
        />
        {/* The monthly split lives ONLY in this tooltip, so on a touch screen it
            is reached by a tap rather than a hover.

            THE FORMATTER IS NOT DECORATION: without one, recharts prints its own
            raw dataKeys and JS numbers — English series names in a
            Ukrainian-default app, and a decimal point where every other figure
            on the screen uses a comma. The two names are the legend's own, not
            new copy. */}
        <Tooltip
          trigger={trigger}
          formatter={(v, name) => [
            f.num(Number(v)),
            name === 'coupons' ? t.analytics.coupons : t.analytics.dividends,
          ]}
          contentStyle={CHART_TOOLTIP}
          cursor={CHART_CURSOR_FILL}
        />
        <Bar
          dataKey="dividends"
          stackId="pay"
          fill={SERIES.reit.main}
          radius={[6, 6, 6, 6]}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          <LabelList
            content={dividendsLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
        <Bar
          dataKey="coupons"
          stackId="pay"
          fill={SERIES.ovdp8976.main}
          radius={[6, 6, 6, 6]}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          <LabelList
            content={couponsLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
