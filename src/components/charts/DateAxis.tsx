import { XAxis, usePlotArea } from 'recharts';

import { CHART } from '@quirenote/core/colors';
import { useFormat } from '../../hooks/useFormat';
import { TICK } from './anatomy';
import { dateTicks } from './axis-ticks';

/** The x axis of a chart over `date` points. It sits inside the chart, so it reads its plot's own
 *  width. */
export function DateAxis({ data }: { data: { date: string }[] }) {
  const f = useFormat();
  const plot = usePlotArea();
  return (
    <XAxis
      dataKey="date"
      ticks={dateTicks(
        data.map((p) => p.date),
        plot?.width,
      )}
      tickFormatter={f.dateShort}
      tick={TICK}
      axisLine={{ stroke: CHART.hairline }}
      tickLine={false}
    />
  );
}
