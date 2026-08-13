import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

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
const PANEL_CLASS =
  'bg-card fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-6 shadow-(--shadow-dialog) data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220';

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
          {children}
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
