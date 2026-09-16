import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { Scroller } from './Scroller';

// The app's dialog idiom; Radix provides the focus trap, Escape and the scroll lock,
// and every dialog renders a title for its accessible name. A HOST MUST KEEP RENDERING
// A CLOSED DIALOG rather than unmounting it: Radix holds the node until the
// closed-state animation ends, so unmounting skips the exit.
export const DialogTitle = RadixDialog.Title;

// `scrim`, THE APP'S ONE VEIL: it must darken in BOTH themes, so it cannot be an alpha
// over a token that inverts — a per-theme alpha over a fixed dark hue is the job.
const OVERLAY_CLASS =
  'bg-scrim fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220';
// `border-field-border` repairs this panel INWARD only and stays under 1.4.11 against
// the overlay in light — recorded rather than repaired, both readings held in
// `floating-edges.test.ts`. The DatePicker sheet takes the identical pair.
//
// `dvh`, not `vh`: `100vh` is the height the viewport has with the toolbars RETRACTED,
// so a fraction of it is a fraction of a taller box and the panel runs under the
// chrome. `dvh` tracks the TOOLBARS and knows nothing about the keyboard, which on iOS
// does not resize the layout viewport at all — so BOTH numbers subtract
// `--keyboard-inset`: the BOUND, or the panel is a fraction of a box whose lower half
// is under the keyboard, and the CENTRE, or a correctly bounded panel is still centred
// on the layout viewport and hangs into it anyway. `* 0.5` and NOT `/ 2`, because
// Tailwind reads a slash in an arbitrary value as the opacity modifier. Both fall back
// to 0px, so a desktop compiles to what was here before.
const PANEL_CLASS =
  'border-field-border border bg-card fixed top-1/2 left-1/2 z-50 max-h-[calc((100dvh-var(--keyboard-inset,0px))*0.85)] w-[calc(100vw-32px)] -translate-x-1/2 translate-y-[calc(-50%-var(--keyboard-inset,0px)*0.5)] grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-3xl shadow-(--shadow-dialog) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220';

// THE PANEL IS THREE BANDS AND ONLY THE MIDDLE ONE SCROLLS: a title that slides away
// takes "what am I confirming" with it, and a Save button that scrolls has to be
// hunted for. A GRID AND NOT A FLEX COLUMN, because a scrolling box needs a parent
// whose height is DEFINITE — `flex-1` under a `max-h`-clamped container is not, so
// `h-full` quietly becomes `auto` and the footer paints over the fields.
//
// This matches the gutter the Scroller opens from its own box, so all three line up.
// Hardcoded because these two bands sit OUTSIDE it and never see `--rail-gutter`.
const GUTTER = 'px-[28px]';

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-6 pb-4`}>{children}</div>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-4 pb-6`}>{children}</div>;
}

/** The scrolling band. It passes the PANEL's radius even though it usually reaches no
 *  corner, so the rail holds the same line it holds in a dialog with no footer that
 *  does. One position, not two. */
export function DialogBody({
  children,
  className = '',
}: {
  children: ReactNode;
  /** Layout for the CONTENT box inside the scrollport — `flex`, `gap`, nothing else.
   *  NOT the same target as `Scroller`'s prop of the same name, which is the viewport:
   *  a `max-h-…` sent here lands on the content and makes it shrink and clip instead
   *  of scroll. The height is the grid row's job. */
  className?: string;
}) {
  return (
    // BOTH floors: a grid item's automatic minimum size is its content on EITHER axis,
    // so a field wider than the panel makes this refuse to shrink and the root clips
    // the surplus with no rail to reach it.
    <div className="min-h-0 min-w-0">
      {/* `both`, not `vertical`: a dialog holds whatever a caller puts in it, and the
          axis a Scroller does not manage is `overflow: hidden`. */}
      <Scroller radius={24} orientation="both">
        {/* The caller's layout goes on an inner box, never the viewport: the viewport
            is a fixed-height parent, so a `flex flex-col` there makes the content a
            flex ITEM and the fields compress to fit instead of overflowing. */}
        <div className={className}>{children}</div>
      </Scroller>
    </div>
  );
}

export function Dialog({
  open,
  onOpenChange,
  width = 420,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  width?: 420 | 520;
  children: ReactNode;
}) {
  const widthClass = width === 520 ? 'max-w-[520px]' : 'max-w-[420px]';
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`${PANEL_CLASS} ${widthClass}`}
        >
          {/* The panel only supplies the column; callers lay themselves out. */}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// Destructive-confirm variant: identical shell, Radix AlertDialog semantics, so an
// outside click never dismisses it.
export const AlertDialogTitle = RadixAlertDialog.Title;
export const AlertDialogDescription = RadixAlertDialog.Description;
export const AlertDialogCancel = RadixAlertDialog.Cancel;

export function AlertDialog({
  open,
  onOpenChange,
  onOpenAutoFocus,
  onEscapeKeyDown,
  width = 420,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  /** Called before Esc closes; preventDefault() makes it inert. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** The wider band carries the import diff. */
  width?: 420 | 480;
  children: ReactNode;
}) {
  // A container-query context, because the import diff reflows by the DIALOG's width.
  const widthClass = width === 480 ? 'max-w-[480px] @container' : 'max-w-[420px]';
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={OVERLAY_CLASS} />
        <RadixAlertDialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
          className={`${PANEL_CLASS} ${widthClass}`}
        >
          {children}
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
