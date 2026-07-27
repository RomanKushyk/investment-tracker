import type { HTMLAttributes } from 'react';

// White rounded card, README §4 shape rule (radius 20-24, card shadow).
export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[20px] bg-card shadow-[0_1px_3px_rgba(38,38,42,.06)] ${className}`}
      {...props}
    />
  );
}
