import type { ComponentProps } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { BarShapeProps } from 'recharts';

import { CHART, CHART_CURSOR_FILL, CHART_TOOLTIP, SERIES } from '../../core/colors';
import type { ColorKey } from '../../core/types';

export interface SeasonalityChartPoint {
  day: number;
  actual: number;
  expected?: number;
  colorKey?: ColorKey; // dominant asset's color for a day with real income
  expectedColorKey?: ColorKey; // dominant asset's color for a day with an upcoming coupon
  actualLabel?: string;
  expectedLabel?: string;
}

// Zero-income days render as small 3-5px gray stubs (design: "ordinary
// price-drift days with no income"); real-income days get a tall rounded bar
// in the dominant asset's color.
function ActualBarShape(props: BarShapeProps) {
  const { x, y, width, height } = props;
  const point = props.payload as SeasonalityChartPoint;
  if (point.actual === 0) {
    const stubWidth = Math.min(15, width);
    return (
      <rect x={x + width / 2 - stubWidth / 2} y={y - 4} width={stubWidth} height={4} rx={2} fill={CHART.faint} />
    );
  }
  const fill = point.colorKey ? SERIES[point.colorKey].main : CHART.muted;
  return <rect x={x} y={y} width={width} height={height} rx={6} fill={fill} />;
}

// Expected (asterisked) bar for an upcoming coupon on its due day-of-month —
// dashed outline to read as "projected", not yet realized.
function ExpectedBarShape(props: BarShapeProps) {
  const { x, y, width, height } = props;
  if (height <= 0) return <g />;
  const point = props.payload as SeasonalityChartPoint;
  const color = point.expectedColorKey ? SERIES[point.expectedColorKey].main : CHART.muted;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={6}
      fill={color}
      fillOpacity={0.4}
      stroke={color}
      strokeDasharray="3 2"
    />
  );
}

interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
}

// One combined label per day, plain <text> (no recharts <Text> auto-wrap,
// which otherwise breaks long strings like "₴3,641 · day 10" across lines on
// a ~15px-wide bar). When a day has both actual and expected income (days 3 &
// 25), the two amounts are joined into a single line above whichever bar is
// taller — two adjacent LabelLists on two narrow side-by-side bars would
// overlap illegibly.
function makeIncomeLabel(data: SeasonalityChartPoint[]) {
  return function IncomeLabel({ x, y, width, height, index }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || height === undefined || index === undefined) {
      return null;
    }
    const point = data[index];
    if (!point) return null;

    let topY = y;
    let text = point.actualLabel;
    if (point.expected !== undefined) {
      const pxPerUnit = point.actual > 0 ? height / point.actual : 0;
      const expectedY = y - (point.expected - point.actual) * pxPerUnit;
      topY = Math.min(y, expectedY);
      text = point.actualLabel ? `${point.actualLabel} · ${point.expectedLabel}` : point.expectedLabel;
    }
    if (!text) return null;

    return (
      <text x={x + width / 2} y={topY - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill={CHART.ink}>
        {text}
      </text>
    );
  };
}

// Design lines 415-437: income-by-day-of-month bars. Motion (D7): bars grow
// from baseline on mount and animate from previous height on data updates.
export function SeasonalityBars({ data }: { data: SeasonalityChartPoint[] }) {
  const incomeLabel = makeIncomeLabel(data);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 26, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="day"
          ticks={[1, 5, 10, 15, 20, 25, 31]}
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          interval={0}
        />
        <Tooltip
          formatter={(v) => `₴${Number(v).toFixed(2)}`}
          labelFormatter={(label) => `Day ${label}`}
          contentStyle={CHART_TOOLTIP}
          cursor={CHART_CURSOR_FILL}
        />
        <Bar dataKey="actual" shape={ActualBarShape} isAnimationActive animationDuration={900} animationEasing="ease-out">
          <LabelList content={incomeLabel as unknown as ComponentProps<typeof LabelList>['content']} />
        </Bar>
        <Bar
          dataKey="expected"
          shape={ExpectedBarShape}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
