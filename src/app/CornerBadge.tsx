/** Material's large badge at a box's top-right corner, where no label shows: the rail and the
 *  burger. `top` is the box's own inset. */
export function CornerBadge({ shown, top }: { shown: string; top: 'top-[2px]' | 'top-1' }) {
  return (
    <span
      aria-hidden
      className={`absolute ${top} right-[2px] grid h-4 min-w-4 place-items-center rounded-[4px] bg-sb-indicator px-1 text-[10px] leading-[10px] font-bold text-card`}
    >
      {shown}
    </span>
  );
}
