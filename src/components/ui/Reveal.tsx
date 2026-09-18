import { useState, type ReactNode } from 'react';

// The app's one conditional-group reveal, and the hide is SYMMETRIC with the
// show: the group stays mounted until its exit animation ends, where a bare
// `{flag && …}` unmount would skip it, and `fill-mode-forwards` holds the exited
// frame until React removes the node.
export function Reveal({
  show,
  className,
  distance = 2,
  children,
}: {
  show: boolean;
  className: string;
  /** Tailwind slide distance — `slide-in-from-top-{n}` and its symmetric exit,
   *  so 1 is half the travel of 2. */
  distance?: 1 | 2;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(show);
  // Sanctioned adjust-state-on-render: re-entering while (or after) the exit
  // played must remount the group in the same render pass.
  if (show && !present) setPresent(true);
  if (!show && !present) return null;
  return (
    <div
      className={`${className} duration-300 ${
        show
          ? `animate-in fade-in ${distance === 1 ? 'slide-in-from-top-1' : 'slide-in-from-top-2'}`
          : `animate-out fill-mode-forwards fade-out ${distance === 1 ? 'slide-out-to-top-1' : 'slide-out-to-top-2'}`
      }`}
      onAnimationEnd={(e) => {
        if (!show && e.target === e.currentTarget) setPresent(false);
      }}
    >
      {children}
    </div>
  );
}
