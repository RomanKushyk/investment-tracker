import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from 'radix-ui';
import { Fragment, type ReactNode } from 'react';

import { useIsDesktop } from '../../hooks/useIsDesktop';
import { Scroller } from './Scroller';
import { keepOpenForToasts } from './toaster-press';

// The app's dialog idiom; Radix provides the focus trap, Escape and the scroll lock,
// and every dialog renders a title for its accessible name. A HOST MUST KEEP RENDERING
// A CLOSED DIALOG rather than unmounting it: Radix holds the node until the
// closed-state animation ends, so unmounting skips the exit.
export const DialogTitle = RadixDialog.Title;

// `scrim`, THE APP'S ONE VEIL: it must darken in BOTH themes, so it cannot be an alpha
// over a token that inverts — a per-theme alpha over a fixed dark hue is the job.
// Below md the scrim fades over 220 both ways, the sheet's own timing.
const OVERLAY_CLASS =
  'bg-scrim fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300 max-md:data-[state=open]:duration-220 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220';
// The dialog glass: its own thicker fill over the scrim, and wave 8's `field-border` edge in place
// of the glass stroke. Its light reading over the veil is a ruled shortfall, at the fill's value.
// The edge is drawn inside the box, where the border sat, so each panel pads 1 px: its content
// keeps its place and cannot paint over the edge. SHEET leaves the padding to its user.
const SURFACE =
  'glass [--glass-fill:var(--color-glass-dialog-fill)] [--glass-edge:var(--color-field-border)] fixed z-50 overflow-hidden rounded-3xl';

/** Below md, the inset sheet (M2): 12 from the sides, above the larger of the bottom safe area
 *  and the keyboard — iOS keeps reporting the safe area under the keyboard, so a sum would float
 *  it above the keyboard by the home indicator's inset — and capped so its top stays 68 down. It
 *  travels its height plus that offset, so it starts wholly off screen, and takes no tap while it
 *  leaves. The DatePicker's sheet is this one. */
export const SHEET = `${SURFACE} max-md:inset-x-[12px] max-md:[--sheet-bottom:max(calc(12px+env(safe-area-inset-bottom)),calc(var(--keyboard-inset,0px)+12px))] max-md:bottom-(--sheet-bottom) max-md:max-h-[calc(100dvh-68px-var(--sheet-bottom))] max-md:data-[state=open]:animate-sheet-in max-md:data-[state=closed]:animate-sheet-out max-md:data-[state=closed]:pointer-events-none`;

const CENTRED_ACROSS = 'md:left-1/2 md:w-[calc(100vw-32px)] md:-translate-x-1/2';
// At md and up, centred. `dvh`, not `vh`: `100vh` is the height with the toolbars RETRACTED, so a
// fraction of it runs under the chrome. `dvh` knows nothing about the keyboard, which on iOS does
// not resize the layout viewport, so both the BOUND and the CENTRE subtract `--keyboard-inset`.
// `* 0.5` and NOT `/ 2`: Tailwind reads a slash in an arbitrary value as the opacity modifier.
const PANEL_CLASS = `${SHEET} ${CENTRED_ACROSS} md:top-1/2 md:max-h-[calc((100dvh-var(--keyboard-inset,0px))*0.85)] md:translate-y-[calc(-50%-var(--keyboard-inset,0px)*0.5)] md:data-[state=open]:animate-in md:data-[state=open]:fade-in md:data-[state=open]:zoom-in-95 data-[state=open]:duration-300 md:data-[state=closed]:animate-out md:data-[state=closed]:fade-out md:data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220 grid grid-rows-[auto_minmax(0,1fr)_auto] p-px`;
// TOP-ANCHORED at every width, so a flow whose steps grow downward keeps its top edge; below md it
// takes the sheet's side inset. The keyboard only shortens the cap, which the Scroller holds.
const TOP_PANEL_CLASS = `${SURFACE} max-md:inset-x-[12px] ${CENTRED_ACROSS} top-4 md:top-16 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220 p-px`;
const TOP_CAP =
  'max-h-[calc(100dvh-var(--keyboard-inset,0px)-34px)] md:max-h-[calc(100dvh-var(--keyboard-inset,0px)-130px)]';

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

/** The drawn order is the focus order (W1, WCAG 2.4.3), so the buttons swap in the DOM; keyed, so
 *  crossing md moves a focused button rather than relabelling it as the other one. */
export function DialogActions({ cancel, children }: { cancel: ReactNode; children?: ReactNode }) {
  const desktop = useIsDesktop();
  const dismiss = <Fragment key="cancel">{cancel}</Fragment>;
  const actions = <Fragment key="actions">{children}</Fragment>;
  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:justify-end">
      {desktop ? [dismiss, actions] : [actions, dismiss]}
    </div>
  );
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
  const widthClass = width === 520 ? 'md:max-w-[520px]' : 'md:max-w-[420px]';
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={OVERLAY_CLASS} />
        <RadixDialog.Content
          aria-describedby={undefined}
          onInteractOutside={keepOpenForToasts}
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
  anchor = 'centre',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  /** Called before Esc closes; preventDefault() makes it inert. */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** The wider band carries the import diff. */
  width?: 420 | 480;
  /** `top`: the whole panel scrolls, its rail floating in the gutter the caller's bands draw, where
   *  a bot check wider than the content overhangs unclipped. */
  anchor?: 'centre' | 'top';
  children: ReactNode;
}) {
  // A container-query context, because the import diff reflows by the DIALOG's width.
  const widthClass = width === 480 ? 'md:max-w-[480px] @container' : 'md:max-w-[420px]';
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={OVERLAY_CLASS} />
        <RadixAlertDialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          onEscapeKeyDown={onEscapeKeyDown}
          className={`${anchor === 'top' ? TOP_PANEL_CLASS : PANEL_CLASS} ${widthClass}`}
        >
          {anchor === 'top' ? (
            <Scroller overlay className={TOP_CAP}>
              {children}
            </Scroller>
          ) : (
            children
          )}
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
