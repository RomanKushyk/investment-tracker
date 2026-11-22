import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
  getRelativeCoordinate,
  useActiveTooltipLabel,
  usePlotArea,
  useYAxisScale,
} from 'recharts';
import type { ActiveDotProps, DotItemDotProps, MouseHandlerDataParam, PlotArea } from 'recharts';

import { CHART, CHART_CURSOR_LINE, SERIES } from '@quirenote/core/colors';
import type { Asset } from '@quirenote/core/types';
import type { YieldSeriesPoint } from '@quirenote/core/view/yield';
import { useFormat } from '../../hooks/useFormat';
import { TapPinPlot, onPlot, useTooltipTrigger } from '../../hooks/useTooltipTrigger';
import { CHART_MOTION, FOCUS_COPY, TICK } from './anatomy';
import { ChartTooltip } from './ChartTooltip';
import { GlyphKey, SeriesGlyph } from './SeriesGlyph';
import { yieldAxisWidth, yieldTickLabel, yieldValueLabel } from './yield-axis';
import {
  lastDefinedIndex,
  nameOf,
  shapeByAsset,
  sharedAxis,
  withLine,
  type Shape,
} from './yield-lines';

// `yield-series-shapes.md` § Signed › Motion. recharts rebuilds a line's curve and glyphs on every
// render and keeps its layer, so the fade lives there, and the focused line's copy fades in.
const FOCUS_FADE = 'transition-opacity duration-150 ease-soft';
const LEAD_FADE = 'animate-in duration-150 ease-soft fade-in';
// The others' glyphs are drawn outside their line's layer, so they take its dimming themselves.
const FADED = 0.3;

interface Probe {
  yScale?: (v: number) => number | undefined;
  plot?: PlotArea;
}

/** Rendered inside the chart, where recharts' hooks read the y scale, the plot and the shown date
 *  (by pointer or by its keyboard walk). */
function FocusProbe({
  data,
  probeRef,
  onShown,
}: {
  data: YieldSeriesPoint[];
  probeRef: RefObject<Probe>;
  onShown: (index: number | undefined) => void;
}): null {
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  const label = useActiveTooltipLabel();
  useEffect(() => {
    probeRef.current = { yScale, plot };
  }, [probeRef, yScale, plot]);
  useEffect(() => {
    const index = label === undefined ? -1 : data.findIndex((p) => p.date === label);
    onShown(index === -1 ? undefined : index);
  }, [data, label, onShown]);
  return null;
}

/** A line ends on its glyph at its OWN last point; an asset bought later has a shorter series. */
function endGlyph(
  data: YieldSeriesPoint[],
  assetId: string,
  shape: Shape,
  color: string,
  opacity?: number,
) {
  const lastIdx = lastDefinedIndex(data, assetId);
  return (props: DotItemDotProps) =>
    props.index === lastIdx ? (
      <SeriesGlyph
        shape={shape}
        size={9}
        color={color}
        cx={props.cx}
        cy={props.cy}
        opacity={opacity}
      />
    ) : (
      <g />
    );
}

/** The lines with a point at `index`, top first: the order Up and Down walk. */
function linesAt(data: YieldSeriesPoint[], assets: Asset[], index: number) {
  const point = data[index];
  return assets
    .flatMap((a) =>
      typeof point?.[a.id] === 'number' ? [{ id: a.id, v: point[a.id] as number }] : [],
    )
    .sort((a, b) => b.v - a.v);
}

/** «Разом»: every asset on one chart, on the panels' y domain, each line told apart by its shape
 *  and the one nearest the pointer brought forward (`yield-series-shapes.md` § Signed). */
export function YieldLines({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  const f = useFormat();
  const pin = useTooltipTrigger(data);
  const axis = sharedAxis(data, assets);
  const label = yieldTickLabel(f, axis.decimals);
  const shapes = shapeByAsset(assets);
  const probe = useRef<Probe>({});
  const [shown, setShown] = useState<number>();
  const [focusedId, setFocused] = useState<string>();
  // The date Escape dismissed the box on: Up and Down wait until the box is back, which a new date
  // or a pointer on the plot brings.
  const [escapedAt, setEscapedAt] = useState<number>();
  const onShown = useCallback((index: number | undefined) => {
    setShown(index);
    setEscapedAt(undefined);
  }, []);
  // recharts hides its box on an Escape anywhere on the page, so the focus goes with it there.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setFocused(undefined);
      setEscapedAt(shown);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown]);
  // A line is focused only where it has a point on the shown date, and never past a released pin
  // or off the plot, where no crosshair is drawn.
  const focused =
    pin.released ||
    shown === undefined ||
    focusedId === undefined ||
    typeof data[shown]?.[focusedId] !== 'number'
      ? undefined
      : focusedId;
  const lead = assets.find((a) => a.id === focused);

  // The line nearest the pointer by vertical distance, at the date it snapped to. Off the plot
  // recharts reports its last index, so a pointer there focuses nothing new.
  const focusAt = (index: number | null | undefined, event: MouseEvent<SVGGraphicsElement>) => {
    const { yScale, plot } = probe.current;
    const { relativeX: x, relativeY: y } = getRelativeCoordinate(event);
    if (index == null || !yScale || !onPlot(plot, x, y)) return;
    let best: { id: string; d: number } | undefined;
    for (const { id, v } of linesAt(data, assets, Number(index))) {
      const at = yScale(v);
      if (at === undefined) continue;
      const d = Math.abs(at - y);
      if (!best || d < best.d) best = { id, d };
    }
    setFocused(best?.id);
    setEscapedAt(undefined);
  };

  const onMouseMove = (state: MouseHandlerDataParam, event: MouseEvent<SVGGraphicsElement>) => {
    if (pin.trigger === 'hover') focusAt(state.activeIndex as number | null | undefined, event);
  };
  const onClick = (state: MouseHandlerDataParam, event: MouseEvent<SVGGraphicsElement>) => {
    pin.onClick(state, event);
    if (pin.trigger === 'click') focusAt(state.activeIndex as number | null | undefined, event);
  };

  // Up and Down: the nearest line above or below, no wrap, as Highcharts and the APG data grid
  // do; from no focus the first press takes the top line.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (shown === undefined || shown === escapedAt) return;
    e.preventDefault();
    const stack = linesAt(data, assets, shown);
    const at = stack.findIndex((l) => l.id === focused);
    const next =
      at === -1 ? 0 : Math.min(stack.length - 1, Math.max(0, at + (e.key === 'ArrowUp' ? -1 : 1)));
    setFocused(stack[next]?.id);
  };

  return (
    // The keys reach this box from recharts' focusable plot, which walks Left and Right alone.
    <div onKeyDown={onKeyDown} onBlur={() => setFocused(undefined)}>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
          onClick={onClick}
          onMouseMove={onMouseMove}
          onMouseLeave={() => pin.trigger === 'hover' && setFocused(undefined)}
        >
          <TapPinPlot probe={pin.probe} />
          <FocusProbe data={data} probeRef={probe} onShown={onShown} />
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
            formatName={(e) => {
              const a = assets.find((a) => a.id === e.dataKey);
              return a ? nameOf(a) : String(e.name);
            }}
            keyOf={(e) => {
              const shape = shapes.get(String(e.dataKey));
              return shape && <GlyphKey shape={shape} color={String(e.color)} />;
            }}
            focused={focused}
          />
          {assets.map((asset) => {
            const color = SERIES[asset.colorKey].main;
            const shape = shapes.get(asset.id)!;
            const isFocused = focused === asset.id;
            const faded = focused !== undefined && !isFocused ? FADED : undefined;
            return (
              <Line
                key={asset.id}
                type="monotone"
                dataKey={asset.id}
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={`${FOCUS_FADE} ${faded ? 'opacity-30' : ''}`}
                {...CHART_MOTION}
                // The focused line's crosshair glyph is its copy's, over the others'.
                activeDot={
                  pin.released || isFocused
                    ? false
                    : (props: ActiveDotProps) => (
                        <SeriesGlyph
                          shape={shape}
                          size={10}
                          color={color}
                          cx={props.cx}
                          cy={props.cy}
                          opacity={faded}
                        />
                      )
                }
                dot={endGlyph(data, asset.id, shape, color, faded)}
              />
            );
          })}
          {/* The focused line again, wider. Mounted after the others, it and its glyphs land last
              in their layers, so on top. */}
          {lead && (
            <Line
              key={`lead-${lead.id}`}
              type="monotone"
              dataKey={lead.id}
              stroke={SERIES[lead.colorKey].main}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={LEAD_FADE}
              {...FOCUS_COPY}
              activeDot={
                pin.released
                  ? false
                  : (props: ActiveDotProps) => (
                      <SeriesGlyph
                        shape={shapes.get(lead.id)!}
                        size={12}
                        color={SERIES[lead.colorKey].main}
                        cx={props.cx}
                        cy={props.cy}
                      />
                    )
              }
              dot={endGlyph(data, lead.id, shapes.get(lead.id)!, SERIES[lead.colorKey].main)}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** «Разом»'s legend: only the assets with a line in the window, each keyed by a 22 px segment
 *  carrying its glyph, then its name (`yield-series-shapes.md` § Signed › Legend). */
export function YieldLegend({ data, assets }: { data: YieldSeriesPoint[]; assets: Asset[] }) {
  const shapes = shapeByAsset(assets);
  return (
    <div data-yield-legend className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted">
      {withLine(data, assets).map((a) => (
        <span key={a.id} data-yield-legend-item className="flex items-center gap-1.5">
          <GlyphKey
            shape={shapes.get(a.id)!}
            color={SERIES[a.colorKey].main}
            segment
            data-legend-key
          />
          {a.name}
        </span>
      ))}
    </div>
  );
}
