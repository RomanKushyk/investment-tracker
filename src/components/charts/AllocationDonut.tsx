import { Cell, Label, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { CHART, SERIES } from '../../lib/colors';
import type { Asset } from '../../lib/types';

export interface DonutSlice {
  asset: Asset;
  value: number;
}

// Design lines 502-511: 30px ring (innerRadius 55 / outerRadius 85 of a 220px
// box), starting at 12 o'clock going clockwise, with a two-line center label.
// Motion (D7): the ring sweeps in on mount (recharts default Pie animation).
// Wrapped in an aspect-square/max-w box (not a fixed pixel ResponsiveContainer)
// so it shrinks below 220px on narrow viewports instead of forcing horizontal
// overflow — the one fixed-width chart in the app (360px shell fix, item 1).
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
              style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 20, fontWeight: 700, fill: CHART.ink }}
            />
            <Label value={centerSub} position="center" dy={14} style={{ fontSize: 11, fill: CHART.muted }} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
