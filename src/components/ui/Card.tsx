import type { HTMLAttributes } from 'react';

// White rounded card, README §4 shape rule (radius 20-24, card shadow).
// `radius` is an explicit variant (not a className override) so callers can't
// end up with two border-radius utilities fighting over generated-CSS order.
export function Card({
  className = '',
  radius = 20,
  ...props
}: HTMLAttributes<HTMLDivElement> & { radius?: 20 | 24 }) {
  const radiusClass = radius === 24 ? 'rounded-3xl' : 'rounded-[20px]';
  return (
    <div
      className={`${radiusClass} bg-card shadow-[0_1px_3px_rgba(38,38,42,.06)] ${className}`}
      {...props}
    />
  );
}
