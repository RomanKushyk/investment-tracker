import type { ComponentProps } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

import { CHART, SERIES } from '../../lib/colors';

export interface PayoutsChartPoint {
  monthLabel: string;
  dividends: number;
  coupons: number;
  totalLabel: string; // pre-formatted table string ("1 763,70") for the top label
}

// recharts' own `content` prop type is shared with <Label> (which uses a
// viewBox, not flat x/y/width/height) — this describes what a Bar's LabelList
// content function actually receives at runtime (no `payload`; `index` maps
// back into the chart's own data array).
interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  value: unknown;
  index: number;
}

// Grand-total label positioned above the WHOLE stack. Attached to the
// "dividends" bar (always > 0 in this dataset) rather than "coupons" (which is
// 0 in 4 of 6 months) — recharts skips rendering a LabelList whose own series
// value is 0, so anchoring to a bar that can be zero silently drops the label.
function makeTotalLabel(data: PayoutsChartPoint[]) {
  return function TotalLabel({ x, y, width, height, value, index }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || height === undefined || index === undefined) {
      return null;
    }
    const point = data[index];
    if (!point) return null;
    const dividendsValue = Number(value) || 0;
    const pxPerUnit = dividendsValue > 0 ? height / dividendsValue : 0;
    const totalTopY = y - point.coupons * pxPerUnit;
    return (
      <text
        x={x + width / 2}
        y={totalTopY - 6}
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

// Design lines 249-260: dividends (reit color) stacked under coupons (ovdp8976
// color), grand-total value label on top. Motion (D7): bars grow from baseline
// on mount and animate from the previous height on data updates.
export function PayoutsBars({ data }: { data: PayoutsChartPoint[] }) {
  const totalLabel = makeTotalLabel(data);
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
        <Tooltip contentStyle={{ borderRadius: 12, border: `1px solid ${CHART.hairline}`, fontSize: 12 }} />
        <Bar
          dataKey="dividends"
          stackId="pay"
          fill={SERIES.reit.main}
          radius={[6, 6, 6, 6]}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          <LabelList content={totalLabel as unknown as ComponentProps<typeof LabelList>['content']} />
        </Bar>
        <Bar
          dataKey="coupons"
          stackId="pay"
          fill={SERIES.ovdp8976.main}
          radius={[6, 6, 6, 6]}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
