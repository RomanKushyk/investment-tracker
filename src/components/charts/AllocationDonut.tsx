import { Cell, Label, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { CHART, SERIES } from '../../core/colors';
import type { Asset } from '../../core/types';

export interface DonutSlice {
  asset: Asset;
  value: number;
}

// Drawn at `design/Investment Tracker.dc.html:502-511`. Wrapped in an
// aspect-square box rather than a fixed-pixel ResponsiveContainer, because this
// is the one chart with a natural width: fixed, it forces horizontal overflow on
// a narrow viewport instead of shrinking.
export function AllocationDonut({
  slices,
  centerTop,
  centerSub,
}: {
  slices: DonutSlice[];
  centerTop: string;
  centerSub: string;
}) {
  return (
    <div className="aspect-square w-full max-w-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey={(d: DonutSlice) => d.value}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive
            animationDuration={900}
            animationEasing="ease-out"
          >
            {slices.map((s) => (
              <Cell key={s.asset.id} fill={SERIES[s.asset.colorKey].main} />
            ))}
            <Label
              value={centerTop}
              position="center"
              dy={-6}
              // The token, never a literal family name: recharts takes a string,
              // which is how a hard-coded font survived here and silently became
              // a system fallback the moment the display face changed.
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20,
                fontWeight: 700,
                fill: CHART.ink,
              }}
            />
            <Label
              value={centerSub}
              position="center"
              dy={14}
              style={{ fontSize: 11, fill: CHART.muted }}
            />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
