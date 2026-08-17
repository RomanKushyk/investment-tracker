import type { ComponentProps } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis } from 'recharts';

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

// recharts' own `content` prop type is shared with <Label> (which uses a
// viewBox, not flat x/y/width/height) — this describes what a Bar's LabelList
// content function actually receives at runtime (no `payload`; `index` maps
// back into the chart's own data array).
interface BarLabelEntry {
  x: number;
  y: number;
  width: number;
  index: number;
}

// Grand-total label positioned above the WHOLE stack. Recharts skips calling
// a LabelList's content fn for an index where its own bar's value is 0, so
// the label is attached to BOTH bars: the "coupons" bar (stacked on top of
// "dividends") always sits at the true top of the stack when it renders at
// all, so it draws unconditionally; the "dividends" bar only draws when
// coupons is 0 for that month (otherwise coupons' own label already covers
// it) — at that point dividends IS the top segment, so its own y needs no
// further adjustment. This also covers a future month with coupons but zero
// dividends (item 2), which the previous dividends-anchored math got wrong.
function makeSegmentLabel(data: PayoutsChartPoint[], alwaysTop: boolean) {
  return function TotalLabel({ x, y, width, index }: Partial<BarLabelEntry>) {
    if (x === undefined || y === undefined || width === undefined || index === undefined) {
      return null;
    }
    const point = data[index];
    if (!point) return null;
    if (!alwaysTop && point.coupons > 0) return null;
    return (
      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={CHART.ink}>
        {point.totalLabel}
      </text>
    );
  };
}

// Design lines 249-260: dividends (reit color) stacked under coupons (ovdp8976
// color), grand-total value label on top. Motion (D7): bars grow from baseline
// on mount and animate from the previous height on data updates.
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
        {/* S6 / D-b — the monthly split lives only in this tooltip, so on a
            touch screen it is reached by a tap instead of a hover.
            THE FORMATTER IS NOT DECORATION. This was the one chart tooltip with
            neither a `formatter` nor a `labelFormatter`, so it printed its own
            raw dataKeys and JS numbers — `coupons : 0`, `dividends : 472.13` —
            English series names in a Ukrainian-default app, and a decimal point
            where every other figure on the screen uses a comma (README §8).
            It was always wrong; it was only invisible while the sole way to
            reach it was to hover a chart on a laptop. Making the tap the primary
            way in is what turned it into something the reader sees.
            The two names are the legend's own, not new copy. */}
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
          <LabelList content={dividendsLabel as unknown as ComponentProps<typeof LabelList>['content']} />
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
          <LabelList content={couponsLabel as unknown as ComponentProps<typeof LabelList>['content']} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
