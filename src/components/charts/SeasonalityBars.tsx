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
import type { BarShapeProps } from 'recharts';

import {
  CHART,
  CHART_CURSOR_FILL,
  CHART_TOOLTIP,
  CHART_TOOLTIP_ITEM,
  SERIES,
} from '@quirenote/core/colors';
import { useFormat } from '../../hooks/useFormat';
import { useT } from '../../i18n/useT';
import type { ColorKey } from '@quirenote/core/types';
import { clampLabelX, expectedOnlyLabel, seasonalitySeriesNames } from './seasonality-labels';

export interface SeasonalityChartPoint {
  day: number;
  actual: number;
  expected?: number;
  colorKey?: ColorKey; // dominant asset's color for a day with real income
  expectedColorKey?: ColorKey; // dominant asset's color for a day with an upcoming coupon
  actualLabel?: string;
  expectedLabel?: string;
}

// A zero-income bucket draws a STUB rather than nothing, so a day that existed
// and earned nothing is visible as such instead of as a gap in the series.
function ActualBarShape(props: BarShapeProps) {
  const { x, y, width, height } = props;
  const point = props.payload as SeasonalityChartPoint;
  if (point.actual === 0) {
    const stubWidth = Math.min(15, width);
    return (
      <rect
        x={x + width / 2 - stubWidth / 2}
        y={y - 4}
        width={stubWidth}
        height={4}
        rx={2}
        fill={CHART.faint}
      />
    );
  }
  const fill = point.colorKey ? SERIES[point.colorKey].main : CHART.muted;
  return <rect x={x} y={y} width={width} height={height} rx={6} fill={fill} />;
}

// Dashed, which is the app's language for a proposed value rather than a
// recorded one.
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
  /** The plot rectangle, which is what a label has to stay inside of. */
  parentViewBox?: { x: number; width: number };
}

// Which buckets get a tick — the axis below says why the two differ.
const DAY_TICKS = [1, 5, 10, 15, 20, 25, 31];
const MONTH_TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// A plain <text>, never recharts' <Text>, whose auto-wrap breaks a long label
// across lines on a bar this narrow. A bucket with both actual and expected
// income joins the two amounts into ONE line above the taller bar: two
// LabelLists on two narrow side-by-side bars overlap illegibly.
function makeIncomeLabel(data: SeasonalityChartPoint[]) {
  return function IncomeLabel({
    x,
    y,
    width,
    height,
    index,
    parentViewBox,
  }: Partial<BarLabelEntry>) {
    if (
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      index === undefined
    ) {
      return null;
    }
    const point = data[index];
    if (!point) return null;

    // EXPECTED-ONLY BUCKETS ARE THE OTHER LIST'S JOB. This label rides the
    // ACTUAL bar, so where actual is 0 recharts hands it height 0 and `y` at the
    // baseline: `pxPerUnit` collapses and the text lands on the axis instead of
    // above the dashed bar. A bar that knows its own geometry places its own
    // label, so the expected series carries a second `LabelList` for this case.
    if (point.actual === 0) return null;

    let topY = y;
    let text = point.actualLabel;
    if (point.expected !== undefined) {
      const pxPerUnit = height / point.actual;
      const expectedY = y - (point.expected - point.actual) * pxPerUnit;
      topY = Math.min(y, expectedY);
      text = point.actualLabel
        ? `${point.actualLabel} · ${point.expectedLabel}`
        : point.expectedLabel;
    }
    if (!text) return null;

    return (
      <text
        x={clampLabelX(x + width / 2, text, 10, parentViewBox)}
        y={topY - 6}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={CHART.ink}
      >
        {text}
      </text>
    );
  };
}

/**
 * The label an EXPECTED-ONLY bucket needs, placed by the bar that knows where it
 * is. Which bucket a rectangle belongs to is `expectedOnlyLabel`'s question and
 * not an obvious one — see it for why `index` is not a data index.
 */
function makeExpectedOnlyLabel(data: SeasonalityChartPoint[]) {
  return function ExpectedOnlyLabel({ x, y, width, index, parentViewBox }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || index === undefined)
      return null;
    const text = expectedOnlyLabel(data, index);
    if (text === null) return null;
    return (
      <text
        x={clampLabelX(x + width / 2, text, 10, parentViewBox)}
        y={y - 6}
        textAnchor="middle"
        fontSize={10}
        fontWeight={700}
        fill={CHART.ink}
      >
        {text}
      </text>
    );
  };
}

// Drawn at `design/Investment Tracker.dc.html:415-437`.
export function SeasonalityBars({
  data,
  axis = 'day',
}: {
  data: SeasonalityChartPoint[];
  /**
   * Which bucket the points carry. The chart draws the same two series either
   * way; what changes is how a tick and a tooltip NAME a bucket, and naming a
   * month "День 8" is the one thing that would be actively wrong.
   */
  axis?: 'day' | 'month';
}) {
  const f = useFormat();
  const t = useT();
  const names = seasonalitySeriesNames(t);
  const incomeLabel = makeIncomeLabel(data);
  // Capitalised because the lower-case name is TAKEN: `expectedOnlyLabel` is the
  // pure helper imported above, and a local binding of that name shadows it for
  // this whole body. Both are callable, so calling the wrong one is a silent
  // wrong render rather than a type error.
  const ExpectedOnlyLabel = makeExpectedOnlyLabel(data);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 26, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        {/* TWELVE TICKS FIT UNTHINNED, so the month axis names every bucket
            while the day axis keeps its seven — thirty-one labels at this size
            do not fit and twelve month names do. */}
        <XAxis
          dataKey="day"
          ticks={axis === 'month' ? MONTH_TICKS : DAY_TICKS}
          tickFormatter={axis === 'month' ? (v) => t.dates.monthShort[Number(v) - 1] : undefined}
          tick={{ fontSize: 10, fill: CHART.muted }}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          interval={0}
        />
        {/* Sorted by key, not recharts' default `name`: the names are translated and would
            order the rows per language. `actual` < `expected` is what puts Received first. */}
        <Tooltip
          itemSorter="dataKey"
          formatter={(v) => f.money(Number(v))}
          labelFormatter={(label) =>
            axis === 'month'
              ? t.dates.monthFull[Number(label) - 1]
              : t.analytics.seasonality.anchorDay(Number(label))
          }
          contentStyle={CHART_TOOLTIP}
          itemStyle={CHART_TOOLTIP_ITEM}
          cursor={CHART_CURSOR_FILL}
        />
        <Bar
          dataKey="actual"
          name={names.actual}
          shape={ActualBarShape}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          <LabelList
            content={incomeLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
        <Bar
          dataKey="expected"
          name={names.expected}
          shape={ExpectedBarShape}
          isAnimationActive
          animationDuration={900}
          animationEasing="ease-out"
        >
          <LabelList
            content={ExpectedOnlyLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
