import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

import { Scroller } from './Scroller';

// The app's dialog idiom (design/extensions/settings.dc.html S6, first minted
// for Phase 2): overlay = 40% alpha over the inverted plane (see below), card
// radius 24, max-w per usage, fits 360px with margins. Radix provides focus trap + Esc + scroll lock.
// D7 (S6 motion table): open = overlay fade + panel fade/zoom-in-95 300ms;
// close = SYMMETRIC exit 220ms (fade/zoom-out-95) — Radix keeps the node
// mounted until the data-[state=closed] animation ends, so hosts must keep
// rendering a closed dialog (open={false}) instead of unmounting it, or the
// exit is skipped. Reduced-motion collapses both via the global kill-switch.
// Every dialog renders a <DialogTitle> for a11y.
export const DialogTitle = RadixDialog.Title;

// An INVERTED PLANE, like `KpiCard` dark (FINDING 3): a scrim has to darken
// what is behind it in BOTH themes. `ink` inverts to #eceae7 in dark and would
// turn the scrim into a white wash; `sidebar` is #26262a in light — identical
// to `ink`, so this is a no-op there — and #0f0f11 in dark.
const OVERLAY_CLASS =
  'bg-sidebar/40 fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220';
// The border is transparent in light (the shadow separates it there) and a
// hairline in dark, where --shadow-dialog is zeroed and the panel would
// otherwise meet the scrim with no edge at all.
// C5 — `dvh`, not `vh`. `100vh` on a mobile browser is the height the viewport
// has with the toolbars RETRACTED, so `85vh` is 85% of a taller box than the one
// on screen and a full dialog runs under the chrome at the bottom. `dvh` follows
// the viewport as the toolbars come and go. On a desktop, where nothing
// retracts, the two are identical — so this is one value rather than a
// breakpoint-gated pair.
const PANEL_CLASS =
  'border-surface-edge border bg-card fixed top-1/2 left-1/2 z-50 max-h-[85dvh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-3xl shadow-(--shadow-dialog) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220';

// THE PANEL IS THREE BANDS AND ONLY THE MIDDLE ONE SCROLLS. A title that slides
// away takes the answer to "what am I confirming" with it, and a Save button
// that scrolls has to be hunted for — worse the longer the form, which is
// exactly when it is needed most. So the panel is a GRID of
// `auto minmax(0,1fr) auto`: header and footer take what they need, the body
// takes the rest, and the caller supplies exactly three children in that order.
//
// A grid and not a flex column, for one reason that cost an afternoon: the
// scrolling box needs a parent whose height is DEFINITE, and a flex item sized
// by `flex-1` is not definite enough for a percentage height to resolve against
// while the container itself is `max-h`-clamped rather than fixed. `h-full`
// then quietly becomes `auto`, the body takes its content height, and the
// footer is painted over the fields. `minmax(0, 1fr)` is a real track: it has a
// size before its contents are laid out, and the 0 floor is what lets it shrink
// below the content instead of being pushed open by it.
//
// All three share the 28px gutter (8 + 12 rail + 8, the rail's margin either
// side), because a title indented differently from the fields under it reads
// as a mistake long before anyone works out that a scrollbar caused it.
// The two fixed bands pad themselves to the body's gutter, so all three line up
// down one edge: 8 + 12 + 8, on any screen. Hardcoded rather than read from
// `--rail-gutter` — these bands sit OUTSIDE the Scroller, so they never see that
// property.
const GUTTER = 'px-[28px]';
// The body sets NO inline padding: the Scroller opens the same 28 on both sides
// from its own box, outside the scrolling area, so neither the rail nor the
// panel edge can ever be reached by a field. The two fixed bands pad themselves
// to the same 28 so all three line up.

export function DialogHeader({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-6 pb-4`}>{children}</div>;
}

export function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={`${GUTTER} pt-4 pb-6`}>{children}</div>;
}

/**
 * The scrolling band. `min-h-0` is what makes it give instead of pushing the
 * footer out of the panel — a flex item's floor is its content, so without it
 * a long form grows the column past `max-h-[85dvh]` and the buttons leave the
 * screen rather than the body scrolling.
 *
 * It passes the PANEL's radius even though this band usually sits between two
 * others and reaches no corner: the rail then holds the same line it holds in a
 * dialog that has no footer and does reach one. One position, not two.
 */
export function DialogBody({
  children,
  className = '',
}: {
  children: ReactNode;
  /**
   * Layout for the CONTENT box inside the scrollport — `flex`, `gap`, and
   * nothing else. NOT the same target as `Scroller`'s prop of the same name,
   * which is the viewport: a `max-h-…` sent here lands on the content and makes
   * it shrink and clip instead of scroll, the exact failure this band exists to
   * prevent. The height is the grid row's job, so no caller needs one.
   */
  className?: string;
}) {
  return (
    // BOTH floors, not just the vertical one. A grid item's automatic minimum
    // size is its content, on either axis — so a field wider than the panel
    // makes this box refuse to shrink, the viewport grows past the panel, and
    // the root's `overflow-hidden` cuts the surplus off with no rail to reach
    // it. `min-w-0` is what lets the box be narrower than what it holds, which
    // is the precondition for scrolling it at all.
    <div className="min-h-0 min-w-0">
      {/* `both`, not `vertical`: a dialog holds whatever a caller puts in it,
          and on the axis a Scroller does not manage the viewport is
          `overflow: hidden` — a field wider than the panel is then silently
          cut off with nothing to scroll. The horizontal rail costs nothing
          until something actually overflows. */}
      <Scroller radius={24} orientation="both">
        {/* The caller's layout goes on an inner box, never on the viewport: the
            viewport is a fixed-height parent, so a `flex flex-col` handed to it
            makes the content a flex ITEM and the fields compress to fit instead
            of overflowing — a form that silently shrinks rather than scrolls,
            which is the one failure this whole component exists to prevent. */}
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
          {/* Callers lay themselves out with DialogHeader / DialogBody /
              DialogFooter — the panel only supplies the column. */}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

// Destructive-confirm variant of the same idiom (S6 typed-name dialogs, D17):
// identical visual shell, Radix AlertDialog semantics — outside click never
// dismisses, Esc cancels, focus trapped. Callers render AlertDialogTitle +
// AlertDialogDescription (Radix wires aria-describedby) and may steer initial
// focus via onOpenAutoFocus (S6 auto-focuses the confirm input).
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
  /** Called before Esc closes — preventDefault() makes it inert (P4 S3 pending). */
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  /** 480 = the P4 import dialog's band (it carries a 4-column diff). */
  width?: 420 | 480;
  children: ReactNode;
}) {
  // The 480 band also becomes a container-query context: the import diff has
  // to reflow by the DIALOG's width, not the viewport's. Scoped to that band so
  // the two P2 dialogs keep their exact (containment-free) layout.
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
          {/* Callers lay themselves out with DialogHeader / DialogBody /
              DialogFooter — the panel only supplies the column. */}
          {children}
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
