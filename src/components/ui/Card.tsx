import type { ComponentPropsWithRef } from 'react';

// `radius` is an explicit variant, not a className override, so a caller cannot
// end up with two border-radius utilities fighting over generated-CSS order.
export function Card({
  className = '',
  radius = 20,
  ...props
  // `ComponentPropsWithRef`, not `HTMLAttributes`: a Card IS a div, and a
  // caller that needs to measure one should not have to wrap it in another.
}: ComponentPropsWithRef<'div'> & { radius?: 20 | 24 }) {
  const radiusClass = radius === 24 ? 'rounded-3xl' : 'rounded-[20px]';
  return (
    <div className={`${radiusClass} bg-card shadow-(--shadow-card) ${className}`} {...props} />
  );
}
