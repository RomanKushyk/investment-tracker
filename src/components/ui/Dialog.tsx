import { AlertDialog as RadixAlertDialog, Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

// The app's dialog idiom (design/extensions/settings.dc.html S6, first minted
// for Phase 2): overlay = ink at 40% alpha, card radius 24, max-w per usage,
// fits 360px with margins. Radix provides focus trap + Esc + scroll lock.
// D7 (S6 motion table): open = overlay fade + panel fade/zoom-in-95 300ms;
// close = SYMMETRIC exit 220ms (fade/zoom-out-95) — Radix keeps the node
// mounted until the data-[state=closed] animation ends, so hosts must keep
// rendering a closed dialog (open={false}) instead of unmounting it, or the
// exit is skipped. Reduced-motion collapses both via the global kill-switch.
// Every dialog renders a <DialogTitle> for a11y.
export const DialogTitle = RadixDialog.Title;

const OVERLAY_CLASS =
  'bg-ink/40 fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:duration-220';
const PANEL_CLASS =
  'bg-card fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-6 shadow-[0_12px_40px_rgba(38,38,42,.18)] data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in-95 data-[state=open]:duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 data-[state=closed]:duration-220';

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
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={OVERLAY_CLASS} />
        <RadixAlertDialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className={`${PANEL_CLASS} max-w-[420px]`}
        >
          {children}
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
