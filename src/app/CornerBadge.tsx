/** Material's large badge at a box's top-right corner, where no label shows: the rail and the
 *  burger. Solid accent, a 16 box at r4 that «99+» grows to the left (C1,
 *  rail-and-account-foot.md § Signed). `top` is the box's own inset. */
export function CornerBadge({ shown, top }: { shown: string; top: 'top-[2px]' | 'top-1' }) {
  return (
    <span
      aria-hidden
      className={`absolute ${top} right-[2px] grid h-4 min-w-4 place-items-center rounded-[4px] bg-accent px-[3px] text-label font-bold text-accent-fg`}
    >
      {shown}
    </span>
  );
}
