import { Dialog as RadixDialog } from 'radix-ui';
import type { ReactNode } from 'react';

// The app's dialog idiom (design/extensions/settings.dc.html S6, first minted
// for Phase 2): overlay = ink at 40% alpha, card radius 24, max-w per usage,
// fits 360px with margins. Radix provides focus trap + Esc + scroll lock.
// D7: overlay fade + panel fade/zoom-in-95 300ms soft on open (enter-only —
// the app-wide reveal idiom); reduced-motion collapses via the global
// kill-switch. Every dialog renders a <DialogTitle> for a11y.
export const DialogTitle = RadixDialog.Title;

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
        <RadixDialog.Overlay className="bg-ink/40 animate-in fade-in fixed inset-0 z-50 duration-300" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`bg-card animate-in fade-in zoom-in-95 fixed top-1/2 left-1/2 z-50 max-h-[85vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-6 shadow-[0_12px_40px_rgba(38,38,42,.18)] duration-300 ${widthClass}`}
        >
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
