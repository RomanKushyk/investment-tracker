// «Разом»'s one glyph drawing (wave 14, `yield-series-shapes.md` § Signed › Glyph, G1): the end
// mark, the crosshair marks, the legend key and the tooltip key are all this path.
import { CHART } from '@quirenote/core/colors';
import { glyphPath, type Shape } from './yield-lines';

// The ring is painted under the fill, so half the stroke shows: the stroke is twice the ring.
const RING = 2;

export function SeriesGlyph({
  shape,
  size,
  color,
  cx = 0,
  cy = 0,
  opacity,
}: {
  shape: Shape;
  size: number;
  color: string;
  cx?: number;
  cy?: number;
  opacity?: number;
}) {
  return (
    <path
      data-glyph={shape}
      data-glyph-size={size}
      d={glyphPath(shape, size, cx, cy)}
      fill={color}
      stroke={CHART.card}
      strokeWidth={RING * 2}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={opacity === undefined ? undefined : { opacity }}
    />
  );
}

/** The glyph at rest in a box of its own, on a segment of the line for the legend. */
export function GlyphKey({
  shape,
  color,
  segment = false,
  ...rest
}: {
  shape: Shape;
  color: string;
  segment?: boolean;
  'data-legend-key'?: boolean;
}) {
  const size = 9;
  const box = size + RING * 2;
  const width = segment ? 22 : box;
  return (
    <svg aria-hidden width={width} height={box} className="shrink-0 overflow-visible" {...rest}>
      {segment && (
        <line x1={0} x2={width} y1={box / 2} y2={box / 2} stroke={color} strokeWidth={2} />
      )}
      <SeriesGlyph shape={shape} size={size} color={color} cx={width / 2} cy={box / 2} />
    </svg>
  );
}
