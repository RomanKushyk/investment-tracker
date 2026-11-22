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
import { useT } from '../../i18n/useT';
import { bondAbbrev } from '../../screens/daily-quotes/quotes';
import { CHART_MOTION, TICK, ringed } from './anatomy';
import { ChartTooltip } from './ChartTooltip';
import { yieldAxisWidth, yieldTickLabel, yieldValueLabel, type YieldAxis } from './yield-axis';
import { lastDefinedIndex, sharedAxis, withLine } from './yield-lines';
import { PANEL_PLOT as PLOT, PANEL_TITLE, YieldGrid } from './YieldGrid';

const nameOf = (a: Asset) => (a.yieldType === 'fixed_coupon' ? bondAbbrev(a) : a.name);

/** «Окремо» (`charts.md` § Signed › Identity, Y4): one panel per asset on one y domain, the others
 *  behind it as context, and a panel with no line kept in its place (wave 25). */
export function YieldPanels({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  const f = useFormat();
  const t = useT();
  const drawn = withLine(data, assets);
  const axis = sharedAxis(data, assets);
  const label = yieldTickLabel(f, axis.decimals);
  const width = yieldAxisWidth(axis.ticks.map(label));
  return (
    <YieldGrid>
      {assets.map((asset) =>
        drawn.includes(asset) ? (
          <Panel
            key={asset.id}
            data={data}
            asset={asset}
            others={drawn.filter((o) => o !== asset)}
            axis={axis}
            label={label}
            axisWidth={width}
          />
        ) : (
          <div key={asset.id} data-yield-panel={asset.id}>
            <Title asset={asset} value="—" axisWidth={width} />
            <div
              data-panel-empty
              className="flex items-center justify-center border-b border-hairline px-4 text-center text-small text-muted"
              style={{ height: PLOT, marginLeft: width }}
            >
              {t.analytics.yield.panelNoLine}
            </div>
          </div>
        ),
      )}
    </YieldGrid>
  );
}

function Title({ asset, value, axisWidth }: { asset: Asset; value: string; axisWidth: number }) {
  return (
    <div
      data-panel-title
      className="flex items-baseline justify-between gap-2"
      style={{ height: PANEL_TITLE, paddingLeft: axisWidth, paddingRight: 10 }}
    >
      <span className="flex min-w-0 items-center gap-2 text-body font-semibold">
        <span
          aria-hidden
          className="shrink-0"
          style={{ width: 12, height: 2, backgroundColor: SERIES[asset.colorKey].main }}
        />
        <span className="truncate">{nameOf(asset)}</span>
      </span>
      <span className="shrink-0 font-mono text-small text-muted">{value}</span>
    </div>
  );
}

function Panel({
  data,
  asset,
  others,
  axis,
  label,
  axisWidth,
}: {
  data: YieldSeriesPoint[];
  asset: Asset;
  others: Asset[];
  axis: YieldAxis;
  label: (v: number) => string;
  axisWidth: number;
}) {
  const f = useFormat();
  const pin = useTooltipTrigger(data);
  const color = SERIES[asset.colorKey].main;
  const lastIdx = lastDefinedIndex(data, asset.id);
  const pct = yieldValueLabel(f);
  return (
    <div data-yield-panel={asset.id}>
      <Title asset={asset} value={pct(data[lastIdx][asset.id] as number)} axisWidth={axisWidth} />
      <ResponsiveContainer width="100%" height={PLOT}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 10, left: 0, bottom: 0 }}
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
            width={axisWidth}
          />
          <ReferenceLine y={0} stroke={CHART.fieldBorder} strokeWidth={1} />
          {/* The panel's own asset alone: the context lines are `tooltipType="none"`. */}
          <ChartTooltip
            pin={pin}
            cursor={CHART_CURSOR_LINE}
            formatLabel={(l) => f.dateShort(String(l))}
            formatValue={pct}
            formatName={() => nameOf(asset)}
          />
          {others.map((o) => (
            <Line
              key={o.id}
              type="monotone"
              dataKey={o.id}
              stroke={CHART.faint}
              strokeWidth={1}
              strokeOpacity={0.6}
              dot={false}
              activeDot={false}
              tooltipType="none"
              {...CHART_MOTION}
            />
          ))}
          <Line
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
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
