import { useState, type ReactNode } from 'react';

// The app's one conditional-group reveal (P2 asset-form.dc.html S3 groups,
// reused by the P3 Settings→Automation reminder sub-rows, automation.dc.html
// S8): reveal = fade + slide-from-top 300ms; hide = SYMMETRIC fade/slide-out
// 300ms — the group stays mounted until its exit animation ends (a bare
// `{flag && …}` unmount would skip it). fill-mode-forwards holds the exited
// frame until React removes the node; reduced-motion collapses both to ~0 via
// the global kill-switch.
export function Reveal({
  show,
  className,
  distance = 2,
  children,
}: {
  show: boolean;
  className: string;
  /** Tailwind slide distance — the S8 sub-rows travel 1, the form groups 2. */
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
          : `animate-out fade-out fill-mode-forwards ${distance === 1 ? 'slide-out-to-top-1' : 'slide-out-to-top-2'}`
      }`}
      onAnimationEnd={(e) => {
        if (!show && e.target === e.currentTarget) setPresent(false);
      }}
    >
      {children}
    </div>
  );
}
