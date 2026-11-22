import type { ComponentProps } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  XAxis,
  type BarShapeProps,
} from 'recharts';

import { CHART, CHART_CURSOR_FILL } from '@quirenote/core/colors';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';
import { CHART_MOTION, TICK } from './anatomy';
import { ChartTooltip } from './ChartTooltip';
import { clampLabelX, expectedOnlyLabel, seasonalitySeriesNames } from './seasonality-labels';

export interface SeasonalityChartPoint {
  day: number;
  actual: number;
  expected?: number;
  actualLabel?: string;
  expectedLabel?: string;
}

// `charts.md` § Signed › Forms, Seasonality; the 4 px value end is chart marks' fixed corner
// (`open-values-charts-type.md` § Signed).
const COLUMN_ALONE = 18;
const COLUMN_PAIRED = 12;
const PAIR_GAP = 2;
const VALUE_END: [number, number, number, number] = [4, 4, 0, 0];
const STUB = { width: 8, height: 4 };
const LABEL_SIZE = 11;
const LINE_STEP = 14;

// Recharts centres the two series' slots in a category with `barGap` between them, so a slot finds
// the category's centre from its own edge. A bucket with one amount draws that bar alone, about it.
const aloneWidth = (slot: number) => Math.min(COLUMN_ALONE, 2 * slot + PAIR_GAP);

// A bucket with neither amount draws a stub, so a day that earned nothing reads as such, not as a gap.
function ReceivedColumn(props: BarShapeProps) {
  const point = props.payload as SeasonalityChartPoint;
  const centre = props.x + props.width + PAIR_GAP / 2;
  if (point.actual === 0) {
    if (point.expected !== undefined) return <g />;
    return (
      <rect
        data-seasonality-stub
        x={centre - STUB.width / 2}
        y={props.y - STUB.height}
        width={STUB.width}
        height={STUB.height}
        fill={CHART.hairline}
      />
    );
  }
  const width = point.expected === undefined ? aloneWidth(props.width) : props.width;
  const x = point.expected === undefined ? centre - width / 2 : props.x;
  return (
    <g data-seasonality-bar="actual">
      <Rectangle {...props} x={x} width={width} radius={VALUE_END} />
    </g>
  );
}

// Dashed, which is the app's language for a proposed value rather than a recorded one.
function ExpectedColumn(props: BarShapeProps) {
  if (props.height <= 0) return <g />;
  const point = props.payload as SeasonalityChartPoint;
  const centre = props.x - PAIR_GAP / 2;
  const width = point.actual === 0 ? aloneWidth(props.width) : props.width;
  const x = point.actual === 0 ? centre - width / 2 : props.x;
  return (
    <g data-seasonality-bar="expected">
      <Rectangle
        {...props}
        x={x}
        width={width}
        radius={VALUE_END}
        fillOpacity={0.4}
        stroke={CHART.accent}
        strokeDasharray="3 2"
      />
    </g>
  );
}

interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  /** The whole chart, margins included: recharts passes its axis view box, not the plot. */
  parentViewBox?: { x: number; width: number };
}

// The top holds two label lines over the tallest bar.
const MARGIN = { top: 34, right: 12, left: 0, bottom: 0 };

// A label stays inside the plot, which is the chart less its margins: no axis takes a side here.
const plotOf = (chart: BarLabelEntry['parentViewBox']) =>
  chart && { x: chart.x + MARGIN.left, width: chart.width - MARGIN.left - MARGIN.right };

// Which buckets get a tick — the axis below says why the two differ.
const DAY_TICKS = [1, 5, 10, 15, 20, 25, 31];
const MONTH_TICKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// A plain <text>, never recharts' <Text>, whose auto-wrap breaks a long label across lines on a bar
// this narrow.
function ValueLine({
  line,
  text,
  centre,
  y,
  plot,
  widest = text,
}: {
  line: 'main' | 'expected';
  text: string;
  centre: number;
  y: number;
  plot: BarLabelEntry['parentViewBox'];
  /** The pair's wider line, which both lines clamp by so they keep one centre. */
  widest?: string;
}) {
  return (
    <text
      data-seasonality-label={line}
      className="font-mono"
      x={clampLabelX(centre, widest, LABEL_SIZE, plotOf(plot))}
      y={y}
      textAnchor="middle"
      fontSize={LABEL_SIZE}
      fontWeight={line === 'main' ? 700 : undefined}
      fill={line === 'main' ? CHART.ink : CHART.muted}
    >
      {text}
    </text>
  );
}

// A bucket with both amounts stacks its two lines above the taller bar, the received one on top:
// two LabelLists on two narrow side-by-side bars would overlap.
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
    // EXPECTED-ONLY BUCKETS ARE THE OTHER LIST'S JOB: where actual is 0 recharts hands this label
    // height 0 and `y` at the baseline, so it cannot find the dashed bar's top.
    if (!point?.actualLabel || point.actual === 0) return null;

    const centre = x + width + PAIR_GAP / 2;
    let top = y;
    if (point.expected !== undefined) {
      const pxPerUnit = height / point.actual;
      top = Math.min(y, y - (point.expected - point.actual) * pxPerUnit);
    }
    const under = point.expectedLabel;
    const widest = under && under.length > point.actualLabel.length ? under : point.actualLabel;
    return (
      <>
        <ValueLine
          line="main"
          text={point.actualLabel}
          centre={centre}
          y={top - 6 - (under ? LINE_STEP : 0)}
          plot={parentViewBox}
          widest={widest}
        />
        {under && (
          <ValueLine
            line="expected"
            text={under}
            centre={centre}
            y={top - 6}
            plot={parentViewBox}
            widest={widest}
          />
        )}
      </>
    );
  };
}

/**
 * The label an EXPECTED-ONLY bucket needs, placed by the bar that knows where it
 * is. Which bucket a rectangle belongs to is `expectedOnlyLabel`'s question and
 * not an obvious one — see it for why `index` is not a data index.
 */
function makeExpectedOnlyLabel(data: SeasonalityChartPoint[]) {
  return function ExpectedOnlyLabel({ x, y, index, parentViewBox }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || index === undefined) return null;
    const text = expectedOnlyLabel(data, index);
    if (text === null) return null;
    return (
      <ValueLine
        line="expected"
        text={text}
        centre={x - PAIR_GAP / 2}
        y={y - 6}
        plot={parentViewBox}
      />
    );
  };
}

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
  const pin = useTooltipTrigger(data);
  const names = seasonalitySeriesNames(t);
  const incomeLabel = makeIncomeLabel(data);
  // Capitalised because the lower-case name is TAKEN: `expectedOnlyLabel` is the
  // pure helper imported above, and a local binding of that name shadows it for
  // this whole body. Both are callable, so calling the wrong one is a silent
  // wrong render rather than a type error.
  const ExpectedOnlyLabel = makeExpectedOnlyLabel(data);
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart
        data={data}
        margin={MARGIN}
        barGap={PAIR_GAP}
        maxBarSize={COLUMN_PAIRED}
        onClick={pin.onClick}
      >
        <TapPinPlot probe={pin.probe} />
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        {/* TWELVE TICKS FIT UNTHINNED, so the month axis names every bucket
            while the day axis keeps its seven — thirty-one labels at this size
            do not fit and twelve month names do. */}
        <XAxis
          dataKey="day"
          ticks={axis === 'month' ? MONTH_TICKS : DAY_TICKS}
          tickFormatter={axis === 'month' ? (v) => t.dates.monthShort[Number(v) - 1] : undefined}
          tick={TICK}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          interval={0}
        />
        <ChartTooltip
          pin={pin}
          cursor={CHART_CURSOR_FILL}
          formatLabel={(label) =>
            axis === 'month'
              ? t.dates.monthFull[Number(label) - 1]
              : t.analytics.seasonality.anchorDay(Number(label))
          }
          formatValue={(v) => f.money(v)}
        />
        <Bar
          dataKey="actual"
          name={names.actual}
          fill={CHART.accent}
          shape={ReceivedColumn}
          {...CHART_MOTION}
        >
          <LabelList
            content={incomeLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
        <Bar
          dataKey="expected"
          name={names.expected}
          fill={CHART.accent}
          shape={ExpectedColumn}
          {...CHART_MOTION}
        >
          <LabelList
            content={ExpectedOnlyLabel as unknown as ComponentProps<typeof LabelList>['content']}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
