import type { ComponentProps } from 'react';
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  LabelList,
  Rectangle,
  ResponsiveContainer,
  XAxis,
  type BarShapeProps,
} from 'recharts';

import { CHART, CHART_CURSOR_FILL, PAYOUT } from '@quirenote/core/colors';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { useT } from '../../i18n/useT';
import { CHART_MOTION, TICK } from './anatomy';
import { ChartTooltip } from './ChartTooltip';

export interface PayoutsChartPoint {
  /** `YYYY-MM`: the category, unique where a month name repeats past twelve months. */
  month: string;
  dividends: number;
  coupons: number;
  total: number;
}

// `charts.md` § Signed › Forms, B1, as `open-values-charts-type.md` § Signed settles it.
const COLUMN_MAX = 24;
const STACK_TOP: [number, number, number, number] = [4, 4, 0, 0];
const PART_GAP = 2;

// The gap comes out of the lower part, so the column's top stays true to the month's total, and
// only where that part has room for it, so a small payout is never cut to nothing.
function DividendPart(props: BarShapeProps) {
  const point = props.payload as PayoutsChartPoint;
  const gap = point.coupons > 0 && props.height > PART_GAP ? PART_GAP : 0;
  return <Rectangle {...props} y={props.y + gap} height={props.height - gap} />;
}

// What a Bar's LabelList content function RECEIVES at runtime: no `payload`, and an `index` into
// the parts recharts drew, which skips the months this kind is 0 in. `value` is the LabelList's
// `dataKey` read off the row, so keyed on the month it names the column's own row.
// Recharts' own `content` type is shared with <Label>, which takes a viewBox instead.
interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  value: string;
}

// A grand total above the WHOLE stack, attached to BOTH bars because recharts
// skips a LabelList's content fn at any index where its own bar is 0. Coupons
// is stacked on top, so whenever it renders it IS the top of the stack and
// draws unconditionally; dividends draws only where coupons is 0, at which
// point dividends is the top segment and its own y needs no adjustment.
function makeSegmentLabel(
  data: PayoutsChartPoint[],
  alwaysTop: boolean,
  format: (n: number) => string,
) {
  return function TotalLabel({ x, y, width, value }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || value === undefined) {
      return null;
    }
    const point = data.find((p) => p.month === value);
    if (!point) return null;
    if (!alwaysTop && point.coupons > 0) return null;
    return (
      <text
        data-payouts-cap
        className="font-mono"
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={11}
        fontWeight={700}
        fill={CHART.ink}
      >
        {format(point.total)}
      </text>
    );
  };
}

export function PayoutsBars({ data }: { data: PayoutsChartPoint[] }) {
  const f = useFormat();
  const t = useT();
  const pin = useTooltipTrigger(data);
  const dividendsLabel = makeSegmentLabel(data, false, f.numWhole);
  const couponsLabel = makeSegmentLabel(data, true, f.numWhole);
  const monthName = (month: string | number) =>
    t.dates.monthShort[Number(String(month).slice(5, 7)) - 1];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        margin={{ top: 28, right: 12, left: 0, bottom: 0 }}
        maxBarSize={COLUMN_MAX}
        onClick={pin.onClick}
      >
        <TapPinPlot probe={pin.probe} />
        <CartesianGrid stroke={CHART.hairline} vertical={false} />
        <XAxis
          dataKey="month"
          tickFormatter={monthName}
          tick={TICK}
          axisLine={{ stroke: CHART.hairline }}
          tickLine={false}
          // Up to twelve months every label stays (`loading-and-compositions.md` § Settled by the
          // brief); the spec signs nothing longer, which keeps recharts' thinning.
          interval={data.length <= 12 ? 0 : undefined}
        />
        {/* The monthly split lives ONLY in this tooltip, so on a touch screen it
            is reached by a tap rather than a hover.

            THE FORMATTERS ARE NOT DECORATION: without them the rows print
            recharts' raw dataKeys and JS numbers — English series names in a
            Ukrainian-default app, and a decimal point where every other figure
            on the screen uses a comma. The two names are the legend's own, not
            new copy. */}
        <ChartTooltip
          pin={pin}
          cursor={CHART_CURSOR_FILL}
          formatLabel={monthName}
          formatValue={(v) => f.num(v)}
          formatName={(e) =>
            e.dataKey === 'coupons' ? t.analytics.coupons : t.analytics.dividends
          }
        />
        {/* The stack's radius rounds its outline once, so only the top part's top is round,
            whichever kind that is, and the baseline stays square. */}
        <BarStack radius={STACK_TOP}>
          <Bar dataKey="dividends" fill={PAYOUT.dividend} shape={DividendPart} {...CHART_MOTION}>
            <LabelList
              dataKey="month"
              content={dividendsLabel as unknown as ComponentProps<typeof LabelList>['content']}
            />
          </Bar>
          <Bar dataKey="coupons" fill={PAYOUT.coupon} {...CHART_MOTION}>
            <LabelList
              dataKey="month"
              content={couponsLabel as unknown as ComponentProps<typeof LabelList>['content']}
            />
          </Bar>
        </BarStack>
      </BarChart>
    </ResponsiveContainer>
  );
}
